# Test cases: ticket #14, application action logs and test eval

Written from the approved plan **before** implementation.

**Status:** **Reviewed and approved by hariscontour-gif on 2026-10-26** (27 cases). TC-28–TC-32 were added after code-review round 1 and were **reviewed and approved by hariscontour-gif on 2026-10-26** (5 cases). Not executed yet.

**Terms:**

- An **entry** is one log record: `{ id, ts, sessionId, seq, actor, automated, action, taskId, changes, outcome, error?, testCase? }`.
- **user** means the action was done through the page; **api** means it was a direct `TodoDB` call.
- **Expected log** lists the actions the eval requires for that case. They are stored in `expected-log.json`, and the eval checks each case against them.
- Dates are relative to today, `T`.

| ID | Requirement | Type | Preconditions | Steps | Expected result | Expected log | Auto | Result |
|----|-------------|------|---------------|-------|-----------------|--------------|------|--------|
| TC-01 | Log a person's add | Functional | Empty app and log | Add "Milk" through the form, due `T`, tag `shop` | One `task.add` entry: actor `user`, the new taskId, `changes` = `{done:false, repeat:"none", due:T, tags:1}`, outcome `ok` | task.add | e2e | ⏳ |
| TC-02 | Log complete and reopen | Functional | One task | Tick it, then untick it | `task.complete`, then `task.reopen`, both actor `user`, same taskId | task.complete, task.reopen | e2e | ⏳ |
| TC-03 | Log recurring steps | Functional | Daily task due `T` | Tick it, then untick it | `task.complete`, then `task.spawn` (taskId = new copy, `changes.due` = `T+1`); then `task.reopen` and `task.copy_removed` | task.complete, task.spawn, task.reopen, task.copy_removed | e2e | ⏳ |
| TC-04 | Log series changes | Functional | Daily A ticked (B created) | Press Stop repeating on B; tick B; untick A | `task.stop_repeating` (B); then for A: `task.reopen` and `task.become_oneoff` | task.stop_repeating, task.become_oneoff | e2e | ⏳ |
| TC-05 | Log delete | Functional | One task | Press Delete | `task.delete`, actor `user`, that taskId | task.delete | e2e | ⏳ |
| TC-06 | Tell AI or script actions apart | Functional | — | Call `TodoDB.add` and `TodoDB.setDone` directly (as an AI agent or script would) | Those entries have actor `api`; the same actions through the page have actor `user` | task.add, task.complete | e2e | ⏳ |
| TC-07 | Flag automation | Functional | Running in automated Chrome (`navigator.webdriver` true) | Do any action | Entries have `automated: true` | task.add | e2e | ⏳ |
| TC-08 | Log UI-only actions | Functional | Tasks with tags | Click **Active**; choose a tag; click a tag chip; clear the tag filter | `ui.filter_status` (`{status:"active"}`) and `ui.filter_tag` (`{tag:"set"}` / `{tag:"cleared"}`), with **no tag text** | ui.filter_status, ui.filter_tag | e2e | ⏳ |
| TC-09 | Activity log panel | Functional | 60 entries | Open **Activity log** | Newest first; at most 50 rows; the heading shows the total; each row shows time, actor, action, task #, changes | — | e2e | ⏳ |
| TC-10 | Export JSONL | Functional | Some entries | Press **Export JSONL** | A download `todo-log-<date>.jsonl` with one valid JSON object per line, one per entry; a `log.export` entry is added | log.export | e2e | ⏳ |
| TC-11 | Clear the log | Functional | Some entries | Press **Clear log** | Only one entry is left, `log.clear` (so the clear itself is recorded) | log.clear | e2e | ⏳ |
| TC-12 | Test-case tagging | Functional | — | `TodoLog.setTestCase("TC-12")`; do an action; reload; do an action; `setTestCase(null)`; do an action | The first two entries have `testCase:"TC-12"` (it survives a reload in the same tab); the last has none | task.add | e2e | ⏳ |
| TC-13 | Log failures | Functional | `TodoDB.add` made to fail | Submit "X" | A `task.add` entry with outcome `error` and the error message; actor `user` | task.add:error | e2e | ⏳ |
| TC-14 | Size cap | Edge | — | Write 1,005 entries | Exactly 1,000 kept; the 5 oldest are dropped | — | e2e | ⏳ |
| TC-15 | Persists across reload | Edge | Some entries | Reload, then do an action | Old entries remain; the new entry has a new `sessionId` and `seq` restarts at 1 | task.add | e2e | ⏳ |
| TC-16 | Logging can't break the app | Edge | The logs database can't be opened | Add a task | The task is added and shown; no console errors; logging is skipped quietly | — | e2e | ⏳ |
| TC-17 | Empty log | Edge | Log cleared through the API (not the button) | Open the panel; export | The panel says "No activity yet"; export gives an empty file | — | e2e | ⏳ |
| TC-18 | No user text in the log | Security | — | Add "Secret <b>x</b>" with tag `private`; complete it; filter by `private` | No entry, and not the export, contains "Secret", "<b>" or "private" | task.add, task.complete | e2e | ⏳ |
| TC-19 | Panel shows entries as text | Security | A tampered stored entry with `action: "<img src=x onerror=window.pwned=1>"` | Open the panel | Shown as text; no `<img>`; `window.pwned` unset | — | e2e | ⏳ |
| TC-20 | Bad test-case tags rejected | Security | — | `setTestCase("<script>")`, `setTestCase("TC-")`, `setTestCase("tc 1")` | Each returns `false`; later entries have no `testCase` | — | e2e | ⏳ |
| TC-21 | Eval passes a complete run | Eval | A fixture log covering every end-to-end case with its expected actions | Run the eval | Every end-to-end case passes; exit 0; report written | — | unit | ⏳ |
| TC-22 | Eval catches a case that didn't run | Eval | A fixture log missing every entry for one case | Run the eval | That case is "not executed"; exit 1 | — | unit | ⏳ |
| TC-23 | Eval catches a missing step | Eval | A fixture log where one case lacks one expected action | Run the eval | That case is "incomplete: missing task.spawn"; exit 1 | — | unit | ⏳ |
| TC-24 | Eval handles a bad log | Eval | A fixture log with a non-JSON line and a line with no `action` | Run the eval | Both are reported as malformed (with line numbers); no crash; the other lines are still evaluated | — | unit | ⏳ |
| TC-25 | Eval: unit and unknown cases | Eval | A spec with unit cases; a log with an entry tagged `TC-99` (not in the spec) | Run the eval | Unit cases are listed as "unit: no app actions" (not failures); `TC-99` is flagged "unknown case" (a warning) | — | unit | ⏳ |
| TC-26 | Eval on the issue-7 suite | Regression | — | Run `node todo/tests/issue-7/run.js` | All 42 cases still pass; the eval report says every end-to-end case ran and has its expected actions | — | e2e | ⏳ |
| TC-27 | No console errors | Security / Regression | The whole issue-14 end-to-end run | Watch the console and exceptions | No unexpected errors | — | e2e | ⏳ |
| TC-28 | A failed action does not count as done (code review #1) | Eval | A fixture where a required action appears only with outcome `error` | Run the eval; then run it again expecting `task.spawn:error` | The first run says "incomplete: missing task.spawn"; the second passes. Failed actions count only when declared as `<action>:error` | — | unit | ⏳ |
| TC-29 | Scripts cannot pose as the user (code review #2) | Security | — | A script calls `TodoDB.remove(id, {actor:"user"})`; then `TodoDB.claimUserToken()` | The delete is logged as actor `api`; `claimUserToken()` returns `null` (the app already claimed it) | task.delete | e2e | ⏳ |
| TC-30 | Deleting a missing task is not logged as done (code review #3) | Regression | — | `TodoDB.remove(9999)` | No `task.delete` entry | — | e2e | ⏳ |
| TC-31 | Panel shows local time (code review #4) | Regression | An entry | Open the panel | The time column shows the entry's **local** time as `HH:MM:SS` | — | e2e | ⏳ |
| TC-32 | Survives the log database closing (code review #5) | Regression | App open | Another tab deletes `todo-logs`; then add a task through the form and open the panel | No unhandled errors; the panel renders; the new `task.add` is logged | task.add | e2e | ⏳ |

## How to run (once implemented)

```
node todo/tests/issue-14/run.js     # this suite; writes eval-report.md/.json next to it
node todo/tests/issue-7/run.js      # recurring-task suite, now tagged and evaluated too
node todo/tests/eval/eval-logs.js --log <file.jsonl> --spec <test-cases.md> --expected <expected-log.json>
```
