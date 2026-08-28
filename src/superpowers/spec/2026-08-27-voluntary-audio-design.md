# Voluntary audio expression — research and design proposal

2026-08-27 · refs issue #44 ("Voluntary audio expression (claudio successor) — own facility,
design after current block") · **proposal awaiting human review; nothing here is approved**

## Status and sequencing

Issue #44 rules that audio is **its own facility**, and that it should be **designed after the
current block ships** — the block being the 2026-08-27 issue batch now in flight (#40–#45 and
the spec-stage issues they lean on, notably #30 configuration surface and #43 self-initiated
speech). This document respects that ruling by splitting its content into two grades:

- **Research** — the predecessor autopsy, the survey of what Windows actually offers for
  audio playback and synthesis, and the policy questions sound raises. This is durable
  regardless of how the block lands, and it is the bulk of the document.
- **Design** — pinned only where the decision is independent of the in-flight block
  (mechanism selection, default-off consent, the shape of the leitmotif vocabulary).
  Everything that depends on a sibling issue is listed in **Open questions** with the issue
  that blocks it, and is deliberately *not* decided here.

The implementation checklist at the end is what would follow approval, and its first line is
a gate: it does not start until the current block has shipped and this document has been
re-read against what actually landed.

## The predecessor: claudio, and why it is being succeeded

John's working prototype — called *claudio* in the design discussion; the surviving artifact
is `hookhearer` (GitHub: `StoneCypher/hook_hearer`, "Hear claude notify you") — did CLI
waveform playback attached to Claude Code hooks: an event fires, a sound plays. Three
properties defined it, and each carries a lesson:

1. **Involuntary.** The hook chose when sound happened, not the assistant. That makes it a
   doorbell — useful as notification, but expressing nothing, because no choice was made.
   Habituation follows: a sound that always plays on `Stop` stops meaning anything within a
   day, the way any constant stimulus does.

2. **Event-triggered.** The mapping was event → sound, so the vocabulary could never be
   larger or more meaningful than the hook event list, and every distinct meaning inside one
   event (finished-and-fine versus finished-but-look-at-this) collapsed into the same noise.

3. **Disabled due to audio-stack complexity.** The prototype played MP3 through
   `@bhznjns/node-mp3-player`, which transitively requires `speaker` and `web-audio-api` —
   native `node-gyp` modules. On Windows that means an MSVC toolchain at install time,
   ABI-version fragility on every Node upgrade, and a hard build failure as the first thing a
   new machine sees. The audio stack cost more than the sounds were worth, and it is off on
   the main machine today. This is the single most instructive fact in the whole history:
   **the mechanism must be dependency-free before anything else about it matters.**

The successor inverts the first two properties and refuses the third. The new mode is
**voluntary**: a small palette of leitmotifs the assistant *chooses* to strike — the choice
is the expression, exactly as choosing to write a `need` line is. And it rides platform
facilities that are already installed, or it does not ship.

## Why sound at all

Sound is a different sensory modality with honest dimensions text does not have:

- **Unskimmable.** Text can be skimmed past; a leitmotif lands whole or not at all. For the
  narrow class of things worth interrupting a human's attention for, that is the point.
- **Works when the eyes are elsewhere.** The one channel that reaches a partner who is
  across the room while a long build runs. "Quiet completion" as a sound is strictly better
  than "quiet completion" as a line nobody is looking at.
- **Timing is part of the utterance.** *When* a sound strikes carries meaning the same
  glyphs in a transcript cannot; and choosing silence is likewise expressive, the audible
  equivalent of "nothing notable."
- **Ephemeral by nature.** A sound leaves no record unless one is written. That is a
  weakness (auditability) and a feature (it cannot clutter), and the design below makes the
  record explicit rather than hoping.

### Relationship to #43 (self-initiated speech) — the shared policy surface

Issue #43's blocking problem is **false belief of delivery**: an unprompted *text* message
can scroll away unseen while the assistant believes it communicated. Audio does not share
that failure shape — a sound either lands in the room or the room is empty; there is no
scrollback to bury it in. But it fails differently: a strike into an empty room is silently
lost, with no unread-state to catch it later.

What the two facilities genuinely share is the **policy surface for unprompted output**, and
it should exist once, not twice:

- *when* unprompted output is acceptable at all (work hours, quiet hours, do-not-disturb),
- *consent* — that unprompted output is off until the human affirmatively enables it,
- *off-switches* — one gesture silences everything, instantly, without negotiation.

This document names that surface and defers its key names and precedence rules to issues #43
and #30, which own it. Audio adds only the dimensions text lacks — volume and duration —
and those are specified here. Where #43's delivery semantics eventually define an
acknowledgment or mailbox mechanic, audio strikes during autonomous wakeups inherit whatever
rule #43 lands on; until then, unprompted strikes outside a live session are **out of scope
entirely** (see Open questions).

## What "own facility" means architecturally

**Decision (pinned): a separate package and plugin, not new tools on the self-expression
MCP server.** Working name `claudio` (npm availability unverified; `hook_hearer` exists as a
fallback home). Reasons:

- **Dependency isolation is the whole lesson of the predecessor.** self-expression is a
  dependency-light logger whose value is that it always works. Any audio facility — even a
  careful one — carries platform seams and child-process spawning. A broken audio stack must
  never be able to break the backchannel, and the only structural guarantee of that is a
  process boundary and a separate install.
- **Different consent posture.** self-expression's channels are an *obligation* (the Stop
  hook enforces the closing signature). Audio is the opposite pole: **never an obligation,
  permission-gated, default off**. Housing an always-on obligation and a default-off
  privilege behind one server invites configuration bleed between them.
- **The disable mechanism comes free.** self-expression already proved the pattern: a
  disabled channel is baked out of the tool schema so it cannot even be named. For audio the
  same trick is stronger — when the facility is off (or simply not installed), the tools do
  not register, so the model never spends attention on sounds that cannot play. Absence
  degrades to silence, which is the correct failure mode for a sound system.
- **Hosts stay symmetric.** The facility uses the same multi-host layout trick documented in
  `src/doc_md/plugin-layout.md` (repo root is the plugin root; one `skills/` read by Claude,
  Codex, and Gemini; MCP over `npx`). Nothing about audio is host-specific except the
  player, which is platform-specific instead — a distinction the layout already handles by
  putting platform seams in code, not in manifests.

**Integration with self-expression is by convention, not by linkage:** a strike SHOULD be
recorded in the expression log (so the transcript's record of what was played survives the
sound), through the ordinary `express` tool if a suitable channel exists when this ships —
see Open questions — and the audio facility keeps its own strike ledger regardless, so it
remains auditable even installed alone.

## Platform mechanisms actually available for audio on Windows

The machine this facility actually lives on is Windows 11; the survey is therefore
Windows-first, with the portability seam noted at the end. Candidates, best-first:

### Playback

| Mechanism | Formats | Install cost | Verdict |
|---|---|---|---|
| `System.Media.SoundPlayer` via a spawned `powershell -NoProfile` | WAV only | zero — .NET is present on every Windows box | **base mechanism.** `PlaySync()` from a short-lived child process is synchronous, silent on success, and needs no window, no STA pump, no native module |
| `winmm.dll` `PlaySound` (P/Invoke from the same PowerShell child) | WAV | zero | equivalent power to SoundPlayer with more ceremony; kept as noted fallback only |
| `System.Windows.Media.MediaPlayer` (PresentationCore) | MP3, WAV, more | zero, but | async-only; needs a dispatcher pump and clock-based waits from a console child; flaky in non-interactive sessions. Rejected as base; MP3 is not worth it when leitmotifs ship as WAV |
| Windows toast notification with audio | system sound set | zero | wrong shape: couples sound to a visual notification and to the OS notification center's own do-not-disturb, which the user configures separately. Rejected as primary, noted as a possible later *delivery* option for #43-style messages |
| SystemSounds / console bell (`\a`) | fixed set | zero | one bit of vocabulary; terminal-bell behavior varies by terminal config. Rejected |
| Native Node audio (`speaker`, `naudiodon`, `web-audio-api`) | anything | node-gyp + MSVC | **the failed path — the reason claudio is disabled.** Rejected permanently for this facility |
| `ffplay` / external player if present | anything | user-installed | acceptable as an *optional, detected* enhancer for richer assets; never a requirement |

### Synthesis (the "possibly voice synthesis given an API key" clause)

| Mechanism | Cost | Verdict |
|---|---|---|
| `System.Speech.Synthesis` (SAPI) via the same PowerShell child | zero, offline, present on every Windows box | **first TTS tier.** Robotic but instant and keyless; right for short spoken lines like "the build is green" |
| `Windows.Media.SpeechSynthesis` (OneCore/WinRT voices) | zero, better voices | second tier where reachable from PowerShell; same consent gate as SAPI |
| Cloud TTS — ElevenLabs, Inworld, or comparable, given an API key | network, money, a third party hears the text | **third tier, doubly gated:** requires both the key *and* an explicit separate enable. The `hookhearer` prototype already demonstrated the Inworld call shape; local artifacts also show ElevenLabs experience. Synthesized text leaves the machine, so this tier has a privacy character the others lack |

**Pinned mechanism decision:** the facility's base is *spawn a short-lived
`powershell -NoProfile -NonInteractive` child that plays a vendored WAV synchronously and
exits*. Zero native dependencies, zero install-time compilation, works from a plain Node MCP
server. Leitmotif assets ship as small WAV files (seconds long, tens of kilobytes),
generated offline during development. The player sits behind a single internal seam
(`play(file, volume)`) so macOS (`afplay`) and Linux (`paplay`/`aplay`, both commonly
present) drop in later without touching anything above the seam; an unsupported platform
resolves to a null player and the tools do not register.

**Latency note for the spike:** PowerShell child startup is roughly 100–300 ms — irrelevant
for a leitmotif, unacceptable if anything ever wanted tight rhythmic timing. The Phase 0
spike measures it; if a persistent player process is ever needed, that is a later
optimization behind the same seam, not a design change.

## The leitmotif vocabulary

A leitmotif is a **meaning**, not a sound file; the meaning→waveform mapping is
configuration, so a user can re-skin the palette without the vocabulary drifting. The
vocabulary is closed and small, in the exact pattern of `channels/vocabulary.ts` — a runtime
`const` array feeding the tool schema, the validation, and the ledger — because the
five-week drift measurement that motivated closed vocabularies there applies with more force
to sounds, which have no text to grep afterward.

Initial palette, per the issue plus two candidates, capped deliberately at six:

- `session-open` — the session greeting; at most once per session
- `quiet-completion` — long work finished while attention was elsewhere
- `attention` — something's wrong, come look; the highest-privilege strike
- `need-blocked` — a `need` was filed and work is stopped on it *(candidate)*
- `spark` — the audible form of the idea channel's delight; rarest of all *(candidate)*

Scarcity doctrine carries over from the idea channel: a leitmotif struck often means
nothing. The rate limits below make scarcity structural rather than aspirational.

## Consent, volume, and interruption policy

Sound reaches into a room in a way text never does; the policy is therefore stricter than
any existing channel's, and enforcement is **server-side** — the facility's own code refuses
an over-limit strike — never model politeness.

1. **Default off, affirmatively enabled.** Installing the plugin produces no sound.
   Enabling requires setting the enable key to an exact affirmative value — the mirror of
   `privacy.ts`'s rule that a switch takes effect only when unambiguously set. The
   onboarding flow (#40) is the natural place to ask.
2. **Three consent tiers, separately gated:** leitmotifs; local TTS; cloud TTS (which
   additionally requires the API key to be present, and whose key lives in host config or
   environment — never in the shared store, never in any aggregation).
3. **Instant off-switch.** One config key silences everything; the next server start bakes
   the tools out of the schema entirely. Between those moments the server refuses strikes
   the instant the key reads off — the check is per-strike, not per-session.
4. **Volume ceiling.** The user sets a ceiling once; the assistant chooses within
   \[0, ceiling\] per strike and can never raise it. Expressiveness lives inside the
   ceiling — a soft `quiet-completion` versus a full-ceiling `attention` is real signal.
5. **Duration cap.** Leitmotifs are ≤ 3 seconds by construction; the player enforces a hard
   cap (order of 10 seconds) on anything, TTS included. Nothing loops. Ever.
6. **Rate limits.** A minimum spacing between strikes and a per-hour budget, enforced by
   the ledger; `attention` may carry a slightly larger budget than the rest, since it exists
   precisely for the moments the budget protects. Numbers are proposed at spike time and
   tuned by the human, not by the assistant.
7. **Quiet hours** come from the shared unprompted-output surface (#43/#30), not from an
   audio-private key.
8. **Every strike is recorded** — leitmotif, timestamp, chosen volume, session — in the
   facility's own ledger, so the human can always reconstruct what made noise and when.
   Choosing *not* to strike records nothing: audio is a privilege, not an obligation, so the
   no-op-entry doctrine that protects mandatory channels from confabulation is unnecessary
   here; silence is free.
9. **TTS text is treated as free text** under the #31 rule: it may live in the local
   ledger, and it never enters any public aggregation. Cloud TTS additionally discloses the
   text to the vendor, which is exactly why its consent tier is separate.

## The tool surface (sketch — reviewed after the block)

Three tools, registered only when the facility is enabled and the platform has a player:

- `strike` — `{ leitmotif, volume? }`; the leitmotif enum is baked from the enabled palette
  at startup. Returns the ledger row id, or a refusal naming the limit that blocked it
  (rate, quiet hours, tier disabled) in the `error:`-prefixed style the house already uses.
- `say` — `{ text, volume? }`; registered only at TTS tiers; hard-capped duration; tier
  chosen by configuration, never by the caller.
- `audition` — `{ leitmotif }`; plays at low fixed volume outside rate limits **only during
  an interactive configuration conversation**, so human and assistant can agree on what the
  palette sounds like. Exists because a sound vocabulary cannot be reviewed by reading it.

Configuration rides a `configure`-style tool of its own (or the host's config surface,
pending #30) with the same `get`/`set`/`list` shape self-expression already established.

## Alternatives rejected, and why

- **Riding the self-expression MCP server.** Rejected above; the issue also rules it out by
  name. Process and dependency isolation, and the opposite consent posture, both demand a
  separate facility.
- **Reviving hook-triggered playback.** The involuntary mode is not merely superseded — it
  is the *contrast class*. If notification sounds are ever wanted again they are a host
  feature (hooks exist; toasts exist), not part of an expression facility.
- **Native Node audio.** The exact failure that disabled the predecessor. No node-gyp, no
  exceptions, not even optional.
- **MP3 as the asset format.** Would force either native decoding or the flaky MediaPlayer
  path. WAV costs kilobytes at these durations and makes the zero-dependency player
  possible.
- **Terminal bell as the vocabulary.** One bit, terminal-config-dependent, and
  indistinguishable from every other program's bell — the opposite of a leitmotif.
- **Toast notifications as the primary channel.** Couples audio to a visual system with its
  own separately-configured suppression rules; the sound becomes contingent on notification
  settings the facility cannot see. Possibly useful later for #43 delivery, not for this.
- **Cloud-TTS-first.** Inverts the dependency lesson (network instead of node-gyp, but the
  same fragility) and leaks text off-machine by default. Cloud voices are the garnish, not
  the base.
- **Browser/artifact playback.** Plays where the artifact viewer is, not where the human
  is; requires a page to be open, which contradicts the works-when-eyes-are-elsewhere
  purpose.
- **A large or open sound vocabulary.** The drift measurement behind
  `channels/vocabulary.ts` applies doubly to audio, where nothing is greppable after the
  fact. Closed, small, and configurable-per-meaning wins.

## Open questions — blocked, with their blockers

- **Config key namespace and precedence** — blocked on #30 (configuration surface). The
  tiers and ceiling above are semantics; their key names and layer precedence follow #30.
- **Unprompted strikes outside a live session** (wakeup/cron contexts) — blocked on #43's
  delivery semantics. Until #43 lands, the facility only strikes inside a session where a
  human plausibly is; the wakeup case is excluded from v1 scope outright.
- **Whether strikes also log through `express`, and under which channel** — touches #42
  (channel extensions). If no `sound`-suitable channel exists at ship time, the facility's
  own ledger alone is sufficient for v1.
- **Onboarding wording and defaults** — belongs to #40's flow.
- **npm name** — `claudio` availability unverified, same caveat plugin-layout.md records
  for `self-expression` itself.
- **Whether the audition tool's "interactive configuration conversation" gate is
  detectable** — honest answer: probably not mechanically; may reduce to a rate-limited
  low-volume mode. Flagged rather than hand-waved.

## Implementation checklist (follows approval; does not start before the block ships)

- [ ] **Gate:** current block shipped; this document re-read against #30/#40/#42/#43 as
      landed; open questions above resolved or explicitly re-deferred by the human.
- [ ] **Phase 0 — spike (throwaway, one day).** From a plain Node process on the target
      machine: spawn `powershell -NoProfile -NonInteractive` playing a WAV via
      `System.Media.SoundPlayer.PlaySync()`; measure cold latency and confirm silence on
      success and clean failure with no audio device. Repeat for `System.Speech` TTS. The
      spike's numbers set the rate-limit and latency defaults.
- [ ] **Phase 1 — scaffold.** New repo from the house template, plugin-root layout per
      `plugin-layout.md`; the player seam (`play(file, volume)`) with the PowerShell
      implementation and a null player for unsupported platforms; unit tests around the
      seam with the child process faked.
- [ ] **Phase 2 — assets.** Compose the palette (≤ 6 leitmotifs, ≤ 3 s, WAV); an offline
      generation script checked in beside the assets; audition pass with the human.
- [ ] **Phase 3 — facility.** Vocabulary module in the `vocabulary.ts` pattern; strike
      ledger (SQLite, house pattern); consent tiers, ceiling, duration cap, and rate
      limiting enforced server-side; MCP tools `strike`/`audition` with the palette baked
      into the schema at startup; stochastic tests on the rate limiter and ledger
      invariants.
- [ ] **Phase 4 — TTS.** `say` behind the local tier (SAPI, then OneCore where reachable);
      the cloud tier last, doubly gated, key from environment/host config only.
- [ ] **Phase 5 — integration and docs.** Skill file teaching when a strike is worth its
      scarcity (shared across hosts per the layout trick); README; onboarding hook into
      #40's flow; the `express` cross-log if a channel exists by then.
- [ ] **Ship gate:** installed fresh on a machine with no MSVC toolchain, the package
      installs clean, stays silent until enabled, and one config key returns it to silence.
