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
| Errors | `CompileError` | `ParseError`: same `code`, `message`, `position`, `start`, `end` and `frame`; no `filename`; `reason`, the message without its link |
| AST formats | Modern, legacy (`modern: false`), error-tolerant (`loose`) | Modern |
| Scope | Parsing, `parseCss`, analysis, compilation | Parsing (`parse`, `parseModule`, `parseImportsExports`, `isValidType`), walking the AST (`walk`, `visitorKeys`), and finding references (`isReference`) |
| Non-ASCII identifiers | acorn's tables, Unicode 17 | The engine's own Unicode data, which is smaller to ship: the same as acorn's in Node 24 and Bun; an engine on another Unicode version differs on the letters added in between |
| TypeScript-only errors | Reported, e.g. modifier order or initializers in ambient contexts | Not reported: 108 of the 2,449 TypeScript conformance tests acorn-typescript rejects still parse |

## API

### `parse(source, options?) => AST.Root`

| Option | Description |
|:---|:---|
| `loc` | Add `loc` (line and column) to script and expression nodes, and `name_loc` to elements, attributes and directives, as svelte does. Default `false`: they cost time and memory, and most tools only need `start`/`end`. |
| `css` | Parse `<style>` into rules and selectors. With `false`, `css` keeps its `start`, `end` and `content`, but `children` and `comments` are empty and CSS syntax errors aren't reported. Default `true`. |
| `script` | Parse each `<script>`'s JavaScript or TypeScript. With `false`, `instance` and `module` keep their attributes, `start` and `end`, and `content` is a `Program` with its `start` and `end` but an empty `body`; the scripts' comments aren't in `comments`, and their syntax errors aren't reported. Expressions in the markup are still parsed. For a pass that only reads the markup, such as collecting which components a file renders and with what props; on the benchmark corpus, it parses 3.4× faster. Default `true`. |
| `comments` | Collect JavaScript comments, in scripts, expressions and tags. With `false`, `comments` is empty and no node has `leadingComments` or `trailingComments`, including the HTML comment before a `<script>` that svelte copies into its `content.leadingComments`. HTML comments in the markup and CSS comments are kept. For tools that never read comments; on Carbon's components, it parses 3 to 6% faster and the ASTs take 8% less memory. Default `true`. |

With `loc: true`, the result equals svelte's. With the defaults, it's svelte's without `loc` and `name_loc`.

A syntax error throws a `ParseError` with svelte's `code` (e.g. `"block_unclosed"`), `message`, `position` (`[start, end]` offsets), `start`/`end` (`{ line, column, character }`) and `frame` (the source around the error). `message` is always the reason, a line break, then the link to the error's docs, `https://svelte.dev/e/${code}`. `reason` has the reason on its own, e.g. `"Unexpected token"`.

### `parseModule(source, options?) => Program`

Parses a JavaScript or TypeScript module, such as a `.ts` file a component imports, the way a component's `<script>` is parsed: estree plus TypeScript nodes, with comments attached as `leadingComments`/`trailingComments`. Options: `typescript` and `loc`, both default `false`, and `comments`, default `true`; with `false`, no node has `leadingComments` or `trailingComments`.

### `parseImportsExports(source, options?) => ModuleDeclaration[]`

A module's top-level `import` and `export` statements, without parsing the rest, e.g. to rewrite a component's imports or follow a module graph. Each node is the one `parseModule(source, { comments: false })` has for that statement, so `start`, `end`, `specifiers` (with `imported`, `local` and `importKind`) and `source` are all there: `ImportDeclaration`, `ExportNamedDeclaration`, `ExportDefaultDeclaration` and `ExportAllDeclaration`, and, in TypeScript, `TSImportEqualsDeclaration`, `TSExportAssignment` and `TSNamespaceExportDeclaration`. `import(...)` and `import.meta` are expressions, so they aren't returned. Unlike a regex, it never matches an `import` in a comment, a string, a template or a nested block such as `declare module "a" { ... }`.

The rest is skipped by a tokenizer that only tracks strings, comments, templates, regular expressions and brackets, and only the statements it finds are parsed. A syntax error in one of them throws `parseModule`'s `ParseError`, including a name exported twice; errors elsewhere aren't reported.

| Option | Description |
|:---|:---|
| `typescript` | Parse TypeScript: `import type`, `export type`, `import a = require("a")`. Default `false`. |
| `localExports` | Return the exports of the module's own bindings, such as `export let a`, `export function b() {}`, `export { c }` and `export default d`, which are parsed in full. With `false`, only imports and the exports that have a `from` (`export * from "e"`, `export { f } from "f"`, `export import`) are returned, and the rest is skipped. Default `true`. |

On Carbon's 327 component scripts, mostly JSDoc-documented `export let` props, it takes 10.7 ms against `parseModule`'s 33.8 ms, and 4.5 ms with `localExports: false`; the largest script, 63 kB, takes 0.37 ms against 2.7 ms. It checks the TypeScript conformance tests, kit, immich and bits-ui against `parseModule`, with an `import` inserted after every top-level statement: the same nodes on all 24,354 modules.

```ts
import { parseImportsExports } from "sveast";

function dependencies(source: string, typescript = false): string[] {
  return parseImportsExports(source, { typescript, localExports: false }).flatMap(
    (node) => ("source" in node && node.source ? [node.source.value] : []),
  );
}
```

### `createParser(support?) => { parse, parseModule, parseImportsExports }` from `sveast/core`

`parse`, `parseModule` and `parseImportsExports` without the two parts most tools can do without: the TypeScript plugin and the table of HTML's named character references. Together they're about a third of a bundle: `parse` and `parseModule` from `sveast` minify to 57.3 kB gzipped, and from `createParser()` to 40.3 kB. Pass back the parts you need; with both, the parsers are the same as `sveast`'s.

```ts
import { createParser } from "sveast/core";
import { typescript } from "sveast/typescript";

const { parse, parseModule, parseImportsExports } = createParser({ typescript });
```

| Support | Without it |
|:---|:---|
| `typescript` from `sveast/typescript` (+8.8 kB gzipped) | A component with `<script lang="ts">`, or `parseModule` or `parseImportsExports` with `typescript: true`, throws an `Error`, not a `ParseError`: a missing import, not a syntax error, and never a JavaScript AST of TypeScript |
| `entities` from `sveast/entities` (+10.0 kB gzipped) | Text and attribute values decode numeric references, such as `&#169;`, and `&amp;`, `&apos;`, `&gt;`, `&lt;` and `&quot;`, but leave other names, such as `&copy;`, as written, so `Text.data` differs from svelte's where the source uses them |

`sveast/core` also exports `ParseError`, the same class as `sveast`'s, and the types.

### `isValidType(text, options?) => boolean`

Whether `text` is exactly one TypeScript type, such as a JSDoc `{"sm" | "lg"}` a tool is about to copy into a `.d.ts`. The text is parsed as a type on its own, not wrapped in a statement, so a `;`, a line break or a `}` in it can't end the type and smuggle in a statement: `string; let x = 1` and `{ a: string } }` are `false`. Whitespace and comments around the type are allowed. Results aren't cached; memoize if you check the same text often.

A `//` comment runs to the end of the line, so `string // the size` is a valid type but breaks `CustomEvent<${text}>`. Pass `inline: true` when the text goes before more code on the same line: it's then also `false` unless every `//` comment in the text ends with a line break. Block comments and `//` inside strings, as in `"http://a" | "https://b"`, are fine either way.

### `walk(node, visitor) => void`

Visits `node` and every node under it, depth-first and in source order, calling `visitor.enter(node, parent, key, index)` before a node's children and `visitor.leave(node, parent, key, index)` after them. `parent[key]` is the node, or `parent[key][index]` when the field is an array; all three are `null` for the node you pass. Return `SKIP` from `enter` to skip the node's children; `leave` is still called, so a stack you push in `enter` and pop in `leave` stays balanced. Return `STOP` from `enter` or `leave` to end the walk there: no more `enter` or `leave` calls, not even `leave` on the node's ancestors, e.g. to find the first use of a rune. Return another node from `enter` to put it in this one's place: `walk` writes it to `parent[key]` (or `parent[key][index]`), then calls `enter` on it and visits its children instead, and `leave` gets the replacement. So `return node.expression` on each `TSAsExpression` strips `a as B as C` down to `a`, one layer per `enter`. The node you pass to `walk` can't be replaced. Any other return value, `false` included, is ignored, so an expression-bodied `enter: (node) => node.type === "Component" && names.add(node.name)` still visits every node. Checking `node.type` narrows `node`.

It works on any node the parsers return: a component's `Root`, a `Fragment`, an expression, a `parseModule` program, a `<style>`'s rules. It only reads the fields that hold child nodes, so it never descends into `loc`, comments or strings, and it throws on a node type it doesn't know. Two exceptions to source order: a component's sections are visited in scope order, `module`, `instance`, `fragment`, then `css`; and a template literal's `quasis` come before its `expressions`. `Root.options` isn't a node, so `<svelte:options>`'s attributes aren't visited; read them from `ast.options?.attributes`. acorn shares one `Identifier` between both names of `import { a }`, so it's visited once as `imported` and once as `local`, and likewise as `local` and `exported` in `export { a }`.

`visitorKeys` is the table `walk` reads: the fields of each node type that hold child nodes, in source order, e.g. `visitorKeys.IfBlock` is `["test", "consequent", "alternate"]`. Use it with another walker, or to write your own.

### `isReference(node, parent) => boolean`

Whether `node` is an `Identifier` that names a variable, function, class, import or other binding, where it's declared or where it's used, given the `parent` `walk` passes. It's the check svelte's analyzer makes, from the [`is-reference`](https://github.com/Rich-Harris/is-reference) package: `false` for a property or method name (`b` in `a.b`, `{ b: a }` and `class { b() {} }`, unless computed), the renamed side of an import or export (`b` in `import { b as a }` and `export { a as b }`), and labels. Unlike `is-reference`, it's also `false` for `import` and `new` in `import.meta` and `new.target`, an import attribute's key, and `b` in `export * as b from`, and for any node that isn't an `Identifier`.

TypeScript nodes hold types, so an `Identifier` whose parent is a TypeScript node isn't a reference (`B` in `let a: B`, `typeof b` in a type, interface and type alias names), except where it's a value: the expression of `as`, `satisfies`, `<T>a`, `a!`, `a<T>` and `export =`, an enum member's initializer, a parameter property (`a` in `constructor(private a)`), an enum's name, and the name and target of `import a = b`. Names of namespaces and of functions without a body (overloads, `declare function`) aren't references.

acorn shares one `Identifier` between both names of `import { a }` and `export { a }`, and `walk` visits it twice, so it's a reference on both visits.

```ts
import { isReference, parseModule, walk } from "sveast";

const used = new Set<string>();
walk(parseModule("const a = b.c({ d: e });"), {
  enter(node, parent) {
    if (node.type === "Identifier" && isReference(node, parent)) used.add(node.name);
  },
});
used; // Set { "a", "b", "e" }
```

`walk`, `SKIP`, `STOP`, `visitorKeys`, `Visitor`, `isReference` and the types are also exported from `sveast/walk`, which loads neither acorn nor the parser: for code that walks ASTs it gets from elsewhere, such as a cache, and must not pay for loading the parser. They're the same values as `sveast`'s.

```ts
import { STOP, walk } from "sveast/walk";
```

### Types

`AST` is svelte's `AST` namespace (`AST.Root`, `AST.RegularElement`, `AST.CSS.Rule`, ...), corrected to match what the parser returns: `name_loc` and a comment's `loc` are optional, `Root.instance`/`module` are absent rather than `null` when there's no such `<script>`, `Root.js` is declared, and every directive has `modifiers`. `ParseOptions`, `ParseModuleOptions` and `ParseImportsExportsOptions` are exported too.

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
import { parse, walk } from "sveast";

function componentsUsed(source: string): string[] {
  const names = new Set<string>();
  walk(parse(source, { css: false }).fragment, {
    enter(node) {
      if (node.type === "Component") names.add(node.name);
    },
  });
  return [...names]; // ["Button", "Modal.Root"]
}
```

**Find the classes a component's styles declare but its markup never uses**, e.g. to report dead CSS. A `class={...}` expression is reported as `dynamic` rather than guessed at:

```ts
import { parse, walk } from "sveast";

function unusedClasses(source: string): { unused: string[]; dynamic: boolean } {
  const ast = parse(source);
  const declared = new Set<string>();
  const used = new Set<string>();
  let dynamic = false;
  if (ast.css) {
    walk(ast.css, {
      enter(node) {
        if (node.type === "ClassSelector") declared.add(node.name);
      },
    });
  }
  walk(ast.fragment, {
    enter(node) {
      if (node.type === "ClassDirective") used.add(node.name);
      if (node.type !== "Attribute" || node.name !== "class") return;
      for (const part of node.value === true ? [] : [node.value].flat()) {
        if (part.type === "ExpressionTag") dynamic = true;
        else for (const name of part.data.split(/\s+/)) if (name) used.add(name);
      }
    },
  });
  return { unused: [...declared].filter((name) => !used.has(name)), dynamic };
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
- **Zero dependencies,** types included. 67 kB gzipped, acorn included.

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
