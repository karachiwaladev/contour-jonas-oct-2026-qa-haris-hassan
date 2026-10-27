#!/usr/bin/env node
// Procrastinating Pete (PETE-01..06): overdue badges and inline edits. See ../test-cases.md.
//   node todo/tests/personas/procrastinating-pete/run.js
const { runPersona } = require("../lib");

runPersona({
  dir: __dirname, prefix: "PETE",
  async e2e({ ev, open, tag, kase }) {
    let r;
    await open();

    const isRed = (c) => { const [R, G, B] = (c.match(/\d+/g) || []).map(Number); return R > 150 && R > G * 1.5 && R > B * 1.5; };
    await kase("PETE-01", "overdue and due-today badges", async () => {
      await tag("PETE-01");
      r = await ev(`const ids = [await T.add("Late", { due: T.ymd(-1) }), await T.add("Now", { due: T.ymd(0) }), await T.add("Soon", { due: T.ymd(3) })];
        const b = ids.map(id => T.item(id).querySelector(".due"));
        return b.map(x => ({ cls: x.className, text: x.textContent, color: getComputedStyle(x).color }));`);
      const [late, now, soon] = r;
      return [late.cls === "due overdue" && /^Overdue · /.test(late.text) && isRed(late.color) &&
        now.cls === "due today" && now.text === "Due today" &&
        soon.cls === "due" && /^Due /.test(soon.text), r];
    });

    await kase("PETE-02", "reschedule via inline edit", async () => {
      const id = await ev(`await T.reset(); const id = await T.add("Tax return", { due: T.ymd(-3) }); await T.add("Dentist", { due: T.ymd(3) }); return id;`);
      await tag("PETE-02");
      r = await ev(`const before = T.titles(); await T.edit(${id}, { due: T.ymd(7) }); const b = T.item(${id}).querySelector(".due");
        return { before, after: T.titles(), cls: b.className, text: b.textContent, due: (await T.get(${id})).due, exp: T.ymd(7) };`);
      return [JSON.stringify(r.before) === '["Tax return","Dentist"]' && JSON.stringify(r.after) === '["Dentist","Tax return"]' &&
        r.cls === "due" && /^Due /.test(r.text) && r.due === r.exp, r];
    });

    await kase("PETE-03", "200-char title limit on edit", async () => {
      const id = await ev(`await T.reset(); return await T.add("Short");`);
      await tag("PETE-03");
      r = await ev(`T.item(${id}).querySelector(".edit").click(); await T.wait(100); const f = T.item(${id}).querySelector(".edit-form");
        f.querySelector(".edit-title").value = "x".repeat(201); f.querySelector(".edit-save").click(); await T.wait(300); await TodoLog.flush();
        const g = T.item(${id}).querySelector(".edit-form"); const m = g && g.querySelector(".edit-error");
        const res = { open: !!g, msg: m && !m.hidden ? m.textContent : null, stored: (await T.get(${id})).title,
          okEdits: (await T.entries("PETE-03")).filter(e => e.action === "task.edit" && e.outcome === "ok").length };
        if (g) g.querySelector(".edit-cancel").click(); await T.wait(); return res;`);
      return [r.open && /at most 200 characters/.test(r.msg || "") && r.stored === "Short" && r.okEdits === 0, r];
    });

    await kase("PETE-04", "half-typed date blocks the save", async () => {
      const id = await ev(`await T.reset(); return await T.add("Dated", { due: T.ymd(5) });`);
      await tag("PETE-04");
      r = await ev(`T.item(${id}).querySelector(".edit").click(); await T.wait(100);
        const f = T.item(${id}).querySelector(".edit-form"); const due = f.querySelector(".edit-due");
        // A half-typed date (e.g. "12/__/2026") reads as "" with validity.badInput set.
        Object.defineProperty(due, "validity", { get: () => ({ badInput: true, valid: false }) }); due.value = "";
        f.querySelector(".edit-save").click(); await T.wait();
        const g = document.querySelector(".edit-form"); const m = g && g.querySelector(".edit-error");
        const res = { open: !!g, msg: m && !m.hidden ? m.textContent : null, due: (await T.get(${id})).due, exp: T.ymd(5) };
        if (g) g.querySelector(".edit-cancel").click(); await T.wait(); return res;`);
      return [r.open && r.msg === "Enter a complete date, or clear the field." && r.due === r.exp, r];
    });

    await kase("PETE-05", "cancel is disabled during a save", async () => {
      const id = await ev(`await T.reset(); return await T.add("Slow save");`);
      await tag("PETE-05");
      r = await ev(`const real = TodoDB.update; TodoDB.update = async (...a) => { await T.wait(500); return real.apply(TodoDB, a); };
        try {
          T.item(${id}).querySelector(".edit").click(); await T.wait(100);
          const f = T.item(${id}).querySelector(".edit-form"); f.querySelector(".edit-title").value = "Slow save done";
          f.querySelector(".edit-save").click(); await T.wait(50);
          const cancel = f.querySelector(".edit-cancel"); const disabled = cancel.disabled; cancel.click();
          f.querySelector(".edit-title").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await T.wait(50);
          const openDuring = !!document.querySelector(".edit-form"), titleDuring = (await T.get(${id})).title;
          await T.wait(800);
          return { disabled, openDuring, titleDuring, openAfter: !!document.querySelector(".edit-form"), title: (await T.get(${id})).title };
        } finally { TodoDB.update = real; await TodoLog.flush(); }`);
      return [r.disabled && r.openDuring && r.titleDuring === "Slow save" && !r.openAfter && r.title === "Slow save done", r];
    });

    await kase("PETE-06", "editing due/repeat resets the monthly anchor", async () => {
      await ev(`await T.reset();`);
      await tag("PETE-06");
      r = await ev(`const p = n => String(n).padStart(2, "0"); const d = new Date(); let yy = d.getFullYear(), mm = d.getMonth() + 1;
        do { mm++; if (mm > 12) { mm = 1; yy++; } } while (new Date(yy, mm, 0).getDate() !== 31); // next month with a 31st
        const id = await T.add("Rent", { repeat: "monthly", due: yy + "-" + p(mm) + "-15" }); const before = (await T.get(id)).anchorDay;
        await T.edit(id, { due: yy + "-" + p(mm) + "-31" }); const t = await T.get(id);
        await T.tick(id); const copy = (await TodoDB.all()).find(x => x.title === "Rent" && !x.done);
        const ny = mm === 12 ? yy + 1 : yy, nm = mm === 12 ? 1 : mm + 1;
        return { before, anchor: t.anchorDay, next: copy && copy.due, copyAnchor: copy && copy.anchorDay, exp: ny + "-" + p(nm) + "-" + p(Math.min(31, new Date(ny, nm, 0).getDate())) };`);
      return [r.before === 15 && r.anchor === 31 && r.next === r.exp && r.copyAnchor === 31, r];
    });
  },
});
