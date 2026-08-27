/**
 * Ordered-stage renderers: a milestone list, a step pipeline, or a transition graph in,
 * one drawn rail or line out.
 *
 * `visuals.md` § Process timeline gives the rail two forms rather than one because
 * color and centered alignment cannot coexist in a monospace grid: emoji are
 * double-width, so a colored rail cannot align its pips to a single-width label row.
 * The monochrome form gets the centered rail and drops color (and therefore `'failed'`,
 * which has no monochrome glyph); the colored form gets `'failed'` and drops the rail.
 * Both live here alongside the two other ordered-stage forms from § Inline
 * micro-visualizations: the dependency chain (an inline pipeline with one underlined
 * current step) and the one-line FSL state-machine description.
 *
 * Pure: no I/O, no store access, no clock, no randomness — the same input always
 * renders the same string.
 *
 * @see ../../doc_md/reference/visuals.md
 */

/** The state a single timeline milestone is in. */
export type MilestoneState = 'reached' | 'current' | 'future' | 'failed';

/** One stage of a process timeline: its short label and the state it is currently in. */
export interface Milestone {
  /** The stage's short name, e.g. `'spec'` or `'ship'` — drawn on the label row. */
  label: string;
  /** One of {@link MilestoneState}. */
  state: MilestoneState;
}

/** Four spaces, the fixed gap between labels on the rail's label row. */
const RAIL_GAP = '    ';

/** `━` — the rail character both timeline forms draw with. */
const RAIL_CHAR = '\u{2501}';

/** The marker each rail-eligible {@link MilestoneState} draws, per `visuals.md`. */
const RAIL_GLYPHS: Readonly<Record<'reached' | 'current' | 'future', string>> = {
  reached: '\u{25CF}', // ●
  current: '\u{25C6}', // ◆
  future:  '\u{25CB}', // ○
};

/** The colored pip each {@link MilestoneState} draws, per `visuals.md`. */
const COLORED_GLYPHS: Readonly<Record<MilestoneState, string>> = {
  reached: '\u{1F7E2}', // 🟢
  current: '\u{1F7E6}', // 🟦
  failed:  '\u{1F536}', // 🔶
  future:  '\u{25CE}',  // ◎
};

/**
 * Guards the one precondition {@link renderTimelineRail} and
 * {@link renderTimelineColored} share: a timeline needs at least one stage to draw.
 */
function requireMilestones(milestones: readonly Milestone[], fn: string): void {
  if (milestones.length === 0) {
    throw new RangeError(`${fn} needs at least one milestone`);
  }
}

/**
 * Renders the two-line monochrome process-timeline rail: a `━` rail spanning the full
 * width of the label row, each milestone's marker centered over its label.
 *
 * The rail character at each milestone's column sits at
 * `labelStart + floor((labelLength - 1) / 2)`, where `labelStart` is that label's
 * starting column on the label row (labels joined by four spaces). The monochrome ramp
 * has no glyph for `'failed'` — color is what distinguishes a failed stage from a
 * reached one, and color needs double-width emoji, which this form deliberately avoids
 * so its rail can align to the single-width label row beneath it.
 *
 * @param milestones The stages, left to right. At least one.
 *
 * @example
 *   renderTimelineRail([
 *     { label: 'spec',  state: 'reached' },
 *     { label: 'build', state: 'reached' },
 *     { label: 'test',  state: 'current' },
 *     { label: 'ship',  state: 'future' },
 *   ])
 *   // => '━●━━━━━━━━●━━━━━━━◆━━━━━━━○━━\nspec    build    test    ship'
 *
 * @throws {RangeError} If `milestones` is empty, or any milestone is in the `'failed'`
 *                        state — use {@link renderTimelineColored} instead.
 * @see ../../doc_md/reference/visuals.md#process-timeline
 */
export function renderTimelineRail(milestones: readonly Milestone[]): string {
  requireMilestones(milestones, 'renderTimelineRail');

  const labelLine = milestones.map(m => m.label).join(RAIL_GAP);
  const rail = Array.from({ length: labelLine.length }, () => RAIL_CHAR);

  let cursor = 0;
  for (const milestone of milestones) {
    if (milestone.state === 'failed') {
      throw new RangeError(
        "renderTimelineRail has no glyph for the 'failed' state (only 'reached', "
        + "'current', and 'future' sit on the monochrome rail); use "
        + 'renderTimelineColored instead'
      );
    }
    const column = cursor + Math.floor((milestone.label.length - 1) / 2);
    rail[column] = RAIL_GLYPHS[milestone.state];
    cursor += milestone.label.length + RAIL_GAP.length;
  }

  return `${rail.join('')}\n${labelLine}`;
}

/**
 * Renders the one-line colored process-timeline form: each milestone's colored pip
 * immediately followed by its label, joined by ` ━━ `.
 *
 * Chosen over {@link renderTimelineRail} whenever color — and therefore `'failed'` — is
 * needed: color requires emoji, emoji are double-width, and double-width pips cannot
 * align to a single-width centered rail, so this form drops the rail and lives on one
 * line instead.
 *
 * @param milestones The stages, left to right. At least one.
 *
 * @example
 *   renderTimelineColored([
 *     { label: 'spec',  state: 'reached' },
 *     { label: 'build', state: 'failed' },
 *     { label: 'test',  state: 'current' },
 *     { label: 'ship',  state: 'future' },
 *   ])
 *   // => '🟢 spec ━━ 🔶 build ━━ 🟦 test ━━ ◎ ship'
 *
 * @throws {RangeError} If `milestones` is empty.
 * @see ../../doc_md/reference/visuals.md#process-timeline
 */
export function renderTimelineColored(milestones: readonly Milestone[]): string {
  requireMilestones(milestones, 'renderTimelineColored');
  return milestones
    .map(m => `${COLORED_GLYPHS[m.state]} ${m.label}`)
    .join(` ${RAIL_CHAR}${RAIL_CHAR} `);
}

/** U+0332, COMBINING LOW LINE — the mark {@link renderDependencyChain} underlines with. */
const UNDERLINE = '\u{0332}';

/** Appends {@link UNDERLINE} after every character of `text`. */
function underline(text: string): string {
  return Array.from(text, ch => `${ch}${UNDERLINE}`).join('');
}

/**
 * Renders an ordered pipeline inline: steps joined by ` ━ `, with the currently-running
 * step's characters underlined via the combining low-line mark (U+0332) rather than a
 * separate glyph, so the underline survives being embedded inside surrounding item text.
 *
 * @param steps        The pipeline's stages in order, e.g. `['lint', 'test', 'build',
 *                      'deploy']`. At least one.
 * @param currentIndex The index into `steps` of the stage currently running.
 *
 * @example
 *   renderDependencyChain(['lint', 'test', 'build', 'deploy'], 2)
 *   // => 'lint ━ test ━ b̲u̲i̲l̲d̲ ━ deploy'
 *
 * @throws {RangeError} If `steps` is empty, or `currentIndex` is not an integer within
 *                        `[0, steps.length - 1]`.
 * @see ../../doc_md/reference/visuals.md#inline-micro-visualizations
 */
export function renderDependencyChain(steps: readonly string[], currentIndex: number): string {
  if (steps.length === 0) {
    throw new RangeError('renderDependencyChain needs at least one step');
  }
  if (!Number.isInteger(currentIndex) || currentIndex < 0 || currentIndex >= steps.length) {
    throw new RangeError(
      `currentIndex must be an integer within [0, ${String(steps.length - 1)}]; `
      + `received ${String(currentIndex)}`
    );
  }
  return steps
    .map((step, index) => (index === currentIndex ? underline(step) : step))
    .join(` ${RAIL_CHAR} `);
}

/** One transition in a finite-state machine: an edge, optionally labeled by its action. */
export interface FslTransition {
  /** The state the transition leaves. */
  from: string;
  /** The state the transition enters. */
  to: string;
  /** The action or event driving the transition, if the diagram names one. */
  action?: string;
}

/**
 * Renders a one-line FSL-style state-machine description: `from 'action' -> to;`,
 * consecutive transitions merged into a single chained statement wherever one's `to`
 * matches the next's `from`, `;`-terminated statements where they do not connect.
 *
 * `transitions` is read as a path: connectivity is judged purely by comparing each
 * transition's `from` against the immediately preceding transition's `to`, in array
 * order — a caller wanting one merged chain must already list its edges in traversal
 * order, since this renderer does not search for a connecting path out of order.
 *
 * When `activeState` is given, only its **first** rendered occurrence is wrapped in
 * `**bold**`; later occurrences of the same state name — for instance returning to it
 * in a cycle — render plain. This marks where the machine currently is, not every place
 * the state's name happens to appear.
 *
 * @param transitions The edges to render, in traversal order. At least one.
 * @param activeState The state currently occupied, if known. Its first occurrence is
 *                     bolded; omit when no state is known to be active.
 *
 * @example
 *   renderFsl(
 *     [
 *       { from: 'locked', to: 'unlocked', action: 'coin' },
 *       { from: 'unlocked', to: 'locked', action: 'push' },
 *     ],
 *     'locked',
 *   )
 *   // => "**locked** 'coin' -> unlocked 'push' -> locked;"
 *
 * @example
 *   renderFsl([{ from: 'a', to: 'b' }, { from: 'c', to: 'd' }])
 *   // => 'a -> b; c -> d;'
 *
 * @throws {RangeError} If `transitions` is empty.
 * @see ../../doc_md/reference/visuals.md#inline-micro-visualizations
 */
export function renderFsl(transitions: readonly FslTransition[], activeState?: string): string {
  if (transitions.length === 0) {
    throw new RangeError('renderFsl needs at least one transition');
  }

  let bolded = false;
  const renderState = (state: string): string => {
    if (activeState !== undefined && !bolded && state === activeState) {
      bolded = true;
      return `**${state}**`;
    }
    return state;
  };

  const statements: string[] = [];
  let statement = '';
  let lastTo = '';

  for (const transition of transitions) {
    const actionPart = transition.action !== undefined ? ` '${transition.action}'` : '';
    if (statement !== '' && transition.from === lastTo) {
      statement += `${actionPart} -> ${renderState(transition.to)}`;
    } else {
      if (statement !== '') { statements.push(statement); }
      statement = `${renderState(transition.from)}${actionPart} -> ${renderState(transition.to)}`;
    }
    lastTo = transition.to;
  }
  statements.push(statement);

  return statements.map(s => `${s};`).join(' ');
}
