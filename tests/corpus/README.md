# Test corpus

`tests/parity.test.ts` parses every `.svelte` file here with sveast and with svelte/compiler, `tests/ts-plugin.test.ts` parses Carbon's modules with the TypeScript plugin and acorn-typescript, the fuzzer mutates the components, and `bench/` times them.

- `carbon/`: the reference real-world codebase. All components and modules from [carbon-components-svelte](https://github.com/carbon-design-system/carbon-components-svelte) `src/` at `27234d4` (v0.112.0), unchanged. Apache-2.0; see `carbon/LICENSE`.
- `svelte/`: inputs from svelte 5.57.1's `parser-modern`, `parser-legacy`, `compiler-errors`, `css` and `validator` tests (MIT; see `LICENSE`).
- `fixtures/`: components from [sveld](https://github.com/carbon-design-system/sveld)'s tests, and fuzzer findings (`fuzz-*`).

Outside `carbon/` and `fuzz-*`, a file is here only if it covers something the others don't: a line of `src/`, an AST node type or field, or an error code.

This directory is data. Never format it: whitespace in a `.svelte` file changes its AST.
