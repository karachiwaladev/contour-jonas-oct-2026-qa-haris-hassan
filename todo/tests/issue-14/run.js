#!/usr/bin/env node
// Test runner for ticket #14 (application action logs + eval). See test-cases.md.
//   node todo/tests/issue-14/run.js            # unit (eval) + browser (e2e) + issue-7 regression
//   node todo/tests/issue-14/run.js --unit     # eval unit cases only
//   node todo/tests/issue-14/run.js --skip-regression   # skip TC-26 (the issue-7 suite)
//   SCREENSHOTS=<dir> node ... run.js          # also save screenshots
// Every e2e case is tagged in the app log (TodoLog.setTestCase), the log is
// collected after each case, and at the end the eval checks it against
// test-cases.md + expected-log.json, writing eval/eval-report.{md,json}.

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { TODO_DIR, sleep, createChecker, startBrowser } = require("../lib/harness");

const HERE = __dirname;
const { check, report } = createChecker();
const args = process.argv.slice(2);

// ---------------------------------------------------------------- eval unit cases
function unit() {
  let E;
  try { E = require(path.join(TODO_DIR, "tests", "eval", "eval-logs.js")); }
  catch (e) { ["TC-21", "TC-22", "TC-23", "TC-24", "TC-25"].forEach((id) => check(id, "eval-logs.js loads", false, e.message)); return; }

  const spec = [
    "| ID | Requirement | Type | Preconditions | Steps | Expected result | Auto | Result |",
    "|----|---|---|---|---|---|---|---|",
    "| TC-01 | a | Functional | — | — | — | e2e | ⏳ |",
    "| TC-02 | b | Functional | — | — | — | e2e | ⏳ |",
    "| TC-03 | c | Edge | — | — | — | unit | ⏳ |",
  ].join("\n");
  const expected = { "TC-01": ["task.add"], "TC-02": ["task.complete", "task.spawn"] };
  const line = (o) => JSON.stringify({ id: 1, ts: "2026-10-26T00:00:00.000Z", sessionId: "s", seq: 1, actor: "api", automated: true, taskId: 1, changes: {}, outcome: "ok", ...o });
  const full = [
    line({ action: "test.case_start", testCase: "TC-01" }), line({ action: "task.add", testCase: "TC-01" }),
    line({ action: "test.case_start", testCase: "TC-02" }), line({ action: "task.complete", testCase: "TC-02" }), line({ action: "task.spawn", testCase: "TC-02" }),
  ].join("\n");

  let r;
  try { r = E.evaluate({ logText: full, specText: spec, expected }); } catch (e) { r = { error: e.message }; }
  check("TC-21", "eval passes a complete run", r.ok === true && r.cases.filter((c) => c.status === "pass").length === 2, JSON.stringify(r));

  try { r = E.evaluate({ logText: full.split("\n").filter((l) => !l.includes("TC-02")).join("\n"), specText: spec, expected }); } catch (e) { r = { error: e.message }; }
  check("TC-22", "eval catches a case that didn't run",
    r.ok === false && (r.cases || []).find((c) => c.id === "TC-02")?.status === "not-executed", JSON.stringify(r));

  try { r = E.evaluate({ logText: full.split("\n").filter((l) => !l.includes("task.spawn")).join("\n"), specText: spec, expected }); } catch (e) { r = { error: e.message }; }
  const c2 = (r.cases || []).find((c) => c.id === "TC-02");
  check("TC-23", "eval catches a missing expected action",
    r.ok === false && c2?.status === "incomplete" && JSON.stringify(c2.missing) === '["task.spawn"]', JSON.stringify(r));

  try { r = E.evaluate({ logText: "not json\n" + full + "\n" + JSON.stringify({ id: 9, testCase: "TC-01" }), specText: spec, expected }); } catch (e) { r = { error: e.message }; }
  check("TC-24", "eval reports malformed lines and keeps going",
    !r.error && r.ok === true && JSON.stringify((r.malformed || []).map((m) => m.line)) === "[1,7]", JSON.stringify(r));

  try { r = E.evaluate({ logText: full + "\n" + line({ action: "task.add", testCase: "TC-99" }), specText: spec, expected }); } catch (e) { r = { error: e.message }; }
  check("TC-25", "eval: unit cases skipped, unknown case flagged",
    r.ok === true && (r.cases || []).find((c) => c.id === "TC-03")?.status === "unit" && JSON.stringify(r.unknown) === '["TC-99"]', JSON.stringify(r));
}

// ---------------------------------------------------------------- e2e
async function e2e() {
  let b;
  try { b = await startBrowser(); } catch (e) { check("E2E", "browser starts", false, e.message); return; }
  const { nav, ev, shot, addInitScript, removeInitScript, consoleErrors } = b;
  const collected = new Map(); // all log entries seen during the run, by id
  let r;

  const H = `window.T = {
    wait: (ms = 250) => new Promise(r => setTimeout(r, ms)),
    ymd(o) { const d = new Date(); d.setDate(d.getDate() + o); const p = n => String(n).padStart(2, "0"); return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()); },
    titles: () => [...document.querySelectorAll("#task-list .title")].map(e => e.textContent),
    items: (t) => [...document.querySelectorAll(".task")].filter(l => l.querySelector(".title").textContent === t),
    async add(title, due, tags, repeat) { const f = id => document.getElementById(id);
      f("task-title").value = title; f("task-due").value = due || ""; f("task-tags").value = tags || ""; f("task-repeat").value = repeat || "none";
      f("new-task").requestSubmit(); await T.wait(); await TodoLog.flush(); },
    async reset() { for (const t of await TodoDB.all()) await TodoDB.remove(t.id); await render(); await TodoLog.flush(); },
    async entries(tc) { await TodoLog.flush(); return (await TodoLog.all()).filter(e => !tc || e.testCase === tc); },
  };`;
  const open = async () => { await nav("/index.html"); await ev(H); };
  const tag = (id) => ev(`return TodoLog.setTestCase(${JSON.stringify(id)});`);
  const collect = async () => {
    try { for (const e of await ev(`await TodoLog.flush(); return await TodoLog.all();`)) collected.set(e.id, e); } catch {}
  };
  const fresh = async () => {
    // Start from empty tasks AND an empty log (via the API; not part of any case).
    await ev(`await T.reset(); await TodoLog.setTestCase(null); await TodoLog.clear({ silent: true }); await TodoLog.flush();`);
  };

  try {
    await open();

    // TC-01 add through the UI
    await fresh(); await tag("TC-01");
    r = await ev(`await T.add("Milk", T.ymd(0), "shop", "none"); return (await T.entries("TC-01")).filter(e => e.action === "task.add");`);
    const today = await ev(`return T.ymd(0);`);
    check("TC-01", "UI add logged with actor user, changes, no title",
      r.length === 1 && r[0].actor === "user" && Number.isInteger(r[0].taskId) && r[0].outcome === "ok" &&
      JSON.stringify(r[0].changes) === JSON.stringify({ done: false, repeat: "none", due: today, tags: 1 }), JSON.stringify(r));
    await collect();

    // TC-02 complete + reopen through the UI
    await tag("TC-02");
    r = await ev(`T.items("Milk")[0].querySelector("input[type=checkbox]").click(); await T.wait();
      T.items("Milk")[0].querySelector("input[type=checkbox]").click(); await T.wait();
      return (await T.entries("TC-02")).filter(e => e.action.startsWith("task.")).map(e => [e.action, e.actor, e.taskId]);`);
    check("TC-02", "complete then reopen logged (user, same task)",
      r.length === 2 && r[0][0] === "task.complete" && r[1][0] === "task.reopen" && r.every(x => x[1] === "user") && r[0][2] === r[1][2], JSON.stringify(r));
    await collect();

    // TC-03 recurring: complete -> spawn; reopen -> copy_removed
    await fresh(); await tag("TC-03");
    r = await ev(`await T.add("Water", T.ymd(0), "", "daily");
      T.items("Water")[0].querySelector("input[type=checkbox]").click(); await T.wait();
      const done = T.items("Water").find(l => l.classList.contains("done")); done.querySelector("input[type=checkbox]").click(); await T.wait();
      return { log: (await T.entries("TC-03")).filter(e => e.action.startsWith("task.")).map(e => ({ a: e.action, id: e.taskId, due: e.changes && e.changes.due })), tomorrow: T.ymd(1) };`);
    const acts = r.log.map((x) => x.a);
    const spawn = r.log.find((x) => x.a === "task.spawn");
    check("TC-03", "recurring complete/spawn/reopen/copy_removed logged",
      JSON.stringify(acts) === JSON.stringify(["task.add", "task.complete", "task.spawn", "task.reopen", "task.copy_removed"]) &&
      spawn && spawn.due === r.tomorrow && spawn.id !== r.log[1].id, JSON.stringify(r));
    await collect();

    // TC-04 stop repeating + become one-off
    await fresh(); await tag("TC-04");
    r = await ev(`await T.add("Gym", T.ymd(0), "", "daily");
      T.items("Gym")[0].querySelector("input[type=checkbox]").click(); await T.wait();
      const open = T.items("Gym").find(l => !l.classList.contains("done")); open.querySelector(".stop-repeat").click(); await T.wait();
      T.items("Gym").find(l => !l.classList.contains("done")).querySelector("input[type=checkbox]").click(); await T.wait();
      T.items("Gym")[0] && [...T.items("Gym")].find(l => l.classList.contains("done") && Number(l.dataset.id) === Math.min(...T.items("Gym").map(x => Number(x.dataset.id)))).querySelector("input[type=checkbox]").click(); await T.wait();
      return (await T.entries("TC-04")).map(e => e.action);`);
    check("TC-04", "stop_repeating and become_oneoff logged",
      r.includes("task.stop_repeating") && r.includes("task.become_oneoff"), JSON.stringify(r));
    await collect();

    // TC-05 delete
    await fresh(); await ev(`await T.add("Trash", "", "", "none");`); await tag("TC-05");
    r = await ev(`const id = Number(T.items("Trash")[0].dataset.id); T.items("Trash")[0].querySelector(".delete").click(); await T.wait();
      return { id, log: (await T.entries("TC-05")).filter(e => e.action === "task.delete") };`);
    check("TC-05", "delete logged", r.log.length === 1 && r.log[0].taskId === r.id && r.log[0].actor === "user", JSON.stringify(r));
    await collect();

    // TC-06 api vs user
    await fresh(); await tag("TC-06");
    r = await ev(`const id = await TodoDB.add("By AI", {}); await TodoDB.setDone(id, true); await render(); await TodoLog.flush();
      await T.add("By person", "", "", "none");
      return (await T.entries("TC-06")).filter(e => e.action.startsWith("task.")).map(e => [e.action, e.actor]);`);
    check("TC-06", "direct TodoDB calls are actor api; UI is user",
      JSON.stringify(r) === JSON.stringify([["task.add", "api"], ["task.complete", "api"], ["task.add", "user"]]), JSON.stringify(r));
    await collect();

    // TC-07 automation flag
    await tag("TC-07");
    r = await ev(`await T.add("Auto", "", "", "none"); return { webdriver: navigator.webdriver, log: (await T.entries("TC-07")).filter(e => e.action === "task.add").map(e => e.automated) };`);
    check("TC-07", "entries flagged automated under automation", r.webdriver === true && r.log.length === 1 && r.log[0] === true, JSON.stringify(r));
    await collect();

    // TC-08 UI-only actions, no tag text
    await fresh(); await ev(`await T.add("Tagged", "", "secret-tag", "none");`); await tag("TC-08");
    r = await ev(`document.querySelector('#status-filter [data-status="active"]').click(); await T.wait();
      const s = document.getElementById("tag-filter"); s.value = "secret-tag"; s.dispatchEvent(new Event("change")); await T.wait();
      s.value = ""; s.dispatchEvent(new Event("change")); await T.wait();
      T.items("Tagged")[0].querySelector(".chip").click(); await T.wait();
      document.querySelector('#status-filter [data-status="all"]').click(); await T.wait();
      const log = (await T.entries("TC-08")).filter(e => e.action.startsWith("ui."));
      return { log: log.map(e => [e.action, e.changes]), leak: JSON.stringify(log).includes("secret-tag") };`);
    check("TC-08", "filter actions logged without tag text",
      !r.leak && r.log.some(([a, c]) => a === "ui.filter_status" && c.status === "active") &&
      r.log.some(([a, c]) => a === "ui.filter_tag" && c.tag === "set") && r.log.some(([a, c]) => a === "ui.filter_tag" && c.tag === "cleared"), JSON.stringify(r));
    await collect();

    // TC-09 activity panel
    await fresh(); await tag("TC-09");
    r = await ev(`for (let i = 0; i < 59; i++) TodoLog.log({ action: "test.fill", actor: "api" }); await TodoLog.flush();
      const d = document.getElementById("activity"); d.open = true; await renderActivity(); await T.wait();
      const rows = [...document.querySelectorAll("#activity-list li")];
      const all = await TodoLog.all();
      return { rows: rows.length, summary: document.getElementById("activity-summary").textContent, total: all.length,
        newestFirst: rows[0] && rows[0].dataset.id == all[all.length - 1].id, cells: rows[0] && rows[0].querySelectorAll("[data-col]").length };`);
    await shot("01-activity-panel.png");
    check("TC-09", "panel: newest first, max 50 rows, total in heading",
      r.rows === 50 && r.total >= 60 && r.summary.includes(String(r.total)) && r.newestFirst && r.cells >= 4, JSON.stringify(r));
    await collect();

    // TC-10 export
    await tag("TC-10");
    r = await ev(`let captured = null; const orig = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () { captured = { href: this.href, download: this.download }; };
      document.getElementById("log-export").click(); await T.wait(400); HTMLAnchorElement.prototype.click = orig;
      if (!captured) return { captured: null };
      const text = await (await fetch(captured.href)).text(); const lines = text.trim().split("\\n");
      let valid = true; for (const l of lines) { try { JSON.parse(l); } catch { valid = false; } }
      const all = await T.entries();
      return { download: captured.download, lines: lines.length, valid, exportLogged: all.some(e => e.action === "log.export" && e.testCase === "TC-10"), total: all.length };`);
    check("TC-10", "export downloads valid JSONL and logs log.export",
      r.captured !== null && /^todo-log-\d{4}-\d{2}-\d{2}\.jsonl$/.test(r.download) && r.valid && r.lines >= r.total - 1 && r.exportLogged, JSON.stringify(r));
    await collect();

    // TC-11 clear
    await tag("TC-11");
    r = await ev(`document.getElementById("log-clear").click(); await T.wait(400); return (await T.entries()).map(e => e.action);`);
    check("TC-11", "clear leaves only log.clear", JSON.stringify(r) === '["log.clear"]', JSON.stringify(r));
    await collect();

    // TC-12 tagging survives reload, null stops it
    await fresh();
    await ev(`TodoLog.setTestCase("TC-12"); await T.add("Before reload", "", "", "none");`);
    await open();
    r = await ev(`await T.add("After reload", "", "", "none"); TodoLog.setTestCase(null); await TodoDB.add("Untagged", {}); await TodoLog.flush();
      return (await TodoLog.all()).filter(e => e.action === "task.add").map(e => e.testCase || null);`);
    check("TC-12", "testCase tag persists across reload; null stops it", JSON.stringify(r) === '["TC-12","TC-12",null]', JSON.stringify(r));
    await collect();

    // TC-13 failure logged
    await fresh(); await tag("TC-13");
    r = await ev(`const real = TodoDB.add; TodoDB.add = () => Promise.reject(new Error("TC-13 injected failure"));
      document.getElementById("task-title").value = "X"; document.getElementById("new-task").requestSubmit(); await T.wait(400);
      TodoDB.add = real; document.getElementById("task-title").value = ""; document.getElementById("error").hidden = true;
      return (await T.entries("TC-13")).filter(e => e.action === "task.add").map(e => [e.outcome, e.actor, e.error]);`);
    check("TC-13", "failed add logged with outcome error + message",
      r.length === 1 && r[0][0] === "error" && r[0][1] === "user" && /TC-13 injected failure/.test(r[0][2] || ""), JSON.stringify(r));
    await collect();

    // TC-14 cap 1000
    await fresh(); await tag("TC-14"); await collect();
    r = await ev(`for (let i = 0; i < 1005; i++) TodoLog.log({ action: "test.fill", actor: "api", changes: { n: i } }); await TodoLog.flush();
      const all = await TodoLog.all(); const fills = all.filter(e => e.action === "test.fill");
      return { total: all.length, firstN: fills[0] && fills[0].changes.n, lastN: fills[fills.length - 1] && fills[fills.length - 1].changes.n };`);
    check("TC-14", "log capped at 1000, oldest dropped", r.total === 1000 && r.lastN === 1004 && r.firstN >= 5, JSON.stringify(r));

    // TC-15 persistence + new session after reload
    await fresh(); await tag("TC-15");
    r = await ev(`await T.add("One", "", "", "none"); const before = (await T.entries("TC-15")).filter(e => e.action === "task.add")[0]; return before;`);
    await open();
    const r15 = await ev(`await T.add("Two", "", "", "none"); const adds = (await T.entries("TC-15")).filter(e => e.action === "task.add"); return adds;`);
    check("TC-15", "entries persist; new sessionId and seq restarts after reload",
      r15.length === 2 && r15[0].id === r.id && r15[1].sessionId !== r.sessionId && r15[1].seq <= 2, JSON.stringify({ before: r, after: r15 }));
    await collect();

    // TC-16 logs DB unavailable: app still works, no console errors
    const errsBefore = consoleErrors.length;
    const sid = await addInitScript(`(() => { const o = indexedDB.open.bind(indexedDB);
      indexedDB.open = (name, v) => { if (name === "todo-logs") throw new Error("TC-16 logs unavailable"); return o(name, v); }; })();`);
    await open();
    r = await ev(`TodoLog.setTestCase("TC-16"); await T.add("Still works", "", "", "none"); await T.wait(300);
      return { titles: T.titles(), errorBox: !document.getElementById("error").hidden };`);
    await removeInitScript(sid);
    const newErrs = consoleErrors.slice(errsBefore);
    check("TC-16", "logging failure never breaks the app",
      r.titles.includes("Still works") && !r.errorBox && newErrs.length === 0, JSON.stringify({ r, newErrs }));
    await open();

    // TC-17 empty log
    await ev(`await TodoLog.clear({ silent: true }); await TodoLog.flush();`); await tag("TC-17"); await collect();
    await ev(`await TodoLog.clear({ silent: true }); await TodoLog.flush();`);
    r = await ev(`const d = document.getElementById("activity"); d.open = true; await renderActivity(); await T.wait();
      return { empty: !document.getElementById("activity-empty").hidden, text: document.getElementById("activity-empty").textContent,
        rows: document.querySelectorAll("#activity-list li").length, exported: await TodoLog.exportJSONL() };`);
    check("TC-17", "empty log: 'No activity yet', empty export",
      r.empty && /No activity yet/.test(r.text) && r.rows === 0 && r.exported === "", JSON.stringify(r));

    // TC-18 no user text in log or export
    await fresh(); await tag("TC-18");
    r = await ev(`await T.add("Secret <b>x</b>", "", "private", "daily");
      T.items("Secret <b>x</b>")[0].querySelector("input[type=checkbox]").click(); await T.wait();
      const s = document.getElementById("tag-filter"); s.value = "private"; s.dispatchEvent(new Event("change")); await T.wait();
      s.value = ""; s.dispatchEvent(new Event("change")); await T.wait();
      const text = JSON.stringify(await T.entries()) + (await TodoLog.exportJSONL());
      return { leaks: ["Secret", "<b>", "private"].filter(w => text.includes(w)), actions: (await T.entries("TC-18")).map(e => e.action) };`);
    check("TC-18", "no titles or tag text in log/export", r.leaks.length === 0 && r.actions.includes("task.add") && r.actions.includes("task.complete"), JSON.stringify(r));
    await collect();

    // TC-19 tampered entry renders as text
    await tag("TC-19");
    await ev(`await TodoLog.flush(); await new Promise((res, rej) => { const q = indexedDB.open("todo-logs"); q.onsuccess = () => {
        const db = q.result; const tx = db.transaction("entries", "readwrite");
        tx.objectStore("entries").add({ ts: new Date().toISOString(), sessionId: "x", seq: 1, actor: "<i>a</i>", automated: false,
          action: "<img src=x onerror=window.pwned=1>", taskId: "<b>1</b>", changes: { "<u>k</u>": "<s>v</s>" }, outcome: "ok" });
        tx.oncomplete = () => { db.close(); res(); }; tx.onerror = () => rej(tx.error); }; q.onerror = () => rej(q.error); });`);
    await open();
    r = await ev(`const d = document.getElementById("activity"); d.open = true; await renderActivity(); await T.wait(300);
      const list = document.getElementById("activity-list");
      return { injected: !!list.querySelector("img, b, i, u, s"), pwned: !!window.pwned, shown: list.textContent.includes("<img src=x") };`);
    check("TC-19", "tampered entries render as text", !r.injected && !r.pwned && r.shown, JSON.stringify(r));
    await collect();

    // TC-20 invalid test-case tags rejected
    await ev(`TodoLog.setTestCase(null);`);
    r = await ev(`const res = ["<script>", "TC-", "tc 1"].map(v => TodoLog.setTestCase(v));
      await TodoDB.add("After bad tags", {}); await TodoLog.flush();
      const last = (await TodoLog.all()).filter(e => e.action === "task.add").pop();
      return { res, tagged: last ? (last.testCase || null) : "missing" };`);
    check("TC-20", "invalid test-case tags rejected", JSON.stringify(r.res) === "[false,false,false]" && r.tagged === null, JSON.stringify(r));
    await tag("TC-20"); await collect();
  } catch (e) {
    check("E2E", "browser run", false, e.stack || e.message);
  } finally {
    const unexpected = consoleErrors.filter((m) => !/TC-1[36] injected failure|TC-16 logs unavailable/.test(m));
    check("TC-27", "no unexpected console errors", unexpected.length === 0, unexpected.join(" | "));
    await b.close();
  }

  // Eval of this suite's own run
  try {
    const E = require(path.join(TODO_DIR, "tests", "eval", "eval-logs.js"));
    const outDir = path.join(HERE, "eval");
    fs.mkdirSync(outDir, { recursive: true });
    const logText = [...collected.values()].sort((a, b) => a.id - b.id).map((e) => JSON.stringify(e)).join("\n");
    fs.writeFileSync(path.join(outDir, "run-log.jsonl"), logText + (logText ? "\n" : ""));
    const res = E.evaluate({ logText, specText: fs.readFileSync(path.join(HERE, "test-cases.md"), "utf8"),
      expected: JSON.parse(fs.readFileSync(path.join(HERE, "expected-log.json"), "utf8")) });
    E.writeReports(res, outDir, { suite: "issue-14" });
    check("EVAL", "eval of this run: every e2e case executed with its expected actions", res.ok,
      res.cases.filter((c) => !["pass", "unit", "skipped"].includes(c.status)).map((c) => `${c.id}:${c.status}${c.missing && c.missing.length ? "(" + c.missing.join(",") + ")" : ""}`).join(" "));
  } catch (e) {
    check("EVAL", "eval of this run", false, e.message);
  }
}

// ---------------------------------------------------------------- TC-26 regression
function regression() {
  const run = spawnSync(process.execPath, [path.join(TODO_DIR, "tests", "issue-7", "run.js")], { encoding: "utf8", timeout: 300000 });
  const summary = (run.stdout || "").trim().split("\n").pop();
  let evalOk = false, evalDetail = "missing";
  try {
    const rep = JSON.parse(fs.readFileSync(path.join(TODO_DIR, "tests", "issue-7", "eval", "eval-report.json"), "utf8"));
    evalOk = rep.ok === true; evalDetail = JSON.stringify(rep.summary);
  } catch (e) { evalDetail = e.message; }
  check("TC-26", "issue-7 suite still passes and its eval confirms every e2e case",
    run.status === 0 && /^(\d+)\/\1 passed$/.test(summary || "") && evalOk, `exit=${run.status} summary=${summary} eval=${evalDetail}`);
}

(async () => {
  unit();
  if (!args.includes("--unit")) {
    await e2e();
    if (!args.includes("--skip-regression")) regression();
  }
  process.exit(report() ? 1 : 0);
})();
