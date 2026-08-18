/**
 * AST-based @example coverage report.
 *
 * Walks the TypeScript project from src/ts/index.ts and reports what
 * fraction of documented exported symbols include a `@example` JSDoc
 * tag. Pairs with doc_coverage: doc_coverage measures whether things
 * have JSDoc at all; example_coverage measures whether documented
 * things illustrate their behavior with a worked example.
 *
 * @example
 *   // Invoked by the `example_coverage` npm script:
 *   node src/build_js/count_example_coverage.js
 *   // Produces coverage-example/coverage-example.json:
 *   //   { percent: 100, expected: 1, actual: 1, missing: [] }
 */

import ts from 'typescript';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..', '..');
const tsconfigPath = join(projectRoot, 'tsconfig.json');
const entryPath = join(projectRoot, 'src', 'ts', 'index.ts');
const outDir = join(projectRoot, 'coverage-example');
const outPath = join(outDir, 'coverage-example.json');

/**
 * Loads the TypeScript program from tsconfig.json.
 *
 * Reads and parses the project's tsconfig.json, then creates a
 * TypeScript compiler program with the resolved file names and
 * compiler options.
 *
 * @example
 *   const program = loadProgram();
 *   const checker = program.getTypeChecker();
 */
function loadProgram() {
  const configText = readFileSync(tsconfigPath, 'utf8');
  const { config } = ts.parseConfigFileTextToJson(tsconfigPath, configText);
  const parsed = ts.parseJsonConfigFileContent(config, ts.sys, projectRoot);
  return ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
}

/**
 * Returns true if the declaration has at least one JSDoc comment or tag.
 *
 * @param decl The TypeScript declaration node to check.
 *
 * @example
 *   if (hasJsDoc(decl)) { // declaration is documented }
 */
function hasJsDoc(decl) {
  return ts.getJSDocCommentsAndTags(decl).length > 0;
}

/**
 * Returns true if the declaration has at least one `@example` JSDoc tag.
 *
 * @param decl The TypeScript declaration node to check.
 *
 * @example
 *   if (hasExampleTag(decl)) { // declaration has a usage example }
 */
function hasExampleTag(decl) {
  const tags = ts.getJSDocTags(decl);
  return tags.some(t => t.tagName?.text === 'example');
}

/**
 * Returns true if the declaration has the `private` modifier.
 *
 * @param decl The TypeScript declaration node to inspect.
 *
 * @example
 *   if (!isPrivate(decl)) { // safe to include in public coverage }
 */
function isPrivate(decl) {
  const modifiers = ts.canHaveModifiers(decl) ? ts.getModifiers(decl) : undefined;
  if (!modifiers) return false;
  return modifiers.some(m => m.kind === ts.SyntaxKind.PrivateKeyword);
}

/**
 * Resolves an alias symbol to the underlying target symbol.
 *
 * When a symbol has the Alias flag (i.e., it is a re-export), follows
 * the alias chain to the original declaration so that coverage is
 * attributed to the canonical symbol rather than the re-export stub.
 *
 * @param checker The TypeScript type checker.
 * @param sym The symbol to resolve.
 *
 * @example
 *   const real = resolveAlias(checker, aliasSym);
 *   // real is now the original declaration's symbol
 */
function resolveAlias(checker, sym) {
  if (sym.flags & ts.SymbolFlags.Alias) {
    try { return checker.getAliasedSymbol(sym); }
    catch { return sym; }
  }
  return sym;
}

/**
 * Recursively walks a module's exports and categorises documented symbols.
 *
 * For each exported symbol: skips private and undocumented declarations
 * (undocumented coverage is tracked by doc_coverage, not here), then
 * records whether the declaration carries an `@example` tag. Also
 * recurses into class and interface members.
 *
 * @param checker      The TypeScript type checker.
 * @param moduleSymbol The module symbol whose exports are walked.
 * @param prefix       Dot-separated name prefix for nested members.
 * @param seen         Set of already-visited declarations (prevents double-counting).
 * @param withExample  Accumulator set of names that have `@example`.
 * @param withoutExample Accumulator array of names that are documented but lack `@example`.
 *
 * @example
 *   const seen = new Set();
 *   const withExample = new Set();
 *   const withoutExample = [];
 *   walkExports(checker, moduleSymbol, '', seen, withExample, withoutExample);
 */
function walkExports(checker, moduleSymbol, prefix, seen, withExample, withoutExample) {
  const exports = checker.getExportsOfModule(moduleSymbol);
  for (const aliasSym of exports) {
    const sym = resolveAlias(checker, aliasSym);
    const decls = sym.declarations ?? [];
    for (const decl of decls) {
      if (seen.has(decl)) continue;
      seen.add(decl);
      if (isPrivate(decl)) continue;
      if (!hasJsDoc(decl)) continue;  // doc_coverage handles undocumented entities

      const fullName = prefix ? `${prefix}.${aliasSym.name}` : aliasSym.name;
      if (hasExampleTag(decl)) {
        withExample.add(fullName);
      } else {
        withoutExample.push(fullName);
      }

      // recurse into class/interface members
      if (ts.isClassDeclaration(decl) || ts.isInterfaceDeclaration(decl)) {
        for (const member of decl.members ?? []) {
          if (seen.has(member)) continue;
          seen.add(member);
          if (isPrivate(member)) continue;
          if (!hasJsDoc(member)) continue;
          const memberName = member.name && ts.isIdentifier(member.name)
            ? `${fullName}.${member.name.text}`
            : `${fullName}.<unknown>`;
          if (hasExampleTag(member)) {
            withExample.add(memberName);
          } else {
            withoutExample.push(memberName);
          }
        }
      }
    }
  }
}

/**
 * Entry point: runs the coverage walk and writes coverage-example.json.
 *
 * Loads the TypeScript program, resolves the entry module symbol,
 * walks all exports, computes percent coverage, and writes the result
 * to coverage-example/coverage-example.json.
 *
 * @example
 *   // Called automatically at the bottom of this module:
 *   main();
 *   // Writes { percent, expected, actual, missing } to coverage-example/coverage-example.json
 */
function main() {
  const program = loadProgram();
  const checker = program.getTypeChecker();
  const entry = program.getSourceFile(entryPath);
  if (!entry) throw new Error(`Could not load entry source file: ${entryPath}`);
  const moduleSymbol = checker.getSymbolAtLocation(entry);
  if (!moduleSymbol) throw new Error(`Could not resolve module symbol for entry`);

  const seen = new Set();
  const withExample = new Set();
  const withoutExample = [];
  walkExports(checker, moduleSymbol, '', seen, withExample, withoutExample);

  const expected = withExample.size + withoutExample.length;
  const actual = withExample.size;
  const percent = expected === 0 ? 100 : Math.round((actual / expected) * 100);

  mkdirSync(outDir, { recursive: true });
  const out = { percent, expected, actual, missing: withoutExample };
  writeFileSync(outPath, JSON.stringify(out), 'utf8');
  console.log(`example_coverage: ${percent}% (${actual}/${expected} documented entities have @example) -> ${outPath}`);
}

try {
  main();
} catch (err) {
  console.error(`example_coverage failed: ${err.message}`);
  process.exit(1);
}
