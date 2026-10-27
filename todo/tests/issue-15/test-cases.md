# Test cases: ticket #6, task priority (issue #15)

Written from the approved plan **before** implementation. This builds on #16 (the action log), so each end-to-end case is tagged in the log and checked by the eval. **Expected log** uses the eval syntax `action[:error][@actor]`; `expected-log.json` holds the same expectations for the eval.

**Status:** Executed 2026-10-27 on `8c4b78e` (branch `ticket/15-task-priority`): **35/35 cases passed** (36/36 checks including the eval of the run). TC-24 ran the issue-14 suite (41/41, which runs issue-7 44/44), with every eval passing. TC-01–TC-25 were written from the approved plan; TC-26–TC-35 were added as regression cases over two code-review rounds, and each batch was **reviewed and approved by hariscontour-gif** before it was implemented. TC-27's expected result was later aligned with TC-33, also approved. A claude-security scan of the changes at high effort found 0 findings (stamped verified).

`T` means today.

| ID | Requirement | Type | Preconditions | Steps | Expected result | Expected log | Auto | Result |
|----|-------------|------|---------------|-------|-----------------|--------------|------|--------|
| TC-01 | Priority on add | Functional | App loaded | Look at the add form | A **Priority** select offers High, Medium, Low, with Medium selected | — | e2e | ✅ |
| TC-02 | Add with a priority | Functional | Empty list | Add "Taxes", Priority High | Stored `priority:"high"`; a **High** badge (class `high`) shows; the form resets to Medium | task.add@user | e2e | ✅ |
| TC-03 | Default priority | Functional | Empty list | Add "Default" without touching Priority | Stored `priority:"medium"`; **Medium** badge | task.add@user | e2e | ✅ |
| TC-04 | Priority filter | Functional | High, Medium and Low tasks | Choose each value in the priority filter | Only tasks with that priority show; "All priorities" shows all; the counter says "showing N" | ui.filter_priority@user | e2e | ✅ |
| TC-05 | Filters combine | Functional | Tasks of mixed priority, status and tags | Priority High + **Active** + tag `work` | Only open, high-priority tasks tagged work show | ui.filter_priority@user, ui.filter_status@user, ui.filter_tag@user | e2e | ✅ |
| TC-06 | Sort by priority, then due | Functional | Open: Low due `T-1`; High undated; High due `T+2`; Medium due `T` | View All | Order: High `T+2`, High undated, Medium `T`, Low `T-1` (priority first, then due, undated last); completed tasks stay below | — | e2e | ✅ |
| TC-07 | Edit opens inline | Functional | One open task | Click **Edit** | An inline form shows the task's current title, due, tags (as "a, b"), repeat and priority, with Save and Cancel; other rows are unchanged | — | e2e | ✅ |
| TC-08 | Edit every field | Functional | Open task "Old", no due, tag `a`, None, Medium | Edit to "New", due `T+3`, tags `b, c`, Weekly, High; Save | Stored and shown: title "New", due `T+3`, tags `[b,c]`, repeat weekly (anchorDay = day of `T+3`), priority high | task.edit@user | e2e | ✅ |
| TC-09 | Cancel and Escape | Functional | One open task | Edit, change fields, press **Cancel**; edit again, change, press Escape | Nothing saved either time; the row shows the original values; no `task.edit` logged | — | e2e | ✅ |
| TC-10 | Enter saves | Functional | One open task | Edit, change the title, press Enter in the title field | Saved | task.edit@user | e2e | ✅ |
| TC-11 | Edit validation | Functional | One open task | Edit: blank the title (spaces) and Save | Not saved; the form stays open with a message; stored title unchanged | — | e2e | ✅ |
| TC-12 | Repeat via edit gets a start date | Functional | Open task with no due date | Edit: Repeat Daily, due empty; Save | Saved with due `T` and repeat daily, matching add | task.edit@user | e2e | ✅ |
| TC-13 | Only open tasks are editable | Functional | One open and one completed task | Look at both rows | The open task has **Edit**; the completed one doesn't | — | e2e | ✅ |
| TC-14 | Spawned copies keep priority | Functional | Daily task, priority High, due `T` | Tick it | The next occurrence has `priority:"high"` | task.complete@user, task.spawn@user | e2e | ✅ |
| TC-15 | Edits are logged without user text | Functional | — | Edit a task's title to "Secret plan" and its tags to `private`; Save | One `task.edit` entry: actor `user`, the taskId, `changes.fields` lists `title` and `tags` (plus `priority`/`due`/`repeat` values when they change); no "Secret" or "private" anywhere in the log | task.edit@user | e2e | ✅ |
| TC-16 | API edits are attributed to api | Functional | — | `TodoDB.update(id, {priority:"low"})` from a script | Saved; logged as `task.edit` with actor `api`; `changes` = `{fields:["priority"], priority:"low"}` | task.edit@api | e2e | ✅ |
| TC-17 | v3 → v4 migration | Edge | A version-3 database with tasks that have no `priority` | Open the app | Tasks load unchanged with `priority:"medium"`; no data lost | — | e2e | ✅ |
| TC-18 | Tampered priority | Edge | A stored task with `priority:"<img src=x onerror=window.pwned=1>"`, and one with `"urgent"` | Load the page; filter by Medium | Both are treated as Medium; no injection; the badge reads Medium | — | e2e | ✅ |
| TC-19 | One edit at a time | Edge | Two open tasks | Click Edit on the first, then Edit on the second | The first form closes without saving; only the second is open | — | e2e | ✅ |
| TC-20 | Edits persist | Edge | — | Edit priority and due; Save; reload | Values persist after the reload | task.edit@user | e2e | ✅ |
| TC-21 | Editing a recurring task's due date | Edge | Monthly task due on the 15th | Edit due to the 31st of a month; Save; tick | `anchorDay` becomes 31; the next occurrence uses the 31st rule (clamped in short months) | task.edit@user, task.spawn@user | e2e | ✅ |
| TC-22 | Invalid updates rejected by the data layer | Security | — | `TodoDB.update(id, {title:"  ", priority:"urgent", due:"2026-13-45", repeat:"yearly"})` | Rejected with an error; nothing stored; logged as `task.edit` outcome error | task.edit:error@api | e2e | ✅ |
| TC-23 | HTML in an edited title shows as text | Security | — | Edit a title to `<img src=x onerror=window.pwned=1>`; Save | Shown as text; no `<img>` in the list; `window.pwned` unset | task.edit@user | e2e | ✅ |
| TC-24 | Existing suites still pass | Regression | — | Run `issue-7/run.js` and `issue-14/run.js` | Both pass in full, with their evals | — | e2e | ✅ |
| TC-25 | No console errors | Security / Regression | The whole issue-15 end-to-end run | Watch the console and exceptions | No unexpected errors | — | e2e | ✅ |
| TC-26 | An edited copy survives undo (code review #1) | Regression | Daily A due `T`, ticked (creates B) | Edit B: title "B edited", priority High; untick A | B is kept with its edits; A becomes a one-off (`repeat:"none"`) | task.edit@user, task.become_oneoff@user | e2e | ✅ |
| TC-27 | Saving an edit of a task that is gone tells you (code review #2) | Regression | An open task with the edit form open | Complete the task through the API, then press Save | The form closes and the page error box says the task was completed or deleted (changed in round 2 to match TC-33; approved by hariscontour-gif); nothing saved; logged as `task.edit` error | task.edit:error@user | e2e | ✅ |
| TC-28 | One title rule; long legacy titles stay editable (code review #3) | Regression | — | `TodoDB.add` with a 250-character title; then a stored legacy task with a 250-character title gets its priority edited | The add is rejected; the legacy task's priority edit saves (the title is only checked when it changes) | task.add:error@api, task.edit@user | e2e | ✅ |
| TC-29 | Unsaved edits survive re-renders (code review #4) | Regression | Tasks A and B | Edit A, type the title "Draft"; then tick B | A's form is still open and still shows "Draft" | task.complete@user | e2e | ✅ |
| TC-30 | One save at a time (code review #5) | Regression | An open edit form | Submit it twice quickly | Exactly one `task.edit` entry | task.edit@user | e2e | ✅ |
| TC-31 | No cancel during a save (code review round 2 #1) | Regression | A slow `TodoDB.update` | Edit, press Save, then Cancel / Escape while it saves | Cancel is disabled and Escape ignored until the save ends; then the form closes with the change saved | task.edit@user | e2e | ✅ |
| TC-32 | A half-typed date isn't silently cleared (code review round 2 #2) | Regression | Task due `T+5`; the edit form's date field holds an incomplete date | Save | Not saved; the form says to enter a complete date or clear the field; the stored due date is unchanged | — | e2e | ✅ |
| TC-33 | No stale form after the task is gone (code review round 2 #3) | Regression | Edit form open | Delete the task through the API, then Save | The form closes; the page error box says the task was completed or deleted | task.edit:error@user | e2e | ✅ |
| TC-34 | Untouched legacy titles aren't re-checked (code review round 2 #4) | Regression | A stored legacy title: 205 characters with surrounding spaces | Edit only its priority | Saved; logged `fields` is just `["priority"]` | task.edit@user | e2e | ✅ |
| TC-35 | A slow save doesn't block another task's edit (code review round 2 #5) | Regression | Task A's save is slow | Save A; meanwhile open B's edit and save it | Both are saved; no edit form is left open | task.edit@user | e2e | ✅ |

## How to run (once implemented)

```
node todo/tests/issue-15/run.js            # this suite + both older suites (TC-24); writes eval/eval-report.md
node todo/tests/issue-15/run.js --skip-regression
```
