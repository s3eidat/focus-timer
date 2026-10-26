/* Focus Timer — Pomodoro timer. Time is computed from Date.now(), never by counting ticks. */
(function () {
  "use strict";
  var $ = S3.$, $$ = S3.$$;
  var MODES = { focus: "Time to focus", short: "Short break", long: "Long break" };
  var NAMES = { focus: "Focus", short: "Short break", long: "Long break" };
  var C = 2 * Math.PI * 98;

  var settings = Object.assign({ focus: 25, short: 5, long: 15, every: 4, autoBreak: false, autoFocus: false, sound: true, volume: 0.6 }, S3.store("focus.settings") || {});
  var tasks = S3.store("focus.tasks") || [];
  var activeId = S3.store("focus.active") || null;
  var stats = S3.store("focus.stats") || {};
  var t = S3.store("focus.timer") || null;
  var baseTitle = document.title;

  // ---------- pure timer logic ----------
  function dur(mode) { return Math.round(settings[mode] * 60000); }
  function remaining(tm, now) { return tm.running ? Math.max(0, tm.endAt - now) : tm.remaining; }
  function start(tm, now) { if (!tm.running) { tm.endAt = now + tm.remaining; tm.running = true; } }
  function pause(tm, now) { if (tm.running) { tm.remaining = Math.max(0, tm.endAt - now); tm.running = false; } }
  function nextMode(mode, focusDone, every) { return mode !== "focus" ? "focus" : focusDone % every === 0 ? "long" : "short"; }
  function fmt(ms) {
    var s = Math.ceil(ms / 1000), m = Math.floor(s / 60);
    return String(m).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
  }
  function dayKey(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function fresh(mode, count) { return { mode: mode, running: false, remaining: dur(mode), total: dur(mode), endAt: 0, count: count || 0 }; }

  if (!t || !MODES[t.mode]) t = fresh("focus", 0);

  function save() { S3.store("focus.timer", t); }
  function saveTasks() { S3.store("focus.tasks", tasks); S3.store("focus.active", activeId); }

  // ---------- sound + notifications ----------
  var ctx;
  function chime() {
    if (!settings.sound) return;
    try {
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === "suspended") ctx.resume();
      [659.25, 783.99, 1046.5].forEach(function (f, i) {
        var o = ctx.createOscillator(), g = ctx.createGain(), at = ctx.currentTime + i * 0.22;
        o.type = "sine"; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(Math.max(0.0002, settings.volume * 0.5), at + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, at + 1.3);
        o.connect(g).connect(ctx.destination); o.start(at); o.stop(at + 1.4);
      });
    } catch (e) { /* audio unavailable */ }
  }
  function notify(text) {
    if (!("Notification" in window) || Notification.permission !== "granted" || !document.hidden) return;
    try { new Notification("Focus Timer", { body: text, icon: "kit/icon.svg", tag: "focus-timer" }); } catch (e) { /* some browsers only allow SW notifications */ }
  }
  function notifyState() {
    var el = $("#notifyState");
    if (!("Notification" in window)) { el.textContent = "Not supported in this browser"; $("#notify").disabled = true; return; }
    el.textContent = Notification.permission === "granted" ? "On: you'll get a notification when a session ends in a background tab" :
      Notification.permission === "denied" ? "Blocked in browser settings" : "Optional";
    $("#notify").disabled = Notification.permission !== "default";
  }

  // ---------- completing a session ----------
  function addStats(mins) {
    var k = dayKey(new Date()), d = stats[k] || { min: 0, poms: 0, tasks: 0 };
    d.min += mins; d.poms += 1; stats[k] = d; S3.store("focus.stats", stats);
  }
  function complete(counted) {
    var was = t.mode, count = t.count;
    if (was === "focus" && counted) {
      count++;
      addStats(t.total / 60000);
      var task = tasks.filter(function (x) { return x.id === activeId; })[0];
      if (task) { task.poms++; saveTasks(); }
      S3.done();
    }
    var next = nextMode(was, count, settings.every);
    if (was === "focus" && !counted) next = "short";
    t = fresh(next, count);
    if (counted) {
      chime();
      notify(was === "focus" ? "Focus session done. Time for a " + (next === "long" ? "long" : "short") + " break." : "Break over. Ready to focus?");
      S3.toast(was === "focus" ? "Session done. Take a break" : "Break over. Back to focus");
    }
    if ((next === "focus" && settings.autoFocus) || (next !== "focus" && settings.autoBreak)) start(t, Date.now());
    save(); renderAll();
  }

  // ---------- render ----------
  function draw() {
    var now = Date.now(), rem = remaining(t, now);
    if (t.running && rem <= 0) { complete(true); return; }
    var card = $("#timerCard");
    $("#time").textContent = fmt(rem);
    $("#ringFg").style.strokeDashoffset = String(C * (1 - rem / (t.total || 1)));
    card.classList.toggle("running", t.running);
    document.title = t.running ? fmt(rem) + " · " + NAMES[t.mode] + " — Focus Timer" : baseTitle;
  }
  function renderTimer() {
    var card = $("#timerCard");
    card.dataset.mode = t.mode;
    $$("#mode button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.v === t.mode)); });
    $("#label").textContent = MODES[t.mode];
    var btn = $("#start");
    btn.innerHTML = t.running ? '<svg class="i"><use href="#i-pause"/></svg><span>Pause</span>' : '<svg class="i"><use href="#i-play"/></svg><span>' + (t.remaining < t.total ? "Resume" : "Start") + "</span>";
    var inCycle = t.count % settings.every;
    $("#cycle").textContent = "Session " + (inCycle + (t.mode === "focus" ? 1 : 0) || settings.every) + " of " + settings.every;
    var task = tasks.filter(function (x) { return x.id === activeId; })[0];
    $("#current").textContent = task ? "Working on: " + task.name : "No task selected";
    draw();
  }
  function renderTasks() {
    var ul = $("#tasks");
    ul.innerHTML = "";
    tasks.forEach(function (x) {
      var cb = S3.h("input", { type: "checkbox", "aria-label": "Done" });
      cb.checked = x.done;
      cb.addEventListener("click", function (e) { e.stopPropagation(); });
      cb.addEventListener("change", function () {
        x.done = cb.checked;
        var k = dayKey(new Date()), d = stats[k] || { min: 0, poms: 0, tasks: 0 };
        d.tasks = Math.max(0, (d.tasks || 0) + (x.done ? 1 : -1)); stats[k] = d; S3.store("focus.stats", stats);
        if (x.done && activeId === x.id) activeId = null;
        saveTasks(); renderAll();
      });
      var del = S3.h("button", { "class": "btn ghost icon small t-del", "aria-label": "Delete task", html: S3.icon("trash") });
      del.addEventListener("click", function (e) { e.stopPropagation(); tasks = tasks.filter(function (y) { return y !== x; }); if (activeId === x.id) activeId = null; saveTasks(); renderAll(); });
      var li = S3.h("li", { "class": (x.id === activeId ? "active " : "") + (x.done ? "done" : ""), tabindex: "0", title: "Make this the current task" }, [
        cb, S3.h("span", { "class": "t-name", dir: "auto", text: x.name }),
        S3.h("span", { "class": "t-count", text: "🍅 " + x.poms + " / " + x.est }), del
      ]);
      function pick() { activeId = activeId === x.id ? null : x.id; saveTasks(); renderAll(); }
      li.addEventListener("click", pick);
      li.addEventListener("keydown", function (e) { if (e.key === "Enter") pick(); });
      ul.appendChild(li);
    });
    $("#noTasks").hidden = tasks.length > 0;
  }
  function stat(label, value) { return '<div class="stat"><b>' + S3.esc(value) + "</b><span>" + S3.esc(label) + "</span></div>"; }
  function hm(min) { min = Math.round(min); return min >= 60 ? Math.floor(min / 60) + "h " + (min % 60) + "m" : min + "m"; }
  function renderStats() {
    var today = stats[dayKey(new Date())] || { min: 0, poms: 0, tasks: 0 }, week = 0, days = [], max = 1;
    for (var i = 6; i >= 0; i--) {
      var d = new Date(); d.setDate(d.getDate() - i);
      var m = (stats[dayKey(d)] || {}).min || 0; week += m; max = Math.max(max, m);
      days.push({ d: d, m: m, today: i === 0 });
    }
    $("#today").innerHTML = stat("focus today", hm(today.min)) + stat("pomodoros", today.poms) + stat("tasks done", today.tasks || 0) + stat("last 7 days", hm(week));
    $("#week").innerHTML = days.map(function (x) {
      return '<div class="bar' + (x.today ? " today" : "") + '" title="' + S3.esc(hm(x.m)) + '"><i style="height:' + Math.round(x.m / max * 100) + '%"></i><span>' +
        S3.esc(x.d.toLocaleDateString(undefined, { weekday: "short" })) + "</span></div>";
    }).join("");
  }
  function renderAll() { renderTimer(); renderTasks(); renderStats(); }

  // ---------- actions ----------
  function toggle() {
    if (t.running) pause(t, Date.now()); else { start(t, Date.now()); chimeUnlock(); }
    save(); renderTimer();
  }
  function chimeUnlock() { try { ctx = ctx || new (window.AudioContext || window.webkitAudioContext)(); if (ctx.state === "suspended") ctx.resume(); } catch (e) { /* no audio */ } }
  function reset() { t = fresh(t.mode, t.count); save(); renderTimer(); }
  function setMode(m) { t = fresh(m, t.count); save(); renderTimer(); }

  $("#start").addEventListener("click", toggle);
  $("#reset").addEventListener("click", reset);
  $("#skip").addEventListener("click", function () { complete(false); });
  $$("#mode button").forEach(function (b) { b.addEventListener("click", function () { setMode(b.dataset.v); }); });
  $("#addTask").addEventListener("submit", function (e) {
    e.preventDefault();
    var name = $("#taskName").value.trim(); if (!name) { $("#taskName").focus(); return; }
    var est = Math.min(20, Math.max(1, parseInt($("#taskEst").value, 10) || 1));
    var x = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: name.slice(0, 120), est: est, poms: 0, done: false };
    tasks.push(x); if (!activeId) activeId = x.id;
    $("#taskName").value = ""; $("#taskEst").value = 1; saveTasks(); renderAll();
  });
  $("#clearDone").addEventListener("click", function () { tasks = tasks.filter(function (x) { return !x.done; }); saveTasks(); renderAll(); });

  // settings
  var fields = { dFocus: "focus", dShort: "short", dLong: "long", every: "every" };
  Object.keys(fields).forEach(function (id) {
    var el = $("#" + id), key = fields[id];
    el.value = settings[key];
    el.addEventListener("change", function () {
      var v = parseFloat(el.value), lo = +el.min, hi = +el.max;
      if (!isFinite(v)) v = settings[key];
      v = Math.min(hi, Math.max(lo, key === "every" ? Math.round(v) : v));
      el.value = v; settings[key] = v; S3.store("focus.settings", settings);
      if (!t.running && t.remaining === t.total && key === t.mode) t = fresh(t.mode, t.count);
      save(); renderTimer();
    });
  });
  ["autoBreak", "autoFocus", "sound"].forEach(function (id) {
    var el = $("#" + id); el.checked = settings[id];
    el.addEventListener("change", function () { settings[id] = el.checked; S3.store("focus.settings", settings); });
  });
  $("#volume").value = settings.volume;
  $("#volume").addEventListener("input", function () { settings.volume = +$("#volume").value; S3.store("focus.settings", settings); });
  $("#testSound").addEventListener("click", function () { var s = settings.sound; settings.sound = true; chime(); settings.sound = s; });
  $("#notify").addEventListener("click", function () {
    if (!("Notification" in window)) return;
    Notification.requestPermission().then(notifyState);
  });

  document.addEventListener("keydown", function (e) {
    if (e.target.closest("input, textarea, select, [contenteditable]") || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === "Space") { e.preventDefault(); toggle(); }
    else if (e.key === "r" || e.key === "R") reset();
    else if (e.key === "s" || e.key === "S") complete(false);
  });
  // Ticks only refresh the display; the remaining time always comes from endAt - Date.now().
  setInterval(draw, 250);
  document.addEventListener("visibilitychange", draw);

  $("#ringFg").style.strokeDasharray = String(C);
  notifyState();
  renderAll();

  window.S3_DEMO = function () {
    tasks = [
      { id: "a", name: "Write project proposal", est: 4, poms: 2, done: false },
      { id: "b", name: "Review pull requests", est: 2, poms: 1, done: false },
      { id: "c", name: "مراجعة الفصل الثالث", est: 3, poms: 0, done: false },
      { id: "d", name: "Reply to emails", est: 1, poms: 1, done: true }
    ];
    activeId = "a";
    var mins = [50, 100, 75, 125, 25, 150, 75];
    for (var i = 6; i >= 0; i--) { var d = new Date(); d.setDate(d.getDate() - i); stats[dayKey(d)] = { min: mins[6 - i], poms: mins[6 - i] / 25, tasks: i ? 2 : 1 }; }
    t = fresh("focus", 2); t.remaining = 17 * 60000 + 42000; start(t, Date.now());
    renderAll();
  };

  window.S3_SELFTEST = function () {
    var tm = { running: false, remaining: 1500000, total: 1500000 };
    start(tm, 0); var a = remaining(tm, 60000) === 1440000;
    pause(tm, 60000); var b = tm.remaining === 1440000 && remaining(tm, 999999) === 1440000;
    start(tm, 100000); var c = tm.endAt === 1540000 && remaining(tm, 2000000) === 0;
    var seq = [], m = "focus", n = 0;
    for (var i = 0; i < 8; i++) { if (m === "focus") n++; m = nextMode(m, n, 4); seq.push(m); }
    var d = seq.join(",") === "short,focus,short,focus,short,focus,long,focus";
    var e = fmt(1500000) === "25:00" && fmt(61001) === "01:02" && fmt(0) === "00:00" && fmt(999) === "00:01";
    var f = dayKey(new Date(2026, 0, 5)) === "2026-01-05";
    return a && b && c && d && e && f;
  };
})();
