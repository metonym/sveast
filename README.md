# sveast

> Zero-dependency Svelte 5 parser: svelte/compiler's AST, 2.4× faster.

Parse `.svelte` components, including `<script lang="ts">`, into the same AST, and the same errors, as `svelte/compiler`'s `parse(source, { modern: true })`. sveast has no dependencies and uses no Node APIs, so it runs in the browser as well as in Node, Bun and Deno.

It's for tools that analyze components statically, such as documentation and type generators that read a component's props, events and slots. They need only the AST, but parse every component in a library, often on every change. [sveld](https://github.com/carbon-design-system/sveld), which generates TypeScript definitions and documentation for Svelte components, uses it.

```sh
bun i sveast
```

```ts
import { parse } from "sveast";

const ast = parse(`<script>let name = "world";</script>\n<h1>Hello {name}!</h1>`);

ast.instance?.content.body; // [VariableDeclaration]
ast.fragment.nodes; // [Text, RegularElement]
```

| Function | For | Import from |
|:---|:---|:---|
| [`parse`](#parsesource-options--astroot) | A component's AST, the same as svelte's | `sveast` |
| [`parseSections`](#parsesectionssource-options--astroot) | A component's AST without the markup: its `<script>`s, `<style>` and `<svelte:options>` | `sveast` |
| [`parseModule`](#parsemodulesource-options--program) | A `.js` or `.ts` module's AST, the same as a component's `<script>` | `sveast` |
| [`parseImportsExports`](#parseimportsexportssource-options--moduledeclaration) | A module's `import` and `export` statements, without parsing the rest | `sveast` |
| [`lexImportsExports`](#leximportsexportssource--lexedstatement) | Their offsets, sources and names, without loading a parser | `sveast/lexer` |
| [`lexComponent`](#lexcomponentsource--lexedcomponent) | A component's `<script>`s, `<style>` and `<svelte:options>`, with their attributes and offsets, without loading a parser | `sveast/lexer` |
| [`createParser`, `createModuleParser`](#smaller-bundles-sveastcore-and-sveastmodule) | The parsers without TypeScript, named HTML entities or the template parser, for a smaller bundle | `sveast/core`, `sveast/module` |
| [`isValidType`](#isvalidtypetext-options--boolean) | Whether a JSDoc type is safe to copy into a `.d.ts` | `sveast` |
| [`isRunesMode`](#isrunesmodesource--boolean) | Whether svelte compiles a component in runes mode, mostly without parsing it | `sveast` |
| [`walk`, `visitorKeys`, `markupVisitorKeys`](#walknode-visitor-keys--void) | Visit, skip, stop at or replace nodes, in the whole AST or only the markup | `sveast`, `sveast/walk` |
| [`isReference`](#isreferencenode-parent--boolean), [`extractIdentifiers`](#extractidentifierspattern--identifier) | Which identifiers are references, and which ones a pattern declares | `sveast`, `sveast/walk` |
| [`createLocator`](#createlocatorsource--offset--position) | Lines and columns for the nodes you report, without parsing with `loc` | `sveast`, `sveast/walk` |

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
| Non-ASCII identifiers | Its own Unicode 17 tables | The JavaScript engine's Unicode data, which is smaller to ship: the same in Node 24 and Bun; an engine on another Unicode version differs on the letters added in between |
| TypeScript-only errors | Reported, e.g. modifier order or initializers in ambient contexts | Not reported: code that only TypeScript's own checks reject still parses |

## Examples

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

[`examples/`](examples) has runnable versions of these and more, each a CLI you can point at your own components: a module graph, unused imports and variables, unused CSS classes, runes-or-legacy detection, `$props()` and their defaults, `.d.ts` props from JSDoc, and styles without parsing them.

## Parity and performance

- **svelte/compiler parity.** Tested on over 12,000 components: carbon-components-svelte, svelte's own test suite, bits-ui, shadcn-svelte, skeleton, flowbite-svelte, svelte.dev, immich, SvelteKit, melt-ui, layerchart and paneforge. Every one either parses to svelte's AST, `loc` included, or throws svelte's error with the same code, message, position and frame. A differential fuzzer compares the two parsers on mutated components.
- **TypeScript.** `<script lang="ts">` and `.ts` modules parse to svelte's AST, key order and `loc` included, on 6,604 real-world modules and on all but 2 of the 9,586 TypeScript conformance tests svelte parses.
- **About 2.4× faster** than svelte/compiler, and its ASTs retain about half the memory.
- **A smaller bundle and a faster load:** `parse` is less than half of svelte/compiler's size, and a fresh process imports it in about 5 ms against 45 ms.

Apple M2, medians of warm calls. The corpus is `tests/corpus`: all of carbon-components-svelte plus svelte's and sveld's test inputs.

| Input | sveast | sveast, `loc: true` | svelte/compiler |
|:---|:---|:---|:---|
| Corpus, 400 components, 1.5 MB | **64.7 ms** | 84.0 ms | 155 ms (2.4×) |
| Carbon's 5 largest components, 318 kB | **13.8 ms** | | 31.3 ms (2.3×) |
| `lang="ts"` components, 22 files | **0.79 ms** | | 2.40 ms (3.0×) |

| `parse` alone, minified for the browser | Gzipped |
|:---|:---|
| svelte/compiler | 126.7 kB |
| sveast | **58.5 kB** |
| `sveast/core`'s `createParser()`, without TypeScript and named HTML entities | **41.0 kB** |

In a fresh process, importing the parser takes 5.3 ms with sveast and 44.7 ms with `svelte/compiler`, and a first parse of the whole corpus takes 65 ms against 161 ms. Keeping ten parses of the corpus alive retains 154 MB with sveast, 268 MB with `loc: true`, and 293 MB with `svelte/compiler`.

## API

### `parse(source, options?) => AST.Root`

| Option | Default | Description |
|:---|:---|:---|
| `loc` | `false` | Add `loc` (line and column) to script and expression nodes, and `name_loc` to elements, attributes and directives, as svelte does. They cost time and memory, and most tools only need `start`/`end`. |
| `css` | `true` | Parse `<style>` into rules and selectors. With `false`, `css` keeps its `start`, `end` and `content`, but `children` and `comments` are empty and CSS syntax errors aren't reported. It also keeps `<style lang="scss">` from failing to parse as CSS. |
| `script` | `true` | Parse each `<script>`. With `false`, `instance` and `module` keep their attributes, `start` and `end`, and `content` is a `Program` with an empty `body`; their comments aren't collected and their syntax errors aren't reported. Expressions in the markup are still parsed. For a pass that only reads the markup; 3.4× faster on the benchmark corpus. |
| `comments` | `true` | Collect JavaScript comments, in scripts, expressions and tags. With `false`, `comments` is empty and no node has `leadingComments` or `trailingComments`, including the HTML comment before a `<script>` that svelte copies into its `content.leadingComments`. HTML and CSS comments are kept. 3 to 6% faster, and 8% less memory. |

With `loc: true`, the result equals svelte's. With the defaults, it's svelte's without `loc` and `name_loc`.

A syntax error throws a `ParseError` with svelte's `code` (e.g. `"block_unclosed"`), `message`, `position` (`[start, end]` offsets), `start`/`end` (`{ line, column, character }`) and `frame` (the source around the error). `message` is always the reason, a line break, then the link to the error's docs, `https://svelte.dev/e/${code}`; `reason` is the reason on its own, e.g. `"Unexpected token"`.

### `parseSections(source, options?) => AST.Root`

`parse` for a pass that only reads a component's scripts, such as its props or its module script's exports: the top-level `<script>`s, `<style>` and `<svelte:options>` are parsed as `parse` parses them, and the markup between them is skipped as [`lexComponent`](#lexcomponentsource--lexedcomponent) skips it. `fragment.nodes` is empty, `comments` has only the scripts' comments, and the markup's syntax errors aren't reported; the rest is `parse`'s, offsets and the HTML comment before a `<script>` included. It takes `parse`'s options, and on the benchmark corpus it's 1.5× faster, where most of what's left is the scripts. It's a function of its own so that a bundle with only `parse` doesn't carry the lexer; `createParser` doesn't return it.

```ts
import { parseSections } from "sveast";

const { instance, module } = parseSections(source, { css: false });
module?.content.body; // the module script's statements, with parse's offsets
```

### `parseModule(source, options?) => Program`

Parses a JavaScript or TypeScript module, such as a `.ts` file a component imports, into the same AST a component's `<script>` gets, with comments attached as `leadingComments`/`trailingComments`. Options: `typescript` and `loc`, default `false`, and `comments`, default `true`.

### `parseImportsExports(source, options?) => ModuleDeclaration[]`

A module's top-level `import` and `export` statements, without parsing the rest, e.g. to rewrite a component's imports or follow a module graph. Each node is the one `parseModule(source, { comments: false })` has for that statement: `ImportDeclaration`, `ExportNamedDeclaration`, `ExportDefaultDeclaration` and `ExportAllDeclaration`, and, in TypeScript, `TSImportEqualsDeclaration`, `TSExportAssignment` and `TSNamespaceExportDeclaration`. `import(...)` and `import.meta` are expressions, so they aren't returned. Unlike a regex, it never matches an `import` in a comment, a string, a template or a nested block such as `declare module "a" { ... }`.

It stops after the last `import` or `export` that could start a statement, so the code after a component's imports is never read: on Carbon's component scripts, it takes a third of `parseModule`'s time, and about a seventh with `localExports: false`. A syntax error in a statement it returns throws a `ParseError`, including a name exported twice; errors elsewhere aren't reported.

| Option | Default | Description |
|:---|:---|:---|
| `typescript` | `false` | Parse TypeScript: `import type`, `export type`, `import a = require("a")`. |
| `localExports` | `true` | Return the exports of the module's own bindings, such as `export let a`, `export function b() {}`, `export { c }` and `export default d`, parsed in full. With `false`, only imports and the exports that have a `from` (`export * from "e"`, `export { f } from "f"`, `export import`) are returned. |

```ts
import { parseImportsExports } from "sveast";

function dependencies(source: string, typescript = false): string[] {
  return parseImportsExports(source, { typescript, localExports: false }).flatMap(
    (node) => ("source" in node && node.source ? [node.source.value] : []),
  );
}
```

### `lexImportsExports(source) => LexedStatement[]`

From `sveast/lexer`, and also `sveast`. A module's top-level `import` statements and `export … from` re-exports, read by hand instead of parsed, for a tool on a hot or eagerly loaded path, such as a preprocessor that rewrites a component's imports, that needs each statement's offsets, source and names, but not the AST. `sveast/lexer` loads no parser, so a fresh process imports it in 1.4 ms, and on Carbon's component scripts it takes 40% of the time `parseImportsExports` takes with `localExports: false`.

It finds the statements `parseImportsExports` returns with `localExports: false`, with the same offsets, sources and names. It doesn't check syntax and never throws: a statement it can't read, such as `import { a from "a"` or `import a = require("a")`, has `source: null` and no specifiers, and ends where it stopped reading. `import type` and `type` before a name are always read.

```ts
import { lexImportsExports } from "sveast/lexer";

for (const statement of lexImportsExports(source)) {
  statement.kind; // "import" | "export"
  statement.start; // offset of `import` or `export`
  statement.end; // after the `;`, or the last token without one
  statement.source; // { value: "carbon-components-svelte", start, end } (quotes included), or null
  statement.typeOnly; // `import type …` or `export type …`
  statement.specifiers;
  // import: { kind: "default" | "namespace" | "named", imported, local, typeOnly, start, end }
  // export: { kind: "all" | "namespace" | "named", local, exported, typeOnly, start, end }
}
```

| Specifier | `import` | `export … from` |
|:---|:---|:---|
| `a` in `import a` | `default`, `imported: "default"`, `local: "a"` | |
| `* as a` | `namespace`, `imported: "*"`, `local: "a"` | `namespace`, `local: "*"`, `exported: "a"` |
| `*` | | `all`, `local: "*"`, `exported: null` |
| `b as c`, `"b-c" as d` | `named`, `imported: "b"`, `local: "c"` | `named`, `local: "b"`, `exported: "c"` |

Names are as the module sees them: escapes decoded, and a string name without its quotes. A specifier's `typeOnly` is also `true` in an `import type` or `export type`. Its `start` is that of `type` before the name, if any, and `end` is after the last name; for `export *`, after the `*`.

### `lexComponent(source) => LexedComponent`

From `sveast/lexer`, and also `sveast`. A component's top-level `<script>`, `<script module>`, `<style>` and `<svelte:options>`, with their attributes and the offsets of their tags and content, found without parsing: e.g. to read a component's scripts and their imports, its language or its options, or to rewrite a script, on a path that can't afford a parser. On the benchmark corpus it's about 50× faster than `parse`.

It skips the markup by tracking only tags, attribute values, blocks, and the brackets, strings, comments and templates of each `{…}` expression, so a `<script>` in `<svelte:head>`, a block, an attribute, an expression or an HTML comment isn't one, and it stops after the last `<script`, `<style` or `<svelte:options`. Where `parse` accepts the component, the sections are its `instance`, `module`, `css` and `options`, with the same offsets, into the source without a leading byte order mark. It doesn't check syntax and never throws.

```ts
import { lexComponent } from "sveast/lexer";

const { typescript, instance, module, css, options } = lexComponent(source);
typescript; // whether `parse` reads it as TypeScript, decided by the first <script> with a lang
instance?.content; // { start, end }: source.slice(start, end) is the script
instance?.attributes; // [{ name: "lang", value: "ts", start, end }]
module?.context; // "module"
options?.attributes; // [{ name: "runes", value: "{true}", start, end }]
```

An attribute's `value` is as written, without its quotes: character references aren't decoded, an expression keeps its braces, and an attribute without a value has `true`.

`typescript` is what `createParser` needs to know to load the TypeScript parser only for the components that use it:

```ts
import { createParser } from "sveast/core";
import { lexComponent } from "sveast/lexer";

let parser = createParser();
let loaded = false;

async function parseComponent(source: string) {
  if (!loaded && lexComponent(source).typescript) {
    const { typescript } = await import("sveast/typescript");
    parser = createParser({ typescript });
    loaded = true;
  }
  return parser.parse(source);
}
```

### Smaller bundles: `sveast/core` and `sveast/module`

`createParser(support?)` from `sveast/core` returns `parse`, `parseModule` and `parseImportsExports` without the TypeScript parser and the table of HTML's named character references, which most tools can do without. `createModuleParser(support?)` from `sveast/module` returns `parseModule` and `parseImportsExports` without the template parser either, for tools that read `.js` and `.ts` files but never components, such as a bundler plugin following a module graph. Pass back the parts you need; with them, the parsers are the same as `sveast`'s.

```ts
import { createParser } from "sveast/core";
import { typescript } from "sveast/typescript";

const { parse, parseModule, parseImportsExports } = createParser({ typescript });
```

| Support | Without it |
|:---|:---|
| `typescript` from `sveast/typescript` | A component with `<script lang="ts">`, or `typescript: true`, throws an `Error`, not a `ParseError`: a missing import, not a syntax error, and never a JavaScript AST of TypeScript |
| `entities` from `sveast/entities` (`createParser` only) | Numeric references, such as `&#169;`, and `&amp;`, `&apos;`, `&gt;`, `&lt;` and `&quot;` are decoded, but other names, such as `&copy;`, are left as written, so `Text.data` differs from svelte's where the source uses them |

Both also export `ParseError`, the same class as `sveast`'s, and the node types.

### `isValidType(text, options?) => boolean`

Whether `text` is exactly one TypeScript type, such as a JSDoc `{"sm" | "lg"}` a tool is about to copy into a `.d.ts`. The text is parsed as a type on its own, not wrapped in a statement, so a `;`, a line break or a `}` in it can't end the type and smuggle in a statement: `string; let x = 1` and `{ a: string } }` are `false`. Whitespace and comments around the type are allowed. Results aren't cached.

A `//` comment runs to the end of the line, so `string // the size` is a valid type but breaks `CustomEvent<${text}>`. Pass `inline: true` when the text goes before more code on the same line: it's then also `false` unless every `//` comment in it ends with a line break.

### `isRunesMode(source) => boolean`

Whether svelte compiles the component in runes mode, as `compile(source).metadata.runes` says: by `<svelte:options runes>` if it has one, otherwise by whether it uses a rune, such as `$state` or `$props`, or `await` outside a function in its instance script or markup. A `$state` that subscribes to a store named `state`, or that a function declares, isn't a rune, as in svelte. E.g. to track a migration to Svelte 5, or to pick the rules a linter applies.

Most components are decided without parsing: `<svelte:options>` is read with `lexComponent`, a component without a rune's name or `await` isn't in runes mode, and one whose scripts call a rune in a way that can't be a declaration, a method, a type or a store is. The rest is parsed, without the markup unless a rune's name or `await` is in it, and a syntax error there throws a `ParseError`. On 12,808 components from other Svelte projects, it takes a twelfth of the time parsing them does.

### `walk(node, visitor, keys?) => void`

Visits `node` and every node under it, depth-first and in source order, calling `visitor.enter(node, parent, key, index)` before a node's children and `visitor.leave(node, parent, key, index)` after them. `parent[key]` is the node, or `parent[key][index]` when the field is an array; all three are `null` for the node you pass. Checking `node.type` narrows `node`.

What `enter` and `leave` return controls the walk:

- **`SKIP`** from `enter` skips the node's children. `leave` is still called, so a stack you push in `enter` and pop in `leave` stays balanced.
- **`STOP`** from `enter` or `leave` ends the walk there, without `leave` on the node's ancestors, e.g. to find the first use of a rune.
- **A node** from `enter` replaces this one: `walk` writes it to `parent[key]` (or `parent[key][index]`), then enters it and visits its children instead, and `leave` gets the replacement. `return node.expression` on each `TSAsExpression` strips `a as B as C` down to `a`. The node you pass to `walk` can't be replaced.
- **Anything else**, `false` included, is ignored, so `enter: (node) => node.type === "Component" && names.add(node.name)` still visits every node.

It works on any node the parsers return: a `Root`, a `Fragment`, an expression, a `Program`, a `<style>`'s rules. It never descends into `loc`, comments or strings, and throws on a node type it doesn't know. A component's sections are visited in scope order, `module`, `instance`, `fragment`, then `css`, and a template literal's `quasis` before its `expressions`. `<svelte:options>`'s attributes aren't visited; read them from `ast.options?.attributes`. In `import { a }` and `export { a }`, one `Identifier` is both names, so it's visited twice.

`visitorKeys` is the table `walk` reads: the fields of each node type that hold child nodes, in source order, e.g. `visitorKeys.IfBlock` is `["test", "consequent", "alternate"]`. Pass another table as `keys` to visit other fields; a node whose type it has no entry for throws. `markupVisitorKeys` visits only the markup: `Root`'s `fragment`, elements' attributes and fragments, attribute values and blocks' fragments, but no script, style or expression. For a query about the markup, such as the components a file renders or the classes it uses, it's 4.8× faster on the benchmark corpus than walking everything:

```ts
import { markupVisitorKeys, walk } from "sveast";

walk(
  ast,
  {
    enter(node) {
      if (node.type === "Component") names.add(node.name);
    },
  },
  markupVisitorKeys,
);
```

`sveast/walk` exports `walk`, `SKIP`, `STOP`, `visitorKeys`, `markupVisitorKeys`, `isReference`, `extractIdentifiers`, `createLocator` and the types without loading a parser, for code that walks ASTs from elsewhere, such as a cache.

### `isReference(node, parent) => boolean`

Whether `node` is an `Identifier` that names a variable, function, class, import or other binding, where it's declared or where it's used, given the `parent` `walk` passes. It's the check svelte's analyzer makes, from [`is-reference`](https://github.com/Rich-Harris/is-reference): `false` for a property or method name (`b` in `a.b`, `{ b: a }` and `class { b() {} }`, unless computed), the renamed side of an import or export (`b` in `import { b as a }` and `export { a as b }`), and labels. Unlike `is-reference`, it's also `false` for `import.meta` and `new.target`, an import attribute's key, and `b` in `export * as b from`.

In TypeScript, a name in a type isn't a reference (`B` in `let a: B`, interface and type alias names), but a value is: the expression of `as`, `satisfies`, `<T>a`, `a!`, `a<T>` and `export =`, an enum's name and member initializers, a parameter property (`a` in `constructor(private a)`), and both sides of `import a = b`. Names of namespaces and of functions without a body (overloads, `declare function`) aren't references.

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

### `extractIdentifiers(pattern) => Identifier[]`

The `Identifier` nodes a pattern binds, in source order, as svelte's `extract_identifiers` returns them: `a`, `c`, `d`, `e` and `f` in `let { a, b: [c, ...d], e = 1, ...f } = x`. Property keys, defaults and type annotations aren't included, and a member expression binds nothing, so `[a.b, c] = x` yields only `c`. It takes any binding or assignment target: a declarator's `id`, a function's params, including a parameter property, a catch clause's `param`, an each block's `context`, a snippet's `parameters`, or an assignment's `left`, where `a!`, `a as T`, `a satisfies T` and `<T>a` yield `a`.

```ts
import { extractIdentifiers, parseModule } from "sveast";

const [declaration] = parseModule("let { a, b: [c] } = x;").body;
if (declaration.type === "VariableDeclaration") {
  declaration.declarations.flatMap((d) => extractIdentifiers(d.id)).map((node) => node.name); // ["a", "c"]
}
```

### `createLocator(source) => (offset) => Position`

A function from an offset to its `{ line, column }`, line from 1 and column from 0, as `loc: true` gives them: for a tool that parses without `loc`, which is faster, and needs lines only for what it reports. Lines are found on the first call, and each lookup starts its search at the line found last, so lookups in source order are fastest. Lines end at `\n`, as in the markup's `loc` and `ParseError`; acorn's `loc` in scripts and modules also ends them at a lone `\r`, U+2028 and U+2029. `parse` drops a leading byte order mark, so pass the source without one.

```ts
import { createLocator, parse, walk } from "sveast";

const locate = createLocator(source);
walk(parse(source), {
  enter(node) {
    if (node.type === "Component") console.log(node.name, locate(node.start).line);
  },
});
```

### Types

`AST` is svelte's `AST` namespace (`AST.Root`, `AST.RegularElement`, `AST.CSS.Rule`, ...), corrected to match what the parser returns: `name_loc` and a comment's `loc` are optional, `Root.instance`/`module` are absent rather than `null` when there's no such `<script>`, `Root.js` is declared, and every directive has `modifiers`. Each function's options and results are exported too, e.g. `ParseOptions` and `LexedStatement`.

The script's node types are exported as well (`Program`, `Node`, `Statement`, `Expression`, `Identifier`, ...), so you don't need a separate types package. They include `start`/`end` on every node, and the TypeScript nodes (`TSInterfaceDeclaration`, `TSTypeAnnotation`, ...; `TSNode` is their union) and fields (`typeAnnotation`, `typeParameters`, `returnType`, `importKind`, ...). The TypeScript nodes are in the `Statement`, `Declaration` and `Expression` unions, so checking `node.type` narrows to them. Where the grammar only allows a string, such as an import's `source`, the type is `StringLiteral`, a `Literal` whose `value` is a `string`.
