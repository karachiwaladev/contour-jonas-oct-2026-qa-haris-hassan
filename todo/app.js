// UI for the todo app: create, complete, delete and filter tasks stored in TodoDB.
// Everything lives in this closure, so the "user" token (see USER) can only be
// used by the page's own handlers; render and renderActivity are exposed at the end.
(() => { // app scope

const form = document.getElementById("new-task");
const input = document.getElementById("task-title");
const dueInput = document.getElementById("task-due");
const tagsInput = document.getElementById("task-tags");
const repeatInput = document.getElementById("task-repeat");
const priorityInput = document.getElementById("task-priority");
const priorityFilter = document.getElementById("priority-filter");
const PRIORITY_LABELS = { high: "High", medium: "Medium", low: "Low" };
const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };
const list = document.getElementById("task-list");
const empty = document.getElementById("empty");
const count = document.getElementById("count");
const statusButtons = [...document.querySelectorAll("#status-filter button")];
const tagFilter = document.getElementById("tag-filter");
const searchInput = document.getElementById("search-filter");
const dueFilter = document.getElementById("due-filter");

// Filters reset on reload by design (ticket #5 scope).
// `search` is the trimmed query ("" = none); `due` is ""|overdue|today|week|none.
const filters = { status: "all", tag: "", priority: "", due: "", search: "" };

// The open task being edited inline (at most one), or null.
let editingId = null;

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

// Search is logged only as "set" or "cleared", never the query, once typing
// pauses (SEARCH_LOG_DELAY) and only if that state changed since the last entry.
// Clearing is logged at once. A pending entry is written before any other
// entry from this page (and when the page is hidden or unloaded), so the log
// keeps the order things happened in.
const SEARCH_LOG_DELAY = 400;
let searchLogged = "";
let searchLogTimer = null;

function logSearch() {
  clearTimeout(searchLogTimer);
  searchLogTimer = null;
  if (filters.search === searchLogged) return;
  searchLogged = filters.search;
  Log.log({ action: "ui.filter_search", actor: USER, changes: { search: filters.search ? "set" : "cleared" } });
}

function flushSearchLog() {
  if (searchLogTimer !== null) logSearch();
}

// Every other entry this page logs goes through here (as the user).
function logUser(entry) {
  flushSearchLog();
  Log.log({ ...entry, actor: USER });
}

// Run a storage action from a click, then redraw from what is actually stored.
// A failure is shown on the page (e.g. "close other tabs" during an upgrade),
// so the UI never stays stuck on a stale state without explanation, and it is
// logged as `action` unless the data layer already logged it.
// Resolves true if the action succeeded.
async function act(what, fn, action, taskId = null) {
  let ok = true;
  flushSearchLog(); // the data layer logs this action; a pending search entry goes first
  try {
    await fn();
    clearError();
  } catch (err) {
    ok = false;
    showError(what, err, "action");
    if (action && !(err && err.logged)) logUser({ action, taskId, outcome: "error", error: err });
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

// The form's unsaved values, so a re-render (ticking another task, changing a
// filter) redraws the form with what the user typed rather than the stored task.
let editDraft = null;   // { id, title, due, tags, repeat, priority, error }
let focusEdit = false;  // focus the title only when the form first opens
const savingIds = new Set(); // tasks whose edit is being saved (one save per task at a time)

function startEdit(id) {
  editingId = id;
  editDraft = null;
  focusEdit = true;
  render();
}

function endEdit() {
  editingId = null;
  editDraft = null;
}

// Inline edit form for an open task: title, due, repeat, priority, tags.
// Enter saves, Escape or Cancel discards. A blank title is caught here (no
// save, nothing logged); anything the data layer rejects is shown in the form.
function editItem(task) {
  const li = document.createElement("li");
  li.className = "task editing";
  li.dataset.id = task.id;

  const form = document.createElement("form");
  form.className = "edit-form";
  form.noValidate = true;
  const field = (tag, cls, attrs = {}) => {
    const el = document.createElement(tag);
    el.className = cls;
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  };
  const select = (cls, label, options, value) => {
    const s = field("select", cls, { "aria-label": label });
    s.replaceChildren(...Object.entries(options).map(([v, t]) => new Option(t, v)));
    s.value = value;
    return s;
  };

  const draft = editDraft && editDraft.id === task.id ? editDraft : {
    id: task.id, title: task.title, due: task.due || "", tags: (task.tags || []).join(", "),
    repeat: task.repeat, priority: task.priority, error: "",
  };
  editDraft = draft;

  const repeatOptions = Object.fromEntries(Recurrence.REPEATS.map((r) => [r, Recurrence.LABELS[r] || "None"]));
  const title = field("input", "edit-title", { type: "text", maxlength: "200", "aria-label": "Title" });
  title.value = draft.title;
  const due = field("input", "edit-due", { type: "date", "aria-label": "Due date" });
  due.value = draft.due;
  const repeat = select("edit-repeat", "Repeat", repeatOptions, draft.repeat);
  const priority = select("edit-priority", "Priority", PRIORITY_LABELS, draft.priority);
  const tags = field("input", "edit-tags", { type: "text", maxlength: "200", placeholder: "work, urgent", "aria-label": "Tags, comma-separated" });
  tags.value = draft.tags;
  const error = field("p", "edit-error", { role: "alert" });
  error.textContent = draft.error;
  error.hidden = !draft.error;
  const save = field("button", "edit-save", { type: "submit" });
  save.textContent = "Save";
  const cancel = field("button", "edit-cancel secondary", { type: "button" });
  cancel.textContent = "Cancel";
  // A save can't be taken back once started, so Cancel is off until it ends.
  cancel.disabled = savingIds.has(task.id);

  // Keep the draft current as the user types or picks.
  const sync = () => Object.assign(draft, { title: title.value, due: due.value, tags: tags.value,
    repeat: repeat.value, priority: priority.value });
  form.addEventListener("input", sync);
  form.addEventListener("change", sync);
  const showFormError = (message) => {
    draft.error = message;
    error.textContent = message;
    error.hidden = false;
  };

  const close = () => {
    if (savingIds.has(task.id)) return;
    endEdit();
    render();
  };
  cancel.addEventListener("click", close);
  form.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); close(); } });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (savingIds.has(task.id)) return; // this task's save is already running
    sync();
    if (!title.value.trim()) {
      showFormError("The title can't be empty.");
      title.focus();
      return;
    }
    // A half-typed date reads as "" in the browser; don't let it clear the due date.
    if (due.validity && due.validity.badInput) {
      showFormError("Enter a complete date, or clear the field.");
      due.focus();
      return;
    }
    savingIds.add(task.id);
    cancel.disabled = true;
    flushSearchLog();
    try {
      await TodoDB.update(task.id, { title: title.value, due: due.value || null, tags: tags.value,
        repeat: repeat.value, priority: priority.value }, USER);
      if (editingId === task.id) endEdit(); // another task's form may be open by now
      clearError();
    } catch (err) {
      if (/completed or deleted/.test(err && err.message)) {
        // Nothing left to edit: close the form and say why on the page.
        if (editingId === task.id) endEdit();
        showError("save the edit", err, "action");
      } else {
        showFormError(`Couldn't save: ${err && err.message ? err.message : err}`);
      }
    } finally {
      savingIds.delete(task.id);
      cancel.disabled = false;
    }
    await render();
  });

  const row = document.createElement("div");
  row.className = "edit-fields";
  row.append(due, repeat, priority, tags);
  const actions = document.createElement("div");
  actions.className = "edit-actions";
  actions.append(save, cancel);
  form.append(title, row, error, actions);
  li.append(form);
  if (focusEdit) {
    focusEdit = false;
    setTimeout(() => title.focus(), 0);
  }
  return li;
}

function taskItem(task) {
  if (!task.done && task.id === editingId) return editItem(task);
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
  const prio = document.createElement("span");
  prio.className = `priority ${task.priority}`;
  prio.textContent = PRIORITY_LABELS[task.priority]; // TodoDB.clean() guarantees high|medium|low
  meta.append(prio);
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
      logUser({ action: "ui.filter_tag", changes: { tag: "set" } }); // never the tag text
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
  if (task.done) {
    li.append(label, del); // completed tasks aren't editable
  } else {
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "edit secondary";
    edit.textContent = "Edit";
    edit.setAttribute("aria-label", `Edit "${task.title}"`);
    edit.addEventListener("click", () => startEdit(task.id)); // one edit at a time
    const actions = document.createElement("div");
    actions.className = "task-actions";
    actions.append(edit, del);
    li.append(label, actions);
  }
  return li;
}

// Open tasks: High, Medium, Low; then soonest due first, undated last; then
// newest. Completed: newest first.
function compareTasks(a, b) {
  if (a.done !== b.done) return a.done - b.done;
  if (!a.done) {
    const pa = PRIORITY_RANK[a.priority];
    const pb = PRIORITY_RANK[b.priority];
    if (pa !== pb) return pa - pb;
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

// Due filter. Overdue follows the red badge: open tasks due before today.
// "week" is today through today + 6 (ctx.weekEnd).
function matchesDue(task, ctx) {
  if (!filters.due) return true;
  const dated = Recurrence.isValidDate(task.due);
  if (filters.due === "none") return !dated;
  if (!dated) return false;
  if (filters.due === "overdue") return !task.done && task.due < ctx.today;
  if (filters.due === "today") return task.due === ctx.today;
  if (filters.due === "week") return task.due >= ctx.today && task.due <= ctx.weekEnd;
  return true;
}

// The query as the filter uses it: trimmed; "#" plus the tag text for a
// tags-only search ("# work" -> "#work"); "" (no search) if nothing is left.
function effectiveQuery(raw) {
  const q = String(raw).trim();
  if (!q.startsWith("#")) return q;
  const rest = q.slice(1).trim();
  return rest ? `#${rest}` : "";
}

// Search: a case-insensitive substring of the title or any tag; a leading "#"
// searches tag names only. Plain string matching, never a RegExp from user
// text, and toLowerCase() like TodoDB.normalizeTags, so the browser's locale
// doesn't change what matches.
function searchNeedle() {
  const q = filters.search;
  if (!q) return null;
  const tagsOnly = q.startsWith("#");
  return { tagsOnly, text: (tagsOnly ? q.slice(1) : q).toLowerCase() };
}

function matchesSearch(task, needle) {
  if (!needle) return true;
  const inTags = (task.tags || []).some((t) => String(t).toLowerCase().includes(needle.text));
  if (needle.tagsOnly) return inTags;
  return inTags || String(task.title).toLowerCase().includes(needle.text);
}

function matches(task, ctx) {
  if (filters.status === "active" && task.done) return false;
  if (filters.status === "completed" && !task.done) return false;
  if (filters.tag && !(task.tags || []).includes(filters.tag)) return false;
  if (filters.priority && task.priority !== filters.priority) return false;
  if (!matchesDue(task, ctx)) return false;
  return matchesSearch(task, ctx.needle);
}

// Each render reads asynchronously; only the newest one may draw, so a slow,
// older read can never overwrite a newer list.
let renderSeq = 0;
let loading = 0;       // reads in flight
let lastTasks = null;  // the last list read from storage

// Redraw. By default re-reads storage; { reload: false } (search and Due
// changes) re-filters the last list read instead. While a read is in flight
// that is a no-op: the read draws with the current filters when it lands.
async function render({ reload = true } = {}) {
  if (!reload && lastTasks) {
    if (!loading) draw(lastTasks);
    return;
  }
  const seq = ++renderSeq;
  let tasks;
  loading++;
  try {
    tasks = await TodoDB.all();
  } catch (err) {
    if (seq === renderSeq) showError("load your tasks", err, "load");
    return;
  } finally {
    loading--;
  }
  if (seq !== renderSeq) return;
  lastTasks = tasks;
  clearError("load");
  draw(tasks);
}

function draw(tasks) {
  renderTagOptions(tasks);
  for (const b of statusButtons) b.setAttribute("aria-pressed", String(b.dataset.status === filters.status));

  const t = today();
  const ctx = { today: t, weekEnd: Recurrence.addDays(t, 6), needle: searchNeedle() };
  const shown = tasks.filter((t) => matches(t, ctx)).sort(compareTasks);
  list.replaceChildren(...shown.map(taskItem));

  const filtered = filters.status !== "all" || filters.tag !== "" || filters.priority !== "" ||
    filters.due !== "" || filters.search !== "";
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
    flushSearchLog(); // so the export includes it
    const text = await Log.exportJSONL();
    const url = URL.createObjectURL(new Blob([text ? text + "\n" : ""], { type: "application/x-ndjson" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `todo-log-${today()}.jsonl`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    logUser({ action: "log.export", changes: { entries: text ? text.split("\n").length : 0 } });
  } catch (err) {
    showError("export the activity log", err, "action");
  }
  renderActivity();
});

document.getElementById("log-clear").addEventListener("click", async () => {
  flushSearchLog();
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
  const submitted = { title: input.value, due: dueInput.value, tags: tagsInput.value, repeat: repeatInput.value,
    priority: priorityInput.value };
  adding = true;
  form.reset();
  input.focus();
  const ok = await act("add the task", () =>
    TodoDB.add(title, { due: submitted.due || null, tags: submitted.tags, repeat: submitted.repeat,
      priority: submitted.priority }, USER),
    "task.add"
  );
  adding = false;
  if (!ok && !input.value) {
    input.value = submitted.title;
    dueInput.value = submitted.due;
    tagsInput.value = submitted.tags;
    repeatInput.value = submitted.repeat;
    priorityInput.value = submitted.priority;
  }
});

priorityFilter.addEventListener("change", () => {
  filters.priority = priorityFilter.value;
  logUser({ action: "ui.filter_priority", changes: { priority: filters.priority || "all" } });
  render();
});

for (const b of statusButtons) {
  b.addEventListener("click", () => {
    filters.status = b.dataset.status;
    logUser({ action: "ui.filter_status", changes: { status: filters.status } });
    render();
  });
}

tagFilter.addEventListener("change", () => {
  filters.tag = tagFilter.value;
  // Which tag is user text, so only whether a tag filter is on is logged.
  logUser({ action: "ui.filter_tag", changes: { tag: filters.tag ? "set" : "cleared" } });
  render();
});

dueFilter.addEventListener("change", () => {
  filters.due = dueFilter.value;
  logUser({ action: "ui.filter_due", changes: { due: filters.due || "all" } });
  render({ reload: false });
});

// Search filters as you type (see logSearch for how it is logged). Clearing,
// however it happens (Escape, the box's clear button, deleting the text),
// logs at once.
function onSearchChange() {
  const q = effectiveQuery(searchInput.value);
  if (q !== filters.search) {
    filters.search = q;
    render({ reload: false });
  }
  clearTimeout(searchLogTimer);
  searchLogTimer = null;
  if (q) searchLogTimer = setTimeout(logSearch, SEARCH_LOG_DELAY);
  else logSearch();
}

searchInput.addEventListener("input", onSearchChange);
searchInput.addEventListener("search", onSearchChange); // the native clear button (and Enter)

searchInput.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || !searchInput.value) return;
  e.preventDefault();
  searchInput.value = "";
  onSearchChange();
});

// Don't lose a pending search entry when the page goes away.
window.addEventListener("pagehide", flushSearchLog);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushSearchLog(); });

// Filters reset on reload: don't let the browser restore old control values.
searchInput.value = "";
dueFilter.value = "";
priorityFilter.value = "";

render();

// Exposed for tests and tooling (they redraw after changing data directly).
window.render = render;
window.renderActivity = renderActivity;
})();
