import type {
  AssignmentExpression,
  Expression,
  Identifier,
  Pattern,
} from "./types/estree";
import type { TSParameterProperty } from "./types/typescript";

/**
 * The `Identifier` nodes a pattern binds, in source order: `a`, `c`, `d`,
 * `e` and `f` in `{ a, b: [c, ...d], e = 1, ...f }`. Not the property
 * keys, defaults or type annotations. A member expression, which an
 * assignment's pattern can hold, as in `[a.b] = c`, binds nothing, so it
 * yields no identifiers, as in svelte's `extract_identifiers`. Also takes
 * a function's params as they are, parameter properties included, and an
 * assignment's `left`, where `a!`, `a as T`, `a satisfies T` and `<T>a`
 * yield `a`.
 */
export function extractIdentifiers(
  pattern: Pattern | TSParameterProperty | AssignmentExpression["left"],
): Identifier[] {
  const identifiers: Identifier[] = [];
  collect(pattern, identifiers);
  return identifiers;
}

function collect(
  pattern: Pattern | TSParameterProperty | Expression,
  identifiers: Identifier[],
): void {
  switch (pattern.type) {
    case "Identifier":
      identifiers.push(pattern);
      return;
    case "ObjectPattern":
      for (const property of pattern.properties) {
        collect(
          property.type === "RestElement" ? property.argument : property.value,
          identifiers,
        );
      }
      return;
    case "ArrayPattern":
      for (const element of pattern.elements) {
        if (element !== null) collect(element, identifiers);
      }
      return;
    case "RestElement":
      collect(pattern.argument, identifiers);
      return;
    case "AssignmentPattern":
      collect(pattern.left, identifiers);
      return;
    case "TSParameterProperty":
      collect(pattern.parameter, identifiers);
      return;
    case "TSAsExpression":
    case "TSNonNullExpression":
    case "TSSatisfiesExpression":
    case "TSTypeAssertion":
      collect(pattern.expression, identifiers);
  }
}
