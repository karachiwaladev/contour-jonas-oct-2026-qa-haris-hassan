# Build flow: clarify → plan → approve → build → verify → ship

Use this for tickets that build a project or a feature someone will run and click. Run steps 2 and 3 with the AskUserQuestion tool. While a question is open the turn stays busy, so cron passes can't fire in the middle of it.

## 1. Claim the ticket

```
gh label create "factory:in-progress" --color FBCA04 --description "Factory loop is working on this" 2>/dev/null
gh issue edit <n> --add-label "factory:in-progress"
```

(`gh label create` fails harmlessly if the label already exists.)

## 2. Clarify

Read the ticket, the target project's `CLAUDE.md` and its code first. Then list the assumptions you would otherwise have to guess. Ask only about the ones where a wrong guess means rework, for example:

- Data shape: are tags free text or a fixed list? Is a due date a date only, or a date and time?
- Behaviour: does a filter combine with other filters (AND or OR)? Does a filter persist across reloads? How should overdue tasks look?
- Scope: are editing existing tasks, sorting, or search in or out?

Ask 1–4 questions in a single AskUserQuestion call. Each question gets 2–4 concrete options with the recommended one first. Don't ask about things the ticket or codebase already answer; state those as assumptions in the plan instead.

## 3. Plan and get approval

Present a plan of roughly 15–30 lines:

- **Scope:** what will and won't be built, mapped to each sentence of the ticket.
- **Data:** schema changes, and how existing stored data is migrated (never dropped).
- **UI:** the controls being added or changed, and where they go.
- **Files:** each file created or edited.
- **Verification checklist:** numbered browser checks, one or more per requirement, plus "no console errors" and "data survives a reload".

Then call AskUserQuestion with these options: "Approve and build", "Change something", "Cancel". On a change request, revise the plan and ask again. On cancel, remove the label, tell the user, and leave the ticket open.

## 4. Build

- Start the ticket branch only now, after approval: `ticket/<issue>-<slug>` from an up-to-date `main` (see *Branch and PR* in SKILL.md). Every file change for this ticket goes on that branch.
- Follow the project's existing structure, style and `CLAUDE.md` conventions.
- Render user input with `textContent`, never `innerHTML`.
- Update the project's `CLAUDE.md`, including its manual test checklist, and the root `CLAUDE.md` index if anything there changes.

## 5. Verify in the browser (chrome-devtools)

Serve the project over HTTP rather than `file://`, so storage and paths behave like a real site:

```
python -m http.server 8765 --directory <project-folder>   # run in the background
```

Use the **chrome-devtools MCP tools** (`mcp__chrome-devtools__*`; load them with ToolSearch if they're deferred):

1. `new_page` / `navigate_page` → `http://localhost:8765/`
2. `take_snapshot` to get element uids, then `fill`, `click` and `press_key` to drive each checklist item. Clear old state first, for example by running `indexedDB.deleteDatabase(...)` through `evaluate_script` and then reloading.
3. Check results with `take_snapshot` or `evaluate_script`, which can read the DOM and the stored data.
4. `list_console_messages`: there must be no errors.
5. `take_screenshot` with `filePath` set to `<project>/screenshots/issue-<n>/NN-<what>.png`. Take one screenshot per key state, such as the initial view, each feature in use, and after a reload.
6. Stop the HTTP server when you're done.

If any check fails, fix it and re-verify. Don't ship a failing checklist.

**Fallback if the chrome-devtools MCP isn't connected:** use headless Chrome directly.

- Run checks with a driver script that `console.log`s `PASS`/`FAIL` lines, launched with `chrome --headless=new --enable-logging=stderr --v=0 <url>` and read from stderr. `--dump-dom` returns before async IndexedDB work finishes.
- Take screenshots with `chrome --headless=new --screenshot=<file> --window-size=1000,800 <url>`.

Say in the ticket comment that the fallback was used.

## 6. Open the PR for manual review

1. Commit the code and `screenshots/issue-<n>/` together on the ticket branch, then run `git push -u origin <branch>`.
2. Open the PR into `main` (see *Branch and PR* in SKILL.md). The body has:
   - `Closes #<n>`, and a summary.
   - Requirement → how it was met.
   - The verification checklist with ✅ results.
   - The screenshots, embedded with a URL pinned to the branch commit that renders for a private repo. The commit stays reachable after a merge commit:
     `![Initial view](https://github.com/{owner}/{repo}/blob/<sha>/<project>/screenshots/issue-<n>/01-initial.png?raw=true)`
   - The **How to approve** line.
3. Swap the label: `gh issue edit <n> --add-label "factory:awaiting-review" --remove-label "factory:in-progress"`.
4. Comment on the ticket with "PR #<pr> is ready for review", the link, and a one-line summary.
5. Run `git checkout main`. **Stop here.** Don't merge or close anything. Approval, merging and closing follow `review-flow.md`, on a later pass or when the user approves in the session.
