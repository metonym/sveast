# sveast

> Zero-dependency Svelte 5 parser. svelte/compiler's exact AST, 2× faster.

Parse `.svelte` components, including `<script lang="ts">`, into the same AST, and the same errors, as `svelte/compiler`'s `parse(source, { modern: true })`. sveast bundles acorn and its own TypeScript plugin, so it has no dependencies, and it runs anywhere: no Node APIs.

```sh
bun i sveast
```

```ts
import { parse } from "sveast";

const ast = parse(`<script>let name = "world";</script>\n<h1>Hello {name}!</h1>`);

ast.instance?.content.body; // [VariableDeclaration]
ast.fragment.nodes; // [Text, RegularElement]
```

## Migrating from svelte/compiler

sveast is a drop-in for `parse` in most tools: change the import, and pass `loc: true` if you read line and column numbers.

```diff
- import { type AST, parse } from "svelte/compiler";
+ import { type AST, parse } from "sveast";

- const ast = parse(source, { modern: true });
+ const ast = parse(source, { loc: true });
```

| | svelte/compiler | sveast |
|:---|:---|:---|
| `loc`, `name_loc` | Always | With `loc: true`; otherwise only `start`/`end` offsets, for a faster parse and a smaller AST |
| Errors | `CompileError` | `ParseError`: same `code`, `message`, `position`, `start`, `end` and `frame`; no `filename` |
| AST formats | Modern, legacy (`modern: false`), error-tolerant (`loose`) | Modern |
| Scope | Parsing, `parseCss`, analysis, compilation | Parsing (`parse`, `parseModule`, `isValidType`) |
| TypeScript-only errors | Reported, e.g. modifier order or initializers in ambient contexts | Not reported: 108 of the 2,449 TypeScript conformance tests acorn-typescript rejects still parse |

## API

### `parse(source, options?) => AST.Root`

| Option | Description |
|:---|:---|
| `loc` | Add `loc` (line and column) to script and expression nodes, and `name_loc` to elements, attributes and directives, as svelte does. Default `false`: they cost time and memory, and most tools only need `start`/`end`. |
| `css` | Parse `<style>` into rules and selectors. With `false`, `css` keeps its `start`, `end` and `content`, but `children` and `comments` are empty and CSS syntax errors aren't reported. Default `true`. |

With `loc: true`, the result equals svelte's. With the defaults, it's svelte's without `loc` and `name_loc`.

A syntax error throws a `ParseError` with svelte's `code` (e.g. `"block_unclosed"`), `message`, `position` (`[start, end]` offsets), `start`/`end` (`{ line, column, character }`) and `frame` (the source around the error).

### `parseModule(source, options?) => Program`

Parses a JavaScript or TypeScript module, such as a `.ts` file a component imports, the way a component's `<script>` is parsed: estree plus TypeScript nodes, with comments attached as `leadingComments`/`trailingComments`. Options: `typescript` and `loc`, both default `false`.

### `isValidType(text) => boolean`

Whether `text` is exactly one TypeScript type, such as a JSDoc `{"sm" | "lg"}` a tool is about to copy into a `.d.ts`. The text is parsed as a type on its own, not wrapped in a statement, so a `;`, a line break or a `}` in it can't end the type and smuggle in a statement: `string; let x = 1` and `{ a: string } }` are `false`. Whitespace and comments around the type are allowed; a `//` comment runs to the end of the line, so check for one before embedding the text ahead of more code on the same line. Results aren't cached; memoize if you check the same text often.

### Types

`AST` is svelte's `AST` namespace (`AST.Root`, `AST.RegularElement`, `AST.CSS.Rule`, ...), corrected to match what the parser returns: `name_loc` and a comment's `loc` are optional, `Root.instance`/`module` are absent rather than `null` when there's no such `<script>`, `Root.js` is declared, and every directive has `modifiers`. `ParseOptions` is exported too.

The estree node types are exported as well (`Program`, `Node`, `Statement`, `Expression`, `Identifier`, ...), so you don't need `@types/estree`. They're estree's, plus what the parser adds: `start`/`end` on every node, and the TypeScript plugin's nodes (`TSInterfaceDeclaration`, `TSTypeAnnotation`, `TSTypeReference`, ...; `TSNode` is their union) and fields (`typeAnnotation`, `typeParameters`, `typeArguments`, `returnType`, `importKind`/`exportKind`, ...). The TypeScript nodes are in the `Statement`, `Declaration` and `Expression` unions, so checking `node.type` narrows to them. Where the grammar only allows a string, such as an import's `source`, the type is `StringLiteral`, a `Literal` whose `value` is a `string`.

```ts
import { parseModule, type TSInterfaceDeclaration } from "sveast";

const interfaces: TSInterfaceDeclaration[] = [];
for (const node of parseModule(source, { typescript: true }).body) {
  if (node.type === "TSInterfaceDeclaration") interfaces.push(node);
}
```

## Recipes

**List the components a file renders**, e.g. to build a dependency graph:

```ts
import { parse } from "sveast";

function componentsUsed(source: string): string[] {
  const names = new Set<string>();
  const visit = (node: object): void => {
    if (
      "type" in node &&
      node.type === "Component" &&
      "name" in node &&
      typeof node.name === "string"
    ) {
      names.add(node.name);
    }
    for (const child of Object.values(node)) {
      if (typeof child === "object" && child !== null) visit(child);
    }
  };
  visit(parse(source, { css: false }).fragment);
  return [...names]; // ["Button", "Modal.Root"]
}
```

**Read the props a runes component declares:**

```ts
import { parse } from "sveast";

function propNames(source: string): string[] {
  for (const statement of parse(source).instance?.content.body ?? []) {
    if (statement.type !== "VariableDeclaration") continue;
    for (const { id, init } of statement.declarations) {
      const isProps =
        init?.type === "CallExpression" &&
        init.callee.type === "Identifier" &&
        init.callee.name === "$props";
      if (isProps && id.type === "ObjectPattern") {
        return id.properties.flatMap((p) =>
          p.type === "Property" && p.key.type === "Identifier" ? [p.key.name] : [],
        );
      }
    }
  }
  return [];
}
```

**Report syntax errors**, e.g. in a pre-commit check, with svelte's own messages:

```ts
import { ParseError, parse } from "sveast";

try {
  parse(source, { css: false });
} catch (error) {
  if (!(error instanceof ParseError)) throw error;
  console.error(`${file}:${error.start?.line}:${error.start?.column} ${error.code}\n${error.frame}`);
}
```

**Get a component's styles without parsing them:**

```ts
import { parse } from "sveast";

const css = parse(source, { css: false }).css?.content.styles ?? "";
```

## Features

- **svelte/compiler parity.** Tested on over 12,000 components: carbon-components-svelte, svelte's own test suite, bits-ui, shadcn-svelte, skeleton, flowbite-svelte, svelte.dev, immich, SvelteKit, melt-ui, layerchart and paneforge. Every one either parses to svelte's AST, `loc` included, or throws svelte's error with the same code, message, position and frame. CI runs 442 of them, the smallest set that covers every parser line, AST shape and error code the full set does, and a differential fuzzer compares the two parsers on mutated components.
- **TypeScript without acorn-typescript.** The built-in plugin produces the same AST as `@sveltejs/acorn-typescript`, key order and `loc` included, on 6,604 real-world modules and on all but 2 of the 9,586 TypeScript conformance tests that acorn-typescript parses. It rejects the same redeclarations, and supports decorators.
- **About 2.4× faster than svelte/compiler** (2.2–3.0× depending on the input), and its ASTs retain 47% less memory without `loc`.
- **Fast to load.** A fresh process imports sveast in about 5 ms, against about 45 ms for `svelte/compiler`.
- **Zero dependencies,** types included. 64 kB gzipped, acorn included.

## Benchmarks

Apple M2, medians of warm calls. Each task parses every file in the set once. The corpus is `tests/corpus`: all of carbon-components-svelte plus svelte's and sveld's test inputs.

| Input | sveast | sveast, `loc: true` | svelte/compiler |
|:---|:---|:---|:---|
| Corpus, 400 components, 1.5 MB | **64.7 ms** | 84.0 ms | 155 ms (2.4×) |
| Carbon's 5 largest components, 318 kB | **13.8 ms** | | 31.3 ms (2.3×) |
| `lang="ts"` components, 22 files | **0.79 ms** | | 2.40 ms (3.0×) |

| Input | sveast's TypeScript plugin | acorn-typescript |
|:---|:---|:---|
| Carbon's 98 `.d.ts` modules | **3.19 ms** | 8.07 ms (2.5×) |
| The corpus's `lang="ts"` scripts on their own | **0.58 ms** | 1.29 ms (2.2×) |

In a fresh process, importing the parser takes 5.3 ms with sveast and 44.7 ms with `svelte/compiler`, and a first parse of the whole corpus takes 65 ms against 161 ms. Keeping ten parses of the corpus alive retains 154 MB with sveast, 268 MB with `loc: true`, and 293 MB with `svelte/compiler`.
