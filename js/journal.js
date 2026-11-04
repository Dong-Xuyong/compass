/* Read mood, energy, and sleep the way Journal does, from journal.json.
   Day keys are YYYY-MM-DD. Mood and energy are integers 1–5. Sleep becomes
   hours. Missing days stay missing. A missing score is never treated as 0. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.CompassJournal = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  var CLOCK_RE = /^(\d{2}):(\d{2})$/;

  function isRecord(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  function integerScore(value) {
    if (typeof value === "string" && /^[1-5]$/.test(value.trim())) value = Number(value);
    if (value === 1 || value === 2 || value === 3 || value === 4 || value === 5) return value;
    return null;
  }

  function finite(value) {
    if (typeof value === "string" && value.trim() && !isNaN(Number(value))) value = Number(value);
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }

  function clockMinutes(value) {
    if (typeof value !== "string") return null;
    var match = CLOCK_RE.exec(value.trim());
    if (!match) return null;
    var hour = Number(match[1]);
    var minute = Number(match[2]);
    if (hour > 23 || minute > 59) return null;
    return hour * 60 + minute;
  }

  function sleepHours(bed, wake) {
    var bedMinutes = clockMinutes(bed);
    var wakeMinutes = clockMinutes(wake);
    if (bedMinutes == null || wakeMinutes == null) return null;
    var diff = wakeMinutes - bedMinutes;
    if (diff <= 0) diff += 24 * 60;
    return diff / 60;
  }

  function hoursFromText(value) {
    var text = String(value).trim();
    var range = /^(\d{2}:\d{2})\s*[-–—]\s*(\d{2}:\d{2})$/.exec(text);
    if (range) return sleepHours(range[1], range[2]);
    if (CLOCK_RE.test(text)) return null;
    var leading = /^\s*(-?\d+(?:\.\d+)?)/.exec(text);
    if (!leading) return null;
    var n = Number(leading[1]);
    if (!Number.isFinite(n) || n < 0 || n > 24) return null;
    return n;
  }

  function readHours(value) {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 24) return value;
    if (typeof value === "string") return hoursFromText(value);
    if (!isRecord(value)) return null;
    var hours = finite(value.hours);
    if (hours == null) hours = finite(value.sleepHours);
    if (hours == null) hours = sleepHours(value.bed, value.wake);
    if (hours != null && (hours < 0 || hours > 24)) return null;
    return hours;
  }

  function scoreInFields(entry, key) {
    if (!isRecord(entry) || !isRecord(entry.fields)) return null;
    return integerScore(entry.fields[key]);
  }

  function timeOf(record) {
    if (!isRecord(record) || record.updatedAt == null) return null;
    var t = Date.parse(record.updatedAt);
    return Number.isFinite(t) ? t : null;
  }

  function series(doc) {
    var out = {};
    if (!isRecord(doc)) return out;
    var entries = isRecord(doc.entries) ? doc.entries : {};
    var days = isRecord(doc.days) ? doc.days : {};
    var sleepMap = isRecord(doc.sleep) ? doc.sleep : {};
    var seen = {};
    function touch(date) {
      if (DATE_RE.test(date)) seen[date] = true;
    }
    Object.keys(entries).forEach(touch);
    Object.keys(days).forEach(touch);
    Object.keys(sleepMap).forEach(touch);
    Object.keys(seen).sort().forEach(function (date) {
      var entry = isRecord(entries[date]) ? entries[date] : null;
      var bag = isRecord(days[date]) ? days[date] : null;
      var mood = scoreInFields(entry, "mood");
      if (mood == null && bag) mood = integerScore(bag.mood);
      if (mood == null) mood = scoreInFields(entry, "moodMeter");
      if (mood == null && bag) mood = integerScore(bag.moodMeter);
      var energy = scoreInFields(entry, "energy");
      if (energy == null && bag) energy = integerScore(bag.energy);
      var night = null;
      var nightAt = null;
      if (entry) {
        night = readHours(entry.fields && entry.fields.sleep);
        if (night == null) night = readHours(entry.sleep);
        if (night == null) night = readHours(entry.fields && entry.fields.sleepHours);
        nightAt = timeOf(entry);
      }
      var mapped = readHours(sleepMap[date]);
      if (mapped != null) {
        var mappedAt = timeOf(sleepMap[date]);
        if (night == null || (mappedAt != null && (nightAt == null || mappedAt >= nightAt))) night = mapped;
      }
      if (night == null && bag) night = readHours(bag.sleep);
      if (mood == null && energy == null && night == null) return;
      out[date] = { mood: mood, energy: energy, sleep: night };
    });
    return out;
  }

  function lastNDays(doc, endKey, count) {
    var map = series(doc);
    var days = [];
    var cursor = endKey;
    var i;
    for (i = 0; i < count; i++) {
      var point = map[cursor] || { mood: null, energy: null, sleep: null };
      days.unshift({
        date: cursor,
        mood: point.mood,
        energy: point.energy,
        sleep: point.sleep
      });
      cursor = shift(cursor, -1);
    }
    return days;
  }

  function shift(key, delta) {
    var date = new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)) + delta));
    var month = String(date.getUTCMonth() + 1);
    var day = String(date.getUTCDate());
    if (month.length < 2) month = "0" + month;
    if (day.length < 2) day = "0" + day;
    return date.getUTCFullYear() + "-" + month + "-" + day;
  }

  function moodOn(doc, date) {
    var map = series(doc);
    return map[date] ? map[date].mood : null;
  }

  return {
    series: series,
    lastNDays: lastNDays,
    moodOn: moodOn,
    readHours: readHours
  };
});
