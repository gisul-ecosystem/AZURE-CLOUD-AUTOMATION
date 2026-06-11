const {
  resolveScheduleForRequest,
  getCalendarDateInTimezone,
  isWithinAnySlot,
  getTodayLimitMinutes,
  getActiveSlot,
  slotEndDate,
  findNextAccessWindow,
  getScheduleSummary,
  formatSlotLabel,
  DAY_LABELS
} = require('../utils/usageSchedule');

function buildAccessMessage(evaluation) {
  if (evaluation.allowed) {
    return 'Access allowed.';
  }

  switch (evaluation.reason) {
    case 'day_disabled':
      return `Access is not allowed on ${evaluation.scheduleSummary?.dayLabel || 'this day'}.`;
    case 'outside_window': {
      const nextWindow = evaluation.scheduleSummary?.nextWindow;
      if (nextWindow?.at) {
        return `Access is only allowed during scheduled hours. Access opens at ${nextWindow.at.toISOString()}.`;
      }
      return 'Access is only allowed during scheduled hours.';
    }
    case 'limit_exceeded':
      return `Daily usage limit reached (${evaluation.usedMinutes}/${evaluation.limitMinutes} minutes).`;
    case 'blocked':
      return `Access is blocked until ${evaluation.blockedUntil?.toISOString?.() || 'the next allowed window'}.`;
    default:
      return 'Access is not allowed.';
  }
}

function evaluateUsageAccess({
  request,
  user,
  currentSessionMinutes = 0,
  at = new Date()
}) {
  if (!request?.enable_daily_usage) {
    return {
      allowed: true,
      reason: 'not_enabled',
      dailyUsageEnabled: false,
      usedMinutes: 0,
      limitMinutes: null,
      remainingMinutes: null,
      withinWindow: true,
      scheduleSummary: null,
      blockedUntil: null,
      message: 'Daily usage limits are not enabled.'
    };
  }

  const schedule = resolveScheduleForRequest(request);

  if (!schedule) {
    return {
      allowed: false,
      reason: 'invalid_schedule',
      dailyUsageEnabled: true,
      usedMinutes: 0,
      limitMinutes: 0,
      remainingMinutes: 0,
      withinWindow: false,
      scheduleSummary: null,
      blockedUntil: null,
      message: 'Usage schedule is not configured.'
    };
  }

  const scheduleSummary = getScheduleSummary(schedule, at);
  const calendarDate = getCalendarDateInTimezone(schedule.timezone, at);
  const lastResetDate = user?.last_reset_date
    ? new Date(user.last_reset_date).toISOString().split('T')[0]
    : null;

  let usedMinutes = Number(user?.used_today_minutes || 0);
  let blockedUntil = user?.blocked_until ? new Date(user.blocked_until) : null;
  const needsDailyReset = lastResetDate !== calendarDate;

  if (needsDailyReset) {
    usedMinutes = 0;
    blockedUntil = null;
  }

  const liveUsedMinutes = usedMinutes + Number(currentSessionMinutes || 0);
  const limitMinutes = getTodayLimitMinutes(schedule, at);
  const withinWindow = isWithinAnySlot(schedule, at);
  const activeSlot = getActiveSlot(schedule, at);

  if (blockedUntil && at < blockedUntil) {
    return {
      allowed: false,
      reason: 'blocked',
      dailyUsageEnabled: true,
      schedule,
      scheduleSummary,
      usedMinutes: liveUsedMinutes,
      storedUsedMinutes: usedMinutes,
      currentSessionMinutes,
      limitMinutes,
      remainingMinutes: Math.max(0, limitMinutes - liveUsedMinutes),
      withinWindow,
      activeSlot,
      blockedUntil,
      needsDailyReset,
      calendarDate,
      message: buildAccessMessage({ reason: 'blocked', blockedUntil, scheduleSummary })
    };
  }

  if (!scheduleSummary.dayEnabled) {
    const nextWindow = findNextAccessWindow(schedule, at);
    return {
      allowed: false,
      reason: 'day_disabled',
      dailyUsageEnabled: true,
      schedule,
      scheduleSummary: { ...scheduleSummary, nextWindow },
      usedMinutes: liveUsedMinutes,
      storedUsedMinutes: usedMinutes,
      currentSessionMinutes,
      limitMinutes,
      remainingMinutes: 0,
      withinWindow: false,
      activeSlot: null,
      blockedUntil: nextWindow?.at || null,
      needsDailyReset,
      calendarDate,
      message: buildAccessMessage({ reason: 'day_disabled', scheduleSummary })
    };
  }

  if (!withinWindow) {
    const nextWindow = findNextAccessWindow(schedule, at);
    return {
      allowed: false,
      reason: 'outside_window',
      dailyUsageEnabled: true,
      schedule,
      scheduleSummary: { ...scheduleSummary, nextWindow },
      usedMinutes: liveUsedMinutes,
      storedUsedMinutes: usedMinutes,
      currentSessionMinutes,
      limitMinutes,
      remainingMinutes: Math.max(0, limitMinutes - liveUsedMinutes),
      withinWindow: false,
      activeSlot: null,
      blockedUntil: nextWindow?.at || null,
      needsDailyReset,
      calendarDate,
      message: buildAccessMessage({ reason: 'outside_window', scheduleSummary: { nextWindow } })
    };
  }

  if (liveUsedMinutes >= limitMinutes) {
    const nextWindow = findNextAccessWindow(schedule, at);
    return {
      allowed: false,
      reason: 'limit_exceeded',
      dailyUsageEnabled: true,
      schedule,
      scheduleSummary,
      usedMinutes: liveUsedMinutes,
      storedUsedMinutes: usedMinutes,
      currentSessionMinutes,
      limitMinutes,
      remainingMinutes: 0,
      withinWindow: true,
      activeSlot,
      blockedUntil: nextWindow?.at || null,
      needsDailyReset,
      calendarDate,
      message: buildAccessMessage({
        reason: 'limit_exceeded',
        usedMinutes: liveUsedMinutes,
        limitMinutes
      })
    };
  }

  return {
    allowed: true,
    reason: 'ok',
    dailyUsageEnabled: true,
    schedule,
    scheduleSummary,
    usedMinutes: liveUsedMinutes,
    storedUsedMinutes: usedMinutes,
    currentSessionMinutes,
    limitMinutes,
    remainingMinutes: Math.max(0, limitMinutes - liveUsedMinutes),
    withinWindow: true,
    activeSlot,
    blockedUntil: null,
    needsDailyReset,
    calendarDate,
    message: 'Access allowed.'
  };
}

function getWindowEndViolation(schedule, at = new Date()) {
  const activeSlot = getActiveSlot(schedule, at);
  if (!activeSlot) {
    return null;
  }

  const endAt = slotEndDate(schedule, activeSlot, at);
  if (at < endAt) {
    return null;
  }

  return {
    reason: 'window_ended',
    slot: activeSlot,
    endsAt: endAt,
    message: `Scheduled access window ended at ${formatSlotLabel(activeSlot)} (${DAY_LABELS[getScheduleSummary(schedule, at).day]}).`
  };
}

module.exports = {
  evaluateUsageAccess,
  getWindowEndViolation,
  buildAccessMessage
};
