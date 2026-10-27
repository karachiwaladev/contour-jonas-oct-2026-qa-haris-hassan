// Shared test harness for the todo app: serves todo/ over HTTP and drives
// headless Chrome over the DevTools Protocol (navigate, evaluate, screenshot,
// console capture, init scripts). Used by tests/issue-*/run.js.
// Needs Node 18+, Python 3 and Chrome (CHROME_PATH to override).

const { spawn } = require("child_process");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");

const TODO_DIR = path.resolve(__dirname, "..", "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  const candidates = [process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p));
}

const freePort = () => new Promise((res) => {
  const s = net.createServer();
  s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); });
});

// A PASS/FAIL collector: check(id, name, cond, detail)
function createChecker() {
  const results = [];
  const check = (id, name, cond, detail = "") =>
    results.push({ id, ok: !!cond, line: `${cond ? "PASS" : "FAIL"} ${id} ${name}${!cond && detail ? " :: " + detail : ""}` });
  const report = () => {
    const order = (id) => Number((id.match(/\d+/) || [999])[0]);
    results.sort((a, b) => order(a.id) - order(b.id));
    for (const r of results) console.log(r.line);
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} passed`);
    return failed;
  };
  return { results, check, report };
}

// Start the static server and Chrome; returns a driver. Always call close().
async function startBrowser({ width = 760, height = 900, shotsDir = process.env.SCREENSHOTS } = {}) {
  const chromePath = findChrome();
  if (!chromePath) throw new Error("Chrome not found: set CHROME_PATH");
  const httpPort = await freePort(), cdpPort = await freePort();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "todo-tests-"));
  const python = process.platform === "win32" ? "python" : "python3";
  const server = spawn(python, ["-m", "http.server", String(httpPort), "--bind", "127.0.0.1", "--directory", TODO_DIR], { stdio: "ignore" });
  const chrome = spawn(chromePath, ["--headless=new", "--disable-gpu", "--enable-automation", `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${profile}`, "--no-first-run", `--window-size=${width},${height}`, "about:blank"], { stdio: "ignore" });
  const BASE = `http://127.0.0.1:${httpPort}`;
  const consoleErrors = [];
  let ws;

  const close = async () => {
    try { ws && ws.close(); } catch {}
    chrome.kill(); server.kill();
    await sleep(300);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  };

  try {
    for (let i = 0; i < 50; i++) { try { await (await fetch(BASE + "/index.html")).text(); break; } catch { await sleep(200); } }
    let targets = [];
    for (let i = 0; i < 75 && !targets.length; i++) {
      try { targets = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).filter((t) => t.type === "page"); } catch {}
      if (!targets.length) await sleep(200);
    }
    if (!targets.length) throw new Error("Chrome exposed no page target (DevTools port not reachable)");
    ws = new WebSocket(targets[0].webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error("DevTools websocket failed")); });
  } catch (e) { await close(); throw e; }

  let nextId = 1; const pending = new Map(); const waiters = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
    if (msg.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(msg.params.type))
      consoleErrors.push(msg.params.type + ": " + msg.params.args.map((a) => a.value ?? a.description).join(" "));
    if (msg.method === "Runtime.exceptionThrown") consoleErrors.push("exception: " + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text));
    if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error" && !/favicon/.test(msg.params.entry.url || "")) consoleErrors.push("log: " + msg.params.entry.text);
    for (const w of waiters.splice(0)) if (w.method === msg.method) w.resolve(); else waiters.push(w);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, (msg) => (msg.error ? reject(new Error(method + ": " + msg.error.message)) : resolve(msg.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
  const waitFor = (method) => new Promise((resolve) => waiters.push({ method, resolve }));
  await send("Page.enable"); await send("Runtime.enable"); await send("Log.enable");
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });

  const nav = async (url) => { const loaded = waitFor("Page.loadEventFired"); await send("Page.navigate", { url: BASE + url }); await loaded; await sleep(400); };
  const ev = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const shot = async (name) => {
    if (!shotsDir) return;
    fs.mkdirSync(shotsDir, { recursive: true });
    const { cssContentSize } = await send("Page.getLayoutMetrics");
    const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true,
      clip: { x: 0, y: 0, width, height: Math.ceil(Math.max(cssContentSize.height, 600)), scale: 1 } });
    fs.writeFileSync(path.join(shotsDir, name), Buffer.from(data, "base64"));
  };
  // Script that runs before any page script on every navigation until removed.
  const addInitScript = async (source) => (await send("Page.addScriptToEvaluateOnNewDocument", { source })).identifier;
  const removeInitScript = (identifier) => send("Page.removeScriptToEvaluateOnNewDocument", { identifier });

  return { BASE, send, nav, ev, shot, addInitScript, removeInitScript, consoleErrors, close };
}

// Write the app log collected during a run (a Map of entries keyed by
// sessionId:seq) to <suiteDir>/eval/run-log.jsonl, evaluate it against the
// suite's test-cases.md + expected-log.json, write eval-report.{md,json}, and
// record the result as the "EVAL" check. `specText` overrides the spec read
// from <suiteDir>/test-cases.md (e.g. one persona's rows of a shared file).
function runEval({ collected, suiteDir, suite, check, specText }) {
  try {
    const E = require(path.join(TODO_DIR, "tests", "eval", "eval-logs.js"));
    const outDir = path.join(suiteDir, "eval");
    fs.mkdirSync(outDir, { recursive: true });
    const byTime = (a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.seq - b.seq);
    const logText = [...collected.values()].sort(byTime).map((e) => JSON.stringify(e)).join("\n");
    fs.writeFileSync(path.join(outDir, "run-log.jsonl"), logText + (logText ? "\n" : ""));
    const res = E.evaluate({
      logText,
      specText: specText !== undefined ? specText : fs.readFileSync(path.join(suiteDir, "test-cases.md"), "utf8"),
      expected: JSON.parse(fs.readFileSync(path.join(suiteDir, "expected-log.json"), "utf8")),
    });
    E.writeReports(res, outDir, { suite });
    const problems = res.cases.filter((c) => !["pass", "unit", "skipped"].includes(c.status)).map((c) => {
      const list = (c.missing && c.missing.length ? c.missing : c.unexpected) || [];
      return `${c.id}:${c.status}${list.length ? "(" + list.join(",") + ")" : ""}`;
    });
    check("EVAL", "eval of this run: every e2e case executed with its expected actions", res.ok, problems.join(" "));
  } catch (e) {
    check("EVAL", "eval of this run", false, e.message);
  }
}

module.exports = { TODO_DIR, sleep, createChecker, startBrowser, runEval };
