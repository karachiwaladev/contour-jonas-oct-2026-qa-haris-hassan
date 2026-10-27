// Shared plumbing for the persona runners (tests/personas/<persona>/run.js).
// Builds on tests/lib/harness.js: starts the app in headless Chrome, injects
// the `T` page helper, tags each case in the app log, runs the eval against
// this folder's test-cases.md (only the persona's own rows) and prints one
// PASS / FAIL / FINDING / MANUAL line per case.
//
// - FINDING: a case listed in the runner's `findingIds` (a known weakness the
//   spec says to report, e.g. performance budgets) whose check failed. It does
//   not make the exit code non-zero. A finding-type case that passes is PASS.
// - The logger only accepts "TC-<n>" test-case tags, so persona ids are mapped
//   to TC-1, TC-2, … while running and mapped back in the collected log.

const fs = require("fs");
const path = require("path");
const { sleep, startBrowser } = require("../lib/harness");

const SPEC_PATH = path.join(__dirname, "test-cases.md");
const FILLER = "test.filler"; // bulk log entries written by load tests; left out of run-log.jsonl

// The rows of test-cases.md (with the header) whose id starts with PREFIX-.
function personaSpec(prefix) {
  const lines = fs.readFileSync(SPEC_PATH, "utf8").split(/\r?\n/);
  const header = lines.findIndex((l) => /^\|\s*ID\s*\|/.test(l));
  const rows = lines.filter((l) => new RegExp(`^\\|\\s*${prefix}-\\d+\\s*\\|`).test(l));
  return [lines[header], lines[header + 1], ...rows].join("\n") + "\n";
}

const specIds = (prefix) => [...personaSpec(prefix).matchAll(new RegExp(`^\\|\\s*(${prefix}-\\d+)\\s*\\|`, "gm"))].map((m) => m[1]);

function createPersonaChecker(prefix, findingIds = [], details = false) {
  const results = [];
  const check = (id, name, cond, detail = "") =>
    results.push({ id, name, status: cond ? "PASS" : findingIds.includes(id) ? "FINDING" : "FAIL", detail: String(detail || "") });
  const manual = (id, name, detail = "") => results.push({ id, name, status: "MANUAL", detail });
  const report = () => {
    const order = specIds(prefix);
    const pos = (id) => (order.includes(id) ? order.indexOf(id) : 1000);
    results.sort((a, b) => pos(a.id) - pos(b.id));
    for (const r of results) console.log(`${r.status} ${r.id} ${r.name}${(r.status !== "PASS" || (details && r.id !== "EVAL")) && r.detail ? " :: " + r.detail : ""}`);
    const n = (s) => results.filter((r) => r.status === s).length;
    const counts = { pass: n("PASS"), fail: n("FAIL"), finding: n("FINDING"), manual: n("MANUAL") };
    console.log(`\nSummary: ${counts.pass} pass, ${counts.fail} fail, ${counts.finding} finding, ${counts.manual} manual`);
    return counts;
  };
  return { results, check, manual, report };
}

// The page helper. `tc` maps persona ids to the TC-<n> tags the logger accepts.
const pageHelper = (tc) => `window.T = {
  tc: ${JSON.stringify(tc)},
  wait: (ms = 250) => new Promise(r => setTimeout(r, ms)),
  frame: () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0))),
  ymd(o) { const d = new Date(); d.setDate(d.getDate() + o); const p = n => String(n).padStart(2, "0"); return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()); },
  titles: () => [...document.querySelectorAll("#task-list .title")].map(e => e.textContent),
  items: (t) => [...document.querySelectorAll("#task-list .task")].filter(l => (l.querySelector(".title") || {}).textContent === t),
  item: (id) => document.querySelector('#task-list .task[data-id="' + id + '"]'),
  count: () => document.getElementById("count").textContent,
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
  // Untagged: empty the task list and put the filters back to All.
  async reset() { TodoLog.setTestCase(null);
    for (const t of await TodoDB.all()) await TodoDB.remove(t.id);
    const pressed = document.querySelector('#status-filter [aria-pressed="true"]');
    if (!pressed || pressed.dataset.status !== "all") await T.status("all");
    if (document.getElementById("priority-filter").value) await T.filter("priority-filter", "");
    document.querySelectorAll(".edit-form .edit-cancel").forEach(b => b.click());
    document.getElementById("error").hidden = true;
    await render(); await T.wait(100); await TodoLog.flush(); },
};`;

// Start the browser and run a persona's cases. `details: true` also prints the detail of passing cases (e.g. timings). `cases(ctx)` receives helpers:
//   ev, nav, send, open (load the app + helper), tag(id), collect(), seed(version, recordsOrExpr),
//   kase(id, name, fn) (fn returns [ok, detail]; a throw is a FAIL), check, manual, consoleErrors.
async function runPersona({ dir, prefix, findingIds = [], details = false, unit, e2e }) {
  const { check, manual, report } = createPersonaChecker(prefix, findingIds, details);
  const ids = specIds(prefix);
  const tc = Object.fromEntries(ids.map((id, i) => [id, `TC-${i + 1}`]));
  const back = Object.fromEntries(Object.entries(tc).map(([k, v]) => [v, k]));
  const kase = async (id, name, fn) => {
    try {
      const [ok, detail] = await fn();
      check(id, name, ok, typeof detail === "string" ? detail : JSON.stringify(detail));
    } catch (e) {
      check(id, name, false, "error: " + (e && e.message ? e.message.split("\n")[0] : e));
    }
  };

  if (unit) await unit({ check, kase, manual });

  if (e2e) {
    const collected = new Map();
    let b;
    try { b = await startBrowser(); } catch (e) { check("E2E", "browser starts", false, e.message); }
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
      const tag = async (id) => {
        await collect();
        const ok = await ev(`return TodoLog.setTestCase(${JSON.stringify(tc[id])});`);
        if (!ok) throw new Error(`could not tag ${id}`);
        await collect();
      };
      // Seed IndexedDB at `version` with raw records (an array, or a JS
      // expression evaluated in the page that returns one) from a blank page,
      // so the app isn't holding the database open.
      const seed = async (version, records) => {
        await nav("/tests/personas/blank.html");
        const list = typeof records === "string" ? records : JSON.stringify(records);
        return ev(`
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
        check("E2E", "browser run", false, e.stack || e.message);
      } finally {
        await collect();
        await b.close();
      }
    }
    personaEval({ collected, dir, prefix, check });
  }

  const counts = report();
  process.exit(counts.fail ? 1 : 0);
}

// Write run-log.jsonl and eval-report.{md,json} under <dir>/eval, judging only
// this persona's rows of test-cases.md against <dir>/expected-log.json.
function personaEval({ collected, dir, prefix, check }) {
  try {
    const E = require(path.join(__dirname, "..", "eval", "eval-logs.js"));
    const outDir = path.join(dir, "eval");
    fs.mkdirSync(outDir, { recursive: true });
    const byTime = (a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.seq - b.seq);
    const logText = [...collected.values()].sort(byTime).map((e) => JSON.stringify(e)).join("\n");
    fs.writeFileSync(path.join(outDir, "run-log.jsonl"), logText + (logText ? "\n" : ""));
    const res = E.evaluate({
      logText,
      specText: personaSpec(prefix),
      expected: JSON.parse(fs.readFileSync(path.join(dir, "expected-log.json"), "utf8")),
    });
    E.writeReports(res, outDir, { suite: `personas/${path.basename(dir)}` });
    const problems = res.cases.filter((c) => !["pass", "unit", "skipped"].includes(c.status)).map((c) => {
      const list = (c.missing && c.missing.length ? c.missing : c.unexpected) || [];
      return `${c.id}:${c.status}${list.length ? "(" + list.join(",") + ")" : ""}`;
    });
    check("EVAL", "eval of this run: every e2e case executed with its expected actions", res.ok, problems.join(" "));
  } catch (e) {
    check("EVAL", "eval of this run", false, e.message);
  }
}

module.exports = { runPersona, personaSpec, specIds, FILLER };
