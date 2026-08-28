/**
 * A small FSL-subset parser: exactly the fragment `renderFsl` (in
 * `../charts/timeline.ts`) emits, turned back into a {@link Digraph}.
 *
 * The subset is: bare transitions (`a -> b;`), action-labeled transitions
 * (`a 'action' -> b;`), chained arrows (`a -> b -> c;`), multiple `;`-separated
 * statements, and the active-state `**bold**` marks (stripped on parse). Everything
 * else in real FSL/jssm — probabilities, named machines, themes, other arrow kinds —
 * is a `RangeError` naming the subset, never a silent skip: this project carries
 * zero runtime dependencies, so jssm's full grammar deliberately stays out of scope
 * (`2026-08-27-diagrams-design.md` § FSL / jssm). A caller with a full FSL machine
 * has jssm; a transcript diagram needs the topology.
 *
 * Round-trip property, pinned by the stochastic suite: for any transition list `t`,
 * `parseFsl(renderFsl(t))` yields the same edge sequence as `t`, actions and all.
 *
 * @see ../charts/timeline.js
 * @see ./model.js
 */
import type { Digraph } from './model.js';
/**
 * Parses an FSL-subset source string into a validated {@link Digraph}: each
 * transition becomes an edge, each quoted action its edge's label, and the node set
 * is inferred in first-appearance order. `**bold**` active-state marks are stripped
 * — the active state is display information, carried separately by
 * `renderStateDiagram`'s `activeState` option, not part of the topology.
 *
 * @param source the FSL text, e.g. output of `renderFsl`; must contain at least one
 *                transition, and every statement must end with `;`
 *
 * @example
 *   parseFsl("locked 'coin' -> unlocked 'push' -> locked;")
 *   // => {
 *   //   nodes: [{ id: 'locked' }, { id: 'unlocked' }],
 *   //   edges: [
 *   //     { from: 'locked', to: 'unlocked', label: 'coin' },
 *   //     { from: 'unlocked', to: 'locked', label: 'push' },
 *   //   ],
 *   // }
 *
 * @throws {RangeError} If the source is empty, a statement is malformed or missing
 *                        its `;`, or the text uses FSL features outside the subset
 *                        (probabilities, named machines, other arrow kinds); every
 *                        rejection names the subset.
 * @see normalizeGraph
 */
export declare function parseFsl(source: string): Digraph;
//# sourceMappingURL=fsl.d.ts.map