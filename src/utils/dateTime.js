const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;
const dateTimeLocalPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/;

const isValidCalendarDate = (year, month, day) => {
  const parsedDate = new Date(Date.UTC(year, month - 1, day));

  return (
    !Number.isNaN(parsedDate.getTime()) &&
    parsedDate.getUTCFullYear() === year &&
    parsedDate.getUTCMonth() === month - 1 &&
    parsedDate.getUTCDate() === day
  );
};

const parseDateOnly = (value) => {
  if (typeof value !== 'string' || !dateOnlyPattern.test(value)) {
    return null;
  }

  const [year, month, day] = value.split('-').map(Number);

  if (!isValidCalendarDate(year, month, day)) {
    return null;
  }

  return new Date(Date.UTC(year, month - 1, day));
};

const parseFlexibleDateTime = (value) => {
  if (typeof value !== 'string') {
    return null;
  }

  if (dateOnlyPattern.test(value)) {
    return parseDateOnly(value);
  }

  if (!dateTimeLocalPattern.test(value)) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
};

module.exports = {
  dateOnlyPattern,
  dateTimeLocalPattern,
  parseDateOnly,
  parseFlexibleDateTime
};
