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
4. **Errors and locations.** Every error goes through a function in `src/errors.ts`, which throws a `ParseError` (`src/parse-error.ts`). `src/locator.ts` turns offsets into lines and columns, for errors and for `loc: true`.

These files are generated from upstream sources. Don't edit them by hand; re-run the script after upgrading svelte:

| File | Generator | From |
|:---|:---|:---|
| `src/errors.ts` | `bun scripts/generate-errors.ts` | svelte's `errors.js`, so codes and messages match |
| `src/entities.ts` | `bun scripts/generate-entities.ts` | The HTML standard's [`entities.json`](https://html.spec.whatwg.org/entities.json), the named character references |
| `src/types/estree.ts`, `src/types/svelte-ast.ts` | `bun scripts/generate-types.ts` | `@types/estree` and svelte's published `AST` types, so the package has no type dependencies. The script patches them to match the parser's output: offsets, the TypeScript nodes from the hand-written `src/types/typescript.ts`, and fields svelte's types miss |

The build (`scripts/build.ts`) bundles acorn into a few ESM files: `index.js` only re-exports, `parse-module.js` holds `parseModule`, `parse.js` the template parser, and a shared chunk acorn, the TypeScript plugin and the code both need. A consumer's bundler can then load `parseModule` without the template parser (`"sideEffects": false` lets it drop the unused re-export). `scripts/shrink-parser.ts` cuts its size: it stubs acorn's regex validator and shortens the TypeScript plugin's `ts*` member names. Both fail the build if the source they rewrite changes shape.

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
| `tests/parity.test.ts` | Every component in `tests/corpus` against svelte/compiler: the AST with and without `loc`, or the error |
| `tests/ts-plugin.test.ts` | The TypeScript plugin against acorn-typescript, with and without `locations` |
| `tests/types.test.ts` | The exported types against the corpus's ASTs and `tests/ts-snippets.ts`: every node `type` and field is declared, and every required field is there |
| `tests/api.test.ts` | The public API: exports, options, `ParseError`, `parseModule` |
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
