/* compass.json shape, append-only merge, streaks, and the 1.01^n curve.
   Writers GET the file, change it, then PUT with the sha. On 409 they GET
   again and retry once. Wins, better, weekly, and weeklyPick only grow. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.CompassModel = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var LIGHTS = { green: true, yellow: true, red: true };
  var GOAL_IDS = ["g1", "g2", "g3"];

  function isRecord(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  function pad2(n) {
    return (n < 10 ? "0" : "") + n;
  }

  function isoUtc(date) {
    var d = date instanceof Date ? date : new Date();
    return d.toISOString().replace(/\.\d{3}Z$/, "+00:00");
  }

  function dayKey(date) {
    var d = date instanceof Date ? date : new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  function shiftDay(key, delta) {
    var date = new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)) + delta));
    return date.getUTCFullYear() + "-" + pad2(date.getUTCMonth() + 1) + "-" + pad2(date.getUTCDate());
  }

  function isoWeekKey(year, monthIndex, day) {
    var utc = new Date(Date.UTC(year, monthIndex, day));
    var weekday = utc.getUTCDay() || 7;
    utc.setUTCDate(utc.getUTCDate() + 4 - weekday);
    var isoYear = utc.getUTCFullYear();
    var dayOffset = Math.round((utc.getTime() - Date.UTC(isoYear, 0, 1)) / 86400000);
    return isoYear + "-W" + pad2(Math.floor(dayOffset / 7) + 1);
  }

  function weekKey(date) {
    var d = date instanceof Date ? date : new Date();
    return isoWeekKey(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function emptyDoc(now) {
    return {
      version: 1,
      updatedAt: isoUtc(now ? new Date(now) : new Date()),
      weekly: [],
      wins: [],
      better: [],
      weeklyPick: [],
      goalProgress: {}
    };
  }

  function clampProgress(value) {
    var n = typeof value === "string" && value.trim() ? Number(value) : value;
    if (typeof n !== "number" || !Number.isFinite(n)) return null;
    if (n < 0) n = 0;
    if (n > 100) n = 100;
    return Math.round(n);
  }

  function copyItem(item) {
    return JSON.parse(JSON.stringify(item));
  }

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function textKey(item) {
    if (!isRecord(item)) return "";
    return String(item.date || item.week || "") + "\u0000" + String(item.text || "").trim();
  }

  function weeklyKey(item) {
    if (!isRecord(item)) return "";
    return JSON.stringify({
      week: item.week || "",
      advice: item.advice || "",
      goals: item.goals || [],
      mood: item.mood || null
    });
  }

  function union(remoteArr, localArr, keyFn) {
    var seen = {};
    var out = [];
    function push(item, fromApp) {
      if (!isRecord(item)) return;
      var copy = copyItem(item);
      if (fromApp && !copy.createdBy) copy.createdBy = "dong";
      var key = keyFn(copy);
      if (!key || seen[key]) return;
      seen[key] = true;
      out.push(copy);
    }
    asArray(remoteArr).forEach(function (item) { push(item, false); });
    asArray(localArr).forEach(function (item) { push(item, true); });
    return out;
  }

  function mergeProgress(remote, local, dirty) {
    var out = {};
    var source = isRecord(remote) ? remote : {};
    Object.keys(source).forEach(function (id) {
      var n = clampProgress(source[id]);
      if (n != null) out[id] = n;
    });
    var mine = isRecord(local) ? local : {};
    Object.keys(mine).forEach(function (id) {
      if (dirty && !dirty[id] && id in out) return;
      var n = clampProgress(mine[id]);
      if (n == null) return;
      if (!dirty || dirty[id]) out[id] = n;
    });
    return out;
  }

  function merge(remote, local, dirty) {
    var base = isRecord(remote) ? copyItem(remote) : emptyDoc();
    if (!isRecord(remote)) {
      base.weekly = [];
      base.wins = [];
      base.better = [];
      base.weeklyPick = [];
      base.goalProgress = {};
    }
    var mine = isRecord(local) ? local : {};
    base.version = typeof base.version === "number" ? base.version : 1;
    base.wins = union(base.wins, mine.wins, textKey);
    base.better = union(base.better, mine.better, textKey);
    base.weekly = union(base.weekly, mine.weekly, weeklyKey);
    base.weeklyPick = union(base.weeklyPick, mine.weeklyPick, textKey);
    base.goalProgress = mergeProgress(base.goalProgress, mine.goalProgress, dirty || {});
    base.updatedAt = isoUtc(new Date());
    return base;
  }

  function latestByWeek(list) {
    var best = null;
    asArray(list).forEach(function (item) {
      if (!isRecord(item) || !item.week) return;
      if (!best || String(item.week) > String(best.week)) best = item;
      else if (String(item.week) === String(best.week)) best = item;
    });
    return best;
  }

  function countOn(list, date) {
    var n = 0;
    asArray(list).forEach(function (item) {
      if (item && item.date === date && String(item.text || "").trim()) n++;
    });
    return n;
  }

  function distinctDays(list) {
    var seen = {};
    asArray(list).forEach(function (item) {
      if (item && item.date) seen[item.date] = true;
    });
    return Object.keys(seen).sort();
  }

  function streak(list, today) {
    var days = {};
    distinctDays(list).forEach(function (day) { days[day] = true; });
    var cursor = today;
    if (!days[cursor]) cursor = shiftDay(today, -1);
    if (!days[cursor]) return 0;
    var n = 0;
    while (days[cursor]) {
      n++;
      cursor = shiftDay(cursor, -1);
    }
    return n;
  }

  function compound(n) {
    var days = n < 0 ? 0 : n;
    return Math.pow(1.01, days);
  }

  function breathePhase(elapsedMs) {
    var cycle = 16000;
    var t = Math.max(0, Number(elapsedMs) || 0) % cycle;
    var index = Math.floor(t / 4000);
    var count = 4 - Math.floor((t - index * 4000) / 1000);
    if (count < 1) count = 1;
    return {
      index: index,
      name: ["Inhale", "Hold", "Exhale", "Hold"][index],
      count: count,
      open: index < 2
    };
  }

  function formatMultiple(n) {
    var value = compound(n);
    var rounded = Math.round(value * 10) / 10;
    return (rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)) + "×";
  }

  function goalSlots(purposeGoals, progress) {
    var labels = Array.isArray(purposeGoals) ? purposeGoals : [];
    var map = isRecord(progress) ? progress : {};
    return GOAL_IDS.map(function (id, index) {
      var pct = clampProgress(map[id]);
      return {
        id: id,
        label: labels[index] ? String(labels[index]) : "Goal " + (index + 1),
        percent: pct == null ? 0 : pct
      };
    });
  }

  function normalizeLight(value) {
    var light = String(value || "").toLowerCase();
    return LIGHTS[light] ? light : "";
  }

  function numberOrNull(value) {
    if (typeof value === "string" && value.trim()) value = Number(value);
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }

  function weekMood(entry) {
    if (!isRecord(entry) || !isRecord(entry.mood)) return null;
    var mood = numberOrNull(entry.mood.mood);
    var energy = numberOrNull(entry.mood.energy);
    if (mood == null && energy == null) return null;
    return { mood: mood, energy: energy };
  }

  return {
    GOAL_IDS: GOAL_IDS,
    emptyDoc: emptyDoc,
    isoUtc: isoUtc,
    dayKey: dayKey,
    shiftDay: shiftDay,
    weekKey: weekKey,
    merge: merge,
    latestByWeek: latestByWeek,
    countOn: countOn,
    distinctDays: distinctDays,
    streak: streak,
    compound: compound,
    formatMultiple: formatMultiple,
    breathePhase: breathePhase,
    goalSlots: goalSlots,
    normalizeLight: normalizeLight,
    weekMood: weekMood,
    clampProgress: clampProgress
  };
});
