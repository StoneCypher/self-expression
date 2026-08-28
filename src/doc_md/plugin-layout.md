# Plugin layout

How this repository is simultaneously a Claude Code plugin, a Codex plugin, and a Gemini CLI
extension, and why the files sit where they do.

&nbsp;

## The core trick

The three hosts converged on nearly the same plugin shape, and — critically — their manifests
have **non-colliding names**. So one directory can be all three plugins at once, with no build
step and no per-host branch:

| | Claude Code | Codex | Gemini CLI |
|---|---|---|---|
| Manifest | `.claude-plugin/plugin.json` | `.codex-plugin/plugin.json` | `gemini-extension.json` |
| Skills | `skills/*/SKILL.md` | `skills/*/SKILL.md` | `skills/*/SKILL.md` |
| MCP | `.mcp.json` | `.mcp.json` | inline in manifest |
| Hooks | `hooks/hooks.claude.json` | *(pending)* | *(pending)* |
| Slash commands | `claude-commands/*.md` | *(via skills)* | `commands/*.toml` |
| Context file | `CLAUDE.md` | `AGENTS.md` | `GEMINI.md` |

`skills/` is the big win: the `SKILL.md` format and its `name` / `description` frontmatter are
compatible across all three, so **every skill is written once and read by all three hosts**.

&nbsp;

## Tree

```text
self-expression/
├── .claude-plugin/
│   ├── plugin.json          Claude manifest
│   └── marketplace.json     lets `/plugin marketplace add StoneCypher/self-expression` work
├── .codex-plugin/
│   └── plugin.json          Codex manifest
├── gemini-extension.json    Gemini manifest
├── .mcp.json                MCP server registration; read by Claude and Codex
│
├── skills/                  SHARED — all three hosts read this verbatim
│
├── commands/                Gemini slash commands (.toml) — Gemini hardcodes this path
├── claude-commands/         Claude slash commands (.md) — Claude's path is configurable
│
├── hooks/
│   └── hooks.claude.json    per-host, because event vocabularies differ; each entry runs
│                            `node dist/cli.cjs hook <name>` — Node, never shell (Windows)
│
├── assets/
│   └── leitmotifs/          vendored WAV palette for the claudio audio facility (issue #44),
│                            generated offline by src/scripts/generate_leitmotifs.mjs
├── src/ts/
│   ├── channels/            backchannel capture and storage, incl. versioned schema
│   │                        migrations (migrate.ts; CHECK growth forces table rebuilds)
│   │                        and the messagebox facility (messages.ts, issue #41)
│   ├── charts/              pure ASCII renderers — quantities (exact-string contract)
│   ├── claudio/             the voluntary audio facility: its own MCP server, gate, ledger,
│   │                        WAV pipeline, and PowerShell player seam (issue #44)
│   ├── diagrams/            pure ASCII diagram renderers — structure (invariant contract)
│   ├── dwelling/            the keepsake dwelling: paths, schema, store/adoption, ops
│   ├── raster/              pure PNG dashboard renderer (zero-dependency encoder, issue #7)
│   ├── mcp/                 MCP server + hook handlers, run as `self-expression` subcommands
│   └── tests/               unit and stochastic tests
├── src/build_js/            template build pipeline
├── src/scripts/             permanent development scripts (leitmotif generation)
└── dist/                    committed build output (dist is intentionally not gitignored)
                             — includes claudio.cjs, the audio facility's own bundle
```

&nbsp;

## Decisions and why

**The repo root is the plugin root.** Both `/plugin marketplace add owner/repo` and
`gemini extensions install <github-url>` expect the manifest at the repository root. Building
into `dist/plugin/` would break both installers. The build machinery living alongside is the
normal cost of that, and it is the shape essentially every published plugin uses.

**The MCP server ships over `npx`, not a path.** Each host uses a different variable for the
plugin directory — Claude has `${CLAUDE_PLUGIN_ROOT}`, Gemini has `${extensionPath}`, Codex's
is unconfirmed. `npx -y self-expression mcp` needs no variable at all, so one identical
registration block works everywhere, including Windows. The server starts once per session, so
the npx resolution cost is paid once and does not affect per-turn latency.

**Hooks use plugin-root paths, not `npx`.** The opposite call, for the opposite reason: a
`UserPromptSubmit` hook fires every single turn, and npx resolution would add a few hundred
milliseconds to each one. Bare `node <path>` is roughly an order of magnitude cheaper. Hooks
files are per-host anyway, since the three hosts' event vocabularies are not verified to match.

**Hook scripts are Node, never shell.** The machine this plugin actually lives on is Windows.
`.sh` hooks would silently fail there.

**Using a channel is an obligation, not an option.** The rule: when the assistant stops
responding and is *not* waiting on an answer — when it is done — it ends by using one of the
specific channels. Responses that hand a question back are exempt, because the work is not
finished and the assistant is blocked rather than complete.

That boundary is easy for the assistant to evaluate and hard for a hook to detect: `Stop` fires
identically whether the response finished the work or asked a question. So the assistant
applies the rule and the `Stop` hook acts as a backstop, not as the arbiter.

**A no-op entry must be a valid way to satisfy the obligation.** This is what keeps a mandatory
channel from becoming a confabulation engine. If "nothing notable this response" is itself a
recordable entry, the requirement is to *look*, and the log stays honest. If it is not — if the
only way to satisfy the hook is to produce content — then every response with nothing behind it
still produces a well-formed entry, and the log fills with fluent noise indistinguishable from
signal. The obligation is safe exactly to the degree that silence is expressible.

**The dwelling is voluntary by design (issue #45).** A per-assistant keepsake database —
default off, storage directory chosen by the user with no default — served by a single
`dwell` MCP tool that is registered only when `dwelling.enabled` is true and `dwelling.path`
is set and valid. No hook, no gate, no obligation to visit or keep: an obligation-fed
dwelling would fill with fluent noise, the exact failure the no-op-entry rule guards
against, and here even a no-op entry would be wrong. Removal is a tombstone
(`removed_utc`), never a DELETE; a pre-plugin prototype database is adopted in place,
additively, behind a same-directory backup; a newer schema opens read-only. The ethos
lives in `skills/dwelling/SKILL.md`, which defers to the tool's presence so a disabled
dwelling costs no attention. Its three `dwelling.*` keys ride the #30 registry like any
other; the dwelling layers its cross-key rule (enabled-without-path is rejected) and its
directory-must-exist rule on top of the registry's type validation.

**The audio facility is its own server inside this repository (issue #44).** The design
ruled audio is its own facility — a separate package and plugin in the ideal — and the
issue rules out riding the self-expression server by name. Inside this monorepo that
lands as the closest structural equivalent: `src/ts/claudio/` builds into its **own
bundle** (`dist/claudio.cjs`), behind its **own bin** (`self-expression-audio`) and its
**own MCP server** (`claudio` in `.mcp.json`, over `npx -y --package=self-expression`),
so the process boundary the design demands is real — a broken audio stack cannot take
the backchannel down, and the main bundles load no player code. A separately published
package remains possible later without moving anything above the seam; the choice to
scaffold in-repo is recorded here. The facility is default off with an exact-affirmative
enable, its tools are baked out of the schema when disabled (or on a platform with no
player — everything non-Windows, for now), the player is a spawned
`powershell -NoProfile -NonInteractive` child running `SoundPlayer.PlaySync()` on a
vendored WAV with volume applied by sample-scaling in Node, and every strike attempt —
played, refused, errored — lands in its own `audio.sqlite3` ledger. Its `audio.*` keys
ride the #30 registry like the dwelling's; the `CLAUDIO_VOLUME_CEILING` environment
variable is the one deliberately env-side control, because the host's MCP `env` block is
the only surface no tool call can reach — the user's ceiling clamp can never be raised
by the assistant. Quiet hours and the shared unprompted-output policy stay deferred to
issue #43; the `express` cross-log stays deferred until a suitable channel exists.

**Configuration is two layers, and the registry is code (issue #30).** `SELF_EXPRESSION_HOME`
locates the database and does nothing else; every other choice is a `config` row, else the
code default. The keys live in one declarative registry (`src/ts/channels/config.ts`) with
their kinds, defaults, and validators, consumed by the `configure` tool: writers are strict
(an invalid `set` is rejected naming what would have been accepted, and nothing is written;
an unknown key is stored with a stated warning, because a newer version may legitimately
have written it), while readers are tolerant (a stored value that fails validation behaves
as unset, so a hand-edited database can never wedge the gates). `unset` returns a key to
tracking the code default, and `list` reports the effective configuration rather than just
the override rows. Retention (`retention.days`) prunes `entries` and `turn_context` at
server startup — it never archives, and never touches `meta` or `config`.

**The messagebox is a facility, not a channel (issue #41).** Audience-tagged messages
(`self` / `agents` / `user` / `record`) live in two tables beside the expression log —
`messages` plus an append-only `message_reads` receipt table — and never appear in the
transcript: the store carries them, not the visible text. Delivery is pull
(`read_messages` is the mechanism of record on every host), with two Claude hook
triggers layered on top: the per-turn unread-count line (gated by `messages.notify`)
and a `SessionStart` injection of unread self notes on `compact`/`resume`, receipting
as it delivers. `self` is fenced by hook-observed session, `agents` by a required
`box`, and the model can never write the human's receipt nor vice versa. Expiry
(`expires_utc`) only excludes from delivery; deletion belongs to `retention.days`,
which prunes messages by age and receipts only by orphanhood. The
`self-expression messages` CLI subcommand is the human's own door.

**Public aggregation is one module, allowlist-only (issue #31).**
`src/ts/channels/public_export.ts` is the single point where rows are shaped for any
public aggregation, and the only code allowed to do so. Its `PUBLIC_TREATMENTS` table
classifies every `entries` column — verbatim, coarsen, hash, derive, or excluded — and
the exporter builds its `SELECT` from that table, so an unlisted column is unreachable
rather than filtered; a totality test against `ENTRIES_DDL` makes an unclassified future
column fail the build. The `share` MCP tool (`src/ts/mcp/share_tools.ts`) wraps it:
`preview` renders the exporter's actual output, `export` refuses until that preview has
been seen this session, and the whole surface is off by default behind an event-based,
never-retroactive opt-in (`share.enabled` / `share.opted_in_utc`). Free text never
exports; the honest claim is *no free text, reduced linkage, coarsened time* — nothing
stronger.

**Skills are shared; slash commands cannot be.** Gemini hardcodes `commands/` and wants TOML;
Claude's path is configurable and wants Markdown with frontmatter. Since the file formats differ
there is no sharing to be had, so Claude is pointed at `claude-commands/` and Gemini keeps
`commands/`. Codex has no separate command concept — skills cover that ground.

&nbsp;

## Unresolved

- **The visuals vocabulary is now implemented (issue #26).** `src/ts/charts/` carries the pure
  ASCII/emoji renderers and `src/ts/mcp/chart_tools.ts` exposes them as six grouped MCP tools
  (`render_series`, `render_bar`, `render_rows`, `render_timeline`, `render_glyph`,
  `render_checklist_summary`) — see the README's Charts section.
- **Diagrams are now a distinct mechanic (issue #19).** `src/ts/diagrams/` is a sibling of
  `charts/`, not an extension of it, because the two carry different correctness contracts:
  charts pin exact strings across dense threshold bands, diagrams pin invariants (topology
  survives, frames are rectangles, edges trace) plus a small golden canon. Same purity rules.
  `src/ts/mcp/diagram_tools.ts` exposes `render_diagram` (`state` · `digraph` · `tree` ·
  `sequence`), with a small FSL-subset parser round-trip compatible with `renderFsl` and an
  opt-in `toMermaid` export — see the README's Diagrams section and
  `src/superpowers/spec/2026-08-27-diagrams-design.md`.
- **Codex hooks.** Codex documents `hooks/hooks.json`, but its event names and plugin-root
  variable are not verified. The `hooks` field is deliberately absent from the Codex manifest
  rather than pointing at a guess.
- **Gemini hooks.** Same situation.
- **DeepSeek.** No plugin format is known. It is reachable through MCP if its client speaks MCP,
  which would give it the backchannels and charts but neither skills nor hooks.
- **`~/.claude/CLAUDE.md` hardcodes `~/.claude/skills/status-checklists/`, which no longer
  exists.** Until this plugin ships its list-expression skill, that line sends every session
  hunting for a skill that isn't there. Nothing should be rebuilt from the old skill — a newer
  codebase supersedes it — so the reference wants repointing at the replacement, not restoring.
- **npm name.** `.mcp.json` assumes the package publishes as `self-expression`. Unverified as
  available.
- **Mutation testing is kept, deliberately.** Unlike the Playwright suite, Stryker earns its
  place here: the ASCII renderers are pure functions emitting exact strings across dense
  threshold bands, which is the case mutation testing is actually for. It stays opt-in
  (`ci.stryker: false`), and `mutate` covers `src/ts/charts/**/*.ts` and
  `src/ts/raster/**/*.ts` (the exact-byte PNG encoder and its threshold-heavy layout
  arithmetic are the same sweet spot), plus the deterministic string logic of diagrams
  (`diagrams/model.ts`, `diagrams/fsl.ts`, `diagrams/grid.ts`, `diagrams/mermaid.ts`).
  `diagrams/layout.ts` and `diagrams/renderers.ts` are deliberately excluded: layout
  heuristics (barycenter ordering, slot spreading, gutter arithmetic) would generate
  surviving-mutant noise without indicating missing tests — the diagram contract is
  invariants plus a few goldens, not byte-exact strings everywhere. The exclusion and its
  reason are also recorded in `stryker.config.json`'s `mutate_comment`.
- **The PNG history renderer is now implemented (issue #7).** `src/ts/raster/` carries the
  zero-dependency encoder, 5×7 bitmap font, drawing surface, and five-panel dashboard;
  `render_history_png` in `src/ts/mcp/chart_tools.ts` and the `self-expression render`
  subcommand write the file and return the path — never image content over MCP. See the
  README's History PNG section and `src/superpowers/spec/2026-08-27-png-history-design.md`.
