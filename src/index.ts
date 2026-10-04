export { isValidType } from "./is-valid-type";
export type {
  LexedAttribute,
  LexedComponent,
  LexedContent,
  LexedExport,
  LexedExportSpecifier,
  LexedImport,
  LexedImportSpecifier,
  LexedOptions,
  LexedScript,
  LexedSource,
  LexedStatement,
  LexedString,
  LexedStyle,
} from "./lexer";
export { lexComponent, lexImportsExports, lexStrings } from "./lexer";
export type {
  ParseImportsExportsOptions,
  ParseModuleOptions,
  ParseOptions,
} from "./options";
export { parse } from "./parse";
export { parseImportsExports } from "./parse-imports-exports";
export { ParseError, parseModule } from "./parse-module";
export { parseSections } from "./parse-sections";
export { isRunesMode } from "./runes";
export type * from "./types/estree";
export type { AST } from "./types/svelte-ast";
export type * from "./types/typescript";
export type { Visitor, VisitorKeys } from "./walk";
export {
  createLocator,
  extractIdentifiers,
  isReference,
  markupVisitorKeys,
  SKIP,
  STOP,
  visitorKeys,
  walk,
} from "./walk";
