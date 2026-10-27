#!/usr/bin/env node
// Casual Carla (CARLA-01..06): first-time, minimal journey. See ../test-cases.md.
//   node todo/tests/personas/casual-carla/run.js
const { runPersona } = require("../lib");

runPersona({
  dir: __dirname, prefix: "CARLA",
  async e2e({ ev, open, tag, kase }) {
    let r;
    await open();

    await kase("CARLA-01", "empty state on first open", async () => {
      await tag("CARLA-01");
      r = await ev(`const e = document.getElementById("empty");
        return { items: document.getElementById("task-list").children.length, empty: !e.hidden && e.textContent, count: T.count() };`);
      return [r.items === 0 && r.empty === "No tasks yet. Add one above." && r.count === "", r];
    });

    let id;
    await kase("CARLA-02", "add a basic task", async () => {
      await tag("CARLA-02");
      r = await ev(`const id = await T.add("Buy milk"); const li = T.item(id);
        return { id, titles: T.titles(), badge: li.querySelector(".priority").textContent, due: !!li.querySelector(".due"),
          chips: li.querySelectorAll(".chip").length, repeat: !!li.querySelector(".repeat"),
          emptyHidden: document.getElementById("empty").hidden, count: T.count() };`);
      id = r.id;
      return [JSON.stringify(r.titles) === '["Buy milk"]' && r.badge === "Medium" && !r.due && !r.chips && !r.repeat &&
        r.emptyHidden && r.count === "1 of 1 left", r];
    });

    await kase("CARLA-03", "blank / whitespace title does nothing", async () => {
      await ev(`await T.reset();`);
      await tag("CARLA-03");
      r = await ev(`const f = document.getElementById("new-task"), i = document.getElementById("task-title");
        i.value = ""; f.requestSubmit(); await T.wait(); i.value = "   "; f.requestSubmit(); await T.wait();
        return { items: document.getElementById("task-list").children.length, stored: (await TodoDB.all()).length,
          adds: (await T.entries("CARLA-03")).filter(e => e.action === "task.add").length };`);
      await ev(`document.getElementById("task-title").value = "";`);
      return [r.items === 0 && r.stored === 0 && r.adds === 0, r];
    });

    await kase("CARLA-04", "complete a task", async () => {
      id = await ev(`return await T.add("Buy milk");`);
      await tag("CARLA-04");
      r = await ev(`await T.tick(${id}); const li = T.item(${id});
        const res = { done: li.classList.contains("done"), checked: li.querySelector("input").checked,
          strike: getComputedStyle(li.querySelector(".title")).textDecorationLine, count: T.count() };
        await T.status("completed"); res.completedView = T.titles(); await T.status("active"); res.activeView = T.titles(); await T.status("all");
        return res;`);
      return [r.done && r.checked && /line-through/.test(r.strike) && r.count === "0 of 1 left" &&
        JSON.stringify(r.completedView) === '["Buy milk"]' && r.activeView.length === 0, r];
    });

    await kase("CARLA-05", "delete a task", async () => {
      await tag("CARLA-05");
      r = await ev(`T.item(${id}).querySelector(".delete").click(); await T.wait(); await TodoLog.flush(); const e = document.getElementById("empty");
        return { items: document.getElementById("task-list").children.length, stored: (await TodoDB.all()).length, empty: !e.hidden && e.textContent };`);
      return [r.items === 0 && r.stored === 0 && /^No tasks yet\./.test(r.empty || ""), r];
    });

    await kase("CARLA-06", "tasks persist across reload", async () => {
      await ev(`await T.reset(); await T.add("Call mum"); const id = await T.add("Pay bills"); await T.tick(id);`);
      await tag("CARLA-06");
      await open();
      r = await ev(`return [...document.querySelectorAll("#task-list .task")].map(li => ({ t: li.querySelector(".title").textContent,
        done: li.classList.contains("done") && li.querySelector("input").checked, badge: li.querySelector(".priority").textContent }));`);
      return [JSON.stringify(r) === JSON.stringify([{ t: "Call mum", done: false, badge: "Medium" }, { t: "Pay bills", done: true, badge: "Medium" }]), r];
    });
  },
});
