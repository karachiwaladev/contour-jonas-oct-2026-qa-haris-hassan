#!/usr/bin/env node
// Organized Omar (OMAR-01..07): power planner — sort, combined filters, tags. See ../test-cases.md.
//   node todo/tests/personas/organized-omar/run.js
const { runPersona } = require("../lib");

runPersona({
  dir: __dirname, prefix: "OMAR",
  async e2e({ ev, open, tag, kase }) {
    let r;
    await open();

    await kase("OMAR-01", "build a planned week", async () => {
      await tag("OMAR-01");
      r = await ev(`await T.add("High undated", { priority: "high" }); await T.add("High later", { priority: "high", due: T.ymd(2) });
        await T.add("Medium today", { due: T.ymd(0) }); await T.add("Low overdue", { priority: "low", due: T.ymd(-1) }); await T.add("Low undated", { priority: "low" });
        return { n: T.titles().length, count: T.count() };`);
      return [r.n === 5 && r.count === "5 of 5 left", r];
    });

    await kase("OMAR-02", "default sort order", async () => {
      await tag("OMAR-02");
      r = await ev(`return T.titles();`);
      return [JSON.stringify(r) === JSON.stringify(["High later", "High undated", "Medium today", "Low overdue", "Low undated"]), r];
    });

    await kase("OMAR-03", "combined status + priority + tag filter", async () => {
      await ev(`await T.reset();
        await T.add("HW open", { priority: "high", tags: "work" }); const d = await T.add("HW done", { priority: "high", tags: "work" });
        await T.add("HO open", { priority: "high", tags: "home" }); await T.add("MW open", { tags: "work" }); await T.add("LW open", { priority: "low", tags: "work" });
        await T.tick(d);`);
      await tag("OMAR-03");
      r = await ev(`await T.status("active"); await T.filter("priority-filter", "high"); await T.filter("tag-filter", "work");
        const res = { t: T.titles(), count: T.count() }; await T.filter("tag-filter", ""); await T.filter("priority-filter", ""); await T.status("all"); return res;`);
      return [JSON.stringify(r.t) === '["HW open"]' && / · showing 1$/.test(r.count), r];
    });

    await kase("OMAR-04", "tag normalization", async () => {
      await ev(`await T.reset();`);
      await tag("OMAR-04");
      r = await ev(`const id = await T.add("Report", { tags: "Work, work , URGENT," });
        return { stored: (await T.get(id)).tags, chips: [...T.item(id).querySelectorAll(".chip")].map(c => c.textContent) };`);
      return [JSON.stringify(r.stored) === '["work","urgent"]' && JSON.stringify(r.chips) === '["#work","#urgent"]', r];
    });

    await kase("OMAR-05", "tag chip click sets the filter without ticking", async () => {
      const id = await ev(`await T.reset(); await T.add("Other", { tags: "home" }); return await T.add("Plan sprint", { tags: "work" });`);
      await tag("OMAR-05");
      r = await ev(`T.item(${id}).querySelector(".chip").click(); await T.wait(); await TodoLog.flush();
        const res = { dropdown: document.getElementById("tag-filter").value, titles: T.titles(), done: (await T.get(${id})).done,
          checked: T.item(${id}).querySelector("input").checked };
        await T.filter("tag-filter", ""); return res;`);
      return [r.dropdown === "work" && JSON.stringify(r.titles) === '["Plan sprint"]' && r.done === false && r.checked === false, r];
    });

    await kase("OMAR-06", "\"showing N\" counter accuracy", async () => {
      await ev(`await T.reset(); await T.add("A", { priority: "high" }); const b = await T.add("B", { priority: "high" });
        await T.add("C"); await T.add("D"); await T.add("E", { priority: "low" }); await T.tick(b);`);
      await tag("OMAR-06");
      r = await ev(`await T.filter("priority-filter", "high"); const res = { shown: T.titles().length, count: T.count() };
        await T.filter("priority-filter", ""); return res;`);
      return [r.shown === 2 && r.count === "4 of 5 left · showing 2", r];
    });

    await kase("OMAR-07", "dropdown resets when last tagged task is deleted", async () => {
      const id = await ev(`await T.reset(); await T.add("Home chore", { tags: "home" }); await T.add("Untagged");
        return await T.add("Only work", { tags: "work" });`);
      await ev(`await T.filter("tag-filter", "work");`);
      await tag("OMAR-07");
      r = await ev(`const before = T.titles(); T.item(${id}).querySelector(".delete").click(); await T.wait(); await TodoLog.flush();
        const s = document.getElementById("tag-filter");
        return { before, options: [...s.options].map(o => o.value), value: s.value, titles: T.titles().sort(), count: T.count() };`);
      return [JSON.stringify(r.before) === '["Only work"]' && !r.options.includes("work") && r.value === "" &&
        JSON.stringify(r.titles) === '["Home chore","Untagged"]' && !/showing/.test(r.count), r];
    });
  },
});
