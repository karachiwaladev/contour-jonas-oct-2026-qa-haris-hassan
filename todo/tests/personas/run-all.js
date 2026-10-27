#!/usr/bin/env node
// Runs the 11 automated persona suites in turn, then prints a summary table
// (persona -> pass / fail / finding / manual) and the list of findings.
// Hostile Hank's cases are run by hand by a reviewer (see test-cases.md).
//   node todo/tests/personas/run-all.js               # every persona
//   node todo/tests/personas/run-all.js --only rita   # one persona (folder name or first name)
//   node todo/tests/personas/run-all.js --quiet       # only the summary
// Exit code is non-zero only if a case FAILs; findings and manual cases don't count.

const { spawnSync } = require("child_process");
const path = require("path");

const PERSONAS = ["casual-carla", "organized-omar", "routine-rita", "procrastinating-pete", "chaotic-chris",
  "accessibility-ana", "malicious-mallory", "privacy-priya", "bot-bob", "legacy-larry", "volume-vera"];

const args = process.argv.slice(2);
const onlyAt = args.indexOf("--only");
const only = onlyAt === -1 ? null : String(args[onlyAt + 1] || "").toLowerCase();
const quiet = args.includes("--quiet");
const selected = only ? PERSONAS.filter((p) => p === only || p.split("-").includes(only)) : PERSONAS;
if (!selected.length) {
  console.error(`Unknown persona "${only}". Choose one of: ${PERSONAS.join(", ")}`);
  process.exit(2);
}

const rows = [], findings = [];
for (const name of selected) {
  const started = Date.now();
  if (!quiet) console.log(`\n=== ${name} ===`);
  const run = spawnSync(process.execPath, [path.join(__dirname, name, "run.js")], { encoding: "utf8", timeout: 900000 });
  const out = (run.stdout || "") + (run.stderr ? "\n" + run.stderr : "");
  if (!quiet) process.stdout.write(out.trimEnd() + "\n");
  const m = out.match(/Summary: (\d+) pass, (\d+) fail, (\d+) finding, (\d+) manual/);
  const counts = m ? { pass: +m[1], fail: +m[2], finding: +m[3], manual: +m[4] } : { pass: 0, fail: 1, finding: 0, manual: 0 };
  // A runner that crashed or printed no summary counts as a failure.
  if (!m || (run.status !== 0 && counts.fail === 0)) counts.fail = Math.max(counts.fail, 1);
  for (const line of out.split(/\r?\n/)) if (line.startsWith("FINDING ")) findings.push(line.slice(8));
  rows.push({ name, ...counts, secs: Math.round((Date.now() - started) / 1000), exit: run.status });
}

const pad = (s, n) => String(s).padEnd(n);
const num = (s, n) => String(s).padStart(n);
console.log("\nPersona suites");
console.log(`${pad("Persona", 22)}${num("Pass", 6)}${num("Fail", 6)}${num("Finding", 9)}${num("Manual", 8)}${num("Secs", 6)}`);
for (const r of rows) console.log(`${pad(r.name, 22)}${num(r.pass, 6)}${num(r.fail, 6)}${num(r.finding, 9)}${num(r.manual, 8)}${num(r.secs, 6)}`);
const total = (k) => rows.reduce((s, r) => s + r[k], 0);
console.log(`${pad("Total", 22)}${num(total("pass"), 6)}${num(total("fail"), 6)}${num(total("finding"), 9)}${num(total("manual"), 8)}`);
console.log("(Pass counts include each suite's EVAL check.)");

console.log(`\nFindings (${findings.length})`);
for (const f of findings) console.log(`- ${f}`);
if (!findings.length) console.log("- none");

if (!only) console.log("\nHostile Hank: 12 manual cases (see test-cases.md)");
process.exit(total("fail") ? 1 : 0);
