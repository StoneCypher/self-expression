/**
 * Unit tests for injecting the core conventions at session start: frontmatter stripping,
 * the framed document, every `SessionStart` source under every `inject.conventions` mode,
 * failing open on a missing file, combination with unread notes to self, and the
 * handshake pointer that has to know injection may already have happened.
 *
 * Most cases read a small fixture package written to a temporary directory, so the
 * expected text is known exactly rather than derived from the code under test. One group
 * reads the **real** shipped `SKILL.md`, because the claim that matters in production is
 * "the injected text is that file, minus its frontmatter", and only the real file proves it.
 *
 * @see ../channels/conventions.js injectedConventions
 * @see ../mcp/hooks.js onSessionStart
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir }                 from 'node:os';
import { join }                   from 'node:path';
import { describe, test, expect } from 'vitest';

import { openStore, closeStore, writeConfig } from '../channels/store.js';
import type { Store }                         from '../channels/store.js';
import { postMessage, unreadCounts }          from '../channels/messages.js';
import {
  configKey, injectMode, DEFAULT_INJECT_MODE, INJECT_CONVENTIONS_KEY, INJECT_MODES,
} from '../channels/config.js';
import {
  INJECTED_CONVENTIONS_HEADER, INJECTED_CONVENTIONS_MARK, availableConventions,
  conventionsPointer, findPackageRoot, injectedConventions, notInjectedLine, stripFrontmatter,
} from '../channels/conventions.js';
import {
  conventionsBlock, handleHook, onSessionStart, shouldInjectConventions,
} from '../mcp/hooks.js';
import { serverInstructions } from '../mcp/server.js';

/** The repository root, which is also the package root under the test runner. */
const ROOT = findPackageRoot(process.cwd());

const NOW     = new Date('2026-09-23T12:00:00Z');
const VERSION = '0.8.0';
const SOURCES = ['startup', 'resume', 'clear', 'compact'] as const;

/** The fixture skill: frontmatter, then a body whose every line the tests can name. */
const FIXTURE_SKILL =
  '---\nname: self-expression\ndescription: fixture trigger text\n---\n\n' +
  '# Fixture conventions\n\nSign every turn.\n';

/** Exactly what injecting {@link FIXTURE_SKILL} must produce, written out by hand. */
const FIXTURE_INJECTED =
  'Self-expression conventions (injected at session start; these govern express, ' +
  'signatures and channel lines):\n\n# Fixture conventions\n\nSign every turn.\n\n' +
  'Not injected: the party-roster / audio-expression / dwelling / status-checklists ' +
  'conventions, available as MCP resources at self-expression://conventions/<name>.';

function withStore<T>(fn: (s: Store) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'se-inject-')),
        s   = openStore(join(dir, 'log.sqlite3'));
  try { return fn(s); } finally { closeStore(s); rmSync(dir, { recursive: true, force: true }); }
}

/** A throwaway package root holding `skills/self-expression/SKILL.md` with `body`. */
function withRoot<T>(body: string, fn: (root: string) => T): T {
  const root = mkdtempSync(join(tmpdir(), 'se-inject-root-'));
  try {
    mkdirSync(join(root, 'skills', 'self-expression'), { recursive: true });
    writeFileSync(join(root, 'skills', 'self-expression', 'SKILL.md'), body, 'utf8');
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** A throwaway directory with no conventions file in it. */
function withEmptyRoot<T>(fn: (root: string) => T): T {
  const root = mkdtempSync(join(tmpdir(), 'se-inject-empty-'));
  try { return fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

function contextOf(out: unknown): string {
  return String((out as { hookSpecificOutput: { additionalContext: string } })
    .hookSpecificOutput.additionalContext);
}

describe('stripFrontmatter', () => {

  test('removes a leading block and the blank lines under it', () => {
    expect(stripFrontmatter('---\nname: x\n---\n\n# Body\n')).toBe('# Body\n');
  });

  test('handles CRLF line endings, which a Windows checkout produces', () => {
    expect(stripFrontmatter('---\r\nname: x\r\n---\r\n\r\n# Body\r\n')).toBe('# Body\r\n');
  });

  test('tolerates a byte-order mark before the opening fence', () => {
    expect(stripFrontmatter(`${String.fromCharCode(0xFEFF)}---\nname: x\n---\nBody`)).toBe('Body');
  });

  test('an empty block is still a block', () => {
    expect(stripFrontmatter('---\n---\nBody')).toBe('Body');
  });

  test('text with no frontmatter comes back unchanged', () => {
    expect(stripFrontmatter('# Title\n\n---\n\nafter a rule')).toBe('# Title\n\n---\n\nafter a rule');
  });

  test('an unclosed fence is not frontmatter, and nothing is deleted on a guess', () => {
    expect(stripFrontmatter('---\nname: x\n# never closed')).toBe('---\nname: x\n# never closed');
  });

  test('only the first closing fence ends the block; a later rule stays in the body', () => {
    expect(stripFrontmatter('---\na: 1\n---\nintro\n---\nmore')).toBe('intro\n---\nmore');
  });

  test('a fence line must be exactly three dashes', () => {
    expect(stripFrontmatter('----\na: 1\n----\nx')).toBe('----\na: 1\n----\nx');
  });

});

describe('injectedConventions — the framed document', () => {

  test('the fixture frames to exactly the expected text', () => withRoot(FIXTURE_SKILL, root => {
    expect(injectedConventions(root)).toEqual({ ok: true, text: FIXTURE_INJECTED });
  }));

  test('the header is the one line the task specified', () => {
    expect(INJECTED_CONVENTIONS_HEADER).toBe(
      'Self-expression conventions (injected at session start; these govern express, ' +
      'signatures and channel lines):');
    expect(INJECTED_CONVENTIONS_HEADER.startsWith(INJECTED_CONVENTIONS_MARK)).toBe(true);
  });

  test('the other skills are named, not injected, and the core one is not in the list', () => {
    const line = notInjectedLine();
    for (const name of ['party-roster', 'audio-expression', 'dwelling', 'status-checklists']) {
      expect(line).toContain(name);
    }
    expect(line).not.toMatch(/the self-expression /);
    expect(line).toContain('self-expression://conventions/');
  });

  test('a missing file is a problem report naming the path, never a throw', () => withEmptyRoot(root => {
    const result = injectedConventions(root);
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.problem).toContain('SKILL.md');
  }));

  test('no root at all is a problem report too', () => {
    expect(injectedConventions(null).ok).toBe(false);
  });

  test('a file that is only frontmatter has nothing to inject', () => withRoot('---\nname: x\n---\n\n', root => {
    const result = injectedConventions(root);
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.problem).toContain('no body');
  }));

});

describe('the real shipped SKILL.md', () => {

  test('the injected body is the file after its frontmatter, and the frontmatter is gone', () => {
    expect(ROOT).not.toBeNull();
    const file   = readFileSync(join(ROOT ?? '', 'skills', 'self-expression', 'SKILL.md'), 'utf8'),
          lines  = file.split(/\r?\n/),
          close  = lines.indexOf('---', 1),
          after  = lines.slice(close + 1).join('\n').trim(),
          result = injectedConventions(ROOT);
    expect(close).toBeGreaterThan(0);
    expect(result.ok).toBe(true);
    const text = result.ok ? result.text.replace(/\r\n/g, '\n') : '';
    expect(text).toContain(after);
    expect(text).not.toContain('name: self-expression');
    expect(lines[2]?.startsWith('description: ')).toBe(true);
    expect(text).not.toContain(lines[2] ?? '');
    expect(text.startsWith(`${INJECTED_CONVENTIONS_HEADER}\n\n# Self Expression`)).toBe(true);
  });

});

describe('shouldInjectConventions', () => {

  test('always injects on every source, including a missing and an unfamiliar one', () => {
    for (const source of [...SOURCES, 'fork', undefined]) {
      expect(shouldInjectConventions('always', source)).toBe(true);
    }
  });

  test('startup-only injects on startup and nothing else', () => {
    expect(shouldInjectConventions('startup-only', 'startup')).toBe(true);
    for (const source of ['resume', 'clear', 'compact', 'fork', undefined]) {
      expect(shouldInjectConventions('startup-only', source)).toBe(false);
    }
  });

  test('off never injects', () => {
    for (const source of [...SOURCES, undefined]) {
      expect(shouldInjectConventions('off', source)).toBe(false);
    }
  });

});

describe('the inject.conventions key', () => {

  test('it is a registered enum of always, startup-only, and off, defaulting to always', () => {
    expect(INJECT_CONVENTIONS_KEY).toBe('inject.conventions');
    expect([...INJECT_MODES]).toEqual(['always', 'startup-only', 'off']);
    expect(configKey('inject.conventions')).toMatchObject({
      kind: 'enum', fallback: 'always', choices: ['always', 'startup-only', 'off'] });
    expect(DEFAULT_INJECT_MODE).toBe('always');
  });

  test('injectMode reads the default, each valid value, and treats junk as unset', () => withStore(s => {
    expect(injectMode(s)).toBe('always');
    writeConfig(s, 'inject.conventions', 'startup-only');
    expect(injectMode(s)).toBe('startup-only');
    writeConfig(s, 'inject.conventions', 'OFF');
    expect(injectMode(s)).toBe('off');
    writeConfig(s, 'inject.conventions', 'sometimes');
    expect(injectMode(s)).toBe('always');
  }));

  test('the validator rejects an unknown mode, naming the choices', () => {
    const outcome = configKey('inject.conventions')?.validate('never');
    expect(outcome?.ok).toBe(false);
    expect(outcome !== undefined && !outcome.ok ? outcome.expected : '').toContain("'startup-only'");
  });

});

describe('onSessionStart — every source under the default mode', () => {

  for (const source of SOURCES) {
    test(`${source} injects the conventions`, () => withStore(s => withRoot(FIXTURE_SKILL, root => {
      const out = onSessionStart(s, { session_id: 'sess-1', source }, NOW, { root });
      expect(contextOf(out)).toBe(FIXTURE_INJECTED);
      expect((out as { hookSpecificOutput: { hookEventName: string } })
        .hookSpecificOutput.hookEventName).toBe('SessionStart');
    })));
  }

});

describe('onSessionStart — the three modes', () => {

  test('startup-only injects on startup, and on nothing else', () => withStore(s => withRoot(FIXTURE_SKILL, root => {
    writeConfig(s, 'inject.conventions', 'startup-only');
    expect(contextOf(onSessionStart(s, { session_id: 'a', source: 'startup' }, NOW, { root })))
      .toBe(FIXTURE_INJECTED);
    for (const source of ['resume', 'clear', 'compact']) {
      expect(onSessionStart(s, { session_id: 'a', source }, NOW, { root }), source).toBeNull();
    }
  })));

  test('off injects on no source at all', () => withStore(s => withRoot(FIXTURE_SKILL, root => {
    writeConfig(s, 'inject.conventions', 'off');
    for (const source of SOURCES) {
      expect(onSessionStart(s, { session_id: 'a', source }, NOW, { root }), source).toBeNull();
    }
  })));

  test('always is the default, and setting it explicitly changes nothing', () => withStore(s => withRoot(FIXTURE_SKILL, root => {
    const before = onSessionStart(s, { session_id: 'a', source: 'clear' }, NOW, { root });
    writeConfig(s, 'inject.conventions', 'always');
    expect(onSessionStart(s, { session_id: 'a', source: 'clear' }, NOW, { root })).toEqual(before);
  })));

  test('with no store the mode is the default, so the conventions still arrive', () => withRoot(FIXTURE_SKILL, root => {
    expect(contextOf(onSessionStart(null, { source: 'compact' }, NOW, { root }))).toBe(FIXTURE_INJECTED);
  }));

});

describe('onSessionStart — failing open', () => {

  test('a missing conventions file injects nothing and logs why', () => withStore(s => withEmptyRoot(root => {
    const logged: string[] = [];
    expect(onSessionStart(s, { session_id: 'a', source: 'startup' }, NOW,
      { root, log: line => { logged.push(line); } })).toBeNull();
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain('conventions not injected');
    expect(logged[0]).toContain('SKILL.md');
  })));

  test('a missing file still delivers the unread notes', () => withStore(s => withEmptyRoot(root => {
    postMessage(s, { audience: 'self', text: 'resume at step 3', session: 'sess-1' }, VERSION, NOW);
    const logged: string[] = [],
          out = onSessionStart(s, { session_id: 'sess-1', source: 'compact' }, NOW,
            { root, log: line => { logged.push(line); } });
    expect(contextOf(out)).toContain('resume at step 3');
    expect(contextOf(out)).not.toContain(INJECTED_CONVENTIONS_MARK);
    expect(logged).toHaveLength(1);
  })));

  test('a logger that throws cannot wedge the session start', () => withStore(s => withEmptyRoot(root => {
    expect(() => onSessionStart(s, { session_id: 'a', source: 'startup' }, NOW,
      { root, log: () => { throw new Error('stderr is gone'); } })).not.toThrow();
  })));

  test('a broken config table falls back to the default mode rather than throwing', () => withStore(s => withRoot(FIXTURE_SKILL, root => {
    s.db.exec('DROP TABLE config');
    expect(contextOf(onSessionStart(s, { session_id: 'a', source: 'startup' }, NOW, { root })))
      .toBe(FIXTURE_INJECTED);
  })));

  test('no root means the caller did not opt in: nothing is read and nothing is logged', () => withStore(s => {
    const logged: string[] = [];
    expect(conventionsBlock(s, 'startup', { log: line => { logged.push(line); } })).toBeNull();
    expect(logged).toEqual([]);
  }));

});

describe('onSessionStart — combined with unread notes to self', () => {

  test('compact hands over both, notes first, separated by a blank line', () => withStore(s => withRoot(FIXTURE_SKILL, root => {
    postMessage(s, { audience: 'self', text: 'the branch is feat_x', session: 'sess-1' }, VERSION, NOW);
    const context = contextOf(onSessionStart(s, { session_id: 'sess-1', source: 'compact' }, NOW, { root }));
    expect(context.startsWith('Unread notes from your earlier self in this session (now delivered):\n')).toBe(true);
    expect(context).toContain('the branch is feat_x');
    expect(context.endsWith(`\n\n${FIXTURE_INJECTED}`)).toBe(true);
  })));

  test('the notes are still receipted, so the next start hands over only the conventions', () => withStore(s => withRoot(FIXTURE_SKILL, root => {
    postMessage(s, { audience: 'self', text: 'once only', session: 'sess-1' }, VERSION, NOW);
    onSessionStart(s, { session_id: 'sess-1', source: 'resume' }, NOW, { root });
    expect(contextOf(onSessionStart(s, { session_id: 'sess-1', source: 'resume' }, NOW, { root })))
      .toBe(FIXTURE_INJECTED);
  })));

  test('startup injects the conventions and leaves the notes unread', () => withStore(s => withRoot(FIXTURE_SKILL, root => {
    postMessage(s, { audience: 'self', text: 'not yet', session: 'sess-1' }, VERSION, NOW);
    expect(contextOf(onSessionStart(s, { session_id: 'sess-1', source: 'startup' }, NOW, { root })))
      .toBe(FIXTURE_INJECTED);
    expect(unreadCounts(s, 'sess-1', NOW).forModel).toBe(1);
  })));

  test('with injection off, the notes behave exactly as before', () => withStore(s => withRoot(FIXTURE_SKILL, root => {
    writeConfig(s, 'inject.conventions', 'off');
    postMessage(s, { audience: 'self', text: 'just this', session: 'sess-1' }, VERSION, NOW);
    expect(contextOf(onSessionStart(s, { session_id: 'sess-1', source: 'compact' }, NOW, { root })))
      .toMatch(/^Unread notes from your earlier self in this session \(now delivered\):\n- \[.*\] just this$/);
  })));

  test('handleHook passes the root through to session-start', () => withStore(s => withRoot(FIXTURE_SKILL, root => {
    expect(contextOf(handleHook('session-start', s, { source: 'clear' }, NOW, { root })))
      .toBe(FIXTURE_INJECTED);
    expect(handleHook('session-start', s, { source: 'clear' }, NOW)).toBeNull();
  })));

});

describe('the handshake pointer, when injection may have happened', () => {

  test('with injection on, it names the injected heading and still tells a hookless host to read', () => {
    const line = conventionsPointer(availableConventions(ROOT), true) ?? '';
    expect(line).toContain(INJECTED_CONVENTIONS_MARK);
    expect(line).toContain('Otherwise read the core document');
  });

  test('with injection off, it never mentions a block that will not arrive', () => {
    const line = conventionsPointer(availableConventions(ROOT), false) ?? '';
    expect(line).not.toContain(INJECTED_CONVENTIONS_MARK);
    expect(line).toContain('Otherwise read the core document');
  });

  test('it still fits the handshake budget with the extra clause', () => {
    expect((conventionsPointer(availableConventions(ROOT), true) ?? '').length).toBeLessThan(700);
  });

  test('serverInstructions follows inject.conventions', () => withStore(s => {
    expect(serverInstructions(s, availableConventions(ROOT))).toContain(INJECTED_CONVENTIONS_MARK);
    writeConfig(s, 'inject.conventions', 'startup-only');
    expect(serverInstructions(s, availableConventions(ROOT))).toContain(INJECTED_CONVENTIONS_MARK);
    writeConfig(s, 'inject.conventions', 'off');
    expect(serverInstructions(s, availableConventions(ROOT))).not.toContain(INJECTED_CONVENTIONS_MARK);
  }));

});
