/* Compass UI. Reads purpose.md and journal.json. Writes compass.json
   with GET-sha-PUT, one retry on 409, append-only arrays. */
(function () {
  "use strict";

  var TOKEN_KEY = "dong-gh-sync";
  var CACHE_KEY = "compass-cache-v1";
  var PENDING_KEY = "compass-pending-v1";
  var DEFAULT_REPO = "Dong-Xuyong/progress-sync";
  var API = "https://api.github.com/repos/";
  var TABS = ["purpose", "week", "mood", "wins", "better"];
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var SVG_NS = "http://www.w3.org/2000/svg";

  var state = {
    purpose: CompassPurpose.empty(),
    journal: { entries: {} },
    doc: CompassModel.emptyDoc(),
    purposeMissing: false,
    journalMissing: false,
    message: ""
  };

  var tail = Promise.resolve();
  var saveTimer = null;
  var toolTimer = null;
  var booted = false;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function svgEl(name) {
    return document.createElementNS(SVG_NS, name);
  }

  function clear(node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
  }

  function pad2(n) {
    return (n < 10 ? "0" : "") + n;
  }

  function prettyDay(key) {
    if (!key || key.length < 10) return key || "";
    return Number(key.slice(8, 10)) + " " + MONTHS[Number(key.slice(5, 7)) - 1];
  }

  function prettyWeek(key) {
    var match = /^(\d{4})-W(\d{2})$/.exec(key || "");
    if (!match) return key || "";
    return "Week " + Number(match[2]) + ", " + match[1];
  }

  function clock(ms) {
    var total = Math.ceil(ms / 1000);
    var m = Math.floor(total / 60);
    var s = total % 60;
    return m + ":" + pad2(s);
  }

  function readJson(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }

  function emptyPending() {
    return { wins: [], better: [], progress: {} };
  }

  function readPending() {
    var pending = readJson(PENDING_KEY, null);
    if (!pending || typeof pending !== "object") return emptyPending();
    if (!Array.isArray(pending.wins)) pending.wins = [];
    if (!Array.isArray(pending.better)) pending.better = [];
    if (!pending.progress || typeof pending.progress !== "object") pending.progress = {};
    return pending;
  }

  function writePending(pending) {
    try { localStorage.setItem(PENDING_KEY, JSON.stringify(pending)); } catch (e) {}
  }

  function hasPending(pending) {
    return pending.wins.length > 0 || pending.better.length > 0 || Object.keys(pending.progress).length > 0;
  }

  function progressDirty(pending) {
    var dirty = {};
    Object.keys(pending.progress || {}).forEach(function (id) { dirty[id] = true; });
    return dirty;
  }

  function hasToken() {
    return !!readConfig();
  }

  function readConfig() {
    var cfg = readJson(TOKEN_KEY, null);
    if (!cfg || typeof cfg.token !== "string" || !cfg.token.trim()) return null;
    return {
      token: cfg.token.trim(),
      repo: typeof cfg.repo === "string" && cfg.repo.trim() ? cfg.repo.trim() : DEFAULT_REPO
    };
  }

  function ensureConfig() {
    var cfg = readConfig();
    if (cfg) return cfg;
    var token = window.prompt(
      "Paste a GitHub fine-grained token with Contents read/write on " +
        DEFAULT_REPO +
        " only.\nIt is saved in this browser for all your apps."
    );
    if (!token || !token.trim()) return null;
    cfg = { token: token.trim(), repo: DEFAULT_REPO };
    localStorage.setItem(TOKEN_KEY, JSON.stringify(cfg));
    return cfg;
  }

  function toBase64(str) {
    return btoa(unescape(encodeURIComponent(str)));
  }

  function fromBase64(b64) {
    return decodeURIComponent(escape(atob(String(b64).replace(/\s/g, ""))));
  }

  function httpError(status, offline) {
    var err = new Error(offline ? "offline" : "GitHub " + status);
    err.status = status;
    err.offline = !!offline;
    return err;
  }

  function request(cfg, method, path, body) {
    return fetch(API + cfg.repo + "/contents/" + path, {
      method: method,
      cache: "no-store",
      headers: {
        Authorization: "Bearer " + cfg.token,
        Accept: "application/vnd.github+json"
      },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (res) {
      if (res.status === 401) {
        localStorage.removeItem(TOKEN_KEY);
        throw httpError(401, false);
      }
      if (res.status === 404 && method === "GET") return null;
      if (res.status === 409 || res.status === 422) throw httpError(res.status, false);
      if (!res.ok) throw httpError(res.status, false);
      return res.json();
    }, function () {
      throw httpError(0, true);
    });
  }

  function fileText(file) {
    if (!file) return null;
    if (typeof file.content === "string" && file.content.length) return fromBase64(file.content);
    return null;
  }

  function getText(cfg, path) {
    return request(cfg, "GET", path).then(function (file) {
      if (!file) return null;
      var inline = fileText(file);
      if (inline != null) return { sha: file.sha, text: inline };
      if (!file.sha) return null;
      return fetch(API + cfg.repo + "/contents/" + path, {
        headers: { Authorization: "Bearer " + cfg.token, Accept: "application/vnd.github.raw" }
      }).then(function (res) {
        if (!res.ok) throw httpError(res.status, false);
        return res.text().then(function (text) { return { sha: file.sha, text: text }; });
      });
    });
  }

  function getJson(cfg, path) {
    return getText(cfg, path).then(function (file) {
      if (!file) return null;
      return { sha: file.sha, data: JSON.parse(file.text) };
    });
  }

  function putJson(cfg, path, doc, sha, message) {
    var body = {
      message: message,
      content: toBase64(JSON.stringify(doc, null, 2) + "\n")
    };
    if (sha) body.sha = sha;
    return request(cfg, "PUT", path, body);
  }

  function exclusive(fn) {
    var run = tail.then(fn, fn);
    tail = run.then(function () { return null; }, function () { return null; });
    return run;
  }

  function setStatus(message) {
    state.message = message || "";
    var node = document.getElementById("sync-label");
    if (node) node.textContent = state.message;
    var button = document.getElementById("btn-connect");
    if (button) button.textContent = hasToken() ? "Sync" : "Connect";
  }

  function writeCache() {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        purpose: state.purpose,
        journal: state.journal,
        doc: state.doc,
        purposeMissing: state.purposeMissing,
        journalMissing: state.journalMissing
      }));
    } catch (e) {}
  }

  function bootFromCache() {
    var cache = readJson(CACHE_KEY, null);
    if (cache && typeof cache === "object") {
      state.purpose = cache.purpose || CompassPurpose.empty();
      state.journal = cache.journal || { entries: {} };
      state.doc = cache.doc || CompassModel.emptyDoc();
      state.purposeMissing = !!cache.purposeMissing;
      state.journalMissing = !!cache.journalMissing;
    }
    var pending = readPending();
    if (hasPending(pending)) {
      state.doc = CompassModel.merge(state.doc, {
        wins: (state.doc.wins || []).concat(pending.wins),
        better: (state.doc.better || []).concat(pending.better),
        weekly: state.doc.weekly || [],
        weeklyPick: state.doc.weeklyPick || [],
        goalProgress: Object.assign({}, state.doc.goalProgress, pending.progress)
      }, progressDirty(pending));
    }
  }

  function snapshot(pending) {
    var base = state.doc || CompassModel.emptyDoc();
    return {
      wins: (base.wins || []).concat(pending.wins || []),
      better: (base.better || []).concat(pending.better || []),
      weekly: base.weekly || [],
      weeklyPick: base.weeklyPick || [],
      goalProgress: Object.assign({}, base.goalProgress, pending.progress || {})
    };
  }

  function sameItem(a, b) {
    return !!a && !!b && a.date === b.date && a.text === b.text;
  }

  function dropSaved(list, saved) {
    return (list || []).filter(function (item) {
      return !(saved || []).some(function (old) { return sameItem(old, item); });
    });
  }

  function subtractPending(saved) {
    var current = readPending();
    current.wins = dropSaved(current.wins, saved.wins);
    current.better = dropSaved(current.better, saved.better);
    Object.keys(saved.progress || {}).forEach(function (id) {
      if (current.progress[id] === saved.progress[id]) delete current.progress[id];
    });
    writePending(current);
    return current;
  }

  function saveInner(cfg) {
    var pending = readPending();
    if (!hasPending(pending)) return Promise.resolve();
    return getJson(cfg, "compass.json").then(function (remote) {
      var merged = CompassModel.merge(remote && remote.data, snapshot(pending), progressDirty(pending));
      return putJson(cfg, "compass.json", merged, remote && remote.sha, "Save compass progress").then(function () {
        return merged;
      }, function (err) {
        if (err.status !== 409 && err.status !== 422) throw err;
        return getJson(cfg, "compass.json").then(function (fresh) {
          var again = readPending();
          var merged2 = CompassModel.merge(fresh && fresh.data, snapshot(again), progressDirty(again));
          return putJson(cfg, "compass.json", merged2, fresh && fresh.sha, "Save compass progress").then(function () {
            pending = again;
            return merged2;
          });
        });
      });
    }).then(function (merged) {
      var left = subtractPending(pending);
      state.doc = merged;
      if (hasPending(left)) {
        state.doc = CompassModel.merge(merged, {
          wins: left.wins,
          better: left.better,
          weekly: merged.weekly,
          weeklyPick: merged.weeklyPick,
          goalProgress: left.progress
        }, progressDirty(left));
      }
      writeCache();
      setStatus(hasPending(left) ? "Saving" : "Saved");
      render();
    });
  }

  function saveSoon() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      saveTimer = null;
      saveNow();
    }, 500);
  }

  function saveNow() {
    var cfg = readConfig();
    if (!cfg) {
      setStatus("Add a GitHub token to save.");
      return Promise.resolve();
    }
    return exclusive(function () {
      return saveInner(cfg).catch(function (err) {
        if (err && err.status === 401) setStatus("GitHub token rejected. Connect again.");
        else if (err && err.offline) setStatus("Saved on this phone. It will sync when you are back online.");
        else setStatus("Could not save. It stays on this phone until the next try.");
        render();
      });
    });
  }

  function createIfMissing(cfg, file) {
    if (file) return Promise.resolve(file);
    var created = CompassModel.emptyDoc();
    return putJson(cfg, "compass.json", created, null, "Create compass.json").then(function () {
      return getJson(cfg, "compass.json");
    }, function (err) {
      if (err.status !== 409 && err.status !== 422) throw err;
      return getJson(cfg, "compass.json");
    }).then(function (fresh) {
      setStatus("Created compass.json");
      return fresh || { sha: null, data: created };
    });
  }

  function loadAll() {
    var cfg = readConfig();
    if (!cfg) {
      setStatus("Connect GitHub to load your purpose, journal, and compass.");
      render();
      return Promise.resolve();
    }
    setStatus("Loading");
    return exclusive(function () {
      return Promise.all([
        getText(cfg, "purpose.md"),
        getJson(cfg, "journal.json"),
        getJson(cfg, "compass.json")
      ]).then(function (parts) {
        state.purposeMissing = !parts[0];
        state.journalMissing = !parts[1];
        state.purpose = parts[0] ? CompassPurpose.parse(parts[0].text) : CompassPurpose.empty();
        state.journal = parts[1] ? parts[1].data : { entries: {} };
        return createIfMissing(cfg, parts[2]);
      }).then(function (compassFile) {
        state.doc = compassFile && compassFile.data ? compassFile.data : CompassModel.emptyDoc();
        var pending = readPending();
        if (hasPending(pending)) return saveInner(cfg);
        writeCache();
        if (!state.message || state.message === "Loading") setStatus("Up to date");
        render();
      });
    }).catch(function (err) {
      if (err && err.status === 401) setStatus("GitHub token rejected. Connect again.");
      else if (err && err.offline) {
        setStatus(readJson(CACHE_KEY, null) ? "Offline. Showing the last copy on this phone." : "Offline, and nothing is saved on this phone yet.");
      } else setStatus("GitHub could not be reached. Try again.");
      render();
    });
  }

  function todayKey() {
    return CompassModel.dayKey(new Date());
  }

  function goals() {
    return (state.purpose && state.purpose.goals) || [];
  }

  function renderPurpose() {
    var root = document.getElementById("panel-purpose");
    if (!root || (document.activeElement && root.contains(document.activeElement))) return;
    clear(root);
    var stack = el("div", "stack");
    if (!hasToken()) stack.appendChild(el("p", "dx-card empty", "Connect GitHub to load purpose.md."));
    else if (state.purposeMissing) stack.appendChild(el("p", "dx-card empty", "purpose.md is not in the sync repo yet."));
    var questions = state.purpose && state.purpose.questions && state.purpose.questions.length
      ? state.purpose.questions
      : CompassPurpose.empty().questions;
    questions.forEach(function (q) {
      var card = el("article", "dx-card q");
      card.appendChild(el("h3", "", q.text));
      if (q.latest && q.latest.text) {
        card.appendChild(el("p", "latest", q.latest.text));
        if (q.latest.date) card.appendChild(el("p", "when", q.latest.date));
      } else {
        card.appendChild(el("p", "dx-muted", "No answer yet"));
      }
      if (q.past && q.past.length) {
        var past = document.createElement("details");
        past.className = "past";
        past.appendChild(el("summary", "", "Past answers"));
        var list = document.createElement("ul");
        q.past.forEach(function (item) {
          var line = item.date ? item.date + " · " + item.text : item.text;
          list.appendChild(el("li", "", line));
        });
        past.appendChild(list);
        card.appendChild(past);
      }
      stack.appendChild(card);
    });
    var values = state.purpose && state.purpose.values || [];
    var valueCard = el("section", "dx-card");
    valueCard.appendChild(el("h2", "", "Values"));
    if (!values.length) valueCard.appendChild(el("p", "empty", "No values yet."));
    else {
      var ul = el("ul", "values");
      values.forEach(function (value) { ul.appendChild(el("li", "", value)); });
      valueCard.appendChild(ul);
    }
    stack.appendChild(valueCard);
    var vision = el("section", "dx-card");
    vision.appendChild(el("h2", "", "1-year vision"));
    vision.appendChild(el("p", state.purpose && state.purpose.vision ? "vision" : "empty", (state.purpose && state.purpose.vision) || "No vision yet."));
    stack.appendChild(vision);
    var goalCard = el("section", "dx-card");
    goalCard.appendChild(el("h2", "", "Top 3 goals"));
    var slots = CompassModel.goalSlots(goals(), state.doc && state.doc.goalProgress);
    if (!goals().length) goalCard.appendChild(el("p", "empty", "No goals in purpose.md yet."));
    slots.forEach(function (slot) {
      if (!goals().length) return;
      var block = el("div", "goal");
      block.appendChild(el("h3", "", slot.id.toUpperCase() + " · " + slot.label));
      var bar = el("span", "bar");
      var fill = document.createElement("i");
      bar.appendChild(fill);
      block.appendChild(bar);
      var label = el("span", "range-label", slot.percent + "%");
      var range = document.createElement("input");
      range.type = "range";
      range.min = "0";
      range.max = "100";
      range.value = String(slot.percent);
      range.setAttribute("aria-label", slot.label + " progress");
      range.addEventListener("input", function () {
        var n = CompassModel.clampProgress(range.value) || 0;
        label.textContent = n + "%";
        fill.style.width = n + "%";
        onProgress(slot.id, n);
      });
      block.appendChild(label);
      block.appendChild(range);
      goalCard.appendChild(block);
      requestAnimationFrame(function () { fill.style.width = slot.percent + "%"; });
    });
    stack.appendChild(goalCard);
    var extras = (state.purpose && state.purpose.extras) || [];
    extras.forEach(function (extra) {
      var card = el("section", "dx-card");
      if (extra.title) card.appendChild(el("h2", "", extra.title));
      card.appendChild(el("p", "vision", extra.text || ""));
      stack.appendChild(card);
    });
    root.appendChild(stack);
  }

  function onProgress(id, n) {
    if (!state.doc.goalProgress || typeof state.doc.goalProgress !== "object") state.doc.goalProgress = {};
    state.doc.goalProgress[id] = n;
    var pending = readPending();
    pending.progress[id] = n;
    writePending(pending);
    saveSoon();
  }

  function goalLabel(goal, index) {
    if (goal && goal.goal) return String(goal.goal);
    var labels = goals();
    var map = { g1: 0, g2: 1, g3: 2 };
    var at = goal && goal.id && map[goal.id] != null ? map[goal.id] : index;
    return labels[at] || ("Goal " + (at + 1));
  }

  function renderWeek() {
    var root = document.getElementById("panel-week");
    if (!root) return;
    clear(root);
    var card = el("section", "dx-card");
    var entry = CompassModel.latestByWeek(state.doc && state.doc.weekly);
    if (!entry) {
      card.appendChild(el("h2", "", "This week"));
      card.appendChild(el("p", "empty", hasToken() ? "No Sunday check yet. Dr. Hiluluk fills the lights and one line of advice." : "Connect GitHub to load this week."));
      root.appendChild(card);
      return;
    }
    card.appendChild(el("h2", "", prettyWeek(entry.week)));
    var goalsList = Array.isArray(entry.goals) ? entry.goals : [];
    if (!goalsList.length) card.appendChild(el("p", "empty", "No lights this week."));
    goalsList.forEach(function (goal, index) {
      var row = el("div", "light-row");
      var light = CompassModel.normalizeLight(goal && goal.light);
      var bulb = el("span", "bulb " + (light ? "bulb-" + light : "bulb-none"));
      bulb.setAttribute("role", "img");
      bulb.setAttribute("aria-label", light || "No light");
      row.appendChild(bulb);
      var copy = el("div");
      copy.appendChild(el("p", "goal-name", goalLabel(goal, index)));
      if (goal && goal.note) copy.appendChild(el("p", "light-note", String(goal.note)));
      row.appendChild(copy);
      card.appendChild(row);
    });
    card.appendChild(el("p", "advice", entry.advice ? String(entry.advice) : "No advice line yet."));
    var mood = CompassModel.weekMood(entry);
    if (mood) {
      var bits = [];
      if (mood.mood != null) bits.push("Mood " + formatNum(mood.mood));
      if (mood.energy != null) bits.push("Energy " + formatNum(mood.energy));
      card.appendChild(el("p", "week-mood", bits.join(" · ")));
    }
    root.appendChild(card);
  }

  function formatNum(n) {
    var rounded = Math.round(n * 10) / 10;
    return rounded % 1 === 0 ? String(rounded) : rounded.toFixed(1);
  }

  function renderMood() {
    var host = document.getElementById("mood-chart");
    var tableHost = document.getElementById("mood-table");
    if (!host) return;
    clear(host);
    clear(tableHost);
    var days = CompassJournal.lastNDays(state.journal, todayKey(), 30);
    var any = days.some(function (day) {
      return day.mood != null || day.energy != null || day.sleep != null;
    });
    var card = el("section", "dx-card");
    card.appendChild(chartSvg(days));
    card.appendChild(legend());
    var note = "";
    if (!hasToken() && !readJson(CACHE_KEY, null)) note = "Connect GitHub to load mood, energy, and sleep.";
    else if (state.journalMissing) note = "journal.json is not in the sync repo yet.";
    else if (!any) note = "No mood, energy, or sleep in the last 30 days.";
    if (note) card.appendChild(el("p", "empty", note));
    host.appendChild(card);
    tableHost.appendChild(moodTable(days));
  }

  function legend() {
    var list = el("ul", "legend");
    [["swatch-mood", "Mood, solid, 1 to 5"], ["swatch-energy", "Energy, dashed, 1 to 5"], ["swatch-sleep", "Sleep, dotted, hours"]].forEach(function (item) {
      var li = document.createElement("li");
      var swatch = document.createElement("i");
      swatch.className = item[0];
      li.appendChild(swatch);
      li.appendChild(document.createTextNode(item[1]));
      list.appendChild(li);
    });
    return list;
  }

  function chartSvg(days) {
    var width = 360;
    var height = 200;
    var padL = 28;
    var padR = 28;
    var padT = 16;
    var padB = 28;
    var innerW = width - padL - padR;
    var innerH = height - padT - padB;
    var svg = svgEl("svg");
    svg.setAttribute("viewBox", "0 0 " + width + " " + height);
    svg.setAttribute("class", "chart");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Mood, energy, and sleep for the last 30 days. Mood and energy use 1 to 5. Sleep uses hours.");
    function xAt(i) {
      if (days.length <= 1) return padL + innerW / 2;
      return padL + innerW * i / (days.length - 1);
    }
    function yScore(value) {
      return padT + innerH * (5 - value) / 4;
    }
    function ySleep(hours) {
      var clamped = Math.max(0, Math.min(12, hours));
      return padT + innerH * (1 - clamped / 12);
    }
    function path(read, yOf) {
      var d = "";
      var drawing = false;
      days.forEach(function (day, i) {
        var value = read(day);
        if (value == null) {
          drawing = false;
          return;
        }
        d += (drawing ? "L" : "M") + xAt(i).toFixed(1) + " " + yOf(value).toFixed(1) + " ";
        drawing = true;
      });
      return d.trim();
    }
    [1, 2, 3, 4, 5].forEach(function (tick) {
      var text = svgEl("text");
      text.setAttribute("x", "2");
      text.setAttribute("y", String(yScore(tick) + 3));
      text.textContent = String(tick);
      svg.appendChild(text);
    });
    var sleepAxis = svgEl("text");
    sleepAxis.setAttribute("x", String(width - 4));
    sleepAxis.setAttribute("y", "12");
    sleepAxis.setAttribute("text-anchor", "end");
    sleepAxis.textContent = "12h";
    svg.appendChild(sleepAxis);
    var mood = svgEl("path");
    var energy = svgEl("path");
    var sleep = svgEl("path");
    mood.setAttribute("class", "line-mood");
    energy.setAttribute("class", "line-energy");
    sleep.setAttribute("class", "line-sleep");
    mood.setAttribute("d", path(function (day) { return day.mood; }, yScore));
    energy.setAttribute("d", path(function (day) { return day.energy; }, yScore));
    sleep.setAttribute("d", path(function (day) { return day.sleep; }, ySleep));
    svg.appendChild(mood);
    svg.appendChild(energy);
    svg.appendChild(sleep);
    days.forEach(function (day, i) {
      if (i !== 0 && i !== 14 && i !== days.length - 1) return;
      var label = svgEl("text");
      label.setAttribute("x", String(xAt(i)));
      label.setAttribute("y", String(height - 6));
      label.setAttribute("text-anchor", i === 0 ? "start" : i === days.length - 1 ? "end" : "middle");
      label.textContent = prettyDay(day.date);
      svg.appendChild(label);
    });
    return svg;
  }

  function moodTable(days) {
    var details = document.createElement("details");
    details.className = "dx-card table-fold";
    details.appendChild(el("summary", "", "Data table"));
    var table = el("table", "data");
    var head = document.createElement("tr");
    ["Day", "Mood", "Energy", "Sleep"].forEach(function (name) {
      head.appendChild(el("th", "", name));
    });
    table.appendChild(head);
    days.forEach(function (day) {
      var row = document.createElement("tr");
      row.appendChild(el("td", "", prettyDay(day.date)));
      row.appendChild(el("td", "", day.mood == null ? "—" : String(day.mood)));
      row.appendChild(el("td", "", day.energy == null ? "—" : String(day.energy)));
      row.appendChild(el("td", "", day.sleep == null ? "—" : formatNum(day.sleep)));
      table.appendChild(row);
    });
    details.appendChild(table);
    return details;
  }

  function renderWins() {
    var count = document.getElementById("win-count");
    var list = document.getElementById("wins-list");
    var input = document.getElementById("win-text");
    var button = document.querySelector("#win-form button");
    var today = todayKey();
    var used = CompassModel.countOn(state.doc && state.doc.wins, today);
    if (count) count.textContent = used + " of 3 tonight";
    if (button) button.disabled = used >= 3 || !(input && input.value.trim());
    if (input) input.disabled = used >= 3;
    if (!list) return;
    clear(list);
    var wins = (state.doc && state.doc.wins) || [];
    if (!wins.length) {
      list.appendChild(el("p", "dx-card empty", "No wins yet."));
      return;
    }
    var moods = CompassJournal.series(state.journal);
    var groups = {};
    var order = [];
    wins.forEach(function (win) {
      if (!win || !win.text) return;
      var date = win.date || "";
      if (!groups[date]) {
        groups[date] = [];
        order.push(date);
      }
      groups[date].push(win);
    });
    order.sort(function (a, b) { return a < b ? 1 : a > b ? -1 : 0; });
    order.forEach(function (date) {
      var mood = moods[date] ? moods[date].mood : null;
      var card = el("article", "dx-card win-day" + (mood != null && mood <= 2 ? " is-low" : ""));
      var header = document.createElement("header");
      header.appendChild(el("h3", "", date ? prettyDay(date) : "Undated"));
      if (mood != null && mood <= 2) header.appendChild(el("span", "when", "Low mood · " + mood));
      else if (mood != null) header.appendChild(el("span", "when", "Mood " + mood));
      card.appendChild(header);
      var ul = document.createElement("ul");
      groups[date].forEach(function (win) { ul.appendChild(el("li", "", win.text)); });
      card.appendChild(ul);
      list.appendChild(card);
    });
  }

  function renderBetter() {
    var count = document.getElementById("better-count");
    var input = document.getElementById("better-text");
    var button = document.querySelector("#better-form button");
    var stats = document.getElementById("better-stats");
    var curve = document.getElementById("curve");
    var pick = document.getElementById("pick");
    var today = todayKey();
    var logged = CompassModel.countOn(state.doc && state.doc.better, today) > 0;
    var run = CompassModel.streak(state.doc && state.doc.better, today);
    var n = CompassModel.distinctDays(state.doc && state.doc.better).length;
    if (count) count.textContent = logged ? "Logged today" : "One a day";
    if (button) button.disabled = logged || !(input && input.value.trim());
    if (input) input.disabled = logged;
    if (stats) {
      clear(stats);
      var card = el("section", "dx-card streak");
      card.appendChild(el("b", "", String(run)));
      card.appendChild(el("span", "", "day streak"));
      stats.appendChild(card);
    }
    if (curve) {
      clear(curve);
      var wrap = el("section", "dx-card");
      wrap.appendChild(el("h2", "", "1.01ⁿ"));
      wrap.appendChild(el("p", "dx-muted", "Today · day " + n + " · " + CompassModel.formatMultiple(n) + " · 365 days ≈ 37.8×"));
      wrap.appendChild(curveSvg(n));
      curve.appendChild(wrap);
    }
    if (pick) {
      clear(pick);
      var cardPick = el("section", "dx-card");
      cardPick.appendChild(el("h2", "", "Weekly pick"));
      var latest = CompassModel.latestByWeek(state.doc && state.doc.weeklyPick);
      if (!latest) cardPick.appendChild(el("p", "empty", "No weekly pick yet."));
      else {
        cardPick.appendChild(el("p", "when", prettyWeek(latest.week)));
        cardPick.appendChild(el("p", "advice", latest.text || ""));
      }
      pick.appendChild(cardPick);
    }
  }

  function curveSvg(n) {
    var maxN = Math.max(365, n);
    var width = 360;
    var height = 180;
    var padL = 36;
    var padR = 12;
    var padT = 16;
    var padB = 24;
    var innerW = width - padL - padR;
    var innerH = height - padT - padB;
    var top = CompassModel.compound(maxN);
    var svg = svgEl("svg");
    svg.setAttribute("viewBox", "0 0 " + width + " " + height);
    svg.setAttribute("class", "chart");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Compounding curve. Day " + n + " is " + CompassModel.formatMultiple(n) + ". 365 days is about 37.8 times.");
    function xAt(day) { return padL + innerW * day / maxN; }
    function yAt(day) {
      var value = CompassModel.compound(day);
      return padT + innerH * (1 - (value - 1) / (top - 1));
    }
    var d = "";
    var steps = 60;
    var i;
    for (i = 0; i <= steps; i++) {
      var day = maxN * i / steps;
      d += (i === 0 ? "M" : "L") + xAt(day).toFixed(1) + " " + yAt(day).toFixed(1) + " ";
    }
    var path = svgEl("path");
    path.setAttribute("class", "curve-line");
    path.setAttribute("d", d.trim());
    svg.appendChild(path);
    var point = svgEl("circle");
    point.setAttribute("class", "curve-today");
    point.setAttribute("cx", xAt(Math.min(n, maxN)).toFixed(1));
    point.setAttribute("cy", yAt(Math.min(n, maxN)).toFixed(1));
    point.setAttribute("r", "5");
    svg.appendChild(point);
    var start = svgEl("text");
    start.setAttribute("x", String(padL));
    start.setAttribute("y", String(height - 6));
    start.textContent = "0";
    svg.appendChild(start);
    var end = svgEl("text");
    end.setAttribute("x", String(width - padR));
    end.setAttribute("y", String(height - 6));
    end.setAttribute("text-anchor", "end");
    end.textContent = String(maxN);
    svg.appendChild(end);
    return svg;
  }

  function render() {
    renderPurpose();
    renderWeek();
    renderMood();
    renderWins();
    renderBetter();
    var node = document.getElementById("sync-label");
    if (node && state.message) node.textContent = state.message;
  }

  function showTab(name) {
    if (TABS.indexOf(name) < 0) name = "purpose";
    document.querySelectorAll("[data-panel]").forEach(function (panel) {
      panel.hidden = panel.getAttribute("data-panel") !== name;
    });
    document.querySelectorAll(".tabbar a").forEach(function (link) {
      if (link.getAttribute("data-tab") === name) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
  }

  function tabFromHash() {
    var name = (location.hash || "").replace("#", "");
    return TABS.indexOf(name) >= 0 ? name : "purpose";
  }

  function addEntry(kind, text) {
    var clean = String(text || "").trim();
    if (!clean) return;
    var today = todayKey();
    var list = kind === "wins" ? state.doc.wins : state.doc.better;
    if (!Array.isArray(list)) {
      list = [];
      state.doc[kind] = list;
    }
    var limit = kind === "wins" ? 3 : 1;
    if (CompassModel.countOn(list, today) >= limit) return;
    var item = { date: today, text: clean, createdBy: "dong" };
    list.push(item);
    var pending = readPending();
    pending[kind].push(item);
    writePending(pending);
    if (kind === "wins") {
      var input = document.getElementById("win-text");
      if (input) input.value = "";
    } else {
      var betterInput = document.getElementById("better-text");
      if (betterInput) betterInput.value = "";
    }
    render();
    if (!hasToken()) {
      setStatus("Saved on this phone. Connect GitHub to sync it.");
      return;
    }
    setStatus("Saving");
    saveNow();
  }

  function bindForms() {
    document.getElementById("win-form").addEventListener("submit", function (event) {
      event.preventDefault();
      addEntry("wins", document.getElementById("win-text").value);
    });
    document.getElementById("better-form").addEventListener("submit", function (event) {
      event.preventDefault();
      addEntry("better", document.getElementById("better-text").value);
    });
    document.getElementById("win-text").addEventListener("input", renderWins);
    document.getElementById("better-text").addEventListener("input", renderBetter);
    document.getElementById("btn-connect").addEventListener("click", function () {
      if (!ensureConfig()) {
        setStatus("Connect GitHub to load your purpose, journal, and compass.");
        return;
      }
      loadAll();
    });
    document.getElementById("btn-low").addEventListener("click", openTools);
    document.getElementById("tools-close").addEventListener("click", closeTools);
    document.getElementById("tool-picks").addEventListener("click", function (event) {
      var button = event.target.closest("[data-tool]");
      if (!button) return;
      startTool(button.getAttribute("data-tool"));
    });
    window.addEventListener("hashchange", function () { showTab(tabFromHash()); });
  }

  function openTools() {
    var dialog = document.getElementById("tools");
    clear(document.getElementById("tool-stage"));
    if (typeof dialog.showModal === "function" && !dialog.open) dialog.showModal();
  }

  function closeTools() {
    stopTool();
    var dialog = document.getElementById("tools");
    if (dialog.open) dialog.close();
  }

  function stopTool() {
    if (toolTimer) clearInterval(toolTimer);
    toolTimer = null;
  }

  function startTool(name) {
    stopTool();
    var stage = document.getElementById("tool-stage");
    clear(stage);
    if (name === "breathe") mountBreath(stage);
    else if (name === "walk") mountTimed(stage, "Walk for two minutes. Name five things you can see, four you can feel, and three you can hear.");
    else mountReframe(stage);
  }

  function mountClock(stage, onTick) {
    var clockNode = el("p", "clock", "2:00");
    stage.appendChild(clockNode);
    var started = Date.now();
    toolTimer = setInterval(function () {
      var left = Math.max(0, 120000 - (Date.now() - started));
      clockNode.textContent = clock(left);
      if (onTick) onTick(Date.now() - started, left);
      if (left <= 0) {
        stopTool();
        clockNode.textContent = "0:00";
      }
    }, 200);
    return clockNode;
  }

  function mountBreath(stage) {
    var circle = el("div", "breath");
    var name = el("b", "", "Inhale");
    var count = el("span", "", "4");
    circle.appendChild(name);
    circle.appendChild(count);
    stage.appendChild(circle);
    stage.appendChild(el("p", "prompt", "Inhale 4, hold 4, exhale 4, hold 4."));
    requestAnimationFrame(function () { circle.classList.add("is-open"); });
    mountClock(stage, function (elapsed, left) {
      if (left <= 0) {
        name.textContent = "Done";
        count.textContent = "";
        return;
      }
      var phase = CompassModel.breathePhase(elapsed);
      name.textContent = phase.name;
      count.textContent = String(phase.count);
      circle.classList.toggle("is-open", phase.open);
    });
  }

  function mountTimed(stage, text) {
    stage.appendChild(el("p", "prompt", text));
    mountClock(stage);
  }

  function mountReframe(stage) {
    stage.appendChild(el("p", "prompt", "Same facts, a kinder story. This stays on this screen."));
    var form = el("div", "reframe");
    ["What happened, in one sentence?", "What story am I adding?", "What else could be true?"].forEach(function (label) {
      var field = el("label", "", label);
      var box = document.createElement("textarea");
      box.maxLength = 240;
      field.appendChild(box);
      form.appendChild(field);
    });
    stage.appendChild(form);
    mountClock(stage);
  }

  function boot() {
    if (booted) return;
    booted = true;
    bindForms();
    bootFromCache();
    if (!location.hash) history.replaceState(null, "", "#purpose");
    showTab(tabFromHash());
    setStatus(hasToken() ? "" : "Connect GitHub to load your purpose, journal, and compass.");
    render();
    if (hasToken()) loadAll();
    window.addEventListener("focus", function () {
      if (hasToken()) loadAll();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
