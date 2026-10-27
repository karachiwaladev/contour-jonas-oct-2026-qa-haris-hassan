#!/usr/bin/env node
// Stop hook: append the user prompts added to the session transcript since the
// last stop to .claude/logs/prompts.jsonl (one JSON object per line).
// A per-session byte offset in .claude/logs/.prompt-log-state.json makes each
// prompt get logged exactly once.

const fs = require("fs");
const path = require("path");

const projectDir = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", "..");
const logDir = path.join(projectDir, ".claude", "logs");
const logFile = path.join(logDir, "prompts.jsonl");
const stateFile = path.join(logDir, ".prompt-log-state.json");

// Context the harness injects next to the user's own words.
const NOISE = /<(ide_opened_file|ide_selection|system-reminder)>[\s\S]*?<\/\1>/g;

// The log is committed and pushed, so mask anything that looks like a credential
// before it is written: known key shapes, and any value labelled as a key/token/secret.
const SECRETS = [
  /\b(?:api[_-]?key|apikey|sk|pk|rk)[_-][A-Za-z0-9_-]{16,}/gi,
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|xox[abpr]-[A-Za-z0-9-]{10,})\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /\b[A-Za-z0-9]{6,}_[A-Za-z0-9]{12,}_[A-Za-z0-9]{12,}\b/g,
];
const LABELLED = /((?:api[ _-]?key|token|secret|password|passwd|bearer)\b[^:=\n]{0,30}[:=]\s*)\S+/gi;

function redact(text) {
  for (const re of SECRETS) text = text.replace(re, "[REDACTED]");
  return text.replace(LABELLED, "$1[REDACTED]");
}

function readStdin() {
  try { return JSON.parse(fs.readFileSync(0, "utf8") || "{}"); } catch { return {}; }
}

function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  if (content.some((b) => b.type === "tool_result")) return "";
  return content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
}

function clean(text) {
  text = redact(text.replace(NOISE, "").trim());
  // Slash commands are stored as tags; log them as typed: "/loop 5m ...".
  const name = text.match(/<command-name>([\s\S]*?)<\/command-name>/);
  if (name) {
    const args = text.match(/<command-args>([\s\S]*?)<\/command-args>/);
    return [name[1].trim(), args ? args[1].trim() : ""].filter(Boolean).join(" ");
  }
  return text;
}

function promptFrom(entry) {
  if (entry.type === "user" && !entry.isMeta && entry.message) {
    const text = clean(textOf(entry.message.content));
    if (!text || text.startsWith("<task-notification>")) return null;
    return { source: "prompt", text };
  }
  const a = entry.attachment;
  if (a && a.type === "queued_command" && (!a.origin || a.origin.kind === "human")) {
    const text = clean(textOf(a.prompt));
    return text ? { source: "mid_turn", text } : null;
  }
  return null;
}

function main() {
  const input = readStdin();
  const transcript = input.transcript_path;
  const sessionId = input.session_id || "unknown";
  if (!transcript || !fs.existsSync(transcript)) return;

  fs.mkdirSync(logDir, { recursive: true });
  let state = {};
  try { state = JSON.parse(fs.readFileSync(stateFile, "utf8")); } catch {}

  const buf = fs.readFileSync(transcript);
  let offset = state[sessionId] || 0;
  if (offset > buf.length) offset = 0; // the transcript was replaced: start over

  // Process complete lines only; a partly written last line waits for the next stop.
  const end = buf.lastIndexOf(0x0a) + 1;
  if (end <= offset) return;

  const out = [];
  for (const line of buf.subarray(offset, end).toString("utf8").split("\n")) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    const p = promptFrom(entry);
    if (p) {
      out.push(JSON.stringify({
        timestamp: entry.timestamp || new Date().toISOString(),
        session_id: sessionId,
        uuid: entry.uuid || null,
        source: p.source,
        prompt: p.text,
      }));
    }
  }

  // Save the offset only when something was logged. Stops with no new prompt
  // (such as cron-fired loop passes) then leave both files untouched, so the
  // auto-commit hook has nothing to commit. Re-scanning from the old offset is cheap.
  if (!out.length) return;
  fs.appendFileSync(logFile, out.join("\n") + "\n");
  state[sessionId] = end;
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

main();
