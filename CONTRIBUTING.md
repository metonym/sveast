# Contributing

This guide covers how sveast is built, the rules every change must keep, and how to verify a change before it merges. Read it in full before changing anything under `src/`.

## Setup

[Bun](https://bun.sh/) is the package manager, test runner and bundler.

```sh
bun ci
bun run test          # svelte/compiler and acorn-typescript parity, API, fuzzer smoke test
bun run test:package  # build, pack, install, and use it as a consumer would
bun run typecheck
bun run lint          # biome; `bun run lint:fix` formats and applies fixes
bun run build         # dist/: minified ESM with acorn bundled, split for consumers' bundlers, bundled index.d.ts, slimmed package.json
bun run fuzz          # differential fuzzer against svelte/compiler
```

## How it works

`parse` (`src/parse.ts`) walks the source once with a cursor and an open-element stack (`TemplateParserState` in `src/state.ts`). Each step starts at `<`, `{` or text. The files follow svelte's `src/compiler/phases/1-parse/`.

1. **Markup.** `src/elements.ts` reads tags, attributes and directives, `src/autoclosing.ts` applies HTML's tag-omission rules, and `src/text.ts` reads text. `<svelte:options>` is read as an element, then moved to `Root.options` (`src/read-options.ts`). `src/style.ts` parses `<style>`.
2. **Tags.** `src/tag.ts` dispatches `{...}` and reads `{let}`/`{const}` declarations: blocks (`src/blocks.ts`), `{@...}` tags (`src/special-tags.ts`) and expressions (`src/expression.ts`, which reads identifiers, member chains and literals without acorn). Destructuring patterns and type annotations go through `src/context.ts`.
3. **Scripts and expressions.** `src/acorn-bridge.ts` sets up acorn, plus `src/ts-plugin.ts` for `lang="ts"`, and turns acorn's errors into `js_parse_error`. `src/comments.ts` attaches comments. acorn starts at the expression's offset in the whole source, so node offsets need no shifting.
4. **Errors and locations.** Every error goes through a function in `src/errors.ts`, which throws a `ParseError` (`src/parse-error.ts`). `src/locator.ts` turns offsets into lines and columns, for errors and for `loc: true`. `src/errors.ts` passes only the reason, e.g. `"Unexpected token"`, and `ParseError` appends svelte's link, so `message` is always `reason`, a line break, then `https://svelte.dev/e/${code}`. That makes the shape a guarantee rather than something each message happens to follow, and tools that print one-line errors read `reason` instead of splitting `message`.
5. **Type text.** `isValidType` (`src/is-valid-type.ts`) calls the TypeScript plugin's `parseWholeType`, which parses one type and then requires the end of input. Wrapping the text as `type T = ${text};` and parsing a module instead would let a `;`, a line break, a `}` or a comment terminator in the text end the type and start a statement. `inline: true` watches the tokenizer's comments instead of parsing a second time: a `//` comment that isn't ended by a line break is the one that ends at the end of the text. Don't add a cache: callers know whether their texts repeat and can memoize. In front of the parser, `src/common-type.ts` reads the common shapes of JSDoc types (references with type arguments, literals, unions, arrays, object, tuple and function types) on one line without comments. The parser's first calls cost milliseconds, spent compiling and warming the code paths of the TypeScript grammar rather than in per-call setup, and a JavaScript-only consumer pays that on every run: the first 10 calls on typical types took 1.6 to 2.1 ms in Bun and Node, against 0.2 to 0.3 ms with the reader. It may only answer `true`; anything it isn't sure of, including every reserved word, goes to the parser. `tests/common-type.test.ts` checks that it never accepts what the parser rejects.
6. **Imports and exports.** `parseImportsExports` (`src/imports-exports.ts`) skips a module with a tokenizer that tracks only strings, comments, templates, regular expressions and brackets, and stops at each `import` or `export` word outside all brackets. It tells a regular expression from a division by the previous token, as acorn's tokenizer does: after a value (a name, a literal, `)`, `]`, or the `}` of an object), `/` divides. At each stop, `parseStatementsAt` (`src/acorn-bridge.ts`) moves one acorn parser there, so the node is `parseModule`'s and a name exported twice still throws. The scanner resumes at the statement's `end`. A wrong guess would drop or invent statements, so `tests/imports-exports.test.ts` checks it against `parseModule` on the corpus, and `scripts/compare-imports.ts` on the large corpora, also with an `import` inserted after every top-level statement, which checks the scanner's state at each statement boundary.
7. **Walking.** `walk` (`src/walk.ts`) reads `visitorKeys`, each node type's fields that hold child nodes, in source order. The table is typed against the AST, so a node type the types gain, or a key that isn't a field, fails `bun run typecheck`; `tests/walk.test.ts` checks it against the corpus, so a field that holds a node but isn't listed, or a key out of source order, fails the tests. When svelte or the TypeScript plugin adds a node or a field, add it here.

These files are generated from upstream sources. Don't edit them by hand; re-run the script after upgrading svelte:

| File | Generator | From |
|:---|:---|:---|
| `src/errors.ts` | `bun scripts/generate-errors.ts` | svelte's `errors.js`, so codes and messages match. The script strips each message's trailing link, which `ParseError` adds back, and fails if a message doesn't end with one |
| `src/entity-table.ts` | `bun scripts/generate-entities.ts` | The HTML standard's [`entities.json`](https://html.spec.whatwg.org/entities.json), the named character references |
| `src/types/estree.ts`, `src/types/svelte-ast.ts` | `bun scripts/generate-types.ts` | `@types/estree` and svelte's published `AST` types, so the package has no type dependencies. The script patches them to match the parser's output: offsets, the TypeScript nodes from the hand-written `src/types/typescript.ts`, fields svelte's types miss, and `StringLiteral` (a `Literal` whose `value` is a string) where the grammar only allows a string, such as an import's `source`, so consumers don't narrow `value` |

The build (`scripts/build.ts`) bundles acorn into a few ESM files: `index.js` only re-exports, `parse-module.js` holds `parseModule`, `parse-imports-exports.js` `parseImportsExports`, `parse.js` the template parser, `is-valid-type.js` `isValidType`, `walk.js` `walk` and `visitorKeys`, `core.js`, `typescript.js` and `entities.js` the `sveast/core`, `sveast/typescript` and `sveast/entities` entries, and shared chunks acorn, the TypeScript plugin, the entity table and the code they need. A consumer's bundler can then load `parseModule`, `parseImportsExports` or `isValidType` without the template parser (`"sideEffects": false` lets it drop the unused re-export). `walk.js` loads neither acorn nor the parser, `core.js` loads neither the TypeScript plugin nor the entity table, and `bun run test:package` checks both. `scripts/shrink-parser.ts` cuts its size: it stubs acorn's regex validator, replaces acorn's identifier tables with `\p{ID_Start}` and `\p{ID_Continue}` regexes, and shortens the TypeScript plugin's `ts*` member names. Each fails the build if the source it rewrites changes shape. The renaming only rewrites `src/ts-plugin.ts`, so a plugin method called from another file must not start with `ts` (hence `parseWholeType`).

`sveast/core` works because nothing in the parser imports the TypeScript plugin or the entity table. `TemplateParserState`, `parseModuleWith` (`src/module.ts`) and `parseImportsExportsWith` take them as values: the TypeScript parser (`src/typescript-parser.ts`, the plugin plus acorn-bridge's tweaks) and the decoded entity names (`src/entity-names.ts`). `parse` and `parseModule` pass both; `createParser` (`src/core.ts`) passes what it's given, or the five XML names (`xmlEntityNames` in `src/html-entities.ts`). Keep it that way: a static import of either from the parser puts it back in `core.js`. The public option and support types live in `src/options.ts`, which imports nothing, because the declaration bundler copies the external imports of every file it reaches into the `.d.ts`.

`parseModule` loads the TypeScript plugin even when `typescript` is `false`, because `typescript: true` must work synchronously and without a dynamic import. JavaScript-only consumers use `createParser()` from `sveast/core` instead.

## Rules every change must keep

- **svelte/compiler parity is the contract.** For every component, `parse(source, { loc: true })` must equal svelte's `parse(source, { modern: true })`, and the default `parse(source)` must equal it minus `loc` and `name_loc`. Where svelte throws, sveast throws a `ParseError` with the same code, message, position and frame. The only intended differences are in the README under "Differences from svelte/compiler".
- **The TypeScript plugin must match acorn-typescript.** Same nodes, same fields, same key order, and the same `loc` with `locations: true`.
- **TypeScript-only diagnostics are out of scope.** Modifier order, ambient-context and abstract-member checks, and the like, which acorn-typescript reports but valid code never hits, aren't ported. The README lists this as a difference.
- **Options are opt-outs from parity, not changes to it.** A new option must default to svelte's output and say in the README what it leaves out.
- **No runtime dependencies and no Node APIs in `src/`.** The build targets browsers, Node, Bun and Deno alike. Dev-only code (`tests/`, `bench/`, `scripts/`) may use anything.
- **Keep the public API small.** `src/index.ts` is the public API.
- **`tests/corpus` is data.** Biome ignores it. Never format it: whitespace in a `.svelte` file changes its AST.

## Tests

| File | Covers |
|:---|:---|
| `tests/parity.test.ts` | Every component in `tests/corpus` against svelte/compiler: the AST with and without `loc`, or the error; `script: false` against the full AST without the scripts' statements and comments; and `comments: false` against it without its JavaScript comments |
| `tests/ts-plugin.test.ts` | The TypeScript plugin against acorn-typescript, with and without `locations` |
| `tests/walk.test.ts` | `walk` on the corpus's ASTs and `tests/ts-snippets.ts`: it reaches every node once, children in source order, and `parent`, `key` and `index` locate each node |
| `tests/types.test.ts` | The exported types against the corpus's ASTs and `tests/ts-snippets.ts`: every node `type` and field is declared, and every required field is there |
| `tests/core.test.ts` | `sveast/core`: with both parts, `createParser` parses the corpus like `sveast`; without them, JavaScript components without named references parse the same, TypeScript throws an `Error`, and only numeric and XML references are decoded |
| `tests/imports-exports.test.ts` | `parseImportsExports`, with and without `localExports`, against `parseModule`'s import and export statements: every module and component script in the corpus, the TypeScript snippets, inputs that trip a regex (keywords in strings, comments, templates and regular expressions, nested modules, decorators), and mutated modules, where it must match or throw a `ParseError`; its errors |
| `tests/api.test.ts` | The public API: exports, options, `ParseError`, `parseModule` |
| `tests/is-valid-type.test.ts` | `isValidType`: types it accepts and rejects, text that would smuggle in a statement, and agreement with parsing `type T = text` on mutated types; `inline` against also parsing `(text)` |
| `tests/common-type.test.ts` | `isValidType`'s fast path never accepts text the parser rejects, on mutated types |
| `tests/expression-fastpath.test.ts` | Expressions read without acorn match acorn's reading |
| `tests/parens.test.ts` | Parenthesized expressions |
| `tests/fuzz.test.ts` | The fuzzer reports findings and exits non-zero |
| `scripts/test-package.ts` | `bun run test:package`: packs `dist/`, checks it has no dependencies (types included), installs it into a scratch project, runs it in Node, and type-checks a consumer against the published types |

`tests/corpus` holds all of carbon-components-svelte, the reference real-world codebase, plus the smallest set of svelte's test inputs and sveld's fixtures that covers everything else: every line of `src/`, every AST node type and field, and every error code (see its README). `bun scripts/minimize-corpus.ts` reports files that add nothing; `--apply` deletes them.

- **A behavior fix needs a test** that fails before the fix and passes after. Prefer a new file in `tests/corpus/fixtures/`, which the parity test picks up.
- **Run the fuzzer before merging parser changes:**

  ```sh
  bun run fuzz --iterations 500 --seed 1
  ```

  Each trial runs in its own process with a timeout and a CPU limit; keep it that way. A finding is a hang, a crash, or any difference from svelte: an AST, an error code or position, or a component only one of them accepts. It's written minimized to `.context/fuzz-findings/`, next to the original. Add it to `tests/corpus/fixtures/`, fix, repeat.
- **The weekly canary** (`.github/workflows/svelte-canary.yml`) runs the tests and the fuzzer against `svelte@latest` and opens an issue when svelte's parser moves.

### Large corpora

The committed corpus is small enough for CI. Before a release, or after a change to the parser's core, also compare against real repos:

```sh
bun scripts/compare.ts <dir...>            # .svelte files: AST, errors; add --loc for loc/name_loc
bun scripts/compare-ts.ts <dir...>         # .ts/.js modules: the TypeScript plugin vs acorn-typescript
bun scripts/compare-imports.ts <dir...>    # modules and component scripts: parseImportsExports vs parseModule
```

Both group mismatches by where they first differ and exit non-zero on any. The numbers in the README come from:

- `git clone --depth 1` of huntabyte/bits-ui, huntabyte/shadcn-svelte, skeletonlabs/skeleton, themesberg/flowbite-svelte, sveltejs/svelte.dev, immich-app/immich, sveltejs/kit, melt-ui/next-gen, techniq/layerchart and svecosystem/paneforge;
- svelte's `packages/svelte/tests` at the tag of the svelte version in `bun.lock`;
- TypeScript at tag `v5.9.3`, sparse-checked-out to `tests/cases` (TypeScript's `main` is the Go port and no longer has them).

## Performance

Changes to `src/` must not make things slower. `bench/sveast.bench.ts` holds the workloads: the corpus, Carbon's largest components and its modules, and each parser path in isolation at 10 kB and 100 kB (`bench/workloads.ts`), where about 10× the time means it scales linearly. Workload names are stable so `bench:ab` keeps pairing them.

| Command | Use |
|:---|:---|
| `bun run bench:ab` | **The regression check.** `ostia ab` runs `HEAD` and the working tree alternately in one process, re-checks anything flagged in fresh processes, and fails on a confirmed regression. Add `--base <ref>` to compare against another commit. |
| `bun run bench:sveast` | Per-workload numbers with ostia (add `--cpu` for profiles, `--filter` to narrow) |
| `bun run bench` | sveast vs svelte/compiler, the options' cost, and the TypeScript plugin vs acorn-typescript (the README tables) |
| `bun run bench:mem` | Heap retained by the corpus's ASTs, fresh process per parser |
| `bun run bench:cold` | Module load and first-parse latency, fresh process per run |

Commit first, then run `bun run bench:ab` against the commit before your change. Don't trust numbers from two runs minutes apart: machine load drifts too much.

Pitfalls seen before:
- **Rebuilding the source prefix per node is quadratic.** acorn never reads before the offset it starts at, so pass `source.slice(0, end)` rather than padding the prefix with spaces.
- **`loc` work must stay behind `loc`.** Computing lines and columns, even lazily, costs more than the rest of the node.
- **`String#repeat` returns a rope**; flatten test inputs before timing them.

## Style

- Match the surrounding code: TypeScript, biome formatting, and no comments. The only comments are JSDoc on the public API (what consumers see in their editor) and `biome-ignore`/`@ts-expect-error` directives with their reason. Names and tests carry the rest.
- Conventional commits: `feat`, `fix`, `perf`, `refactor`, `bench`, `test`, `docs`, `build`, `ci`, with `!` for breaking changes. Wrap bodies at 72 columns. No em dashes, and no AI attribution or co-author trailers. Put measured numbers in the body of `perf:` commits.
- Don't bump the version or edit a changelog; releases are cut separately. Pushing a `v*` tag publishes `dist/` to npm.
- Update the README when behavior, API or benchmark numbers change.

## Before you finish

- [ ] `bun run lint`, `bun run typecheck`, `bun run test` and `bun run test:package` pass.
- [ ] Parser changes: the fuzzer passes, a test covers the change, and `scripts/compare.ts` finds no new mismatch on the large corpora.
- [ ] `src/` changes: `bun run bench:ab` shows no confirmed regression.
- [ ] The README and this guide still describe what the code does.
