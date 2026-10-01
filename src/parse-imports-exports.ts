import { parseImportsExportsWith } from "./imports-exports";
import type { ParseImportsExportsOptions } from "./options";
import type { ModuleDeclaration } from "./types/estree";
import { TypeScriptParser } from "./typescript-parser";

/**
 * Parses only a module's top-level `import` and `export` statements, e.g.
 * to rewrite or follow its imports, and skips the rest without building
 * it. Each node is the one {@link parseModule} returns for the statement
 * with `comments: false`: `ImportDeclaration`, `ExportNamedDeclaration`,
 * `ExportDefaultDeclaration` and `ExportAllDeclaration`, plus, with
 * `typescript: true`, `TSImportEqualsDeclaration`, `TSExportAssignment`
 * and `TSNamespaceExportDeclaration`. `import(...)` and `import.meta`
 * aren't statements, so they aren't returned.
 *
 * Throws a {@link ParseError} (`js_parse_error`) on a syntax error in one
 * of those statements. Syntax errors in the rest aren't reported.
 */
export function parseImportsExports(
  source: string,
  options: ParseImportsExportsOptions = {},
): ModuleDeclaration[] {
  return parseImportsExportsWith(source, options, TypeScriptParser);
}
