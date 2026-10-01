import type { ParserConstructor } from "./acorn-internals";
import type { EntityNames } from "./html-entities";
import type { EntitySupport, TypeScriptSupport } from "./options";

interface TypeScriptInternals extends TypeScriptSupport {
  readonly parser: ParserConstructor;
}

interface EntityInternals extends EntitySupport {
  readonly names: () => EntityNames;
}

/** What a parser was created with: the TypeScript parser, if any, and the named character references it decodes. */
export interface Support {
  typescript: ParserConstructor | undefined;
  entityNames: () => EntityNames;
}

export function typeScriptSupport(
  parser: ParserConstructor,
): TypeScriptSupport {
  const internals: TypeScriptInternals = { support: "typescript", parser };
  return internals;
}

export function entitySupport(names: () => EntityNames): EntitySupport {
  const internals: EntityInternals = { support: "entities", names };
  return internals;
}

export function typeScriptParser(
  support: TypeScriptSupport | undefined,
): ParserConstructor | undefined {
  return support && "parser" in support
    ? (support as TypeScriptInternals).parser
    : undefined;
}

export function entityNamesOf(
  support: EntitySupport | undefined,
): (() => EntityNames) | undefined {
  return support && "names" in support
    ? (support as EntityInternals).names
    : undefined;
}

export function missingTypeScript(): never {
  throw new Error(
    'sveast: parsing TypeScript needs `typescript` from "sveast/typescript": createParser({ typescript })',
  );
}
