# Status checklist — marker vocabulary

Every checklist item carries exactly one marker. Pick the single most specific
one for the item's current state or kind of work. Topic/action markers take
precedence over status markers when the *kind of work* is the salient thing.

Use only these markers; extend the set only at the user's request.

After editing this file, run `node check-checklist.mjs --file example.md` (both in this directory) — the worked example doubles as the convention's regression test, and the validator reads its vocabulary and buckets live from this file.

The order markers appear in this file — status markers first in their listed order, then the topic/action groups top to bottom — is the **canonical order**. It is the tiebreaker when sorting the per-marker counts: equal-count markers are ordered by first appearance here. 💯 (the perfect-pass variant of ✅) sorts immediately after ✅.

## Status markers (25, canonical order)

- ✅ done
- 🤖 running in an agent (a dispatched sub-agent)
- ⏳ running in general (direct work or a background process, not an agent)
- 🌐 web search or web read in progress
- 🔬 under review — the work exists and a reviewer is examining it
- 🔁 in a fix round — judged by review, now being amended (distinct from the retry-after-failure badger below)
- 🛠️ deferred to a skill
- 🛰️ monitoring (waiting on a different task — a dependency-wait)
- 🔜 queued (not started, no specific blocker)
- 🦥 a long wait — used in place of 🛰️ or 🔜 when the wait is known to exceed 30 seconds
- 🌗 partial/degraded
- 🫨 flaky, intermittent, or nondeterministic
- 🦡 a retry — re-attempting after a prior failure
- ❌ failed
- 🚫 blocked by something outside our control
- 🦗 an external party we contacted has gone silent — no reply
- ⏭️ skipped intentionally
- ⏸️ paused/deferred (we chose to hold)
- ❗ needs attention now
- ⚠️ caution / worked-with-a-caveat
- ⏰ on a timer or cron
- 😴 dormant — gone idle/stale, not deliberately paused
- 🧠 handed to the user for review
- ❓ open question for the user
- 🤔 judgment call to weigh

## Topic/action markers

An item's single emoji when its *kind of work* is the salient thing, used in
place of a status marker.

- **work kind:** 📋 making a plan · 🐙 coordination work — orchestrating multiple parallel workstreams, agents, or people (not infra orchestration; that is ☸️) · 📅 setting schedules, reminders, or tracking deadlines · 📩 sending a communication · 👔 writing a presentation, review, or pitch · 📝 recording data, notes, results, or a report · 📖 writing documentation — READMEs, API docs, guides · 📎 attaching assets, documents, evidence, or files · 📺 uploading a video · 🎙️ managing spoken assets · 🖨️ creating a physical asset · 🧪 writing tests · 🦆 intentionally using a fake, stub, mock, placeholder, or substitute · 🔍 research or lookup — consulting registries, docs, or version metadata to inform a decision (not debugging, which is 🕵️; not a web read in progress, which is 🌐) · 🔗 external integration — wiring up or calling third-party services and APIs · 🎫 issue-tracker work — filing, triaging, or grooming issues and tickets · 🏁 finishing a major goal or the entire project
  - 👔 (necktie) is for *delivering or authoring* a presentation, pitch, or review — the producer side. For the act of *examining* something, use 🧐.
- **code health:** 🪚 refactoring · 🐀 a rat's nest — tangled, messy, hard-to-follow code · ⚡ performance or optimization work · 🐛 recording a defect · 🧹 cleanup or formatting · 🗑️ major removal · 🦤 deprecating, sunsetting, or removing a service, application, library, or dependency (a planned end-of-life, not a failure) · 🧐 a step that is itself a review or scrutiny step — examining, inspecting, or vetting something (not authoring a review document; that is 👔)
- **assurance:** ⚖️ compliance, process auditing, verification, or validation (formal/standards-driven checking) · 👑 being authorized, permitted, or vetted by a third party — from a project manager's sign-off to Apple's app-submission approval
- **decisions:** 👍 agreeing to or accepting something · 👎 declining something · ✋ preventing something
- **deploy & DevOps:** 🛳️ deploying something · ♾️ DevOps work · ↩️ rolling back a deploy · 🏗️ provisioning or standing up infrastructure · 📦 building a container image or build artifact · ⚙️ configuration work · 🔑 secrets or credentials work · 🩹 patching or applying updates · 🩺 health-check endpoints, liveness probes, or uptime monitoring · ☸️ orchestration and infrastructure-as-code systems (Kubernetes, Terraform, Salt, and similar)
- **servers & clusters:** ⬆️ bringing a server up · ⬇️ bringing a server down · ⏫ scaling a cluster up or out · ⏬ scaling a cluster down or in
- **hardware & power:** 🔌 appliances, electronics, wiring, or power delivery
- **data:** 💽 database work · 🧬 database schema changes and migrations · 🌱 seeding a database or environment with seed or fixture data · 💾 backups or restores · 🪵 logging tasks — log handling, audit-trail reviews, syslog ingestion pipelines · 🧮 calculation or generating data from data · 📊 data analysis, metrics, or data conversion · 🔮 a forecast, projection, or estimate — a predicted figure rather than a measured one
- **incidents:** 🔥 incident, outage, or firefighting · 🚨 alert fired or incident declared · 🧯 incident containment — machine isolation, revoking compromised tokens, stopping the spread · 🤕 post-incident recovery — healing and restoring after an outage · 🗿 recovering or resuming an individual task that crashed, stalled, or was interrupted (a single task brought back, not a full incident — that is 🤕) · 🪦 a post-mortem or retrospective — the write-up analyzing what went wrong after an incident or a failed project
- **debugging:** 🕵️ debugging, root-cause analysis, stack-trace analysis, or checking processes · 🦓 a rare or unlikely root cause — the unusual explanation, per "when you hear hoofbeats, think horses, not zebras"
- **version control & build:** 🏷️ tags, releases, or version labels · 🔀 merging branches or pull requests, resolving conflicts · 🚀 git push to a remote · 🔨 build tasks — compiling, bundling, running the build · 🆙 a deliberate version upgrade — bumping a dependency, toolchain, or platform (not a small corrective update; that is 🩹) · 🤮 generating a static site or static assets, or writing bulk text into a data file
- **design:** 🎨 creative assets, UI/UX, brand guidelines, and similar · ♿ accessibility audits and fixes · 📐 measurement, schematics, technical drawings, or verification against a spec or stated dimensions
- **localization:** 🗺️ translation, localization, or internationalization
- **security:** 🎣 social engineering, phishing, or credential harvesting · 🪓 brute-force attack or approach · 🦹 a discovered security problem · 🪪 cloud credentials or IAM systems · 🩻 forensics, malware analysis, reverse engineering, or memory dumps · 🔒 encryption, certificate enforcement, or data-at-rest protection · 🕳️ honeypots, tarpits, shadowbans, sinkholed domains, RBLs, and similar containment/deception traps · 🐒 offensive-security / red-team work — pentests, chaos engineering, fuzzing, adversarial testing (deliberately playing the attacker) · 🧌 abuse, spam, trolling, or a bad actor to deal with · 🤬 we believe we are under active attack or being degraded · 🛡️ defensive security or hardening work — vulnerability remediation, enabling scanning or alerts, branch protection, tightening permissions (the constructive counterpart to 🦹, which marks the discovered problem)
- **observability:** 👁️ IDS, telemetry, or user-session monitoring
- **finance:** 💰 the item is financial in nature
- **situations:** 🌪️ coping with a large requirements change · 🧊 freezing a topic · 👻 something has disappeared and the cause is unknown · 💀 a process, daemon, app, or server is unexpectedly dead · 🧟 a process is hung or defunct — running but unresponsive, or never reaped · 🌋 the item describes a serious problem or threat · 🤡 something is going wrong in a stupid, frustrating, or repeating way · 😕 something is wrong and the cause is not yet known · 🤌 something was rejected or denied with no stated reason — we do not know why · 🤥 a claim, result, or dataset is suspect and does not hold up · 🥵 under heavy load, overloaded, or stressed · 😎 something genuinely cool happened — use sparingly, not for routine wins
- **tone:** 🦙 a judgmental, opinion-charged, or drama-prone topic · 💅 a sassy, unbothered, or pointed remark · 🤓 nerdy, pedantic, or hyper-detailed material — or labeling something (or someone) as such

## Bucket membership (for the summary line's count section)

- **success:** ✅ · 💯 · 🏁 · 👍 · 😎 · ⚠️ (caveated work still landed; the caveat stays visible in the icon list) · a completed 🛳️
- **failure:** ❌ · 🚫 · 🦗 · 💀 · 🧟 · 🦹 · 🌋 · 🤬 · 🤡 · 😕 · 🤌 · 🤥 · 🥵 · 😴 · 🫨 · 🌗
- **active+pending:** every other marker, including all running markers, an in-progress 🛳️, and every topic/action marker not listed above

## Profile bucket membership (digest profiles)

The status-checklist buckets above are one **profile** of the general digest grammar
(`<counts> <noun> [(<scalar>%) <bar>] [trend <sparkline>] <icon-list>` — see the
compression-mechanic design, issue #20). Each profile partitions its units into the
buckets below, in canonical order; a unit matching no listed marker counts toward the
profile's *residual* bucket, marked ※. The glyph vocabulary is shared across profiles —
new glyphs are added to this file, never to a profile privately.

| profile | noun | buckets (canonical order) | scalar axis |
|---|---|---|---|
| checklist | items | success / active+pending ※ / failure — per Bucket membership above | percent = success ÷ total |
| findings | findings | blocking (❗ 🦹 🌋 ❌ 🚫) / degraded (⚠️ 🌗 🐛 🤡 😕) / note ※ | none |
| options | options | chosen (✅ 👍) / open (🤔 ❓ ⏸️ ※) / rejected (❌ 👎 ✋) | none |
| diff | files | added / modified ※ / removed — classified by change kind, not marker | none; a `+N −M` line-count tail instead of a bar |
| results | hits | matched ※ / partial (🌗) / missed (🦗 ❌) | none |

Only the checklist profile has a scalar axis; a percent or bar on any other profile is
fabricated and fails validation. The diff profile is the one profile whose buckets are
assigned per unit (by change kind) rather than read off the marker, which stays free to
carry the kind of work (🪚 📝 🧪 …).
