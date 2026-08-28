---
name: status-checklists
description: Use when reporting the state or progress of multiple work items at once — parallel tasks, batch jobs, build steps, multi-agent dispatches, a multi-part operation, or a project plan; any moment you are about to present a list of items with mixed done, running, failed, blocked, or pending states.
---

# Status Checklists

## Overview

When reporting the state of multiple work items, render it as a **status checklist**: a fenced code block of one-line items, each led by a single emoji marker, closed by a standardized summary line. This is an explicit opt-in to emoji for status reporting only — never for prose, code, comments, or files.

`example.md` in this directory is a complete worked checklist exercising every feature. Read it to see the convention assembled, and reuse it when you need to show an example rather than inventing a fresh one.

## When to Use

Use the moment you are about to present the state of multiple items: parallel tasks, batch jobs, build steps, a multi-agent dispatch, a multi-part operation, or a project plan — anything with mixed done / running / failed / blocked / pending states.

Do NOT use for a single task, for prose explanation, or for anything that is not a multi-item status report.

## Format

- A short **bold title line** above the list. It may optionally state scope or definition-of-done in parentheses so the percent is unambiguous — `**Virginia city research (133 cities)**` — used only when "100% of what?" would otherwise be unclear. When the checklist tracks a running operation, place one mood face inside the bold title immediately before the em dash that separates the title's name from its description (or at the end if there is no em dash), chosen from the expressive faces (🤔 😴 🫨 🧐 🤮 🤬 🤡 😕 🤥 🥵 😎 🤓 🤕) to capture the run's overall state; and follow the bold title with run timing in parentheses, e.g. `(started 14:02, running 1h47m)`. Leave a blank line between the title and the list.
- The bold title sits just above the fence (so its `**bold**` renders). Everything else — every list item and all the bottom matter (lead line, summary line, icon block, timeline) — goes inside **one fenced code block**. Never use a rendered markdown list, never split across multiple code blocks, never leave the lead line outside the block. Whitespace must be literal; a rendered list lets the renderer redraw nesting depth so indentation drifts.
- Each item is `- <marker> <text>`. Nest at most **two levels deep**; indentation is absolute by level — 0 / 2 / 4 leading spaces (a sub-sub-item is always exactly 4, never 6).
- Keep item text **terse — one line**. Never a prose paragraph per item.
- Leave completed items in natural / pipeline order — **do not bunch them at the top**.
- After the list and one blank line: an optional **lead line**, then a blank line, then the **summary line** as the last row. With no lead line, a single blank line separates the list from the summary. All bottom matter — lead line, summary line, icon block, timeline — sits flush at column 0, never indented, however deeply the list is nested.

## A complete example

**Release build — pipeline (6 steps)**
```text
- ✅ Install dependencies
- ✅ Lint and type-check
- ✅ Compile bundle
- 💯 Unit test suite
- ❌ Sign artifacts
- 🔜 Deploy

4/1/1 items (67%) ██████▓░░░  ✅ 3  💯 1  🔜 1  ❌ 1
```

The bold title sits above the fence so its bold renders; the list and the summary line go *inside* one fenced code block. The count `4/1/1` partitions all 6 items: success 4 = three ✅ + one 💯; active+pending 1 = one 🔜; failure 1 = one ❌. 💯 always counts as **success**, never failure.

## Markers

Every item carries **exactly one** marker emoji (one exception: ship-to-targets, below). Choose the single most specific marker. The full vocabulary — 22 status markers plus ~15 groups of topic/action markers — is in **`markers.md`**; consult it to pick markers.

The marker changes as the item progresses:
- **Done → ✅**, with three exceptions — 🛳️ (deploying), 🐛 (a recorded defect), 🏁 (finishing a major goal) — which keep their own marker even when complete.
- **Passed perfectly → 💯.** A test, audit, or verification that completes with a flawless pass becomes 💯 instead of ✅ — a graphic distinction only; 💯 counts as success exactly like ✅. Any caveat → plain ✅.
- **Failed → ❌.** Skipped stays ⏭️, blocked stays 🚫, paused stays ⏸️.
- **Unstarted or underway → the single most specific marker.** Topic/action markers take precedence over status markers — a build in progress is 🔨, not a generic running marker. Fall back to 🔜/🤖/⏳/🌐 only when no topic/action marker fits.

**Ship-to-targets exception:** a 🛳️ deploy item whose destinations are known may be written `🛳️ to <targets>`, where `<targets>` is a short run of destination emoji (💻 📱 🌐 ☁️ ⌚ 📺 🥽 🧩 🏪 🐳 📦 💿 📡 🚗 🏢 🐧🪟🍎🤖 …). This is the only case an item carries more than one emoji.

## The summary line

The last row: `<count-section> items (<P>%) <progress-bar>  <trend sparkline?>  <per-marker counts>`

- **Count section** — three numbers `<success>/<active+pending>/<failure>` that partition every item and always sum to the total. Show all three (a zero is fine: `12/8/0`).
  - **success** (1st) = ✅ · 💯 · 🏁 · 👍 · 😎 · ⚠️ (the work landed; the caveat stays visible in the icon list) · and any 🛳️ whose deploy has completed.
  - **failure** (3rd) = ❌ · 🚫 · 🦗 · 💀 · 🧟 · 🦹 · 🌋 · 🤬 · 🤡 · 😕 · 🤌 · 🤥 · 🥵 · 😴 · 🫨 · 🌗.
  - **active+pending** (2nd) = every other item — running markers 🤖/⏳/🌐, 🔜, 🛰️, 🛠️, ⏸️, ⏭️, ❗, ⏰, 🧠, ❓, 🤔, 🌪️, 🧊, 👻, an in-progress 🛳️, and every topic/action marker not in the other two buckets.
- **`<P>`** = round(100 × success / total), integer, no space before `%`.
- **Progress bar** — a 10-cell bar right after the percent, no brackets, anti-aliased at the boundary cell. Fill = P/10 cells: that many full `█`, then the boundary cell's fraction `f` maps to the nearest of {0, ⅓, ⅔, 1} — `f`<0.17→`░`, 0.17–0.5→`▒`, 0.5–0.83→`▓`, ≥0.83→`█` — remaining cells `░`. E.g. 32% → `███▒░░░░░░`, 67% → `██████▓░░░`, 100% → `██████████`.
- **Count every item at every nesting level.**
- **Per-marker counts (the icon list)** — only nonzero markers, each `emoji count` entry separated by two spaces. Within every line, **sort by count, highest first** — count is the primary key, so a lower-count marker never precedes a higher-count one. Only markers with the *same* count are ordered among themselves, by their position in `markers.md` (status markers in listed order, then topic/action markers group by group; for this tiebreak only, 💯 ranks just after ✅). If the icon list has **8 or fewer** distinct markers, keep it inline, two spaces after the bar. If **9 or more**, move it to its own block below the bar (blank line between), split onto three lines by bucket — success, then active+pending, then failure, one line each, omitting an empty bucket. Put at most **12 entries on a bucket line**; the 13th and beyond wrap to a new line. If any bucket line wrapped, separate all three bucket lines with a blank line.
- **Trend sparkline** is optional — see `visuals.md`.

Example — the icon list has 11 distinct markers, more than 8, so it drops to its own block and splits into three bucket lines; no line exceeds 12 entries, so no blank lines between them:

```text
8/13/4 items (32%) ███▒░░░░░░

✅ 8
🤖 4  ⏳ 2  🔜 2  ❗ 2  🌐 1  🛠️ 1  🤔 1
🌗 2  ❌ 1  🚫 1
```

## Lead line

Optional: a single human sentence on its own line, set off by a blank line above and below, stating the one thing that matters right now — the blocker, the failure to triage, or that all is clear. Lead it with the emoji of the most salient item (the ❌/❗/🚫/🦗 needing attention; ✅ if nothing does). Omit it when the checklist is short or uneventful and the numbers already tell the story — it exists to surface a headline, not to restate the obvious.

## Optional visuals and timelines

A checklist may also carry a trend sparkline, a process timeline (two-line monochrome or one-line colored, in the bottom matter or attached to an item), and inline micro-visualizations — bullet graphs, diverging bars, dependency chains, win/loss strips, retry health bars, weather health glyphs, and more. All are documented in **`visuals.md`**. Use any only where the data genuinely supports it, never as decoration.

## Re-rendering a checklist

When showing the same checklist again later, the reader diffs the renders by eye — preserve item identity:

- Keep item order and wording stable; a marker advances in place (🔜 → 🔨 → ✅). Lines do not move or rephrase between renders.
- Insert newly discovered items at their natural pipeline position, not appended at the end.
- Never drop completed or failed items mid-run; they are the history. (A checklist restarted for a genuinely new run may start fresh.)
- Each render is a snapshot: log it (see Tooling), and once two or more snapshots of the same title exist, the summary line may carry the trend sparkline built from the logged percent series.

## Tooling

Two companion scripts live in this skill directory. Invoke each as a single-line command with `--file` — heredoc/stdin invocations defeat permission prefix rules.

- **Validation** — for any checklist with nesting, 9+ markers, or nontrivial summary math, verify before posting:
  `node C:/Users/john/.claude/skills/status-checklists/check-checklist.mjs --file <path-to-block-or-md>`
  It re-derives the counts, percent, bar, and icon lists from the items themselves (vocabulary and buckets read live from markers.md) and reports each check as ok/FAIL, exiting 1 on any FAIL.
- **Logging** — after posting a checklist, log the render: write `{"title":"...","project":"...","session":"...","block":"<fenced-block content>"}` to `<scratchpad>/checklist-payload.json`, then
  `node C:/Users/john/.claude/skills/status-checklists/log-checklist.mjs --file <that path>`
  History ops: `{"op":"series","title":"..."}` prints the percent series for building the trend sparkline (add `"project"` to disambiguate colliding titles); `{"op":"tail","n":10}` recent rows; `{"op":"stats"}` size check. The title is the series key — keep it stable across re-renders or the series splits.

## Common Mistakes

| Mistake | Fix |
|---|---|
| Bunching all completed items at the top | Leave them in pipeline order |
| Words/caps ("FAILED", "DONE") instead of markers | Every item leads with one emoji marker |
| Counts in prose ("11 of 30 done") | Counts go only in the standardized summary line |
| A prose paragraph per item | One terse line per item |
| A rendered markdown list, not a fenced block | Always a fenced code block — literal whitespace |
| Two emoji on an item | One marker per item; only `🛳️ to <targets>` is exempt |
| Sub-sub-item indented 6 spaces | Levels are absolute: 0 / 2 / 4 |
| Count section that doesn't sum to the total | The three numbers partition every item at every nesting level |
