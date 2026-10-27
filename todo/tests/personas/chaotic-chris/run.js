#!/usr/bin/env node
// Chaotic Chris (CHRIS-01..06): fast fingers and two tabs. See ../test-cases.md.
//   node todo/tests/personas/chaotic-chris/run.js
const { runPersona, HOLDER, v3 } = require("../lib");

runPersona({
  dir: __dirname, prefix: "CHRIS",
  async e2e({ ev, open, tag, kase, seed, b, consoleErrors }) {
    let r;
    await open();

    await kase("CHRIS-01", "fast double submit adds once", async () => {
      await tag("CHRIS-01");
      r = await ev(`const real = TodoDB.add; TodoDB.add = async (...a) => { await T.wait(400); return real.apply(TodoDB, a); };
        try {
          const f = document.getElementById("new-task"), i = document.getElementById("task-title");
          i.value = "Buy milk"; f.requestSubmit(); i.value = "Buy milk"; f.requestSubmit(); await T.wait(900);
        } finally { TodoDB.add = real; document.getElementById("task-title").value = ""; }
        await TodoLog.flush();
        return { stored: (await TodoDB.all()).filter(t => t.title === "Buy milk").length, shown: T.items("Buy milk").length,
          adds: (await T.entries("CHRIS-01")).filter(e => e.action === "task.add").length };`);
      return [r.stored === 1 && r.shown === 1 && r.adds === 1, r];
    });

    const meanwhile = (id, how) => async () => {
      const tid = await ev(`await T.reset(); return await T.add("Gone soon");`);
      await tag(id);
      r = await ev(`T.item(${tid}).querySelector(".edit").click(); await T.wait(100);
        const f = T.item(${tid}).querySelector(".edit-form"); f.querySelector(".edit-title").value = "Changed";
        ${how === "complete" ? `await TodoDB.setDone(${tid}, true);` : `await TodoDB.remove(${tid});`}
        f.querySelector(".edit-save").click(); await T.wait(300); await TodoLog.flush();
        const box = document.getElementById("error"); const t = await T.get(${tid});
        const res = { formOpen: !!document.querySelector(".edit-form"), role: box.getAttribute("role"), box: !box.hidden ? box.textContent : null,
          title: t ? t.title : null, okEdits: (await T.entries(${JSON.stringify(id)})).filter(e => e.action === "task.edit" && e.outcome === "ok").length };
        box.hidden = true; return res;`);
      return [!r.formOpen && r.role === "alert" && /completed or deleted/.test(r.box || "") && r.okEdits === 0 &&
        (how === "complete" ? r.title === "Gone soon" : r.title === null), r];
    };
    await kase("CHRIS-02", "edit a task completed meanwhile", meanwhile("CHRIS-02", "complete"));
    await kase("CHRIS-03", "edit a task deleted meanwhile", meanwhile("CHRIS-03", "delete"));

    await kase("CHRIS-05", "reconnect after onversionchange", async () => {
      await ev(`await T.reset(); await T.add("Before");`);
      await tag("CHRIS-05");
      r = await ev(`await new Promise(res => { const d = indexedDB.deleteDatabase("todo-app"); d.onsuccess = d.onerror = d.onblocked = res; });
        await T.wait(100); const id = await T.add("After"); const box = document.getElementById("error");
        return { id, titles: T.titles(), error: box.hidden ? null : box.textContent };`);
      return [r.id != null && JSON.stringify(r.titles) === '["After"]' && r.error === null, r];
    });

    await kase("CHRIS-06", "one edit form open at a time", async () => {
      const [a, bId] = await ev(`await T.reset(); return [await T.add("Task A"), await T.add("Task B")];`);
      await tag("CHRIS-06");
      r = await ev(`T.item(${a}).querySelector(".edit").click(); await T.wait(100); T.item(${a}).querySelector(".edit-title").value = "A changed";
        T.item(${bId}).querySelector(".edit").click(); await T.wait(150);
        const forms = [...document.querySelectorAll(".edit-form")].map(f => Number(f.closest(".task").dataset.id));
        const aTitle = (await T.get(${a})).title; document.querySelector(".edit-form .edit-cancel").click(); await T.wait();
        return { forms, aTitle };`);
      return [JSON.stringify(r.forms) === JSON.stringify([bId]) && r.aTitle === "Task A", r];
    });

    await kase("CHRIS-04", "second tab upgrades the DB (onblocked)", async () => {
      await seed(3, [v3("Kept")]);
      const script = await b.addInitScript(HOLDER);
      const exceptionsBefore = consoleErrors.filter((m) => m.startsWith("exception")).length;
      try {
        await open();
        await tag("CHRIS-04");
        r = await ev(`await T.wait(200); const box = document.getElementById("error"); let rejected = null;
          try { await TodoDB.all(); } catch (e) { rejected = e.message; }
          const res = { held: !!window.__holder, role: box.getAttribute("role"), box: box.hidden ? null : box.textContent, rejected };
          window.__holder.close(); await T.wait(300); await render(); await T.wait(100);
          res.after = T.titles(); res.boxAfter = box.hidden ? null : box.textContent; return res;`);
      } finally { await b.removeInitScript(script); }
      const exceptions = consoleErrors.filter((m) => m.startsWith("exception")).length - exceptionsBefore;
      r.exceptions = exceptions;
      return [r.held && r.role === "alert" && /being upgraded/.test(r.box || "") && /[Cc]lose other tabs/.test(r.box || "") &&
        /being upgraded/.test(r.rejected || "") && exceptions === 0 && JSON.stringify(r.after) === '["Kept"]' && r.boxAfter === null, r];
    });
  },
});
