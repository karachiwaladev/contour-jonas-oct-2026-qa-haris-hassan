// UI for the todo app: create, complete and delete tasks stored in TodoDB.

const form = document.getElementById("new-task");
const input = document.getElementById("task-title");
const list = document.getElementById("task-list");
const empty = document.getElementById("empty");
const count = document.getElementById("count");

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

  const title = document.createElement("span");
  title.className = "title";
  title.textContent = task.title; // textContent, never innerHTML: titles are user input

  const del = document.createElement("button");
  del.type = "button";
  del.className = "delete";
  del.textContent = "Delete";
  del.setAttribute("aria-label", `Delete "${task.title}"`);
  del.addEventListener("click", async () => {
    await TodoDB.remove(task.id);
    render();
  });

  label.append(checkbox, title);
  li.append(label, del);
  return li;
}

async function render() {
  const tasks = await TodoDB.all();
  // Open tasks first, then completed; newest first within each group.
  tasks.sort((a, b) => a.done - b.done || b.createdAt - a.createdAt);
  list.replaceChildren(...tasks.map(taskItem));

  const open = tasks.filter((t) => !t.done).length;
  empty.hidden = tasks.length > 0;
  count.textContent = tasks.length ? `${open} of ${tasks.length} left` : "";
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = input.value.trim();
  if (!title) return;
  await TodoDB.add(title);
  input.value = "";
  input.focus();
  render();
});

render();
