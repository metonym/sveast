import { fieldsOf, isNode } from "./nodes";
import type { AST } from "./types/svelte-ast";

export { extractIdentifiers } from "./extract-identifiers";
export { isReference } from "./is-reference";
export { createLocator } from "./locator";
export type * from "./types/estree";
export type { AST } from "./types/svelte-ast";
export type * from "./types/typescript";

// The parser removes ParenthesizedExpression, which `./nodes` declares.
type NodeType = Exclude<AST.SvelteNode["type"], "ParenthesizedExpression">;
type ChildKey<T extends NodeType> = keyof Extract<AST.SvelteNode, { type: T }> &
  string;

/**
 * The fields of each node type that hold child nodes, in source order.
 * Typed against the AST, so a node type without an entry, or a key that
 * isn't one of its fields, fails typechecking. `tests/walk.test.ts` checks
 * the rest against the corpus: no field that holds a node is missing, and
 * children come in source order.
 */
export const visitorKeys = {
  // svelte
  Root: ["module", "instance", "fragment", "css"],
  Script: ["attributes", "content"],
  Fragment: ["nodes"],
  Text: [],
  Comment: [],
  ExpressionTag: ["expression"],
  HtmlTag: ["expression"],
  ConstTag: ["declaration"],
  DeclarationTag: ["declaration"],
  DebugTag: ["identifiers"],
  RenderTag: ["expression"],
  AttachTag: ["expression"],
  Attribute: ["value"],
  SpreadAttribute: ["expression"],
  AnimateDirective: ["expression"],
  BindDirective: ["expression"],
  ClassDirective: ["expression"],
  LetDirective: ["expression"],
  OnDirective: ["expression"],
  StyleDirective: ["value"],
  TransitionDirective: ["expression"],
  UseDirective: ["expression"],
  Component: ["attributes", "fragment"],
  TitleElement: ["attributes", "fragment"],
  SlotElement: ["attributes", "fragment"],
  RegularElement: ["attributes", "fragment"],
  SvelteBody: ["attributes", "fragment"],
  SvelteBoundary: ["attributes", "fragment"],
  SvelteComponent: ["expression", "attributes", "fragment"],
  SvelteDocument: ["attributes", "fragment"],
  SvelteElement: ["tag", "attributes", "fragment"],
  SvelteFragment: ["attributes", "fragment"],
  SvelteHead: ["attributes", "fragment"],
  SvelteOptions: ["attributes", "fragment"],
  SvelteSelf: ["attributes", "fragment"],
  SvelteWindow: ["attributes", "fragment"],
  IfBlock: ["test", "consequent", "alternate"],
  EachBlock: ["expression", "context", "key", "body", "fallback"],
  AwaitBlock: ["expression", "pending", "value", "then", "error", "catch"],
  KeyBlock: ["expression", "fragment"],
  SnippetBlock: ["expression", "parameters", "body"],

  // CSS
  StyleSheet: ["attributes", "children"],
  Rule: ["prelude", "block"],
  Atrule: ["block"],
  SelectorList: ["children"],
  ComplexSelector: ["children"],
  RelativeSelector: ["combinator", "selectors"],
  Combinator: [],
  TypeSelector: [],
  IdSelector: [],
  ClassSelector: [],
  AttributeSelector: [],
  PseudoElementSelector: ["args"],
  PseudoClassSelector: ["args"],
  Percentage: [],
  Nth: [],
  NestingSelector: [],
  Block: ["children"],
  Declaration: [],

  // estree
  Program: ["body"],
  ExpressionStatement: ["expression"],
  BlockStatement: ["body"],
  StaticBlock: ["body"],
  EmptyStatement: [],
  DebuggerStatement: [],
  WithStatement: ["object", "body"],
  ReturnStatement: ["argument"],
  LabeledStatement: ["label", "body"],
  BreakStatement: ["label"],
  ContinueStatement: ["label"],
  IfStatement: ["test", "consequent", "alternate"],
  SwitchStatement: ["discriminant", "cases"],
  SwitchCase: ["test", "consequent"],
  ThrowStatement: ["argument"],
  TryStatement: ["block", "handler", "finalizer"],
  CatchClause: ["param", "body"],
  WhileStatement: ["test", "body"],
  DoWhileStatement: ["body", "test"],
  ForStatement: ["init", "test", "update", "body"],
  ForInStatement: ["left", "right", "body"],
  ForOfStatement: ["left", "right", "body"],
  FunctionDeclaration: ["id", "typeParameters", "params", "returnType", "body"],
  FunctionExpression: ["id", "typeParameters", "params", "returnType", "body"],
  ArrowFunctionExpression: ["typeParameters", "params", "returnType", "body"],
  VariableDeclaration: ["declarations"],
  VariableDeclarator: ["id", "init"],
  ClassDeclaration: [
    "decorators",
    "id",
    "typeParameters",
    "superClass",
    "superTypeParameters",
    "implements",
    "body",
  ],
  ClassExpression: [
    "decorators",
    "id",
    "typeParameters",
    "superClass",
    "superTypeParameters",
    "implements",
    "body",
  ],
  ClassBody: ["body"],
  MethodDefinition: ["decorators", "key", "typeParameters", "value"],
  PropertyDefinition: ["decorators", "key", "typeAnnotation", "value"],
  Property: ["decorators", "key", "value"],
  ThisExpression: [],
  Super: [],
  Literal: [],
  Identifier: ["decorators", "typeAnnotation"],
  PrivateIdentifier: [],
  ArrayExpression: ["elements"],
  ObjectExpression: ["properties"],
  UnaryExpression: ["argument"],
  UpdateExpression: ["argument"],
  BinaryExpression: ["left", "right"],
  LogicalExpression: ["left", "right"],
  AssignmentExpression: ["left", "right"],
  MemberExpression: ["object", "property"],
  ConditionalExpression: ["test", "consequent", "alternate"],
  CallExpression: ["callee", "typeArguments", "arguments"],
  NewExpression: ["callee", "typeArguments", "arguments"],
  SequenceExpression: ["expressions"],
  TemplateLiteral: ["quasis", "expressions"],
  TaggedTemplateExpression: ["tag", "typeArguments", "quasi"],
  TemplateElement: [],
  SpreadElement: ["argument"],
  RestElement: ["decorators", "argument", "typeAnnotation"],
  YieldExpression: ["argument"],
  AwaitExpression: ["argument"],
  ImportExpression: ["source", "options", "arguments"],
  ChainExpression: ["expression"],
  MetaProperty: ["meta", "property"],
  ObjectPattern: ["decorators", "properties", "typeAnnotation"],
  ArrayPattern: ["decorators", "elements", "typeAnnotation"],
  AssignmentPattern: ["decorators", "left", "right"],
  ImportDeclaration: ["specifiers", "source", "attributes"],
  ImportSpecifier: ["imported", "local"],
  ImportDefaultSpecifier: ["local"],
  ImportNamespaceSpecifier: ["local"],
  ImportAttribute: ["key", "value"],
  ExportNamedDeclaration: ["declaration", "specifiers", "source", "attributes"],
  ExportSpecifier: ["local", "exported"],
  ExportDefaultDeclaration: ["declaration"],
  ExportAllDeclaration: ["exported", "source", "attributes"],
  Decorator: ["expression"],

  // TypeScript
  TSTypeAnnotation: ["typeAnnotation"],
  TSTypeParameterDeclaration: ["params"],
  TSTypeParameterInstantiation: ["params"],
  TSTypeParameter: ["constraint", "default"],
  TSAnyKeyword: [],
  TSBigIntKeyword: [],
  TSBooleanKeyword: [],
  TSNeverKeyword: [],
  TSNullKeyword: [],
  TSNumberKeyword: [],
  TSObjectKeyword: [],
  TSStringKeyword: [],
  TSSymbolKeyword: [],
  TSUndefinedKeyword: [],
  TSUnknownKeyword: [],
  TSVoidKeyword: [],
  TSThisType: [],
  TSArrayType: ["elementType"],
  TSTupleType: ["elementTypes"],
  TSNamedTupleMember: ["label", "elementType"],
  TSOptionalType: ["typeAnnotation"],
  TSRestType: ["typeAnnotation"],
  TSUnionType: ["types"],
  TSIntersectionType: ["types"],
  TSConditionalType: ["checkType", "extendsType", "trueType", "falseType"],
  TSInferType: ["typeParameter"],
  TSParenthesizedType: ["typeAnnotation"],
  TSTypeOperator: ["typeAnnotation"],
  TSIndexedAccessType: ["objectType", "indexType"],
  TSMappedType: ["typeParameter", "nameType", "typeAnnotation"],
  TSLiteralType: ["literal"],
  TSTypeReference: ["typeName", "typeArguments"],
  TSQualifiedName: ["left", "right"],
  TSTypeQuery: ["exprName", "typeArguments"],
  TSImportType: ["argument", "qualifier", "typeArguments"],
  TSTypeLiteral: ["members"],
  TSPropertySignature: ["key", "typeAnnotation"],
  TSMethodSignature: ["key", "typeParameters", "parameters", "typeAnnotation"],
  TSCallSignatureDeclaration: [
    "typeParameters",
    "parameters",
    "typeAnnotation",
  ],
  TSConstructSignatureDeclaration: [
    "typeParameters",
    "parameters",
    "typeAnnotation",
  ],
  TSFunctionType: ["typeParameters", "parameters", "typeAnnotation"],
  TSConstructorType: ["typeParameters", "parameters", "typeAnnotation"],
  TSIndexSignature: ["decorators", "parameters", "typeAnnotation"],
  TSTypePredicate: ["parameterName", "typeAnnotation"],
  TSInterfaceDeclaration: ["id", "typeParameters", "extends", "body"],
  TSInterfaceBody: ["body"],
  TSExpressionWithTypeArguments: ["expression", "typeParameters"],
  TSTypeAliasDeclaration: ["id", "typeParameters", "typeAnnotation"],
  TSEnumDeclaration: ["id", "members"],
  TSEnumMember: ["id", "initializer"],
  TSModuleDeclaration: ["id", "body"],
  TSModuleBlock: ["body"],
  TSImportEqualsDeclaration: ["id", "moduleReference"],
  TSExternalModuleReference: ["expression"],
  TSExportAssignment: ["expression"],
  TSNamespaceExportDeclaration: ["id"],
  TSDeclareFunction: ["id", "typeParameters", "params", "returnType"],
  TSDeclareMethod: ["typeParameters", "params", "returnType"],
  TSParameterProperty: ["parameter"],
  TSAsExpression: ["expression", "typeAnnotation"],
  TSSatisfiesExpression: ["expression", "typeAnnotation"],
  TSTypeAssertion: ["typeAnnotation", "expression"],
  TSNonNullExpression: ["expression"],
  TSInstantiationExpression: ["expression", "typeArguments"],
} as const satisfies {
  readonly [T in NodeType]: readonly ChildKey<T>[];
};

/** A table of the fields of each node type that {@link walk} visits, such as {@link visitorKeys} or {@link markupVisitorKeys}. */
export type VisitorKeys = Readonly<Partial<Record<string, readonly string[]>>>;

const ELEMENT = ["attributes", "fragment"] as const;

/**
 * The fields of the markup's nodes that hold other markup nodes, for a
 * {@link walk} that never enters the scripts, the styles or the
 * expressions: `Root` holds only its `fragment`, an `ExpressionTag` or a
 * directive has no children, and a block holds only its fragments.
 */
export const markupVisitorKeys = {
  Root: ["fragment"],
  Fragment: ["nodes"],
  Text: [],
  Comment: [],
  ExpressionTag: [],
  HtmlTag: [],
  ConstTag: [],
  DeclarationTag: [],
  DebugTag: [],
  RenderTag: [],
  AttachTag: [],
  Attribute: ["value"],
  SpreadAttribute: [],
  AnimateDirective: [],
  BindDirective: [],
  ClassDirective: [],
  LetDirective: [],
  OnDirective: [],
  StyleDirective: ["value"],
  TransitionDirective: [],
  UseDirective: [],
  Component: ELEMENT,
  TitleElement: ELEMENT,
  SlotElement: ELEMENT,
  RegularElement: ELEMENT,
  SvelteBody: ELEMENT,
  SvelteBoundary: ELEMENT,
  SvelteComponent: ELEMENT,
  SvelteDocument: ELEMENT,
  SvelteElement: ELEMENT,
  SvelteFragment: ELEMENT,
  SvelteHead: ELEMENT,
  SvelteOptions: ELEMENT,
  SvelteSelf: ELEMENT,
  SvelteWindow: ELEMENT,
  IfBlock: ["consequent", "alternate"],
  EachBlock: ["body", "fallback"],
  AwaitBlock: ["pending", "then", "catch"],
  KeyBlock: ["fragment"],
  SnippetBlock: ["body"],
} as const satisfies {
  readonly [T in NodeType]?: readonly ChildKey<T>[];
};

const keysByType: Partial<Record<string, readonly string[]>> = Object.assign(
  Object.create(null),
  visitorKeys,
);
const NO_KEYS: readonly string[] = [];

/**
 * Return it from `enter` or `leave` to end the walk: no further `enter` or
 * `leave` calls, including `leave` on the node's ancestors.
 */
export const STOP: unique symbol = Symbol("sveast.walk.stop");

/**
 * Return it from `enter` to skip the node's children; `leave` is still
 * called on the node.
 */
export const SKIP: unique symbol = Symbol("sveast.walk.skip");

/** The callbacks {@link walk} calls for each node. */
export interface Visitor {
  /**
   * Called before the node's children. Return {@link SKIP} to skip them;
   * `leave` is still called, so the two stay paired. Return {@link STOP} to
   * end the walk. Return another node to put it in this one's place: `walk`
   * writes it to `parent[key]` (or `parent[key][index]`), then calls `enter`
   * on it and visits its children instead. Any other value, `false`
   * included, is ignored, so `(node) => node.type === "Component" &&
   * names.add(node.name)` visits every node.
   */
  enter?(
    node: AST.SvelteNode,
    parent: AST.SvelteNode | null,
    key: string | null,
    index: number | null,
  ): unknown;
  /** Called after the node's children. Return {@link STOP} to end the walk. */
  leave?(
    node: AST.SvelteNode,
    parent: AST.SvelteNode | null,
    key: string | null,
    index: number | null,
  ): unknown;
}

/**
 * Visits `node` and its descendants depth-first, in source order, calling
 * `visitor.enter` before a node's children and `visitor.leave` after them.
 * `parent[key]` is the node, or `parent[key][index]` when the field is an
 * array; all three are `null` for `node` itself. `keys` says which fields
 * of each node type to visit, {@link visitorKeys} by default; with
 * {@link markupVisitorKeys}, only the markup is visited. A node whose
 * type it has no entry for throws.
 */
export function walk(
  node: AST.SvelteNode,
  visitor: Visitor,
  keys?: VisitorKeys,
): void {
  visit(
    node,
    null,
    null,
    null,
    visitor,
    keys === undefined || keys === visitorKeys
      ? keysOf
      : (child) =>
          Object.hasOwn(keys, child.type) ? keys[child.type] : undefined,
  );
}

type KeysOf = (node: AST.SvelteNode) => readonly string[] | undefined;

function visit(
  node: AST.SvelteNode,
  parent: AST.SvelteNode | null,
  key: string | null,
  index: number | null,
  visitor: Visitor,
  keysFor: KeysOf,
): boolean {
  const keys = keysFor(node);
  if (keys === undefined) throw new Error(`unknown node type: ${node.type}`);
  const entered = visitor.enter?.(node, parent, key, index);
  if (entered === STOP) return true;
  if (entered !== SKIP) {
    if (entered !== node && isNode(entered)) {
      return replace(entered, parent, key, index, visitor, keysFor);
    }
    const fields = fieldsOf(node);
    for (let k = 0; k < keys.length; k++) {
      const field = keys[k];
      const value = fields[field];
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
          const child: unknown = value[i];
          if (isNode(child) && visit(child, node, field, i, visitor, keysFor)) {
            return true;
          }
        }
      } else if (
        isNode(value) &&
        visit(value, node, field, null, visitor, keysFor)
      ) {
        return true;
      }
    }
  }
  return visitor.leave?.(node, parent, key, index) === STOP;
}

function keysOf(node: AST.SvelteNode): readonly string[] | undefined {
  const type = node.type;
  if (type === "Identifier") {
    return node.typeAnnotation === undefined && node.decorators === undefined
      ? NO_KEYS
      : visitorKeys.Identifier;
  }
  if (type === "Literal") return visitorKeys.Literal;
  if (type === "Text") return visitorKeys.Text;
  return keysByType[type];
}

function replace(
  node: AST.SvelteNode,
  parent: AST.SvelteNode | null,
  key: string | null,
  index: number | null,
  visitor: Visitor,
  keysFor: KeysOf,
): boolean {
  if (parent === null || key === null) {
    throw new Error("walk can't replace the node it was called with");
  }
  const fields = fieldsOf(parent);
  const field = fields[key];
  if (index === null) fields[key] = node;
  else if (Array.isArray(field)) field[index] = node;
  return visit(node, parent, key, index, visitor, keysFor);
}
