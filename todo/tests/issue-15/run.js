#!/usr/bin/env node
// Test runner for ticket #15 (task priority: add, edit, filters). See test-cases.md.
//   node todo/tests/issue-15/run.js                    # e2e + regression (issue-14, which runs issue-7)
//   node todo/tests/issue-15/run.js --skip-regression  # skip TC-24
//   SCREENSHOTS=<dir> node ... run.js                  # also save screenshots
// Every e2e case is tagged in the app log; at the end the eval checks the run
// against test-cases.md + expected-log.json (eval/eval-report.{md,json}).

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { TODO_DIR, createChecker, startBrowser, runEval } = require("../lib/harness");

const HERE = __dirname;
const { check, report } = createChecker();
const args = process.argv.slice(2);

async function e2e() {
  let b;
  try { b = await startBrowser(); } catch (e) { check("E2E", "browser starts", false, e.message); return; }
  const { nav, ev, shot, consoleErrors } = b;
  const collected = new Map();
  let r;

  const H = `window.T = {
    wait: (ms = 250) => new Promise(r => setTimeout(r, ms)),
    ymd(o) { const d = new Date(); d.setDate(d.getDate() + o); const p = n => String(n).padStart(2, "0"); return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()); },
    titles: () => [...document.querySelectorAll("#task-list .title")].map(e => e.textContent),
    items: (t) => [...document.querySelectorAll(".task")].filter(l => (l.querySelector(".title") || {}).textContent === t),
    item: (id) => document.querySelector('.task[data-id="' + id + '"]'),
    async add(title, opts = {}) { const f = id => document.getElementById(id);
      f("task-title").value = title; f("task-due").value = opts.due || ""; f("task-tags").value = opts.tags || "";
      f("task-repeat").value = opts.repeat || "none"; if (opts.priority) f("task-priority").value = opts.priority;
      f("new-task").requestSubmit(); await T.wait(); await TodoLog.flush();
      return (await TodoDB.all()).find(t => t.title === title).id; },
    async edit(id, fields, how = "save") {
      T.item(id).querySelector(".edit").click(); await T.wait(100);
      const form = T.item(id).querySelector(".edit-form");
      const set = (sel, v) => { if (v !== undefined) form.querySelector(sel).value = v; };
      set(".edit-title", fields.title); set(".edit-due", fields.due); set(".edit-tags", fields.tags);
      set(".edit-repeat", fields.repeat); set(".edit-priority", fields.priority);
      if (how === "save") form.querySelector(".edit-save").click();
      else if (how === "cancel") form.querySelector(".edit-cancel").click();
      else if (how === "escape") form.querySelector(".edit-title").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      else if (how === "enter") form.requestSubmit();
      await T.wait(); await TodoLog.flush(); },
    async filter(id, v) { const s = document.getElementById(id); s.value = v; s.dispatchEvent(new Event("change")); await T.wait(); },
    async status(s) { document.querySelector('#status-filter [data-status="' + s + '"]').click(); await T.wait(); },
    async reset() { for (const t of await TodoDB.all()) await TodoDB.remove(t.id); await T.filter("priority-filter", "").catch(() => {}); await render(); await TodoLog.flush(); },
    async entries(tc) { await TodoLog.flush(); return (await TodoLog.all()).filter(e => !tc || e.testCase === tc); },
    get: async (id) => (await TodoDB.all()).find(t => t.id === id),
  };`;
  const open = async () => { await nav("/index.html"); await ev(H); };
  const collect = async () => {
    try { for (const e of await ev(`await TodoLog.flush(); return await TodoLog.all();`)) collected.set(`${e.sessionId}:${e.seq}`, e); } catch {}
  };
  const tag = async (id) => { await collect(); await ev(`TodoLog.setTestCase(${JSON.stringify(id)});`); };
  const seed = async (version, records) => {
    await nav("/tests/issue-7/blank.html");
    return ev(`
      await new Promise(r => { const d = indexedDB.deleteDatabase("todo-app"); d.onsuccess = d.onerror = r; });
      await new Promise((resolve, reject) => { const q = indexedDB.open("todo-app", ${version});
        q.onupgradeneeded = () => q.result.createObjectStore("tasks", { keyPath: "id", autoIncrement: true });
        q.onsuccess = () => { const tx = q.result.transaction("tasks", "readwrite"); for (const r of ${JSON.stringify(records)}) tx.objectStore("tasks").add(r);
          tx.oncomplete = () => { q.result.close(); resolve(); }; }; q.onerror = () => reject(q.error); });`);
  };

  try {
    // TC-17 v3 -> v4 migration (seed first, then open the app)
    await seed(3, [
      { title: "Legacy A", done: false, createdAt: 1, due: null, tags: ["x"], repeat: "none", anchorDay: null, nextId: null, spawnedFrom: null },
      { title: "Legacy B", done: true, createdAt: 2, due: "2026-01-02", tags: [], repeat: "daily", anchorDay: 2, nextId: null, spawnedFrom: null }]);
    await open(); await tag("TC-17");
    r = await ev(`const all = await TodoDB.all(); return { n: all.length, pr: all.map(t => t.priority), tags: all.find(t => t.title === "Legacy A").tags,
      raw: await new Promise(res => { const q = indexedDB.open("todo-app"); q.onsuccess = () => { const db = q.result; const g = db.transaction("tasks").objectStore("tasks").getAll(); g.onsuccess = () => { db.close(); res({ v: db.version, pr: g.result.map(t => t.priority) }); }; }; }) };`);
    check("TC-17", "v3 data migrates to v4 with priority medium, no loss",
      r.n === 2 && r.pr.every((p) => p === "medium") && r.tags[0] === "x" && r.raw.v === 4 && r.raw.pr.every((p) => p === "medium"), JSON.stringify(r));
    await collect();

    // TC-01 add form priority select
    await tag("TC-01");
    r = await ev(`const s = document.getElementById("task-priority"); return s ? { opts: [...s.options].map(o => o.value + ":" + o.textContent), value: s.value } : null;`);
    check("TC-01", "Priority select High/Medium/Low, default Medium",
      r && JSON.stringify(r.opts) === JSON.stringify(["high:High", "medium:Medium", "low:Low"]) && r.value === "medium", JSON.stringify(r));

    // TC-02 add with High
    await ev(`await T.reset();`); await tag("TC-02");
    r = await ev(`const id = await T.add("Taxes", { priority: "high" }); const b = T.item(id).querySelector(".priority");
      return { stored: (await T.get(id)).priority, badge: b && b.textContent, cls: b && b.className, formReset: document.getElementById("task-priority").value };`);
    check("TC-02", "add with High: stored, red High badge, form resets",
      r.stored === "high" && r.badge === "High" && /\bhigh\b/.test(r.cls || "") && r.formReset === "medium", JSON.stringify(r));
    await collect();

    // TC-03 default priority
    await tag("TC-03");
    r = await ev(`const id = await T.add("Default"); const b = T.item(id).querySelector(".priority"); return { stored: (await T.get(id)).priority, badge: b && b.textContent };`);
    check("TC-03", "default priority Medium", r.stored === "medium" && r.badge === "Medium", JSON.stringify(r));
    await collect();

    // TC-04 priority filter
    await ev(`await T.reset(); await T.add("H", { priority: "high" }); await T.add("M"); await T.add("L", { priority: "low" });`);
    await tag("TC-04");
    r = await ev(`const out = {};
      for (const v of ["high", "medium", "low", ""]) { await T.filter("priority-filter", v); out[v || "all"] = { t: T.titles(), c: document.getElementById("count").textContent }; }
      return out;`);
    check("TC-04", "priority filter shows only that priority; All shows all",
      JSON.stringify(r.high.t) === '["H"]' && JSON.stringify(r.medium.t) === '["M"]' && JSON.stringify(r.low.t) === '["L"]' &&
      r.all.t.length === 3 && /showing 1/.test(r.high.c) && !/showing/.test(r.all.c), JSON.stringify(r));
    await collect();

    // TC-05 combined filters
    await ev(`await T.reset();
      await T.add("HW open", { priority: "high", tags: "work" }); await T.add("HW done", { priority: "high", tags: "work" });
      await T.add("HO open", { priority: "high", tags: "other" }); await T.add("MW open", { tags: "work" });
      T.items("HW done")[0].querySelector("input[type=checkbox]").click(); await T.wait();`);
    await tag("TC-05");
    r = await ev(`await T.filter("priority-filter", "high"); await T.status("active"); await T.filter("tag-filter", "work"); const t = T.titles();
      await T.filter("priority-filter", ""); await T.status("all"); await T.filter("tag-filter", ""); return t;`);
    check("TC-05", "priority + status + tag filters combine", JSON.stringify(r) === '["HW open"]', JSON.stringify(r));
    await collect();

    // TC-06 sort by priority, then due
    await ev(`await T.reset();
      await T.add("Low overdue", { priority: "low", due: T.ymd(-1) }); await T.add("High undated", { priority: "high" });
      await T.add("High later", { priority: "high", due: T.ymd(2) }); await T.add("Medium today", { due: T.ymd(0) });
      await T.add("Done high", { priority: "high" }); T.items("Done high")[0].querySelector("input[type=checkbox]").click(); await T.wait();`);
    await tag("TC-06");
    r = await ev(`return T.titles();`);
    check("TC-06", "open tasks sorted by priority, then due (undated last); completed below",
      JSON.stringify(r) === JSON.stringify(["High later", "High undated", "Medium today", "Low overdue", "Done high"]), JSON.stringify(r));
    await shot("01-priority-badges-sorted.png");
    await collect();

    // TC-07 edit opens inline with current values
    await ev(`await T.reset();`);
    const idOld = await ev(`return await T.add("Old", { tags: "a, z" });`);
    await ev(`await T.add("Other");`);
    await tag("TC-07");
    r = await ev(`T.item(${idOld}).querySelector(".edit").click(); await T.wait(100); const f = T.item(${idOld}).querySelector(".edit-form");
      const v = s => f && f.querySelector(s) && f.querySelector(s).value;
      const res = { form: !!f, title: v(".edit-title"), due: v(".edit-due"), tags: v(".edit-tags"), repeat: v(".edit-repeat"), priority: v(".edit-priority"),
        save: !!(f && f.querySelector(".edit-save")), cancel: !!(f && f.querySelector(".edit-cancel")), others: document.querySelectorAll(".edit-form").length };
      if (f) f.querySelector(".edit-cancel").click(); await T.wait(); return res;`);
    check("TC-07", "Edit opens an inline form prefilled with current values",
      r.form && r.title === "Old" && r.due === "" && r.tags === "a, z" && r.repeat === "none" && r.priority === "medium" && r.save && r.cancel && r.others === 1, JSON.stringify(r));
    await collect();

    // TC-08 edit every field
    await tag("TC-08");
    r = await ev(`await T.edit(${idOld}, { title: "New", due: T.ymd(3), tags: "b, c", repeat: "weekly", priority: "high" });
      const t = await T.get(${idOld}); const row = T.item(${idOld});
      return { t, exp: T.ymd(3), shown: row && row.querySelector(".title").textContent, badge: row && row.querySelector(".priority").textContent, formGone: !document.querySelector(".edit-form") };`);
    check("TC-08", "edit saves title, due, tags, repeat (+anchorDay), priority",
      r.t.title === "New" && r.t.due === r.exp && JSON.stringify(r.t.tags) === '["b","c"]' && r.t.repeat === "weekly" &&
      r.t.anchorDay === Number(r.exp.slice(8)) && r.t.priority === "high" && r.shown === "New" && r.badge === "High" && r.formGone, JSON.stringify(r));
    await collect();

    // TC-09 cancel and Escape
    await tag("TC-09");
    r = await ev(`const before = await T.get(${idOld});
      await T.edit(${idOld}, { title: "Nope", priority: "low" }, "cancel"); const a = await T.get(${idOld}); const shownA = T.item(${idOld}).querySelector(".title").textContent;
      await T.edit(${idOld}, { title: "Nope2", priority: "low" }, "escape"); const b2 = await T.get(${idOld}); const formOpen = !!document.querySelector(".edit-form");
      return { same: JSON.stringify(a) === JSON.stringify(before) && JSON.stringify(b2) === JSON.stringify(before), shownA, formOpen,
        edits: (await T.entries("TC-09")).filter(e => e.action === "task.edit").length };`);
    check("TC-09", "Cancel and Escape discard changes; nothing logged", r.same && r.shownA === "New" && !r.formOpen && r.edits === 0, JSON.stringify(r));
    await collect();

    // TC-10 Enter saves
    await tag("TC-10");
    r = await ev(`await T.edit(${idOld}, { title: "Entered" }, "enter"); return (await T.get(${idOld})).title;`);
    check("TC-10", "Enter in the edit form saves", r === "Entered", String(r));
    await collect();

    // TC-11 validation
    await tag("TC-11");
    r = await ev(`T.item(${idOld}).querySelector(".edit").click(); await T.wait(100); const f = T.item(${idOld}).querySelector(".edit-form");
      f.querySelector(".edit-title").value = "   "; f.querySelector(".edit-save").click(); await T.wait();
      const g = T.item(${idOld}).querySelector(".edit-form"); const msg = g && g.querySelector(".edit-error");
      const res = { open: !!g, msg: msg && !msg.hidden && msg.textContent, stored: (await T.get(${idOld})).title };
      if (g) g.querySelector(".edit-cancel").click(); await T.wait(); return res;`);
    check("TC-11", "blank title not saved; form stays open with a message", r.open && !!r.msg && r.stored === "Entered", JSON.stringify(r));
    await collect();

    // TC-12 repeat via edit gets today
    await ev(`await T.reset();`);
    const idNoDue = await ev(`return await T.add("No due");`);
    await tag("TC-12");
    r = await ev(`await T.edit(${idNoDue}, { repeat: "daily", due: "" }); const t = await T.get(${idNoDue}); return { due: t.due, repeat: t.repeat, today: T.ymd(0) };`);
    check("TC-12", "setting a repeat with no due date sets due today", r.due === r.today && r.repeat === "daily", JSON.stringify(r));
    await collect();

    // TC-13 only open tasks editable
    await ev(`await T.reset(); await T.add("Open one"); await T.add("Closed one"); T.items("Closed one")[0].querySelector("input[type=checkbox]").click(); await T.wait();`);
    await tag("TC-13");
    r = await ev(`return { open: !!T.items("Open one")[0].querySelector(".edit"), closed: !!T.items("Closed one")[0].querySelector(".edit") };`);
    check("TC-13", "Edit only on open tasks", r.open && !r.closed, JSON.stringify(r));
    await collect();

    // TC-14 spawned copy keeps priority
    await ev(`await T.reset();`);
    await tag("TC-14");
    r = await ev(`const id = await T.add("Meds", { priority: "high", repeat: "daily", due: T.ymd(0) });
      T.item(id).querySelector("input[type=checkbox]").click(); await T.wait();
      const copy = (await TodoDB.all()).find(t => t.title === "Meds" && !t.done); return copy && copy.priority;`);
    check("TC-14", "spawned occurrence keeps priority", r === "high", String(r));
    await collect();

    // TC-15 edit logged without user text
    await ev(`await T.reset();`);
    const idSecret = await ev(`return await T.add("Plain", { tags: "public" });`);
    await tag("TC-15");
    r = await ev(`await T.edit(${idSecret}, { title: "Secret plan", tags: "private", priority: "low" });
      const edits = (await T.entries("TC-15")).filter(e => e.action === "task.edit"); const all = JSON.stringify(await TodoLog.all()) + await TodoLog.exportJSONL();
      return { n: edits.length, e: edits[0], leak: ["Secret", "private"].filter(w => all.includes(w)) };`);
    check("TC-15", "task.edit logged with field names only, no user text",
      r.n === 1 && r.e.actor === "user" && r.e.taskId === idSecret && ["title", "tags", "priority"].every((f) => r.e.changes.fields.includes(f)) &&
      r.e.changes.priority === "low" && r.e.changes.tags === 1 && r.leak.length === 0, JSON.stringify(r));
    await collect();

    // TC-16 API edit attributed to api
    await tag("TC-16");
    r = await ev(`await TodoDB.update(${idSecret}, { priority: "high" }); await render(); await TodoLog.flush();
      const e = (await T.entries("TC-16")).filter(x => x.action === "task.edit").pop(); return { stored: (await T.get(${idSecret})).priority, actor: e && e.actor, changes: e && e.changes };`);
    check("TC-16", "API update saved and logged as api with changed fields",
      r.stored === "high" && r.actor === "api" && JSON.stringify(r.changes) === JSON.stringify({ fields: ["priority"], priority: "high" }), JSON.stringify(r));
    await collect();

    // TC-19 one edit at a time
    await ev(`await T.reset();`);
    const [ida, idb] = await ev(`return [await T.add("First"), await T.add("Second")];`);
    await tag("TC-19");
    r = await ev(`T.item(${ida}).querySelector(".edit").click(); await T.wait(100); T.item(${ida}).querySelector(".edit-title").value = "Changed";
      T.item(${idb}).querySelector(".edit").click(); await T.wait(150);
      const forms = [...document.querySelectorAll(".edit-form")].map(f => Number(f.closest(".task").dataset.id));
      const first = (await T.get(${ida})).title; document.querySelector(".edit-form .edit-cancel").click(); await T.wait();
      return { forms, first };`);
    check("TC-19", "opening a second edit closes the first without saving", JSON.stringify(r.forms) === JSON.stringify([idb]) && r.first === "First", JSON.stringify(r));
    await collect();

    // TC-20 edits persist across reload
    await tag("TC-20");
    await ev(`await T.edit(${ida}, { priority: "low", due: T.ymd(4) });`);
    await open();
    r = await ev(`const t = await T.get(${ida}); return { p: t.priority, due: t.due, exp: T.ymd(4), badge: T.item(${ida}).querySelector(".priority").textContent };`);
    check("TC-20", "edited values persist after reload", r.p === "low" && r.due === r.exp && r.badge === "Low", JSON.stringify(r));
    await collect();

    // TC-21 editing a recurring task's due date updates the anchor
    await ev(`await T.reset();`);
    await tag("TC-21");
    r = await ev(`const d = new Date(); const y = d.getFullYear(), m = d.getMonth() + 1; const p = n => String(n).padStart(2, "0");
      // the next future month that has a 31st
      let yy = y, mm = m;
      do { mm++; if (mm > 12) { mm = 1; yy++; } } while (new Date(yy, mm, 0).getDate() !== 31);
      const due31 = yy + "-" + p(mm) + "-31";
      const id = await T.add("Rent", { repeat: "monthly", due: yy + "-" + p(mm) + "-15" });
      await T.edit(id, { due: due31 }); const t = await T.get(id);
      T.item(id).querySelector("input[type=checkbox]").click(); await T.wait();
      const copy = (await TodoDB.all()).find(x => x.title === "Rent" && !x.done);
      const ny = mm === 12 ? yy + 1 : yy, nm = mm === 12 ? 1 : mm + 1; const last = new Date(ny, nm, 0).getDate();
      return { anchor: t.anchorDay, due: t.due, next: copy && copy.due, exp: ny + "-" + p(nm) + "-" + p(Math.min(31, last)) };`);
    check("TC-21", "editing a monthly task's due to the 31st sets anchorDay 31 and the next copy follows it",
      r.anchor === 31 && r.next === r.exp, JSON.stringify(r));
    await collect();

    // TC-22 invalid updates rejected by the data layer
    await ev(`await T.reset();`);
    const idv = await ev(`return await T.add("Valid", { priority: "low" });`);
    await tag("TC-22");
    r = await ev(`const before = JSON.stringify(await T.get(${idv})); const out = [];
      for (const bad of [{ title: "  " }, { priority: "urgent" }, { due: "2026-13-45" }, { repeat: "yearly" }]) {
        try { await TodoDB.update(${idv}, bad); out.push("saved"); } catch (e) { out.push("rejected"); } }
      await TodoLog.flush();
      return { out, same: JSON.stringify(await T.get(${idv})) === before,
        errs: (await T.entries("TC-22")).filter(e => e.action === "task.edit" && e.outcome === "error").length };`);
    check("TC-22", "invalid updates rejected, nothing stored, logged as errors",
      JSON.stringify(r.out) === '["rejected","rejected","rejected","rejected"]' && r.same && r.errs === 4, JSON.stringify(r));
    await collect();

    // TC-23 HTML in an edited title renders as text
    await tag("TC-23");
    r = await ev(`await T.edit(${idv}, { title: "<img src=x onerror=window.pwned=1>" });
      return { shown: T.item(${idv}).querySelector(".title").textContent, img: !!document.querySelector("#task-list img"), pwned: !!window.pwned };`);
    check("TC-23", "edited HTML title renders as text", r.shown === "<img src=x onerror=window.pwned=1>" && !r.img && !r.pwned, JSON.stringify(r));
    await collect();

    // TC-26 an edited copy survives undo of its parent
    await ev(`await T.reset();`);
    await tag("TC-26");
    r = await ev(`const a = await T.add("Series A", { repeat: "daily", due: T.ymd(0) });
      T.item(a).querySelector("input[type=checkbox]").click(); await T.wait();
      const b = (await TodoDB.all()).find(t => t.title === "Series A" && !t.done).id;
      await T.edit(b, { title: "B edited", priority: "high" });
      T.item(a).querySelector("input[type=checkbox]").click(); await T.wait(); await TodoLog.flush();
      const B = await T.get(b), A = await T.get(a); return { b: B && { title: B.title, p: B.priority, done: B.done }, aRepeat: A.repeat, aDone: A.done };`);
    check("TC-26", "edited copy kept on undo; parent becomes one-off",
      r.b && r.b.title === "B edited" && r.b.p === "high" && !r.b.done && r.aRepeat === "none" && !r.aDone, JSON.stringify(r));
    await collect();

    // TC-27 saving an edit of a task that was completed meanwhile
    await ev(`await T.reset();`);
    const idGone = await ev(`return await T.add("Gone soon");`);
    await tag("TC-27");
    r = await ev(`T.item(${idGone}).querySelector(".edit").click(); await T.wait(100);
      const f = T.item(${idGone}).querySelector(".edit-form"); f.querySelector(".edit-title").value = "Changed";
      await TodoDB.setDone(${idGone}, true);
      f.querySelector(".edit-save").click(); await T.wait(300); await TodoLog.flush();
      const g = document.querySelector(".edit-form"); const msg = g && g.querySelector(".edit-error");
      const res = { msg: msg && !msg.hidden ? msg.textContent : null, title: (await T.get(${idGone})).title,
        errs: (await T.entries("TC-27")).filter(e => e.action === "task.edit" && e.outcome === "error").map(e => e.actor) };
      if (g) g.querySelector(".edit-cancel").click(); await T.wait(); return res;`);
    check("TC-27", "edit of a completed/deleted task is rejected and shown",
      /completed or deleted/i.test(r.msg || "") && r.title === "Gone soon" && JSON.stringify(r.errs) === '["user"]', JSON.stringify(r));
    await collect();

    // TC-28 one title rule; long legacy titles stay editable
    await ev(`await T.reset();`);
    await tag("TC-28");
    r = await ev(`let addRejected = false; try { await TodoDB.add("x".repeat(250), {}); } catch { addRejected = true; }
      const legacyId = await new Promise((res, rej) => { const q = indexedDB.open("todo-app"); q.onsuccess = () => { const db = q.result;
        const tx = db.transaction("tasks", "readwrite"); const req = tx.objectStore("tasks").add({ title: "y".repeat(250), done: false, createdAt: Date.now(),
          due: null, tags: [], repeat: "none", anchorDay: null, nextId: null, spawnedFrom: null, priority: "medium" });
        tx.oncomplete = () => { db.close(); res(req.result); }; tx.onerror = () => rej(tx.error); }; q.onerror = () => rej(q.error); });
      await render(); await T.wait();
      await T.edit(legacyId, { priority: "low" });
      const t = await T.get(legacyId); const stillLong = (await TodoDB.all()).some(x => x.title === "x".repeat(250));
      return { addRejected, stillLong, p: t.priority, len: t.title.length };`);
    check("TC-28", "long titles rejected on add; legacy long title still editable",
      r.addRejected && !r.stillLong && r.p === "low" && r.len === 250, JSON.stringify(r));
    await collect();

    // TC-29 unsaved edits survive re-renders
    await ev(`await T.reset();`);
    const [idA, idB] = await ev(`return [await T.add("Task A"), await T.add("Task B")];`);
    await tag("TC-29");
    r = await ev(`T.item(${idA}).querySelector(".edit").click(); await T.wait(100);
      T.item(${idA}).querySelector(".edit-title").value = "Draft";
      T.item(${idA}).querySelector(".edit-title").dispatchEvent(new Event("input", { bubbles: true }));
      T.item(${idB}).querySelector("input[type=checkbox]").click(); await T.wait(300);
      const f = T.item(${idA}) && T.item(${idA}).querySelector(".edit-form");
      const res = { open: !!f, title: f && f.querySelector(".edit-title").value, stored: (await T.get(${idA})).title };
      if (f) f.querySelector(".edit-cancel").click(); await T.wait(); return res;`);
    check("TC-29", "unsaved edit draft survives an unrelated re-render", r.open && r.title === "Draft" && r.stored === "Task A", JSON.stringify(r));
    await collect();

    // TC-30 one save at a time
    await tag("TC-30");
    r = await ev(`T.item(${idA}).querySelector(".edit").click(); await T.wait(100);
      const f = T.item(${idA}).querySelector(".edit-form"); f.querySelector(".edit-title").value = "Saved once";
      f.requestSubmit(); f.requestSubmit(); await T.wait(400); await TodoLog.flush();
      return { edits: (await T.entries("TC-30")).filter(e => e.action === "task.edit").length, title: (await T.get(${idA})).title };`);
    check("TC-30", "double submit saves once", r.edits === 1 && r.title === "Saved once", JSON.stringify(r));
    await collect();

    // TC-18 tampered priority
    await seed(4, [
      { title: "Evil", done: false, createdAt: 1, due: null, tags: [], repeat: "none", anchorDay: null, nextId: null, spawnedFrom: null, priority: "<img src=x onerror=window.pwned=1>" },
      { title: "Urgent", done: false, createdAt: 2, due: null, tags: [], repeat: "none", anchorDay: null, nextId: null, spawnedFrom: null, priority: "urgent" }]);
    await open(); await tag("TC-18");
    r = await ev(`await T.filter("priority-filter", "medium"); const t = T.titles().sort();
      const badges = [...document.querySelectorAll("#task-list .priority")].map(b => b.textContent);
      await T.filter("priority-filter", ""); return { t, badges, img: !!document.querySelector("#task-list img"), pwned: !!window.pwned };`);
    check("TC-18", "tampered priorities treated as Medium, no injection",
      JSON.stringify(r.t) === '["Evil","Urgent"]' && r.badges.every((b) => b === "Medium") && !r.img && !r.pwned, JSON.stringify(r));
    await collect();

    // Visual state for the PR (not a test case): an inline edit in progress.
    if (process.env.SCREENSHOTS) {
      await ev(`TodoLog.setTestCase(null); await T.reset();
        await T.add("Ship release", { priority: "high", due: T.ymd(1), tags: "work" }); await T.add("Pay rent", { priority: "medium", due: T.ymd(0), repeat: "monthly", tags: "home" });
        const id = await T.add("Read book", { priority: "low", tags: "personal" });
        T.item(id).querySelector(".edit").click(); await T.wait(100);`);
      await shot("02-inline-edit.png");
      await ev(`document.querySelector(".edit-form .edit-cancel").click(); await T.wait(); await T.filter("priority-filter", "high");`);
      await shot("03-priority-filter-high.png");
      await ev(`await T.filter("priority-filter", "");`);
    }
  } catch (e) {
    check("E2E", "browser run", false, e.stack || e.message);
  } finally {
    const unexpected = consoleErrors.filter((m) => !/TC-\d+ injected failure/.test(m));
    check("TC-25", "no unexpected console errors", unexpected.length === 0, unexpected.join(" | "));
    await collect();
    await b.close();
  }
  runEval({ collected, suiteDir: HERE, suite: "issue-15", check });
}

// TC-24: the older suites (issue-14 runs issue-7 as its TC-26) still pass with their evals.
function regression() {
  const env = { ...process.env }; delete env.SCREENSHOTS;
  const run = spawnSync(process.execPath, [path.join(TODO_DIR, "tests", "issue-14", "run.js")], { encoding: "utf8", timeout: 600000, env });
  const summary = (run.stdout || "").trim().split("\n").pop();
  const evalOk = (suite) => { try { return JSON.parse(fs.readFileSync(path.join(TODO_DIR, "tests", suite, "eval", "eval-report.json"), "utf8")).ok === true; } catch { return false; } };
  check("TC-24", "issue-14 (incl. issue-7) suites pass with their evals",
    run.status === 0 && /^(\d+)\/\1 passed$/.test(summary || "") && evalOk("issue-14") && evalOk("issue-7"),
    `exit=${run.status} summary=${summary} evals=${evalOk("issue-14")},${evalOk("issue-7")}`);
}

(async () => {
  await e2e();
  if (!args.includes("--skip-regression")) regression();
  process.exit(report() ? 1 : 0);
})();
