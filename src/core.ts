import { parseComponent } from "./component";
import { xmlEntityNames } from "./html-entities";
import { parseImportsExportsWith } from "./imports-exports";
import type {
  EntitySupport,
  ParseImportsExportsOptions,
  ParseModuleOptions,
  ParseOptions,
  TypeScriptSupport,
} from "./options";
import { parseModuleWith } from "./parse-module-with";
import { entityNamesOf, type Support, typeScriptParser } from "./support";
import type { ModuleDeclaration, Program } from "./types/estree";
import type { AST } from "./types/svelte-ast";

export type {
  EntitySupport,
  ParseImportsExportsOptions,
  ParseModuleOptions,
  ParseOptions,
  TypeScriptSupport,
} from "./options";
export { ParseError } from "./parse-error";
export type * from "./types/estree";
export type { AST } from "./types/svelte-ast";
export type * from "./types/typescript";

/** What {@link createParser} parses with, beyond JavaScript and the markup. */
export interface ParserSupport {
  /**
   * `typescript` from `sveast/typescript`. Without it, a component with
   * `<script lang="ts">`, or `parseModule` with `typescript: true`, throws
   * an `Error` rather than parse TypeScript as JavaScript.
   */
  typescript?: TypeScriptSupport;
  /**
   * `entities` from `sveast/entities`. Without it, text and attribute
   * values decode only numeric references, such as `&#169;`, and `&amp;`,
   * `&apos;`, `&gt;`, `&lt;` and `&quot;`; other named references, such
   * as `&copy;`, are left as written.
   */
  entities?: EntitySupport;
}

/** The parsers {@link createParser} returns. */
export interface Parser {
  /** `parse` from `sveast`, with only what the parser was created with. */
  parse(source: string, options?: ParseOptions): AST.Root;
  /** `parseModule` from `sveast`, with only what the parser was created with. */
  parseModule(source: string, options?: ParseModuleOptions): Program;
  /** `parseImportsExports` from `sveast`, with only what the parser was created with. */
  parseImportsExports(
    source: string,
    options?: ParseImportsExportsOptions,
  ): ModuleDeclaration[];
}

/**
 * Creates `parse`, `parseModule` and `parseImportsExports` that bundle
 * only what's passed in: the TypeScript plugin and the table of HTML's
 * named character references are about a third of sveast's size, and a
 * bundler leaves out whichever isn't imported. With both, they're the
 * same as `sveast`'s.
 *
 * ```ts
 * import { createParser } from "sveast/core";
 * import { typescript } from "sveast/typescript";
 *
 * const { parse, parseModule } = createParser({ typescript });
 * ```
 */
export function createParser(support: ParserSupport = {}): Parser {
  const typescript = typeScriptParser(support.typescript);
  const internal: Support = {
    typescript,
    entityNames: entityNamesOf(support.entities) ?? xmlEntityNames,
  };
  return {
    parse: (source, options) => parseComponent(source, options, internal),
    parseModule: (source, options = {}) =>
      parseModuleWith(source, options, typescript),
    parseImportsExports: (source, options = {}) =>
      parseImportsExportsWith(source, options, typescript),
  };
}
