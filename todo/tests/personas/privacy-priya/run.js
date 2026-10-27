#!/usr/bin/env node
// Privacy Priya (PRIYA-01..05): no user text in the log or its export. See ../test-cases.md.
//   node todo/tests/personas/privacy-priya/run.js
const { runPersona } = require("../lib");

runPersona({
  dir: __dirname, prefix: "PRIYA",
  async e2e({ ev, open, tag, kase, collect }) {
    let r;
    await open();

    await kase("PRIYA-01", "no title text in the log", async () => {
      await tag("PRIYA-01");
      r = await ev(`const id = await T.add("Secret merger plan", { tags: "confidential" }); await T.tick(id);
        const all = JSON.stringify(await TodoLog.all()); const add = (await T.entries("PRIYA-01")).find(e => e.action === "task.add");
        return { leaks: ["Secret", "merger", "confidential"].filter(w => all.includes(w)), keys: Object.keys(add.changes).sort(), tags: add.changes.tags };`);
      return [r.leaks.length === 0 && JSON.stringify(r.keys) === '["done","due","priority","repeat","tags"]' && r.tags === 1, r];
    });

    await kase("PRIYA-02", "tag filter logged as set/cleared only", async () => {
      await ev(`await T.reset(); await T.add("Lawyer call", { tags: "legal" }); await T.add("Gym", { tags: "health" });`);
      await tag("PRIYA-02");
      r = await ev(`await T.filter("tag-filter", "legal"); await T.filter("tag-filter", ""); await TodoLog.flush();
        const es = (await T.entries("PRIYA-02")).filter(e => e.action === "ui.filter_tag");
        return { changes: es.map(e => e.changes), leak: /legal|health/.test(JSON.stringify(es)) };`);
      return [JSON.stringify(r.changes) === '[{"tag":"set"},{"tag":"cleared"}]' && !r.leak, r];
    });

    await kase("PRIYA-03", "edit log omits title and tag text", async () => {
      const id = await ev(`await T.reset(); return await T.add("Plain task", { tags: "public" });`);
      await tag("PRIYA-03");
      r = await ev(`await T.edit(${id}, { title: "Secret plan", tags: "private" });
        const e = (await T.entries("PRIYA-03")).find(x => x.action === "task.edit"); const all = JSON.stringify(await TodoLog.all());
        return { fields: e && e.changes.fields, tags: e && e.changes.tags, leaks: ["Secret", "private"].filter(w => all.includes(w)) };`);
      return [r.fields && r.fields.includes("title") && r.fields.includes("tags") && r.tags === 1 && r.leaks.length === 0, r];
    });

    await kase("PRIYA-04", "export contains no user text", async () => {
      await ev(`await T.reset(); const id = await T.add("Divorce papers", { tags: "family, lawyer" });
        await T.edit(id, { title: "Divorce papers v2", tags: "family" }); await T.tick(id);`);
      await tag("PRIYA-04");
      r = await ev(`let blob = null; const realURL = URL.createObjectURL, realClick = HTMLAnchorElement.prototype.click;
        URL.createObjectURL = (b) => { blob = b; return realURL.call(URL, b); };
        HTMLAnchorElement.prototype.click = function () { if (!this.download) return realClick.call(this); }; // no real download
        try { document.getElementById("log-export").click(); await T.wait(300); }
        finally { URL.createObjectURL = realURL; HTMLAnchorElement.prototype.click = realClick; }
        await TodoLog.flush();
        const text = blob ? await blob.text() : ""; const lines = text.split("\\n").filter(Boolean);
        const objects = lines.every(l => { try { const o = JSON.parse(l); return o && typeof o === "object" && !Array.isArray(o); } catch { return false; } });
        return { type: blob && blob.type, lines: lines.length, objects, leaks: ["Divorce", "papers", "family", "lawyer"].filter(w => text.includes(w)),
          exportLogged: (await T.entries("PRIYA-04")).filter(e => e.action === "log.export").length };`);
      return [r.lines > 0 && r.objects && r.leaks.length === 0 && r.exportLogged === 1, r];
    });

    await kase("PRIYA-05", "clear log works and records itself", async () => {
      await ev(`await T.reset(); await T.add("Something");`);
      await tag("PRIYA-05");
      await collect(); // keep the entries the clear is about to erase
      r = await ev(`const before = (await TodoLog.all()).length; document.getElementById("log-clear").click(); await T.wait(); await TodoLog.flush();
        const after = await TodoLog.all(); return { before, after: after.map(e => e.action + "@" + e.actor) };`);
      return [r.before > 1 && JSON.stringify(r.after) === '["log.clear@user"]', r];
    });
  },
});
