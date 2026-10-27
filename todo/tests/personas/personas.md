# Persona test suites: who they are

**Status:** Awaiting review. Not executed yet.

Twelve personas, each a realistic user (or attacker) of the browser todo app in
`todo/`. The goal of the persona suites is **end-to-end journeys**: a plausible
sequence a real person of that type would do, rather than the unit-level checks
the existing issue-7, issue-14 and issue-15 suites already cover. Where a persona
overlaps an existing case, this file cites that case so the persona suite can lean
on it instead of duplicating it.

The matching cases are in `test-cases.md`; the runner layout is in that file's
"How it will run" section.

Grounding note: every persona below was checked against the real code
(`app.js`, `db.js`, `logger.js`, `recurrence.js`, `index.html`, `styles.css`).
Where the user's description named a behavior the app does **not** actually have,
it is called out under "Grounding" for that persona so the user can confirm before
we lock the expected results.

---

## 1. Casual Carla — first-time, minimal

**Who:** Opens the app for the first time, types a task, ticks it, deletes it.
Never touches tags, due dates, repeat or priority. Cares that the obvious path
works and that the app remembers her tasks after she closes the tab.

**How she uses it:** add by typing and pressing Enter; tick the checkbox; press
Delete; reload the page. Leaves everything at defaults (priority Medium, no due,
no tags, repeat None).

**Cares about:** empty-state messages ("No tasks yet…"), that a blank or
spaces-only title does nothing, the default Medium badge, and persistence across
reload.

**Already covered by:** issue-15 TC-03 (default priority Medium), issue-15 TC-01
(add form defaults). Carla's cases are the end-to-end *journey* (add → tick →
delete → reload), not those unit checks.

---

## 2. Organized Omar — power planner

**Who:** Runs his week through the app. Many tasks, many tags, uses every filter
and relies on the sort order.

**How he uses it:** sets priority and due on add; filters by status, tag and
priority together; clicks tag chips; reads the "showing N" counter; types messy
tag strings and expects them cleaned.

**Cares about:** sort order (High→Medium→Low, then soonest-due, undated last,
then newest — `compareTasks` in app.js), combined filters (status AND tag AND
priority — `matches`), the counter text (`N of M left · showing K`), tag
normalization (`TodoDB.normalizeTags`: "Work, work , URGENT," → `work`,
`urgent`), and the tag dropdown resetting to "All tags" when the last task
carrying the filtered tag is deleted (`renderTagOptions`).

**Already covered by:** issue-15 TC-04 (priority filter), TC-05 (filters
combine), TC-06 (sort by priority then due); issue-7 TC-19 (filters with tags),
TC-20 (due badges + sort). Omar's suite is the combined planning journey plus the
tag-normalization and dropdown-reset specifics that no single existing case walks
end to end.

---

## 3. Routine Rita — recurring tasks

**Who:** Lives on repeating chores (daily, weekly, monthly). Ticks them off and
expects the next copy to appear; occasionally stops a series or reopens one by
mistake.

**How she uses it:** adds daily/weekly/monthly tasks; completes them to spawn the
next; relies on missed-occurrence skipping and monthly month-end clamping; uses
Stop repeating; unticks to undo.

**Cares about:** next copy on completion (`setDone` spawn), missed occurrences
skipped so the next due is on/after today (`Recurrence.nextDue`), monthly
clamping (Jan 31 → Feb 28 → Mar 31), a repeat with no due starting today, Stop
repeating setting `repeat:"none"`, and reopening semantics (untouched copy
removed; edited/moved-on copy kept and the reopened task becomes a one-off).

**Already covered by:** issue-7 TC-02–TC-05 (spawn daily/weekly/monthly), TC-07
(stop), TC-10 (no-due starts today), TC-11/TC-12 (month-end, leap), TC-13 (missed
skipped), TC-14 (undo removes untouched copy), TC-33 (reopened past occurrence →
one-off); issue-15 TC-26 (edited copy survives undo). Rita's suite is one
continuous recurring-chore journey across these, not the isolated units.

---

## 4. Procrastinating Pete — overdue + edits

**Who:** Behind on everything. Lots of overdue tasks; edits them constantly to
push dates and fix typos.

**How he uses it:** reads Overdue / Due today badges (`dueBadge`); opens inline
edit; changes title/due/repeat/priority; hits the 200-char title limit; leaves a
half-typed date; tries to Cancel mid-save.

**Cares about:** the overdue (red) and due-today badges, inline-edit validation
(200-char title via `checkTitle`, half-typed date blocked via
`due.validity.badInput`, Cancel disabled during a save via `savingIds`), and that
editing due/repeat resets the monthly anchor (`next.anchorDay = R.dayOf(next.due)`).

**Already covered by:** issue-15 TC-08 (edit every field), TC-11 (blank-title
validation), TC-21 (edit due resets anchor), TC-28 (200-char title rule), TC-31
(no cancel during save), TC-32 (half-typed date); issue-7 TC-20 (due badges).
Pete's suite is the "I'm behind, let me reschedule" journey tying these together.

---

## 5. Chaotic Chris — error-prone, multi-tab

**Who:** Clicks fast, opens the app in two tabs, completes a task in one and then
acts on it in the other. Generates the "completed or deleted meanwhile" and
cross-tab database conditions.

**How he uses it:** double-submits; edits a task that was just completed/deleted
elsewhere; keeps an old tab open during an upgrade (onblocked); triggers
onversionchange by deleting/upgrading the DB from another context.

**Cares about:** one save at a time (`savingIds`, `adding`), the
"completed or deleted" error that closes the edit form and shows `#error`
(`role=alert`), the onblocked message ("Close other tabs…") and onversionchange
reconnection, and that storage failures surface in `#error`.

**Already covered by:** issue-15 TC-19 (one edit at a time), TC-27/TC-33
(completed/deleted meanwhile), TC-30 (one save at a time), TC-35 (slow save
doesn't block another); issue-7 TC-15 (no duplicate copies), TC-34 (works after
DB upgraded/deleted elsewhere), TC-35 (storage errors visible), TC-40 (no
duplicate add on double submit). Chris's suite is the two-tab / fast-fingers
journey.

---

## 6. Accessibility Ana — keyboard + screen reader

**Who:** Navigates by keyboard and a screen reader. Needs accessible names, a
sensible focus order, announced errors, and readable contrast in both themes.

**How she uses it:** tabs through the add form and the inline edit form; relies on
`aria-label` on checkbox, Edit, Delete, Stop repeating and tag chips; expects
`role=alert` boxes (`#error`, `.edit-error`) to be announced; reads in light and
dark themes.

**Cares about:** focus order through the inline edit form (title → due → repeat →
priority → tags → Save → Cancel, per the DOM order in `editItem`), the title
field auto-focused when the form opens (`focusEdit`), accessible names on every
control, `role=alert` announcements, and contrast ratios.

**Grounding / contrast facts** (computed from `styles.css`; WCAG AA needs 4.5:1
for normal text, 3:1 for large text and UI components):
- Body text on background passes comfortably in both themes (~14.7:1).
- Muted text on card/bg passes in both (light ~4.8:1, dark ~6.2:1).
- **Button label (white on `--accent`) is 5.17:1 in light but only ~3.23:1 in
  dark** — below AA for normal text, though it clears the 3:1 bar for large text
  / UI components. This is a real finding; Ana's contrast case records it.
- Overdue/today/priority/chip pill text all clear ~4.4:1+ in both themes.

**Already covered by:** nothing in the existing suites tests accessibility; this
is new coverage. (Existing suites assert `textContent` safety, not a11y.)

---

## 7. Malicious Mallory — input-level security tester

**Who:** Pastes XSS payloads into every field and tampers with stored records,
checking that nothing executes and bad data is coerced.

**How she uses it:** titles/tags like `<script>`, `<img onerror>`; stored records
with bad `repeat`, dates, ids, `anchorDay`, priority; calls `TodoLog.log` with
`{actor:"user"}` but no token.

**Cares about:** rendering via `textContent` / `new Option(text)` only (no XSS);
`TodoDB.clean` coercing every field on read; attribution — only the private token
makes an entry `user`, so a forged `{actor:"user"}` is logged `api`.

**Already covered by:** issue-7 TC-21 (HTML as text), TC-22 (tampered repeat),
TC-23 (tampered due), TC-36 (tampered tags), TC-29/TC-42 (tampered
anchor/numeric); issue-14 TC-18 (no user text), TC-19 (panel text-only),
TC-29/TC-33 (scripts can't pose as user); issue-15 TC-18 (tampered priority),
TC-23 (HTML in edited title). Mallory is well-covered already; her suite is a
short confirmation journey across inputs, and the deeper attacks move to **Hank**.

---

## 8. Privacy Priya — privacy auditor

**Who:** Audits the activity log and export to confirm no task content leaks.

**How she uses it:** performs actions with sensitive titles/tags, then reads the
log panel and the JSONL export; sets and clears the tag filter; exports and clears
the log.

**Cares about:** no titles or tag text in any entry (db.js logs counts/kinds
only), the tag filter logged as `set`/`cleared` only, and export
(`exportJSONL`) + clear (`log.clear`) working.

**Already covered by:** issue-14 TC-18 (no user text), TC-08 (filter logged
without tag text), TC-10 (export JSONL), TC-11 (clear logs itself); issue-15
TC-15 (edits logged without user text). Priya's suite is an end-to-end audit:
act with secrets → export → grep the export → clear.

---

## 9. Bot Bob — automation / AI agent

**Who:** Drives the app programmatically (an AI using the browser, or a script
calling `TodoDB`/`TodoLog` directly). Cares about correct attribution and the
eval.

**How he uses it:** calls `TodoDB.add`/`update`/`setDone` directly (logged `api`);
drives page buttons under automation (`navigator.webdriver` → `automated:true`,
still `user` via the page token); relies on `add` falling back to defaults while
`update` rejects bad values; writes many log entries.

**Cares about:** actor attribution (user vs api, `automated:true`), add-corrects
vs update-rejects asymmetry, eval expectations (`task.add@user`, `:error`), and
the 1,000-entry cap (`MAX_ENTRIES`, `addAndTrim`).

**Already covered by:** issue-14 TC-06/TC-07 (api vs user, automated), TC-14
(1,000 cap), TC-29/TC-33 (forged user rejected); issue-15 TC-16 (api edit), TC-22
(update rejects). Bob's suite is the automation journey and an explicit eval-syntax
walkthrough.

---

## 10. Legacy Larry — upgrading from an old version

**Who:** Has data from v1/v2/v3 of the app and opens the current v4. Must lose
nothing.

**How he uses it:** opens the app against an older database; expects
`onupgradeneeded` to backfill new fields (`due`, `tags`, `repeat`, `anchorDay`,
`nextId`, `spawnedFrom`, and v4 `priority:"medium"`); keeps an older tab open.

**Cares about:** migration keeping every record, old records getting default
priority Medium, and the app still opening when an older tab holds the connection
(onblocked path).

**Already covered by:** issue-7 TC-18 (v2→v3 migration); issue-15 TC-17 (v3→v4,
default priority). Larry's suite walks a v1-seeded database all the way to v4 in
one journey and checks the older-tab-open case.

**Grounding:** "app still opens with an older tab open" — the code's actual
behavior is that an older tab holding an older version causes `onblocked`, and the
app shows the "being upgraded… close other tabs" message rather than silently
opening. Larry's case asserts that **safe, explained** behavior, not a silent
success.

---

## 11. Volume Vera — load / performance

**Who:** Power user (or import) with hundreds-to-thousands of tasks and many
tags. Cares the UI stays responsive.

**How she uses it:** seeds large datasets; measures first render, filter change
latency, tag-dropdown build; drives the log past 1,000 entries.

**Cares about:** render speed at scale, filter responsiveness, tag dropdown size,
and log rollover at 1,000.

**Grounding / threshold note:** the app has **no virtualization** — `render()`
rebuilds the whole `<ul>` via `replaceChildren` on every change, and
`renderTagOptions` rebuilds the whole dropdown. So large N is a genuine stress.
Thresholds in `test-cases.md` are chosen as *reasonable headless-Chrome budgets*
(stated as such), not guarantees the code was tuned for; some may surface as
findings. The activity panel only ever reads the newest 50 rows + a count, so it
should stay cheap even near the cap.

**Already covered by:** nothing — performance is new coverage.

---

## 12. Hostile Hank — attacker / hacker (NEW)

**Who:** An active adversary with code running in the page (devtools, a malicious
bookmarklet/extension, a second tab) who tries to break or take over the app, its
data and its "APIs" beyond mere bad input.

**How he attacks:** forges `user` log entries without the private token (replay,
guessing, monkey-patching `TodoLog.claimUserToken`/globals before or after load);
wipes or floods the log to hide tracks; writes crafted records straight into
IndexedDB (`__proto__`/`constructor` keys, wrong types, huge strings/arrays,
dangling/negative `nextId`/`spawnedFrom`); calls `TodoDB`/`TodoLog` with hostile
arguments (objects with getters, Symbols, prototype-polluting payloads, non-string
titles); XSS via every input and via stored data rendered as text/attributes/
classes; CSV/formula and JSONL injection in the export; DB version
downgrade/upgrade from another tab; resource exhaustion; and a two-tab race to
double-spawn a recurring series.

**Cares about (from our side):** that each attack ends in **safe** behavior — no
script execution, no prototype pollution, no silent privilege escalation to
`user`, the app stays usable, and tamper evidence (the `log.clear` entry) is not
trivially erasable without trace.

**Scope:** only this app, in a throwaway headless-browser profile. No network
targets, nothing outside the test browser.

**Grounding:** this is a **client-side, best-effort** log by design (see
logger.js comment and CLAUDE.md: "not tamper-proof against code running in the
page"). Several Hank cases therefore describe defenses the app may **not**
currently have; those are marked **"Risk:"** in the requirement so the user sees
them as expected findings, not as claims the app already passes.

**Already covered by (partially):** issue-7 TC-21/22/23/36/29/42 and issue-14
TC-19/29/33 and issue-15 TC-18/22/23 cover the *input-level* half. Hank extends
into attacks those unit cases don't reach (token forgery via monkey-patching, log
flooding/erasure, prototype-pollution keys, export injection, cross-tab races).
