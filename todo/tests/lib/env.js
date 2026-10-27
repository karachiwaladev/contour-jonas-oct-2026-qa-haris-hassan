// Loads end-to-end test settings from the repo's local .env file (git-ignored).
// Test runners read secrets here, inside Node: Claude's guardrails block reading
// .env through its own tools on purpose. Never print, log or commit the values.

const fs = require("fs");
const path = require("path");

const ENV_FILE = path.resolve(__dirname, "..", "..", "..", ".env");

function loadEnv() {
  if (fs.existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);
}

// Jev settings, or null when the key isn't set (callers skip their Jev cases).
function jevConfig() {
  loadEnv();
  const apiKey = process.env.JEV_API_KEY;
  const baseUrl = process.env.JEV_BASE_URL;
  if (!apiKey || apiKey === "replace-me" || !baseUrl) return null;
  return { apiKey, baseUrl: baseUrl.replace(/\/+$/, "") };
}

module.exports = { loadEnv, jevConfig };
