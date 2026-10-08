// src/utils/datetime.js
//
// Strict parsers for the date/time text the admin API accepts. All values are BUSINESS time
// (see the time-zone policy in config/env.js): no "Z", no offsets. Each parser returns the
// normalised text MySQL wants, or null when the input is not valid.
//
//   parseDate('2026-12-14')                -> '2026-12-14'
//   parseTime('09:00')                     -> '09:00:00'
//   parseDateTime('2026-12-14T09:00')      -> '2026-12-14 09:00:00'

function calendarOk(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function parseDate(text) {
  if (typeof text !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const y = Number(m[1]);
  if (y < 1900 || y > 2100 || !calendarOk(y, Number(m[2]), Number(m[3]))) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function parseTime(text) {
  if (typeof text !== 'string') return null;
  const m = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(text.trim());
  return m ? `${m[1]}:${m[2]}:${m[3] || '00'}` : null;
}

function parseDateTime(text) {
  if (typeof text !== 'string') return null;
  const m = /^(\d{4}-\d{2}-\d{2})[ T]([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(text.trim());
  if (!m) return null;
  const date = parseDate(m[1]);
  return date ? `${date} ${m[2]}:${m[3]}:${m[4] || '00'}` : null;
}

/** 'HH:MM:SS' -> seconds since midnight. */
function timeToSeconds(time) {
  const [h, m, s] = String(time).split(':').map(Number);
  return h * 3600 + m * 60 + (s || 0);
}

module.exports = { parseDate, parseTime, parseDateTime, timeToSeconds };
