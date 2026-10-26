#!/usr/bin/env node
// Test runner for issue #7 (recurring tasks). See test-cases.md for the cases.
//   node todo/tests/issue-7/run.js            # unit + browser (e2e)
//   node todo/tests/issue-7/run.js --unit     # unit only
//   SCREENSHOTS=<dir> node ... run.js         # also save screenshots of key states
// Needs Node 18+, Python 3 (static server) and Chrome (CHROME_PATH to override).

const { spawn } = require("child_process");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");

const TODO_DIR = path.resolve(__dirname, "..", "..");
const results = [];
const check = (id, name, cond, detail = "") =>
  results.push({ id, ok: !!cond, line: `${cond ? "PASS" : "FAIL"} ${id} ${name}${!cond && detail ? " :: " + detail : ""}` });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- unit
function unit() {
  let R;
  try { R = require(path.join(TODO_DIR, "recurrence.js")); }
  catch (e) { ["TC-11", "TC-12", "TC-13u", "TC-17", "TC-25"].forEach((id) => check(id, "recurrence.js loads", false, e.message)); return; }

  check("TC-11", "monthly anchor 31: Jan 31 -> Feb 28 -> Mar 31",
    R.nextDue("2027-01-31", "monthly", 31, "2027-01-01") === "2027-02-28" &&
    R.nextDue("2027-02-28", "monthly", 31, "2027-01-01") === "2027-03-31",
    [R.nextDue("2027-01-31", "monthly", 31, "2027-01-01"), R.nextDue("2027-02-28", "monthly", 31, "2027-01-01")].join(","));
  check("TC-12", "leap year: Jan 31 2028 -> Feb 29",
    R.nextDue("2028-01-31", "monthly", 31, "2028-01-01") === "2028-02-29", R.nextDue("2028-01-31", "monthly", 31, "2028-01-01"));
  check("TC-13u", "missed occurrences skip to first date >= today",
    R.nextDue("2026-01-01", "daily", 1, "2026-01-10") === "2026-01-10" &&
    R.nextDue("2026-01-01", "weekly", 1, "2026-01-16") === "2026-01-22",
    [R.nextDue("2026-01-01", "daily", 1, "2026-01-10"), R.nextDue("2026-01-01", "weekly", 1, "2026-01-16")].join(","));
  check("TC-17", "year boundary",
    R.nextDue("2026-12-29", "weekly", 29, "2026-12-01") === "2027-01-05" &&
    R.nextDue("2026-12-31", "daily", 31, "2026-12-01") === "2027-01-01",
    [R.nextDue("2026-12-29", "weekly", 29, "2026-12-01"), R.nextDue("2026-12-31", "daily", 31, "2026-12-01")].join(","));

  {
    const T0 = "2026-10-26";
    const days = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000;
    let m, d, w, err = null;
    try {
      m = R.nextDue("1500-01-15", "monthly", 15, T0);
      d = R.nextDue("1900-01-01", "daily", 1, T0);
      w = R.nextDue("1900-01-01", "weekly", 1, T0);
    } catch (e) { err = e.message; }
    const wOk = !!w && days(w) >= days(T0) && days(w) - days(T0) < 7 && (days(w) - days("1900-01-01")) % 7 === 0;
    check("TC-31", "far-past due dates catch up to on/after today",
      !err && m === "2026-11-15" && d === T0 && wOk, err || JSON.stringify({ m, d, w }));
  }

  let threw = null, r = {};
  try {
    r.none = R.nextDue("2026-01-01", "x", 1, "2026-01-01");
    r.badDue = R.nextDue("garbage", "daily", 1, "2026-03-10");
    r.badAnchor = R.nextDue("2026-01-15", "monthly", 99, "2026-01-01");
    r.norm = ["yearly", "<b>", "", null, undefined, 3, "DAILY", "weekly"].map(R.normalizeRepeat);
    r.valid = [R.isValidDate("2026-02-29"), R.isValidDate("2028-02-29"), R.isValidDate("2026-13-01"), R.isValidDate("x")];
  } catch (e) { threw = e.message; }
  check("TC-25", "bad input never throws and is sanitized",
    !threw && r.none === null && r.badDue === "2026-03-11" && r.badAnchor === "2026-02-28" &&
    JSON.stringify(r.norm) === JSON.stringify(["none", "none", "none", "none", "none", "none", "none", "weekly"]) &&
    JSON.stringify(r.valid) === "[false,true,false,false]",
    threw || JSON.stringify(r));
}

// ---------------------------------------------------------------- e2e
function findChrome() {
  const c = [process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].filter(Boolean);
  return c.find((p) => fs.existsSync(p));
}
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });

async function e2e() {
  const chromePath = findChrome();
  if (!chromePath) { check("E2E", "Chrome found", false, "set CHROME_PATH"); return; }
  const httpPort = await freePort(), cdpPort = await freePort();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "todo-issue7-"));
  const shotsDir = process.env.SCREENSHOTS;
  const python = process.platform === "win32" ? "python" : "python3";
  const server = spawn(python, ["-m", "http.server", String(httpPort), "--bind", "127.0.0.1", "--directory", TODO_DIR], { stdio: "ignore" });
  const chrome = spawn(chromePath, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${profile}`, "--no-first-run", "--window-size=760,900", "about:blank"], { stdio: "ignore" });
  const BASE = `http://127.0.0.1:${httpPort}`;
  const consoleErrors = [];
  let ws;
  try {
    for (let i = 0; i < 50; i++) { try { await (await fetch(BASE + "/index.html")).text(); break; } catch { await sleep(200); } }
    let targets = [];
    for (let i = 0; i < 50 && !targets.length; i++) { try { targets = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).filter((t) => t.type === "page"); } catch {} if (!targets.length) await sleep(200); }
    ws = new WebSocket(targets[0].webSocketDebuggerUrl);
    await new Promise((r) => (ws.onopen = r));
    let nextId = 1; const pending = new Map(); const waiters = [];
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
      if (msg.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(msg.params.type))
        consoleErrors.push(msg.params.type + ": " + msg.params.args.map((a) => a.value ?? a.description).join(" "));
      if (msg.method === "Runtime.exceptionThrown") consoleErrors.push("exception: " + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text));
      if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error" && !/favicon/.test(msg.params.entry.url || "")) consoleErrors.push("log: " + msg.params.entry.text);
      for (const w of waiters.splice(0)) if (w.method === msg.method) w.resolve(); else waiters.push(w);
    };
    const send = (method, params = {}) => new Promise((resolve, reject) => { const id = nextId++; pending.set(id, (msg) => (msg.error ? reject(new Error(method + ": " + msg.error.message)) : resolve(msg.result))); ws.send(JSON.stringify({ id, method, params })); });
    const waitFor = (method) => new Promise((resolve) => waiters.push({ method, resolve }));
    await send("Page.enable"); await send("Runtime.enable"); await send("Log.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: 760, height: 900, deviceScaleFactor: 1, mobile: false });
    const nav = async (url) => { const loaded = waitFor("Page.loadEventFired"); await send("Page.navigate", { url: BASE + url }); await loaded; await sleep(400); };
    const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
    const shot = async (name) => { if (!shotsDir) return; fs.mkdirSync(shotsDir, { recursive: true }); const { cssContentSize } = await send("Page.getLayoutMetrics"); const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: 760, height: Math.ceil(Math.max(cssContentSize.height, 600)), scale: 1 } }); fs.writeFileSync(path.join(shotsDir, name), Buffer.from(data, "base64")); };

    // Seed IndexedDB at a given schema version with raw records (bypasses the app).
    // Runs on a blank same-origin page so the app isn't holding the database open.
    const seed = async (version, records) => { await nav("/tests/issue-7/blank.html"); return ev(`
      await new Promise(r => { const d = indexedDB.deleteDatabase("todo-app"); d.onsuccess = d.onerror = d.onblocked = r; });
      await new Promise((resolve, reject) => { const q = indexedDB.open("todo-app", ${version});
        q.onupgradeneeded = () => q.result.createObjectStore("tasks", { keyPath: "id", autoIncrement: true });
        q.onsuccess = () => { const tx = q.result.transaction("tasks", "readwrite"); for (const r of ${JSON.stringify(records)}) tx.objectStore("tasks").add(r);
          tx.oncomplete = () => { q.result.close(); resolve(); }; }; q.onerror = () => reject(q.error); });`); };
    const H = `window.T = {
      wait: (ms = 250) => new Promise(r => setTimeout(r, ms)),
      ymd(o) { const d = new Date(); d.setDate(d.getDate() + o); const p = n => String(n).padStart(2, "0"); return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()); },
      titles: () => [...document.querySelectorAll("#task-list .title")].map(e => e.textContent),
      items: (t) => [...document.querySelectorAll(".task")].filter(l => l.querySelector(".title").textContent === t),
      async add(title, due, tags, repeat) { const f = id => document.getElementById(id);
        f("task-title").value = title; f("task-due").value = due || ""; f("task-tags").value = tags || ""; if (f("task-repeat")) f("task-repeat").value = repeat || "none";
        f("new-task").requestSubmit(); await T.wait(); },
      async status(s) { document.querySelector('#status-filter [data-status="' + s + '"]').click(); await T.wait(); },
      async tag(v) { const s = document.getElementById("tag-filter"); s.value = v; s.dispatchEvent(new Event("change")); await T.wait(); },
      async tick(t, which = 0) { T.items(t)[which].querySelector("input[type=checkbox]").click(); await T.wait(); },
      all: () => TodoDB.all(),
      reset: async () => { for (const t of await TodoDB.all()) await TodoDB.remove(t.id); await render(); await T.wait(); },
    };`;
    const open = async () => { await nav("/index.html"); await ev(H); };

    // TC-18: v2 -> v3 migration
    await seed(2, [
      { title: "Old A", done: false, createdAt: 1000, due: null, tags: ["home"] },
      { title: "Old B", done: true, createdAt: 2000, due: "2026-01-02", tags: [] }]);
    await open();
    let r = await ev(`const all = await T.all(); return { all, titles: T.titles(), badges: document.querySelectorAll(".repeat").length };`);
    check("TC-18", "v2 data migrates to v3 with repeat none, no loss",
      r.all.length === 2 && r.all.every((t) => t.repeat === "none") && r.all.find((t) => t.title === "Old A").tags[0] === "home" && r.badges === 0, JSON.stringify(r));

    // TC-01
    r = await ev(`const s = document.getElementById("task-repeat"); return s ? { opts: [...s.options].map(o => o.value + ":" + o.textContent), value: s.value } : null;`);
    check("TC-01", "Repeat select None/Daily/Weekly/Monthly, default None",
      r && JSON.stringify(r.opts) === JSON.stringify(["none:None", "daily:Daily", "weekly:Weekly", "monthly:Monthly"]) && r.value === "none", JSON.stringify(r));

    // TC-02, TC-03, TC-06
    r = await ev(`await T.reset(); await T.add("Water plants", T.ymd(0), "garden", "daily");
      const all = await T.all(); const it = T.items("Water plants")[0];
      return { stored: all[0], badge: it && it.querySelector(".repeat")?.textContent, day: Number(T.ymd(0).slice(8)) };`);
    check("TC-02", "daily task created with badge, repeat, anchorDay",
      r.stored && r.stored.repeat === "daily" && r.stored.anchorDay === r.day && /🔁\s*Daily/.test(r.badge || ""), JSON.stringify(r));
    await shot("01-recurring-task-created.png");
    r = await ev(`await T.tick("Water plants"); const all = await T.all();
      const open = all.filter(t => t.title === "Water plants" && !t.done), done = all.filter(t => t.title === "Water plants" && t.done);
      return { open, done, tomorrow: T.ymd(1) };`);
    check("TC-03", "ticking daily keeps done occurrence and creates next due T+1",
      r.done.length === 1 && r.open.length === 1 && r.open[0].due === r.tomorrow && r.open[0].repeat === "daily" && JSON.stringify(r.open[0].tags) === '["garden"]', JSON.stringify(r));
    await shot("02-tick-creates-next-occurrence.png");
    r = await ev(`await T.status("completed"); const t = T.titles(); await T.status("all"); return t;`);
    check("TC-06", "completed occurrence kept in Completed", JSON.stringify(r) === '["Water plants"]', JSON.stringify(r));

    // TC-14 undo
    r = await ev(`const doneItem = T.items("Water plants").find(l => l.classList.contains("done")); doneItem.querySelector("input[type=checkbox]").click(); await T.wait();
      const all = (await T.all()).filter(t => t.title === "Water plants"); return { count: all.length, open: all.filter(t => !t.done).length, due: all.map(t => t.due) };`);
    check("TC-14", "unticking removes the auto-created open copy", r.count === 1 && r.open === 1, JSON.stringify(r));

    // TC-15 concurrent setDone
    r = await ev(`await T.reset(); await T.add("Vitamins", T.ymd(0), "", "daily"); const id = (await T.all())[0].id;
      await Promise.all([TodoDB.setDone(id, true), TodoDB.setDone(id, true)]); await render(); await T.wait();
      return (await T.all()).filter(t => t.title === "Vitamins").length;`);
    check("TC-15", "concurrent completes create exactly one copy", r === 2, String(r));

    // TC-04 weekly, TC-05 monthly
    r = await ev(`await T.reset(); await T.add("Team sync", T.ymd(2), "work", "weekly"); await T.tick("Team sync");
      const o = (await T.all()).find(t => t.title === "Team sync" && !t.done); return { o, exp: T.ymd(9) };`);
    check("TC-04", "weekly next = T+9 with tags", r.o && r.o.due === r.exp && r.o.repeat === "weekly" && r.o.tags[0] === "work", JSON.stringify(r));
    r = await ev(`await T.reset(); const due = T.ymd(3); await T.add("Pay rent", due, "", "monthly"); await T.tick("Pay rent");
      const o = (await T.all()).find(t => t.title === "Pay rent" && !t.done);
      const [y, m, d] = due.split("-").map(Number); const last = new Date(y, m + 1, 0).getDate(); const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
      const exp = ny + "-" + String(nm).padStart(2, "0") + "-" + String(Math.min(d, last)).padStart(2, "0");
      return { got: o && o.due, exp };`);
    check("TC-05", "monthly next = same day next month", r.got === r.exp, JSON.stringify(r));

    // TC-10 default due today
    r = await ev(`await T.reset(); await T.add("Stretch", "", "", "daily"); const t = (await T.all())[0]; const it = T.items("Stretch")[0];
      return { due: t.due, today: T.ymd(0), badge: it.querySelector(".due")?.textContent };`);
    check("TC-10", "repeat with no due date defaults to today", r.due === r.today && r.badge === "Due today", JSON.stringify(r));

    // TC-13 e2e missed occurrences
    r = await ev(`await T.reset(); await T.add("Journal", T.ymd(-5), "", "daily"); await T.tick("Journal");
      const o = (await T.all()).find(t => t.title === "Journal" && !t.done); return { got: o && o.due, exp: T.ymd(0) };`);
    check("TC-13", "overdue daily skips missed occurrences to today", r.got === r.exp, JSON.stringify(r));

    // TC-07 stop repeating
    r = await ev(`await T.reset(); await T.add("Gym", T.ymd(1), "", "weekly");
      const btn = T.items("Gym")[0].querySelector(".stop-repeat"); if (!btn) return { noButton: true }; btn.click(); await T.wait();
      const after = { repeat: (await T.all())[0].repeat, badge: !!T.items("Gym")[0].querySelector(".repeat"), btn: !!T.items("Gym")[0].querySelector(".stop-repeat") };
      await T.tick("Gym"); after.count = (await T.all()).length; return after;`);
    check("TC-07", "Stop repeating converts to normal task; no copy on tick", r.repeat === "none" && !r.badge && !r.btn && r.count === 1, JSON.stringify(r));

    // TC-08 delete ends series, TC-09 normal task
    r = await ev(`await T.reset(); await T.add("Laundry", T.ymd(0), "", "weekly"); await T.add("Plain", T.ymd(0), "", "none");
      T.items("Laundry")[0].querySelector(".delete").click(); await T.wait(); const afterDelete = (await T.all()).map(t => t.title);
      await T.tick("Plain"); const afterTick = (await T.all()).length; return { afterDelete, afterTick };`);
    check("TC-08", "deleting the open occurrence ends the series", JSON.stringify(r.afterDelete) === '["Plain"]', JSON.stringify(r));
    check("TC-09", "non-recurring tick creates no copy", r.afterTick === 1, JSON.stringify(r));

    // TC-19 filters, TC-20 sort + badges
    r = await ev(`await T.reset();
      await T.add("Overdue weekly", T.ymd(-1), "work", "weekly"); await T.add("Today daily", T.ymd(0), "home", "daily");
      await T.add("Later monthly", T.ymd(5), "work", "monthly"); await T.add("Undated", "", "misc", "none");
      const order = T.titles(); const od = T.items("Overdue weekly")[0].querySelector(".due").className; const td = T.items("Today daily")[0].querySelector(".due").className;
      await T.tick("Today daily");
      await T.status("active"); const active = T.titles(); await T.status("completed"); const completed = T.titles(); await T.status("all");
      await T.tag("home"); const home = T.titles(); await T.tag("");
      return { order, od, td, active, completed, home };`);
    check("TC-20", "sort overdue/today/later/undated and badges intact",
      JSON.stringify(r.order) === JSON.stringify(["Overdue weekly", "Today daily", "Later monthly", "Undated"]) && /overdue/.test(r.od) && /today/.test(r.td), JSON.stringify(r));
    check("TC-19", "status and tag filters work with recurring copies",
      r.active.length === 4 && r.active.includes("Today daily") && JSON.stringify(r.completed) === '["Today daily"]' && JSON.stringify(r.home) === '["Today daily","Today daily"]', JSON.stringify(r));
    await shot("03-recurring-badges-sorted.png");

    // TC-21 XSS through the recurrence path
    r = await ev(`await T.reset(); const title = "<img src=x onerror=window.pwned=1>"; await T.add(title, T.ymd(0), "<b>x</b>", "daily"); await T.tick(title);
      const items = T.items(title); return { n: items.length, injected: !!document.querySelector("#task-list img, #task-list b"), chips: items.map(i => i.querySelector(".chip")?.textContent), pwned: !!window.pwned };`);
    check("TC-21", "HTML in recurring title/tags renders as text in both occurrences",
      r.n === 2 && !r.injected && r.chips.every((c) => c === "#<b>x</b>") && !r.pwned, JSON.stringify(r));

    // TC-22 tampered repeat, TC-23 tampered due  (seed raw v3 records)
    await seed(3, [
      { title: "Evil repeat", done: false, createdAt: 1, due: null, tags: [], repeat: "<img src=x onerror=window.pwned=1>", anchorDay: 1 },
      { title: "Yearly", done: false, createdAt: 2, due: null, tags: [], repeat: "yearly", anchorDay: 1 },
      { title: "Bad due A", done: false, createdAt: 3, due: "not-a-date", tags: [], repeat: "daily", anchorDay: 5 },
      { title: "Bad due B", done: false, createdAt: 4, due: "2026-13-45", tags: [], repeat: "none", anchorDay: 5 }]);
    await open();
    r = await ev(`const r = { titles: T.titles().sort(), badges: document.querySelectorAll(".repeat").length, injected: !!document.querySelector("#task-list img"), pwned: !!window.pwned,
        dueBadges: ["Bad due A", "Bad due B"].map(t => !!T.items(t)[0]?.querySelector(".due")) };
      await T.tick("Evil repeat"); await T.tick("Yearly"); r.afterTick = (await T.all()).length;
      await T.tick("Bad due A"); const copy = (await T.all()).find(t => t.title === "Bad due A" && !t.done); r.badCopyDue = copy && copy.due; r.tomorrow = T.ymd(1); return r;`);
    check("TC-22", "tampered repeat values treated as none (no badge, no copy, no injection)",
      r.titles.length === 4 && !r.injected && !r.pwned && r.afterTick === 4, JSON.stringify(r));
    check("TC-23", "invalid stored due: no crash, no due badge, next copy based on today",
      JSON.stringify(r.dueBadges) === "[false,false]" && r.badCopyDue === r.tomorrow, JSON.stringify(r));

    // TC-16 persistence
    await ev(`await T.reset(); await T.add("Persist me", T.ymd(0), "keep", "weekly");`);
    await open();
    r = await ev(`const it = T.items("Persist me")[0]; const badge = it && it.querySelector(".repeat")?.textContent; await T.tick("Persist me");
      const all = (await T.all()).filter(t => t.title === "Persist me"); return { badge, n: all.length, next: all.find(t => !t.done)?.due, exp: T.ymd(7) };`);
    check("TC-16", "recurring data persists across reload and still recurs", /Weekly/.test(r.badge || "") && r.n === 2 && r.next === r.exp, JSON.stringify(r));
    await shot("04-after-reload.png");

    // TC-26..TC-29: regression cases from the code review of PR #11
    r = await ev(`await T.reset(); await T.add("Series", T.ymd(0), "", "daily");
      const A = (await T.all())[0].id; await TodoDB.setDone(A, true);
      const B = (await T.all()).find(t => t.id !== A).id; await TodoDB.setDone(B, true);
      await TodoDB.setDone(A, false); await TodoDB.setDone(A, true); await render(); await T.wait();
      const all = (await T.all()).filter(t => t.title === "Series");
      return { total: all.length, open: all.filter(t => !t.done).length, aDone: all.find(t => t.id === A).done };`);
    check("TC-26", "re-ticking an older occurrence does not start a second series",
      r.total === 3 && r.open === 1 && r.aDone === true, JSON.stringify(r));

    r = await ev(`await T.reset(); await T.add("Weekly", T.ymd(1), "", "weekly");
      const A = (await T.all())[0].id; await TodoDB.setDone(A, true);
      const B = (await T.all()).find(t => t.id !== A).id; await TodoDB.stopRepeating(B);
      await TodoDB.setDone(A, false); await TodoDB.setDone(A, true); await render(); await T.wait();
      const all = await T.all(); const b = all.find(t => t.id === B);
      return { total: all.length, bExists: !!b, bRepeat: b && b.repeat, repeatingOpen: all.filter(t => !t.done && t.repeat !== "none").length };`);
    check("TC-27", "undo keeps a copy whose series was stopped; series stays ended",
      r.total === 2 && r.bExists && r.bRepeat === "none" && r.repeatingOpen === 0, JSON.stringify(r));

    r = await ev(`await T.reset(); await T.add("Deleted copy", T.ymd(0), "", "daily");
      const A = (await T.all())[0].id; await TodoDB.setDone(A, true);
      const B = (await T.all()).find(t => t.id !== A).id; await TodoDB.remove(B);
      await TodoDB.setDone(A, false); await TodoDB.setDone(A, true); await render(); await T.wait();
      return (await T.all()).length;`);
    check("TC-28", "undo after the copy was deleted does not restart the series", r === 1, String(r));

    r = await ev(`await T.reset(); await T.add("Head check", T.ymd(0), "", "daily");
      const A = (await T.all())[0].id; await TodoDB.setDone(A, true);
      const B = (await T.all()).find(t => t.id !== A).id; await TodoDB.remove(B);
      await TodoDB.setDone(A, false); await render(); await T.wait();
      const it = T.items("Head check")[0];
      const reopened = { badge: !!it.querySelector(".repeat"), stop: !!it.querySelector(".stop-repeat") };
      await T.add("Done history", T.ymd(0), "", "weekly"); await T.tick("Done history");
      const doneItem = T.items("Done history").find(l => l.classList.contains("done"));
      const openItem = T.items("Done history").find(l => !l.classList.contains("done"));
      const history = { doneBadge: !!doneItem.querySelector(".repeat"), openBadge: !!openItem.querySelector(".repeat") };
      await TodoDB.setDone(A, true); const count = (await T.all()).filter(t => t.title === "Head check").length;
      return { reopened, history, count };`);
    check("TC-30", "only the open head of a series shows 🔁 / Stop repeating",
      !r.reopened.badge && !r.reopened.stop && !r.history.doneBadge && r.history.openBadge && r.count === 1, JSON.stringify(r));

    r = await ev(`await T.reset(); await T.add("Nested", T.ymd(0), "", "daily");
      const ids = [(await T.all())[0].id];
      for (let i = 0; i < 3; i++) { await TodoDB.setDone(ids[i], true); ids.push((await T.all()).find(t => !ids.includes(t.id)).id); }
      await TodoDB.setDone(ids[1], false); await TodoDB.setDone(ids[0], false); await render(); await T.wait();
      const all = await T.all();
      return { badges: document.querySelectorAll(".repeat").length, heads: all.filter(t => !t.done && t.repeat !== "none" && t.nextId == null).map(t => t.id), D: ids[3] };`);
    check("TC-32", "nested undo leaves exactly one live series head",
      r.badges === 1 && r.heads.length === 1 && r.heads[0] === r.D, JSON.stringify(r));

    r = await ev(`await T.reset(); await T.add("One-off", T.ymd(0), "", "daily");
      const A = (await T.all())[0].id; await TodoDB.setDone(A, true);
      const B = (await T.all()).find(t => t.id !== A).id; await TodoDB.setDone(B, true);
      await TodoDB.setDone(A, false); await render(); await T.wait();
      const a = (await T.all()).find(t => t.id === A); const badge = !!T.items("One-off").find(l => l.dataset.id == A).querySelector(".repeat");
      await TodoDB.setDone(A, true); return { aRepeat: a.repeat, aDone: a.done, badge, total: (await T.all()).length };`);
    check("TC-33", "reopened past occurrence becomes a one-off; re-tick creates nothing",
      r.aRepeat === "none" && r.aDone === false && !r.badge && r.total === 3, JSON.stringify(r));

    r = await ev(`await T.reset(); await T.add("Before", "", "", "none");
      await new Promise(res => { const d = indexedDB.deleteDatabase("todo-app"); d.onsuccess = d.onerror = d.onblocked = res; });
      let err = null; try { await TodoDB.add("After", {}); await render(); await T.wait(); } catch (e) { err = String(e); }
      return { err, titles: T.titles() };`);
    check("TC-34", "works after the database is deleted/upgraded elsewhere",
      !r.err && JSON.stringify(r.titles) === '["After"]', JSON.stringify(r));

    r = await ev(`await T.reset(); const realAdd = TodoDB.add;
      TodoDB.add = () => Promise.reject(new Error("TC-35 injected failure"));
      document.getElementById("task-title").value = "Keep me"; document.getElementById("new-task").requestSubmit(); await T.wait(400);
      TodoDB.add = realAdd;
      const el = document.querySelector("[role=alert]");
      return { visible: !!el && !el.hidden && el.textContent.length > 0, text: el && el.textContent, kept: document.getElementById("task-title").value };`);
    check("TC-35", "storage errors are shown to the user and input is kept",
      r.visible && /add the task/i.test(r.text || "") && r.kept === "Keep me", JSON.stringify(r));
    await ev(`document.getElementById("task-title").value = ""; const el = document.querySelector("[role=alert]"); if (el) el.hidden = true;`);

    r = await ev(`await T.reset(); await T.add("Real", "", "", "none"); const realAll = TodoDB.all;
      TodoDB.all = () => Promise.reject(new Error("TC-37 injected failure")); await render();
      const shown = !document.getElementById("error").hidden;
      TodoDB.all = realAll; await T.status("active"); await T.status("all");
      return { shown, hiddenAfter: document.getElementById("error").hidden, titles: T.titles() };`);
    check("TC-37", "error box clears once loading works again",
      r.shown && r.hiddenAfter && JSON.stringify(r.titles) === '["Real"]', JSON.stringify(r));

    r = await ev(`const realAll = TodoDB.all; let n = 0;
      TodoDB.all = async () => { n++; if (n === 1) { await T.wait(400);
        return [{ id: 999, title: "Stale", done: false, createdAt: 1, due: null, tags: [], repeat: "none", anchorDay: null, nextId: null, spawnedFrom: null }]; }
        return realAll(); };
      const p1 = render(); const p2 = render(); await Promise.all([p1, p2]); TodoDB.all = realAll;
      return T.titles();`);
    check("TC-38", "an older redraw cannot overwrite a newer one", JSON.stringify(r) === '["Real"]', JSON.stringify(r));

    r = await ev(`await T.reset(); await T.add("Loss", T.ymd(0), "", "daily");
      const A = (await T.all())[0].id; await TodoDB.setDone(A, true);
      const B = (await T.all()).find(t => t.id !== A).id; await TodoDB.stopRepeating(B);
      await TodoDB.setDone(A, false); await TodoDB.setDone(A, true); await TodoDB.setDone(A, false);
      const b = (await T.all()).find(t => t.id === B); return { bExists: !!b, bOpen: !!b && !b.done, total: (await T.all()).length };`);
    check("TC-39", "reopening never deletes a separate task (data loss)", r.bExists && r.bOpen && r.total === 2, JSON.stringify(r));

    r = await ev(`await T.reset(); const realAdd = TodoDB.add;
      TodoDB.add = async (...a) => { await T.wait(300); return realAdd.apply(TodoDB, a); };
      const f = document.getElementById("new-task"), i = document.getElementById("task-title");
      i.value = "Buy milk"; f.requestSubmit(); f.requestSubmit(); await T.wait(700);
      TodoDB.add = realAdd; return (await T.all()).filter(t => t.title === "Buy milk").length;`);
    check("TC-40", "fast double submit adds the task once", r === 1, String(r));

    r = await ev(`await T.reset(); const realAdd = TodoDB.add;
      TodoDB.add = async (...a) => { await T.wait(300); return realAdd.apply(TodoDB, a); };
      const f = document.getElementById("new-task"), i = document.getElementById("task-title");
      i.value = "Buy milk"; f.requestSubmit(); await T.wait(50); i.value = "Call mom"; await T.wait(600);
      TodoDB.add = realAdd; const kept = i.value; i.value = "";
      return { titles: T.titles(), kept };`);
    check("TC-41", "typing during an in-flight add is kept", JSON.stringify(r.titles) === '["Buy milk"]' && r.kept === "Call mom", JSON.stringify(r));

    await seed(3, [
      { title: "Tags", done: false, createdAt: 1, due: null, tags: [null, {}, 5, "ok", true, ["x"]], repeat: "none", anchorDay: null }]);
    await open();
    r = await ev(`return [...document.querySelectorAll("#task-list .chip")].map(c => c.textContent);`);
    check("TC-36", "tampered tag values dropped; numbers kept as text", JSON.stringify(r) === '["#5","#ok"]', JSON.stringify(r));

    await seed(3, [
      { title: "Bad monthly", done: false, createdAt: "oops", due: "bad", tags: [], repeat: "monthly", anchorDay: "x" },
      { title: "Normal", done: false, createdAt: 5, due: null, tags: [], repeat: "none", anchorDay: null }]);
    await open();
    r = await ev(`const before = await T.all(); const r = { titles: T.titles(), createdAtOk: before.every(t => Number.isFinite(t.createdAt)) };
      await T.tick("Bad monthly"); const copy = (await T.all()).find(t => t.title === "Bad monthly" && !t.done);
      r.copy = copy; r.todayDay = Number(T.ymd(0).slice(8)); r.dueValid = !!copy && Recurrence.isValidDate(copy.due); return r;`);
    check("TC-29", "invalid stored monthly fields: no crash, stable sort, numeric anchorDay, valid due",
      r.titles.length === 2 && r.createdAtOk && r.copy && Number.isInteger(r.copy.anchorDay) && r.copy.anchorDay === r.todayDay && r.dueValid, JSON.stringify(r));

    // Visual states for the PR
    if (shotsDir) {
      await ev(`await T.reset(); await T.add("Pay rent", T.ymd(-1), "home, bills", "monthly"); await T.add("Water plants", T.ymd(0), "garden", "daily");
        await T.add("Team sync", T.ymd(2), "work", "weekly"); await T.add("Buy milk", "", "shopping", "none");`);
      await shot("05-overview.png");
      await ev(`await T.tick("Water plants"); await T.tick("Team sync");`); await shot("06-after-completing-two.png");
      await ev(`await T.status("completed");`); await shot("07-completed-history.png");
    }
  } catch (e) {
    check("E2E", "browser run", false, e.stack || e.message);
  } finally {
    // TC-35 and TC-37 inject storage failures on purpose; their logged errors are expected.
    const unexpected = consoleErrors.filter((m) => !/TC-3[57] injected failure/.test(m));
    check("TC-24", "no console errors or exceptions", unexpected.length === 0, unexpected.join(" | "));
    try { ws && ws.close(); } catch {}
    chrome.kill(); server.kill();
    await sleep(300); try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  }
}

(async () => {
  unit();
  if (!process.argv.includes("--unit")) await e2e();
  const order = (id) => Number((id.match(/\d+/) || [999])[0]);
  results.sort((a, b) => order(a.id) - order(b.id));
  for (const r of results) console.log(r.line);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
