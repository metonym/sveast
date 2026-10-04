# Changelog

## 0.9.1 — 2026-10-04

**Performance**

- Name hashing stays in int32. `readWord1` hashed with
  `(hash * 31 + code) | 0`. Past six characters the multiply leaves int32
  before the `| 0`, so JavaScriptCore drops the loop to double arithmetic on
  every identifier character. `Math.imul` keeps the same low 32 bits, so the
  intern table's slots don't change. 0.9.0 was slower than 0.8.0 on files
  with long names: `parseModule` of Carbon's root barrel was 8% to 12%
  slower (19% as measured from sveld), and a 500-line barrel of long
  PascalCase names was +17%.
- Against 0.8.0, interleaved, one process, 61 rounds, median of two runs:
  Carbon's root `index.js` −3.2% and −5.4% (0.9.0 was +7.8% and +11.9%), the
  long-name barrel −4.0% and −2.9% (0.9.0 was +16.8% and +25.6%), Carbon's
  `.js` −2.1% and −4.0%, its largest component −8.9% and −7.1%, its
  `.svelte` −2.0% and −2.4%. `ostia ab` against 0.9.0, 21 rounds: geomean
  −1.6%, nothing regressed. `parseModule` of Carbon's `.js` −4.6% to −6.3%,
  the long-name barrel −9.5%. Ten parses of the corpus kept alive retain
  145.9 MB (146.4 MB on 0.9.0).

## 0.9.0 — 2026-10-03

**Fixes**

- The TypeScript plugin rejects `({ m() })` and `x = function f();`. It used
  to accept them as `TSDeclareMethod` and `TSDeclareFunction`. A missing body
  is allowed only on function declarations and class methods, as overloads,
  matching acorn-typescript.
- `isRunesMode` no longer throws a plain `Error` on a snippet signature that
  TypeScript reads as a type assertion, such as `<T<U>>(x)`. svelte takes
  `params` off whatever parsed, so `parameters` is undefined; sveast assumed
  the array.

**Performance**

- Markup expressions reuse one acorn parser. The last call's parser is reset
  when its options match, and a parser that threw is dropped. Each expression
  used to construct a new one.
- `checkUnreserved` returns unless the name is a reserved word, instead of
  walking the scope stack for `inGenerator`, `inAsync` and the this-scope on
  every identifier. `canInsertSemicolon` scans for a line break instead of
  slicing and testing a regular expression. `reset` keeps the context, label,
  scope and private-name stacks when they are still in the state a new parser
  starts in. `ostia ab`, 15 rounds: geomean −6.0%. The corpus is −4.2%
  (−5.7% with `loc: true`), Carbon's largest components −5% to −9%,
  `parseModule` of Carbon's `.js` −8.4%, expression tags −10.8%, special tags
  −15.7%, typed patterns −11.0%.
- Declaring a name looks it up in a `Set` once a scope has more than 16
  names. acorn's `declareName` used `indexOf`, and the TypeScript plugin
  `includes`, so n declarations in one scope took O(n²). `parseModule` of n
  `const` declarations: 1,000 from 2.02 ms to 0.85 ms, 4,000 from 20.0 ms to
  2.19 ms, 16,000 from 272 ms to 8.74 ms. Script workloads: geomean −3.1%;
  TypeScript ambiguities (100 kB) −20%, comments (100 kB) −15%.
- A `ParseError` no longer splits the whole source into lines. The locator
  finds line starts only as far as the offsets it's asked about, and the
  frame slices its five lines from them. An error at the start of a large
  component goes from 122 µs to 8.9 µs. The parser throws and catches
  `ParseError`s internally, as when an `{#each}` expression reads too far.
- A reused parser gets its line from the locator. `reset` used
  `lastIndexOf("\n")` from the expression, and with `locations` counted the
  line by splitting everything before it, both O(offset) per expression.
  Expression tags on one line, 100 kB: −38%. The same with CR line breaks and
  `loc: true`: −41%.
- A markup destructuring pattern is read off the component's own text.
  It was parsed as `` `${prefix} = 1` ``, which copied the component up to
  the pattern, and strings sliced from the copy kept that copy alive. An AST
  of a 100 kB component with an `{#each}` pattern with a default in every row
  retains 1.2 MB instead of 60.6 MB. Destructuring patterns, 100 kB: 20.1 ms
  to 11.6 ms. `{#each}` with defaults, 100 kB: 25.7 ms to 12.0 ms. Typed
  patterns, 10 kB: 3.16 ms to 2.72 ms. Geomean −7.7%.
- The expression fast path reads calls, unary `-`, arithmetic, relational,
  equality and logical operators, and conditionals, so `open ? "region" :
  undefined`, `getIconSize(size)` and `a + b * c` no longer construct an
  acorn parse. It still hands acorn `??` next to `||` or `&&`, `<` and `>`
  under TypeScript, and comments, spread, trailing commas, `**`, shifts and
  assignments. Corpus −3.6%, Carbon's DataTable −9.2%, special tags −48%,
  expression tags −24% (−38% with `loc: true`, −85% on one line), snippets
  and render tags −27%.
- Repeated identifier and keyword text shares one string. The corpus's ASTs
  hold 51,000 names and 4,800 distinct ones; each used to be a new slice of
  the source, and a slice of three characters or more keeps its whole source
  alive. Ten parses of the corpus kept alive retain 147.3 MB instead of
  153.8 MB. Timing is unchanged (geomean −0.3%).

## 0.8.0 — 2026-10-02

**Features**

- `lexComponent(source)`, from `sveast/lexer` and `sveast`, finds a
  component's top-level `<script>`s, `<style>` and `<svelte:options>`, with
  their attributes and the offsets of their tags and content, without a
  parser. It skips the markup by tracking tags, blocks, attribute values and
  the brackets of each `{…}` expression, so a `<script>` in `<svelte:head>`,
  a block, an attribute or a comment isn't one, and it stops after the last
  such tag. Where `parse` accepts the component, the sections are its
  `instance`, `module`, `css` and `options`, with the same offsets, into the
  source without a leading byte order mark. It doesn't check syntax and
  never throws. An attribute's `value` is as written, without its quotes;
  an attribute without a value has `true`. `typescript` is whether `parse`
  reads the component as TypeScript, from the first `<script>` with a
  `lang`. `LexedComponent`, `LexedScript`, `LexedStyle`, `LexedOptions`,
  `LexedAttribute` and `LexedContent` are exported.
- `parseSections(source, options?)` parses those sections as `parse` does
  and skips the markup between them. `fragment.nodes` is empty, `comments`
  has only the scripts' comments, and the markup's syntax errors aren't
  reported; the rest is `parse`'s, offsets and the HTML comment before a
  `<script>` included. It takes `parse`'s options. It's a separate export so
  a bundle with only `parse` doesn't carry the lexer; `createParser` doesn't
  return it.
- `isRunesMode(source)` is whether svelte compiles the component in runes
  mode, as `compile(source).metadata.runes` says: `<svelte:options runes>`
  if it has one, otherwise a rune such as `$state` or `$props`, or `await`
  outside a function in the instance script or markup. A `$state` that
  subscribes to a store named `state`, or that a function declares, isn't a
  rune. Most components are decided without parsing: `<svelte:options>` is
  read with `lexComponent`, a component without a rune's name or `await`
  isn't in runes mode, and one whose scripts call a rune in a way that can't
  be a declaration, a method, a type or a store is. The rest is parsed,
  without the markup unless a rune's name or `await` is in it, and a syntax
  error there throws a `ParseError`.
- `createLocator(source)`, from `sveast` and `sveast/walk`, returns a
  function from an offset to `{ line, column }`, line from 1 and column from
  0, as `loc: true` gives them, for tools that parse without `loc`. Lines
  are found on the first call, and each lookup starts at the line found
  last. Lines end at `\n`, as in the markup's `loc` and `ParseError`; acorn's
  `loc` in scripts and modules also ends them at a lone `\r`, U+2028 and
  U+2029. `parse` drops a leading byte order mark, so pass the source
  without one.
- `walk(node, visitor, keys?)` takes a keys table. `markupVisitorKeys` visits
  only the markup: `Root`'s `fragment`, elements' attributes and fragments,
  attribute values and blocks' fragments, but no script, style or expression.
  A node whose type the table has no entry for throws. `VisitorKeys` is
  exported. `sveast/walk` also exports `markupVisitorKeys` and
  `createLocator`.
- `createModuleParser(support?)`, from `sveast/module`, returns `parseModule`
  and `parseImportsExports` without the template parser, for tools that read
  `.js` and `.ts` files but never components. `createParser()` returns its
  parsers together, so a bundle that only uses its `parseModule` still has
  the template and CSS parsers: 40.3 kB gzipped. `createModuleParser()`
  minifies to 26.4 kB, and 34.9 kB with `typescript` from
  `sveast/typescript`. With it, the parsers are the same as `sveast`'s.
  `ModuleParser` and `ModuleParserSupport` are exported.

**Performance**

- `lexComponent` is about 50× faster than `parse` on the benchmark corpus.
  `parseSections` is 1.5× faster there, where most of what's left is the
  scripts. `markupVisitorKeys` is 4.8× faster than the full walk on that
  corpus. On 12,808 components from other Svelte projects, `isRunesMode`
  takes a twelfth of the time parsing them does. `lexComponent` and
  `parseSections` match `parse` on 12,809 components, and `isRunesMode`
  matches `compile` on 12,167.

## 0.7.0 — 2026-10-01

**Features**

- `lexImportsExports(source)`, from `sveast/lexer` and `sveast`, returns a
  module's top-level `import` statements and `export … from` re-exports with
  their offsets, sources and names, read by hand on top of
  `parseImportsExports`' scanner instead of parsed by acorn. `dist/lexer.js`
  and its scanner chunk minify to 3.2 kB gzipped and load neither acorn nor
  the template parser, so a synchronous preprocessor can import it eagerly.
  It finds statements the way `parseImportsExports` does with
  `localExports: false`, and on every statement that accepts, the offsets,
  sources and names are the same. It doesn't check syntax and never throws:
  a statement it can't read, including TypeScript's `import a = require("a")`,
  comes back with `source: null` and no specifiers, ending where it stopped
  reading. `import type` and `type` before a name are always read. `export
  let`, `export function` and other exports of the module's own bindings
  aren't returned. `LexedStatement`, `LexedImport`, `LexedExport`,
  `LexedImportSpecifier`, `LexedExportSpecifier` and `LexedSource` are
  exported.

**Performance**

- The import scanner stops after the last `import` or `export` word it would
  stop at, found up front with a regular expression, so the code after a
  component's imports is never read. On an 18 kB body with no imports,
  `parseImportsExports` goes from about 390 µs to 3 µs. Against the previous
  version, Carbon's scripts with `localExports: false` are 16% faster and
  the largest script 19% faster.
- On Carbon's 327 component scripts, `lexImportsExports` takes about 40% of
  the time `parseImportsExports` with `localExports: false` takes, and on
  the largest, 63 kB, about an eighth. A fresh Node process imports
  `sveast/lexer` in 1.4 ms, against 7.0 ms for `parseImportsExports`.

## 0.6.0 — 2026-10-01

**Features**

- `parseImportsExports(source, options?)` returns a module's top-level
  `import` and `export` statements, the same nodes `parseModule` returns
  with `comments: false`, without parsing the rest. A tokenizer that only
  tracks strings, comments, templates, regular expressions and brackets
  skips to each one, and one acorn parser parses just that statement, so a
  name exported twice still throws `ParseError`. Unlike a regex, it never
  matches an `import` in a comment, a string, a template or a nested
  `declare module` block. `import(...)` and `import.meta` aren't statements,
  so they aren't returned. `typescript` (default `false`) parses `import
  type`, `export type` and `import a = require("a")`. `localExports: false`
  returns only imports and exports with a `from`, and skips `export let`,
  `export function` and the like as other code. Default `true`.
  `createParser` returns it too. `ParseImportsExportsOptions` is exported.
- `isReference(node, parent)` is whether an `Identifier` names a binding
  rather than a property, method or label name, or the renamed side of a
  specifier: the check svelte's analyzer makes with the `is-reference`
  package, given the `parent` `walk` passes. It also rejects `import.meta`'s
  and `new.target`'s names, import attribute keys, `export * as` names, and
  names in TypeScript types, keeping value positions under TypeScript nodes
  such as `a as B` and `a!`. Any node that isn't an `Identifier` is `false`.
- `extractIdentifiers(pattern)` returns the `Identifier` nodes a pattern
  binds, in source order, as svelte's `extract_identifiers` does: not
  property keys, defaults or type annotations, and nothing for a member
  expression target. It also takes parameter properties and an assignment's
  `left`, unwrapping `a!`, `a as T`, `a satisfies T` and `<T>a` there, so a
  function's `params` and `node.left` type-check as they are.
- `sveast/walk` exports `walk`, `SKIP`, `STOP`, `visitorKeys`, `Visitor`,
  `isReference`, `extractIdentifiers` and the AST types, the same values as
  `sveast`'s. `dist/walk.js` loads neither acorn nor the parser; the entry
  now has a `package.json` export and `walk.d.ts`, so importing it doesn't
  load the parser chunks.

**Performance**

- On Carbon's 327 component scripts, median of 50 runs, `parseImportsExports`
  takes 10.7 ms against `parseModule`'s 33.8 ms, and 4.5 ms with
  `localExports: false`. The largest script, 63 kB, takes 0.37 ms against
  2.7 ms.

**Breaking**

- `walk` no longer treats `false` from `enter` as "skip the children". An
  expression-bodied `enter` such as `(node) => node.type === "Component" &&
  names.add(node.name)` returned `false` for every other node, so the walk
  never got past the root and collected nothing, with no error. Return
  `SKIP` to skip a node's children; `leave` still runs. Any other value,
  `false` included, is ignored.

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
