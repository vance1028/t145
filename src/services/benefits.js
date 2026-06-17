'use strict';

const store = require('../data/store');

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function parseDate(dateStr) {
  if (dateStr instanceof Date) return new Date(dateStr);
  if (typeof dateStr === 'string') return new Date(dateStr.replace(' ', 'T'));
  return new Date(dateStr);
}

function startOfDay(d) {
  const date = parseDate(d);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function endOfDay(d) {
  const date = parseDate(d);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

function formatDate(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function parseTimeStr(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return { hours: h, minutes: m };
}

function getMinutesOfDay(d) {
  return d.getHours() * 60 + d.getMinutes();
}

function isInFreeSlot(minutesOfDay, slot) {
  const start = parseTimeStr(slot.start);
  const end = parseTimeStr(slot.end);
  const startMin = start.hours * 60 + start.minutes;
  const endMin = end.hours * 60 + end.minutes;

  if (startMin <= endMin) {
    return minutesOfDay >= startMin && minutesOfDay < endMin;
  }
  return minutesOfDay >= startMin || minutesOfDay < endMin;
}

function isSlotSpansMidnight(slot) {
  const start = parseTimeStr(slot.start);
  const end = parseTimeStr(slot.end);
  const startMin = start.hours * 60 + start.minutes;
  const endMin = end.hours * 60 + end.minutes;
  return startMin > endMin;
}

function nextSlotBoundary(minutesOfDay, slot) {
  const start = parseTimeStr(slot.start);
  const end = parseTimeStr(slot.end);
  const startMin = start.hours * 60 + start.minutes;
  const endMin = end.hours * 60 + end.minutes;

  if (startMin <= endMin) {
    if (minutesOfDay < startMin) return startMin;
    if (minutesOfDay < endMin) return endMin;
    return startMin + 24 * 60;
  }
  if (minutesOfDay >= startMin) return endMin + 24 * 60;
  if (minutesOfDay < endMin) return endMin;
  return startMin;
}

function isCardInDate(card, dateTime) {
  const d = parseDate(dateTime);
  const startDate = startOfDay(card.startDate);
  const endDate = endOfDay(card.endDate);
  return d >= startDate && d <= endDate;
}

async function isCardInScope(card, lotId) {
  if (card.scopeType === 'ALL_CITY') return true;

  const scopes = await store.listCardScopes(card.id);
  if (!scopes.length) return false;

  const lot = await store.getLotById(lotId);
  if (!lot) return false;

  if (card.scopeType === 'SINGLE_LOT') {
    return scopes.some((s) => s.lotId === lotId);
  }
  if (card.scopeType === 'DISTRICT') {
    return scopes.some((s) => s.district === lot.district);
  }
  return false;
}

function splitFreeAndPaidSegments(enterTime, exitTime, freeSlots) {
  const enter = parseDate(enterTime);
  const exit = parseDate(exitTime);
  const totalMinutes = Math.max(0, Math.round((exit - enter) / MS_PER_MINUTE));

  if (!freeSlots || !freeSlots.length) {
    return {
      freeMinutes: totalMinutes,
      paidMinutes: 0,
      segments: [
        { type: 'FREE', startTime: formatDate(enter), endTime: formatDate(exit), minutes: totalMinutes },
      ],
    };
  }

  const segments = [];
  let current = new Date(enter);

  while (current < exit) {
    const currentMinOfDay = getMinutesOfDay(current);

    let minNextBoundary = null;
    let currentIsFree = false;

    for (const slot of freeSlots) {
      const boundary = nextSlotBoundary(currentMinOfDay, slot);
      if (minNextBoundary === null || boundary < minNextBoundary) {
        minNextBoundary = boundary;
      }
      if (isInFreeSlot(currentMinOfDay, slot)) {
        currentIsFree = true;
      }
    }

    if (minNextBoundary === null) {
      minNextBoundary = currentMinOfDay + 24 * 60;
    }

    const boundaryDayOffset = Math.floor(minNextBoundary / (24 * 60));
    const boundaryMinInDay = minNextBoundary % (24 * 60);
    const boundaryDate = new Date(
      current.getFullYear(), current.getMonth(), current.getDate(),
      0, boundaryMinInDay, 0, 0,
    );
    boundaryDate.setDate(boundaryDate.getDate() + boundaryDayOffset);

    const segmentEnd = new Date(Math.min(boundaryDate.getTime(), exit.getTime()));
    const minutes = Math.max(0, Math.round((segmentEnd - current) / MS_PER_MINUTE));

    if (minutes > 0) {
      segments.push({
        type: currentIsFree ? 'FREE' : 'PAID',
        startTime: formatDate(current),
        endTime: formatDate(segmentEnd),
        minutes,
      });
    }

    current = segmentEnd;
    if (current.getTime() === exit.getTime()) break;
  }

  const freeMinutes = segments
    .filter((s) => s.type === 'FREE')
    .reduce((sum, s) => sum + s.minutes, 0);
  const paidMinutes = segments
    .filter((s) => s.type === 'PAID')
    .reduce((sum, s) => sum + s.minutes, 0);

  return { freeMinutes, paidMinutes, segments };
}

async function evaluateMonthlyCardForSession(card, lotId, enterTime, exitTime) {
  const result = {
    cardId: card.id,
    cardNo: card.cardNo,
    applicable: false,
    reason: '',
    freeMinutes: 0,
    paidMinutes: 0,
    segments: [],
    concurrentOk: true,
  };

  if (card.status !== 'ACTIVE') {
    result.reason = '月卡未激活';
    return result;
  }

  if (!isCardInDate(card, enterTime) || !isCardInDate(card, exitTime)) {
    result.reason = '不在月卡有效期内';
    return result;
  }

  if (!(await isCardInScope(card, lotId))) {
    result.reason = '当前停车场不在月卡适用范围内';
    return result;
  }

  result.applicable = true;

  const split = splitFreeAndPaidSegments(enterTime, exitTime, card.freeSlots || []);
  result.freeMinutes = split.freeMinutes;
  result.paidMinutes = split.paidMinutes;
  result.segments = split.segments;

  if (card.concurrentQuota > 0) {
    const activeCount = await store.countActiveVehiclesByCard(card.id);
    result.concurrentOk = activeCount < card.concurrentQuota;
    if (!result.concurrentOk) {
      result.reason = `月卡并发配额不足（当前${activeCount}辆，配额${card.concurrentQuota}辆）`;
      result.applicable = false;
      result.freeMinutes = 0;
      result.paidMinutes = split.freeMinutes + split.paidMinutes;
      result.segments = [{
        type: 'PAID', startTime: enterTime, endTime: exitTime,
        minutes: result.paidMinutes,
      }];
    }
  }

  return result;
}

async function findBestMonthlyCard(plateNo, lotId, enterTime, exitTime) {
  const cards = await store.getCardsByPlate(plateNo);
  let best = null;

  for (const card of cards) {
    const evalResult = await evaluateMonthlyCardForSession(card, lotId, enterTime, exitTime);
    if (evalResult.applicable) {
      if (!best || evalResult.freeMinutes > best.freeMinutes) {
        best = evalResult;
      }
    }
  }

  return best;
}

function calculateRefund(card, refundDateStr) {
  const refundDate = parseDate(refundDateStr);
  const startDate = startOfDay(card.startDate);
  const endDate = endOfDay(card.endDate);

  if (refundDate <= startDate) {
    return { refundCents: card.priceCents, usedDays: 0, totalDays: card.durationDays };
  }
  if (refundDate >= endDate) {
    return { refundCents: 0, usedDays: card.durationDays, totalDays: card.durationDays };
  }

  const totalMs = endDate - startDate;
  const usedMs = refundDate - startDate;
  const usedRatio = usedMs / totalMs;

  const refundCents = Math.round(card.priceCents * (1 - usedRatio));
  const usedDays = Math.ceil(usedMs / MS_PER_DAY);

  return {
    refundCents: Math.max(0, refundCents),
    usedDays,
    totalDays: card.durationDays,
    usedRatio: Number(usedRatio.toFixed(4)),
  };
}

function calculateParkingFee(paidMinutes, ratePerHour) {
  if (paidMinutes <= 0) return 0;
  const hours = Math.ceil(paidMinutes / 60);
  return Math.round(hours * ratePerHour * 100);
}

async function deductPackage(packageId, minutes, feeCents) {
  const pkg = await store.getPackageById(packageId);
  if (!pkg || pkg.status !== 'ACTIVE') {
    return { success: false, reason: '套餐不可用' };
  }

  const result = { success: true, deductedMinutes: 0, deductedTimes: 0, deductedCents: 0, remaining: 0 };

  if (pkg.packageType === 'TIMES') {
    if (pkg.remainingTimes <= 0) {
      return { success: false, reason: '套餐次数已用完' };
    }
    await store.updatePackage(packageId, { remainingTimes: pkg.remainingTimes - 1 });
    result.deductedTimes = 1;
    result.remaining = pkg.remainingTimes - 1;
  } else if (pkg.packageType === 'DURATION') {
    if (pkg.remainingMinutes < minutes) {
      return { success: false, reason: '套餐时长不足' };
    }
    await store.updatePackage(packageId, { remainingMinutes: pkg.remainingMinutes - minutes });
    result.deductedMinutes = minutes;
    result.remaining = pkg.remainingMinutes - minutes;
  } else if (pkg.packageType === 'MONEY') {
    if (pkg.remainingAmountCents < feeCents) {
      return { success: false, reason: '套餐余额不足' };
    }
    await store.updatePackage(packageId, { remainingAmountCents: pkg.remainingAmountCents - feeCents });
    result.deductedCents = feeCents;
    result.remaining = pkg.remainingAmountCents - feeCents;
  }

  return result;
}

async function findBestPackage(plateNo, paidMinutes, feeCents) {
  const packages = await store.listPackages({ plateNo, status: 'ACTIVE' });
  let best = null;

  for (const pkg of packages) {
    let applicable = true;
    let savings = 0;

    if (pkg.expiresAt) {
      const now = new Date();
      const expires = parseDate(pkg.expiresAt);
      if (now > expires) continue;
    }

    if (pkg.packageType === 'TIMES') {
      if (pkg.remainingTimes <= 0) applicable = false;
      else savings = feeCents;
    } else if (pkg.packageType === 'DURATION') {
      if (pkg.remainingMinutes < paidMinutes) applicable = false;
      else savings = feeCents;
    } else if (pkg.packageType === 'MONEY') {
      if (pkg.remainingAmountCents < feeCents) applicable = false;
      else savings = feeCents;
    }

    if (applicable && (!best || savings > best.savings)) {
      best = { ...pkg, savings };
    }
  }

  return best;
}

module.exports = {
  isCardInDate,
  isCardInScope,
  splitFreeAndPaidSegments,
  evaluateMonthlyCardForSession,
  findBestMonthlyCard,
  calculateRefund,
  calculateParkingFee,
  deductPackage,
  findBestPackage,
  parseDate,
  formatDate,
};
