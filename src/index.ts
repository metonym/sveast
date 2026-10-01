export { isValidType } from "./is-valid-type";
export type {
  LexedExport,
  LexedExportSpecifier,
  LexedImport,
  LexedImportSpecifier,
  LexedSource,
  LexedStatement,
} from "./lexer";
export { lexImportsExports } from "./lexer";
export type {
  ParseImportsExportsOptions,
  ParseModuleOptions,
  ParseOptions,
} from "./options";
export { parse } from "./parse";
export { parseImportsExports } from "./parse-imports-exports";
export { ParseError, parseModule } from "./parse-module";
export type * from "./types/estree";
export type { AST } from "./types/svelte-ast";
export type * from "./types/typescript";
export type { Visitor } from "./walk";
export {
  extractIdentifiers,
  isReference,
  SKIP,
  STOP,
  visitorKeys,
  walk,
} from "./walk";
