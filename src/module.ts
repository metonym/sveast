import { parseImportsExportsWith } from "./imports-exports";
import type {
  ParseImportsExportsOptions,
  ParseModuleOptions,
  TypeScriptSupport,
} from "./options";
import { parseModuleWith } from "./parse-module-with";
import { typeScriptParser } from "./support";
import type { ModuleDeclaration, Program } from "./types/estree";

export type {
  ParseImportsExportsOptions,
  ParseModuleOptions,
  TypeScriptSupport,
} from "./options";
export { ParseError } from "./parse-error";
export type * from "./types/estree";
export type * from "./types/typescript";

/** What {@link createModuleParser} parses with, beyond JavaScript. */
export interface ModuleParserSupport {
  /**
   * `typescript` from `sveast/typescript`. Without it, `parseModule` or
   * `parseImportsExports` with `typescript: true` throws an `Error` rather
   * than parse TypeScript as JavaScript.
   */
  typescript?: TypeScriptSupport;
}

/** The parsers {@link createModuleParser} returns. */
export interface ModuleParser {
  /** `parseModule` from `sveast`, with only what the parser was created with. */
  parseModule(source: string, options?: ParseModuleOptions): Program;
  /** `parseImportsExports` from `sveast`, with only what the parser was created with. */
  parseImportsExports(
    source: string,
    options?: ParseImportsExportsOptions,
  ): ModuleDeclaration[];
}

/**
 * `parseModule` and `parseImportsExports` without the template parser,
 * for tools that read `.js` and `.ts` files but never components. With
 * `typescript`, they're the same as `sveast`'s.
 *
 * ```ts
 * import { createModuleParser } from "sveast/module";
 * import { typescript } from "sveast/typescript";
 *
 * const { parseModule, parseImportsExports } = createModuleParser({ typescript });
 * ```
 */
export function createModuleParser(
  support: ModuleParserSupport = {},
): ModuleParser {
  const typescript = typeScriptParser(support.typescript);
  return {
    parseModule: (source, options = {}) =>
      parseModuleWith(source, options, typescript),
    parseImportsExports: (source, options = {}) =>
      parseImportsExportsWith(source, options, typescript),
  };
}
