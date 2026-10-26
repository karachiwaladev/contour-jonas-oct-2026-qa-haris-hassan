# Test cases: ticket #6, task priority (issue #15)

Written from the approved plan **before** implementation. This builds on #16 (the action log), so each end-to-end case is tagged in the log and checked by the eval. **Expected log** uses the eval syntax `action[:error][@actor]`; `expected-log.json` holds the same expectations for the eval.

**Status:** awaiting test-case review

`T` means today.

| ID | Requirement | Type | Preconditions | Steps | Expected result | Expected log | Auto | Result |
|----|-------------|------|---------------|-------|-----------------|--------------|------|--------|
| TC-01 | Priority on add | Functional | App loaded | Look at the add form | A **Priority** select offers High, Medium, Low, with Medium selected | — | e2e | ⏳ |
| TC-02 | Add with a priority | Functional | Empty list | Add "Taxes", Priority High | Stored `priority:"high"`; a **High** badge (class `high`) shows; the form resets to Medium | task.add@user | e2e | ⏳ |
| TC-03 | Default priority | Functional | Empty list | Add "Default" without touching Priority | Stored `priority:"medium"`; **Medium** badge | task.add@user | e2e | ⏳ |
| TC-04 | Priority filter | Functional | High, Medium and Low tasks | Choose each value in the priority filter | Only tasks with that priority show; "All priorities" shows all; the counter says "showing N" | ui.filter_priority@user | e2e | ⏳ |
| TC-05 | Filters combine | Functional | Tasks of mixed priority, status and tags | Priority High + **Active** + tag `work` | Only open, high-priority tasks tagged work show | ui.filter_priority@user, ui.filter_status@user, ui.filter_tag@user | e2e | ⏳ |
| TC-06 | Sort by priority, then due | Functional | Open: Low due `T-1`; High undated; High due `T+2`; Medium due `T` | View All | Order: High `T+2`, High undated, Medium `T`, Low `T-1` (priority first, then due, undated last); completed tasks stay below | — | e2e | ⏳ |
| TC-07 | Edit opens inline | Functional | One open task | Click **Edit** | An inline form shows the task's current title, due, tags (as "a, b"), repeat and priority, with Save and Cancel; other rows are unchanged | — | e2e | ⏳ |
| TC-08 | Edit every field | Functional | Open task "Old", no due, tag `a`, None, Medium | Edit to "New", due `T+3`, tags `b, c`, Weekly, High; Save | Stored and shown: title "New", due `T+3`, tags `[b,c]`, repeat weekly (anchorDay = day of `T+3`), priority high | task.edit@user | e2e | ⏳ |
| TC-09 | Cancel and Escape | Functional | One open task | Edit, change fields, press **Cancel**; edit again, change, press Escape | Nothing saved either time; the row shows the original values; no `task.edit` logged | — | e2e | ⏳ |
| TC-10 | Enter saves | Functional | One open task | Edit, change the title, press Enter in the title field | Saved | task.edit@user | e2e | ⏳ |
| TC-11 | Edit validation | Functional | One open task | Edit: blank the title (spaces) and Save | Not saved; the form stays open with a message; stored title unchanged | — | e2e | ⏳ |
| TC-12 | Repeat via edit gets a start date | Functional | Open task with no due date | Edit: Repeat Daily, due empty; Save | Saved with due `T` and repeat daily, matching add | task.edit@user | e2e | ⏳ |
| TC-13 | Only open tasks are editable | Functional | One open and one completed task | Look at both rows | The open task has **Edit**; the completed one doesn't | — | e2e | ⏳ |
| TC-14 | Spawned copies keep priority | Functional | Daily task, priority High, due `T` | Tick it | The next occurrence has `priority:"high"` | task.complete@user, task.spawn@user | e2e | ⏳ |
| TC-15 | Edits are logged without user text | Functional | — | Edit a task's title to "Secret plan" and its tags to `private`; Save | One `task.edit` entry: actor `user`, the taskId, `changes.fields` lists `title` and `tags` (plus `priority`/`due`/`repeat` values when they change); no "Secret" or "private" anywhere in the log | task.edit@user | e2e | ⏳ |
| TC-16 | API edits are attributed to api | Functional | — | `TodoDB.update(id, {priority:"low"})` from a script | Saved; logged as `task.edit` with actor `api`; `changes` = `{fields:["priority"], priority:"low"}` | task.edit@api | e2e | ⏳ |
| TC-17 | v3 → v4 migration | Edge | A version-3 database with tasks that have no `priority` | Open the app | Tasks load unchanged with `priority:"medium"`; no data lost | — | e2e | ⏳ |
| TC-18 | Tampered priority | Edge | A stored task with `priority:"<img src=x onerror=window.pwned=1>"`, and one with `"urgent"` | Load the page; filter by Medium | Both are treated as Medium; no injection; the badge reads Medium | — | e2e | ⏳ |
| TC-19 | One edit at a time | Edge | Two open tasks | Click Edit on the first, then Edit on the second | The first form closes without saving; only the second is open | — | e2e | ⏳ |
| TC-20 | Edits persist | Edge | — | Edit priority and due; Save; reload | Values persist after the reload | task.edit@user | e2e | ⏳ |
| TC-21 | Editing a recurring task's due date | Edge | Monthly task due on the 15th | Edit due to the 31st of a month; Save; tick | `anchorDay` becomes 31; the next occurrence uses the 31st rule (clamped in short months) | task.edit@user, task.spawn@user | e2e | ⏳ |
| TC-22 | Invalid updates rejected by the data layer | Security | — | `TodoDB.update(id, {title:"  ", priority:"urgent", due:"2026-13-45", repeat:"yearly"})` | Rejected with an error; nothing stored; logged as `task.edit` outcome error | task.edit:error@api | e2e | ⏳ |
| TC-23 | HTML in an edited title shows as text | Security | — | Edit a title to `<img src=x onerror=window.pwned=1>`; Save | Shown as text; no `<img>` in the list; `window.pwned` unset | task.edit@user | e2e | ⏳ |
| TC-24 | Existing suites still pass | Regression | — | Run `issue-7/run.js` and `issue-14/run.js` | Both pass in full, with their evals | — | e2e | ⏳ |
| TC-25 | No console errors | Security / Regression | The whole issue-15 end-to-end run | Watch the console and exceptions | No unexpected errors | — | e2e | ⏳ |

## How to run (once implemented)

```
node todo/tests/issue-15/run.js            # this suite + both older suites (TC-24); writes eval/eval-report.md
node todo/tests/issue-15/run.js --skip-regression
```
