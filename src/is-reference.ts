import type { AST } from "./types/svelte-ast";

/**
 * Whether `node` is an `Identifier` that names a binding in the value
 * namespace, where it's declared or where it's used, given its `parent`
 * from `walk`. `false` for a property, method or label name, the
 * renamed side of an import or export specifier, `import.meta`'s and
 * `new.target`'s names, an import attribute's key, and every name in a
 * type. The check svelte's analyzer makes, from the `is-reference` package,
 * plus TypeScript: an `Identifier` whose parent is a TypeScript node is a
 * reference only as the expression of `as`, `satisfies`, `<T>x`, `x!`,
 * `f<T>` or `export =`, an enum member's initializer, a parameter
 * property, an enum's name, or the name or target of `import a = b`.
 */
export function isReference(
  node: AST.SvelteNode,
  parent: AST.SvelteNode | null,
): boolean {
  if (node.type !== "Identifier") return false;
  if (parent === null) return true;
  switch (parent.type) {
    case "MemberExpression":
      return parent.computed || node === parent.object;
    case "MethodDefinition":
      return parent.computed;
    case "Property":
    case "PropertyDefinition":
      return parent.computed || node === parent.value;
    case "ExportSpecifier":
    case "ImportSpecifier":
      return node === parent.local;
    case "MetaProperty":
    case "ImportAttribute":
    case "ExportAllDeclaration":
    case "LabeledStatement":
    case "BreakStatement":
    case "ContinueStatement":
      return false;
    case "TSAsExpression":
    case "TSSatisfiesExpression":
    case "TSTypeAssertion":
    case "TSNonNullExpression":
    case "TSInstantiationExpression":
    case "TSExportAssignment":
      return node === parent.expression;
    case "TSEnumMember":
      return node === parent.initializer;
    case "TSParameterProperty":
    case "TSEnumDeclaration":
    case "TSImportEqualsDeclaration":
      return true;
    default:
      return !parent.type.startsWith("TS");
  }
}
