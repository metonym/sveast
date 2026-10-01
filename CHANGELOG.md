# Changelog

## 0.5.0 — 2026-10-01

**Features**

- `walk(node, visitor)` visits a node and its descendants depth-first, in
  source order, calling `enter(node, parent, key, index)` before a node's
  children and `leave` after them. `parent[key]` is the node, or
  `parent[key][index]` when the field is an array; all three are `null` for
  the node passed to `walk`. Returning `false` from `enter` skips the
  children; `leave` still runs. Returning `STOP` from `enter` or `leave`
  ends the walk: no further calls, including `leave` on the node's
  ancestors. Returning another node from `enter` writes it to `parent[key]`
  (or `parent[key][index]`), calls `enter` on it and visits its children
  instead, and `leave` gets the replacement, so `return node.expression` on
  each `TSAsExpression` unwraps `a as B as C` one layer per `enter`.
  Replacing the node passed to `walk` throws. It reads only the fields that
  hold child nodes, so it never descends into `loc`, comments or strings,
  and throws on a node type it doesn't know. A component's sections are
  visited in scope order: `module`, `instance`, `fragment`, `css`.
  `visitorKeys` is the table it reads, exported for other walkers. `walk`
  ships as its own entry, `walk.js`, which loads neither acorn nor the
  parser. `Visitor` and `STOP` are exported too.
- `parse(source, { script: false })` doesn't parse each `<script>`'s
  JavaScript or TypeScript. `instance` and `module` keep their attributes,
  `start` and `end`, and `content` is a `Program` with its `start` and `end`
  but an empty `body`; the scripts' comments aren't in `Root.comments` and
  their syntax errors aren't reported. Expressions in the markup are still
  parsed. Default `true`.
- `comments: false` on `parse` and `parseModule`. JavaScript comments in
  scripts, expressions and tags aren't collected: `Root.comments` is empty,
  and no node has `leadingComments` or `trailingComments`, including the
  HTML comment before a `<script>` that svelte copies into its
  `content.leadingComments`. HTML comments in the markup and CSS comments
  are kept. Default `true`. `parseModule`'s options are the exported
  `ParseModuleOptions`.
- `createParser(support?)` from `sveast/core` returns `parse` and
  `parseModule` without the TypeScript plugin or the table of HTML's named
  character references, which together are about a third of a bundle.
  `typescript` from `sveast/typescript` and `entities` from `sveast/entities`
  put them back; with both, the parsers are the same as `sveast`'s.
  `sveast/core` also exports `ParseError` and the types. Without
  `typescript`, a component with `<script lang="ts">`, or `parseModule` with
  `typescript: true`, throws an `Error` rather than a `ParseError`: a
  missing import, not a syntax error, and it never returns a JavaScript AST
  of TypeScript. Without `entities`, text and attribute values decode
  numeric references and `&amp;`, `&apos;`, `&gt;`, `&lt;` and `&quot;`,
  and leave other names, such as `&copy;`, as written.

**Changes**

- Non-ASCII identifiers are classified with the engine's Unicode data
  (`\p{ID_Start}` and `\p{ID_Continue}`) instead of acorn's tables. In Bun
  and Node 24 (Unicode 17) that matches acorn 8.18 on every code point. An
  engine on another Unicode version differs on the letters added in between.

**Performance**

- `script: false` on the corpus's 400 components, median of 21 runs: 35.4 ms
  → 10.5 ms in Bun, 42.6 ms → 13.8 ms in Node.
- `comments: false` on Carbon's 281 components, median of 60 runs: 24.1 ms →
  22.6 ms in Bun, 38.4 ms → 37.1 ms in Node. The retained ASTs go from
  15.7 MB to 14.4 MB.
- `walk` no longer looks up keys for every leaf. Identifiers, literals and
  text are about 46% of the nodes, and an `Identifier` without a
  `typeAnnotation` or `decorators` gets no keys. Carbon's module, instance
  and fragment (123,855 nodes): 5.82 ms → 3.76 ms. Corpus files: 6.15 ms →
  4.57 ms. The same Carbon nodes, median of 41 interleaved runs: 5.05 ms →
  3.35 ms, level with sveld's walker.
- The acorn chunk goes from 129.6 kB / 36.2 kB gzipped to 123.4 kB /
  31.2 kB with the identifier regexes, and a bundle of `parse` and
  `parseModule` from 204.6 kB / 63.9 kB to 198.5 kB / 58.7 kB. The entity
  table stores each name as the characters it shares with the previous one;
  the 106 legacy names that are also valid without a `;` share one entry
  with their `;` form. That takes the entity table from 27.4 kB / 10.8 kB
  gzipped to 20.2 kB / 9.6 kB minified, and the bundle from 198.5 kB /
  58.7 kB to 191.4 kB / 57.5 kB. 300,000 random strings of entity names,
  prefixes and numeric references decode the same.
- `parse` and `parseModule` from `sveast` minify to 192.0 kB / 57.3 kB
  gzipped. `createParser()` is 138.0 kB / 38.7 kB; with `typescript`,
  172.1 kB / 47.5 kB; with `entities`, 158.2 kB / 48.7 kB; with both,
  192.3 kB / 57.4 kB.

## 0.4.0 — 2026-09-30

**Features**

- `isValidType(text, { inline })`. A `//` comment runs to the end of the
  line, so `string // the size` is a valid type that breaks
  `CustomEvent<${text}>`. With `inline: true` (default `false`) the call is
  also `false` unless every `//` comment in the text ends with a line break.
  It reads the tokenizer's comments rather than parsing a second time: an
  unterminated line comment is the one that ends at the end of the text.
  Block comments and `//` inside strings (`"http://a" | "https://b"`) are
  fine either way.
- `FunctionDeclaration` and `ArrowFunctionExpression` type `params` as
  `Pattern[]`. A parameter property (`private x`) only parses in a class
  constructor, whose value is a `FunctionExpression` or a `TSDeclareMethod`.
  `BaseFunction` and the `Function` union keep
  `Pattern | TSParameterProperty`.

**Performance**

- `isValidType` answers the common JSDoc shapes without the TypeScript
  parser: references with type arguments, literals, unions, intersections,
  arrays, indexed access, `keyof`, `typeof`, import types, and object, tuple
  and function types, on one line and without comments. The reader only
  returns `true`; anything else, including every reserved word, still goes
  to the parser. A grammar-based fuzz run of 8.4M texts found no text it
  accepts that the parser rejects.
- The first 10 calls on typical types, after import, median of 5 processes:
  1.8 ms → 0.26 ms in Bun, 2.0 ms → 0.22 ms in Node. Warm, those types take
  0.26 µs per call instead of 0.95 µs. Text the reader leaves to the parser
  takes 1.68 µs instead of 1.50 µs.

**Breaking**

- Code narrowed to a `FunctionDeclaration` or `ArrowFunctionExpression` that
  handled `TSParameterProperty` in `params`, or assigned one there, no longer
  typechecks. The runtime never produced one on those nodes. A `Function` or
  `BaseFunction` still includes it, for constructors.

## 0.3.0 — 2026-09-30

**Features**

- `isValidType(text)` reports whether `text` is exactly one TypeScript type,
  such as a JSDoc `{"sm" | "lg"}` a tool is about to copy into a `.d.ts`.
  The text is parsed from the TypeScript plugin's type entry point and must
  consume the input, rather than being wrapped in `type T = ...;`, so a
  `;`, a line break, a `}` or a comment terminator in the text can't end the
  type and start a statement. `string; let x = 1` and `{ a: string } }` are
  `false`. Whitespace and comments around the type are allowed; a `//`
  comment runs to the end of the line, so a caller that embeds `text` before
  more code on the same line should check for one. Results aren't cached.
  It ships as its own entry, `is-valid-type.js`, which imports only the chunk
  with acorn and the TypeScript plugin, not the template parser.
- `ParseError.reason` is the message without svelte's link to the error's
  docs, e.g. `"Unexpected token"`. `message` is unchanged: always `reason`,
  a line break, then `https://svelte.dev/e/${code}`. A tool that prints a
  one-line error no longer has to split `message` on a line break.
- Module specifiers are typed as `StringLiteral`, a `SimpleLiteral` whose
  `value` is a `string`. The grammar only allows a string there, and the
  parser only ever produces one: an import or export `source`, an import
  attribute, a quoted module export name, `declare module "a"`,
  `import a = require("a")`, `import("a")` in a type
  (`TSImportType.argument`), and a quoted enum member name. Consumers don't
  have to narrow `value`.

**Breaking**

- Those specifier fields were `Literal` (`value: string | boolean | number |
  null`). They're `StringLiteral` now, so a general `Literal` is no longer
  assignable to an import's `source`, an export name,
  `TSImportType.argument`, `TSExternalModuleReference.expression`, or a
  quoted `TSEnumMember` / `TSModuleDeclaration` id. The runtime nodes are
  unchanged.

## 0.2.0 — 2026-09-30

**Features**

- estree node types are exported (`Program`, `Node`, `Statement`,
  `Expression`, `Identifier`, ...), so a consumer doesn't need
  `@types/estree`. They're estree's, plus what the parser adds: `start`/`end`
  on every node and comment (the HTML comment svelte puts before `<script>`
  in `Program.leadingComments` is the one typed exception), and the
  TypeScript plugin's nodes (`TSInterfaceDeclaration`, `TSTypeAnnotation`,
  `TSTypeReference`, ...; `TSNode` is their union) and fields
  (`typeAnnotation`, `typeParameters`, `typeArguments`, `returnType`,
  `importKind`/`exportKind`, decorators, class modifiers). Those nodes sit in
  the `Statement`, `Declaration` and `Expression` unions, so checking
  `node.type` narrows to them. Fields acorn sets that estree doesn't declare,
  and the ones acorn-typescript leaves out (`attributes`, `optional`), are
  declared too.
- `AST` is corrected to match what the parser returns. `Root.js` is declared
  (always empty, as in svelte). `Root.instance`/`module` are absent rather
  than `null` when there's no such `<script>`. Every directive declares
  `modifiers` (parsed on every directive, e.g. `use:x|y`; svelte's types
  declare it only on some). The published `index.d.ts` no longer types
  estree's `Identifier` and `SourceLocation` with the internal interfaces
  from `state.ts`.

**Changes**

- The published build is split. `dist/index.js` re-exports only;
  `parse.js` is the template parser, `parse-module.js` is `parseModule`, and
  one shared chunk holds acorn, the TypeScript plugin and the errors.
  `ParseError` is re-exported from `parse-module.js`, so a graph that only
  imports `parseModule` doesn't pull the template parser in to reach the
  error class. With `"sideEffects": false`, a bundler drops `parse.js` from
  that graph.

**Performance**

- A `parseModule`-only bundle no longer includes the template parser. In
  sveld (`bun build`, splitting on) the CLI entry imported acorn and not the
  template parser, where it used to import both. `dist/*.js` was 1,099,708
  bytes against 1,098,909 with the single file, and a Node import of that
  entry was 17.1 ms against 18.2 ms (median of 30 interleaved runs).
  Importing sveast itself in Node now loads four files instead of one:
  4.4 ms against 3.8 ms (median of 31 runs).

**Breaking**

- `Root.instance` and `Root.module` are `Script | undefined`, not
  `Script | null | undefined`. `Root.js` is required, and every directive
  type requires `modifiers: string[]`. Constructing those nodes without the
  new fields, or assigning `null` to `instance`/`module`, no longer
  typechecks. The runtime shape is unchanged.

## 0.1.0 — 2026-09-30

**Features**

- `parse(source, options?)` parses a Svelte 5 component into svelte/compiler's
  modern AST, the same as `parse(source, { modern: true })`. A syntax error
  throws `ParseError` with svelte's `code`, `message`, `position`, `start`,
  `end` and `frame`.
- `loc: true` adds `loc` to script and expression nodes and `name_loc` to
  elements, attributes and directives. Off by default: the AST then has only
  `start`/`end` offsets.
- `css: false` keeps a `<style>` element's `start`, `end` and `content`, but
  `children` and `comments` are empty and CSS syntax errors aren't reported.
  Default `true`.
- `parseModule(source, { typescript, loc })` parses a JavaScript or TypeScript
  module the way a component's `<script>` is parsed: estree plus TypeScript
  nodes, with comments attached as `leadingComments`/`trailingComments`. Both
  options default `false`.
- `<script lang="ts">` is parsed by a built-in TypeScript plugin. acorn is
  bundled, so the package has no dependencies. `AST` is svelte's AST
  namespace (`name_loc`, a comment's `loc`, and `Root.instance`/`module`
  optional, since they can be absent). `ParseOptions` is exported too.
