/**
 * What kind of question a card answers.
 *
 * The D3 galleries sort charts by the question they answer rather than by the shape they draw, and
 * that turned out to be the more useful axis: a reader arrives at a catalogue holding a question,
 * not a silhouette. These are that axis, extended past charts to cover the whole deck.
 *
 * The key is the categorisation and the value is what it means, as one sentence a person can read
 * without a legend. There is deliberately no display-name field: the label is derived from the key,
 * so a category cannot end up called two different things in two places.
 *
 * Every type declares exactly one. Not zero — an uncategorised card is invisible in the gallery and
 * nobody notices for months. Not several — a type that genuinely belongs in two categories is
 * usually two types wearing one name, and the constraint is what surfaces that.
 */

/**
 * Category key to the question that category answers.
 *
 * Keys are lowercase and hyphenated, and spell out `and` rather than carrying an ampersand: they
 * appear in JSON, in filenames and in prose, and an `&` needs escaping in exactly one of those.
 *
 * @example CATEGORIES.distribution;   // 'What does the spread look like?'
 */
export const CATEGORIES = {
  'distribution':
    'What does the spread look like?',
  'correlation-and-multivariate':
    'How do these move together?',
  'ranking-and-comparison':
    'Which is bigger?',
  'part-of-a-whole':
    'How does it divide?',
  'evolution':
    'What changed over time?',
  'flow-and-relationship':
    'What connects to what?',
  'geographic':
    'Where?',
  'text-and-code':
    'What does it say, exactly as written?',
  'work-and-lists':
    'What is outstanding, and what can I do about it?',
  'live-and-ambient':
    'What is true right now?',
};

/** Every category key, in the order they are declared, which is the order they read best in. */
export const CATEGORY_KEYS = Object.keys(CATEGORIES);

/**
 * The human label for a category key.
 *
 * Derived rather than stored, so a rename is one edit and cannot leave a stale copy behind.
 * Sentence case: only the first word is capitalised, because these are labels rather than titles
 * and Title Case On Every Word reads like a menu in a hotel.
 *
 * @param key a key of {@link CATEGORIES}
 * @returns the label, or the key unchanged when it is not one of ours
 *
 * @example
 * categoryLabel('part-of-a-whole');              // 'Part of a whole'
 * categoryLabel('correlation-and-multivariate'); // 'Correlation and multivariate'
 */
export function categoryLabel(key) {
  const words = String(key ?? '').split('-').join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Whether a key names a real category.
 *
 * @example isCategory('geographic');  // true
 * @example isCategory('charts');      // false
 */
export function isCategory(key) {
  return typeof key === 'string' && Object.hasOwn(CATEGORIES, key);
}

/**
 * Group a catalogue into its categories, alphabetically within each.
 *
 * Categories with no members are omitted rather than shown empty — an empty heading implies a
 * category the reader has to check, when the truthful state is that nothing is there yet. A type
 * whose category is missing or unknown lands under `uncategorised`, which is deliberately ugly:
 * it should be fixed, not lived with.
 *
 * @param types rows of `[name, module]`, as `catalogue()` yields
 * @returns rows of `{ key, label, question, members: [{ name, summary, shape, settings }] }`
 *
 * @example
 * groupByCategory([...await catalogue()])[0].label;   // 'Distribution'
 */
export function groupByCategory(types) {
  const bins = new Map(CATEGORY_KEYS.map(k => [k, []]));
  const stray = [];

  for (const [name, mod] of types) {
    const meta = mod?.meta ?? {};
    const row = {
      name,
      summary:  typeof meta.summary === 'string' ? meta.summary : '',
      shape:    typeof meta.shape === 'string' ? meta.shape : '',
      settings: Object.keys(meta.defaults ?? {}),
    };
    if (isCategory(meta.category)) bins.get(meta.category).push(row);
    else stray.push(row);
  }

  const byName = (a, b) => a.name.localeCompare(b.name);
  const out = [];
  for (const key of CATEGORY_KEYS) {
    const members = bins.get(key).sort(byName);
    if (members.length) {
      out.push({ key, label: categoryLabel(key), question: CATEGORIES[key], members });
    }
  }
  if (stray.length) {
    out.push({
      key: 'uncategorised',
      label: 'Uncategorised',
      question: 'These declare no category, which is a defect rather than a kind.',
      members: stray.sort(byName),
    });
  }
  return out;
}
