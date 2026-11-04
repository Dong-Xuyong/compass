/* Parse purpose.md into questions, values, vision, and the top 3 goals.
   The private file is not in this repo. The parser accepts the layouts a
   person or a writer actually uses: ATX headings, "Q1" / "Question 1",
   the nine canonical question sentences, dated bullets, and a Latest line.
   Sections it does not recognise are returned as extras so nothing is dropped. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.CompassPurpose = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var QUESTIONS = [
    { id: "q1", text: "If I knew I couldn't fail, what would I like to do?" },
    { id: "q2", text: "Even if I knew I would fail, what would I like to do anyway?" },
    { id: "q3", text: "If I had all the time and money in the world, but I had to use 40 hours a week to be of service to other people, what would I do?" },
    { id: "q4", text: "If I was giving a TED talk 40 years from now and the audience is giving it a standing ovation, what would I like to have talked about?" },
    { id: "q5", text: "What do I want people to say about me at my funeral?" },
    { id: "q6", text: "What do I want written about myself in my obituary?" },
    { id: "q7", text: "If I continued on this exact path, where would I end up five years from now? And is that where I want to end up?" },
    { id: "q8", text: "If I took a completely different path to what I'm doing right now, where might I end up five years from now?" },
    { id: "q9", text: "If I took a completely different path and did not care about money or what other people thought of me, where might I end up?" }
  ];

  function norm(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[`*_>#]/g, " ")
      .replace(/&amp;/g, " and ")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function plain(value) {
    return String(value || "")
      .replace(/\r\n/g, "\n")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/^\s{0,3}#{1,6}\s+/gm, "")
      .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function empty() {
    return {
      questions: QUESTIONS.map(function (q) {
        return { id: q.id, text: q.text, latest: null, past: [] };
      }),
      values: [],
      vision: "",
      goals: [],
      extras: []
    };
  }

  function stripFrontMatter(text) {
    if (text.charAt(0) !== "-") return text;
    var match = /^---\n[\s\S]*?\n---\n?/.exec(text);
    return match ? text.slice(match[0].length) : text;
  }

  function sectionsOf(text) {
    var lines = text.replace(/\r\n/g, "\n").split("\n");
    var sections = [];
    var current = { level: 0, title: "", lines: [] };
    var i;
    for (i = 0; i < lines.length; i++) {
      var line = lines[i];
      var heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
      if (heading) {
        if (current.title || current.lines.join("").trim()) sections.push(current);
        current = { level: heading[1].length, title: heading[2].trim(), lines: [] };
      } else {
        current.lines.push(line);
      }
    }
    if (current.title || current.lines.join("").trim()) sections.push(current);
    return sections;
  }

  function kindOf(title) {
    var n = norm(title);
    if (!n) return "extra";
    if (/^(questions|nine questions|the nine|reflections|prompts)( and answers)?$/.test(n)) return "questions";
    if (/\bvalues\b/.test(n) && n.indexOf("question") === -1) return "values";
    if (/\bvision\b/.test(n) || /\b(1 year|one year|12 month|twelve month)\b/.test(n)) return "vision";
    if (/\btop 3\b/.test(n) || (/\bgoals?\b/.test(n) && n.indexOf("?") === -1 && !/^q\s*[1-9]\b/.test(n))) return "goals";
    if (questionHint(title)) return "question";
    return "extra";
  }

  function questionHint(title) {
    var n = norm(title);
    if (/^(q|question)\s*[1-9]\b/.test(n)) return true;
    if (/^[1-9]\b/.test(n) && (n.length > 12 || title.indexOf("?") !== -1)) return true;
    return matchCanonical(title) != null;
  }

  function explicitId(title) {
    var n = norm(title);
    var match = /^(?:q|question)\s*([1-9])\b/.exec(n) || /^([1-9])\b/.exec(n);
    if (!match) return null;
    if (/^([1-9])\b/.test(n) && n.length < 12 && title.indexOf("?") === -1 && !matchCanonical(title)) return null;
    return "q" + match[1];
  }

  function matchCanonical(title) {
    var n = norm(title);
    if (n.length < 18) return null;
    var i;
    for (i = 0; i < QUESTIONS.length; i++) {
      var qn = norm(QUESTIONS[i].text);
      if (n.indexOf(qn) !== -1 || qn.indexOf(n) !== -1) return QUESTIONS[i].id;
    }
    var best = null;
    var bestScore = 0;
    for (i = 0; i < QUESTIONS.length; i++) {
      var words = norm(QUESTIONS[i].text).split(" ").filter(function (w) { return w.length > 3; });
      var hit = 0;
      var w;
      for (w = 0; w < words.length; w++) if (n.indexOf(words[w]) !== -1) hit++;
      var score = words.length ? hit / words.length : 0;
      if (score > bestScore) {
        bestScore = score;
        best = QUESTIONS[i].id;
      }
    }
    return bestScore >= 0.62 ? best : null;
  }

  function cleanItem(text) {
    return plain(text).replace(/^[-*+]\s+/, "").replace(/^\d+[.)]\s+/, "").trim();
  }

  function listItems(body) {
    var items = [];
    var lines = String(body || "").split("\n");
    var i;
    for (i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      if (/^[-*+]\s+/.test(line) || /^\d+[.)]\s+/.test(line)) {
        var item = cleanItem(line);
        if (item) items.push(item);
      }
    }
    return items;
  }

  function bareLine(line) {
    return String(line || "")
      .trim()
      .replace(/^(?:[-*+]|\d+[.)])\s+/, "")
      .replace(/\*\*/g, "")
      .replace(/__/g, "")
      .trim();
  }

  function stripDateDecor(text) {
    return String(text || "")
      .replace(/\s*[(_]*\d{4}-\d{2}-\d{2}[_)]*\s*$/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function datedFromLine(line) {
    var trimmed = bareLine(line);
    var match = /^(\d{4}-\d{2}-\d{2})(?:[T ][0-9:Z.+-]*)?\s*(?:[:|—–-]|[)]\s*[:—–-])\s*(.+)$/.exec(trimmed);
    if (!match) return null;
    var text = stripDateDecor(cleanItem(match[2]));
    if (!text) return null;
    return { date: match[1], text: text };
  }

  function latestLabel(line) {
    var trimmed = bareLine(line);
    var match = /^(latest|current answer|current|answer)(?:\s*\(?(\d{4}-\d{2}-\d{2})\)?)?\s*[:—–-]\s*(.+)$/i.exec(trimmed);
    if (!match) return null;
    var text = stripDateDecor(cleanItem(match[3]));
    var date = match[2] || "";
    if (!date) {
      var found = /(\d{4}-\d{2}-\d{2})/.exec(match[3]);
      if (found) date = found[1];
    }
    if (!text) return null;
    return { date: date, text: text };
  }

  function isPastHeader(line) {
    return /^(past answers?|previous answers?|earlier answers?|history|past)\s*:?\s*$/i.test(bareLine(line));
  }

  function parseAnswers(body) {
    var lines = String(body || "").split("\n");
    var dated = [];
    var labeled = null;
    var prose = [];
    var buffer = [];

    function flush() {
      var text = plain(buffer.join("\n"));
      buffer = [];
      if (!text) return;
      if (/^(past|previous|earlier|history)\b/i.test(text) && text.length < 48) return;
      prose.push(text);
    }

    var i;
    for (i = 0; i < lines.length; i++) {
      var raw = lines[i];
      var trim = raw.trim();
      if (isPastHeader(trim)) {
        flush();
        continue;
      }
      var labeledLine = latestLabel(trim);
      if (labeledLine) {
        flush();
        labeled = labeledLine;
        continue;
      }
      var datedLine = datedFromLine(trim);
      if (datedLine) {
        flush();
        dated.push(datedLine);
        continue;
      }
      if (!trim) {
        flush();
        continue;
      }
      buffer.push(raw);
    }
    flush();

    dated.sort(function (a, b) {
      if (a.date === b.date) return 0;
      return a.date < b.date ? -1 : 1;
    });

    var latest = labeled;
    var past = [];
    if (!latest && dated.length) latest = dated[dated.length - 1];
    dated.forEach(function (item) {
      if (latest && item.date === latest.date && item.text === latest.text) return;
      past.push(item);
    });
    if (!latest && prose.length) {
      latest = { date: "", text: prose[0] };
      prose.slice(1).forEach(function (text) { past.push({ date: "", text: text }); });
    } else if (latest && prose.length && !labeled) {
      prose.forEach(function (text) {
        if (text === latest.text) return;
        past.push({ date: "", text: text });
      });
    } else if (labeled && prose.length) {
      prose.forEach(function (text) { past.push({ date: "", text: text }); });
    }
    if (latest) latest = { date: latest.date || "", text: latest.text };
    return { latest: latest, past: past };
  }

  function parseValues(body) {
    var items = listItems(body).map(function (item) {
      return item.replace(/^\*\*(.+?)\*\*\s*[:—–-]?\s*/, "$1 ").trim();
    }).filter(Boolean);
    if (items.length) return items;
    var text = plain(body);
    if (!text) return [];
    var lines = text.split("\n").map(function (line) { return line.trim(); }).filter(Boolean);
    if (lines.length === 1 && lines[0].indexOf(",") !== -1 && lines[0].indexOf(".") === -1) {
      return lines[0].split(",").map(function (part) { return part.trim(); }).filter(Boolean);
    }
    return lines;
  }

  function parseGoals(body) {
    var items = listItems(body);
    if (!items.length) {
      plain(body).split("\n").forEach(function (line) {
        var match = /^(?:goal\s*)?([1-3])\s*[:.)—–-]\s*(.+)$/i.exec(line.trim());
        if (match) items.push(match[2].trim());
      });
    }
    return items.map(function (item) {
      return item.replace(/^(?:g[1-3]|goal\s*[1-3])\s*[:.)—–-]\s*/i, "").trim();
    }).filter(Boolean).slice(0, 3);
  }

  function titleText(title) {
    return plain(title).replace(/^(?:q(?:uestion)?\s*)?[1-9]\s*[:.)—–-]?\s*/i, "").trim();
  }

  function parse(markdown) {
    var result = empty();
    var text = stripFrontMatter(String(markdown || "").replace(/^\uFEFF/, ""));
    if (!text.trim()) return result;
    var sections = sectionsOf(text);
    var found = [];
    var inQuestions = false;
    var questionLevel = 0;
    var sawValues = false;
    var sawVision = false;
    var sawGoals = false;
    var consumed = [];

    sections.forEach(function (section, index) {
      var kind = kindOf(section.title);
      if (inQuestions && section.level <= questionLevel && kind !== "question") inQuestions = false;
      if (kind === "questions") {
        inQuestions = true;
        questionLevel = section.level;
        consumed.push(index);
        var inline = harvestInline(section.lines.join("\n"));
        inline.forEach(function (item) { found.push(item); });
        return;
      }
      if (kind === "values" && !sawValues) {
        result.values = parseValues(section.lines.join("\n"));
        sawValues = true;
        consumed.push(index);
        return;
      }
      if (kind === "vision") {
        var prefer = /\b(1 year|one year|12 month|twelve month)\b/.test(norm(section.title));
        var body = plain(section.lines.join("\n"));
        if (!sawVision || prefer) result.vision = body;
        sawVision = true;
        consumed.push(index);
        return;
      }
      if (kind === "goals" && !sawGoals) {
        result.goals = parseGoals(section.lines.join("\n"));
        sawGoals = true;
        consumed.push(index);
        return;
      }
      if (kind === "question" || (inQuestions && (section.title.indexOf("?") !== -1 || explicitId(section.title)))) {
        var answers = parseAnswers(section.lines.join("\n"));
        found.push({
          id: explicitId(section.title) || matchCanonical(section.title),
          text: titleText(section.title) || section.title,
          latest: answers.latest,
          past: answers.past
        });
        consumed.push(index);
      }
    });

    if (!found.length) {
      var chunks = [];
      sections.forEach(function (section) {
        var sectionKind = kindOf(section.title);
        if (sectionKind === "values" || sectionKind === "vision" || sectionKind === "goals") return;
        chunks.push((section.title ? section.title + "\n" : "") + section.lines.join("\n"));
      });
      found = harvestInline(chunks.join("\n\n"));
    }

    placeQuestions(result.questions, found);

    sections.forEach(function (section, index) {
      if (consumed.indexOf(index) !== -1) return;
      if (!section.title && !plain(section.lines.join("\n"))) return;
      if (!section.title && found.length) return;
      var titleNorm = norm(section.title);
      if (titleNorm === "purpose" || titleNorm === "compass") return;
      var body = plain(section.lines.join("\n"));
      if (!body) return;
      result.extras.push({ title: section.title || "Notes", text: body });
    });

    return result;
  }

  function harvestInline(text) {
    var found = [];
    var marks = [];
    var i;
    for (i = 0; i < QUESTIONS.length; i++) {
      var at = indexOfQuestion(text, QUESTIONS[i].text);
      if (at >= 0) marks.push({ at: at, id: QUESTIONS[i].id, text: QUESTIONS[i].text, len: QUESTIONS[i].text.length });
    }
    var idRe = /(?:^|\n)\s*(?:#{1,6}\s*)?(?:\*\*|__)?(?:question\s*|q\s*)([1-9])\b[^\n]*/gi;
    var match;
    while ((match = idRe.exec(text))) {
      var id = "q" + match[1];
      var already = marks.some(function (mark) { return mark.id === id; });
      if (!already) marks.push({ at: match.index, id: id, text: match[0], len: match[0].length });
    }
    marks.sort(function (a, b) { return a.at - b.at; });
    for (i = 0; i < marks.length; i++) {
      var start = marks[i].at + marks[i].len;
      var end = i + 1 < marks.length ? marks[i + 1].at : text.length;
      var slice = text.slice(start, end).replace(/^\*+|^_+/, "");
      var answers = parseAnswers(slice);
      found.push({
        id: marks[i].id,
        text: QUESTIONS[Number(marks[i].id.slice(1)) - 1].text,
        latest: answers.latest,
        past: answers.past
      });
    }
    return found;
  }

  function indexOfQuestion(text, sentence) {
    var at = text.toLowerCase().indexOf(sentence.toLowerCase());
    return at;
  }

  function placeQuestions(slots, found) {
    var used = {};
    var leftovers = [];
    found.forEach(function (item) {
      var id = item.id && !used[item.id] ? item.id : null;
      if (!id) {
        leftovers.push(item);
        return;
      }
      var slot = slots[Number(id.slice(1)) - 1];
      if (!slot) {
        leftovers.push(item);
        return;
      }
      used[id] = true;
      if (item.text && item.text.length > 12) slot.text = item.text;
      slot.latest = item.latest;
      slot.past = item.past || [];
    });
    var open = slots.filter(function (slot) { return !used[slot.id]; });
    leftovers.forEach(function (item, index) {
      if (!open[index]) return;
      if (item.text && item.text.length > 12) open[index].text = item.text;
      open[index].latest = item.latest;
      open[index].past = item.past || [];
    });
  }

  return {
    QUESTIONS: QUESTIONS,
    parse: parse,
    empty: empty,
    parseAnswers: parseAnswers
  };
});
