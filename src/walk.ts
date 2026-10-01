import { fieldsOf, isNode } from "./nodes";
import type { AST } from "./types/svelte-ast";

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

const keysByType = new Map<string, readonly string[]>(
  Object.entries(visitorKeys),
);

/**
 * Return it from `enter` or `leave` to end the walk: no further `enter` or
 * `leave` calls, including `leave` on the node's ancestors.
 */
export const STOP: unique symbol = Symbol("sveast.walk.stop");

/** The callbacks {@link walk} calls for each node. */
export interface Visitor {
  /**
   * Called before the node's children. Return `false` to skip them; `leave`
   * is still called, so the two stay paired. Return {@link STOP} to end the
   * walk.
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
 * array; all three are `null` for `node` itself.
 */
export function walk(node: AST.SvelteNode, visitor: Visitor): void {
  visit(node, null, null, null, visitor);
}

function visit(
  node: AST.SvelteNode,
  parent: AST.SvelteNode | null,
  key: string | null,
  index: number | null,
  visitor: Visitor,
): boolean {
  const keys = keysByType.get(node.type);
  if (keys === undefined) throw new Error(`unknown node type: ${node.type}`);
  const entered = visitor.enter?.(node, parent, key, index);
  if (entered === STOP) return true;
  if (entered !== false) {
    const fields = fieldsOf(node);
    for (const field of keys) {
      const value = fields[field];
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
          const child: unknown = value[i];
          if (isNode(child) && visit(child, node, field, i, visitor)) {
            return true;
          }
        }
      } else if (isNode(value) && visit(value, node, field, null, visitor)) {
        return true;
      }
    }
  }
  return visitor.leave?.(node, parent, key, index) === STOP;
}
