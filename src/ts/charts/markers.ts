/**
 * The checklist marker vocabulary, promoted from prose to code.
 *
 * `markers.md` (the complete emoji vocabulary and its canonical order) and the
 * "Bucket membership" list in `status-checklists-skill.md` § The summary line
 * exist today only as prose a person has to re-read correctly every time a
 * checklist gets summarized. That is exactly the failure mode
 * `channels/vocabulary.ts` already solved for the affect-signature
 * vocabularies: promote the list to a runtime array once, and every caller —
 * validation, sorting, bucket classification — reads the same array instead
 * of re-deriving the rule from memory.
 *
 * A note on the strings themselves: several markers are multi-code-point —
 * a base emoji followed by U+FE0F (VARIATION SELECTOR-16), which forces the
 * emoji presentation of an otherwise text-default glyph (`🛠️`, `🛳️`, `🎙️`,
 * `🕵️`, and others below). These arrays store each marker exactly as it
 * appears in `markers.md`, and every comparison in this module is plain
 * string equality — no normalization, no stripping of variation selectors.
 * Callers (including test authors) must pass the marker string exactly as
 * rendered; a visually identical but code-point-different string will not
 * match.
 *
 * @see ../../doc_md/reference/markers.md
 * @see ../../doc_md/reference/status-checklists-skill.md
 * @see ../channels/vocabulary.ts
 */

/**
 * Which section of a checklist summary's count line a marker's item counts
 * toward.
 *
 * Not a strength or a status in itself — it is the coarse three-way split
 * the summary line's count section reports (`success / activePending /
 * failure`), independent of a marker's finer status/topic meaning.
 */
export type Bucket = 'success' | 'active' | 'failure';

/**
 * Markers that count toward the summary line's `success` bucket.
 *
 * Per `status-checklists-skill.md` § The summary line, "Bucket membership":
 * done, a perfect pass, finishing a major goal, agreement, something
 * genuinely cool, and caution/worked-with-a-caveat (the caveat stays visible
 * in the icon list, but the work still landed).
 *
 * `🛳️` (deploying something) is deliberately **not** in this array — a
 * deploy's bucket depends on whether it completed, a fact the glyph alone
 * cannot carry. Classify it via {@link classifyMarker}'s `override`
 * parameter instead.
 *
 * @example
 *   SUCCESS_MARKERS.includes('✅')  // => true
 *   SUCCESS_MARKERS.includes('🛳️')  // => false — pass an override instead
 */
export const SUCCESS_MARKERS = ['✅', '💯', '🏁', '👍', '😎', '⚠️'] as const;

/**
 * Markers that count toward the summary line's `failure` bucket.
 *
 * Per `status-checklists-skill.md` § The summary line, "Bucket membership":
 * failed, blocked, gone silent, dead/hung/degraded processes, a discovered
 * security problem, a serious problem or threat, active attack, and the
 * "something is wrong" family (stupid/frustrating, unknown cause, rejected
 * with no reason, suspect, overloaded, dormant, flaky, partial/degraded).
 *
 * @example
 *   FAILURE_MARKERS.includes('❌')  // => true
 *   FAILURE_MARKERS.includes('✅')  // => false
 */
export const FAILURE_MARKERS = [
  '❌',  // failed
  '🚫',  // blocked by something outside our control
  '🦗',  // an external party we contacted has gone silent — no reply
  '💀',  // a process, daemon, app, or server is unexpectedly dead
  '🧟',  // a process is hung or defunct — running but unresponsive, or never reaped
  '🦹',  // a discovered security problem
  '🌋',  // the item describes a serious problem or threat
  '🤬',  // we believe we are under active attack or being degraded
  '🤡',  // something is going wrong in a stupid, frustrating, or repeating way
  '😕',  // something is wrong and the cause is not yet known
  '🤌',  // something was rejected or denied with no stated reason — we do not know why
  '🤥',  // a claim, result, or dataset is suspect and does not hold up
  '🥵',  // under heavy load, overloaded, or stressed
  '😴',  // dormant — gone idle/stale, not deliberately paused
  '🫨',  // flaky, intermittent, or nondeterministic
  '🌗',  // partial/degraded
] as const;

/**
 * Every marker from `markers.md`, in its canonical order: the status
 * markers in their listed order (with `💯`, the perfect-pass variant of
 * `✅`, spliced in immediately after `✅` even though it has no bullet of
 * its own in the source — the file states the rule in prose rather than a
 * list entry), followed by the topic/action markers group by group, top to
 * bottom, in each group's left-to-right listed order.
 *
 * `markers.md`'s "Status markers" heading says "(22, canonical order)", but
 * the bulleted list beneath it has 23 entries — a stale
 * count in the source doc. This array transcribes the actual list, per the
 * rule "every marker... in its listed order".
 *
 * This is the tiebreaker `status-checklists-skill.md` specifies for sorting
 * a summary line's per-marker icon list: equal-count markers sort by first
 * appearance here.
 *
 * @see canonicalRank
 * @example
 *   CANONICAL_ORDER.indexOf('✅')  // => 0
 *   CANONICAL_ORDER.indexOf('💯')  // => 1 — immediately after ✅
 */
export const CANONICAL_ORDER = [
  '✅',  // done
  '💯',  // perfect pass (variant of done; ranks just after ✅)
  '🤖',  // running in an agent (a dispatched sub-agent)
  '⏳',  // running in general (direct work or a background process, not an agent)
  '🌐',  // web search or web read in progress
  '🛠️',  // deferred to a skill
  '🛰️',  // monitoring (waiting on a different task — a dependency-wait)
  '🔜',  // queued (not started, no specific blocker)
  '🦥',  // a long wait — used in place of 🛰️ or 🔜 when the wait is known to exceed 30 seconds
  '🌗',  // partial/degraded
  '🫨',  // flaky, intermittent, or nondeterministic
  '🦡',  // a retry — re-attempting after a prior failure
  '❌',  // failed
  '🚫',  // blocked by something outside our control
  '🦗',  // an external party we contacted has gone silent — no reply
  '⏭️',  // skipped intentionally
  '⏸️',  // paused/deferred (we chose to hold)
  '❗',  // needs attention now
  '⚠️',  // caution / worked-with-a-caveat
  '⏰',  // on a timer or cron
  '😴',  // dormant — gone idle/stale, not deliberately paused
  '🧠',  // handed to the user for review
  '❓',  // open question for the user
  '🤔',  // judgment call to weigh
  '📋',  // making a plan
  '🐙',  // coordination work — orchestrating multiple parallel workstreams, agents, or people (not infra orchestration; that is ☸️)
  '📅',  // setting schedules, reminders, or tracking deadlines
  '📩',  // sending a communication
  '👔',  // writing a presentation, review, or pitch
  '📝',  // recording data, notes, results, or a report
  '📖',  // writing documentation — READMEs, API docs, guides
  '📎',  // attaching assets, documents, evidence, or files
  '📺',  // uploading a video
  '🎙️',  // managing spoken assets
  '🖨️',  // creating a physical asset
  '🧪',  // writing tests
  '🦆',  // intentionally using a fake, stub, mock, placeholder, or substitute
  '🔍',  // research or lookup — consulting registries, docs, or version metadata to inform a decision (not debugging, which is 🕵️; not a web read in progress, which is 🌐)
  '🔗',  // external integration — wiring up or calling third-party services and APIs
  '🎫',  // issue-tracker work — filing, triaging, or grooming issues and tickets
  '🏁',  // finishing a major goal or the entire project
  '🪚',  // refactoring
  '🐀',  // a rat's nest — tangled, messy, hard-to-follow code
  '⚡',  // performance or optimization work
  '🐛',  // recording a defect
  '🧹',  // cleanup or formatting
  '🗑️',  // major removal
  '🦤',  // deprecating, sunsetting, or removing a service, application, library, or dependency (a planned end-of-life, not a failure)
  '🧐',  // a step that is itself a review or scrutiny step — examining, inspecting, or vetting something (not authoring a review document; that is 👔)
  '⚖️',  // compliance, process auditing, verification, or validation (formal/standards-driven checking)
  '👑',  // being authorized, permitted, or vetted by a third party — from a project manager's sign-off to Apple's app-submission approval
  '👍',  // agreeing to or accepting something
  '👎',  // declining something
  '✋',  // preventing something
  '🛳️',  // deploying something
  '♾️',  // DevOps work
  '↩️',  // rolling back a deploy
  '🏗️',  // provisioning or standing up infrastructure
  '📦',  // building a container image or build artifact
  '⚙️',  // configuration work
  '🔑',  // secrets or credentials work
  '🩹',  // patching or applying updates
  '🩺',  // health-check endpoints, liveness probes, or uptime monitoring
  '☸️',  // orchestration and infrastructure-as-code systems (Kubernetes, Terraform, Salt, and similar)
  '⬆️',  // bringing a server up
  '⬇️',  // bringing a server down
  '⏫',  // scaling a cluster up or out
  '⏬',  // scaling a cluster down or in
  '🔌',  // appliances, electronics, wiring, or power delivery
  '💽',  // database work
  '🧬',  // database schema changes and migrations
  '🌱',  // seeding a database or environment with seed or fixture data
  '💾',  // backups or restores
  '🪵',  // logging tasks — log handling, audit-trail reviews, syslog ingestion pipelines
  '🧮',  // calculation or generating data from data
  '📊',  // data analysis, metrics, or data conversion
  '🔮',  // a forecast, projection, or estimate — a predicted figure rather than a measured one
  '🔥',  // incident, outage, or firefighting
  '🚨',  // alert fired or incident declared
  '🧯',  // incident containment — machine isolation, revoking compromised tokens, stopping the spread
  '🤕',  // post-incident recovery — healing and restoring after an outage
  '🗿',  // recovering or resuming an individual task that crashed, stalled, or was interrupted (a single task brought back, not a full incident — that is 🤕)
  '🪦',  // a post-mortem or retrospective — the write-up analyzing what went wrong after an incident or a failed project
  '🕵️',  // debugging, root-cause analysis, stack-trace analysis, or checking processes
  '🦓',  // a rare or unlikely root cause — the unusual explanation, per "when you hear hoofbeats, think horses, not zebras"
  '🏷️',  // tags, releases, or version labels
  '🔀',  // merging branches or pull requests, resolving conflicts
  '🚀',  // git push to a remote
  '🔨',  // build tasks — compiling, bundling, running the build
  '🆙',  // a deliberate version upgrade — bumping a dependency, toolchain, or platform (not a small corrective update; that is 🩹)
  '🤮',  // generating a static site or static assets, or writing bulk text into a data file
  '🎨',  // creative assets, UI/UX, brand guidelines, and similar
  '♿',  // accessibility audits and fixes
  '📐',  // measurement, schematics, technical drawings, or verification against a spec or stated dimensions
  '🗺️',  // translation, localization, or internationalization
  '🎣',  // social engineering, phishing, or credential harvesting
  '🪓',  // brute-force attack or approach
  '🦹',  // a discovered security problem
  '🪪',  // cloud credentials or IAM systems
  '🩻',  // forensics, malware analysis, reverse engineering, or memory dumps
  '🔒',  // encryption, certificate enforcement, or data-at-rest protection
  '🕳️',  // honeypots, tarpits, shadowbans, sinkholed domains, RBLs, and similar containment/deception traps
  '🐒',  // offensive-security / red-team work — pentests, chaos engineering, fuzzing, adversarial testing (deliberately playing the attacker)
  '🧌',  // abuse, spam, trolling, or a bad actor to deal with
  '🤬',  // we believe we are under active attack or being degraded
  '🛡️',  // defensive security or hardening work — vulnerability remediation, enabling scanning or alerts, branch protection, tightening permissions (the constructive counterpart to 🦹, which marks the discovered problem)
  '👁️',  // IDS, telemetry, or user-session monitoring
  '💰',  // the item is financial in nature
  '🌪️',  // coping with a large requirements change
  '🧊',  // freezing a topic
  '👻',  // something has disappeared and the cause is unknown
  '💀',  // a process, daemon, app, or server is unexpectedly dead
  '🧟',  // a process is hung or defunct — running but unresponsive, or never reaped
  '🌋',  // the item describes a serious problem or threat
  '🤡',  // something is going wrong in a stupid, frustrating, or repeating way
  '😕',  // something is wrong and the cause is not yet known
  '🤌',  // something was rejected or denied with no stated reason — we do not know why
  '🤥',  // a claim, result, or dataset is suspect and does not hold up
  '🥵',  // under heavy load, overloaded, or stressed
  '😎',  // something genuinely cool happened — use sparingly, not for routine wins
  '🦙',  // a judgmental, opinion-charged, or drama-prone topic
  '💅',  // a sassy, unbothered, or pointed remark
  '🤓',  // nerdy, pedantic, or hyper-detailed material — or labeling something (or someone) as such
] as const;

/**
 * The bucket a marker's item counts toward in a checklist summary line.
 *
 * `override` exists for markers whose bucket cannot be read off the glyph
 * alone — chiefly `🛳️` (deploying something), whose bucket depends on
 * whether the deploy completed, failed, or is still underway. When supplied,
 * `override` wins outright rather than being blended with the marker's own
 * classification.
 *
 * Markers in neither {@link SUCCESS_MARKERS} nor {@link FAILURE_MARKERS} —
 * including every running/queued/topic marker and any marker this module
 * does not recognize — classify as `'active'`, matching the skill's
 * "active+pending: every other marker" rule.
 *
 * @param marker the marker string, exactly as it would be rendered in the
 *   checklist item (see the module note on variation selectors)
 * @param override the bucket to report unconditionally, when the caller
 *   already knows something the glyph can't express
 * @returns which bucket the marker's item counts toward
 * @example
 *   classifyMarker('✅')             // => 'success'
 *   classifyMarker('❌')             // => 'failure'
 *   classifyMarker('🔜')             // => 'active'
 *   classifyMarker('🛳️', 'success')  // => 'success' — deploy completed
 */
export function classifyMarker(marker: string, override?: Bucket): Bucket {
  if (override !== undefined) return override;
  if ((SUCCESS_MARKERS as readonly string[]).includes(marker)) return 'success';
  if ((FAILURE_MARKERS as readonly string[]).includes(marker)) return 'failure';
  return 'active';
}

/**
 * A marker's position in {@link CANONICAL_ORDER}, for sorting a summary
 * line's per-marker icon list (equal-count markers sort by this rank).
 *
 * An unrecognized marker ranks after every known marker rather than
 * throwing, so an icon list containing a marker this module doesn't (yet)
 * know about still sorts — last, deterministically — instead of crashing
 * the renderer.
 *
 * @param marker the marker string, exactly as it would be rendered
 * @returns the marker's zero-based index in `CANONICAL_ORDER`, or
 *   `CANONICAL_ORDER.length` when the marker is not recognized
 * @example
 *   canonicalRank('✅')   // => 0
 *   canonicalRank('💯')   // => 1 — immediately after ✅
 *   canonicalRank('🤷')   // => CANONICAL_ORDER.length — not in markers.md
 */
export function canonicalRank(marker: string): number {
  const index = (CANONICAL_ORDER as readonly string[]).indexOf(marker);
  return index === -1 ? CANONICAL_ORDER.length : index;
}
