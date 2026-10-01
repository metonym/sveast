# Changelog

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
