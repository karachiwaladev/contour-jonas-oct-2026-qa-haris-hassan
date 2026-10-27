# Build flow: clarify → plan → approve → test cases → **test-case review** → implement tests → build → **code review** → security → run tests → PR

Use this for tickets that build a project or a feature someone will run and click. Run steps 2, 3 and 4b with the AskUserQuestion tool. While a question is open the turn stays busy, so cron passes can't fire in the middle of it.

The order is deliberate:

- Test cases are written **before** the code, straight from the approved plan, so they test what was agreed rather than what got built.
- The user **reviews and approves the test cases** before they are automated or the feature is built. The test cases are the definition of done, so a missing or wrong case is cheapest to fix here, before code and runners are built around it.
- The security scan runs **after** the code exists.
- The full test suite runs **last**, so it also covers any security fixes.

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

Present a short plan:

- **Scope:** what will and won't be built, mapped to each sentence of the ticket.
- **Data:** schema changes, and how existing stored data is migrated (never dropped).
- **UI:** the controls being added or changed, and where they go.
- **Security considerations:** what user input enters the system and where it goes, for example the DOM, storage or URLs. Note what could go wrong (injection or XSS, unsafe parsing, data loss on migration, leaked secrets) and how the design prevents it.
- **Files:** each file created or edited, including `tests/issue-<n>/`.
- **Test approach:** the kinds of test cases that will be written (functional, edge, regression, security), roughly how many, and how they'll be run.

Then call AskUserQuestion with these options: "Approve and build", "Change something", "Cancel". On a change request, revise the plan and ask again. On cancel, remove the label, tell the user, and leave the ticket open.

## 4. Write the test cases (after plan approval, before any code)

Start the ticket branch now, `ticket/<issue>-<slug>` from an up-to-date `main` (see *Branch and PR* in SKILL.md). Then write the test case **specification** in `<project>/tests/issue-<n>/test-cases.md`. Don't write the automated runner yet; that waits for the review in 4b.

**`test-cases.md`** holds the test case table, one row per case:

| ID | Requirement | Type | Preconditions | Steps | Expected result | Result |
|----|-------------|------|---------------|-------|-----------------|--------|
| TC-01 | "filter completed tasks" | Functional | 2 open, 1 done | Click **Completed** | Only the done task is listed | ⏳ |

- Cover every sentence of the ticket with at least one **Functional** case.
- Add **Edge** cases: empty input, whitespace, very long text, duplicates, boundaries such as dates of today, yesterday and none.
- Add **Regression** cases: the project's existing features still work, including data from the previous schema version.
- Add **Security** cases: HTML or script in every text input renders as text and doesn't execute; malformed or tampered stored data doesn't crash the app; nothing sensitive goes to the console or the URL.
- Always include "no console errors" and "data survives a reload".
- Leave **Result** as ⏳ for now.

Add an **Auto** column: `unit`, `e2e` or `Manual`. A case that can't be automated is marked `Manual` and runs by hand with chrome-devtools in step 7.

Commit it as `Ticket #N: test cases (for review)` and push the branch, so the user can also read it on GitHub.

## 4b. Test-case review: get the user's approval

**Nothing is automated, built or tested until the user approves the test cases.**

Show the test cases in the chat as a compact table: ID, type, what it checks, and the expected result, one line each. Also give:

- the counts by type;
- each ticket requirement → the case IDs that cover it, so gaps are visible;
- the cases you weren't sure about, if any, so the user looks at those first;
- the link to `test-cases.md` on the branch.

Then call AskUserQuestion with header "Test cases" and these options:

- **Approve test cases.** Go on to 4c.
- **Add or change cases.** Read the user's notes, update `test-cases.md`, commit as `Ticket #N: test cases (revised after review)`, and show the changed rows. Then ask again. Repeat until approved.
- **Revisit the plan.** The review showed the plan itself is wrong. Go back to step 3, re-plan and re-approve, then rewrite the test cases and review them again.
- **Cancel.** Remove the label, tell the user, leave the ticket open, and leave the branch as it is.

Record the approval at the top of `test-cases.md`, for example `Reviewed and approved by <user> on <date> (<n> cases)`. The PR shows this line, so a reviewer can see the definition of done was agreed before the build.

## 4c. Implement the approved test cases

Now write **`run.js`** (or whatever suits the stack): an automated runner for every approved case marked `unit` or `e2e`. It drives the app in Chrome and prints one `PASS TC-xx …` or `FAIL TC-xx … :: detail` line per case, then exits non-zero on any failure.

- Implement exactly the approved cases. If automating one shows it's wrong or impossible, don't silently change or drop it. Raise it with the user and get it re-approved (4b) first.
- Run it once before writing feature code, to establish a baseline. New-feature cases should fail now, which shows they test something real; existing behaviour may already pass. Note the baseline count.

Commit as `Ticket #N: implement approved test cases`, before any feature code.

## 5. Build

- Follow the project's existing structure, style and `CLAUDE.md` conventions.
- Secure by default:
  - Render user input with `textContent` or `new Option(text)`, never `innerHTML`.
  - Validate and normalize input.
  - Migrate stored data rather than dropping it.
  - No `eval` and no inline event-handler strings.
  - No secrets in code.
- Update the project's `CLAUDE.md`, including its manual test checklist and a pointer to `tests/issue-<n>/`, and the root `CLAUDE.md` index if anything there changes.
- Commit on the branch as you go: `Ticket #N: <summary>`.

## 5b. Code review with the code-review skill

Once the feature is built and committed, review the branch's diff against `main` with the **code-review** skill, before the security scan, so its fixes are scanned and tested too:

```
Skill: code-review
args:  "ticket/<issue>-<slug> high"
```

Use `high` for a feature, or `medium` for a small change. It reports correctness bugs and cleanups; it doesn't fix anything unless asked to.

Then act on what it reports:

- **Correctness findings** (bugs, wrong behaviour, unhandled cases): fix every confirmed one on the branch. For each, add a **Regression** test case to `test-cases.md` and to the runner that would have caught it. If the user is in the session, show them the new cases for approval (4b); otherwise list them in the PR.
- **Cleanups** (reuse, simplification, efficiency): apply them when they're clearly right and in scope. Skip the rest, and give a one-line reason for each in the PR.
- If a finding is wrong, don't change the code. Note it as "not applied", with the reason.
- Re-run the code review on the fixed branch until no confirmed correctness finding remains.

Commit as `Ticket #N: address code review` and keep a summary for the PR: findings by kind, how many were fixed or skipped, and why.

## 6. Security scan with the claude-security plugin

Scan this branch's changes with the **claude-security** plugin. Invoke its skill through the Skill tool:

```
Skill: claude-security:claude-security
args:  "Scan changes: this branch's diff against main, at high effort"
```

- Use `high` effort for a feature-sized change and `medium` for a small one.
- The plugin asks the user once to confirm the time and token cost. That's expected, so let the user answer.
- It writes `CLAUDE-SECURITY-<timestamp>/CLAUDE-SECURITY-RESULTS.md`, plus JSONL, SARIF and a revision stamp. The folder has its own `.gitignore`; never commit it.

Then act on the findings:

- **CRITICAL / HIGH / MEDIUM:** fix every one on the branch. You can ask the plugin to *suggest patches* for them; review each patch before applying it. For each fixed finding, add a **Security** test case to `test-cases.md` and `run.js` that would have caught it.
- **LOW:** fix it if it's cheap. Otherwise list it in the PR with a one-line justification.
- After fixing, scan the changes again (at `medium` effort is fine) until no MEDIUM or higher findings remain.
- If the plugin isn't installed or fails to run, don't skip silently. Tell the user, and say "security scan not run: <reason>" in the PR.

Keep the result for the PR: the effort used, the findings found and fixed by severity, what's left at LOW, and the report folder name. Don't paste raw report text that might quote a credential line.

## 7. Execute the test cases (after development is complete)

Run the **whole** suite against the finished build, security fixes included. Serve the project over HTTP rather than `file://`, so storage and paths behave like a real site:

```
python -m http.server 8765 --directory <project-folder>   # run in the background
```

1. **Automated:** run `run.js` and record every `PASS` and `FAIL` line.
2. **Manual and visual:** use the **chrome-devtools MCP tools** (`mcp__chrome-devtools__*`; load them with ToolSearch if they're deferred) for the `Manual` cases and for screenshots:
   - `navigate_page` → `http://localhost:8765/`
   - `take_snapshot`, then `fill`, `click` and `press_key` to drive the case. Clear old state first with `evaluate_script`, for example `indexedDB.deleteDatabase(...)`, then reload.
   - Check the outcome with `take_snapshot` or `evaluate_script`, which can read the DOM and the stored data.
   - `list_console_messages`: there must be no errors.
   - `take_screenshot` with `filePath` set to `<project>/screenshots/issue-<n>/NN-<what>.png`, one per key state.
3. **Jev end-to-end cases:** run them through the same runner, with settings from `jevConfig()` (see *End-to-end tests against Jev* in SKILL.md). Without Jev settings they're `SKIP`, not `PASS`. Check the runner's output, eval files and screenshots for the key before committing them.
4. **Record the results** in `test-cases.md`: set each Result to ✅ or ❌, and add a line at the top: `Executed <date> on <commit sha> — <passed>/<total> passed`.
5. **Any ❌:** fix the code, never the expected result. Then re-run the **entire** suite, not just the failing case, so a fix can't break something else. If the fix changed code meaningfully, re-scan the changes (step 6). Repeat until everything is ✅.
6. Stop the HTTP server.

**Fallback if the chrome-devtools MCP isn't connected:** drive Chrome over the DevTools Protocol from `run.js`, using headless Chrome with `--remote-debugging-port` and the `Runtime.evaluate` and `Page.captureScreenshot` commands. `--dump-dom` returns before async IndexedDB work finishes, so don't rely on it. Say in the PR that the fallback was used.

## 8. Open the PR for manual review

1. Commit the code, `tests/issue-<n>/` (with results filled in) and `screenshots/issue-<n>/` on the ticket branch, then run `git push -u origin <branch>`.
2. Open the PR into `main` (see *Branch and PR* in SKILL.md). The body has:
   - `Closes #<n>`, and a summary.
   - Requirement → how it was met.
   - **Test results:** `<passed>/<total>` passed, broken down by type, with a link to `tests/issue-<n>/test-cases.md`, and how to re-run them (`node tests/issue-<n>/run.js`). Include the test-case approval line from 4b and the baseline count from 4c.
   - **Code review:** "code-review at <level>: <n> correctness findings (<n> fixed), <n> cleanups (<n> applied, <n> skipped)", with each fixed finding in one line and its regression test ID.
   - **Security:** "claude-security scan of changes at <effort>: <n> findings (C/H/M/L), <n> fixed, remaining: …", with each fixed finding in one line.
   - The screenshots, embedded with a URL pinned to the branch commit that renders for a private repo. The commit stays reachable after a merge commit:
     `![Initial view](https://github.com/{owner}/{repo}/blob/<sha>/<project>/screenshots/issue-<n>/01-initial.png?raw=true)`
   - The **How to approve** line.
3. Swap the label: `gh issue edit <n> --add-label "factory:awaiting-review" --remove-label "factory:in-progress"`.
4. Comment on the ticket with "PR #<pr> is ready for review", the link, a one-line summary, the test pass count and the security result.
5. Run `git checkout main`. **Stop here.** Don't merge or close anything. Approval, merging and closing follow `review-flow.md`, on a later pass or when the user approves in the session.
