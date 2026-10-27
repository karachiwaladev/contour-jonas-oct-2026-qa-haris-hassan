// Shared plumbing for the persona runners (tests/personas/<persona>/run.js).
// Builds on tests/lib/harness.js: starts the app in headless Chrome, injects
// the `T` page helper, tags each case in the app log, runs the eval against
// this folder's test-cases.md (only the persona's own rows) and prints one
// PASS / FAIL / FINDING / MANUAL line per check.
//
// - FINDING: a failed check of a case listed in the runner's `findingIds` (a
//   known weakness the spec says to report, e.g. a performance budget). It does
//   not make the exit code non-zero. A finding-type check that passes is PASS.
//   Checks marked `strict` (correctness checks, and any case that throws) are
//   always FAIL when they fail, even for a finding-type case.
// - The logger only accepts "TC-<n>" test-case tags, so persona ids are mapped
//   to TC-1, TC-2, … while running and mapped back in the collected log.

const fs = require("fs");
const path = require("path");
const { sleep, startBrowser, runEval } = require("../lib/harness");

const SPEC_PATH = path.join(__dirname, "test-cases.md");
const FILLER = "test.filler"; // bulk log entries written by load tests; left out of run-log.jsonl
const TEST_CASE_KEY = "todo-log-test-case"; // where logger.js keeps the tag across reloads
const BLANK = "/tests/issue-7/blank.html"; // same-origin empty page for seeding
const WAIT_MS = 10000; // page-side waits give up after this and fail the case

// The rows of test-cases.md (with the header) whose id starts with PREFIX-.
function personaSpec(prefix) {
  const lines = fs.readFileSync(SPEC_PATH, "utf8").split(/\r?\n/);
  const header = lines.findIndex((l) => /^\|\s*ID\s*\|/.test(l));
  const rows = lines.filter((l) => new RegExp(`^\\|\\s*${prefix}-\\d+\\s*\\|`).test(l));
  return [lines[header], lines[header + 1], ...rows].join("\n") + "\n";
}

const specIds = (prefix) => [...personaSpec(prefix).matchAll(new RegExp(`^\\|\\s*(${prefix}-\\d+)\\s*\\|`, "gm"))].map((m) => m[1]);

// ---- Shared seed data and page scripts ----------------------------------------

// Local date `o` days from today, "YYYY-MM-DD".
const ymd = (o) => { const d = new Date(); d.setDate(d.getDate() + o); const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
// A v3 task record (no priority); `base` is the same with v4's priority.
const v3 = (title, extra = {}) => ({ title, done: false, createdAt: 1, due: null, tags: [], repeat: "none", anchorDay: null, nextId: null, spawnedFrom: null, ...extra });
const base = (title, extra = {}) => v3(title, { priority: "medium", ...extra });
// Init script: "another tab" that opened the database at v3 before the app
// loads and never closes it on versionchange (window.__holder).
const HOLDER = `if (location.pathname.endsWith("/index.html")) {
  const q = indexedDB.open("todo-app", 3); q.onsuccess = () => { window.__holder = q.result; };
}`;

// ---- Results ---------------------------------------------------------------------

function createPersonaChecker(prefix, findingIds = []) {
  const results = [];
  // opts: { strict: a failure is FAIL even for a finding-type case; show: print the detail on PASS too }
  const check = (id, name, cond, detail = "", opts = {}) =>
    results.push({ id, name, show: !!opts.show, detail: String(detail || ""),
      status: cond ? "PASS" : findingIds.includes(id) && !opts.strict ? "FINDING" : "FAIL" });
  const manual = (id, name, detail = "") => results.push({ id, name, status: "MANUAL", detail });
  const report = () => {
    const order = specIds(prefix);
    const pos = (id) => (order.includes(id) ? order.indexOf(id) : 1000);
    results.sort((a, b) => pos(a.id) - pos(b.id));
    for (const r of results) console.log(`${r.status} ${r.id} ${r.name}${(r.status !== "PASS" || r.show) && r.detail ? " :: " + r.detail : ""}`);
    const n = (s) => results.filter((r) => r.status === s).length;
    const counts = { pass: n("PASS"), fail: n("FAIL"), finding: n("FINDING"), manual: n("MANUAL") };
    console.log(`\nSummary: ${counts.pass} pass, ${counts.fail} fail, ${counts.finding} finding, ${counts.manual} manual`);
    return counts;
  };
  return { results, check, manual, report };
}

// ---- The page helper ---------------------------------------------------------------

// `tc` maps persona ids to the TC-<n> tags the logger accepts.
const pageHelper = (tc) => `window.T = {
  tc: ${JSON.stringify(tc)},
  wait: (ms = 250) => new Promise(r => setTimeout(r, ms)),
  frame: () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0))),
  ymd(o) { const d = new Date(); d.setDate(d.getDate() + o); const p = n => String(n).padStart(2, "0"); return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()); },
  titles: () => [...document.querySelectorAll("#task-list .title")].map(e => e.textContent),
  items: (t) => [...document.querySelectorAll("#task-list .task")].filter(l => (l.querySelector(".title") || {}).textContent === t),
  item: (id) => document.querySelector('#task-list .task[data-id="' + id + '"]'),
  count: () => document.getElementById("count").textContent,
  // Resolve once cond() is true, checked on every child-list change under \`sel\`; reject after ms.
  waitFor(sel, cond, ms = ${WAIT_MS}) {
    const el = document.querySelector(sel);
    return new Promise((res, rej) => {
      if (cond()) return res();
      const o = new MutationObserver(() => { if (cond()) { o.disconnect(); clearTimeout(t); res(); } });
      const t = setTimeout(() => { o.disconnect(); rej(new Error("timed out after " + ms / 1000 + " s waiting for " + sel)); }, ms);
      o.observe(el, { childList: true, subtree: true });
    });
  },
  // Run act(); ms until \`sel\`'s children next change and the frame is painted.
  async timed(sel, act, ms = ${WAIT_MS}) {
    const el = document.querySelector(sel); const t0 = performance.now();
    const changed = new Promise((res, rej) => {
      const o = new MutationObserver(() => { o.disconnect(); clearTimeout(t); res(); });
      const t = setTimeout(() => { o.disconnect(); rej(new Error("timed out after " + ms / 1000 + " s waiting for " + sel + " to change")); }, ms);
      o.observe(el, { childList: true });
    });
    act(); await changed; await T.frame(); return Math.round(performance.now() - t0);
  },
  async add(title, opts = {}) { const f = id => document.getElementById(id);
    f("task-title").value = title; f("task-due").value = opts.due || ""; f("task-tags").value = opts.tags || "";
    f("task-repeat").value = opts.repeat || "none"; f("task-priority").value = opts.priority || "medium";
    f("new-task").requestSubmit(); await T.wait(); await TodoLog.flush();
    const all = (await TodoDB.all()).filter(t => t.title === title.trim()); return all.length ? Math.max(...all.map(t => t.id)) : null; },
  async tick(id) { T.item(id).querySelector("input[type=checkbox]").click(); await T.wait(); await TodoLog.flush(); },
  async edit(id, fields, how = "save") {
    T.item(id).querySelector(".edit").click(); await T.wait(100);
    const form = T.item(id).querySelector(".edit-form");
    const set = (sel, v) => { if (v !== undefined) form.querySelector(sel).value = v; };
    set(".edit-title", fields.title); set(".edit-due", fields.due); set(".edit-tags", fields.tags);
    set(".edit-repeat", fields.repeat); set(".edit-priority", fields.priority);
    form.dispatchEvent(new Event("input", { bubbles: true }));
    if (how === "save") form.querySelector(".edit-save").click();
    else if (how === "cancel") form.querySelector(".edit-cancel").click();
    await T.wait(); await TodoLog.flush(); },
  async filter(id, v) { const s = document.getElementById(id); s.value = v; s.dispatchEvent(new Event("change")); await T.wait(); },
  async status(s) { document.querySelector('#status-filter [data-status="' + s + '"]').click(); await T.wait(); },
  get: async (id) => (await TodoDB.all()).find(t => t.id === id),
  async entries(caseId) { await TodoLog.flush(); const tag = caseId && T.tc[caseId]; return (await TodoLog.all()).filter(e => !caseId || e.testCase === tag); },
  // Raw stored records and the database version, bypassing TodoDB's clean-up.
  raw: () => new Promise((res, rej) => { const q = indexedDB.open("todo-app"); q.onerror = () => rej(q.error);
    q.onsuccess = () => { const db = q.result; const g = db.transaction("tasks").objectStore("tasks").getAll();
      g.onsuccess = () => { db.close(); res({ v: db.version, records: g.result }); }; g.onerror = () => { db.close(); rej(g.error); }; }; }),
  // Untagged: every filter back to All, no edit form or error, empty task list.
  async reset() { TodoLog.setTestCase(null);
    const pressed = document.querySelector('#status-filter [aria-pressed="true"]');
    if (!pressed || pressed.dataset.status !== "all") await T.status("all");
    if (document.getElementById("priority-filter").value) await T.filter("priority-filter", "");
    if (document.getElementById("tag-filter").value) await T.filter("tag-filter", "");
    document.querySelectorAll(".edit-form .edit-cancel").forEach(b => b.click());
    for (const t of await TodoDB.all()) await TodoDB.remove(t.id);
    document.getElementById("error").hidden = true;
    await render(); await T.wait(100); await TodoLog.flush(); },
};`;

// ---- Running a persona -------------------------------------------------------------

// Run a persona's cases. `unit(ctx)` runs in Node; `e2e(ctx)` gets a browser.
// ctx: ev, nav, send, open (load the app + helper), tag(id), collect(),
//   seed(version, recordsOrExpr), kase(id, name, fn), check, manual, consoleErrors, b.
// kase: clears any test-case tag first (so setup is never logged under the
//   previous case), then runs fn, which returns [ok, detail, opts?]; a throw is a FAIL.
async function runPersona({ dir, prefix, findingIds = [], unit, e2e }) {
  const { check, manual, report } = createPersonaChecker(prefix, findingIds);
  const ids = specIds(prefix);
  const tc = Object.fromEntries(ids.map((id, i) => [id, `TC-${i + 1}`]));
  const back = Object.fromEntries(Object.entries(tc).map(([k, v]) => [v, k]));
  let beforeCase = async () => {};
  const kase = async (id, name, fn) => {
    try {
      await beforeCase();
      const [ok, detail, opts = {}] = await fn();
      check(id, name, ok, typeof detail === "string" ? detail : JSON.stringify(detail), opts);
    } catch (e) {
      check(id, name, false, "error: " + (e && e.message ? e.message.split("\n")[0] : e), { strict: true });
    }
  };

  if (unit) {
    try { await unit({ check, kase, manual }); }
    catch (e) { check("UNIT", "unit tests", false, "error: " + (e && e.message ? e.message : e), { strict: true }); }
  }

  if (e2e) {
    const collected = new Map();
    let b;
    try { b = await startBrowser(); } catch (e) { check("E2E", "browser starts", false, e.message, { strict: true }); }
    if (b) {
      const { nav, ev, send, consoleErrors } = b;
      const open = async (url = "/index.html") => { await nav(url); await ev(pageHelper(tc)); };
      const collect = async () => {
        try {
          for (const e of await ev(`await TodoLog.flush(); return await TodoLog.all();`)) {
            if (e.action === FILLER) continue;
            collected.set(`${e.sessionId}:${e.seq}`, { ...e, ...(back[e.testCase] ? { testCase: back[e.testCase] } : {}) });
          }
        } catch {}
      };
      const untag = () => ev(`try { if (typeof TodoLog !== "undefined") TodoLog.setTestCase(null); else sessionStorage.removeItem(${JSON.stringify(TEST_CASE_KEY)}); } catch {}`).catch(() => {});
      beforeCase = async () => { await collect(); await untag(); };
      const tag = async (id) => {
        await collect();
        const ok = await ev(`return TodoLog.setTestCase(${JSON.stringify(tc[id])});`);
        if (!ok) throw new Error(`could not tag ${id}`);
        await collect();
      };
      // Seed IndexedDB at `version` with raw records (an array, or a JS
      // expression evaluated in the page that returns one) from a blank page,
      // so the app isn't holding the database open. Clears the test-case tag,
      // so the next app start-up isn't logged under the previous case.
      const seed = async (version, records) => {
        await collect();
        await nav(BLANK);
        const list = typeof records === "string" ? records : JSON.stringify(records);
        return ev(`
          try { sessionStorage.removeItem(${JSON.stringify(TEST_CASE_KEY)}); } catch {}
          await new Promise(r => { const d = indexedDB.deleteDatabase("todo-app"); d.onsuccess = d.onerror = r; });
          const records = ${list};
          await new Promise((resolve, reject) => { const q = indexedDB.open("todo-app", ${version});
            q.onupgradeneeded = () => q.result.createObjectStore("tasks", { keyPath: "id", autoIncrement: true });
            q.onsuccess = () => { const tx = q.result.transaction("tasks", "readwrite"); for (const r of records) tx.objectStore("tasks").add(r);
              tx.oncomplete = () => { q.result.close(); resolve(); }; tx.onerror = () => reject(tx.error); }; q.onerror = () => reject(q.error); });
          return records.length;`);
      };
      try {
        await e2e({ ev, nav, send, open, tag, collect, seed, kase, check, manual, consoleErrors, b, sleep });
      } catch (e) {
        check("E2E", "browser run", false, e.stack || e.message, { strict: true });
      } finally {
        await collect();
        await b.close();
      }
    }
    // Eval of this persona's rows only; writes <dir>/eval/.
    runEval({ collected, suiteDir: dir, suite: `personas/${path.basename(dir)}`, specText: personaSpec(prefix),
      check: (id, name, cond, detail) => check(id, name, cond, detail, { strict: true }) });
  }

  const counts = report();
  process.exit(counts.fail ? 1 : 0);
}

module.exports = { runPersona, personaSpec, specIds, FILLER, WAIT_MS, ymd, v3, base, HOLDER };
