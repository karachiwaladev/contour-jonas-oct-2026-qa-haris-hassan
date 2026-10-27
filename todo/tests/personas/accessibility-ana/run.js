#!/usr/bin/env node
// Accessibility Ana (ANA-01..07): names, focus order, alerts, contrast. See ../test-cases.md.
// ANA-05 and ANA-06 (light/dark contrast) are known weaknesses: reported as FINDING, not FAIL;
// each prints every element's measured ratio.
// ANA-07 needs a real screen reader and is printed as MANUAL.
//   node todo/tests/personas/accessibility-ana/run.js
const { runPersona } = require("../lib");

// In the page: WCAG contrast of each text token against its effective background.
const CONTRAST = `
  const rgb = s => (s.match(/[\\d.]+/g) || []).map(Number);
  const lum = c => { const [r, g, b] = c.slice(0, 3).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return Math.round((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) * 100) / 100; };
  const bgOf = el => { for (let e = el; e; e = e.parentElement) { const c = rgb(getComputedStyle(e).backgroundColor); if (c.length === 3 || c[3] > 0) return c; } return [255, 255, 255]; };
  const of = el => el ? ratio(rgb(getComputedStyle(el).color), bgOf(el)) : null;
  const q = s => document.querySelector(s);
  return {
    body: of(document.body), muted: of(q("#count")), mutedOnCard: of(q("#task-list .due:not(.overdue):not(.today)")),
    pillHigh: of(q(".priority.high")), pillMedium: of(q(".priority.medium")), pillLow: of(q(".priority.low")),
    pillOverdue: of(q(".due.overdue")), pillToday: of(q(".due.today")), pillChip: of(q(".chip")),
    button: of(q("#new-task button[type=submit]")),
  };`;

// Every element must reach AA (4.5:1). Details list each measured ratio, the failing ones first.
const AA = 4.5;
const judge = (r) => {
  const fails = Object.entries(r).filter(([, v]) => typeof v !== "number" || v < AA);
  const all = Object.entries(r).map(([k, v]) => `${k} ${v}:1`).join(", ");
  return [fails.length === 0,
    (fails.length ? `below ${AA}:1: ${fails.map(([k, v]) => `${k} ${v}:1`).join(", ")}; ` : `all ≥ ${AA}:1; `) + `measured: ${all}`,
    { show: true }];
};

runPersona({
  dir: __dirname, prefix: "ANA", findingIds: ["ANA-05", "ANA-06"],
  async e2e({ ev, open, tag, kase, manual, send }) {
    let r;
    await open();
    await send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});

    await kase("ANA-01", "accessible names on controls", async () => {
      const id = await ev(`return await T.add("Read", { tags: "book", repeat: "daily" });`);
      await tag("ANA-01");
      r = await ev(`const li = T.item(${id}); const a = s => { const e = li.querySelector(s); return e && e.getAttribute("aria-label"); };
        return { check: a("input[type=checkbox]"), edit: a(".edit"), del: a(".delete"), stop: a(".stop-repeat"), chip: li.querySelector(".chip").title,
          form: ["task-title", "task-due", "task-repeat", "task-priority", "task-tags"].map(i => !!document.getElementById(i).getAttribute("aria-label")) };`);
      return [r.check === 'Mark "Read" as done' && r.edit === 'Edit "Read"' && r.del === 'Delete "Read"' && r.stop === 'Stop repeating "Read"' &&
        r.chip === "Show only #book" && r.form.every(Boolean), r];
    });

    await kase("ANA-02", "inline edit focus order", async () => {
      const id = await ev(`await T.reset(); return await T.add("Focus me");`);
      await tag("ANA-02");
      await ev(`T.item(${id}).querySelector(".edit").click(); await T.wait(150);`);
      const name = `const e = document.activeElement; return e && e.closest(".edit-form") ? e.className.split(" ")[0] : "(outside)";`;
      const order = [await ev(name)];
      for (let i = 0; i < 20 && order[order.length - 1] !== "(outside)"; i++) {
        await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
        await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
        const n = await ev(name);
        if (n !== order[order.length - 1]) order.push(n); // the date input has several segments
      }
      await ev(`const c = document.querySelector(".edit-form .edit-cancel"); if (c) c.click(); await T.wait();`);
      const exp = ["edit-title", "edit-due", "edit-repeat", "edit-priority", "edit-tags", "edit-save", "edit-cancel", "(outside)"];
      return [JSON.stringify(order) === JSON.stringify(exp), order];
    });

    await kase("ANA-03", "errors are announced via role=alert", async () => {
      const id = await ev(`await T.reset(); return await T.add("Name me");`);
      await tag("ANA-03");
      r = await ev(`T.item(${id}).querySelector(".edit").click(); await T.wait(100); const f = T.item(${id}).querySelector(".edit-form");
        f.querySelector(".edit-title").value = "  "; f.querySelector(".edit-save").click(); await T.wait();
        const m = document.querySelector(".edit-form .edit-error");
        const res = { role: m && m.getAttribute("role"), visible: !!m && !m.hidden && m.offsetHeight > 0, text: m && m.textContent };
        document.querySelector(".edit-form .edit-cancel").click(); await T.wait(); return res;`);
      return [r.role === "alert" && r.visible && r.text === "The title can't be empty.", r];
    });

    await kase("ANA-04", "page-level error is role=alert", async () => {
      await ev(`await T.reset();`);
      await tag("ANA-04");
      r = await ev(`const real = TodoDB.add; TodoDB.add = () => Promise.reject(new Error("Storage is full."));
        try { document.getElementById("task-title").value = "Will fail"; document.getElementById("new-task").requestSubmit(); await T.wait(400); }
        finally { TodoDB.add = real; }
        const box = document.getElementById("error");
        const res = { role: box.getAttribute("role"), visible: !box.hidden && box.offsetHeight > 0, text: box.textContent };
        box.hidden = true; document.getElementById("task-title").value = ""; await TodoLog.flush(); return res;`);
      return [r.role === "alert" && r.visible && /^Couldn't add the task\. Storage is full\.$/.test(r.text), r];
    });

    // Contrast: a task per pill style, then measure in each theme.
    const contrastSetup = `await T.reset(); await T.add("Overdue high", { priority: "high", due: T.ymd(-1), tags: "work" });
      await T.add("Due today", { due: T.ymd(0) }); await T.add("Later low", { priority: "low", due: T.ymd(3) });`;

    await kase("ANA-05", "contrast — light theme", async () => {
      await ev(contrastSetup);
      await tag("ANA-05");
      await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
      r = await ev(`await T.frame(); ${CONTRAST}`);
      return judge(r);
    });

    await kase("ANA-06", "contrast — dark theme", async () => {
      await tag("ANA-06");
      await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
      try { r = await ev(`await T.frame(); ${CONTRAST}`); }
      finally { await send("Emulation.setEmulatedMedia", { features: [] }); }
      return judge(r);
    });

    manual("ANA-07", "screen-reader walkthrough", "needs a person with a real screen reader (NVDA/VoiceOver); see test-cases.md");
  },
});
