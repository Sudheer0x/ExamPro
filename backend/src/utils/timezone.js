// src/utils/timezone.js
//
// Parses a fixed UTC offset such as "+05:30" into minutes (330).
// Returns null if the text is not a valid MySQL offset. (Named zones like
// "Asia/Kolkata" are NOT accepted: MySQL on Windows has no zone tables by default.)

function parseOffsetMinutes(text) {
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(String(text || '').trim());
  if (!m) return null;
  const hours = Number(m[2]);
  const minutes = Number(m[3]);
  if (minutes > 59) return null;
  if (hours > 14 || (hours === 14 && (minutes !== 0 || m[1] === '-'))) return null; // MySQL range: -13:59 .. +14:00
  return (m[1] === '-' ? -1 : 1) * (hours * 60 + minutes);
}

module.exports = { parseOffsetMinutes };
