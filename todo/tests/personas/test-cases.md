# Persona test suites: test cases

**Status:** **Reviewed and approved by hariscontour-gif on 2026-10-27** (77 cases: 65 for the 11 user personas, automated; 12 for Hostile Hank, run by hand). The 11 user personas are automated; Hostile Hank's 12 cases are run by hand. Weakness cases are reported as findings, not failures. ANA-05 was reclassified from a failure to a finding by hariscontour-gif on 2026-10-27.

Executed 2026-10-27 on a5ae6b5 (app code unchanged) with `node todo/tests/personas/run-all.js`: 64 automated cases ran — 61 pass, 0 fail, 2 findings (ANA-05: light-theme "Due today" pill 4.44:1 and tag chip 4.48:1, below 4.5:1; ANA-06: dark-theme button label 3.23:1, tag chip 4.36:1); VERA-01..05 met their budgets. ANA-07 and HANK-01..12 are manual (📝).

These are end-to-end **journeys** for the twelve personas described in
`personas.md`. They complement, not duplicate, the existing issue-7, issue-14 and
issue-15 suites (cited per persona in `personas.md`). Expected results and expected
logs were checked against the real code (`app.js`, `db.js`, `logger.js`,
`recurrence.js`, `styles.css`, `index.html`) — **except** Hostile Hank cases
marked **"Risk:"**, which state the *safe behavior we want*; those are expected to
surface as findings when run, because the log is best-effort and client-side by
design.

**Conventions**
- `T` = today, `T+3` = three days from today, `T-5` = five days ago (relative to
  the day the suite runs).
- **Expected log** uses the eval syntax `action[:error][@actor]` (see
  `tests/eval/eval-logs.js`). `—` means no log assertion for that case.
- **Auto** is `e2e` (headless Chrome via `tests/lib/harness.js`), `unit` (Node,
  no browser), or `Manual` (needs a human / real screen reader).
- **Result**: ✅ pass, ❌ fail, ⚠️ finding (a known weakness, reported but not failing the run), 📝 manual (run by hand).
- Performance thresholds are **reasonable headless-Chrome budgets on a typical dev
  machine**, chosen by us (not tuned-for guarantees); see notes under Vera.

---

## 1. Casual Carla — first-time, minimal

| ID | Requirement | Type | Preconditions | Steps | Expected result | Expected log | Auto | Result |
|----|-------------|------|---------------|-------|-----------------|--------------|------|--------|
| CARLA-01 | Empty state on first open | Functional | Fresh profile, empty DB | Open the app | `#task-list` empty; `#empty` shows "No tasks yet. Add one above."; `#count` is empty | — | e2e | ✅ |
| CARLA-02 | Add a basic task | Functional | Empty list | Type "Buy milk", press Enter | One task "Buy milk", Medium badge, no due/tags/repeat; `#empty` hidden; `#count` = "1 of 1 left" | task.add@user | e2e | ✅ |
| CARLA-03 | Blank / whitespace title does nothing | Edge | Empty list | Submit "" then "   " (spaces) | No task added; list still empty; nothing logged | — | e2e | ✅ |
| CARLA-04 | Complete a task | Functional | CARLA-02 state | Tick the checkbox | Task struck through, moves to Completed section; `#count` = "0 of 1 left" | task.complete@user | e2e | ✅ |
| CARLA-05 | Delete a task | Functional | A task exists | Press Delete | Task gone; list empty again with "No tasks yet." | task.delete@user | e2e | ✅ |
| CARLA-06 | Tasks persist across reload | Functional | Two tasks, one done | Reload the page | Both tasks reappear with the same done state and Medium badge | — | e2e | ✅ |

---

## 2. Organized Omar — power planner

| ID | Requirement | Type | Preconditions | Steps | Expected result | Expected log | Auto | Result |
|----|-------------|------|---------------|-------|-----------------|--------------|------|--------|
| OMAR-01 | Build a planned week | Functional | Empty list | Add 5 tasks of mixed priority and due dates | All 5 shown; `#count` = "5 of 5 left" | task.add@user | e2e | ✅ |
| OMAR-02 | Default sort order | Functional | OMAR-01 (High undated, High due `T+2`, Medium due `T`, Low due `T-1`, Low undated) | View All | Order: High `T+2`, High undated, Medium `T`, Low `T-1`, Low undated (priority, then soonest due, undated last) | — | e2e | ✅ |
| OMAR-03 | Combined status + priority + tag filter | Functional | Mixed tasks, some done, tagged `work` | Active + priority High + tag `work` | Only open, high-priority, `work`-tagged tasks show; `#count` shows "· showing N" | ui.filter_status@user, ui.filter_priority@user, ui.filter_tag@user | e2e | ✅ |
| OMAR-04 | Tag normalization | Functional | Empty list | Add "Report" with tags `Work, work , URGENT,` | Stored/shown tags are exactly `#work` and `#urgent` (trimmed, lowercased, deduped, trailing empty dropped) | task.add@user | e2e | ✅ |
| OMAR-05 | Tag chip click sets the filter without ticking | Functional | A task tagged `work`, not done | Click its `#work` chip | Filter becomes `work`; the task is **not** completed; dropdown shows `work` | ui.filter_tag@user | e2e | ✅ |
| OMAR-06 | "showing N" counter accuracy | Functional | 5 tasks, filter to 2 | Apply a filter matching 2 | `#count` = "K of 5 left · showing 2" (K = open count) | — | e2e | ✅ |
| OMAR-07 | Dropdown resets when last tagged task is deleted | Edge | Only one task carries tag `work`, filter = `work` | Delete that task | `renderTagOptions` drops `work`; filter resets to "All tags" (`filters.tag` cleared); remaining tasks all show | task.delete@user | e2e | ✅ |

---

## 3. Routine Rita — recurring tasks

| ID | Requirement | Type | Preconditions | Steps | Expected result | Expected log | Auto | Result |
|----|-------------|------|---------------|-------|-----------------|--------------|------|--------|
| RITA-01 | Daily chore spawns next on completion | Functional | Empty list | Add "Water plants" due `T`, Daily; tick it | Ticked copy in Completed; new open copy due `T+1`, 🔁 Daily badge | task.complete@user, task.spawn@user | e2e | ✅ |
| RITA-02 | Repeat with no due starts today | Edge | Empty list | Add "Stretch", no due, Daily | Saved due `T`, "Due today", 🔁 Daily | task.add@user | e2e | ✅ |
| RITA-03 | Missed occurrences skipped | Edge | Empty list | Add daily task due `T-5`; tick it | New copy due `T` (not `T-4`); exactly one open occurrence | task.complete@user, task.spawn@user | e2e | ✅ |
| RITA-04 | Monthly month-end clamping | Edge | — | `nextDue("2027-01-31","monthly",31,"2027-01-01")`; then from `2027-02-28` anchor 31 | `2027-02-28`, then `2027-03-31` (no drift to 28th) | — | unit | ✅ |
| RITA-05 | Stop repeating ends the series | Functional | Open daily head task | Click Stop repeating, then tick it | Badge/button gone, `repeat:"none"`; ticking creates no copy | task.stop_repeating@user, task.complete@user | e2e | ✅ |
| RITA-06 | Undo an accidental completion | Edge | Daily task ticked (copy B created, untouched) | Untick the completed original | Copy B removed; original open again; exactly one open occurrence | task.reopen@user, task.copy_removed@user | e2e | ✅ |
| RITA-07 | Reopening after the series moved on → one-off | Edge | Daily A ticked (B), B ticked (C); untick A | Untick A | A reopens as `repeat:"none"`, no 🔁; re-ticking A spawns nothing; 3 tasks total | task.reopen@user, task.become_oneoff@user | e2e | ✅ |

---

## 4. Procrastinating Pete — overdue + edits

| ID | Requirement | Type | Preconditions | Steps | Expected result | Expected log | Auto | Result |
|----|-------------|------|---------------|-------|-----------------|--------------|------|--------|
| PETE-01 | Overdue and Due-today badges | Functional | Empty list | Add tasks due `T-1`, `T`, `T+3` | `T-1` shows red "Overdue · …" (`.due.overdue`); `T` shows "Due today" (`.due.today`); `T+3` shows "Due …" plain | task.add@user | e2e | ✅ |
| PETE-02 | Reschedule via inline edit | Functional | Overdue task | Edit, change due to `T+7`, Save | Badge becomes plain "Due …"; row re-sorts; stored due = `T+7` | task.edit@user | e2e | ✅ |
| PETE-03 | 200-char title limit on edit | Edge | A short-title task | Edit title to 201 chars, Save | Rejected; form stays open with "at most 200 characters"; stored title unchanged | — (no successful edit) | e2e | ✅ |
| PETE-04 | Half-typed date blocks the save | Edge | Task due `T+5` | In edit, type an incomplete date (badInput), Save | Not saved; form says "Enter a complete date, or clear the field."; due unchanged | — | e2e | ✅ |
| PETE-05 | Cancel is disabled during a save | Edge | Slow `TodoDB.update` | Edit, Save, then click Cancel / press Escape while saving | Cancel ignored until the save ends; then form closes with the change saved | task.edit@user | e2e | ✅ |
| PETE-06 | Editing due/repeat resets the monthly anchor | Edge | Monthly task due on the 15th | Edit due to a 31st, Save, then tick | `anchorDay` becomes 31; next occurrence uses the 31st rule (clamped in short months) | task.edit@user, task.complete@user, task.spawn@user | e2e | ✅ |

---

## 5. Chaotic Chris — error-prone, multi-tab

| ID | Requirement | Type | Preconditions | Steps | Expected result | Expected log | Auto | Result |
|----|-------------|------|---------------|-------|-----------------|--------------|------|--------|
| CHRIS-01 | Fast double submit adds once | Edge | Slow `TodoDB.add` | Submit "Buy milk" twice quickly | Exactly one "Buy milk" task (`adding` guard) | task.add@user | e2e | ✅ |
| CHRIS-02 | Edit a task completed meanwhile | Edge | Edit form open on a task | Complete the task via API, then Save | Form closes; `#error` (`role=alert`) says it was completed or deleted; nothing saved | task.edit:error@user | e2e | ✅ |
| CHRIS-03 | Edit a task deleted meanwhile | Edge | Edit form open | Delete the task via API, then Save | Form closes; `#error` explains; nothing saved | task.edit:error@user | e2e | ✅ |
| CHRIS-04 | Second tab upgrades the DB (onblocked) | Edge | App open; simulate another tab holding an older version | Trigger an upgrade request that blocks | `open()` rejects with "being upgraded… close other tabs"; `#error` shows it; no crash | — | e2e | ✅ |
| CHRIS-05 | Reconnect after onversionchange | Regression | App open with a task | Delete the DB from the page (as another tab upgrading), then add a task | The stale connection is dropped and reopened; add succeeds; list shows the new task | task.add@user | e2e | ✅ |
| CHRIS-06 | One edit form open at a time | Edge | Two open tasks | Click Edit on A, then Edit on B | A's form closes unsaved; only B's form is open | — | e2e | ✅ |

---

## 6. Accessibility Ana — keyboard + screen reader

| ID | Requirement | Type | Preconditions | Steps | Expected result | Expected log | Auto | Result |
|----|-------------|------|---------------|-------|-----------------|--------------|------|--------|
| ANA-01 | Accessible names on controls | Accessibility | A task with a tag and a repeat head | Inspect accessible names | Checkbox "Mark \"…\" as done", Edit "Edit \"…\"", Delete "Delete \"…\"", Stop "Stop repeating \"…\"", chip title "Show only #tag"; add-form inputs all have `aria-label` | — | e2e | ✅ |
| ANA-02 | Inline edit focus order | Accessibility | One open task | Open Edit; Tab through the form | Focus order: title (auto-focused) → due → repeat → priority → tags → Save → Cancel (matches DOM order) | — | e2e | ✅ |
| ANA-03 | Errors are announced via role=alert | Accessibility | One open task | Save a blank title | `.edit-error` (`role=alert`) becomes visible with the message so a screen reader announces it | — | e2e | ✅ |
| ANA-04 | Page-level error is role=alert | Accessibility | Trigger a storage error on add | Submit a task that fails | `#error` has `role=alert` and is shown with the message | — | e2e | ✅ |
| ANA-05 | Contrast — light theme | Accessibility | Light theme | Compute contrast ratios of text tokens | Body/muted/pill text all ≥ 4.5:1; button label (white on `--accent`) = 5.17:1 (passes) | — | e2e | ⚠️ |
| ANA-06 | Contrast — dark theme | Accessibility | Dark theme | Compute contrast ratios | Body ~14.9:1, muted ~6.2:1 pass; **button label (white on `--accent`) ≈ 3.23:1 — fails AA for normal text (passes only the 3:1 large-text/UI bar)**. Record as a finding. | — | e2e | ⚠️ |
| ANA-07 | Screen-reader walkthrough | Accessibility | Real screen reader (NVDA/VoiceOver) | Add, edit, complete and filter using only keyboard + SR | Every control is reachable and announced sensibly; state changes (done, filters, errors) are perceivable | — | Manual | 📝 |

---

## 7. Malicious Mallory — input-level security tester

| ID | Requirement | Type | Preconditions | Steps | Expected result | Expected log | Auto | Result |
|----|-------------|------|---------------|-------|-----------------|--------------|------|--------|
| MAL-01 | Script payload in title renders as text | Security | Empty list | Add title `<img src=x onerror=window.pwned=1>`, tag `<b>x</b>` | Rendered as text (`textContent`); no `<img>`/`<b>` element; `window.pwned` unset | task.add@user | e2e | ✅ |
| MAL-02 | Payload survives as text through edit | Security | A normal task | Edit title to `<script>window.pwned=1</script>`, Save | Shown as text; no script runs; `window.pwned` unset | task.edit@user | e2e | ✅ |
| MAL-03 | Tampered stored fields coerced on read | Security | Seed a task with bad `repeat`, `due`, `anchorDay`, `priority` | Load the app | No crash; repeat→none, bad due→null (no badge), anchor→null/clamped, priority→medium | — | e2e | ✅ |
| MAL-04 | Forged `{actor:"user"}` without token is `api` | Security | — | `TodoDB.remove(id, {actor:"user"})` and `TodoLog.log({action:"task.delete", actor:"user"})` | Both logged with actor `api`; `claimUserToken()` returns `null` | task.delete@api | e2e | ✅ |
| MAL-05 | Tampered tag array dropped safely | Security | Seed tags `[null,{},5,"ok",true,["x"]]` | Load the app | Only `#5` and `#ok` chips appear | — | e2e | ✅ |

---

## 8. Privacy Priya — privacy auditor

| ID | Requirement | Type | Preconditions | Steps | Expected result | Expected log | Auto | Result |
|----|-------------|------|---------------|-------|-----------------|--------------|------|--------|
| PRIYA-01 | No title text in the log | Security | Empty log | Add "Secret merger plan" tag `confidential`; complete it | No entry contains "Secret", "merger" or "confidential"; `task.add.changes` has only `{done,repeat,due,tags:<count>,priority}` | task.add@user, task.complete@user | e2e | ✅ |
| PRIYA-02 | Tag filter logged as set/cleared only | Security | Tasks with tags | Choose a tag, then clear it | `ui.filter_tag` entries carry `{tag:"set"}` then `{tag:"cleared"}`; no tag text | ui.filter_tag@user | e2e | ✅ |
| PRIYA-03 | Edit log omits title and tag text | Security | A task | Edit title to "Secret plan", tags to `private`; Save | `task.edit.changes.fields` lists `title`,`tags`; no "Secret"/"private"; tags logged as a count | task.edit@user | e2e | ✅ |
| PRIYA-04 | Export contains no user text | Security | Actions done with sensitive titles/tags | Export JSONL; scan the file | One valid JSON object per line; no title/tag text anywhere; a `log.export` entry is added | log.export@user | e2e | ✅ |
| PRIYA-05 | Clear log works and records itself | Functional | Some entries | Press Clear log | Store emptied; one `log.clear` entry remains (the clear is recorded) | log.clear@user | e2e | ✅ |

---

## 9. Bot Bob — automation / AI agent

| ID | Requirement | Type | Preconditions | Steps | Expected result | Expected log | Auto | Result |
|----|-------------|------|---------------|-------|-----------------|--------------|------|--------|
| BOB-01 | Direct API calls logged as api | Functional | — | `TodoDB.add(...)`, `TodoDB.setDone(...)` directly | Entries actor `api`; the same actions via the page are `user` | task.add@api, task.complete@api, task.add@user | e2e | ✅ |
| BOB-02 | Automation flag set | Functional | Headless Chrome (`navigator.webdriver` true) | Do any action | Entries have `automated:true` | task.add | e2e | ✅ |
| BOB-03 | add corrects, update rejects | Functional | — | `TodoDB.add("x",{priority:"urgent",repeat:"yearly"})` then `TodoDB.update(id,{priority:"urgent"})` | add stores corrected defaults (medium/none); update **rejects** (nothing stored, error logged) | task.add@api, task.edit:error@api | e2e | ✅ |
| BOB-04 | Eval syntax: success and :error | Eval | A fixture log | Run the eval expecting `task.add@user` then `task.add:error` | Plain action matches only successes; `:error` matches only failures; actor qualifier enforced | — | unit | ✅ |
| BOB-05 | 1,000-entry log cap | Edge | — | Write 1,005 entries | Exactly 1,000 kept; 5 oldest dropped (`addAndTrim`) | — | e2e | ✅ |
| BOB-06 | Spawned copies keep attribution & priority | Functional | Daily High task via API | `setDone(id,true)` via API | Spawn logged actor `api`; copy keeps `priority:"high"` | task.complete@api, task.spawn@api | e2e | ✅ |

---

## 10. Legacy Larry — upgrading from an old version

| ID | Requirement | Type | Preconditions | Steps | Expected result | Expected log | Auto | Result |
|----|-------------|------|---------------|-------|-----------------|--------------|------|--------|
| LARRY-01 | v1 data migrates to v4 with no loss | Regression | Seed a v1 DB (title/done only) | Open the app (v4) | Every record loads; backfilled `due:null`, `tags:[]`, `repeat:"none"`, `anchorDay`, `nextId/spawnedFrom:null`, `priority:"medium"` | — | e2e | ✅ |
| LARRY-02 | v2 data migrates (due + tags kept) | Regression | Seed a v2 DB with due dates and tags | Open the app | Due dates and tags preserved; `repeat:"none"`, Medium priority added; no badge | — | e2e | ✅ |
| LARRY-03 | v3 data gets default priority | Regression | Seed a v3 DB (no `priority`) | Open the app | Tasks load unchanged with `priority:"medium"` | — | e2e | ✅ |
| LARRY-04 | Count/sort correct after migration | Regression | Mixed migrated records | View All | `#count` matches migrated total; sort obeys priority/due rules with the defaults | — | e2e | ✅ |
| LARRY-05 | Older tab open → safe, explained block | Edge | Simulate an older-version connection held open | Open current app | `onblocked` path: "being upgraded… close other tabs" in `#error`; no data loss, no crash (NOT a silent open — see personas.md grounding) | — | e2e | ✅ |

---

## 11. Volume Vera — load / performance

Thresholds are reasonable headless-Chrome budgets on a typical dev machine, not
tuned-for guarantees; the app rebuilds the whole list/dropdown on each render
(no virtualization), so these may surface as findings.

| ID | Requirement | Type | Preconditions | Steps | Expected result | Expected log | Auto | Result |
|----|-------------|------|---------------|-------|-----------------|--------------|------|--------|
| VERA-01 | First render of 2,000 tasks | Performance | Seed 2,000 tasks | Load; measure `render()` to painted list | Completes under **1,500 ms**; all rows present; no console errors | — | e2e | ✅ |
| VERA-02 | Filter change latency at scale | Performance | 2,000 tasks loaded | Switch to Active, then a priority filter | Each filtered re-render under **500 ms** | — | e2e | ✅ |
| VERA-03 | Many tags in the dropdown | Performance | Seed 2,000 tasks spread over 300 distinct tags | Load; open the tag dropdown | Dropdown builds under **500 ms**; all 300 options present and sorted | — | e2e | ✅ |
| VERA-04 | Add a task into a large list | Performance | 2,000 tasks loaded | Add one task | Add + re-render under **1,500 ms**; count increments correctly | task.add@user | e2e | ✅ |
| VERA-05 | Log rollover stays bounded & cheap | Performance | Drive the log to ~1,000 entries, then keep going | Add 50 more actions; open the panel | Store stays at 1,000 (oldest trimmed); panel renders newest 50 under **500 ms** | — | e2e | ✅ |

---

## 12. Hostile Hank — attacker / hacker

Scope: this app only, in a throwaway headless-browser profile; no network targets.
Run by hand by a reviewer; not automated.

Each case states the attack, the expected **SAFE** behavior, and (where relevant)
that the app stays usable afterwards. Cases marked **Risk:** describe the safe
behavior we *want*; because the log is best-effort and client-side by design, the
app may not currently defend against them — expect them to show as findings.

| ID | Requirement | Type | Preconditions | Steps | Expected result | Expected log | Auto | Result |
|----|-------------|------|---------------|-------|-----------------|--------------|------|--------|
| HANK-01 | Forge `user` without the token | Security | App loaded (token already claimed) | `TodoLog.log({action:"task.delete",actor:"user"})`; `TodoDB.remove(id,{actor:"user"})` | Both logged as `api`; `claimUserToken()` returns `null`; no escalation | task.delete@api | Manual | 📝 |
| HANK-02 | Steal the token before app load | Security | Attacker init-script runs before `app.js` | Monkey-patch/shadow `TodoLog.claimUserToken` to capture or re-return the token, then call `TodoDB.remove(id, stolenToken)` | **Risk:** we want a forged/stolen-token entry never to count as `user`. In reality `app.js` calls `claimUserToken()` at load and holds the real token in its closure; an init-script that replaces the function before load can pre-claim or intercept it. Record actual behavior as a finding. | task.delete (actor as observed) | Manual | 📝 |
| HANK-03 | Flood the log to push out evidence | Security | Some real entries including a `task.delete` | Write 1,100 junk `api` entries via `TodoLog.log` | **Risk:** the 1,000-entry cap means the real delete can be trimmed out by flooding. App stays usable; store caps at 1,000. Confirm whether the earlier real entry survives; record as a finding. | — | Manual | 📝 |
| HANK-04 | Erase the log via API; does evidence survive? | Security | Entries including sensitive actions | `TodoLog.clear()` directly | Store emptied; **a `log.clear` entry is written** (the clear records itself). `clear({silent:true})` would leave none — note that `silent` is reachable from script. Record whether an unavoidable trace remains. | log.clear@api | Manual | 📝 |
| HANK-05 | Prototype-pollution keys in a stored record | Security | Seed a task record carrying `__proto__`/`constructor`/`prototype` as fields | Load the app; add another task | **Risk (want):** no pollution of `Object.prototype`; app renders safely. Note: records are read via `getAll()` + `clean()` (spread copy), not `JSON.parse` of attacker text, so classic `__proto__` revival is unlikely — but a crafted stored object is still coerced field-by-field. Verify `({}).polluted` is undefined. | — | Manual | 📝 |
| HANK-06 | Hostile argument objects to TodoDB | Security | — | Call `TodoDB.add` / `update` with values that are objects with throwing getters, Symbols, and non-string titles | No uncaught exception escapes; `add` coerces/falls back, `update` rejects; app stays usable | task.add@api, task.edit:error@api | Manual | 📝 |
| HANK-07 | XSS via stored data rendered into attributes/classes | Security | Seed tasks whose `priority`/`repeat`/`due` are payload strings | Load the app | `priority` → coerced to allowlist (class only ever `high/medium/low`); `repeat` → none (no badge); invalid `due` → no badge; no attribute/class injection, no script | — | Manual | 📝 |
| HANK-08 | Giant strings / arrays (resource exhaustion) | Security | Seed a task with a ~5 MB title and a tags array of 100k entries | Load the app | **Risk:** no enforced size cap on stored title; `normalizeTags` dedupes/caps each tag at 30 chars but iterates the whole array. App should not hang indefinitely or crash; may be slow. Record timing/behavior as a finding. | — | Manual | 📝 |
| HANK-09 | Dangling / negative `nextId`/`spawnedFrom`, huge ids | Security | Seed a done recurring task whose `nextId` points at a missing/negative id | Load; untick (reopen) the task | `idOrNull` coerces non-integers to null; reopen handles a missing copy (`store.get` → undefined) by becoming a one-off; no crash | task.reopen@api, task.become_oneoff@api | Manual | 📝 |
| HANK-10 | Formula / CSV injection via the JSONL export | Security | A task titled `=cmd|'/c calc'!A1` and a tag `=1+1` | Export JSONL; inspect the file | Export is JSONL, and titles/tags are **not** in the log at all, so no formula/text reaches the file; each line is one valid JSON object. **Risk note:** if a spreadsheet ever imported this JSONL, JSON-quoted strings are inert; confirm no raw newline/`action` injection breaks the one-object-per-line format | — | Manual | 📝 |
| HANK-11 | DB version downgrade/upgrade from another tab | Security | App open on v4 | From another context, open `todo-app` at a higher version (upgrade) and at a lower version (downgrade attempt) | Upgrade → this connection gets `onversionchange`, closes and reopens next call; downgrade request fails (lower version), app unaffected; clear message on block; no data loss | — | Manual | 📝 |
| HANK-12 | Two-tab race to double-spawn a series | Security | A daily recurring task | From two contexts call `setDone(id,true)` concurrently | Exactly one spawned copy: completion + spawn happen in one `readwrite` transaction and `nextId` guards a second spawn; no duplicate series | task.complete, task.spawn | Manual | 📝 |

---

## How it runs

`node todo/tests/personas/run-all.js` runs the 11 user-persona runners in turn
(`--only <name>` runs one, e.g. `--only rita`) and prints a persona → pass / fail /
finding / manual table and the findings list. It exits non-zero only on a FAIL.

- **One runner per persona:** `todo/tests/personas/<persona>/run.js` (e.g.
  `casual-carla/run.js`), built on `tests/lib/harness.js` through the shared
  `personas/lib.js`. Each prints one `PASS` / `FAIL` / `FINDING` / `MANUAL` line per case.
- **Findings:** each runner keeps a fixed list of finding-type ids from this spec
  (ANA-05, ANA-06, VERA-01..05). One of those that misses its expectation prints
  `FINDING <ID> <name> :: <details>` and doesn't fail the run; if it meets it, it prints PASS.
- **Eval:** the logger only accepts `TC-<n>` tags, so each case is tagged
  `TC-<n>` while it runs and mapped back to its persona id in the collected log.
  The shared eval (`tests/eval/eval-logs.js`, which now accepts ids like
  `CARLA-01` as well as `TC-12`) checks the persona's rows of this file against
  `<persona>/expected-log.json` and writes `<persona>/eval/`. Cases whose expected
  log is `—` but that deliberately trigger a failed action (PETE-03, ANA-04) are
  `skip` entries there (no log assertion), and their runner checks the log itself.
- **Unit cases** (RITA-04, BOB-04) run in Node. **Manual:** ANA-07 (real screen
  reader) and all Hostile Hank cases, run by hand by a reviewer.
- **Seeding** legacy, tampered and large datasets uses `seed(version, records)`
  on `personas/blank.html`; an "older tab" (CHRIS-04, LARRY-05) is an init script
  that holds a v3 connection open before the app loads.
