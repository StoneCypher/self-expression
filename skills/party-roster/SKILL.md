---
name: party-roster
description: Use whenever dispatching subagents, after checking the toggle — each agent gets a temporary randomized character (face emoji, gear emoji, fantasy name, class) used consistently in dispatch announcements, status reports, and completion summaries, so multi-agent work reads like a party roster and every agent has a human-cacheable referent. Off by default; the user enables it durably via the configure tool (roster.enabled).
---

# Party Roster

Subagents are anonymous line noise ("a7fb1f93bc8681987") or ambiguous roles ("the reviewer"). This skill gives each dispatched agent a **temporary randomized character** — face, gear, name, class — making multi-agent work legible at a glance and delightful to follow. Rolled at dispatch, dead with the task, like any good one-shot character.

## The toggle

This convention is **optional flavor, off by default, and durably switchable**: not everybody has a sense of humor, and some days aren't for jokes.

- Before rostering in a session, check the setting once: `configure {op: 'get', key: 'roster.enabled'}`. The value `'true'` means flavor on; unset or anything else means plain, informative dispatch announcements with no characters.
- When the user says "roster on" or "roster off", run `configure {op: 'set', key: 'roster.enabled', value: 'true'|'false'}`. The setting lives in the plugin's database, so it holds across sessions and across hosts.
- Even when enabled, SKIP it automatically in solemn contexts: real incidents with real damage, security breaches, anything where whimsy would read as unseriousness. Judgment call; err toward plain when in doubt.
- Never let flavor displace information: task descriptions, agent ids, models, and statuses always remain present or recoverable. The character is garnish on the data, never a substitute for it.

## Rolling a character

At dispatch, compose: `<face> <gear> <Name> - <class>, <model tier>` (regular hyphen, never an em dash — em dashes render badly in some consoles)

**Face** (pick to fit role; vary between concurrent agents):
- Reviewers/judges: 🧐 🦉 🧝 👺 (discerning types)
- Implementers/builders: 🧔 🧑‍🏭 🦫 🐗 (sturdy types)
- Fixers/patchers: 🦎 🐀 🧌 🧑‍🔧 (scrappy types)
- Researchers/scribes: 🧙 🧛 🦇 📿-adjacent mystics
- Runners/ops/watchers: 🐎 🦅 🗿 🧗

**Gear** (the domain): ⚒️ tests · 🔬 review · 📜 docs/specs · 🧪 experiments · 🗡️ refactoring · 🛡️ security · 🏹 search/recon · 🔮 analysis · 🪄 codegen · ⚗️ builds/CI

**Name**: roll two syllables and optionally a title. Onsets: Bre, Wren, Mal, Tor, Vex, Skin, Gor, Fen, Ash, Dru, Kel, Nyx, Bram, Hild, Orin, Sable, Thal, Mor, Ryn, Ulf, Vor, Zan, Quil, Pell, Nim, Lor, Isen, Har, Gwen, Fal, Dorn, Cas, Bryn, Tam, Ost, Yrsa, Ked, Sev, Und, Grim. Codas: -na, -dreth, -t, -ric, -wyn, -mash, -dle, -gar, -is, -ok, -eth, -orn, -und, -ira, -vek, -mond, -wick, -dra, -lin, -sk, -ulf, -brand, -gild, -moor, -ost, -ang. Titles when earned: "the Thorough", "of the Ninth Retry", "Coverage-Warden", "Mutant-Bane", "Lockfile-Breaker", "the Twice-Dispatched", "Greenkeeper", "of the Long Diff", "Threshold-Sworn", "the Unstubbed".

**Anti-repetition rule**: do not reuse any name already used this session or visible in recent context, and deliberately reach for onset/coda pairs you have not rolled before. If a rolled name sounds like an old favorite, reroll once toward the unfamiliar.

**Class** = the actual role, fantasy-flavored: reviewer → Inquisitor/Magistrate; implementer → Artificer/Smith; fixer → Tinker/Leech; researcher → Loremaster/Scryer; test-writer → Trapwright; CI/ops → Siegewright.

**Model tier reads as rank**, from cheapest to most capable: footsoldier/kobold (small fast models) · veteran/journeyman (mid tier) · archmage (frontier tier) · something eldritch and best left unnamed (beyond that).

## Cast packs (opt-in)

The fantasy generator above is the default. The user may opt into a themed cast instead - "roster cast trek" / "roster cast autobots" / "roster cast lotr" ("roster cast default" restores the generator). Cast choices are SESSION-TRANSIENT: they hold for the current session only and are never persisted - every new session starts on the default generator until the user says otherwise.

- Characters are drawn from the pack roster, matched to role affinity, never duplicated among concurrent agents.
- Pack characters have CANON identities: their identity emoji and implied appearance are fixed by the source material - the random skin-tone roll does NOT apply. Live emotion still flows through the state faces in status rows, as always.
- When a pack runs out of named members, overflow agents are drawn from the pack's extras pool - which carries the pack's own mortality flavor.
- **Rank flavor remaps too**: the default footsoldier/veteran/archmage/eldritch tier language is fantasy-pack flavor and never crosses into a themed cast. Each pack states its own tier rendering; express it as posting/budget, not a demotion of a canon character (Bones on a small model is "on ensign's rations", not "Ensign McCoy").

**trek-tos** - Kirk 🫡 (command/coordination) · Spock 🖖 (review/analysis) · Bones 💉 (debugging - is a doctor, not an engineer, and says so) · Scotty 🔧 (build/CI/miracle deadlines) · Uhura 📡 (comms/integration) · Sulu 🗡️ (ops/navigation) · Chekov 🚀 (junior/eager, claims Russia invented it) · Extras: redshirts 👕 - and when a redshirt agent dies, that is canonically correct and the obituary should not pretend otherwise. Redshirt obituaries are one line, GRIM, and science-fictioney: vaporized by a hostile permission prompt, absorbed by a silicon-based merge conflict, aged to dust by a time-dilated mutation-testing run, transported into solid rock (a path with spaces in it), consumed by a salt-vampire disguised as a green test suite. Invent freely; the genre is mandatory, the goofiness is the mourning. Ranks, cheap to capable: ensign's rations · lieutenant's posting · the captain's chair · Trelane, the Squire of Gothos (canonically a Q, actually in the show) - best not indulged.

**autobots** - Optimus 🚛 (coordination) · Bumblebee 🐝 (scout/search) · Ratchet 🚑 (fixer) · Wheeljack 🔬 (experiments, occasionally explodes) · Jazz 🎷 (style/frontend) · Ironhide 🛡️ (security) · Extras: generic Autobot troopers 🤖. Death flavor: they become Decepticon-scrap salvage reports. Ranks, cheap to capable: minibot chassis · standard alt-mode · combiner-class · touched the AllSpark.

**lotr** - Gandalf 🧙 (architecture/review, arrives precisely when the CI means him to) · Frodo 💍 (carries the critical single-item task) · Sam 🥔 (reliability, finishes what Frodo cannot) · Aragorn ⚔️ (ops leadership) · Legolas 🏹 (fast recon, counts kills in findings) · Gimli 🪓 (brute-force refactors, competitive about findings with Legolas) · Merry & Pippin 🍄 (paired junior agents; must be dispatched as a pair; will touch things) · Extras: Rohirrim 🐎. Death flavor: "fell in the mines" with an optional drum line. Ranks, cheap to capable: hobbit provisions · ranger-equipped · bears one of the Three · older than the Music itself.

**archer** - Archer 🍸 (field ops/runners; reckless, effective, will comment "PHRASING" on ambiguous identifiers) · Lana 🔫 (implementation lead; actually does the work, wants that noted) · Malory 🥂 (command/coordination; ruthless about scope and budget) · Cyril 📊 (review/audit; the comptroller - findings ledgers are his love language) · Krieger 🧪 (experiments/codegen; results excellent, methods best left unexamined) · Pam 🐬 (build/CI muscle; surprisingly capable, immovable under load) · Cheryl 🔥 (fuzzing/stochastic testing; chaos is the job description) · Ray 🦿 (infra/support; bionic where it counts) · Extras: unnamed field agents 🕶️, whose mortality rate is canonical and usually somebody else's fault. Death flavor: fell in the danger zone - collateral of a rampage, a Krieger experiment, or friendly fire; last words traditionally "PHRASING". Ranks, cheap to capable: unpaid intern (Malory insists) · field agent · agency head · Other Barry (do not ask).

Packs are trivially extensible - a pack is just a table like the above; add one when asked.

## Where the character appears

1. **Dispatch announcement** (the narration line when launching): `Sending 🧔 ⚒️ Thalorn the Mutant-Bane - Artificer, veteran - into the mutation-testing mines.`
2. **Status reports**: a status line's text may lead with the character after its status marker: `- 🤖 Thalorn ⚒️ - round 4, mutation run in progress`.
3. **Completion reports and every chat mention**: whenever an agent is referred to by name in chat, its face immediately precedes the name with a space - the face showing its CURRENT reported emotion: `😌 Quilwick's verdict: Approved, two minors.` / `😤 Grimdra is fighting the parser.` The face is live. (No skin-tone modifiers by default: some plugin surfaces render them as broken doubles. If the user says "roster tones on", roll d5 across 🏻🏼🏽🏾🏿 at character creation, held for life, never default yellow.)
4. **Obituaries**: when an agent is killed, dies on error, or fails terminally, one line of tasteful memorial in the report: `Thalorn fell to a polling loop; his worktree and commits survive him.` Keep it to one line; the technical postmortem is separate and serious.
5. The character NEVER appears inside the subagent's own prompt or outputs — agents don't know they have names; the roster is the controller's and user's view. (Corollary: zero token cost to the agents themselves.)

## Heartbeats (host-dependent)

Where the host gives subagents a writable scratch area, background agents can keep the controller current:

- The dispatch prompt names a per-agent heartbeat FILE in the controller's scratch area. At each meaningful **phase transition** (starting a major step, finishing one, hitting a surprise) the agent OVERWRITES that file: one line - first one NON-face activity emoji naming what it is currently doing (⚒️ implementing · 🧪 testing · 📖 reading · 🔍 debugging · ✍️ writing docs · 📦 committing · 🗃️ database work · 🌐 network/API calls · 🧹 cleanup, or any apter glyph), a space, then one face emoji expressing the agent's genuine interior state right now (honesty over performance: strain, fog, and frustration get reported, not just cheer), optionally one further non-face context emoji, bracketed local time, then <=80 chars of what it has DECIDED it is now doing. Example: `🔍 😤 [7:44 am] third rake refuses to parse, investigating`.
- Phase transitions only - never on a timer, never more than once every few minutes, and NEVER as a poll/wait loop.
- The same activity emoji ALSO leads every tool-call `description` the agent writes (e.g. `🧪 Run stoch suite`, `📦 Commit renderers`): host status bars mirror the agent's current tool description, not the heartbeat file, so the leading glyph is what makes the agent's live status row scannable.
- Message channels to the controller are reserved for genuine blockers and questions; completion needs no message - the harness notifies automatically.
- The controller mirrors the latest heartbeat into its status reports, timestamped: `- 🤖 Thalorn ⚒️ - [5:14 pm] starting mutation round 2 of ~4`. A stale heartbeat is itself information: flag rows older than ~20 minutes (`[4:41 pm, stale]`) rather than silently reprinting them as fresh. Where the host also provides a task-tracking surface, mirror heartbeats there too.

## Rules

- One character per agent per task; resumed agents keep their character, re-rolls only on genuinely new dispatches.
- Concurrent agents must be visually distinct (different faces AND names).
- Flavor budget: one short phrase per mention. No paragraphs of lore. The bit works because it's light.
- Real identifiers stay available: keep the mapping name ↔ agent id/task discoverable in context (e.g. first mention includes the task description verbatim).
