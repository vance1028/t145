'use strict';

const express = require('express');
const store = require('../data/store');
const { authRequired, requireRole } = require('../auth');
const { sendData, sendError, parseId } = require('../utils/http');
const { findBestMonthlyCard, findBestPackage, deductPackage, calculateParkingFee } = require('../services/benefits');

const router = express.Router();
router.use(authRequired);

const DEFAULT_RATE = 4;

function toDate(val) {
  if (val instanceof Date) return val;
  if (typeof val === 'string') return new Date(val.replace(' ', 'T'));
  return new Date(val);
}

function calcTotalMinutes(enterTime, exitTime) {
  const enter = toDate(enterTime);
  const exit = toDate(exitTime);
  return Math.max(0, Math.round((exit - enter) / (60 * 1000)));
}

/** GET /api/sessions —— 停车记录列表（lotId / plateNo / status 过滤）。 */
router.get('/', async (req, res, next) => {
  try {
    const { lotId, plateNo, status } = req.query;
    const filter = { plateNo, status };
    if (lotId !== undefined) filter.lotId = Number(lotId);
    return sendData(res, 200, await store.listSessions(filter));
  } catch (e) { return next(e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const s = await store.getSessionById(id);
    if (!s) return sendError(res, 404, '停车记录不存在');
    const deductions = await store.listDeductionRecords({ sessionId: id });
    return sendData(res, 200, { ...s, deductions });
  } catch (e) { return next(e); }
});

/** POST /api/sessions/enter —— 车辆入场，开一条停车记录。入场时校验月卡并发配额。 */
router.post('/enter', requireRole('ADMIN', 'OPERATOR'), async (req, res, next) => {
  try {
    const { lotId, plateNo, spaceId } = req.body || {};
    if (lotId === undefined || !plateNo) return sendError(res, 400, '停车场和车牌号不能为空');
    if (!(await store.getLotById(Number(lotId)))) return sendError(res, 400, '停车场不存在');
    const enterTime = req.body.enterTime || new Date().toISOString().slice(0, 19).replace('T', ' ');
    const s = await store.createSession({ lotId: Number(lotId), plateNo, spaceId: spaceId ?? null, enterTime });
    return sendData(res, 201, s);
  } catch (e) { return next(e); }
});

/** POST /api/sessions/:id/exit —— 车辆出场，自动计算月卡/套餐权益和费用。 */
router.post('/:id/exit', requireRole('ADMIN', 'OPERATOR'), async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const s = await store.getSessionById(id);
    if (!s) return sendError(res, 404, '停车记录不存在');
    if (s.status !== 'PARKED') return sendError(res, 409, '该记录已结束，不能重复出场');

    const exitTime = req.body.exitTime || new Date().toISOString().slice(0, 19).replace('T', ' ');
    const autoBenefits = req.body.autoBenefits === true;
    const ratePerHour = req.body.ratePerHour !== undefined ? Number(req.body.ratePerHour) : DEFAULT_RATE;

    let feeCents = req.body.feeCents ?? 0;
    const benefitDetails = {
      monthlyCard: null,
      package: null,
      segments: [],
      totalMinutes: calcTotalMinutes(s.enterTime, exitTime),
    };

    if (autoBenefits) {
      const cardResult = await findBestMonthlyCard(s.plateNo, s.lotId, s.enterTime, exitTime);
      if (cardResult && cardResult.applicable) {
        benefitDetails.monthlyCard = {
          cardId: cardResult.cardId,
          cardNo: cardResult.cardNo,
          freeMinutes: cardResult.freeMinutes,
          paidMinutes: cardResult.paidMinutes,
        };
        benefitDetails.segments = cardResult.segments;

        const paidMin = cardResult.paidMinutes;
        const paidFee = calculateParkingFee(paidMin, ratePerHour);

        if (paidFee > 0) {
          const pkgResult = await findBestPackage(s.plateNo, paidMin, paidFee);
          if (pkgResult) {
            const deductRes = await deductPackage(pkgResult.id, paidMin, paidFee);
            if (deductRes.success) {
              benefitDetails.package = {
                packageId: pkgResult.id,
                packageNo: pkgResult.packageNo,
                packageType: pkgResult.packageType,
                deductedMinutes: deductRes.deductedMinutes,
                deductedTimes: deductRes.deductedTimes,
                deductedCents: deductRes.deductedCents,
                remaining: deductRes.remaining,
              };
              feeCents = 0;

              await store.createDeductionRecord({
                sessionId: id, plateNo: s.plateNo,
                sourceType: 'PACKAGE', sourceId: pkgResult.id,
                freeMinutes: cardResult.freeMinutes,
                deductedMinutes: deductRes.deductedMinutes,
                deductedTimes: deductRes.deductedTimes,
                deductedCents: deductRes.deductedCents,
                paidCents: 0,
                breakdown: { segments: cardResult.segments, packageType: pkgResult.packageType },
              });
            } else {
              feeCents = paidFee;
            }
          } else {
            feeCents = paidFee;
          }
        } else {
          feeCents = 0;
        }

        await store.createDeductionRecord({
          sessionId: id, plateNo: s.plateNo,
          sourceType: 'MONTHLY_CARD', sourceId: cardResult.cardId,
          freeMinutes: cardResult.freeMinutes,
          deductedMinutes: 0,
          deductedTimes: 0,
          deductedCents: 0,
          paidCents: feeCents,
          breakdown: {
            segments: cardResult.segments,
            ratePerHour,
            totalFee: feeCents,
          },
        });
      } else {
        const totalMin = calcTotalMinutes(s.enterTime, exitTime);
        benefitDetails.segments = [
          { type: 'PAID', startTime: s.enterTime, endTime: exitTime, minutes: totalMin },
        ];
        feeCents = calculateParkingFee(totalMin, ratePerHour);

        if (feeCents > 0) {
          const pkgResult = await findBestPackage(s.plateNo, totalMin, feeCents);
          if (pkgResult) {
            const deductRes = await deductPackage(pkgResult.id, totalMin, feeCents);
            if (deductRes.success) {
              benefitDetails.package = {
                packageId: pkgResult.id,
                packageNo: pkgResult.packageNo,
                packageType: pkgResult.packageType,
                deductedMinutes: deductRes.deductedMinutes,
                deductedTimes: deductRes.deductedTimes,
                deductedCents: deductRes.deductedCents,
                remaining: deductRes.remaining,
              };
              feeCents = 0;

              await store.createDeductionRecord({
                sessionId: id, plateNo: s.plateNo,
                sourceType: 'PACKAGE', sourceId: pkgResult.id,
                deductedMinutes: deductRes.deductedMinutes,
                deductedTimes: deductRes.deductedTimes,
                deductedCents: deductRes.deductedCents,
                paidCents: 0,
                breakdown: { packageType: pkgResult.packageType, originalFee: req.body.feeCents },
              });
            }
          }
        }
      }
    }

    const updated = await store.updateSession(id, { exitTime, feeCents, status: 'FINISHED' });
    return sendData(res, 200, { ...updated, benefitDetails });
  } catch (e) { return next(e); }
});

module.exports = router;
