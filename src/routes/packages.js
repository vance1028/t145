'use strict';

const express = require('express');
const store = require('../data/store');
const { authRequired, requireRole } = require('../auth');
const { sendData, sendError, parseId } = require('../utils/http');
const { deductPackage } = require('../services/benefits');

const router = express.Router();
router.use(authRequired);

function generatePackageNo() {
  const now = new Date();
  const ts = now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0') +
    String(now.getHours()).padStart(2, '0') +
    String(now.getMinutes()).padStart(2, '0') +
    String(now.getSeconds()).padStart(2, '0') +
    String(Math.floor(Math.random() * 1000)).padStart(3, '0');
  return 'PK' + ts;
}

router.get('/', async (req, res, next) => {
  try {
    const { plateNo, status, packageType } = req.query;
    const filter = {};
    if (plateNo) filter.plateNo = plateNo;
    if (status) filter.status = status;
    if (packageType) filter.packageType = packageType;
    return sendData(res, 200, await store.listPackages(filter));
  } catch (e) { return next(e); }
});

router.get('/deductions', async (req, res, next) => {
  try {
    const { plateNo, sessionId, sourceType, sourceId } = req.query;
    const filter = {};
    if (plateNo) filter.plateNo = plateNo;
    if (sessionId !== undefined) filter.sessionId = Number(sessionId);
    if (sourceType) filter.sourceType = sourceType;
    if (sourceId !== undefined) filter.sourceId = Number(sourceId);
    return sendData(res, 200, await store.listDeductionRecords(filter));
  } catch (e) { return next(e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const pkg = await store.getPackageById(id);
    if (!pkg) return sendError(res, 404, '套餐不存在');
    return sendData(res, 200, pkg);
  } catch (e) { return next(e); }
});

router.post('/', requireRole('ADMIN', 'OPERATOR'), async (req, res, next) => {
  try {
    const body = req.body || {};
    const {
      name, packageType, plateNo,
      totalAmountCents, totalTimes, totalMinutes,
      expiresAt,
    } = body;

    if (!plateNo) return sendError(res, 400, '车牌号不能为空');
    if (!packageType || !['TIMES', 'DURATION', 'MONEY'].includes(packageType)) {
      return sendError(res, 400, '套餐类型不合法');
    }

    const packageNo = body.packageNo || generatePackageNo();
    if (await store.getPackageByNo(packageNo)) return sendError(res, 409, '套餐编号已存在');

    const purchasedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');

    const pkg = await store.createPackage({
      packageNo, name: name || '', packageType, plateNo,
      totalAmountCents: Number(totalAmountCents) || 0,
      totalTimes: Number(totalTimes) || 0,
      totalMinutes: Number(totalMinutes) || 0,
      purchasedAt,
      expiresAt: expiresAt || null,
    });

    return sendData(res, 201, pkg);
  } catch (e) { return next(e); }
});

router.put('/:id', requireRole('ADMIN', 'OPERATOR'), async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!(await store.getPackageById(id))) return sendError(res, 404, '套餐不存在');
    const d = req.body || {};
    const fields = {};
    ['name', 'status', 'expiresAt'].forEach((k) => {
      if (d[k] !== undefined) fields[k] = d[k];
    });
    if (d.remainingAmountCents !== undefined) fields.remainingAmountCents = d.remainingAmountCents;
    if (d.remainingTimes !== undefined) fields.remainingTimes = d.remainingTimes;
    if (d.remainingMinutes !== undefined) fields.remainingMinutes = d.remainingMinutes;
    return sendData(res, 200, await store.updatePackage(id, fields));
  } catch (e) { return next(e); }
});

router.post('/:id/deduct', requireRole('ADMIN', 'OPERATOR'), async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const pkg = await store.getPackageById(id);
    if (!pkg) return sendError(res, 404, '套餐不存在');
    if (pkg.status !== 'ACTIVE') return sendError(res, 400, '套餐不可用');

    const { minutes, feeCents } = req.body || {};
    const mins = Number(minutes) || 0;
    const cents = Number(feeCents) || 0;

    const result = await deductPackage(id, mins, cents);
    if (!result.success) {
      return sendError(res, 400, result.reason);
    }
    return sendData(res, 200, result);
  } catch (e) { return next(e); }
});

module.exports = router;
