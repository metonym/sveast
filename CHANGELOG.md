# Changelog

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
