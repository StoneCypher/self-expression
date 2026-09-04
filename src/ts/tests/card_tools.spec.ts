/**
 * Unit tests for the two card tools (`src/ts/mcp/card_tools.ts`): where the deck is, what
 * `render_card` says on each of its outcomes, what `list_card_types` hands back, and that the
 * registered tool actually carries the catalogue-generated description.
 *
 * Every test uses the two-type fixture kit (`fixtures/cardkit-mini/`, types `tally` and `blurb`)
 * rather than the real 88-type kit — loading two modules is cheap, and none of the behaviour under
 * test is about which types exist. Each store gets its own `mkdtempSync` directory and each desk
 * its own, both removed in a `finally`, so a failing assertion leaves nothing behind.
 *
 * @see ../mcp/card_tools.js
 */

import { describe, test, expect } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync, cpSync } from 'node:fs';
import { tmpdir }                from 'node:os';
import { join, resolve, isAbsolute, basename } from 'node:path';

import { openStore, closeStore, writeConfig } from '../channels/store.js';
import type { Store }                         from '../channels/store.js';
import { loadKit, RENDER_CARD_TRIGGER }       from '../cards/kit.js';
import type { CardKit }                       from '../cards/kit.js';
import { ANSWER_ORD_BASE, ANSWER_ORD_SPAN }   from '../cards/answer.js';
import {
  deskDeck, handleRenderCard, handleListCardTypes, registerCardTools, NO_DESK_REPLY,
} from '../mcp/card_tools.js';
import type { ToolReply } from '../mcp/chart_tools.js';
import { buildServer }    from '../mcp/server.js';

const MINI = resolve(__dirname, 'fixtures', 'cardkit-mini');
const ROOT = resolve(__dirname, '..', '..', '..');
const NOW  = new Date('2026-09-03T22:15:00Z');

/** One temporary store, closed and deleted whatever the body does. */
function withStore<T>(fn: (store: Store) => T): T {
  const dir   = mkdtempSync(join(tmpdir(), 'se-cards-')),
        store = openStore(join(dir, 'log.sqlite3'));
  try { return fn(store); } finally { closeStore(store); rmSync(dir, { recursive: true, force: true }); }
}

/** One temporary store with `desk.path` already pointing at a fresh desk directory. */
function withDesk<T>(fn: (store: Store, desk: string) => T): T {
  return withStore(store => {
    const desk = mkdtempSync(join(tmpdir(), 'se-desk-'));
    writeConfig(store, 'desk.path', desk);
    try { return fn(store, desk); } finally { rmSync(desk, { recursive: true, force: true }); }
  });
}

/** The single text block a tool reply carries. */
function text(reply: ToolReply): string {
  return reply.content[0]?.text ?? '';
}

describe('deskDeck', () => {

  test('is null until desk.path is set, and the cards directory under it afterwards', () => withStore(store => {
    expect(deskDeck(store)).toBeNull();
    writeConfig(store, 'desk.path', join(tmpdir(), 'some-desk'));
    expect(deskDeck(store)).toBe(join(tmpdir(), 'some-desk', 'cards'));
  }));

  // Named for what it actually exercises. `desk.path` has a null fallback and a
  // `stringValidator` that rejects blank input, so an empty or whitespace-only override never
  // reaches deskDeck as a string at all — it comes back through `effectiveValue` as the
  // fallback. The `path === ''` guard inside deskDeck is a second line no registered key can
  // currently cross, which is why this test asserts the fallback rather than claiming to cover it.
  test('a desk.path that fails validation falls back to unset, not to the working directory', () =>
    withStore(store => {
      for (const blank of ['', '   ']) {
        writeConfig(store, 'desk.path', blank);
        expect(deskDeck(store)).toBeNull();
      }
    }));

  test('a relative desk.path is resolved, so a card never lands under the server’s own cwd', () =>
    withStore(store => {
      writeConfig(store, 'desk.path', 'mydesk');
      const deck = deskDeck(store);
      expect(deck).not.toBeNull();
      expect(isAbsolute(deck ?? '')).toBe(true);
      expect(basename(deck ?? '')).toBe('cards');
      expect(deck).toBe(resolve('mydesk', 'cards'));
    }));

});

describe('render_card', () => {

  test('refuses politely when desk.path is unset, naming the key and the tool that sets it', async () => {
    const kit = await loadKit(MINI);
    withStore(store => {
      const out = text(handleRenderCard(store, kit, { type: 'tally', title: 'x', data: {} }, NOW));
      expect(out).toBe(NO_DESK_REPLY);
      expect(out).toContain('desk.path');
      expect(out).toContain('configure');
    });
  });

  test('writes into <desk.path>/cards and reports the id, the type, and the ord', async () => {
    const kit = await loadKit(MINI);
    withDesk((store, desk) => {
      const out = text(handleRenderCard(
        store, kit, { type: 'tally', title: 'Done', data: { value: 3, target: 5 } }, NOW));
      const dir = join(desk, 'cards', 'tally-done-2609032215');

      expect(out).toContain('card tally-done-2609032215 (tally) on the desk at ord 1000');
      expect(out).toContain(dir);
      expect(out).not.toContain('aged out');
      expect(existsSync(join(dir, 'card.json'))).toBe(true);
      expect(existsSync(join(dir, 'card.html'))).toBe(true);
    });
  });

  test('reports what aged out when the configured keep is reached', async () => {
    const kit = await loadKit(MINI);
    withDesk((store, desk) => {
      writeConfig(store, 'desk.answer_cards', '1');

      const first = text(handleRenderCard(
        store, kit, { type: 'tally', title: 'First', data: { value: 1, target: 2 } }, NOW));
      expect(first).not.toContain('aged out');

      const later  = new Date(NOW.getTime() + 60_000),
            second = text(handleRenderCard(
              store, kit, { type: 'tally', title: 'Second', data: { value: 2, target: 2 } }, later));

      expect(second).toContain('aged out tally-first-2609032215');
      expect(existsSync(join(desk, 'cards', 'tally-first-2609032215'))).toBe(false);
      expect(existsSync(join(desk, 'cards', 'tally-second-2609032216'))).toBe(true);
    });
  });

  test('names an unknown type and points at list_card_types', async () => {
    const kit = await loadKit(MINI);
    withDesk((store, desk) => {
      const out = text(handleRenderCard(store, kit, { type: 'zzz', title: 'x', data: {} }, NOW));
      expect(out).toContain('unknown card type: zzz');
      expect(out).toContain('list_card_types');
      expect(existsSync(join(desk, 'cards'))).toBe(false);   // refused before the deck was created
    });
  });

  test('honours an explicit band ord and refuses one outside the band as text, not a fault', async () => {
    const kit = await loadKit(MINI);
    withDesk(store => {
      const inside = text(handleRenderCard(
        store, kit, { type: 'tally', title: 'Pinned', data: {}, ord: ANSWER_ORD_BASE + 5 }, NOW));
      expect(inside).toContain(`at ord ${String(ANSWER_ORD_BASE + 5)}`);

      const outside = text(handleRenderCard(
        store, kit, { type: 'tally', title: 'Stray', data: {}, ord: ANSWER_ORD_BASE + ANSWER_ORD_SPAN }, NOW));
      expect(outside).toContain('not rendered:');
      expect(outside).toContain('outside the answer band');
    });
  });

  test('surfaces an audit refusal as text naming the complaint', async () => {
    const kitCopy = mkdtempSync(join(tmpdir(), 'se-kit-'));
    try {
      cpSync(MINI, kitCopy, { recursive: true });
      writeFileSync(join(kitCopy, 'types', 'broken.mjs'),
        "export const meta = { name: 'broken', summary: 'always fails audit', shape: '{}', " +
        "category: 'text-and-code', defaults: {} };\n" +
        'export function build({ id, title }) {\n' +
        '  return {\n' +
        '    html: \'<section data-card="\' + id + \'"><h2>\' + String(title) + \'</h2></section>\',\n' +
        "    css: '',\n" +
        "    js: 'var f = () => 1;',\n" +
        '    json: {},\n' +
        '  };\n' +
        '}\n');

      const kit = await loadKit(kitCopy);
      withDesk((store, desk) => {
        const out = text(handleRenderCard(store, kit, { type: 'broken', title: 'Bad', data: {} }, NOW));
        expect(out).toContain('not rendered:');
        expect(out).toContain('arrow function');
        expect(existsSync(join(desk, 'cards', 'broken-bad-2609032215'))).toBe(false);
      });
    } finally {
      rmSync(kitCopy, { recursive: true, force: true });
    }
  });

});

describe('list_card_types', () => {

  test('returns every group with no category, and exactly one when named', async () => {
    const kit = await loadKit(MINI);
    const all = JSON.parse(text(handleListCardTypes(kit, {}))) as { key: string }[];
    expect(all.map(g => g.key)).toEqual(['ranking-and-comparison', 'text-and-code']);

    const one = JSON.parse(text(handleListCardTypes(kit, { category: 'text-and-code' }))) as
      { key: string; members: { name: string }[] }[];
    expect(one).toHaveLength(1);
    expect(one[0]?.key).toBe('text-and-code');
    expect(one[0]?.members.map(m => m.name)).toContain('blurb');
  });

  // The bare call is the one a model makes first, and against the real 88-type kit the full
  // catalogue serialises to some 45 KB — around 11k tokens to answer "which category?". The
  // shapes still exist; they are one named-category call away.
  test('the bare call carries type names by category and no per-type detail at all', async () => {
    const kit = await loadKit(MINI);
    const rows = JSON.parse(text(handleListCardTypes(kit, {}))) as Record<string, unknown>[];

    expect(rows.map(r => r['key'])).toEqual(['ranking-and-comparison', 'text-and-code']);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(['key', 'label', 'question', 'types']);
      expect(row).not.toHaveProperty('members');
      expect(row).not.toHaveProperty('shape');
      expect(row).not.toHaveProperty('summary');
      expect(row).not.toHaveProperty('settings');
    }

    // The fixture's two types, spelled out rather than read back off the kit.
    expect(rows.map(r => r['types'])).toEqual([['tally'], ['blurb']]);
    expect(rows[0]?.['question']).toBe('Which is bigger?');
  });

  test('a named category still carries every type’s shape, summary and settings', async () => {
    const kit   = await loadKit(MINI);
    const one   = JSON.parse(text(handleListCardTypes(kit, { category: 'text-and-code' }))) as
      { key: string; members: Record<string, unknown>[] }[];
    const blurb = one[0]?.members.find(m => m['name'] === 'blurb');

    expect(blurb).toBeDefined();
    expect(blurb?.['shape']).toBe('{ text: string }');
    expect(blurb?.['summary']).toBe('A short quoted passage.');
    expect(blurb).toHaveProperty('settings');
  });

  test('refuses an unknown category by name and lists the ones that exist', async () => {
    const kit = await loadKit(MINI);
    const out = text(handleListCardTypes(kit, { category: 'charts' }));
    expect(out).toContain('unknown category: charts');
    for (const group of kit.groups) { expect(out).toContain(group.key); }
  });

});

describe('registerCardTools', () => {

  /** The names and descriptions the SDK actually holds for a built server. */
  function registered(server: unknown): Record<string, { description?: string }> {
    return (server as { _registeredTools: Record<string, { description?: string }> })._registeredTools;
  }

  test('buildServer registers neither tool when it is handed no kit', () => withStore(store => {
    const names = Object.keys(registered(buildServer(store, '0.0.0', null, ROOT, null, null)));
    expect(names).not.toContain('render_card');
    expect(names).not.toContain('list_card_types');
  }));

  test('buildServer handed a kit registers render_card with the generated description', async () => {
    const kit = await loadKit(MINI);
    withStore(store => {
      const tools = registered(buildServer(store, '0.0.0', null, ROOT, null, kit));
      expect(Object.keys(tools)).toContain('render_card');
      expect(Object.keys(tools)).toContain('list_card_types');
      expect(tools['render_card']?.description?.startsWith(RENDER_CARD_TRIGGER)).toBe(true);
      for (const group of kit.groups) {
        expect(tools['render_card']?.description).toContain(group.question);
      }
    });
  });

  test('registering twice on one server collides, so a double wiring is loud', async () => {
    const kit: CardKit = await loadKit(MINI);
    withStore(store => {
      const server = buildServer(store, '0.0.0', null, ROOT, null, kit);
      expect(() => { registerCardTools(server, store, kit); }).toThrow();
    });
  });

});
