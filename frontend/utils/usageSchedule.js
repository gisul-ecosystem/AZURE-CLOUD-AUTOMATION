export const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

export const DAY_LABELS = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
  sunday: 'Sunday'
};

export const DAY_SHORT = {
  monday: 'M',
  tuesday: 'T',
  wednesday: 'W',
  thursday: 'T',
  friday: 'F',
  saturday: 'S',
  sunday: 'S'
};

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const TIMEZONE_OPTIONS = [
  { value: 'UTC', label: 'UTC' },
  { value: 'Asia/Kolkata', label: 'India Standard Time' },
  { value: 'Asia/Dubai', label: 'Gulf Standard Time' },
  { value: 'Europe/London', label: 'UK Time' },
  { value: 'Europe/Berlin', label: 'Central European Time' },
  { value: 'America/New_York', label: 'US Eastern Time' },
  { value: 'America/Chicago', label: 'US Central Time' },
  { value: 'America/Los_Angeles', label: 'US Pacific Time' },
  { value: 'Asia/Singapore', label: 'Singapore Time' },
  { value: 'Australia/Sydney', label: 'Australian Eastern Time' }
];

function createEmptyDay() {
  return {
    enabled: false,
    slots: [],
    limitHours: ''
  };
}

export function createDefaultSchedule(timezone = 'Asia/Kolkata') {
  const days = {};

  for (const day of WEEKDAYS) {
    if (day === 'saturday' || day === 'sunday') {
      days[day] = createEmptyDay();
      continue;
    }

    days[day] = {
      enabled: true,
      slots: [{ start: '09:00', end: '17:00' }],
      limitHours: '2'
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

  return { start, end };
}

export function validateUsageSchedule(schedule) {
  const errors = [];

  if (!schedule?.timezone) {
    errors.push('Select a time zone.');
  }

  const enabledDays = WEEKDAYS.filter((day) => schedule?.days?.[day]?.enabled);

  if (enabledDays.length === 0) {
    errors.push('Enable at least one day in the weekly schedule.');
  }

  for (const day of enabledDays) {
    const config = schedule.days[day];
    const slots = Array.isArray(config.slots) ? config.slots : [];

    if (slots.length === 0) {
      errors.push(`${DAY_LABELS[day]} needs at least one time slot.`);
      continue;
    }

    for (const slot of slots) {
      if (!normalizeSlot(slot)) {
        errors.push(`${DAY_LABELS[day]} has an invalid time range.`);
      }
    }

    const limitHours = Number.parseFloat(config.limitHours);
    if (!limitHours || limitHours <= 0) {
      errors.push(`${DAY_LABELS[day]} needs a positive usage limit in hours.`);
    }
  }

  return errors;
}

export function toApiUsageSchedule(schedule) {
  const days = {};

  for (const day of WEEKDAYS) {
    const config = schedule.days?.[day] || createEmptyDay();
    const slots = (config.slots || []).map(normalizeSlot).filter(Boolean);
    const limitHours = Number.parseFloat(config.limitHours || 0);

    days[day] = {
      enabled: config.enabled === true && slots.length > 0,
      slots,
      limitMinutes: config.enabled ? Math.round(limitHours * 60) : 0
    };
  }

  return {
    timezone: schedule.timezone,
    days
  };
}

export function cloneSchedule(schedule) {
  return JSON.parse(JSON.stringify(schedule));
}
