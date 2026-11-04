import assert from "node:assert/strict";
import model from "../js/model.js";

var emptyDoc = model.emptyDoc;
var merge = model.merge;
var streak = model.streak;
var compound = model.compound;
var formatMultiple = model.formatMultiple;
var countOn = model.countOn;
var latestByWeek = model.latestByWeek;
var weekMood = model.weekMood;
var goalSlots = model.goalSlots;
var isoUtc = model.isoUtc;

var empty = emptyDoc("2026-11-04T21:34:00Z");
assert.equal(empty.version, 1);
assert.equal(empty.updatedAt, "2026-11-04T21:34:00+00:00");
assert.deepEqual(empty.weekly, []);
assert.deepEqual(empty.wins, []);
assert.deepEqual(empty.better, []);
assert.deepEqual(empty.weeklyPick, []);
assert.deepEqual(empty.goalProgress, {});

var remote = {
  version: 1,
  updatedAt: "2026-11-01T00:00:00+00:00",
  note: "keep me",
  weekly: [{
    week: "2026-W44",
    goals: [
      { id: "g1", goal: "Thesis", light: "yellow", note: "Chapter slipped" },
      { id: "g2", goal: "Train", light: "green" }
    ],
    advice: "Protect the morning.",
    mood: { mood: 3.5, energy: "4" },
    createdBy: "hiluluk"
  }],
  wins: [{ date: "2026-11-01", text: "Wrote", createdBy: "dong" }],
  better: [{ date: "2026-11-03", text: "Phone in the kitchen", createdBy: "dong" }],
  weeklyPick: [{ week: "2026-W44", text: "One deep block before mail.", createdBy: "hiluluk" }],
  goalProgress: { g1: 20, g2: 80 }
};

var local = {
  wins: [
    { date: "2026-11-01", text: "Wrote", createdBy: "dong" },
    { date: "2026-11-04", text: "Called home" }
  ],
  better: [
    { date: "2026-11-03", text: "Phone in the kitchen", createdBy: "dong" },
    { date: "2026-11-04", text: "Lights out at 23:00" }
  ],
  weekly: remote.weekly,
  weeklyPick: remote.weeklyPick,
  goalProgress: { g1: 40, g2: 80, g3: 10 }
};

var saved = merge(remote, local, { g1: true, g3: true });
assert.equal(saved.note, "keep me");
assert.equal(saved.wins.length, 2);
assert.equal(saved.wins[1].text, "Called home");
assert.equal(saved.wins[1].createdBy, "dong");
assert.equal(saved.better.length, 2);
assert.equal(saved.better[1].createdBy, "dong");
assert.equal(saved.weekly.length, 1);
assert.equal(saved.weekly[0].createdBy, "hiluluk");
assert.equal(saved.weekly[0].goals[0].note, "Chapter slipped");
assert.equal(saved.goalProgress.g1, 40);
assert.equal(saved.goalProgress.g2, 80);
assert.equal(saved.goalProgress.g3, 10);
assert.match(saved.updatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+00:00$/);

var again = merge(saved, local, { g1: true, g3: true });
assert.equal(again.wins.length, 2);
assert.equal(again.better.length, 2);

var kept = merge(remote, { goalProgress: { g1: 5 } }, {});
assert.equal(kept.goalProgress.g1, 20);

assert.equal(streak(saved.better, "2026-11-04"), 2);
assert.equal(streak(saved.better, "2026-11-05"), 2);
assert.equal(streak([{ date: "2026-11-01", text: "a" }], "2026-11-04"), 0);
assert.equal(countOn(saved.wins, "2026-11-04"), 1);
assert.equal(countOn(saved.wins, "2026-11-02"), 0);

var week = latestByWeek([
  { week: "2026-W43", advice: "old" },
  { week: "2026-W44", advice: "first" },
  { week: "2026-W44", advice: "second" }
]);
assert.equal(week.advice, "second");
var mood = weekMood(remote.weekly[0]);
assert.equal(mood.mood, 3.5);
assert.equal(mood.energy, 4);
assert.equal(weekMood({ mood: {} }), null);

var slots = goalSlots(["Thesis", "Train", "Sleep"], { g1: 140, g2: "30" });
assert.deepEqual(slots.map(function (s) { return s.percent; }), [100, 30, 0]);
assert.equal(slots[0].id, "g1");
assert.equal(slots[2].label, "Sleep");

assert.ok(Math.abs(compound(365) - 37.78343433288728) < 1e-9);
assert.equal(formatMultiple(365), "37.8×");
assert.equal(formatMultiple(0), "1×");
assert.equal(model.breathePhase(0).name, "Inhale");
assert.equal(model.breathePhase(0).count, 4);
assert.equal(model.breathePhase(3999).count, 1);
assert.equal(model.breathePhase(4000).name, "Hold");
assert.equal(model.breathePhase(8000).name, "Exhale");
assert.equal(model.breathePhase(8000).open, false);
assert.equal(model.breathePhase(12000).name, "Hold");
assert.equal(model.breathePhase(16000).name, "Inhale");
assert.match(isoUtc(new Date("2026-11-04T00:00:00.000Z")), /\+00:00$/);

console.log("model ok");
