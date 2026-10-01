export { isValidType } from "./is-valid-type";
export type { ParseModuleOptions, ParseOptions } from "./options";
export { parse } from "./parse";
export { ParseError, parseModule } from "./parse-module";
export type * from "./types/estree";
export type { AST } from "./types/svelte-ast";
export type * from "./types/typescript";
export type { Visitor } from "./walk";
export { STOP, visitorKeys, walk } from "./walk";
