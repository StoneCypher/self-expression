import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir }              from 'node:os';
import { join }                from 'node:path';
import { z }                   from 'zod';
import { McpServer }           from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client }              from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport }   from '@modelcontextprotocol/sdk/inMemory.js';

import { openStore, closeStore } from '../channels/store.js';
import type { Store }            from '../channels/store.js';
import { buildServer }           from '../mcp/server.js';
import { handleRenderDiagram, registerDiagramTools, DIAGRAM_FORMS } from '../mcp/diagram_tools.js';
import {
  renderStateDiagram, renderDigraph, renderTree, renderSequence, renderMatrix,
  toMermaid, normalizeGraph, normalizeMatrix, seriate, describeSeriation,
} from '../diagrams/index.js';

/** The same file-private tuple helper the tool file uses, rebuilt for schema tests. */
function tuple<T extends string>(values: readonly T[]): [T, ...T[]] {
  const [first, ...rest] = values;
  if (first === undefined) { throw new Error('vocabulary must not be empty'); }
  return [first, ...rest];
}

function withStore<T>(fn: (s: Store) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'se-diagram-tools-')),
        s   = openStore(join(dir, 'log.sqlite3'));
  try { return fn(s); } finally { closeStore(s); rmSync(dir, { recursive: true, force: true }); }
}

/** {@link withStore} for the server-driven tests, which have to await before closing. */
async function withStoreAsync<T>(fn: (s: Store) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'se-diagram-tools-')),
        s   = openStore(join(dir, 'log.sqlite3'));
  try { return await fn(s); } finally { closeStore(s); rmSync(dir, { recursive: true, force: true }); }
}

/** Pulls the plain text out of a tool reply, the shape every assertion below checks. */
function text(reply: { content: { type: 'text'; text: string }[] }): string {
  const [first] = reply.content;
  return first === undefined ? '' : first.text;
}

const FSL = "locked 'coin' -> unlocked 'push' -> locked;";
const TOGGLE_EDGES = [
  { from: 'locked', to: 'unlocked', label: 'coin' },
  { from: 'unlocked', to: 'locked', label: 'push' },
];

describe('handleRenderDiagram — state form', () => {

  test('the fsl input path matches the renderer directly', () => withStore(s => {
    expect(text(handleRenderDiagram(s, { form: 'state', fsl: FSL })))
      .toBe(renderStateDiagram(FSL));
  }));

  test('the structured edges path matches too', () => withStore(s => {
    expect(text(handleRenderDiagram(s, { form: 'state', edges: TOGGLE_EDGES })))
      .toBe(renderStateDiagram(FSL));
  }));

  test('activeState, frame, and width pass through', () => withStore(s => {
    const out = text(handleRenderDiagram(s, {
      form: 'state', fsl: FSL, activeState: 'locked', frame: false, width: 40,
    }));
    expect(out).toBe(renderStateDiagram(FSL, { activeState: 'locked', frame: false, width: 40 }));
    expect(out).toContain('▶ locked');
  }));

  test('missing both edges and fsl names the requirement', () => withStore(s => {
    const out = text(handleRenderDiagram(s, { form: 'state' }));
    expect(out).toMatch(/^error: /);
    expect(out).toContain("'edges'");
    expect(out).toContain("'fsl'");
  }));

  test('a subset violation surfaces as error text, not a fault', () => withStore(s => {
    const out = text(handleRenderDiagram(s, { form: 'state', fsl: 'a 50% -> b;' }));
    expect(out).toMatch(/^error: /);
    expect(out).toContain('subset');
  }));

  test("emit 'mermaid' returns the stateDiagram-v2 serialization", () => withStore(s => {
    expect(text(handleRenderDiagram(s, { form: 'state', fsl: FSL, emit: 'mermaid' })))
      .toBe('stateDiagram-v2\n    locked --> unlocked: coin\n    unlocked --> locked: push');
  }));

  test("emit 'both' is the drawing, a blank line, then the mermaid", () => withStore(s => {
    const out = text(handleRenderDiagram(s, { form: 'state', fsl: FSL, emit: 'both' }));
    expect(out).toBe(`${renderStateDiagram(FSL)}\n\nstateDiagram-v2\n    locked --> unlocked: coin\n    unlocked --> locked: push`);
  }));

});

describe('handleRenderDiagram — digraph form', () => {

  const EDGES = [
    { from: 'a', to: 'b' }, { from: 'a', to: 'c' }, { from: 'b', to: 'd' }, { from: 'c', to: 'd' },
  ];

  test('matches the renderer, with nodes honored for labels', () => withStore(s => {
    const nodes = [{ id: 'a', label: 'alpha' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
    expect(text(handleRenderDiagram(s, { form: 'digraph', edges: EDGES, nodes })))
      .toBe(renderDigraph(normalizeGraph(EDGES, nodes)));
  }));

  test('missing edges names the requirement', () => withStore(s => {
    const out = text(handleRenderDiagram(s, { form: 'digraph' }));
    expect(out).toMatch(/^error: /);
    expect(out).toContain("'edges'");
  }));

  test("emit 'mermaid' uses the flowchart dialect", () => withStore(s => {
    expect(text(handleRenderDiagram(s, { form: 'digraph', edges: [{ from: 'a', to: 'b' }], emit: 'mermaid' })))
      .toBe(toMermaid(normalizeGraph([{ from: 'a', to: 'b' }]), 'flowchart'));
  }));

  test('a refusal carries the fallback menu in the error text', () => withStore(s => {
    const edges = Array.from({ length: 21 }, (_v, i) => ({ from: `q${String(i)}`, to: `q${String((i + 1) % 21)}` }));
    const out = text(handleRenderDiagram(s, { form: 'digraph', edges }));
    expect(out).toMatch(/^error: /);
    expect(out).toContain('fall back');
    expect(out).toContain('mermaid');
  }));

});

describe('handleRenderDiagram — tree form', () => {

  test('edges become parent -> child structure; nodes become labels', () => withStore(s => {
    const edges = [
      { from: 'plugin', to: 'skills' }, { from: 'plugin', to: 'commands' },
      { from: 'commands', to: 'claude' }, { from: 'commands', to: 'gemini' },
    ];
    expect(text(handleRenderDiagram(s, { form: 'tree', root: 'plugin', edges })))
      .toBe(renderTree('plugin', { plugin: ['skills', 'commands'], commands: ['claude', 'gemini'] }));
  }));

  test('missing root or edges names the requirement', () => withStore(s => {
    const out = text(handleRenderDiagram(s, { form: 'tree', edges: [{ from: 'a', to: 'b' }] }));
    expect(out).toMatch(/^error: /);
    expect(out).toContain("'root'");
  }));

  test('non-tree input surfaces the shared-node refusal as error text', () => withStore(s => {
    const out = text(handleRenderDiagram(s, {
      form: 'tree', root: 'a',
      edges: [{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }, { from: 'b', to: 'd' }, { from: 'c', to: 'd' }],
    }));
    expect(out).toMatch(/^error: /);
    expect(out).toContain("'d'");
  }));

});

describe('handleRenderDiagram — sequence form', () => {

  const ACTORS = ['human', 'agent'];
  const MESSAGES = [
    { from: 'human', to: 'agent', label: 'ask' },
    { from: 'agent', to: 'human', label: 'answer' },
  ];

  test('matches the renderer', () => withStore(s => {
    expect(text(handleRenderDiagram(s, { form: 'sequence', actors: ACTORS, messages: MESSAGES })))
      .toBe(renderSequence(ACTORS, MESSAGES));
  }));

  test('missing actors or messages names the requirement', () => withStore(s => {
    const out = text(handleRenderDiagram(s, { form: 'sequence', actors: ACTORS }));
    expect(out).toMatch(/^error: /);
    expect(out).toContain("'messages'");
  }));

  test('the mermaid emission is explicitly unavailable for sequences', () => withStore(s => {
    const out = text(handleRenderDiagram(s, {
      form: 'sequence', actors: ACTORS, messages: [], emit: 'mermaid',
    }));
    expect(out).toMatch(/^error: /);
    expect(out).toContain('no mermaid emission');
  }));

});

describe('form is a closed schema vocabulary', () => {

  test('render_diagram rejects a misspelled form rather than accepting it', () => {
    expect(z.enum(tuple(DIAGRAM_FORMS)).safeParse('statechart').success).toBe(false);
  });

  test('render_diagram still accepts every one of its real forms', () => {
    for (const form of DIAGRAM_FORMS) {
      expect(z.enum(tuple(DIAGRAM_FORMS)).safeParse(form).success).toBe(true);
    }
  });

});

describe('handleRenderDiagram — matrix form', () => {

  const ROW_KEYS = ['v0.1', 'v0.2', 'v0.3'];
  const COL_KEYS = ['infra', 'tests', 'docs', 'refactor'];
  const CELLS    = [[12, 3, 1, 0], [2, 20, 6, 0], [0, 5, 30, 9]];
  const TABLE    = normalizeMatrix(ROW_KEYS, COL_KEYS, CELLS);

  test('seriates by default and appends the verdict after a blank line', () => withStore(s => {
    const out = text(handleRenderDiagram(s, { form: 'matrix', rowKeys: ROW_KEYS, colKeys: COL_KEYS, cells: CELLS }));
    const found = seriate(TABLE, { pinRows: undefined, pinCols: undefined });
    expect(out).toBe(`${renderMatrix(found.matrix)}\n\n${describeSeriation(found)}`);
    expect(out).toContain('seriation: profile distance ');
  }));

  test("seriate: false draws the caller's order and says nothing about seriation", () => withStore(s => {
    const out = text(handleRenderDiagram(s, {
      form: 'matrix', rowKeys: ROW_KEYS, colKeys: COL_KEYS, cells: CELLS, seriate: false,
    }));
    expect(out).toBe(renderMatrix(TABLE));
    expect(out).not.toContain('seriation:');
  }));

  test('pinRows reaches the search, and the drawing shows the caller order', () => withStore(s => {
    const out = text(handleRenderDiagram(s, {
      form: 'matrix', rowKeys: ROW_KEYS, colKeys: COL_KEYS, cells: CELLS, pinRows: true,
    }));
    expect(out).toBe(`${renderMatrix(seriate(TABLE, { pinRows: true }).matrix)}\n\n${describeSeriation(seriate(TABLE, { pinRows: true }))}`);
    expect(out).toContain('rows pinned to caller order');
    const drawn = out.split('\n\n')[0] ?? '';
    expect(drawn.indexOf('v0.1')).toBeLessThan(drawn.indexOf('v0.3'));
  }));

  test('totals, frame, and width pass through', () => withStore(s => {
    const out = text(handleRenderDiagram(s, {
      form: 'matrix', rowKeys: ROW_KEYS, colKeys: COL_KEYS, cells: CELLS,
      seriate: false, totals: false, frame: false, width: 40,
    }));
    expect(out).toBe(renderMatrix(TABLE, { totals: false, frame: false, width: 40 }));
  }));

  test('missing rowKeys, colKeys, or cells names the full requirement', () => withStore(s => {
    const out = text(handleRenderDiagram(s, { form: 'matrix', rowKeys: ROW_KEYS }));
    expect(out).toMatch(/^error: /);
    expect(out).toContain("'colKeys'");
    expect(out).toContain("'cells'");
    expect(out).toContain("'pinRows'");
  }));

  test('the mermaid emission is explicitly unavailable for matrices', () => withStore(s => {
    const out = text(handleRenderDiagram(s, {
      form: 'matrix', rowKeys: ROW_KEYS, colKeys: COL_KEYS, cells: CELLS, emit: 'both',
    }));
    expect(out).toMatch(/^error: /);
    expect(out).toContain('no mermaid emission');
  }));

  test('a ragged cell grid surfaces as error text, not a protocol fault', () => withStore(s => {
    const out = text(handleRenderDiagram(s, {
      form: 'matrix', rowKeys: ['a', 'b'], colKeys: ['x', 'y'], cells: [[1, 2], [3]],
    }));
    expect(out).toMatch(/^error: /);
    expect(out).toContain('rectangular');
  }));

  test('a negative value surfaces as error text and says why it is refused', () => withStore(s => {
    const out = text(handleRenderDiagram(s, {
      form: 'matrix', rowKeys: ['a'], colKeys: ['x'], cells: [[-3]],
    }));
    expect(out).toMatch(/^error: /);
    expect(out).toContain('non-negative');
  }));

  test('a table too wide for the budget refuses with the fallbacks', () => withStore(s => {
    const out = text(handleRenderDiagram(s, {
      form: 'matrix',
      rowKeys: ['a'],
      colKeys: Array.from({ length: 30 }, (_v, i) => `c${String(i)}`),
      cells: [Array.from({ length: 30 }, () => 1)],
      width: 40,
    }));
    expect(out).toMatch(/^error: /);
    expect(out).toContain('fall back');
  }));

});

describe('render_diagram through the real server', () => {

  /**
   * Drives the tool the way a host does: a real {@link buildServer} on one end of an
   * in-memory transport pair, a real MCP client on the other. Nothing here is a
   * hand-built stand-in, so registration, schema validation, and dispatch are all
   * exercised rather than assumed.
   */
  async function callTool(store: Store, args: Record<string, unknown>): Promise<string> {
    const server = buildServer(store, '0.0.0', null);
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'diagram-tools-spec', version: '0.0.0' });
    await Promise.all([client.connect(clientSide), server.connect(serverSide)]);
    try {
      const result = await client.callTool({ name: 'render_diagram', arguments: args });
      const blocks = result.content as { type: string; text?: string }[] | undefined;
      return blocks?.[0]?.text ?? '';
    } finally {
      await client.close();
      await server.close();
    }
  }

  test('the matrix form draws and reports, end to end', async () => {
    await withStoreAsync(async s => {
      const out = await callTool(s, {
        form: 'matrix',
        rowKeys: ['v0.1', 'v0.2', 'v0.3'],
        colKeys: ['infra', 'tests', 'docs', 'refactor'],
        cells: [[12, 3, 1, 0], [2, 20, 6, 0], [0, 5, 30, 9]],
        pinRows: true,
      });
      expect(out.startsWith('┌')).toBe(true);
      expect(out).toContain('seriation: profile distance ');
      expect(out).toContain('rows pinned to caller order');
      // The margins the renderer promises, carried all the way through the protocol.
      expect(out).toContain('88');
    });
  });

  test('the state form still works alongside it, end to end', async () => {
    await withStoreAsync(async s => {
      const out = await callTool(s, { form: 'state', fsl: FSL });
      expect(out).toBe(renderStateDiagram(FSL));
    });
  });

  test('a misspelled form is refused by the schema, naming the closed vocabulary', async () => {
    await withStoreAsync(async s => {
      const out = await callTool(s, { form: 'seriated-matrix' });
      expect(out).toContain('Invalid option');
      for (const form of DIAGRAM_FORMS) { expect(out).toContain(`"${form}"`); }
    });
  });

  test("the registered tool advertises 'matrix' among its forms", async () => {
    await withStoreAsync(async s => {
      const server = buildServer(s, '0.0.0', null);
      const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 'diagram-tools-spec', version: '0.0.0' });
      await Promise.all([client.connect(clientSide), server.connect(serverSide)]);
      try {
        const listed = await client.listTools();
        const tool = listed.tools.find(candidate => candidate.name === 'render_diagram');
        expect(tool).toBeDefined();
        expect(JSON.stringify(tool?.inputSchema)).toContain('matrix');
        expect(tool?.description).toContain('seriated matrix');
      } finally {
        await client.close();
        await server.close();
      }
    });
  });

});

describe('registerDiagramTools', () => {

  test('registers on a fresh server without throwing', () => withStore(s => {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    expect(() => { registerDiagramTools(server, s); }).not.toThrow();
  }));

});
