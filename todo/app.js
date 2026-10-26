// UI for the todo app: create, complete, delete and filter tasks stored in TodoDB.
// Everything lives in this closure, so the "user" token (see USER) can only be
// used by the page's own handlers; render and renderActivity are exposed at the end.
(() => { // app scope

const form = document.getElementById("new-task");
const input = document.getElementById("task-title");
const dueInput = document.getElementById("task-due");
const tagsInput = document.getElementById("task-tags");
const repeatInput = document.getElementById("task-repeat");
const list = document.getElementById("task-list");
const empty = document.getElementById("empty");
const count = document.getElementById("count");
const statusButtons = [...document.querySelectorAll("#status-filter button")];
const tagFilter = document.getElementById("tag-filter");

// Filters reset on reload by design (ticket #5 scope).
const filters = { status: "all", tag: "" };

// Local calendar date as "YYYY-MM-DD", comparable with stored due dates.
const today = Recurrence.today;

const errorBox = document.getElementById("error");

// Tell the user (role=alert) and log the details. `source` is "action" or
// "load", so a successful load clears only a load error, not an action's.
function showError(what, err, source) {
  const message = `Couldn't ${what}. ${err && err.message ? err.message : ""}`.trim();
  console.error(message, err);
  errorBox.textContent = message;
  errorBox.dataset.source = source;
  errorBox.hidden = false;
}

function clearError(source) {
  if (!source || errorBox.dataset.source === source) errorBox.hidden = true;
}

// The action log is best-effort: if logger.js didn't load, use a no-op stand-in
// so the app itself keeps working.
const Log = typeof TodoLog !== "undefined" ? TodoLog : {
  log() {}, claimUserToken: () => null, recent: async () => [], count: async () => 0,
  exportJSONL: async () => "", clear: async () => {}, flush: async () => {},
};

// Everything done through the page is logged as the user's action. The token
// is claimed once and lives only in this closure, so scripts calling TodoDB
// directly can't pass it (they are logged as "api").
const USER = Log.claimUserToken();

// Run a storage action from a click, then redraw from what is actually stored.
// A failure is shown on the page (e.g. "close other tabs" during an upgrade),
// so the UI never stays stuck on a stale state without explanation, and it is
// logged as `action` unless the data layer already logged it.
// Resolves true if the action succeeded.
async function act(what, fn, action, taskId = null) {
  let ok = true;
  try {
    await fn();
    clearError();
  } catch (err) {
    ok = false;
    showError(what, err, "action");
    if (action && !(err && err.logged)) Log.log({ action, actor: USER, taskId, outcome: "error", error: err });
  }
  await render();
  return ok;
}

function formatDue(due) {
  const [y, m, d] = due.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const opts = { month: "short", day: "numeric" };
  if (y !== new Date().getFullYear()) opts.year = "numeric";
  return date.toLocaleDateString(undefined, opts);
}

function dueBadge(task) {
  if (!Recurrence.isValidDate(task.due)) return null;
  const badge = document.createElement("span");
  badge.className = "due";
  const t = today();
  if (!task.done && task.due < t) {
    badge.classList.add("overdue");
    badge.textContent = `Overdue · ${formatDue(task.due)}`;
  } else if (!task.done && task.due === t) {
    badge.classList.add("today");
    badge.textContent = "Due today";
  } else {
    badge.textContent = `Due ${formatDue(task.due)}`;
  }
  return badge;
}

function taskItem(task) {
  const li = document.createElement("li");
  li.className = task.done ? "task done" : "task";
  li.dataset.id = task.id;

  const label = document.createElement("label");
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = task.done;
  checkbox.setAttribute("aria-label", `Mark "${task.title}" as done`);
  checkbox.addEventListener("change", () =>
    act("update the task", () => TodoDB.setDone(task.id, checkbox.checked, USER),
      checkbox.checked ? "task.complete" : "task.reopen", task.id)
  );

  const body = document.createElement("div");
  body.className = "body";
  const title = document.createElement("span");
  title.className = "title";
  title.textContent = task.title; // textContent, never innerHTML: titles are user input
  body.append(title);

  const meta = document.createElement("div");
  meta.className = "meta";
  const badge = dueBadge(task);
  if (badge) meta.append(badge);
  // Only the open head of a series repeats: a completed occurrence, or a
  // reopened one whose next copy already exists or was ended, shows no 🔁.
  const repeatLabel = Recurrence.LABELS[task.repeat]; // undefined unless an allowlisted repeat
  if (repeatLabel && !task.done && task.nextId == null) {
    const rep = document.createElement("span");
    rep.className = "repeat";
    rep.textContent = `🔁 ${repeatLabel}`;
    const stop = document.createElement("button");
    stop.type = "button";
    stop.className = "stop-repeat";
    stop.textContent = "Stop repeating";
    stop.setAttribute("aria-label", `Stop repeating "${task.title}"`);
    stop.addEventListener("click", (e) => {
      e.preventDefault(); // don't toggle the checkbox through the label
      act("stop repeating", () => TodoDB.stopRepeating(task.id, USER), "task.stop_repeating", task.id);
    });
    meta.append(rep, stop);
  }
  for (const tag of task.tags || []) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.textContent = `#${tag}`;
    chip.title = `Show only #${tag}`;
    chip.addEventListener("click", (e) => {
      e.preventDefault(); // don't toggle the checkbox through the label
      filters.tag = tag;
      Log.log({ action: "ui.filter_tag", actor: USER, changes: { tag: "set" } }); // never the tag text
      render();
    });
    meta.append(chip);
  }
  if (meta.childElementCount) body.append(meta);

  const del = document.createElement("button");
  del.type = "button";
  del.className = "delete";
  del.textContent = "Delete";
  del.setAttribute("aria-label", `Delete "${task.title}"`);
  del.addEventListener("click", () => act("delete the task", () => TodoDB.remove(task.id, USER), "task.delete", task.id));

  label.append(checkbox, body);
  li.append(label, del);
  return li;
}

// Open tasks: soonest due first, undated last, then newest. Completed: newest first.
function compareTasks(a, b) {
  if (a.done !== b.done) return a.done - b.done;
  if (!a.done) {
    const ad = a.due || "9999-12-31";
    const bd = b.due || "9999-12-31";
    if (ad !== bd) return ad < bd ? -1 : 1;
  }
  return b.createdAt - a.createdAt;
}

function renderTagOptions(tasks) {
  const counts = new Map();
  for (const t of tasks) for (const tag of t.tags || []) counts.set(tag, (counts.get(tag) || 0) + 1);
  if (filters.tag && !counts.has(filters.tag)) filters.tag = ""; // tag no longer exists

  const options = [new Option(`All tags`, "")];
  for (const tag of [...counts.keys()].sort()) {
    options.push(new Option(`#${tag} (${counts.get(tag)})`, tag)); // Option() sets text, not HTML
  }
  tagFilter.replaceChildren(...options);
  tagFilter.value = filters.tag;
  tagFilter.disabled = counts.size === 0;
}

function matches(task) {
  if (filters.status === "active" && task.done) return false;
  if (filters.status === "completed" && !task.done) return false;
  if (filters.tag && !(task.tags || []).includes(filters.tag)) return false;
  return true;
}

// Each render reads asynchronously; only the newest one may draw, so a slow,
// older read can never overwrite a newer list.
let renderSeq = 0;

async function render() {
  const seq = ++renderSeq;
  let tasks;
  try {
    tasks = await TodoDB.all();
  } catch (err) {
    if (seq === renderSeq) showError("load your tasks", err, "load");
    return;
  }
  if (seq !== renderSeq) return;
  clearError("load");
  renderTagOptions(tasks);
  for (const b of statusButtons) b.setAttribute("aria-pressed", String(b.dataset.status === filters.status));

  const shown = tasks.filter(matches).sort(compareTasks);
  list.replaceChildren(...shown.map(taskItem));

  const filtered = filters.status !== "all" || filters.tag !== "";
  empty.hidden = shown.length > 0;
  empty.textContent = tasks.length === 0 ? "No tasks yet. Add one above." : "No tasks match this filter.";

  const open = tasks.filter((t) => !t.done).length;
  count.textContent = tasks.length
    ? `${open} of ${tasks.length} left` + (filtered ? ` · showing ${shown.length}` : "")
    : "";
  if (activity.open) renderActivity();
}

// ---- Activity log panel ------------------------------------------------------

const activity = document.getElementById("activity");
const activitySummary = document.getElementById("activity-summary");
const activityList = document.getElementById("activity-list");
const activityEmpty = document.getElementById("activity-empty");
const ACTIVITY_ROWS = 50;
let activitySeq = 0;

function activityRow(entry) {
  const li = document.createElement("li");
  li.dataset.id = entry.id;
  if (entry.outcome === "error") li.className = "error-row";
  const cell = (col, value) => {
    const span = document.createElement("span");
    span.dataset.col = col;
    span.textContent = value; // entries are untrusted storage: text only
    return span;
  };
  const when = new Date(entry.ts);
  const pad = (n) => String(n).padStart(2, "0");
  const time = Number.isNaN(when.getTime()) ? "" // local time, like the rest of the app
    : `${pad(when.getHours())}:${pad(when.getMinutes())}:${pad(when.getSeconds())}`;
  const who = `${entry.actor === "user" ? "user" : "api"}${entry.automated === true ? " 🤖" : ""}`;
  let changes = "";
  try { changes = entry.changes && Object.keys(entry.changes).length ? JSON.stringify(entry.changes) : ""; } catch {}
  li.append(
    cell("time", time),
    cell("actor", who),
    cell("action", String(entry.action ?? "")),
    cell("task", entry.taskId != null ? `#${entry.taskId}` : ""),
    cell("changes", entry.outcome === "error" ? `error: ${String(entry.error ?? "")}` : changes),
  );
  return li;
}

// Newest first, at most ACTIVITY_ROWS rows; the heading shows the total.
// Reads only those rows and a count, not the whole log. Never throws: the
// log is best-effort, so if it can't be read the panel just stays as it was.
async function renderActivity() {
  const seq = ++activitySeq;
  let rows, total;
  try {
    [rows, total] = await Promise.all([Log.recent(ACTIVITY_ROWS), Log.count()]);
  } catch {
    return;
  }
  if (seq !== activitySeq) return;
  activitySummary.textContent = `Activity log (${total})`;
  activityEmpty.hidden = total > 0;
  activityList.replaceChildren(...rows.map(activityRow));
}

activity.addEventListener("toggle", () => { if (activity.open) renderActivity(); });

document.getElementById("log-export").addEventListener("click", async () => {
  try {
    const text = await Log.exportJSONL();
    const url = URL.createObjectURL(new Blob([text ? text + "\n" : ""], { type: "application/x-ndjson" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `todo-log-${today()}.jsonl`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    Log.log({ action: "log.export", actor: USER, changes: { entries: text ? text.split("\n").length : 0 } });
  } catch (err) {
    showError("export the activity log", err, "action");
  }
  renderActivity();
});

document.getElementById("log-clear").addEventListener("click", async () => {
  await Log.clear({ actor: USER });
  renderActivity();
});

// One add at a time: a fast double submit can't add the task twice. The form
// is cleared at once, so anything typed while the save runs is kept; if the
// save fails, what was submitted comes back (unless the user already typed more).
let adding = false;

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = input.value.trim();
  if (adding || !title) return;
  const submitted = { title: input.value, due: dueInput.value, tags: tagsInput.value, repeat: repeatInput.value };
  adding = true;
  form.reset();
  input.focus();
  const ok = await act("add the task", () =>
    TodoDB.add(title, { due: submitted.due || null, tags: submitted.tags, repeat: submitted.repeat }, USER),
    "task.add"
  );
  adding = false;
  if (!ok && !input.value) {
    input.value = submitted.title;
    dueInput.value = submitted.due;
    tagsInput.value = submitted.tags;
    repeatInput.value = submitted.repeat;
  }
});

for (const b of statusButtons) {
  b.addEventListener("click", () => {
    filters.status = b.dataset.status;
    Log.log({ action: "ui.filter_status", actor: USER, changes: { status: filters.status } });
    render();
  });
}

tagFilter.addEventListener("change", () => {
  filters.tag = tagFilter.value;
  // Which tag is user text, so only whether a tag filter is on is logged.
  Log.log({ action: "ui.filter_tag", actor: USER, changes: { tag: filters.tag ? "set" : "cleared" } });
  render();
});

render();

// Exposed for tests and tooling (they redraw after changing data directly).
window.render = render;
window.renderActivity = renderActivity;
})();
