/**
 * Put the catalogue on the desk, as a card, using the catalogue.
 *
 * The most honest test of a card system is whether it can describe itself with one of its own
 * types. If the table card cannot render thirty-two rows of real metadata legibly, the table card
 * is not finished — and nobody would have found that out by reading it.
 *
 * @example
 * node make-catalogue-card.mjs
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { catalogue, writeCard, audit } from './newcard.mjs';

const DECK = new URL('../cards/', import.meta.url).pathname.replace(/^\//, '');

const cat  = await catalogue();
const rows = [...cat].sort((a, b) => a[0].localeCompare(b[0])).map(([name, mod]) => ({
  type:     name,
  does:     mod.meta?.summary ?? '',
  data:     typeof mod.meta?.shape === 'string' ? mod.meta.shape : '(not a string — off contract)',
  settings: Object.keys(mod.meta?.defaults ?? {}).join(' · ') || '—',
  knobs:    Object.keys(mod.meta?.defaults ?? {}).length,
}));

const table = cat.get('table');
if (!table) { console.error('no table type to render the catalogue with'); process.exit(1); }

const spec = {
  id:    'catalogue',
  title: 'the card catalogue',
  ord:   15,
  data: {
    columns: [
      { key: 'type',     label: 'type',     type: 'text' },
      { key: 'does',     label: 'what it does', type: 'text' },
      { key: 'data',     label: 'data it takes', type: 'text' },
      { key: 'settings', label: 'settings', type: 'text' },
      { key: 'knobs',    label: 'knobs',    type: 'number', align: 'right' },
    ],
    rows,
    caption: `${rows.length} types. Every one takes data and renders itself, so "now do that for ` +
             `the other repo" is an argument rather than a rewrite. Sort by knobs to see which ` +
             `types are configurable and which just draw what they are handed.`,
  },
};

const complaints = audit(table.build({ ...spec }));
if (complaints.length) {
  console.error('the table card refuses this data:');
  for (const c of complaints) console.error(`  ${c}`);
  process.exit(1);
}

mkdirSync(DECK, { recursive: true });
console.log(`wrote ${writeCard(table, spec, DECK)} — ${rows.length} types`);
