/**
 * Run type-coverage against the project's TypeScript code and write a
 * JSON report to build/type-coverage/coverage.json with shape
 * { percent, totalCount, correctCount }.
 *
 * Shells out to the type-coverage CLI in JSON mode rather than using
 * the Node API directly — the CLI already respects the project's
 * tsconfig and produces a stable JSON format.
 *
 * @example
 *   // Invoked by the `type_coverage` npm script:
 *   node src/build_js/run_type_coverage.js
 *   // Produces build/type-coverage/coverage.json with:
 *   //   { "percent": 100, "totalCount": 42, "correctCount": 42 }
 */

import { execFileSync } from 'child_process';
import { mkdirSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..', '..');
const outDir = join(projectRoot, 'build', 'type-coverage');
const outPath = join(outDir, 'coverage.json');

function runTypeCoverage() {
  // CLI: type-coverage --json-output
  // Outputs JSON directly: { correctCount, totalCount, percent, ... }
  // This is more reliable than parsing text output.
  const bin = join(projectRoot, 'node_modules', '.bin', 'type-coverage');
  const stdout = execFileSync(bin, ['--json-output'], {
    cwd: projectRoot,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });

  // Find the JSON object in the output (it may be preceded by JSON.stringify of text output)
  // The CLI prints the result object as JSON when --json-output is used
  let jsonMatch = null;
  try {
    // Try to parse the entire output first
    const parsed = JSON.parse(stdout);
    if (parsed && typeof parsed === 'object' && 'percent' in parsed) {
      jsonMatch = parsed;
    }
  } catch {
    // If that fails, look for a JSON object in the output
    const lines = stdout.trim().split('\n');
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed && typeof parsed === 'object' && 'percent' in parsed) {
          jsonMatch = parsed;
          break;
        }
      } catch {
        // Not JSON, continue
      }
    }
  }

  if (jsonMatch) {
    return {
      correctCount: jsonMatch.correctCount ?? null,
      totalCount: jsonMatch.totalCount ?? null,
      percent: Number(jsonMatch.percent),
    };
  }

  // Fallback: parse text format if JSON parsing fails
  // Remove ANSI color codes if present
  const clean = stdout.replace(/\x1b\[[0-9;]*m/g, '');
  const lines = clean.trim().split('\n').filter(l => l.trim());

  // Search for "correctCount / totalCount percentString%" pattern
  // e.g. "42 / 42 100.00%"
  for (const line of lines) {
    const m = line.match(/\((\d+)\s*\/\s*(\d+)\)\s*([\d.]+)%/);
    if (m) {
      return {
        correctCount: Number(m[1]),
        totalCount: Number(m[2]),
        percent: Number(m[3]),
      };
    }
  }

  throw new Error(`type-coverage produced unexpected output (stdout: "${clean}")`);
}

function main() {
  const result = runTypeCoverage();
  mkdirSync(outDir, { recursive: true });
  writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8');
  const cc = result.correctCount ?? '?';
  const tc = result.totalCount ?? '?';
  console.log(`type_coverage: ${result.percent}% (${cc}/${tc}) -> ${outPath}`);
}

try {
  main();
} catch (err) {
  console.error(`type_coverage failed: ${err.message}`);
  process.exit(1);
}
