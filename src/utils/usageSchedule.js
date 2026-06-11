const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

const DAY_LABELS = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
  sunday: 'Sunday'
};

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

const DEFAULT_TIMEZONE = 'UTC';

function createEmptyDay() {
  return {
    enabled: false,
    slots: [],
    limitMinutes: 0
  };
}

function createDefaultSchedule(timezone = DEFAULT_TIMEZONE) {
  const days = {};
  for (const day of WEEKDAYS) {
    if (day === 'saturday' || day === 'sunday') {
      days[day] = createEmptyDay();
      continue;
    }

    days[day] = {
      enabled: true,
      slots: [{ start: '09:00', end: '17:00' }],
      limitMinutes: 120
    };
  }

  return { timezone, days };
}

function scheduleFromLegacyDailyLimit(limitMinutes, timezone = DEFAULT_TIMEZONE) {
  const minutes = Number(limitMinutes || 0);
  const days = {};

  for (const day of WEEKDAYS) {
    days[day] = {
      enabled: true,
      slots: [{ start: '00:00', end: '23:59' }],
      limitMinutes: minutes
    };
  }

  return { timezone, days };
}

function parseTimeToMinutes(timeValue) {
  if (typeof timeValue !== 'string' || !TIME_PATTERN.test(timeValue.trim())) {
    return null;
  }

  const [hours, minutes] = timeValue.trim().split(':').map(Number);
  return hours * 60 + minutes;
}

function normalizeSlot(slot) {
  if (!slot || typeof slot !== 'object') {
    return null;
  }

  const start = typeof slot.start === 'string' ? slot.start.trim() : '';
  const end = typeof slot.end === 'string' ? slot.end.trim() : '';
  const startMinutes = parseTimeToMinutes(start);
  const endMinutes = parseTimeToMinutes(end);

  if (startMinutes === null || endMinutes === null || startMinutes >= endMinutes) {
    return null;
  }

  return { start, end, startMinutes, endMinutes };
}

function normalizeDayConfig(dayConfig) {
  if (!dayConfig || typeof dayConfig !== 'object') {
    return createEmptyDay();
  }

  const enabled = dayConfig.enabled === true;
  const rawSlots = Array.isArray(dayConfig.slots) ? dayConfig.slots : [];
  const slots = rawSlots.map(normalizeSlot).filter(Boolean);
  const limitMinutes = Math.max(0, Math.round(Number(dayConfig.limitMinutes || 0)));

  return {
    enabled: enabled && slots.length > 0,
    slots,
    limitMinutes: enabled ? limitMinutes : 0
  };
}

function normalizeUsageSchedule(rawSchedule, fallbackDailyLimitMinutes, fallbackTimezone = DEFAULT_TIMEZONE) {
  let parsedSchedule = rawSchedule;

  if (typeof rawSchedule === 'string') {
    try {
      parsedSchedule = JSON.parse(rawSchedule);
    } catch (error) {
      parsedSchedule = null;
    }
  }

  if (!parsedSchedule || typeof parsedSchedule !== 'object') {
    if (fallbackDailyLimitMinutes) {
      return scheduleFromLegacyDailyLimit(fallbackDailyLimitMinutes, fallbackTimezone);
    }
    return null;
  }

  const timezone =
    typeof parsedSchedule.timezone === 'string' && parsedSchedule.timezone.trim().length > 0
      ? parsedSchedule.timezone.trim()
      : fallbackTimezone;

  const days = {};
  const sourceDays =
    parsedSchedule.days && typeof parsedSchedule.days === 'object' ? parsedSchedule.days : {};

  for (const day of WEEKDAYS) {
    days[day] = normalizeDayConfig(sourceDays[day]);
  }

  return { timezone, days };
}

function validateUsageSchedule(schedule) {
  const errors = [];

  if (!schedule || typeof schedule !== 'object') {
    return ['usageSchedule is required when daily usage is enabled.'];
  }

  if (!schedule.timezone || typeof schedule.timezone !== 'string') {
    errors.push('usageSchedule.timezone is required.');
  } else {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: schedule.timezone });
    } catch (error) {
      errors.push(`usageSchedule.timezone is invalid: ${schedule.timezone}`);
    }
  }

  const enabledDays = WEEKDAYS.filter((day) => schedule.days?.[day]?.enabled);

  if (enabledDays.length === 0) {
    errors.push('At least one day must be enabled in usageSchedule.');
  }

  for (const day of enabledDays) {
    const config = schedule.days[day];
    const slots = Array.isArray(config.slots) ? config.slots : [];

    if (slots.length === 0) {
      errors.push(`${DAY_LABELS[day]} must have at least one time slot.`);
      continue;
    }

    for (const slot of slots) {
      if (!normalizeSlot(slot)) {
        errors.push(`${DAY_LABELS[day]} has an invalid time slot.`);
      }
    }

    const limitMinutes = Number(config.limitMinutes || 0);
    if (!Number.isInteger(limitMinutes) || limitMinutes <= 0) {
      errors.push(`${DAY_LABELS[day]} must have a positive limitMinutes value.`);
    }
  }

  return errors;
}

function getZonedParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'long'
  });

  const parts = formatter.formatToParts(date);
  const values = {};

  for (const part of parts) {
    if (part.type !== 'literal') {
      values[part.type] = part.value;
    }
  }

  const hour = Number(values.hour);
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: hour === 24 ? 0 : hour,
    minute: Number(values.minute),
    weekday: String(values.weekday || '').toLowerCase(),
    calendarDate: `${values.year}-${values.month}-${values.day}`
  };
}

function getMinutesSinceMidnight(parts) {
  return parts.hour * 60 + parts.minute;
}

function resolveScheduleForRequest(request) {
  if (!request?.enable_daily_usage) {
    return null;
  }

  return normalizeUsageSchedule(
    request.usage_schedule,
    request.daily_limit_minutes,
    request.usage_schedule?.timezone || DEFAULT_TIMEZONE
  );
}

function getDayConfig(schedule, weekday) {
  if (!schedule?.days) {
    return createEmptyDay();
  }

  return schedule.days[weekday] || createEmptyDay();
}

function isWithinAnySlot(schedule, at = new Date()) {
  const parts = getZonedParts(at, schedule.timezone);
  const dayConfig = getDayConfig(schedule, parts.weekday);

  if (!dayConfig.enabled || dayConfig.slots.length === 0) {
    return false;
  }

  const currentMinutes = getMinutesSinceMidnight(parts);
  return dayConfig.slots.some(
    (slot) => currentMinutes >= slot.startMinutes && currentMinutes < slot.endMinutes
  );
}

function getTodayLimitMinutes(schedule, at = new Date()) {
  const parts = getZonedParts(at, schedule.timezone);
  const dayConfig = getDayConfig(schedule, parts.weekday);

  if (!dayConfig.enabled) {
    return 0;
  }

  return Number(dayConfig.limitMinutes || 0);
}

function getActiveSlot(schedule, at = new Date()) {
  const parts = getZonedParts(at, schedule.timezone);
  const dayConfig = getDayConfig(schedule, parts.weekday);

  if (!dayConfig.enabled) {
    return null;
  }

  const currentMinutes = getMinutesSinceMidnight(parts);
  return (
    dayConfig.slots.find(
      (slot) => currentMinutes >= slot.startMinutes && currentMinutes < slot.endMinutes
    ) || null
  );
}

function getCalendarDateInTimezone(timezone, at = new Date()) {
  return getZonedParts(at, timezone).calendarDate;
}

function slotEndDate(schedule, slot, at = new Date()) {
  const parts = getZonedParts(at, schedule.timezone);
  const endMinutes = slot.endMinutes;
  const endHour = Math.floor(endMinutes / 60);
  const endMinute = endMinutes % 60;

  const guess = new Date(
    `${parts.calendarDate}T${String(endHour).padStart(2, '0')}:${String(endMinute).padStart(2, '0')}:00`
  );

  const zonedGuess = getZonedParts(guess, schedule.timezone);
  const actualMinutes = getMinutesSinceMidnight(zonedGuess);
  const targetMinutes = endMinutes;
  const deltaMinutes = targetMinutes - actualMinutes;

  return new Date(guess.getTime() + deltaMinutes * 60 * 1000);
}

function findNextAccessWindow(schedule, at = new Date()) {
  for (let offset = 0; offset < 8; offset += 1) {
    const probe = new Date(at.getTime() + offset * 24 * 60 * 60 * 1000);
    const parts = getZonedParts(probe, schedule.timezone);
    const dayConfig = getDayConfig(schedule, parts.weekday);

    if (!dayConfig.enabled || dayConfig.slots.length === 0) {
      continue;
    }

    const currentMinutes = offset === 0 ? getMinutesSinceMidnight(parts) : -1;

    for (const slot of dayConfig.slots) {
      if (currentMinutes < slot.startMinutes) {
        const startHour = Math.floor(slot.startMinutes / 60);
        const startMinute = slot.startMinutes % 60;
        const guess = new Date(
          `${parts.calendarDate}T${String(startHour).padStart(2, '0')}:${String(startMinute).padStart(2, '0')}:00`
        );
        const zonedGuess = getZonedParts(guess, schedule.timezone);
        const deltaMinutes = slot.startMinutes - getMinutesSinceMidnight(zonedGuess);
        return {
          at: new Date(guess.getTime() + deltaMinutes * 60 * 1000),
          day: parts.weekday,
          slot
        };
      }
    }
  }

  return null;
}

function formatSlotLabel(slot) {
  return `${slot.start} - ${slot.end}`;
}

function getScheduleSummary(schedule, at = new Date()) {
  const parts = getZonedParts(at, schedule.timezone);
  const dayConfig = getDayConfig(schedule, parts.weekday);
  const withinWindow = isWithinAnySlot(schedule, at);
  const activeSlot = getActiveSlot(schedule, at);
  const nextWindow = withinWindow ? null : findNextAccessWindow(schedule, at);

  return {
    timezone: schedule.timezone,
    day: parts.weekday,
    dayLabel: DAY_LABELS[parts.weekday] || parts.weekday,
    dayEnabled: dayConfig.enabled,
    withinWindow,
    activeSlot,
    todayLimitMinutes: getTodayLimitMinutes(schedule, at),
    slots: dayConfig.slots,
    nextWindow,
    calendarDate: parts.calendarDate
  };
}

function getMaxDailyLimitMinutes(schedule) {
  if (!schedule?.days) {
    return 0;
  }

  return WEEKDAYS.reduce((max, day) => {
    const config = schedule.days[day];
    if (!config?.enabled) {
      return max;
    }
    return Math.max(max, Number(config.limitMinutes || 0));
  }, 0);
}

module.exports = {
  WEEKDAYS,
  DAY_LABELS,
  DEFAULT_TIMEZONE,
  createDefaultSchedule,
  createEmptyDay,
  scheduleFromLegacyDailyLimit,
  normalizeUsageSchedule,
  validateUsageSchedule,
  resolveScheduleForRequest,
  getZonedParts,
  getCalendarDateInTimezone,
  isWithinAnySlot,
  getTodayLimitMinutes,
  getActiveSlot,
  slotEndDate,
  findNextAccessWindow,
  formatSlotLabel,
  getScheduleSummary,
  getMaxDailyLimitMinutes,
  parseTimeToMinutes
};
