#!/usr/bin/env node
// Volume Vera (VERA-01..05): load and performance budgets. See ../test-cases.md.
// Every Vera case is a known weakness to watch (no virtualization): a missed
// budget is reported as FINDING, not FAIL. Timings are headless Chrome on this machine.
//   node todo/tests/personas/volume-vera/run.js
const { runPersona, FILLER } = require("../lib");

// In the page: N v4 task records spread over `tags` distinct tags, a quarter done.
const records = (n, tags) => `Array.from({ length: ${n} }, (_, i) => ({
  title: "Task " + i, done: i % 4 === 0, createdAt: i + 1,
  due: i % 3 === 0 ? null : "2027-" + String(1 + (i % 12)).padStart(2, "0") + "-" + String(1 + (i % 28)).padStart(2, "0"),
  tags: ["tag-" + String(i % ${tags}).padStart(3, "0")], repeat: "none", anchorDay: null, nextId: null, spawnedFrom: null,
  priority: ["high", "medium", "low"][i % 3] }))`;

// In the page: run `act`, resolve when `el` (a selector) next changes its children and the frame is painted; ms elapsed.
const TIMED = `T.timed = async (sel, act) => { const el = document.querySelector(sel); const t0 = performance.now();
  const changed = new Promise(res => { const o = new MutationObserver(() => { o.disconnect(); res(); }); o.observe(el, { childList: true }); });
  act(); await changed; await T.frame(); return Math.round(performance.now() - t0); };`;

runPersona({
  dir: __dirname, prefix: "VERA", findingIds: ["VERA-01", "VERA-02", "VERA-03", "VERA-04", "VERA-05"], details: true,
  async e2e({ ev, open, tag, kase, seed, consoleErrors, collect }) {
    let r;

    await seed(4, records(2000, 20));
    const errorsBefore = consoleErrors.length;
    await open();
    await ev(TIMED);

    await kase("VERA-01", "first render of 2,000 tasks", async () => {
      await tag("VERA-01");
      r = await ev(`const t0 = performance.now(); await render(); await T.frame(); const ms = Math.round(performance.now() - t0);
        return { ms, rows: document.querySelectorAll("#task-list .task").length, count: T.count() };`);
      r.consoleErrors = consoleErrors.slice(errorsBefore);
      return [r.ms < 1500 && r.rows === 2000 && r.consoleErrors.length === 0, `render ${r.ms} ms (budget 1500), rows ${r.rows}, console errors ${r.consoleErrors.length}`];
    });

    await kase("VERA-02", "filter change latency at scale", async () => {
      await tag("VERA-02");
      r = await ev(`const active = await T.timed("#task-list", () => document.querySelector('#status-filter [data-status="active"]').click());
        const activeRows = T.titles().length;
        const s = document.getElementById("priority-filter");
        const high = await T.timed("#task-list", () => { s.value = "high"; s.dispatchEvent(new Event("change")); });
        const highRows = T.titles().length;
        s.value = ""; s.dispatchEvent(new Event("change")); await T.wait(); await T.status("all");
        return { active, activeRows, high, highRows };`);
      return [r.active < 500 && r.high < 500 && r.activeRows === 1500 && r.highRows === 500,
        `Active ${r.active} ms (${r.activeRows} rows), High ${r.high} ms (${r.highRows} rows); budget 500 ms each`];
    });

    await kase("VERA-04", "add a task into a large list", async () => {
      await tag("VERA-04");
      r = await ev(`const before = T.count(); const list = document.getElementById("task-list"); const t0 = performance.now();
        const shown = new Promise(res => { const o = new MutationObserver(() => { if (T.items("Vera new task").length) { o.disconnect(); res(); } }); o.observe(list, { childList: true }); });
        document.getElementById("task-title").value = "Vera new task"; document.getElementById("new-task").requestSubmit();
        await shown; await T.frame(); const ms = Math.round(performance.now() - t0); await TodoLog.flush();
        return { ms, before, after: T.count() };`);
      const [ob, tb] = (r.before.match(/\d+/g) || []).map(Number), [oa, ta] = (r.after.match(/\d+/g) || []).map(Number);
      return [r.ms < 1500 && oa === ob + 1 && ta === tb + 1 && ta === 2001, `add + re-render ${r.ms} ms (budget 1500), count "${r.before}" -> "${r.after}"`];
    });

    await seed(4, records(2000, 300));
    await open();
    await ev(TIMED);

    await kase("VERA-03", "many tags in the dropdown", async () => {
      await tag("VERA-03");
      r = await ev(`const s = document.getElementById("tag-filter");
        const ms = await T.timed("#tag-filter", () => { render(); });
        s.focus(); s.click(); // "open" the dropdown
        const values = [...s.options].map(o => o.value).slice(1);
        return { ms, options: values.length, sorted: JSON.stringify(values) === JSON.stringify([...values].sort()) };`);
      return [r.ms < 500 && r.options === 300 && r.sorted, `dropdown built ${r.ms} ms after render() (budget 500, includes reading 2,000 tasks), ${r.options} tag options, sorted ${r.sorted}`];
    });

    await seed(4, []);
    await open();
    await ev(TIMED);

    await kase("VERA-05", "log rollover stays bounded & cheap", async () => {
      await tag("VERA-05");
      await collect();
      r = await ev(`for (let i = 0; i < 1000; i++) TodoLog.log({ action: "${FILLER}", changes: { n: i } }); await TodoLog.flush();
        const full = await TodoLog.count();
        for (let i = 0; i < 50; i++) { document.querySelector('#status-filter [data-status="' + (i % 2 ? "all" : "active") + '"]').click(); await T.wait(10); }
        await TodoLog.flush(); const total = await TodoLog.count();
        const a = document.getElementById("activity");
        const ms = await T.timed("#activity-list", () => { a.open = true; });
        const rows = [...document.querySelectorAll("#activity-list li")];
        const newest = (await TodoLog.recent(1))[0];
        return { full, total, ms, rows: rows.length, firstIsNewest: rows[0] && Number(rows[0].dataset.id) === newest.id,
          summary: document.getElementById("activity-summary").textContent };`);
      return [r.full === 1000 && r.total === 1000 && r.rows === 50 && r.firstIsNewest && r.ms < 500 && r.summary === "Activity log (1000)",
        `store ${r.total} entries after 50 more actions, panel ${r.rows} rows in ${r.ms} ms (budget 500), newest first ${r.firstIsNewest}`];
    });
  },
});
