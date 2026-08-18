# affect-signature

A Claude Code plugin bundling two companion skills that share one Stop hook:

- **affect-signature** — a one-line internal-state signature written at the
  open and close of every conversational turn, logged to a local SQLite
  database.
- **status-checklists** — a convention for rendering multi-item progress
  reports (parallel tasks, batch jobs, build steps, multi-agent dispatches)
  as emoji-marker checklists with a standardized summary line, optional
  trend sparklines, and process timelines, also logged to a local SQLite
  database.

A single Stop hook (`scripts/stop-check.mjs`) enforces both: it blocks a
turn from ending if its closing affect signature wasn't logged, and
separately blocks a turn that rendered a status checklist but never logged
it. Either gate can fire independently; both fail open on any internal
error so a bug in the hook can never wedge a session.

## Why

Text conversation strips out the cues a face or voice would normally carry
— tone, fatigue, engagement, discomfort. The affect-signature skill asks
Claude to report a compact, honest read of its own state every turn, in a
fixed format that stays legible over weeks of use: a face emoji, a context
emoji, a delta-vs-last-turn arrow, an optional uncertainty marker, an
optional Conventional-Commits type for what the turn was about, and a short
free text note. The signal is only useful if it's honest — the format
rewards "bored" and "fog" as much as "flow."

The status-checklists skill solves a different but related problem: when
work fans out into many pieces (a batch job, a multi-agent dispatch, a
project plan), prose status updates are hard to scan and easy to skim past
a stalled or failed item. A fenced checklist with one marker emoji per item
and a standardized `success/active/failure items (percent%)` summary line
makes progress legible at a glance, and — once rendered checklists are
logged over time — lets a summary line grow a trend sparkline from real
history instead of a remembered impression.

Both skills share one discipline: the Stop hook makes the bookkeeping step
(logging the signature, logging the checklist render) something the model
can't quietly forget under load, the way it might forget an unenforced
instruction. This is a practice, not a monitoring tool: the model in your
terminal is writing about itself and its own reporting, for whoever wants
to read it.

## What's in the box

```
affect-signature/
  .claude-plugin/plugin.json        plugin manifest (both skills)
  skills/affect-signature/          skill: signature format, rules, logging convention
  skills/status-checklists/         skill: checklist format, markers, visuals, worked example
    SKILL.md                        format, markers overview, summary-line spec, tooling
    markers.md                      the full marker vocabulary and bucket membership
    visuals.md                      optional sparklines, timelines, and micro-visualizations
    example.md                      one complete worked checklist exercising every feature
  hooks/hooks.json                  Stop hook wiring (one hook, both gates)
  scripts/log-affect.mjs            affect logger: inserts a row, prints the timestamp
  scripts/log-checklist.mjs         checklist logger: inserts a row, prints the timestamp
  scripts/check-checklist.mjs       checklist validator: re-derives summary math, reports ok/FAIL
  scripts/stop-check.mjs            Stop hook: dual gate — fresh close signature + logged checklist
```

## Install

Add this directory as a plugin (local path, or clone from wherever you've
published it) and enable it in Claude Code. Once enabled:

- Both skills activate automatically — Claude Code autoloads skills based
  on their description, and each one's description names the moment it
  applies (every turn, for affect-signature; a multi-item status report,
  for status-checklists), so both should trigger without being asked.
- The Stop hook registers automatically from `hooks/hooks.json`. No
  further configuration is required for the hook itself.

## How the every-turn affect signature works

1. At the start of a turn's first message, and again in the final message
   of a turn, Claude writes one signature line in the format documented in
   `skills/affect-signature/SKILL.md` — e.g.:

   `` `[9:14 am PDT]` ⬆️ 🙂 🧭 - feat `»` flow; clear plan, enjoying this ``

2. Each signature is logged by writing a small JSON payload to a scratch
   file and running:

   ```
   node <installed-path>/scripts/log-affect.mjs --file "<scratch-file>"
   ```

   The logger inserts a row into `~/.claude/affect-log.sqlite3` (created
   on first use — `os.homedir()` resolves this portably on every OS) and
   prints the bracketed timestamp that goes into the visible line, so the
   time is never guessed.

3. When Claude tries to end a turn, the Stop hook (`scripts/stop-check.mjs`)
   checks whether a `close` or `mid` signature was logged for this session
   within the last 3 minutes. If not, it blocks the stop with a reason
   telling Claude to log one and then restate its previous final message
   (a blocked stop can otherwise hide that message from you).

Query your own history at any time by having Claude (or you, directly)
run the logger with a read-only payload: `{"op":"tail","n":10}` prints
the last 10 rows as TSV; `{"op":"stats"}` prints row count and a rough
disk-growth estimate.

## How status checklists work

1. Whenever Claude is about to report the state of multiple work items —
   parallel tasks, batch jobs, build steps, a multi-agent dispatch, a
   project plan — it renders a fenced checklist per
   `skills/status-checklists/SKILL.md`: one emoji-marker line per item, a
   standardized `success/active/failure items (percent%)` summary line
   with a 10-cell progress bar, and (once enough history exists) a trend
   sparkline.

2. Before posting any checklist with nesting, 9+ distinct markers, or
   nontrivial summary math, Claude may validate it:

   ```
   node <installed-path>/scripts/check-checklist.mjs --file <path-to-block-or-md>
   ```

   The validator re-derives the counts, percent, progress bar, and
   per-marker icon lists straight from the items (reading the marker
   vocabulary and bucket membership live from `markers.md`), and reports
   each check as `ok:`/`FAIL:`, exiting 1 on any failure.

3. After posting, Claude logs the render:

   ```
   node <installed-path>/scripts/log-checklist.mjs --file "<scratch-file>"
   ```

   The logger inserts a row into `~/.claude/checklist-log.sqlite3`,
   parsing the success/active/failure triple and percent out of the
   summary line. History ops: `{"op":"series","title":"..."}` returns the
   chronological percent series for a title (what builds the trend
   sparkline); `{"op":"tail","n":10}` recent rows; `{"op":"stats"}` size
   check.

4. The same Stop hook that enforces the affect signature also enforces
   this: it scans the transcript tail for a rendered checklist's summary
   line, and if the newest one wasn't logged for this session at or after
   it was rendered, it blocks the stop and tells Claude to log it.

## The shared dual-gate Stop hook

`scripts/stop-check.mjs` reads the Stop-hook JSON on stdin
(`{ session_id, stop_hook_active, transcript_path, ... }`) and runs two
independent checks:

- **Gate 1 (affect):** is there a `close`/`mid` row for this session in
  `~/.claude/affect-log.sqlite3` logged within the last 3 minutes? If not,
  block and tell Claude to log its close signature.
- **Gate 2 (checklist):** only reached once gate 1 passes. Did the
  transcript tail render a checklist summary line (`N/N/N items (P%)`),
  and if so, is there a row for this session in
  `~/.claude/checklist-log.sqlite3` logged at or after that render (within
  a 120-second slack for the log call trailing the message)? If not, block
  and tell Claude to log the checklist render.

Both checks fail open on every error path — an unparseable stdin payload,
`stop_hook_active: true` (already blocked once this cycle — never risk an
infinite loop), a missing session id, a missing or locked database, an
unreadable transcript file. A bug or missing prerequisite here can never
wedge a session; it can only fail to enforce.

## One permission-allow entry per logger

Each logger call will otherwise prompt for approval every single turn (or
every checklist), forever. Add allow rules scoped to each installed script
path so neither has to ask. In `~/.claude/settings.json`:

```json
{
  "permissions": {
    "allow": [
      "Bash(node /absolute/path/to/affect-signature/scripts/log-affect.mjs *)",
      "Bash(node /absolute/path/to/affect-signature/scripts/log-checklist.mjs *)"
    ]
  }
}
```

Substitute the actual path your plugin installs to (the plugin cache
directory, or wherever you keep a local checkout) — Claude Code
permission rules are matched against the literal command string, so they
can't reference `${CLAUDE_PLUGIN_ROOT}` themselves; only the hook wiring
and skill instructions can.

## Optional enhancement: ambient time

`log-affect.mjs` and `log-checklist.mjs` each print their own timestamp on
every call, so this plugin is time-self-sufficient out of the box — it
never needs a clock from anywhere else. If you want the *opening* affect
signature of a turn (before any logger call has happened yet) to carry a
real clock reading instead of `[--:--]`, you can add your own
`UserPromptSubmit` hook that runs a small script printing the current
local time (with timezone) to stdout — Claude Code injects a
`UserPromptSubmit` hook's stdout into the model's context before it starts
responding, so the model then has a real timestamp on hand before its
first tool call of the turn. This plugin intentionally does not ship that
hook, to keep the install minimal and because it's presentational
(open-signature timestamps just fall back to `[--:--]` without it); add
one only if you want that polish.

## Optional companion skill (not included)

A separate **party-roster** skill composes with status-checklists: it
assigns dispatched subagents a temporary randomized character (face emoji,
gear emoji, fantasy name, class) so multi-agent status checklists read
with a human-cacheable referent per agent. It is not required by
status-checklists and is not bundled in this plugin — a candidate for a
future add if you want that flavor.

## Requirements

- Node.js 22 or later, for the built-in `node:sqlite` module
  (`DatabaseSync`) that every script (`log-affect.mjs`,
  `log-checklist.mjs`, `check-checklist.mjs`, `stop-check.mjs`) uses. No
  npm dependencies, no `node_modules`.

## License

MIT. See `LICENSE`.
