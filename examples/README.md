# Examples

Small tools built on sveast, one task each. Each file exports its functions and, run directly, is a CLI over the files you pass it. `tests/examples.test.ts` runs both, on fixtures and on Carbon's components in `tests/corpus`.

| Example | Uses | Does |
|:---|:---|:---|
| [`components-used.ts`](components-used.ts) | `parse`, `walk` | Maps the components each file renders to where they're imported from |
| [`module-graph.ts`](module-graph.ts) | `parseImportsExports`, `lexComponent` | Follows relative imports from entry files through components and modules; lists packages and imports that resolve to no file |
| [`unused-bindings.ts`](unused-bindings.ts) | `walk`, `isReference`, `extractIdentifiers`, `createLocator` | Reports imports, variables and functions that neither the script nor the markup uses |
| [`svelte-mode.ts`](svelte-mode.ts) | `walk` with `STOP`, `isReference`, `createLocator` | Tells runes components from Svelte 4 ones, and why, to track a migration; `isRunesMode` gives svelte's yes or no alone |
| [`prop-types.ts`](prop-types.ts) | `isValidType`, comments | Generates a `.d.ts` props interface from `export let` and its JSDoc `@type` |
| [`props.ts`](props.ts) | `parse` | Reads the props `$props()` declares, with defaults and `...rest` |
| [`unused-classes.ts`](unused-classes.ts) | `parse`, `walk` with `SKIP` and `markupVisitorKeys`, `createLocator` | Reports classes the styles declare but the markup never uses |
| [`check-syntax.ts`](check-syntax.ts) | `ParseError`, `parseModule` | Reports syntax errors in components and modules with svelte's messages; exits 1 on any |
| [`extract-styles.ts`](extract-styles.ts) | `lexComponent`, `createLocator` | Prints each `<style>` unparsed, with its line and `lang` |

```sh
bun examples/module-graph.ts tests/corpus/carbon/Button/index.js
bun examples/svelte-mode.ts tests/corpus/carbon/*/*.svelte
bun examples/prop-types.ts tests/corpus/carbon/Button/Button.svelte
```

As a pre-commit check:

```sh
git diff --cached --name-only --diff-filter=ACM -- '*.svelte' '*.ts' '*.js' | xargs bun examples/check-syntax.ts
```

They import `sveast`, which resolves to `src/` through `tsconfig.json` here; in your project, install `sveast` and copy the file.
