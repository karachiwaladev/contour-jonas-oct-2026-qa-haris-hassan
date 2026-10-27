#!/usr/bin/env node
// Test runner for ticket #25 (search box and due-date filter). See test-cases.md.
//   node todo/tests/issue-25/run.js                    # e2e + regression (issue-15, which runs issue-14 and issue-7)
//   node todo/tests/issue-25/run.js --skip-regression  # skip TC-31
//   SCREENSHOTS=<dir> node ... run.js                  # also save screenshots
// Every e2e case is tagged in the app log; at the end the eval checks the run
// against test-cases.md + expected-log.json (eval/eval-report.{md,json}).
// Typing goes through the DevTools Input domain (real key/text events), so
// maxlength and the page's own input/keydown handlers apply as for a person.

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { TODO_DIR, sleep, createChecker, startBrowser, runEval } = require("../lib/harness");

const HERE = __dirname;
const { check, report } = createChecker();
const args = process.argv.slice(2);
const DEBOUNCE_WAIT = 700; // longer than the app's ~400 ms search-log debounce
const ymd = (o) => { const d = new Date(); d.setDate(d.getDate() + o); const p = (n) => String(n).padStart(2, "0"); return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()); };

async function e2e() {
  let b;
  try { b = await startBrowser(); } catch (e) { check("E2E", "browser starts", false, e.message); return; }
  const { nav, ev, send, shot, consoleErrors } = b;
  const collected = new Map();
  let r;

  const H = `window.T = {
    wait: (ms = 250) => new Promise(r => setTimeout(r, ms)),
    ymd(o) { const d = new Date(); d.setDate(d.getDate() + o); const p = n => String(n).padStart(2, "0"); return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()); },
    titles: () => [...document.querySelectorAll("#task-list .title")].map(e => e.textContent),
    sorted: () => T.titles().slice().sort(),
    items: (t) => [...document.querySelectorAll(".task")].filter(l => (l.querySelector(".title") || {}).textContent === t),
    item: (id) => document.querySelector('.task[data-id="' + id + '"]'),
    search: () => document.getElementById("search-filter"),
    count: () => document.getElementById("count").textContent,
    emptyMsg: () => { const e = document.getElementById("empty"); return e.hidden ? null : e.textContent; },
    async add(title, opts = {}) { const f = id => document.getElementById(id);
      f("task-title").value = title; f("task-due").value = opts.due || ""; f("task-tags").value = opts.tags || "";
      f("task-repeat").value = opts.repeat || "none"; if (opts.priority) f("task-priority").value = opts.priority;
      f("new-task").requestSubmit(); await T.wait(); await TodoLog.flush();
      const all = (await TodoDB.all()).filter(t => t.title === title); return all[all.length - 1].id; },
    async tick(title) { T.items(title)[0].querySelector("input[type=checkbox]").click(); await T.wait(); },
    async filter(id, v) { const s = document.getElementById(id); s.value = v; s.dispatchEvent(new Event("change")); await T.wait(); },
    async status(s) { document.querySelector('#status-filter [data-status="' + s + '"]').click(); await T.wait(); },
    async reset() { for (const t of await TodoDB.all()) await TodoDB.remove(t.id); await render(); await TodoLog.flush(); },
    async entries(tc) { await TodoLog.flush(); return (await TodoLog.all()).filter(e => !tc || e.testCase === tc); },
    get: async (id) => (await TodoDB.all()).find(t => t.id === id),
  };`;
  // A fresh page: tasks persist, filters reset (and any pending search log is dropped).
  const open = async () => { await nav("/index.html"); await ev(H); };
  const collect = async () => {
    try { for (const e of await ev(`await TodoLog.flush(); return await TodoLog.all();`)) collected.set(`${e.sessionId}:${e.seq}`, e); } catch {}
  };
  const tag = async (id) => { await collect(); await ev(`TodoLog.setTestCase(${JSON.stringify(id)});`); };
  // Fresh page with exactly these tasks; `done` titles are ticked afterwards.
  const fresh = async (tasks = [], done = []) => {
    await open();
    await ev(`await T.reset(); for (const [t, o] of ${JSON.stringify(tasks)}) await T.add(t, o || {});
      for (const t of ${JSON.stringify(done)}) await T.tick(t);`);
    await open();
  };

  // ---- real input through DevTools ----
  const focusSearch = () => ev(`const s = document.getElementById("search-filter"); if (!s) throw new Error("no search box"); s.focus();`);
  // Type text into the search box, one character at a time (gap ms between keys).
  const type = async (text, gap = 30) => {
    await focusSearch();
    for (const ch of [...text]) { await send("Input.insertText", { text: ch }); if (gap) await sleep(gap); }
  };
  const key = async (name, code) => {
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: name, code: name, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: name, code: name, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
  };
  // Select all + delete, like a person clearing the box.
  const clearBox = async () => { await ev(`const s = document.getElementById("search-filter"); s.focus(); s.select();`); await key("Backspace", 8); };
  // Replace the search text: clear, then type.
  const search = async (text, gap = 30) => { await clearBox(); await type(text, gap); await sleep(150); };
  const settle = () => sleep(DEBOUNCE_WAIT);
  // Run one case; an exception fails only that case.
  const ran = new Set();
  const tc = async (id, name, fn) => {
    ran.add(id);
    try { await fn(); } catch (e) { check(id, name, false, "error: " + String(e && e.message || e).split("
")[0]); }
  };
  const searchEntries = (tc) => ev(`return (await T.entries(${JSON.stringify(tc)})).filter(e => e.action === "ui.filter_search").map(e => e.changes && e.changes.search);`);

  try {
    // TC-01 search box and Due filter exist
    await open(); await tag("TC-01");
    r = await ev(`const s = document.getElementById("search-filter"), d = document.getElementById("due-filter");
      return { search: s && { type: s.type, label: s.getAttribute("aria-label") || (s.labels && s.labels[0] && s.labels[0].textContent) || "", max: s.maxLength, value: s.value,
                 inBar: !!s.closest(".filters") },
               due: d && { opts: [...d.options].map(o => o.value + ":" + o.textContent), value: d.value, label: d.getAttribute("aria-label") || "", inBar: !!d.closest(".filters") } };`);
    check("TC-01", "search box (labelled, maxlength 200, empty) and Due select with 5 options, Any selected",
      r.search && r.search.type === "search" && r.search.label.trim() && r.search.max === 200 && r.search.value === "" && r.search.inBar &&
      r.due && JSON.stringify(r.due.opts) === JSON.stringify([":Any due date", "overdue:Overdue", "today:Due today", "week:Next 7 days", "none:No due date"]) &&
      r.due.value === "" && r.due.label.trim() && r.due.inBar, JSON.stringify(r));
    await collect();

    // TC-02 search by title as you type
    await fresh([["Buy milk"], ["Pay rent"], ["Milkshake recipe"]]);
    await tag("TC-02");
    const steps = [];
    await focusSearch();
    for (const ch of "milk") { await send("Input.insertText", { text: ch }); await sleep(80); steps.push(await ev(`return T.titles().length;`)); }
    await settle();
    r = { steps, final: await ev(`return T.sorted();`) };
    check("TC-02", "list narrows after each keystroke; finally Buy milk + Milkshake recipe",
      steps.length === 4 && steps[0] < 3 && steps.every((n, i) => i === 0 || n <= steps[i - 1]) &&
      JSON.stringify(r.final) === JSON.stringify(["Buy milk", "Milkshake recipe"]), JSON.stringify(r));
    await collect();

    // TC-03 search by tag
    await fresh([["A", { tags: "work" }], ["B", { tags: "home" }], ["C"]]);
    await tag("TC-03");
    await search("wor"); await settle();
    r = await ev(`return T.sorted();`);
    check("TC-03", "partial tag match: only A", JSON.stringify(r) === '["A"]', JSON.stringify(r));
    await collect();

    // TC-04 any case
    await fresh([["Buy MILK"], ["Other"]]);
    await tag("TC-04");
    await search("Milk"); const a4 = await ev(`return T.sorted();`);
    await search("mILK"); const b4 = await ev(`return T.sorted();`);
    await settle();
    check("TC-04", "case-insensitive: Buy MILK both times", JSON.stringify(a4) === '["Buy MILK"]' && JSON.stringify(b4) === '["Buy MILK"]', JSON.stringify({ a4, b4 }));
    await collect();

    // TC-05 leading # searches tags only
    await fresh([["Report", { tags: "work" }], ["Work out"]]);
    await tag("TC-05");
    await search("#work"); await settle();
    r = await ev(`return T.sorted();`);
    check("TC-05", "#work matches tag names only: Report", JSON.stringify(r) === '["Report"]', JSON.stringify(r));
    await collect();

    // TC-06 spaces trimmed
    await fresh([["Buy milk"], ["Other"]]);
    await tag("TC-06");
    await search("   milk  "); await settle();
    r = await ev(`return T.sorted();`);
    check("TC-06", "surrounding spaces trimmed: Buy milk", JSON.stringify(r) === '["Buy milk"]', JSON.stringify(r));
    await collect();

    // TC-07 spaces only = no search
    await fresh([["One"], ["Two"], ["Three"]]);
    await tag("TC-07");
    await type("   "); await settle();
    r = await ev(`return { n: T.titles().length, c: T.count(), v: T.search().value };`);
    check("TC-07", "spaces only: all 3 show, no 'showing N'", r.n === 3 && !/showing/.test(r.c) && r.v === "   ", JSON.stringify(r));
    await collect();

    // TC-08 clearing shows everything
    await fresh([["Buy milk"], ["Pay rent"], ["Bread"]]);
    await search("milk"); await settle();
    const before8 = await ev(`return { n: T.titles().length, c: T.count() };`);
    await tag("TC-08");
    await clearBox(); await settle();
    r = await ev(`return { n: T.titles().length, c: T.count(), v: T.search().value };`);
    check("TC-08", "clearing the box shows all 3 and drops 'showing N'",
      before8.n === 1 && /showing 1/.test(before8.c) && r.n === 3 && !/showing/.test(r.c) && r.v === "", JSON.stringify({ before8, r }));
    await collect();

    // TC-09 Escape clears
    await search("milk"); await settle();
    const before9 = await ev(`return T.titles().length;`);
    await tag("TC-09");
    await focusSearch(); await key("Escape", 27); await settle();
    r = await ev(`return { n: T.titles().length, v: T.search().value };`);
    check("TC-09", "Escape empties the box and shows all tasks", before9 === 1 && r.n === 3 && r.v === "", JSON.stringify({ before9, r }));
    await collect();

    // TC-10 no matches
    await open(); await tag("TC-10");
    await search("zzzz"); await settle();
    r = await ev(`return { n: T.titles().length, msg: T.emptyMsg(), c: T.count() };`);
    check("TC-10", "no matches: empty list, 'No tasks match this filter.', 'showing 0'",
      r.n === 0 && r.msg === "No tasks match this filter." && /· showing 0$/.test(r.c), JSON.stringify(r));
    await collect();

    // TC-11 Due: Overdue
    await open();
    await ev(`await T.reset(); await T.add("Late", { due: T.ymd(-2) }); await T.add("Today", { due: T.ymd(0) });
      await T.add("Done late", { due: T.ymd(-3) }); await T.add("Undated"); await T.tick("Done late");`);
    await open(); await tag("TC-11");
    r = await ev(`await T.filter("due-filter", "overdue"); return T.sorted();`);
    check("TC-11", "Overdue: only the open T-2 task", JSON.stringify(r) === '["Late"]', JSON.stringify(r));
    await collect();

    // TC-12 Due: Due today
    await open();
    await ev(`await T.reset(); await T.add("Yesterday", { due: T.ymd(-1) }); await T.add("Today", { due: T.ymd(0) });
      await T.add("Tomorrow", { due: T.ymd(1) }); await T.add("Undated");`);
    await open(); await tag("TC-12");
    r = await ev(`await T.filter("due-filter", "today"); return T.sorted();`);
    check("TC-12", "Due today: only the T task", JSON.stringify(r) === '["Today"]', JSON.stringify(r));
    await collect();

    // TC-13 Due: Next 7 days
    await open();
    await ev(`await T.reset(); await T.add("T-1", { due: T.ymd(-1) }); await T.add("T", { due: T.ymd(0) });
      await T.add("T+6", { due: T.ymd(6) }); await T.add("T+7", { due: T.ymd(7) }); await T.add("Undated");`);
    await open(); await tag("TC-13");
    r = await ev(`await T.filter("due-filter", "week"); return T.sorted();`);
    check("TC-13", "Next 7 days: T and T+6 only", JSON.stringify(r) === '["T","T+6"]', JSON.stringify(r));
    await collect();

    // TC-14 Due: No due date
    await open();
    await ev(`await T.reset(); await T.add("Dated", { due: T.ymd(0) }); await T.add("Undated 1"); await T.add("Undated 2");`);
    await open(); await tag("TC-14");
    r = await ev(`await T.filter("due-filter", "none"); return T.sorted();`);
    check("TC-14", "No due date: the 2 undated tasks", JSON.stringify(r) === '["Undated 1","Undated 2"]', JSON.stringify(r));
    await collect();

    // TC-15 Due: Any resets
    await ev(`await T.filter("due-filter", "overdue");`);
    const before15 = await ev(`return T.titles().length;`);
    await tag("TC-15");
    r = await ev(`await T.filter("due-filter", ""); return { n: T.titles().length, c: T.count() };`);
    check("TC-15", "Any due date shows all tasks again", before15 === 0 && r.n === 3 && !/showing/.test(r.c), JSON.stringify({ before15, r }));
    await collect();

    // TC-16 search + status
    await fresh([["Milk A"], ["Milk B"]], ["Milk B"]);
    await tag("TC-16");
    await search("milk"); await settle();
    r = await ev(`await T.status("active"); return T.sorted();`);
    check("TC-16", "search milk + Active: only Milk A", JSON.stringify(r) === '["Milk A"]', JSON.stringify(r));
    await collect();

    // TC-17 search + tag + priority
    await fresh([["Milk", { priority: "high", tags: "shop" }], ["Milk", { priority: "low", tags: "shop" }], ["Milk", { priority: "high", tags: "home" }]]);
    await tag("TC-17");
    await search("milk"); await settle();
    r = await ev(`await T.filter("tag-filter", "shop"); await T.filter("priority-filter", "high");
      return [...document.querySelectorAll("#task-list .task")].map(li => ({ t: li.querySelector(".title").textContent,
        p: li.querySelector(".priority").textContent, chips: [...li.querySelectorAll(".chip")].map(c => c.textContent) }));`);
    check("TC-17", "search + tag shop + High: only the High shop task",
      r.length === 1 && r[0].t === "Milk" && r[0].p === "High" && JSON.stringify(r[0].chips) === '["#shop"]', JSON.stringify(r));
    await collect();

    // TC-18 all five filters combine; clearing each in turn widens the list
    await open();
    await ev(`await T.reset();
      await T.add("Report", { priority: "high", tags: "work", due: T.ymd(2) });
      await T.add("Report later", { priority: "high", tags: "work", due: T.ymd(10) });
      await T.add("Report low", { priority: "low", tags: "work", due: T.ymd(2) });
      await T.add("Report home", { priority: "high", tags: "home", due: T.ymd(2) });
      await T.add("Report done", { priority: "high", tags: "work", due: T.ymd(2) });
      await T.add("Other", { priority: "high", tags: "work", due: T.ymd(2) });
      await T.tick("Report done");`);
    await open(); await tag("TC-18");
    await search("rep"); await settle();
    r = await ev(`await T.status("active"); await T.filter("tag-filter", "work"); await T.filter("priority-filter", "high");
      await T.filter("due-filter", "week"); const out = [T.sorted()];
      await T.filter("due-filter", ""); out.push(T.titles().length);
      await T.filter("priority-filter", ""); out.push(T.titles().length);
      await T.filter("tag-filter", ""); out.push(T.titles().length);
      await T.status("all"); out.push(T.titles().length);
      return out;`);
    await clearBox(); await settle();
    const all18 = await ev(`return T.titles().length;`);
    r.push(all18);
    check("TC-18", "all five filters: only Report; clearing due, priority, tag, status, search widens 2,3,4,5,6",
      JSON.stringify(r) === JSON.stringify([["Report"], 2, 3, 4, 5, 6]), JSON.stringify(r));
    await collect();

    // TC-19 list updates while searching
    await fresh([["Buy milk"], ["Milkshake"], ["Bread"]]);
    await search("milk"); await settle();
    await tag("TC-19");
    r = await ev(`const out = {};
      await T.add("Oat milk"); out.afterAdd = T.sorted();
      await T.tick("Buy milk"); out.afterTick = T.titles();
      T.items("Milkshake")[0].querySelector(".delete").click(); await T.wait(); await TodoLog.flush();
      out.afterDelete = T.sorted(); out.box = T.search().value; return out;`);
    check("TC-19", "add/tick/delete while searching: list follows, search stays",
      JSON.stringify(r.afterAdd) === '["Buy milk","Milkshake","Oat milk"]' &&
      r.afterTick[r.afterTick.length - 1] === "Buy milk" && r.afterTick.length === 3 &&
      JSON.stringify(r.afterDelete) === '["Buy milk","Oat milk"]' && r.box === "milk", JSON.stringify(r));
    await collect();

    // TC-20 filters reset on reload
    await ev(`await T.add("Late", { due: T.ymd(-1) });`);
    await open();
    await search("milk"); await settle();
    await ev(`await T.filter("due-filter", "overdue");`);
    await tag("TC-20");
    await send("Page.reload", {});
    await sleep(800);
    for (let i = 0; i < 30; i++) { if (await ev(`return document.readyState === "complete" && typeof window.render === "function";`).catch(() => false)) break; await sleep(100); }
    await sleep(400); await ev(H);
    r = await ev(`const all = await TodoDB.all(); return { v: T.search().value, due: document.getElementById("due-filter").value, n: T.titles().length, total: all.length, c: T.count() };`);
    check("TC-20", "after reload: box empty, Due Any, all tasks show",
      r.v === "" && r.due === "" && r.n === r.total && r.total === 3 && !/showing/.test(r.c), JSON.stringify(r));
    await collect();

    // TC-21 regex characters are literal
    await fresh([["Plan (draft)"], ["a.b"], ["Other"]]);
    await tag("TC-21");
    const errs21 = consoleErrors.length;
    const out21 = {};
    await search("("); out21.paren = await ev(`return T.sorted();`);
    await search(".*"); out21.star = await ev(`return T.sorted();`);
    await search("a.b"); out21.dot = await ev(`return T.sorted();`);
    await settle();
    out21.errors = consoleErrors.slice(errs21);
    check("TC-21", "regex characters match literally; no console errors",
      JSON.stringify(out21.paren) === '["Plan (draft)"]' && JSON.stringify(out21.star) === "[]" && JSON.stringify(out21.dot) === '["a.b"]' &&
      out21.errors.length === 0, JSON.stringify(out21));
    await collect();

    // TC-22 long and non-English queries
    await fresh([["Café crème"], ["東京 trip"]]);
    await tag("TC-22");
    await clearBox();
    await focusSearch(); await send("Input.insertText", { text: "x".repeat(250) }); await sleep(150);
    const len22 = await ev(`return T.search().value.length;`);
    await search("café"); const cafe = await ev(`return T.sorted();`);
    await search("東京"); const tokyo = await ev(`return T.sorted();`);
    await settle();
    check("TC-22", "box holds at most 200 chars; café and 東京 match",
      len22 === 200 && JSON.stringify(cafe) === '["Café crème"]' && JSON.stringify(tokyo) === '["東京 trip"]', JSON.stringify({ len22, cafe, tokyo }));
    await collect();

    // TC-23 empty list
    await fresh([]);
    await tag("TC-23");
    const errs23 = consoleErrors.length;
    await search("x"); await settle();
    await ev(`await T.filter("due-filter", "overdue");`);
    r = await ev(`return { msg: T.emptyMsg(), n: T.titles().length, box: document.getElementById("error").hidden };`);
    r.errors = consoleErrors.slice(errs23);
    check("TC-23", "no tasks + search + Overdue: 'No tasks yet. Add one above.', no errors",
      r.msg === "No tasks yet. Add one above." && r.n === 0 && r.box && r.errors.length === 0, JSON.stringify(r));
    await collect();

    // TC-24 HTML in the search box
    await fresh([["<img src=x onerror=window.__xss=1>"], ["Other"]]);
    await tag("TC-24");
    await search("<img"); await sleep(200);
    const a24 = await ev(`return { t: T.titles(), img: document.querySelectorAll("img").length, xss: typeof window.__xss };`);
    await search("<b>bold</b>"); await sleep(200);
    const b24 = await ev(`return { t: T.titles(), b: document.querySelectorAll("main b").length, img: document.querySelectorAll("img").length, xss: typeof window.__xss };`);
    await settle();
    check("TC-24", "HTML in titles and queries stays text; nothing injected",
      JSON.stringify(a24.t) === JSON.stringify(["<img src=x onerror=window.__xss=1>"]) && a24.img === 0 && a24.xss === "undefined" &&
      b24.t.length === 0 && b24.b === 0 && b24.img === 0 && b24.xss === "undefined", JSON.stringify({ a24, b24 }));
    await collect();

    // TC-25 search text never logged
    await fresh([["Buy milk"]]);
    await tag("TC-25");
    await search("secret-word-42"); await settle();
    await clearBox(); await settle();
    r = await ev(`const s = (await T.entries("TC-25")).filter(e => e.action === "ui.filter_search").map(e => e.changes.search);
      const all = JSON.stringify(await TodoLog.all()) + await TodoLog.exportJSONL(); return { s, leak: all.includes("secret-word-42") };`);
    check("TC-25", "ui.filter_search logged set then cleared; query text never logged",
      JSON.stringify(r.s) === '["set","cleared"]' && !r.leak, JSON.stringify(r));
    await collect();

    // TC-26 logged once per pause
    await open(); await tag("TC-26");
    await type("milk", 40); await sleep(1000);
    r = await searchEntries("TC-26");
    check("TC-26", "a fast burst logs exactly one 'set'", JSON.stringify(r) === '["set"]', JSON.stringify(r));
    await collect();

    // TC-27 Due filter logged with its value
    await open(); await tag("TC-27");
    r = await ev(`for (const v of ["overdue", "today", "week", "none", ""]) await T.filter("due-filter", v);
      return (await T.entries("TC-27")).filter(e => e.action === "ui.filter_due").map(e => e.changes && e.changes.due);`);
    check("TC-27", "each Due choice logs ui.filter_due with its value",
      JSON.stringify(r) === JSON.stringify(["overdue", "today", "week", "none", "all"]), JSON.stringify(r));
    await collect();

    // TC-28 tag chip + search
    await fresh([["Milk", { tags: "shop" }], ["Bread", { tags: "shop" }], ["Oat milk"]]);
    await tag("TC-28");
    await search("milk"); await settle();
    r = await ev(`const li = T.items("Milk")[0]; li.querySelector(".chip").click(); await T.wait(); await TodoLog.flush();
      return { tag: document.getElementById("tag-filter").value, box: T.search().value, t: T.sorted(), done: (await TodoDB.all()).find(t => t.title === "Milk").done };`);
    check("TC-28", "chip sets tag filter, search stays, task not ticked",
      r.tag === "shop" && r.box === "milk" && JSON.stringify(r.t) === '["Milk"]' && r.done === false, JSON.stringify(r));
    await collect();

    // TC-29 edit form survives search re-renders
    await fresh([["Milk"], ["Bread"]]);
    const id29 = await ev(`return (await TodoDB.all()).find(t => t.title === "Milk").id;`);
    await tag("TC-29");
    await ev(`T.item(${id29}).querySelector(".edit").click(); await T.wait(100);
      const t = T.item(${id29}).querySelector(".edit-title"); t.value = "Draft"; t.dispatchEvent(new Event("input", { bubbles: true }));`);
    await type("mil"); await settle();
    r = await ev(`const f = T.item(${id29}) && T.item(${id29}).querySelector(".edit-form");
      const res = { open: !!f, title: f && f.querySelector(".edit-title").value, stored: (await T.get(${id29})).title, bread: T.items("Bread").length };
      if (f) f.querySelector(".edit-cancel").click(); await T.wait(); return res;`);
    check("TC-29", "edit form stays open with unsaved 'Draft' while searching",
      r.open && r.title === "Draft" && r.stored === "Milk" && r.bread === 0, JSON.stringify(r));
    await collect();

    // TC-30 phone width: search and Due, no horizontal scroll (console part checked at the end)
    await send("Emulation.setDeviceMetricsOverride", { width: 375, height: 800, deviceScaleFactor: 1, mobile: true });
    await fresh([["Buy milk", { tags: "shop", priority: "high", due: ymd(-1) }], ["Pay rent", { tags: "home" }]]);
    await tag("TC-30");
    await search("milk"); await settle();
    await ev(`await T.filter("due-filter", "overdue");`);
    const layout30 = await ev(`const de = document.documentElement; const vw = de.clientWidth;
      const bar = document.querySelector(".filters"); const parts = bar ? [...bar.querySelectorAll("input, select, button")] : [];
      return { vw, sw: de.scrollWidth, bodySw: document.body.scrollWidth, overflow: parts.filter(p => p.getBoundingClientRect().right > vw + 0.5).map(p => p.id || p.textContent),
        n: parts.length, t: T.titles() };`);
    await shot("01-phone-search-due.png");
    await send("Emulation.setDeviceMetricsOverride", { width: 760, height: 900, deviceScaleFactor: 1, mobile: false });
    await collect();

    // Screenshots for the PR (not test cases).
    if (process.env.SCREENSHOTS) {
      await ev(`TodoLog.setTestCase(null);`);
      await fresh([["Buy milk", { tags: "shop", priority: "high", due: ymd(1) }],
        ["Oat milk", { tags: "shop" }], ["Pay rent", { tags: "home", priority: "high" }], ["Read book", { priority: "low" }]]);
      await search("milk"); await settle();
      await shot("02-search-milk.png");
      await clearBox(); await settle();
      await ev(`await T.filter("due-filter", "week");`);
      await shot("03-due-next-7-days.png");
    }

    const unexpected = consoleErrors.slice();
    check("TC-30", "375 px: no horizontal scroll, filter bar wraps; no console errors in the run",
      layout30.sw <= layout30.vw && layout30.bodySw <= layout30.vw && layout30.overflow.length === 0 && layout30.n >= 5 &&
      JSON.stringify(layout30.t) === '["Buy milk"]' && unexpected.length === 0, JSON.stringify({ layout30, unexpected }));
  } catch (e) {
    check("E2E", "browser run", false, e.stack || e.message);
  } finally {
    await collect();
    await b.close();
  }
  runEval({ collected, suiteDir: HERE, suite: "issue-25", check });
}

// TC-31: the earlier suites (issue-15 runs issue-14, which runs issue-7) still pass with their evals.
function regression() {
  const env = { ...process.env }; delete env.SCREENSHOTS;
  const run = spawnSync(process.execPath, [path.join(TODO_DIR, "tests", "issue-15", "run.js")], { encoding: "utf8", timeout: 900000, env });
  const summary = (run.stdout || "").trim().split("\n").pop();
  const evalOk = (suite) => { try { return JSON.parse(fs.readFileSync(path.join(TODO_DIR, "tests", suite, "eval", "eval-report.json"), "utf8")).ok === true; } catch { return false; } };
  check("TC-31", "issue-15 (incl. issue-14 and issue-7) suites pass with their evals",
    run.status === 0 && /^(\d+)\/\1 passed$/.test(summary || "") && evalOk("issue-15") && evalOk("issue-14") && evalOk("issue-7"),
    `exit=${run.status} summary=${summary} evals=${evalOk("issue-15")},${evalOk("issue-14")},${evalOk("issue-7")}`);
}

(async () => {
  await e2e();
  if (!args.includes("--skip-regression")) regression();
  process.exit(report() ? 1 : 0);
})();
