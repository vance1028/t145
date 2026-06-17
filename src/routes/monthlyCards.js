'use strict';

const express = require('express');
const store = require('../data/store');
const { authRequired, requireRole } = require('../auth');
const { sendData, sendError, parseId } = require('../utils/http');
const { calculateRefund, findBestMonthlyCard, formatDate } = require('../services/benefits');

const router = express.Router();
router.use(authRequired);

function generateCardNo() {
  const now = new Date();
  const ts = now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0') +
    String(now.getHours()).padStart(2, '0') +
    String(now.getMinutes()).padStart(2, '0') +
    String(now.getSeconds()).padStart(2, '0') +
    String(Math.floor(Math.random() * 1000)).padStart(3, '0');
  return 'MC' + ts;
}

router.get('/', async (req, res, next) => {
  try {
    const { status, plateNo, keyword } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (plateNo) filter.plateNo = plateNo;
    if (keyword) filter.keyword = keyword;
    return sendData(res, 200, await store.listMonthlyCards(filter));
  } catch (e) { return next(e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const card = await store.getMonthlyCardById(id);
    if (!card) return sendError(res, 404, '月卡不存在');
    const vehicles = await store.listCardVehicles(id);
    const scopes = await store.listCardScopes(id);
    const transactions = await store.listCardTransactions(id);
    return sendData(res, 200, { ...card, vehicles, scopes, transactions });
  } catch (e) { return next(e); }
});

router.post('/', requireRole('ADMIN', 'OPERATOR'), async (req, res, next) => {
  try {
    const body = req.body || {};
    const {
      name, cardType, scopeType, priceCents, durationDays,
      freeSlots, maxVehicles, concurrentQuota,
      startDate, endDate, ownerName, phone, plateNos,
      lotIds, districts,
    } = body;

    if (!startDate || !endDate) return sendError(res, 400, '有效期不能为空');
    if (priceCents === undefined || priceCents < 0) return sendError(res, 400, '价格不合法');

    const cardNo = body.cardNo || generateCardNo();
    if (await store.getMonthlyCardByNo(cardNo)) return sendError(res, 409, '月卡编号已存在');

    const card = await store.createMonthlyCard({
      cardNo, name: name || '', cardType: cardType || 'STANDARD',
      scopeType: scopeType || 'SINGLE_LOT', priceCents: Number(priceCents),
      durationDays: Number(durationDays) || 30,
      freeSlots: freeSlots || null,
      maxVehicles: Number(maxVehicles) || 1,
      concurrentQuota: Number(concurrentQuota) || 0,
      startDate, endDate,
      ownerName: ownerName || '', phone: phone || '',
    });

    if (plateNos && plateNos.length) {
      const maxV = card.maxVehicles;
      if (plateNos.length > maxV) {
        return sendError(res, 400, `绑定车辆数超过限制（最多${maxV}辆）`);
      }
      for (const p of plateNos) {
        await store.addVehicleToCard(card.id, p);
      }
    }

    if (scopeType !== 'ALL_CITY') {
      if (lotIds && lotIds.length) {
        for (const lotId of lotIds) {
          await store.addScopeToCard(card.id, { lotId: Number(lotId) });
        }
      }
      if (districts && districts.length) {
        for (const district of districts) {
          await store.addScopeToCard(card.id, { district });
        }
      }
    }

    await store.createCardTransaction({
      cardId: card.id, transType: 'PURCHASE',
      amountCents: Number(priceCents), days: Number(durationDays) || 30,
      operator: req.user.username, remark: '办理月卡',
    });

    const vehicles = await store.listCardVehicles(card.id);
    const scopes = await store.listCardScopes(card.id);
    return sendData(res, 201, { ...card, vehicles, scopes });
  } catch (e) { return next(e); }
});

router.post('/:id/renew', requireRole('ADMIN', 'OPERATOR'), async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const card = await store.getMonthlyCardById(id);
    if (!card) return sendError(res, 404, '月卡不存在');
    if (card.status !== 'ACTIVE' && card.status !== 'EXPIRED') {
      return sendError(res, 400, '月卡状态不支持续费');
    }

    const { days, priceCents } = req.body || {};
    const renewDays = Number(days) || 30;
    const price = Number(priceCents) || Math.round(card.priceCents * (renewDays / card.durationDays));

    if (renewDays <= 0) return sendError(res, 400, '续费天数不合法');

    const today = new Date();
    const currentEnd = new Date(card.endDate + 'T23:59:59.999');
    const baseDate = currentEnd > today ? currentEnd : today;
    const newEndDate = new Date(baseDate.getTime() + renewDays * 24 * 60 * 60 * 1000);

    const endStr = newEndDate.toISOString().slice(0, 10);
    const updated = await store.updateMonthlyCard(id, {
      endDate: endStr,
      status: 'ACTIVE',
      durationDays: card.durationDays + renewDays,
    });

    await store.createCardTransaction({
      cardId: id, transType: 'RENEW',
      amountCents: price, days: renewDays,
      operator: req.user.username, remark: `续费${renewDays}天`,
    });

    return sendData(res, 200, updated);
  } catch (e) { return next(e); }
});

router.post('/:id/refund', requireRole('ADMIN'), async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const card = await store.getMonthlyCardById(id);
    if (!card) return sendError(res, 404, '月卡不存在');
    if (card.status !== 'ACTIVE') return sendError(res, 400, '只有激活状态的月卡可以退卡');

    const { refundDate } = req.body || {};
    const refundD = refundDate || new Date().toISOString().slice(0, 10);
    const refundInfo = calculateRefund(card, refundD);

    if (refundInfo.refundCents <= 0) {
      return sendError(res, 400, '月卡已使用完毕，无剩余金额可退');
    }

    const totalRefunded = card.refundedCents + refundInfo.refundCents;
    await store.updateMonthlyCard(id, {
      status: 'REFUNDED',
      refundedCents: totalRefunded,
    });

    await store.createCardTransaction({
      cardId: id, transType: 'REFUND',
      amountCents: -refundInfo.refundCents, days: 0,
      operator: req.user.username,
      remark: `退卡退款，已用${refundInfo.usedDays}天，剩余${card.durationDays - refundInfo.usedDays}天`,
    });

    return sendData(res, 200, {
      cardId: id,
      refundCents: refundInfo.refundCents,
      usedDays: refundInfo.usedDays,
      totalDays: refundInfo.totalDays,
      refundDate: refundD,
    });
  } catch (e) { return next(e); }
});

router.put('/:id', requireRole('ADMIN', 'OPERATOR'), async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!(await store.getMonthlyCardById(id))) return sendError(res, 404, '月卡不存在');
    const d = req.body || {};
    const fields = {};
    ['name', 'cardType', 'scopeType', 'priceCents', 'durationDays',
     'maxVehicles', 'concurrentQuota', 'startDate', 'endDate',
     'status', 'ownerName', 'phone'].forEach((k) => {
      if (d[k] !== undefined) fields[k] = d[k];
    });
    if (d.freeSlots !== undefined) fields.freeSlots = d.freeSlots;
    return sendData(res, 200, await store.updateMonthlyCard(id, fields));
  } catch (e) { return next(e); }
});

router.post('/:id/vehicles', requireRole('ADMIN', 'OPERATOR'), async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const card = await store.getMonthlyCardById(id);
    if (!card) return sendError(res, 404, '月卡不存在');

    const { plateNo } = req.body || {};
    if (!plateNo) return sendError(res, 400, '车牌号不能为空');

    const count = await store.countCardVehicles(id);
    if (count >= card.maxVehicles) {
      return sendError(res, 400, `已达最大绑定车辆数（${card.maxVehicles}辆）`);
    }

    const vehicles = await store.addVehicleToCard(id, plateNo);
    return sendData(res, 200, vehicles);
  } catch (e) { return next(e); }
});

router.delete('/:id/vehicles/:plateNo', requireRole('ADMIN', 'OPERATOR'), async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!(await store.getMonthlyCardById(id))) return sendError(res, 404, '月卡不存在');
    const { plateNo } = req.params;
    const vehicles = await store.removeVehicleFromCard(id, plateNo);
    return sendData(res, 200, vehicles);
  } catch (e) { return next(e); }
});

router.get('/:id/vehicles', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!(await store.getMonthlyCardById(id))) return sendError(res, 404, '月卡不存在');
    return sendData(res, 200, await store.listCardVehicles(id));
  } catch (e) { return next(e); }
});

router.get('/:id/scopes', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!(await store.getMonthlyCardById(id))) return sendError(res, 404, '月卡不存在');
    return sendData(res, 200, await store.listCardScopes(id));
  } catch (e) { return next(e); }
});

router.post('/:id/scopes', requireRole('ADMIN', 'OPERATOR'), async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const card = await store.getMonthlyCardById(id);
    if (!card) return sendError(res, 404, '月卡不存在');

    const { lotId, district } = req.body || {};
    if (lotId === undefined && !district) return sendError(res, 400, '必须指定停车场或区域');

    const scopes = await store.addScopeToCard(id, {
      lotId: lotId !== undefined ? Number(lotId) : undefined,
      district,
    });
    return sendData(res, 200, scopes);
  } catch (e) { return next(e); }
});

router.delete('/scopes/:scopeId', requireRole('ADMIN', 'OPERATOR'), async (req, res, next) => {
  try {
    const scopeId = parseId(req.params.scopeId);
    const ok = await store.removeScopeFromCard(scopeId);
    if (!ok) return sendError(res, 404, '适用范围不存在');
    return sendData(res, 200, { id: scopeId });
  } catch (e) { return next(e); }
});

router.get('/:id/transactions', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!(await store.getMonthlyCardById(id))) return sendError(res, 404, '月卡不存在');
    return sendData(res, 200, await store.listCardTransactions(id));
  } catch (e) { return next(e); }
});

router.post('/evaluate', async (req, res, next) => {
  try {
    const { plateNo, lotId, enterTime, exitTime } = req.body || {};
    if (!plateNo || !lotId || !enterTime || !exitTime) {
      return sendError(res, 400, '车牌号、停车场、入场时间、出场时间不能为空');
    }

    const best = await findBestMonthlyCard(plateNo, Number(lotId), enterTime, exitTime);
    if (!best) {
      return sendData(res, 200, { applicable: false, reason: '无可用月卡' });
    }
    return sendData(res, 200, best);
  } catch (e) { return next(e); }
});

module.exports = router;
