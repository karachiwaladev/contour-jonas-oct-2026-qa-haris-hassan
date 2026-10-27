#!/usr/bin/env node
// Eval: compare an exported action log (JSONL) with a suite's test cases and
// report, per case, whether it ran and whether the actions it should produce
// appear in the log.
//
//   node todo/tests/eval/eval-logs.js --log run-log.jsonl --spec test-cases.md \
//        --expected expected-log.json [--out <dir>]
//
// - spec: the test-case table (needs "ID" and "Auto" columns). Cases with Auto
//   "unit" do nothing in the app, so they are listed as "unit", not judged.
// - expected: { "TC-03": ["task.add", ...] }   every action must appear (with
//   outcome ok) among the entries tagged TC-03. Syntax: action[:error][@actor],
//   e.g. "task.add:error" matches a failed task.add, "task.add@user" one done
//   through the page. A failed action the case doesn't expect makes it fail
//   ("unexpected-error"). []  = it only has to have run;
//   { "skip": reason }  = can't be judged from the log;
//   { "sameRunAs": "TC-08", "actions": [...] } = checked within another case's entries.
// - log: one JSON object per line; lines that aren't JSON objects with an
//   `action` are reported as malformed and otherwise ignored.
// Exit code 0 when every judged case passes, 1 otherwise. Everything read is
// treated as data: nothing in the files is executed.

const fs = require("fs");
const path = require("path");

const OK_STATUSES = new Set(["pass", "unit", "skipped"]);

function parseSpec(specText) {
  const cases = [];
  let idCol = -1, autoCol = -1;
  for (const raw of String(specText).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith("|")) continue;
    const cells = line.slice(1, line.endsWith("|") ? -1 : undefined).split("|").map((c) => c.trim());
    if (idCol === -1) {
      const id = cells.findIndex((c) => c.toLowerCase() === "id");
      const auto = cells.findIndex((c) => c.toLowerCase() === "auto");
      if (id !== -1) { idCol = id; autoCol = auto; }
      continue;
    }
    const id = cells[idCol];
    // Case ids: "TC-12" or a prefixed id such as "CARLA-01"; skips separator rows and anything else.
    if (!/^[A-Z]+-\d+$/.test(id || "")) continue;
    cases.push({ id, auto: autoCol === -1 ? "e2e" : (cells[autoCol] || "").toLowerCase() });
  }
  return cases;
}

function parseLog(logText) {
  const entries = [], malformed = [];
  String(logText).split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    let obj;
    try { obj = JSON.parse(line); } catch { malformed.push({ line: i + 1, reason: "not JSON" }); return; }
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) { malformed.push({ line: i + 1, reason: "not an object" }); return; }
    if (typeof obj.action !== "string" || !obj.action) { malformed.push({ line: i + 1, reason: "no action" }); return; }
    // Same rule as the logger: plain names only, so "@"/":" can't spoof an
    // actor- or outcome-qualified expectation.
    if (!/^[a-z][a-z0-9_.]{0,63}$/.test(obj.action)) { malformed.push({ line: i + 1, reason: "invalid action" }); return; }
    entries.push(obj);
  });
  return { entries, malformed };
}

function evaluate({ logText, specText, expected = {} }) {
  const spec = parseSpec(specText);
  const { entries, malformed } = parseLog(logText);
  // Per case, the actions seen. A failed action is recorded as "<action>:error",
  // so it never satisfies an expectation of the plain action (a failed add is
  // not an add); a case that is meant to fail expects "<action>:error".
  // Any tagged entry, failed or not, shows the case ran.
  // Each entry is recorded both as "<action>[:error]" and "<action>[:error]@<actor>",
  // so an expectation may name who did it (e.g. "task.add@user").
  const byCase = new Map();
  for (const e of entries) {
    if (typeof e.testCase !== "string") continue;
    if (!byCase.has(e.testCase)) byCase.set(e.testCase, new Set());
    const seen = byCase.get(e.testCase);
    const key = e.outcome === "error" ? `${e.action}:error` : e.action;
    seen.add(key);
    if (typeof e.actor === "string") seen.add(`${key}@${e.actor}`);
  }

  // A case passes when every expected action was seen and it had no failed
  // action it didn't expect. `ownsErrors` is false for a sameRunAs case, whose
  // run's failures belong to the case it shares the run with.
  const judge = (id, need, ownsErrors = true) => {
    const seen = byCase.get(id);
    if (!seen) return { status: "not-executed", missing: need };
    const missing = need.filter((a) => !seen.has(a));
    const allowed = new Set(need.map((a) => a.split("@")[0]));
    const unexpected = ownsErrors
      ? [...seen].filter((k) => !k.includes("@") && k.endsWith(":error") && !allowed.has(k)).sort()
      : [];
    const status = missing.length ? "incomplete" : unexpected.length ? "unexpected-error" : "pass";
    return { status, missing, unexpected, actions: [...seen].filter((k) => !k.includes("@")).sort() };
  };

  const cases = spec.map(({ id, auto }) => {
    if (auto === "unit") return { id, auto, status: "unit", note: "unit: no app actions" };
    const exp = expected[id];
    if (exp && typeof exp === "object" && !Array.isArray(exp)) {
      if (typeof exp.skip === "string") return { id, auto, status: "skipped", note: exp.skip };
      if (typeof exp.sameRunAs === "string") {
        const need = Array.isArray(exp.actions) ? exp.actions.map(String) : [];
        return { id, auto, ...judge(exp.sameRunAs, need, false), note: `checked within ${exp.sameRunAs}` };
      }
    }
    const need = Array.isArray(exp) ? exp.map(String) : [];
    return { id, auto, ...judge(id, need) };
  });

  const specIds = new Set(spec.map((c) => c.id));
  const unknown = [...byCase.keys()].filter((id) => !specIds.has(id)).sort();
  const count = (s) => cases.filter((c) => c.status === s).length;
  const summary = {
    cases: cases.length, pass: count("pass"), unit: count("unit"), skipped: count("skipped"),
    notExecuted: count("not-executed"), incomplete: count("incomplete"), unexpectedError: count("unexpected-error"),
    entries: entries.length, malformed: malformed.length, unknown: unknown.length,
  };
  return { ok: cases.every((c) => OK_STATUSES.has(c.status)), summary, cases, malformed, unknown };
}

function renderMarkdown(result, meta = {}) {
  const icon = { pass: "✅", unit: "➖", skipped: "➖", "not-executed": "❌", incomplete: "❌", "unexpected-error": "❌" };
  const s = result.summary;
  const detail = (c) => {
    if (c.missing && c.missing.length) return "missing: " + c.missing.join(", ");
    if (c.unexpected && c.unexpected.length) return "unexpected failures: " + c.unexpected.join(", ");
    return c.note || "";
  };
  const lines = [
    `# Eval report${meta.suite ? `: ${meta.suite}` : ""}`,
    "",
    `**Result: ${result.ok ? "PASS" : "FAIL"}**. ${s.pass} passed, ${s.notExecuted} not executed, ${s.incomplete} incomplete, ` +
      `${s.unexpectedError} with unexpected failures, ${s.unit} unit, ${s.skipped} skipped. ` +
      `${s.entries} log entries read, ${s.malformed} malformed, ${s.unknown} unknown case tags.`,
    meta.generatedAt ? `Generated ${meta.generatedAt}.` : "",
    "",
    "| Case | Auto | Status | Missing actions / note |",
    "|------|------|--------|------------------------|",
    ...result.cases.map((c) => `| ${c.id} | ${c.auto} | ${icon[c.status] || ""} ${c.status} | ${detail(c)} |`),
  ];
  if (result.malformed.length) lines.push("", "**Malformed log lines:** " + result.malformed.map((m) => `line ${m.line} (${m.reason})`).join("; "));
  if (result.unknown.length) lines.push("", "**Unknown case tags in the log:** " + result.unknown.join(", "));
  return lines.join("\n") + "\n";
}

function writeReports(result, outDir, meta = {}) {
  const generatedAt = new Date().toISOString();
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "eval-report.json"), JSON.stringify({ ...meta, generatedAt, ...result }, null, 2) + "\n");
  fs.writeFileSync(path.join(outDir, "eval-report.md"), renderMarkdown(result, { ...meta, generatedAt }));
}

module.exports = { parseSpec, parseLog, evaluate, renderMarkdown, writeReports };

if (require.main === module) {
  const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i === -1 ? null : process.argv[i + 1]; };
  const logPath = arg("log"), specPath = arg("spec"), expPath = arg("expected");
  if (!logPath || !specPath) {
    console.error("usage: eval-logs.js --log <file.jsonl> --spec <test-cases.md> [--expected <expected-log.json>] [--out <dir>]");
    process.exit(2);
  }
  const result = evaluate({
    logText: fs.readFileSync(logPath, "utf8"),
    specText: fs.readFileSync(specPath, "utf8"),
    expected: expPath ? JSON.parse(fs.readFileSync(expPath, "utf8")) : {},
  });
  const outDir = arg("out") || path.dirname(path.resolve(logPath));
  writeReports(result, outDir, { suite: path.basename(path.dirname(path.resolve(specPath))) });
  process.stdout.write(renderMarkdown(result));
  process.exit(result.ok ? 0 : 1);
}
