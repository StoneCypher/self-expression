/**
 * Fast AST-based documentation coverage report.
 *
 * Walks the TypeScript project reachable from src/ts/index.ts and reports
 * what fraction of documentable symbols have leading JSDoc comments. The
 * output shape matches typedoc-plugin-coverage so update_madlibs.js can
 * read it transparently. Runs in ~200ms vs typedoc's ~7s on this project.
 *
 * Documentable symbols are: every symbol exported from the module entry
 * point (index.ts), and every non-private member of exported classes and
 * interfaces. Private members (TypeScript `private` keyword) are excluded
 * to mirror typedoc's `excludePrivate: true` default.
 *
 * @example
 *   // Invoked by the `doc_coverage` npm script:
 *   node src/build_js/count_doc_coverage.js
 *   // Produces coverage-typedoc/coverage-typedoc.json:
 *   //   { percent: 50, expected: 2, actual: 1, notDocumented: ["unhandled_external.unhandled_external"] }
 */

import ts from 'typescript';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const projectRoot = join(__dirname, '..', '..');
const tsconfigPath = join(projectRoot, 'tsconfig.json');
const entryPath    = join(projectRoot, 'src', 'ts', 'index.ts');
const outDir       = join(projectRoot, 'coverage-typedoc');
const outPath      = join(outDir, 'coverage-typedoc.json');

/**
 * Loads and compiles the TypeScript project described by tsconfig.json.
 *
 * Reads tsconfig.json, parses it with the TypeScript compiler API, and
 * returns a Program covering all included source files.
 *
 * @returns A TypeScript Program rooted at the project tsconfig.
 *
 * @example
 *   const program = loadProgram();
 *   const checker = program.getTypeChecker();
 */
function loadProgram() {
  const configText  = readFileSync(tsconfigPath, 'utf8');
  const { config }  = ts.parseConfigFileTextToJson(tsconfigPath, configText);
  const parsed      = ts.parseJsonConfigFileContent(config, ts.sys, projectRoot);
  return ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
}

/**
 * Returns true when the declaration node has at least one leading JSDoc
 * comment or JSDoc tag attached to it.
 *
 * Uses the compiler API helper rather than scanning raw text so that
 * multi-line comments and `@param` tags are all handled uniformly.
 *
 * @param decl - Any TypeScript declaration node.
 * @returns Whether the declaration has JSDoc documentation.
 *
 * @example
 *   // Given: /** docs *\/ export function foo() {}
 *   hasJsDoc(fooDecl); // true
 *   // Given: export function bar() {}
 *   hasJsDoc(barDecl); // false
 */
function hasJsDoc(decl) {
  const tags = ts.getJSDocCommentsAndTags(decl);
  return tags.length > 0;
}

/**
 * Returns true when the declaration carries the `private` TypeScript modifier.
 *
 * Mirrors typedoc's `excludePrivate: true` default so that private class
 * members are not counted against coverage.
 *
 * @param decl - Any TypeScript declaration node.
 * @returns Whether the declaration is explicitly marked private.
 *
 * @example
 *   // class C { private x = 1; }  → true for x
 *   // class C { x = 1; }          → false for x
 */
function isPrivate(decl) {
  const modifiers = ts.canHaveModifiers(decl) ? ts.getModifiers(decl) : undefined;
  if (!modifiers) return false;
  return modifiers.some(m => m.kind === ts.SyntaxKind.PrivateKeyword);
}

/**
 * Builds a dotted display name for a symbol, optionally prefixed by the
 * module or parent scope name.
 *
 * @param sym    - The TypeScript Symbol whose name to use.
 * @param prefix - Scope prefix, e.g. the module or class name. Empty string
 *                 means top-level.
 * @returns The qualified symbol name, e.g. `"MyClass.myMethod"`.
 *
 * @example
 *   symbolName(sym, '');        // 'myFunction'
 *   symbolName(sym, 'MyClass'); // 'MyClass.myMethod'
 */
function symbolName(sym, prefix) {
  return prefix ? `${prefix}.${sym.name}` : sym.name;
}

/**
 * Resolves a symbol to its canonical (non-alias) form.
 *
 * When a module re-exports a symbol via `export { foo } from './bar'`, the
 * exported symbol is an alias. Following the alias gives the original
 * FunctionDeclaration (or ClassDeclaration, etc.) that carries the JSDoc
 * comment. If the symbol is not an alias it is returned as-is.
 *
 * @param checker - The TypeScript TypeChecker.
 * @param sym     - The symbol to resolve.
 * @returns The underlying symbol, with aliases followed.
 *
 * @example
 *   // export { double } from './stub.js'  → FunctionDeclaration symbol for double
 *   resolveAlias(checker, exportedDoubleSym).name; // 'double'
 */
function resolveAlias(checker, sym) {
  return (sym.flags & ts.SymbolFlags.Alias) ? checker.getAliasedSymbol(sym) : sym;
}

/**
 * Recursively walks the exports of a module symbol and classifies each
 * documentable declaration as documented or not.
 *
 * For class and interface declarations, the function also recurses into
 * their non-private members. Declarations already visited (tracked via
 * `seen`) are skipped to avoid double-counting re-exports.
 *
 * Re-exported symbols (aliases) are followed to their underlying declarations
 * so that JSDoc attached to the original declaration is recognised correctly.
 *
 * @param checker      - The TypeScript TypeChecker for the compiled program.
 * @param moduleSymbol - The Symbol representing the module whose exports
 *                       should be walked.
 * @param prefix       - Display-name prefix for nested symbols (empty at
 *                       the top level).
 * @param seen         - Set of already-visited declaration nodes; mutated
 *                       in place to prevent double-counting.
 * @param documented   - Set of fully-qualified names that have JSDoc;
 *                       mutated in place.
 * @param notDocumented - Array of fully-qualified names that lack JSDoc;
 *                        mutated in place.
 *
 * @example
 *   const documented   = new Set();
 *   const notDocumented = [];
 *   walkExports(checker, moduleSymbol, '', new Set(), documented, notDocumented);
 *   // documented   → Set { 'double' }
 *   // notDocumented → ['unhandled_external']
 */
function walkExports(checker, moduleSymbol, prefix, seen, documented, notDocumented) {
  const exports = checker.getExportsOfModule(moduleSymbol);
  for (const sym of exports) {
    // Follow aliases so we reach the actual declaration with its JSDoc.
    const resolved = resolveAlias(checker, sym);
    const decls = resolved.declarations ?? sym.declarations ?? [];
    for (const decl of decls) {
      if (seen.has(decl)) continue;
      seen.add(decl);
      if (isPrivate(decl)) continue;

      const fullName = symbolName(sym, prefix);

      if (hasJsDoc(decl)) {
        documented.add(fullName);
      } else {
        notDocumented.push(fullName);
      }

      // Recurse into class and interface members.
      if (ts.isClassDeclaration(decl) || ts.isInterfaceDeclaration(decl)) {
        for (const member of decl.members ?? []) {
          if (seen.has(member)) continue;
          seen.add(member);
          if (isPrivate(member)) continue;
          const memberName = member.name && ts.isIdentifier(member.name)
            ? `${fullName}.${member.name.text}`
            : `${fullName}.<unknown>`;
          if (hasJsDoc(member)) {
            documented.add(memberName);
          } else {
            notDocumented.push(memberName);
          }
        }
      }
    }
  }
}

/**
 * Entry point: loads the program, walks exports from the entry file,
 * computes coverage, and writes `coverage-typedoc/coverage-typedoc.json`.
 *
 * Exits with code 1 on any error so build pipelines can detect failure.
 *
 * @throws {Error} If the entry source file cannot be loaded or its module
 *   symbol cannot be resolved.
 *
 * @example
 *   // Run directly:
 *   node src/build_js/count_doc_coverage.js
 *   // Prints: doc_coverage: 50% (1/2) -> .../coverage-typedoc/coverage-typedoc.json
 */
function main() {
  const program = loadProgram();
  const checker = program.getTypeChecker();
  const entry   = program.getSourceFile(entryPath);
  if (!entry) throw new Error(`Could not load entry source file: ${entryPath}`);
  const moduleSymbol = checker.getSymbolAtLocation(entry);
  if (!moduleSymbol) throw new Error(`Could not resolve module symbol for entry`);

  const seen          = new Set();
  const documented    = new Set();
  const notDocumented = [];
  walkExports(checker, moduleSymbol, '', seen, documented, notDocumented);

  const expected = documented.size + notDocumented.length;
  const actual   = documented.size;
  const percent  = expected === 0 ? 100 : Math.round((actual / expected) * 100);

  mkdirSync(outDir, { recursive: true });
  const out = { percent, expected, actual, notDocumented };
  writeFileSync(outPath, JSON.stringify(out), 'utf8');
  console.log(`doc_coverage: ${percent}% (${actual}/${expected}) -> ${outPath}`);
}

try {
  main();
} catch (err) {
  console.error(`doc_coverage failed: ${err.message}`);
  process.exit(1);
}
