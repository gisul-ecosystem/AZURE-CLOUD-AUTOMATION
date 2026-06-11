'use client';

import {
  WEEKDAYS,
  DAY_LABELS,
  DAY_SHORT,
  TIMEZONE_OPTIONS,
  cloneSchedule
} from '../utils/usageSchedule';

const VISIBLE_DAYS = WEEKDAYS.filter((day) => day !== 'sunday');

function updateDay(schedule, day, updater) {
  const next = cloneSchedule(schedule);
  next.days[day] = updater(next.days[day] || { enabled: false, slots: [], limitHours: '' });
  return next;
}

export default function WeeklyUsageSchedule({ schedule, onChange, disabled = false }) {
  const handleTimezoneChange = (event) => {
    onChange({
      ...schedule,
      timezone: event.target.value
    });
  };

  const enableDay = (day) => {
    onChange(
      updateDay(schedule, day, (current) => ({
        enabled: true,
        slots: current.slots?.length ? current.slots : [{ start: '09:00', end: '17:00' }],
        limitHours: current.limitHours || '2'
      }))
    );
  };

  const disableDay = (day) => {
    onChange(
      updateDay(schedule, day, () => ({
        enabled: false,
        slots: [],
        limitHours: ''
      }))
    );
  };

  const updateSlot = (day, slotIndex, field, value) => {
    onChange(
      updateDay(schedule, day, (current) => {
        const slots = [...(current.slots || [])];
        slots[slotIndex] = {
          ...slots[slotIndex],
          [field]: value
        };
        return { ...current, enabled: true, slots };
      })
    );
  };

  const addSlot = (day) => {
    onChange(
      updateDay(schedule, day, (current) => ({
        ...current,
        enabled: true,
        slots: [...(current.slots || []), { start: '13:00', end: '17:00' }],
        limitHours: current.limitHours || '2'
      }))
    );
  };

  const removeSlot = (day, slotIndex) => {
    onChange(
      updateDay(schedule, day, (current) => {
        const slots = (current.slots || []).filter((_, index) => index !== slotIndex);
        if (slots.length === 0) {
          return { enabled: false, slots: [], limitHours: '' };
        }
        return { ...current, slots };
      })
    );
  };

  const updateLimitHours = (day, value) => {
    onChange(
      updateDay(schedule, day, (current) => ({
        ...current,
        limitHours: value
      }))
    );
  };

  const copyMondayToWeekdays = () => {
    const monday = schedule.days.monday;
    if (!monday?.enabled) {
      return;
    }

    const next = cloneSchedule(schedule);
    for (const day of ['tuesday', 'wednesday', 'thursday', 'friday']) {
      next.days[day] = cloneSchedule({ days: { temp: monday } }).days.temp;
    }
    onChange(next);
  };

  return (
    <div className="weekly-schedule">
      <div className="weekly-schedule__toolbar">
        <label className="field">
          <span className="field__label">Time Zone</span>
          <select
            value={schedule.timezone}
            onChange={handleTimezoneChange}
            disabled={disabled}
          >
            {TIMEZONE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className="btn btn--secondary btn--small"
          onClick={copyMondayToWeekdays}
          disabled={disabled || !schedule.days.monday?.enabled}
        >
          Copy Monday to Tue-Fri
        </button>
      </div>

      <div className="weekly-schedule__list">
        {VISIBLE_DAYS.map((day) => {
          const config = schedule.days?.[day] || { enabled: false, slots: [], limitHours: '' };

          return (
            <div key={day} className="weekly-schedule__row">
              <div className="weekly-schedule__day-badge" aria-hidden="true">
                {DAY_SHORT[day]}
              </div>

              <div className="weekly-schedule__content">
                <div className="weekly-schedule__day-label">{DAY_LABELS[day]}</div>

                {!config.enabled ? (
                  <button
                    type="button"
                    className="weekly-schedule__unavailable"
                    onClick={() => enableDay(day)}
                    disabled={disabled}
                  >
                    Unavailable <span>+</span>
                  </button>
                ) : (
                  <div className="weekly-schedule__slots">
                    {(config.slots || []).map((slot, slotIndex) => (
                      <div key={`${day}-${slotIndex}`} className="weekly-schedule__slot">
                        <input
                          type="time"
                          value={slot.start}
                          onChange={(event) => updateSlot(day, slotIndex, 'start', event.target.value)}
                          disabled={disabled}
                        />
                        <span className="weekly-schedule__dash">-</span>
                        <input
                          type="time"
                          value={slot.end}
                          onChange={(event) => updateSlot(day, slotIndex, 'end', event.target.value)}
                          disabled={disabled}
                        />

                        <label className="weekly-schedule__limit">
                          <span>Limit</span>
                          <input
                            type="number"
                            min="0.5"
                            step="0.5"
                            value={config.limitHours}
                            onChange={(event) => updateLimitHours(day, event.target.value)}
                            disabled={disabled || slotIndex > 0}
                            title={slotIndex > 0 ? 'Limit applies once per day' : 'Daily usage limit in hours'}
                          />
                          <span>h</span>
                        </label>

                        <div className="weekly-schedule__slot-actions">
                          <button
                            type="button"
                            className="weekly-schedule__icon-btn"
                            onClick={() => removeSlot(day, slotIndex)}
                            disabled={disabled}
                            title="Remove slot"
                          >
                            x
                          </button>
                          <button
                            type="button"
                            className="weekly-schedule__icon-btn"
                            onClick={() => addSlot(day)}
                            disabled={disabled}
                            title="Add another slot"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="inline-note">
        Users can access Azure only inside these daily windows. Usage is tracked from Azure sign-in logs and
        limited to the hours shown for each day.
      </p>
    </div>
  );
}
