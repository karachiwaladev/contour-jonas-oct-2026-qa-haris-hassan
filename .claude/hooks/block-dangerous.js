#!/usr/bin/env node
// PreToolUse hook: blocks the commands also listed in permissions.deny
// (.claude/settings.json), as a second layer that catches variants the
// prefix rules miss: recursive force deletes, force pushes, piping a
// download into a shell, and reading .env files.
// Reads the tool call JSON on stdin; prints a deny decision or nothing.

const RULES = [
  { re: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r|-r\s+-f|-f\s+-r|--recursive\s+--force|--force\s+--recursive)\b/, why: "recursive force delete (rm -rf)" },
  { re: /\bgit\s+push\b[^\n;&|]*(\s--force(-with-lease)?\b|\s-f\b|\s\+\S)/, why: "force push (git push --force)" },
  { re: /\b(curl|wget|iwr|Invoke-WebRequest)\b[^\n;&]*\|\s*(sudo\s+)?(sh|bash|zsh|pwsh|powershell|iex|Invoke-Expression)\b/i, why: "piping a download into a shell (curl | sh)" },
  { re: /(^|[\s"'\/\\=])\.env(\.[\w.-]+)?($|[\s"';|&)])/, why: "reading a .env file" },
];

const isEnvPath = (p) => /(^|[\/\\])\.env(\.[\w.-]+)?$/.test(String(p || ""));

function check(call) {
  const tool = call.tool_name || "";
  const input = call.tool_input || {};
  if (tool === "Bash" || tool === "PowerShell") {
    const cmd = String(input.command || "");
    for (const r of RULES) if (r.re.test(cmd)) return r.why;
  }
  if (tool === "Read" && isEnvPath(input.file_path)) return "reading a .env file";
  return null;
}

let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  let call;
  try { call = JSON.parse(raw); } catch { return; }
  const why = check(call);
  if (!why) return;
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: `Blocked by the factory guardrail: ${why}. See .claude/settings.json.`,
    },
  }));
});

module.exports = { check };
