import type {
  ArrayPattern,
  AssignmentPattern,
  BaseNode,
  Expression,
  Identifier,
  Literal,
  ModuleDeclaration,
  ObjectPattern,
  Pattern,
  RestElement,
  Statement,
  StringLiteral,
  TemplateElement,
  UnaryExpression,
} from "./estree";

export type TSNode =
  | Decorator
  | TSTypeAnnotation
  | TypeNode
  | TSTypePredicate
  | TSNamedTupleMember
  | TSOptionalType
  | TSRestType
  | TemplateLiteralType
  | TSTypeParameter
  | TSTypeParameterDeclaration
  | TSTypeParameterInstantiation
  | TSQualifiedName
  | TypeElement
  | TSInterfaceBody
  | TSExpressionWithTypeArguments
  | TSEnumMember
  | TSModuleBlock
  | TSExternalModuleReference
  | TSParameterProperty
  | TSDeclareMethod
  | TSDeclaration
  | TSModuleDeclarationStatement
  | TSExpression;

/** Declarations; in estree's `Declaration` union. */
export type TSDeclaration =
  | TSDeclareFunction
  | TSEnumDeclaration
  | TSInterfaceDeclaration
  | TSModuleDeclaration
  | TSTypeAliasDeclaration;

/** Module-level statements; in estree's `ModuleDeclaration` union. */
export type TSModuleDeclarationStatement =
  | TSExportAssignment
  | TSImportEqualsDeclaration
  | TSNamespaceExportDeclaration;

/** Expressions; in estree's `Expression` union. */
export type TSExpression =
  | TSAsExpression
  | TSInstantiationExpression
  | TSNonNullExpression
  | TSSatisfiesExpression
  | TSTypeAssertion;

export type TypeNode =
  | TSAnyKeyword
  | TSBigIntKeyword
  | TSBooleanKeyword
  | TSNeverKeyword
  | TSNullKeyword
  | TSNumberKeyword
  | TSObjectKeyword
  | TSStringKeyword
  | TSSymbolKeyword
  | TSUndefinedKeyword
  | TSUnknownKeyword
  | TSVoidKeyword
  | TSArrayType
  | TSConditionalType
  | TSConstructorType
  | TSFunctionType
  | TSImportType
  | TSIndexedAccessType
  | TSInferType
  | TSIntersectionType
  | TSLiteralType
  | TSMappedType
  | TSParenthesizedType
  | TSThisType
  | TSTupleType
  | TSTypeLiteral
  | TSTypeOperator
  | TSTypeQuery
  | TSTypeReference
  | TSUnionType;

export type TypeElement =
  | TSCallSignatureDeclaration
  | TSConstructSignatureDeclaration
  | TSIndexSignature
  | TSMethodSignature
  | TSPropertySignature;

export type EntityName = Identifier | TSQualifiedName;

export type Accessibility = "public" | "private" | "protected";

/** A parameter of a function type, method signature or declared function. */
export type SignatureParameter =
  | Identifier
  | ObjectPattern
  | ArrayPattern
  | RestElement;

/** Fields the plugin adds to `Identifier`, `ObjectPattern`, `ArrayPattern` and `RestElement`. */
export interface TSBindingFields {
  typeAnnotation?: TSTypeAnnotation | undefined;
  /** `a?` in a parameter list. */
  optional?: boolean;
  decorators?: Decorator[];
}

/** Fields the plugin adds to functions. */
export interface TSFunctionFields {
  typeParameters?: TSTypeParameterDeclaration;
  returnType?: TSTypeAnnotation;
}

/** Fields the plugin adds to classes. */
export interface TSClassFields {
  typeParameters?: TSTypeParameterDeclaration;
  superTypeParameters?: TSTypeParameterInstantiation;
  implements?: TSExpressionWithTypeArguments[];
  abstract?: boolean;
  declare?: boolean;
  decorators?: Decorator[];
}

/** Modifiers the plugin adds to class members. */
export interface TSClassMemberFields {
  accessibility?: Accessibility;
  abstract?: boolean;
  override?: boolean;
  readonly?: boolean;
  declare?: boolean;
  accessor?: boolean;
  optional?: boolean;
  decorators?: Decorator[];
}

export interface Decorator extends BaseNode {
  type: "Decorator";
  expression: Expression;
}

export interface TSTypeAnnotation extends BaseNode {
  type: "TSTypeAnnotation";
  /** A predicate (`x is T`, `asserts x`) only in a return type. */
  typeAnnotation: TypeNode | TSTypePredicate;
}

export interface TSTypePredicate extends BaseNode {
  type: "TSTypePredicate";
  parameterName: Identifier | TSThisType;
  asserts: boolean;
  /** `null` for `asserts x` without `is`. */
  typeAnnotation: TSTypeAnnotation | null;
}

export interface TSAnyKeyword extends BaseNode {
  type: "TSAnyKeyword";
}

export interface TSBigIntKeyword extends BaseNode {
  type: "TSBigIntKeyword";
}

export interface TSBooleanKeyword extends BaseNode {
  type: "TSBooleanKeyword";
}

export interface TSNeverKeyword extends BaseNode {
  type: "TSNeverKeyword";
}

export interface TSNullKeyword extends BaseNode {
  type: "TSNullKeyword";
}

export interface TSNumberKeyword extends BaseNode {
  type: "TSNumberKeyword";
}

export interface TSObjectKeyword extends BaseNode {
  type: "TSObjectKeyword";
}

export interface TSStringKeyword extends BaseNode {
  type: "TSStringKeyword";
}

export interface TSSymbolKeyword extends BaseNode {
  type: "TSSymbolKeyword";
}

export interface TSUndefinedKeyword extends BaseNode {
  type: "TSUndefinedKeyword";
}

export interface TSUnknownKeyword extends BaseNode {
  type: "TSUnknownKeyword";
}

export interface TSVoidKeyword extends BaseNode {
  type: "TSVoidKeyword";
}

export interface TSThisType extends BaseNode {
  type: "TSThisType";
}

export interface TSArrayType extends BaseNode {
  type: "TSArrayType";
  elementType: TypeNode;
}

export interface TSConditionalType extends BaseNode {
  type: "TSConditionalType";
  checkType: TypeNode;
  extendsType: TypeNode;
  trueType: TypeNode;
  falseType: TypeNode;
}

export interface TSFunctionType extends BaseNode {
  type: "TSFunctionType";
  typeParameters?: TSTypeParameterDeclaration;
  parameters: SignatureParameter[];
  typeAnnotation: TSTypeAnnotation;
}

export interface TSConstructorType extends BaseNode {
  type: "TSConstructorType";
  abstract: boolean;
  typeParameters?: TSTypeParameterDeclaration;
  parameters: SignatureParameter[];
  typeAnnotation: TSTypeAnnotation;
}

export interface TSImportType extends BaseNode {
  type: "TSImportType";
  argument: StringLiteral;
  qualifier?: EntityName;
  typeArguments?: TSTypeParameterInstantiation;
}

export interface TSIndexedAccessType extends BaseNode {
  type: "TSIndexedAccessType";
  objectType: TypeNode;
  indexType: TypeNode;
}

export interface TSInferType extends BaseNode {
  type: "TSInferType";
  typeParameter: TSTypeParameter;
}

export interface TSIntersectionType extends BaseNode {
  type: "TSIntersectionType";
  types: TypeNode[];
}

export interface TSUnionType extends BaseNode {
  type: "TSUnionType";
  types: TypeNode[];
}

export interface TSLiteralType extends BaseNode {
  type: "TSLiteralType";
  /** `UnaryExpression` for a negative number, e.g. `-1`. */
  literal: Literal | UnaryExpression | TemplateLiteralType;
}

/** A template literal type, `` `prefix-${T}` ``: a `TemplateLiteral` whose expressions are types. */
export interface TemplateLiteralType extends BaseNode {
  type: "TemplateLiteral";
  quasis: TemplateElement[];
  expressions: TypeNode[];
}

export interface TSMappedType extends BaseNode {
  type: "TSMappedType";
  readonly?: true | "+" | "-";
  typeParameter: TSTypeParameter;
  /** The `as` clause. */
  nameType: TypeNode | null;
  optional?: true | "+" | "-";
  typeAnnotation?: TypeNode;
}

export interface TSParenthesizedType extends BaseNode {
  type: "TSParenthesizedType";
  typeAnnotation: TypeNode;
}

export interface TSTupleType extends BaseNode {
  type: "TSTupleType";
  elementTypes: Array<
    TypeNode | TSNamedTupleMember | TSOptionalType | TSRestType
  >;
}

export interface TSNamedTupleMember extends BaseNode {
  type: "TSNamedTupleMember";
  label: Identifier;
  optional: boolean;
  elementType: TypeNode;
}

export interface TSOptionalType extends BaseNode {
  type: "TSOptionalType";
  typeAnnotation: TypeNode;
}

export interface TSRestType extends BaseNode {
  type: "TSRestType";
  typeAnnotation: TypeNode | TSNamedTupleMember;
}

export interface TSTypeLiteral extends BaseNode {
  type: "TSTypeLiteral";
  members: TypeElement[];
}

export interface TSTypeOperator extends BaseNode {
  type: "TSTypeOperator";
  operator: "keyof" | "unique" | "readonly";
  typeAnnotation: TypeNode;
}

export interface TSTypeQuery extends BaseNode {
  type: "TSTypeQuery";
  exprName: EntityName | TSImportType;
  typeArguments?: TSTypeParameterInstantiation;
}

export interface TSTypeReference extends BaseNode {
  type: "TSTypeReference";
  typeName: EntityName;
  typeArguments?: TSTypeParameterInstantiation;
}

export interface TSQualifiedName extends BaseNode {
  type: "TSQualifiedName";
  left: EntityName;
  right: Identifier;
}

export interface TSTypeParameterDeclaration extends BaseNode {
  type: "TSTypeParameterDeclaration";
  params: TSTypeParameter[];
  /** With a trailing comma, its offset. */
  extra?: { trailingComma: number };
}

export interface TSTypeParameter extends BaseNode {
  type: "TSTypeParameter";
  name: string;
  constraint?: TypeNode;
  default?: TypeNode;
  const?: true;
  in?: true;
  out?: true;
}

export interface TSTypeParameterInstantiation extends BaseNode {
  type: "TSTypeParameterInstantiation";
  params: TypeNode[];
}

export interface TSPropertySignature extends BaseNode {
  type: "TSPropertySignature";
  key: Expression;
  computed?: boolean;
  optional?: boolean;
  readonly?: boolean;
  typeAnnotation?: TSTypeAnnotation;
}

export interface TSMethodSignature extends BaseNode {
  type: "TSMethodSignature";
  key: Expression;
  computed?: boolean;
  optional?: boolean;
  kind: "method" | "get" | "set";
  typeParameters?: TSTypeParameterDeclaration;
  parameters: SignatureParameter[];
  /** The return type. */
  typeAnnotation?: TSTypeAnnotation;
}

/** In an interface, a type literal, or a class body (with the class member modifiers). */
export interface TSIndexSignature extends BaseNode, TSClassMemberFields {
  type: "TSIndexSignature";
  parameters: Identifier[];
  typeAnnotation?: TSTypeAnnotation;
  static?: boolean;
}

export interface TSCallSignatureDeclaration extends BaseNode {
  type: "TSCallSignatureDeclaration";
  typeParameters?: TSTypeParameterDeclaration;
  parameters: SignatureParameter[];
  typeAnnotation?: TSTypeAnnotation;
}

export interface TSConstructSignatureDeclaration extends BaseNode {
  type: "TSConstructSignatureDeclaration";
  typeParameters?: TSTypeParameterDeclaration;
  parameters: SignatureParameter[];
  typeAnnotation?: TSTypeAnnotation;
}

export interface TSInterfaceDeclaration extends BaseNode {
  type: "TSInterfaceDeclaration";
  id: Identifier;
  typeParameters?: TSTypeParameterDeclaration;
  extends?: TSExpressionWithTypeArguments[];
  body: TSInterfaceBody;
  declare?: boolean;
}

export interface TSInterfaceBody extends BaseNode {
  type: "TSInterfaceBody";
  body: TypeElement[];
}

/** An interface's `extends` or a class's `implements` entry. */
export interface TSExpressionWithTypeArguments extends BaseNode {
  type: "TSExpressionWithTypeArguments";
  expression: EntityName;
  /** The type arguments, named `typeParameters` as in acorn-typescript. */
  typeParameters?: TSTypeParameterInstantiation;
}

export interface TSTypeAliasDeclaration extends BaseNode {
  type: "TSTypeAliasDeclaration";
  id: Identifier;
  typeParameters?: TSTypeParameterDeclaration;
  typeAnnotation: TypeNode;
  declare?: boolean;
}

export interface TSEnumDeclaration extends BaseNode {
  type: "TSEnumDeclaration";
  id: Identifier;
  members: TSEnumMember[];
  const?: boolean;
  declare?: boolean;
}

export interface TSEnumMember extends BaseNode {
  type: "TSEnumMember";
  id: Identifier | StringLiteral;
  initializer?: Expression;
}

/** `namespace A {}`, `module "a" {}`, `declare global {}`; `namespace A.B {}` nests through `body`. */
export interface TSModuleDeclaration extends BaseNode {
  type: "TSModuleDeclaration";
  id: Identifier | StringLiteral;
  /** Absent for `declare module "a";`. */
  body?: TSModuleBlock | TSModuleDeclaration;
  declare?: boolean;
  global?: boolean;
}

export interface TSModuleBlock extends BaseNode {
  type: "TSModuleBlock";
  body: Array<Statement | ModuleDeclaration>;
}

/** A function declaration without a body: an overload or `declare function`. */
export interface TSDeclareFunction extends BaseNode, TSFunctionFields {
  type: "TSDeclareFunction";
  /** `null` in `export default function (): void;`. */
  id: Identifier | null;
  params: Pattern[];
  expression: boolean;
  generator: boolean;
  async: boolean;
  declare?: boolean;
}

/** A `MethodDefinition`'s value when the method has no body: an overload or an abstract method. */
export interface TSDeclareMethod extends BaseNode, TSFunctionFields {
  type: "TSDeclareMethod";
  id: null;
  params: Array<Pattern | TSParameterProperty>;
  expression: boolean;
  generator: boolean;
  async: boolean;
}

/** `constructor(private a: T)`: a constructor parameter with a modifier. */
export interface TSParameterProperty extends BaseNode {
  type: "TSParameterProperty";
  accessibility?: Accessibility;
  readonly?: boolean;
  override?: boolean;
  parameter: Identifier | AssignmentPattern;
}

/** `import a = require("a")`, `import a = B.C`, `export import a = B.C`. */
export interface TSImportEqualsDeclaration extends BaseNode {
  type: "TSImportEqualsDeclaration";
  importKind: "type" | "value";
  isExport: boolean;
  id: Identifier;
  moduleReference: EntityName | TSExternalModuleReference;
}

export interface TSExternalModuleReference extends BaseNode {
  type: "TSExternalModuleReference";
  expression: StringLiteral;
}

/** `export = a`. */
export interface TSExportAssignment extends BaseNode {
  type: "TSExportAssignment";
  expression: Expression;
}

/** `export as namespace A`. */
export interface TSNamespaceExportDeclaration extends BaseNode {
  type: "TSNamespaceExportDeclaration";
  id: Identifier;
}

export interface TSAsExpression extends BaseNode {
  type: "TSAsExpression";
  expression: Expression;
  typeAnnotation: TypeNode;
}

export interface TSSatisfiesExpression extends BaseNode {
  type: "TSSatisfiesExpression";
  expression: Expression;
  typeAnnotation: TypeNode;
}

/** `<T>a`. */
export interface TSTypeAssertion extends BaseNode {
  type: "TSTypeAssertion";
  typeAnnotation: TypeNode;
  expression: Expression;
}

export interface TSNonNullExpression extends BaseNode {
  type: "TSNonNullExpression";
  expression: Expression;
}

/** `f<T>` without a call. */
export interface TSInstantiationExpression extends BaseNode {
  type: "TSInstantiationExpression";
  expression: Expression;
  typeArguments: TSTypeParameterInstantiation;
}
