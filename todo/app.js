// UI for the todo app: create, complete, delete and filter tasks stored in TodoDB.

const form = document.getElementById("new-task");
const input = document.getElementById("task-title");
const dueInput = document.getElementById("task-due");
const tagsInput = document.getElementById("task-tags");
const list = document.getElementById("task-list");
const empty = document.getElementById("empty");
const count = document.getElementById("count");
const statusButtons = [...document.querySelectorAll("#status-filter button")];
const tagFilter = document.getElementById("tag-filter");

// Filters reset on reload by design (ticket #5 scope).
const filters = { status: "all", tag: "" };

// Local calendar date as "YYYY-MM-DD", comparable with stored due dates.
function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatDue(due) {
  const [y, m, d] = due.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const opts = { month: "short", day: "numeric" };
  if (y !== new Date().getFullYear()) opts.year = "numeric";
  return date.toLocaleDateString(undefined, opts);
}

function dueBadge(task) {
  if (!task.due) return null;
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
  checkbox.addEventListener("change", async () => {
    await TodoDB.setDone(task.id, checkbox.checked);
    render();
  });

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
  for (const tag of task.tags || []) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.textContent = `#${tag}`;
    chip.title = `Show only #${tag}`;
    chip.addEventListener("click", (e) => {
      e.preventDefault(); // don't toggle the checkbox through the label
      filters.tag = tag;
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
  del.addEventListener("click", async () => {
    await TodoDB.remove(task.id);
    render();
  });

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

async function render() {
  const tasks = await TodoDB.all();
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
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = input.value.trim();
  if (!title) return;
  await TodoDB.add(title, { due: dueInput.value || null, tags: tagsInput.value });
  form.reset();
  input.focus();
  render();
});

for (const b of statusButtons) {
  b.addEventListener("click", () => {
    filters.status = b.dataset.status;
    render();
  });
}

tagFilter.addEventListener("change", () => {
  filters.tag = tagFilter.value;
  render();
});

render();
