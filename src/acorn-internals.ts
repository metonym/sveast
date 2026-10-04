import type { Options, Position, SourceLocation } from "acorn";
import { Parser } from "acorn";

declare module "acorn" {
  function isIdentifierStart(code: number, astral?: boolean): boolean;
  function isIdentifierChar(code: number, astral?: boolean): boolean;
}

declare global {
  interface SyntaxError {
    tsFatal?: boolean;
  }
}

export interface TokenType {
  label: string;
  keyword: string;
  beforeExpr: boolean;
  startsExpr: boolean;
  isLoop: boolean;
  isAssign: boolean;
  prefix: boolean;
  postfix: boolean;
  binop: number | null;
}

interface BinaryTokenType extends TokenType {
  binop: number;
}

interface TokenTypes {
  arrow: TokenType;
  backQuote: TokenType;
  bitShift: TokenType;
  bitwiseAND: TokenType;
  bitwiseOR: TokenType;
  braceL: TokenType;
  braceR: TokenType;
  bracketL: TokenType;
  bracketR: TokenType;
  colon: TokenType;
  comma: TokenType;
  dollarBraceL: TokenType;
  dot: TokenType;
  ellipsis: TokenType;
  eof: TokenType;
  eq: TokenType;
  name: TokenType;
  num: TokenType;
  parenL: TokenType;
  parenR: TokenType;
  plusMin: TokenType;
  prefix: TokenType;
  question: TokenType;
  questionDot: TokenType;
  relational: TokenType;
  semi: TokenType;
  star: TokenType;
  string: TokenType;
  _class: TokenType;
  _const: TokenType;
  _default: TokenType;
  _export: TokenType;
  _extends: TokenType;
  _false: TokenType;
  _import: TokenType;
  _in: BinaryTokenType;
  _new: TokenType;
  _null: TokenType;
  _this: TokenType;
  _true: TokenType;
  _typeof: TokenType;
  _void: TokenType;
  _with: TokenType;
}

interface TokContext {
  token: string;
  isExpr: boolean;
  preserveSpace: boolean;
  override: ((parser: ParserInternals) => void) | null;
  generator: boolean;
}

export interface Scope {
  flags: number;
  var: string[];
  lexical: string[];
  functions: string[];
  tsTypes?: string[];
  tsExportOnly?: string[];
  tsEnums?: string[];
}

interface Label {
  kind: string | null;
  name?: string;
  statementStart?: number;
}

interface PrivateNameScope {
  declared: Record<string, string>;
  used: Node[];
}

export interface DestructuringErrors {
  shorthandAssign: number;
  trailingComma: number;
  parenthesizedAssign: number;
  parenthesizedBind: number;
  doubleProto: number;
}

export type ForInit = boolean | "await" | undefined;
export type ExportedNames = Record<string, boolean>;
export type ClassStatement = boolean | "nullableID";

type NodeValue =
  | Node
  | Node[]
  | SourceLocation
  | { trailingComma: number }
  | string
  | number
  | boolean
  | null
  | undefined;

export interface Node {
  [key: string]: NodeValue;
  type: string;
  start: number;
  end: number;
  loc: SourceLocation;
  name: string;
  id: Node;
  key: Node;
  local: Node;
  expression: Node;
  callee: Node;
  declaration: Node | null;
  parameter: Node;
  typeArguments: Node;
  body: Node | Node[];
  params: Node[];
  specifiers: Node[];
  arguments: Node[];
}

/** What acorn tests keywords and reserved words with: a `RegExp`, or anything with its `test`. */
export interface WordTester {
  test(word: string): boolean;
}

/** `Options`, plus where in the source a parse starts, which acorn's published type omits. */
export interface ParserOptions extends Options {
  startLocation?: { line: number; column: number };
}

export interface ParserInternals {
  input: string;
  options: ParserOptions;
  keywords: WordTester;
  reservedWords: WordTester;
  reservedWordsStrict: WordTester;
  reservedWordsStrictBind: WordTester;
  pos: number;
  type: TokenType;
  value: string;
  start: number;
  end: number;
  startLoc: Position;
  endLoc: Position;
  lastTokStart: number;
  lastTokEnd: number;
  lastTokStartLoc: Position;
  lastTokEndLoc: Position;
  curLine: number;
  lineStart: number;
  context: TokContext[];
  exprAllowed: boolean;
  containsEsc: boolean;
  strict: boolean;
  inModule: boolean;
  treatFunctionsAsVar: boolean;
  scopeStack: Scope[];
  privateNameStack: PrivateNameScope[];
  labels: Label[];
  undefinedExports: Record<string, Node>;
  yieldPos: number;
  awaitPos: number;
  awaitIdentPos: number;
  potentialArrowAt: number;
  potentialArrowInForAwait: boolean;
  regexpState: unknown;
  inTemplateElement?: boolean;

  /**
   * Points the parser at `input` from `pos`, in the state a new parser with
   * the same options would start in, so one parser can be reused. sveast's
   * plugins add it; acorn's `Parser` has none.
   */
  reset?(
    input: string,
    pos: number,
    startLocation: ParserOptions["startLocation"],
  ): void;
  parse(): Node;
  curPosition(): Position;
  initialContext(): TokContext[];
  skipSpace(): void;
  readWord(): void;
  readWord1(): string;
  parseParenAndDistinguishExpression(
    canBeArrow: boolean,
    forInit: ForInit,
  ): Node;
  getTokenFromCode(code: number): void;
  readToken_lt_gt(code: number): void;
  finishToken(type: TokenType, value?: string): void;
  finishOp(type: TokenType, size: number): void;
  nextToken(): void;
  next(ignoreEscapeSequenceInKeyword?: boolean): void;
  eat(type: TokenType): boolean;
  expect(type: TokenType): void;
  isContextual(name: string): boolean;
  eatContextual(name: string): boolean;
  expectContextual(name: string): void;
  canInsertSemicolon(): boolean;
  semicolon(): void;
  afterTrailingComma(type: TokenType, notNext?: boolean): boolean;
  unexpected(pos?: number): never;
  raise(pos: number, message: string): never;
  raiseRecoverable(pos: number, message: string): void;

  startNode(): Node;
  startNodeAt(pos: number, loc?: Position): Node;
  finishNode(node: Node, type: string): Node;
  finishNodeAt(node: Node, type: string, pos: number, loc?: Position): Node;

  treatFunctionsAsVarInScope(scope: Scope): boolean;
  currentScope(): Scope;
  enterScope(flags: number): void;
  exitScope(): void;
  declareName(name: string, bindingType: number, pos: number): void;
  checkLValSimple(
    expr: Node,
    bindingType?: number,
    checkClashes?: ExportedNames,
  ): void;
  checkLValPattern(
    expr: Node,
    bindingType?: number,
    checkClashes?: ExportedNames,
  ): void;
  checkLValInnerPattern(
    expr: Node,
    bindingType?: number,
    checkClashes?: ExportedNames,
  ): void;
  checkUnreserved(ref: Node): void;
  checkLocalExport(id: Node): void;
  checkExport(
    exports: ExportedNames | undefined,
    name: string,
    pos: number,
  ): void;
  checkExpressionErrors(
    refDestructuringErrors: DestructuringErrors | null | undefined,
    andThrow?: boolean,
  ): boolean;
  toAssignable(
    node: Node,
    isBinding: boolean,
    refDestructuringErrors?: DestructuringErrors | null,
  ): Node;

  parseStatement(
    context: string | null,
    topLevel?: boolean,
    exports?: ExportedNames,
  ): Node;
  parseVarStatement(
    node: Node,
    kind: string,
    allowMissingInitializer?: boolean,
  ): Node;
  parseVarId(decl: Node, kind: string): void;
  parseFunction(
    node: Node,
    statement: number,
    allowExpressionBody?: boolean,
    isAsync?: boolean,
    forInit?: ForInit,
  ): Node;
  parseFunctionParams(node: Node): void;
  parseFunctionBody(
    node: Node,
    isArrowFunction: boolean,
    isMethod: boolean,
    forInit?: ForInit,
  ): void;
  parseMethod(
    isGenerator: boolean,
    isAsync: boolean,
    allowDirectSuper: boolean,
  ): Node;
  parseCatchClauseParam(): Node;
  parseImport(node: Node): Node;
  parseImportSpecifiers(): Node[];
  parseImportSpecifier(): Node;
  parseWithClause(): Node[] | undefined;
  parseExport(node: Node, exports?: ExportedNames): Node;
  parseExportSpecifiers(exports?: ExportedNames): Node[];
  parseExportSpecifier(exports?: ExportedNames): Node;
  parseExportAllDeclaration(node: Node, exports?: ExportedNames): Node;
  parseExportDefaultDeclaration(): Node;
  shouldParseExportStatement(): boolean;
  parseDynamicImport(node: Node): Node;

  parseClassId(node: Node, isStatement: ClassStatement): void;
  parseClassSuper(node: Node): void;
  parseClass(node: Node, isStatement: ClassStatement): Node;
  parseClassElement(constructorAllowsSuper: boolean): Node | null;
  parseClassElementName(element: Node): void;
  parseClassMethod(
    method: Node,
    isGenerator: boolean,
    isAsync: boolean,
    allowsDirectSuper: boolean,
  ): Node;
  parseClassField(field: Node): Node;
  parseClassStaticBlock(node: Node): Node;
  isClassElementNameStart(): boolean;

  parseIdent(liberal?: boolean): Node;
  parseBindingAtom(): Node;
  parseBindingList(
    close: TokenType,
    allowEmpty: boolean,
    allowTrailingComma: boolean,
    allowModifiers?: boolean,
  ): Node[];
  parseAssignableListItem(allowModifiers: boolean): Node;
  parseBindingListItem(param: Node): Node;
  parseMaybeDefault(
    startPos: number,
    startLoc: Position | undefined,
    left?: Node,
  ): Node;

  parseExpression(
    forInit?: ForInit,
    refDestructuringErrors?: DestructuringErrors | null,
  ): Node;
  parseMaybeAssign(
    forInit?: ForInit,
    refDestructuringErrors?: DestructuringErrors | null,
    afterLeftParse?: (node: Node, startPos: number, startLoc: Position) => Node,
  ): Node;
  parseMaybeConditional(
    forInit: ForInit,
    refDestructuringErrors?: DestructuringErrors | null,
  ): Node;
  parseExprOps(
    forInit: ForInit,
    refDestructuringErrors?: DestructuringErrors | null,
  ): Node;
  parseExprOp(
    left: Node,
    leftStartPos: number,
    leftStartLoc: Position,
    minPrec: number,
    forInit: ForInit,
  ): Node;
  parseMaybeUnary(
    refDestructuringErrors: DestructuringErrors | null | undefined,
    sawUnary: boolean,
    incDec: boolean,
    forInit: ForInit,
  ): Node;
  parseSubscript(
    base: Node,
    startPos: number,
    startLoc: Position,
    noCalls: boolean,
    maybeAsyncArrow: boolean,
    optionalChained: boolean,
    forInit: ForInit,
  ): Node;
  parseExprAtom(
    refDestructuringErrors?: DestructuringErrors | null,
    forInit?: ForInit,
    forNew?: boolean,
  ): Node;
  parseNew(): Node;
  parseParenItem(item: Node): Node;
  shouldParseArrow(exprList: Node[]): boolean;
  shouldParseAsyncArrow(): boolean;
  parseArrowExpression(
    node: Node,
    params: Node[],
    isAsync: boolean,
    forInit: ForInit,
  ): Node;
  parseExprList(
    close: TokenType,
    allowTrailingComma: boolean,
    allowEmpty: boolean,
    refDestructuringErrors?: DestructuringErrors | null,
  ): Node[];
  parseSpread(refDestructuringErrors?: DestructuringErrors | null): Node;
  parseTemplate(options: { isTagged: boolean }): Node;
  parseTemplateElement(options: { isTagged: boolean }): Node;

  parseProperty(
    isPattern: boolean,
    refDestructuringErrors?: DestructuringErrors | null,
  ): Node;
  parsePropertyName(prop: Node): Node;
  parseGetterSetter(prop: Node): void;
  parsePropertyValue(
    prop: Node,
    isPattern: boolean,
    isGenerator: boolean,
    isAsync: boolean,
    startPos: number,
    startLoc: Position,
    refDestructuringErrors: DestructuringErrors | null | undefined,
    containsEsc: boolean,
  ): void;
}

export interface ParserConstructor {
  new (
    options: ParserOptions,
    input: string,
    startPos?: number,
  ): ParserInternals;
  readonly acorn: {
    tokTypes: TokenTypes;
    keywordTypes: Record<string, TokenType>;
    TokenType: new (label: string) => TokenType;
    isIdentifierStart(code: number, astral?: boolean): boolean;
    isIdentifierChar(code: number, astral?: boolean): boolean;
  };
}

type Plugin = (BaseParser: typeof Parser) => typeof Parser;

/**
 * acorn's published types hide the parser's internals and its constructor,
 * so `Parser.extend` can't take a plugin written against them. These two
 * functions are where the types are widened to what the runtime has.
 */
export function definePlugin(
  plugin: (Base: ParserConstructor) => ParserConstructor,
): Plugin {
  return (BaseParser) =>
    plugin(
      BaseParser as unknown as ParserConstructor,
    ) as unknown as typeof Parser;
}

export function extendParser(...plugins: Plugin[]): ParserConstructor {
  return Parser.extend(...plugins) as unknown as ParserConstructor;
}
