import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import journal from "../js/journal.js";

var series = journal.series;
var lastNDays = journal.lastNDays;
var readHours = journal.readHours;

var dir = dirname(fileURLToPath(import.meta.url));
var doc = JSON.parse(readFileSync(join(dir, "fixtures/journal-sample.json"), "utf8"));
var map = series(doc);

assert.equal(map["2026-10-14"].mood, 4);
assert.equal(map["2026-10-14"].energy, 3);
assert.equal(map["2026-10-14"].sleep, 7.2);
assert.equal(map["2026-10-15"].mood, 2);
assert.equal(map["2026-10-15"].energy, null);
assert.equal(map["2026-10-16"].sleep, 7.5);
assert.equal(map["2026-10-17"].mood, 4);
assert.equal(map["2026-10-17"].energy, 4);
assert.equal(map["2026-10-17"].sleep, 7.5);
assert.equal(map["2026-10-18"].mood, 1);
assert.equal(map["2026-10-18"].sleep, 6.5);

var window = lastNDays(doc, "2026-10-18", 5);
assert.equal(window.length, 5);
assert.equal(window[0].date, "2026-10-14");
assert.equal(window[4].date, "2026-10-18");
assert.equal(window[2].mood, null);
assert.equal(window[2].sleep, 7.5);

assert.equal(readHours("23:30-07:00"), 7.5);
assert.equal(readHours("6.25 hours"), 6.25);
assert.equal(readHours({ bed: "00:15", wake: "07:45" }), 7.5);
assert.equal(series({ entries: {} })["2026-01-01"], undefined);

console.log("journal ok");
