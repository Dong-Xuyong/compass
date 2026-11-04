import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import purpose from "../js/purpose.js";

var parse = purpose.parse;

var dir = dirname(fileURLToPath(import.meta.url));

var headed = readFileSync(join(dir, "fixtures/purpose-headed.md"), "utf8");
var inline = readFileSync(join(dir, "fixtures/purpose-inline.md"), "utf8");

var doc = parse(headed);
assert.equal(doc.questions.length, 9);
assert.equal(doc.questions[0].id, "q1");
assert.equal(doc.questions[0].latest.date, "2026-11-02");
assert.equal(doc.questions[0].latest.text, "Keep building Compass.");
assert.equal(doc.questions[0].past.length, 2);
assert.equal(doc.questions[0].past[0].date, "2026-09-01");
assert.equal(doc.questions[1].latest.text, "Teach anyway.");
assert.equal(doc.questions[4].past.length, 1);
assert.deepEqual(doc.values, ["Curiosity", "Kindness", "Health"]);
assert.match(doc.vision, /thesis is submitted/);
assert.deepEqual(doc.goals, ["Ship the thesis", "Train four days a week", "Save the emergency fund"]);
assert.equal(doc.extras.length, 0);

var loose = parse(inline);
assert.equal(loose.questions[0].latest.text, "Write the book.");
assert.equal(loose.questions[0].latest.date, "2026-11-01");
assert.equal(loose.questions[0].past[0].text, "First draft of the thought.");
assert.equal(loose.questions[8].latest.text, "A small school by the sea.");
assert.deepEqual(loose.values, ["Honesty", "Craft"]);
assert.match(loose.vision, /By next November/);
assert.equal(loose.goals[2], "Sleep before midnight");

var prose = parse([
  "## If I knew I couldn't fail, what would I like to do?",
  "",
  "I would open a workshop.",
  "",
  "Years ago I only wanted to leave.",
  "",
  "## Values",
  "",
  "Care",
  "Focus",
  "",
  "## Top 3 goals",
  "",
  "Goal 1: Finish chapter 4",
  "Goal 2: Call home weekly",
  "Goal 3 — Run a 5k"
].join("\n"));
assert.equal(prose.questions[0].latest.text, "I would open a workshop.");
assert.equal(prose.questions[0].past[0].text, "Years ago I only wanted to leave.");
assert.deepEqual(prose.values, ["Care", "Focus"]);
assert.deepEqual(prose.goals, ["Finish chapter 4", "Call home weekly", "Run a 5k"]);

var extra = parse("# Field notes\n\nBring the odd section through.\n");
assert.equal(extra.questions.length, 9);
assert.equal(extra.questions[0].latest, null);
assert.equal(extra.extras.length, 1);
assert.match(extra.extras[0].text, /odd section/);

assert.equal(parse("").goals.length, 0);
assert.equal(parse(null).questions.length, 9);

console.log("purpose ok");
