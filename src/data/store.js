'use strict';

const { getPool } = require('../db');
const { hashPassword } = require('../utils/password');

/**
 * 数据仓储层：所有 SQL 集中在这里，路由层只调用这些 async 方法。
 * 对外返回 camelCase 字段对象。
 */

/* ----------------------------- 映射 ----------------------------- */

function mapUser(r) {
  if (!r) return null;
  return {
    id: r.id, username: r.username, name: r.name, role: r.role,
    status: r.status, createdAt: r.created_at,
  };
}
function mapUserWithHash(r) {
  if (!r) return null;
  return { ...mapUser(r), passwordHash: r.password_hash };
}
function mapLot(r) {
  if (!r) return null;
  return {
    id: r.id, code: r.code, name: r.name, district: r.district, address: r.address,
    totalSpaces: r.total_spaces, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
function mapSpace(r) {
  if (!r) return null;
  return {
    id: r.id, lotId: r.lot_id, code: r.code, type: r.type, status: r.status,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
function mapVehicle(r) {
  if (!r) return null;
  return {
    id: r.id, plateNo: r.plate_no, ownerName: r.owner_name, phone: r.phone,
    vehicleType: r.vehicle_type, isMember: !!r.is_member, createdAt: r.created_at,
  };
}
function mapSession(r) {
  if (!r) return null;
  return {
    id: r.id, lotId: r.lot_id, spaceId: r.space_id, plateNo: r.plate_no,
    enterTime: r.enter_time, exitTime: r.exit_time, feeCents: r.fee_cents,
    status: r.status, paid: !!r.paid, createdAt: r.created_at,
  };
}

/* ----------------------------- 用户 ----------------------------- */

async function getUserByUsername(username) {
  const [rows] = await getPool().query('SELECT * FROM users WHERE username = ?', [username]);
  return mapUserWithHash(rows[0]);
}
async function getUserById(id) {
  const [rows] = await getPool().query('SELECT * FROM users WHERE id = ?', [id]);
  return mapUser(rows[0]);
}
async function listUsers() {
  const [rows] = await getPool().query('SELECT * FROM users ORDER BY id');
  return rows.map(mapUser);
}
async function createUser({ username, password, name, role = 'VIEWER', status = 'ACTIVE' }) {
  const [r] = await getPool().query(
    'INSERT INTO users (username, password_hash, name, role, status) VALUES (?, ?, ?, ?, ?)',
    [username, hashPassword(password), name, role, status],
  );
  return getUserById(r.insertId);
}
async function updateUser(id, fields) {
  const map = { name: 'name', role: 'role', status: 'status' };
  const sets = []; const params = [];
  for (const [k, col] of Object.entries(map)) {
    if (fields[k] !== undefined) { sets.push(`${col} = ?`); params.push(fields[k]); }
  }
  if (fields.password !== undefined) { sets.push('password_hash = ?'); params.push(hashPassword(fields.password)); }
  if (sets.length) { params.push(id); await getPool().query(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, params); }
  return getUserById(id);
}
async function deleteUser(id) {
  const [r] = await getPool().query('DELETE FROM users WHERE id = ?', [id]);
  return r.affectedRows > 0;
}
async function countUsers() {
  const [rows] = await getPool().query('SELECT COUNT(*) AS n FROM users');
  return rows[0].n;
}

/* ----------------------------- 停车场 ----------------------------- */

async function listLots({ district, status, keyword } = {}) {
  const where = []; const params = [];
  if (district) { where.push('district = ?'); params.push(district); }
  if (status) { where.push('status = ?'); params.push(status); }
  if (keyword) { where.push('(code LIKE ? OR name LIKE ? OR address LIKE ?)'); const k = `%${keyword}%`; params.push(k, k, k); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows] = await getPool().query(`SELECT * FROM parking_lots ${clause} ORDER BY id DESC`, params);
  return rows.map(mapLot);
}
async function getLotById(id) {
  const [rows] = await getPool().query('SELECT * FROM parking_lots WHERE id = ?', [id]);
  return mapLot(rows[0]);
}
async function getLotByCode(code) {
  const [rows] = await getPool().query('SELECT * FROM parking_lots WHERE code = ?', [code]);
  return mapLot(rows[0]);
}
async function createLot(d) {
  const [r] = await getPool().query(
    `INSERT INTO parking_lots (code, name, district, address, total_spaces, status)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [d.code, d.name, d.district, d.address || '', d.totalSpaces || 0, d.status || 'OPEN'],
  );
  return getLotById(r.insertId);
}
async function updateLot(id, d) {
  const map = { name: 'name', district: 'district', address: 'address', totalSpaces: 'total_spaces', status: 'status' };
  const sets = []; const params = [];
  for (const [k, col] of Object.entries(map)) {
    if (d[k] !== undefined) { sets.push(`${col} = ?`); params.push(d[k]); }
  }
  if (sets.length) {
    sets.push('updated_at = CURRENT_TIMESTAMP(3)');
    params.push(id);
    await getPool().query(`UPDATE parking_lots SET ${sets.join(', ')} WHERE id = ?`, params);
  }
  return getLotById(id);
}
async function deleteLot(id) {
  const [r] = await getPool().query('DELETE FROM parking_lots WHERE id = ?', [id]);
  return r.affectedRows > 0;
}

/* ----------------------------- 车位 ----------------------------- */

async function listSpaces({ lotId, status, type } = {}) {
  const where = []; const params = [];
  if (lotId !== undefined) { where.push('lot_id = ?'); params.push(lotId); }
  if (status) { where.push('status = ?'); params.push(status); }
  if (type) { where.push('type = ?'); params.push(type); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows] = await getPool().query(`SELECT * FROM parking_spaces ${clause} ORDER BY id`, params);
  return rows.map(mapSpace);
}
async function getSpaceById(id) {
  const [rows] = await getPool().query('SELECT * FROM parking_spaces WHERE id = ?', [id]);
  return mapSpace(rows[0]);
}
async function getSpaceByCode(lotId, code) {
  const [rows] = await getPool().query('SELECT * FROM parking_spaces WHERE lot_id = ? AND code = ?', [lotId, code]);
  return mapSpace(rows[0]);
}
async function createSpace(d) {
  const [r] = await getPool().query(
    'INSERT INTO parking_spaces (lot_id, code, type, status) VALUES (?, ?, ?, ?)',
    [d.lotId, d.code, d.type || 'STANDARD', d.status || 'FREE'],
  );
  return getSpaceById(r.insertId);
}
async function updateSpace(id, d) {
  const map = { type: 'type', status: 'status' };
  const sets = []; const params = [];
  for (const [k, col] of Object.entries(map)) {
    if (d[k] !== undefined) { sets.push(`${col} = ?`); params.push(d[k]); }
  }
  if (sets.length) {
    sets.push('updated_at = CURRENT_TIMESTAMP(3)');
    params.push(id);
    await getPool().query(`UPDATE parking_spaces SET ${sets.join(', ')} WHERE id = ?`, params);
  }
  return getSpaceById(id);
}
async function deleteSpace(id) {
  const [r] = await getPool().query('DELETE FROM parking_spaces WHERE id = ?', [id]);
  return r.affectedRows > 0;
}

/* ----------------------------- 车辆 ----------------------------- */

async function listVehicles({ keyword, isMember } = {}) {
  const where = []; const params = [];
  if (keyword) { where.push('(plate_no LIKE ? OR owner_name LIKE ?)'); const k = `%${keyword}%`; params.push(k, k); }
  if (isMember !== undefined) { where.push('is_member = ?'); params.push(isMember ? 1 : 0); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows] = await getPool().query(`SELECT * FROM vehicles ${clause} ORDER BY id DESC`, params);
  return rows.map(mapVehicle);
}
async function getVehicleById(id) {
  const [rows] = await getPool().query('SELECT * FROM vehicles WHERE id = ?', [id]);
  return mapVehicle(rows[0]);
}
async function getVehicleByPlate(plateNo) {
  const [rows] = await getPool().query('SELECT * FROM vehicles WHERE plate_no = ?', [plateNo]);
  return mapVehicle(rows[0]);
}
async function createVehicle(d) {
  const [r] = await getPool().query(
    'INSERT INTO vehicles (plate_no, owner_name, phone, vehicle_type, is_member) VALUES (?, ?, ?, ?, ?)',
    [d.plateNo, d.ownerName || '', d.phone || '', d.vehicleType || 'SMALL', d.isMember ? 1 : 0],
  );
  return getVehicleById(r.insertId);
}
async function updateVehicle(id, d) {
  const map = { ownerName: 'owner_name', phone: 'phone', vehicleType: 'vehicle_type' };
  const sets = []; const params = [];
  for (const [k, col] of Object.entries(map)) {
    if (d[k] !== undefined) { sets.push(`${col} = ?`); params.push(d[k]); }
  }
  if (d.isMember !== undefined) { sets.push('is_member = ?'); params.push(d.isMember ? 1 : 0); }
  if (sets.length) { params.push(id); await getPool().query(`UPDATE vehicles SET ${sets.join(', ')} WHERE id = ?`, params); }
  return getVehicleById(id);
}
async function deleteVehicle(id) {
  const [r] = await getPool().query('DELETE FROM vehicles WHERE id = ?', [id]);
  return r.affectedRows > 0;
}

/* ----------------------------- 停车记录 ----------------------------- */

async function listSessions({ lotId, plateNo, status } = {}) {
  const where = []; const params = [];
  if (lotId !== undefined) { where.push('lot_id = ?'); params.push(lotId); }
  if (plateNo) { where.push('plate_no = ?'); params.push(plateNo); }
  if (status) { where.push('status = ?'); params.push(status); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows] = await getPool().query(`SELECT * FROM parking_sessions ${clause} ORDER BY id DESC`, params);
  return rows.map(mapSession);
}
async function getSessionById(id) {
  const [rows] = await getPool().query('SELECT * FROM parking_sessions WHERE id = ?', [id]);
  return mapSession(rows[0]);
}
async function createSession(d) {
  const [r] = await getPool().query(
    `INSERT INTO parking_sessions (lot_id, space_id, plate_no, enter_time, status)
     VALUES (?, ?, ?, ?, ?)`,
    [d.lotId, d.spaceId ?? null, d.plateNo, d.enterTime, d.status || 'PARKED'],
  );
  return getSessionById(r.insertId);
}
async function updateSession(id, d) {
  const map = { spaceId: 'space_id', exitTime: 'exit_time', feeCents: 'fee_cents', status: 'status' };
  const sets = []; const params = [];
  for (const [k, col] of Object.entries(map)) {
    if (d[k] !== undefined) { sets.push(`${col} = ?`); params.push(d[k]); }
  }
  if (d.paid !== undefined) { sets.push('paid = ?'); params.push(d.paid ? 1 : 0); }
  if (sets.length) { params.push(id); await getPool().query(`UPDATE parking_sessions SET ${sets.join(', ')} WHERE id = ?`, params); }
  return getSessionById(id);
}

/* ----------------------------- 月卡 ----------------------------- */

function mapMonthlyCard(r) {
  if (!r) return null;
  return {
    id: r.id, cardNo: r.card_no, name: r.name, cardType: r.card_type,
    scopeType: r.scope_type, priceCents: r.price_cents, durationDays: r.duration_days,
    freeSlots: r.free_slots ? JSON.parse(r.free_slots) : null,
    maxVehicles: r.max_vehicles, concurrentQuota: r.concurrent_quota,
    startDate: r.start_date, endDate: r.end_date, status: r.status,
    ownerName: r.owner_name, phone: r.phone, refundedCents: r.refunded_cents,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
function mapCardVehicle(r) {
  if (!r) return null;
  return { id: r.id, cardId: r.card_id, plateNo: r.plate_no, createdAt: r.created_at };
}
function mapCardScope(r) {
  if (!r) return null;
  return { id: r.id, cardId: r.card_id, lotId: r.lot_id, district: r.district, createdAt: r.created_at };
}
function mapCardTransaction(r) {
  if (!r) return null;
  return {
    id: r.id, cardId: r.card_id, transType: r.trans_type,
    amountCents: r.amount_cents, days: r.days,
    operator: r.operator, remark: r.remark, createdAt: r.created_at,
  };
}

async function getMonthlyCardById(id) {
  const [rows] = await getPool().query('SELECT * FROM monthly_cards WHERE id = ?', [id]);
  return mapMonthlyCard(rows[0]);
}
async function getMonthlyCardByNo(cardNo) {
  const [rows] = await getPool().query('SELECT * FROM monthly_cards WHERE card_no = ?', [cardNo]);
  return mapMonthlyCard(rows[0]);
}
async function listMonthlyCards({ status, plateNo, keyword } = {}) {
  const where = []; const params = [];
  if (status) { where.push('mc.status = ?'); params.push(status); }
  if (keyword) {
    where.push('(mc.card_no LIKE ? OR mc.name LIKE ? OR mc.owner_name LIKE ?)');
    const k = `%${keyword}%`; params.push(k, k, k);
  }
  let join = '';
  if (plateNo) {
    join = 'INNER JOIN monthly_card_vehicles mcv ON mc.id = mcv.card_id';
    where.push('mcv.plate_no = ?'); params.push(plateNo);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows] = await getPool().query(
    `SELECT DISTINCT mc.* FROM monthly_cards mc ${join} ${clause} ORDER BY mc.id DESC`,
    params,
  );
  return rows.map(mapMonthlyCard);
}
async function createMonthlyCard(d) {
  const [r] = await getPool().query(
    `INSERT INTO monthly_cards
     (card_no, name, card_type, scope_type, price_cents, duration_days,
      free_slots, max_vehicles, concurrent_quota, start_date, end_date,
      status, owner_name, phone)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      d.cardNo, d.name || '', d.cardType || 'STANDARD', d.scopeType || 'SINGLE_LOT',
      d.priceCents || 0, d.durationDays || 30,
      d.freeSlots ? JSON.stringify(d.freeSlots) : null,
      d.maxVehicles || 1, d.concurrentQuota || 0,
      d.startDate, d.endDate,
      d.status || 'ACTIVE', d.ownerName || '', d.phone || '',
    ],
  );
  return getMonthlyCardById(r.insertId);
}
async function updateMonthlyCard(id, d) {
  const map = {
    name: 'name', cardType: 'card_type', scopeType: 'scope_type',
    priceCents: 'price_cents', durationDays: 'duration_days',
    maxVehicles: 'max_vehicles', concurrentQuota: 'concurrent_quota',
    startDate: 'start_date', endDate: 'end_date', status: 'status',
    ownerName: 'owner_name', phone: 'phone', refundedCents: 'refunded_cents',
  };
  const sets = []; const params = [];
  for (const [k, col] of Object.entries(map)) {
    if (d[k] !== undefined) { sets.push(`${col} = ?`); params.push(d[k]); }
  }
  if (d.freeSlots !== undefined) {
    sets.push('free_slots = ?');
    params.push(d.freeSlots ? JSON.stringify(d.freeSlots) : null);
  }
  if (sets.length) {
    sets.push('updated_at = CURRENT_TIMESTAMP(3)');
    params.push(id);
    await getPool().query(`UPDATE monthly_cards SET ${sets.join(', ')} WHERE id = ?`, params);
  }
  return getMonthlyCardById(id);
}

async function listCardVehicles(cardId) {
  const [rows] = await getPool().query(
    'SELECT * FROM monthly_card_vehicles WHERE card_id = ? ORDER BY id',
    [cardId],
  );
  return rows.map(mapCardVehicle);
}
async function getCardsByPlate(plateNo) {
  const [rows] = await getPool().query(
    `SELECT mc.* FROM monthly_cards mc
     INNER JOIN monthly_card_vehicles mcv ON mc.id = mcv.card_id
     WHERE mcv.plate_no = ? AND mc.status = 'ACTIVE'
     ORDER BY mc.id`,
    [plateNo],
  );
  return rows.map(mapMonthlyCard);
}
async function addVehicleToCard(cardId, plateNo) {
  await getPool().query(
    'INSERT IGNORE INTO monthly_card_vehicles (card_id, plate_no) VALUES (?, ?)',
    [cardId, plateNo],
  );
  return listCardVehicles(cardId);
}
async function removeVehicleFromCard(cardId, plateNo) {
  await getPool().query(
    'DELETE FROM monthly_card_vehicles WHERE card_id = ? AND plate_no = ?',
    [cardId, plateNo],
  );
  return listCardVehicles(cardId);
}
async function countCardVehicles(cardId) {
  const [rows] = await getPool().query(
    'SELECT COUNT(*) AS n FROM monthly_card_vehicles WHERE card_id = ?',
    [cardId],
  );
  return rows[0].n;
}

async function listCardScopes(cardId) {
  const [rows] = await getPool().query(
    'SELECT * FROM monthly_card_scopes WHERE card_id = ? ORDER BY id',
    [cardId],
  );
  return rows.map(mapCardScope);
}
async function addScopeToCard(cardId, { lotId, district }) {
  await getPool().query(
    'INSERT INTO monthly_card_scopes (card_id, lot_id, district) VALUES (?, ?, ?)',
    [cardId, lotId ?? null, district ?? null],
  );
  return listCardScopes(cardId);
}
async function removeScopeFromCard(scopeId) {
  const [r] = await getPool().query('DELETE FROM monthly_card_scopes WHERE id = ?', [scopeId]);
  return r.affectedRows > 0;
}
async function clearCardScopes(cardId) {
  await getPool().query('DELETE FROM monthly_card_scopes WHERE card_id = ?', [cardId]);
}

async function listCardTransactions(cardId) {
  const [rows] = await getPool().query(
    'SELECT * FROM monthly_card_transactions WHERE card_id = ? ORDER BY id DESC',
    [cardId],
  );
  return rows.map(mapCardTransaction);
}
async function createCardTransaction(d) {
  const [r] = await getPool().query(
    `INSERT INTO monthly_card_transactions
     (card_id, trans_type, amount_cents, days, operator, remark)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [d.cardId, d.transType, d.amountCents || 0, d.days || 0, d.operator || '', d.remark || ''],
  );
  const [rows] = await getPool().query(
    'SELECT * FROM monthly_card_transactions WHERE id = ?', [r.insertId],
  );
  return mapCardTransaction(rows[0]);
}

async function countActiveVehiclesByCard(cardId) {
  const [rows] = await getPool().query(
    `SELECT COUNT(DISTINCT ps.plate_no) AS n
     FROM parking_sessions ps
     INNER JOIN monthly_card_vehicles mcv ON ps.plate_no = mcv.plate_no
     WHERE mcv.card_id = ? AND ps.status = 'PARKED'`,
    [cardId],
  );
  return rows[0].n;
}

/* ----------------------------- 套餐 ----------------------------- */

function mapPackage(r) {
  if (!r) return null;
  return {
    id: r.id, packageNo: r.package_no, name: r.name, packageType: r.package_type,
    plateNo: r.plate_no,
    totalAmountCents: r.total_amount_cents, remainingAmountCents: r.remaining_amount_cents,
    totalTimes: r.total_times, remainingTimes: r.remaining_times,
    totalMinutes: r.total_minutes, remainingMinutes: r.remaining_minutes,
    purchasedAt: r.purchased_at, expiresAt: r.expires_at, status: r.status,
    createdAt: r.created_at,
  };
}

async function getPackageById(id) {
  const [rows] = await getPool().query('SELECT * FROM packages WHERE id = ?', [id]);
  return mapPackage(rows[0]);
}
async function getPackageByNo(packageNo) {
  const [rows] = await getPool().query('SELECT * FROM packages WHERE package_no = ?', [packageNo]);
  return mapPackage(rows[0]);
}
async function listPackages({ plateNo, status, packageType } = {}) {
  const where = []; const params = [];
  if (plateNo) { where.push('plate_no = ?'); params.push(plateNo); }
  if (status) { where.push('status = ?'); params.push(status); }
  if (packageType) { where.push('package_type = ?'); params.push(packageType); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows] = await getPool().query(
    `SELECT * FROM packages ${clause} ORDER BY id DESC`, params,
  );
  return rows.map(mapPackage);
}
async function createPackage(d) {
  const [r] = await getPool().query(
    `INSERT INTO packages
     (package_no, name, package_type, plate_no,
      total_amount_cents, remaining_amount_cents,
      total_times, remaining_times, total_minutes, remaining_minutes,
      purchased_at, expires_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      d.packageNo, d.name || '', d.packageType || 'TIMES', d.plateNo,
      d.totalAmountCents || 0, d.remainingAmountCents ?? d.totalAmountCents ?? 0,
      d.totalTimes || 0, d.remainingTimes ?? d.totalTimes ?? 0,
      d.totalMinutes || 0, d.remainingMinutes ?? d.totalMinutes ?? 0,
      d.purchasedAt, d.expiresAt ?? null, d.status || 'ACTIVE',
    ],
  );
  return getPackageById(r.insertId);
}
async function updatePackage(id, d) {
  const map = {
    name: 'name', status: 'status',
    remainingAmountCents: 'remaining_amount_cents',
    remainingTimes: 'remaining_times',
    remainingMinutes: 'remaining_minutes',
    expiresAt: 'expires_at',
  };
  const sets = []; const params = [];
  for (const [k, col] of Object.entries(map)) {
    if (d[k] !== undefined) { sets.push(`${col} = ?`); params.push(d[k]); }
  }
  if (sets.length) { params.push(id); await getPool().query(`UPDATE packages SET ${sets.join(', ')} WHERE id = ?`, params); }
  return getPackageById(id);
}

/* ----------------------------- 抵扣流水 ----------------------------- */

function mapDeductionRecord(r) {
  if (!r) return null;
  return {
    id: r.id, sessionId: r.session_id, plateNo: r.plate_no,
    sourceType: r.source_type, sourceId: r.source_id,
    freeMinutes: r.free_minutes,
    deductedMinutes: r.deducted_minutes, deductedTimes: r.deducted_times,
    deductedCents: r.deducted_cents, paidCents: r.paid_cents,
    breakdown: r.breakdown ? JSON.parse(r.breakdown) : null,
    createdAt: r.created_at,
  };
}

async function createDeductionRecord(d) {
  const [r] = await getPool().query(
    `INSERT INTO deduction_records
     (session_id, plate_no, source_type, source_id,
      free_minutes, deducted_minutes, deducted_times, deducted_cents,
      paid_cents, breakdown)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      d.sessionId ?? null, d.plateNo, d.sourceType, d.sourceId,
      d.freeMinutes || 0, d.deductedMinutes || 0, d.deductedTimes || 0,
      d.deductedCents || 0, d.paidCents || 0,
      d.breakdown ? JSON.stringify(d.breakdown) : null,
    ],
  );
  const [rows] = await getPool().query('SELECT * FROM deduction_records WHERE id = ?', [r.insertId]);
  return mapDeductionRecord(rows[0]);
}
async function listDeductionRecords({ plateNo, sessionId, sourceType, sourceId } = {}) {
  const where = []; const params = [];
  if (plateNo) { where.push('plate_no = ?'); params.push(plateNo); }
  if (sessionId !== undefined) { where.push('session_id = ?'); params.push(sessionId); }
  if (sourceType) { where.push('source_type = ?'); params.push(sourceType); }
  if (sourceId !== undefined) { where.push('source_id = ?'); params.push(sourceId); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows] = await getPool().query(
    `SELECT * FROM deduction_records ${clause} ORDER BY id DESC`, params,
  );
  return rows.map(mapDeductionRecord);
}

module.exports = {
  mapUser, mapLot, mapSpace, mapVehicle, mapSession,
  mapMonthlyCard, mapCardVehicle, mapCardScope, mapCardTransaction,
  mapPackage, mapDeductionRecord,
  getUserByUsername, getUserById, listUsers, createUser, updateUser, deleteUser, countUsers,
  listLots, getLotById, getLotByCode, createLot, updateLot, deleteLot,
  listSpaces, getSpaceById, getSpaceByCode, createSpace, updateSpace, deleteSpace,
  listVehicles, getVehicleById, getVehicleByPlate, createVehicle, updateVehicle, deleteVehicle,
  listSessions, getSessionById, createSession, updateSession,
  getMonthlyCardById, getMonthlyCardByNo, listMonthlyCards, createMonthlyCard, updateMonthlyCard,
  listCardVehicles, getCardsByPlate, addVehicleToCard, removeVehicleFromCard, countCardVehicles,
  listCardScopes, addScopeToCard, removeScopeFromCard, clearCardScopes,
  listCardTransactions, createCardTransaction, countActiveVehiclesByCard,
  getPackageById, getPackageByNo, listPackages, createPackage, updatePackage,
  createDeductionRecord, listDeductionRecords,
};
