/**
 * Options for {@link parse}. The defaults give svelte's own output, minus
 * `loc` and `name_loc`.
 */
export interface ParseOptions {
  /**
   * Add `loc` (line/column) to script and expression nodes, and `name_loc`
   * to elements, attributes and directives, as svelte does. Off by default:
   * it makes parsing slower and the AST larger.
   */
  loc?: boolean;
  /**
   * Parse `<style>` into rules and selectors (`css.children`). With `false`,
   * `css` still has its `start`, `end` and `content`, but `children` and
   * `comments` are empty and CSS syntax errors aren't reported. Default `true`.
   */
  css?: boolean;
  /**
   * Parse each `<script>`'s JavaScript or TypeScript. With `false`, scripts
   * keep their attributes and bounds, and `content` is a `Program` with its
   * `start` and `end` but an empty `body`; their comments aren't in
   * `comments`, and their syntax errors aren't reported. Expressions in the
   * markup are still parsed. Default `true`.
   */
  script?: boolean;
  /**
   * Collect JavaScript comments, in scripts, expressions and tags, into
   * `comments` and attach them to nodes as `leadingComments` and
   * `trailingComments`. With `false`, `comments` is empty and no node has
   * either field, including the HTML comment before a `<script>` that
   * svelte copies into its `content.leadingComments`; HTML comments in the
   * markup and CSS comments are kept. Default `true`.
   */
  comments?: boolean;
}

/** Options for {@link parseModule}. */
export interface ParseModuleOptions {
  /** Parse TypeScript. Default `false`. */
  typescript?: boolean;
  /** Add `loc` (line/column) to every node. Default `false`. */
  loc?: boolean;
  /**
   * Attach comments as `leadingComments`/`trailingComments`. With
   * `false`, no node has either field. Default `true`.
   */
  comments?: boolean;
}

/** TypeScript support for {@link createParser}, from `sveast/typescript`. */
export interface TypeScriptSupport {
  readonly support: "typescript";
}

/** HTML's named character references for {@link createParser}, from `sveast/entities`. */
export interface EntitySupport {
  readonly support: "entities";
}
