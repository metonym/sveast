import type { Position } from "acorn";
import {
  type ClassStatement,
  type DestructuringErrors,
  definePlugin,
  type ExportedNames,
  type ForInit,
  type Node,
  type ParserOptions,
  type Scope,
  type TokenType,
} from "./acorn-internals";
import { hasName } from "./scope-names";

const SKIP_WHITESPACE = /(?:\s|\/\/.*|\/\*[\s\S]*?\*\/)*/g;

const KEYWORD_TYPES = new Map([
  ["any", "TSAnyKeyword"],
  ["bigint", "TSBigIntKeyword"],
  ["boolean", "TSBooleanKeyword"],
  ["never", "TSNeverKeyword"],
  ["null", "TSNullKeyword"],
  ["number", "TSNumberKeyword"],
  ["object", "TSObjectKeyword"],
  ["string", "TSStringKeyword"],
  ["symbol", "TSSymbolKeyword"],
  ["undefined", "TSUndefinedKeyword"],
  ["unknown", "TSUnknownKeyword"],
  ["void", "TSVoidKeyword"],
]);

const CLASS_MODIFIERS = new Set(
  "public private protected readonly declare abstract override static accessor".split(
    " ",
  ),
);
const PARAMETER_MODIFIERS = new Set(
  "public private protected readonly override".split(" "),
);
const DECLARE_TARGETS = new Set(
  "var let const function class abstract enum interface type namespace module global".split(
    " ",
  ),
);
const DECLARE_FIRST = new Set(
  "var let const function class interface enum".split(" "),
);

const TS_EXPRESSION_WRAPPERS = new Set([
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "TSTypeAssertion",
]);

const SCOPE_TOP = 1;
const SCOPE_SIMPLE_CATCH = 32;
const SCOPE_CLASS_STATIC_BLOCK = 256;
const BIND_NONE = 0;
const BIND_VAR = 1;
const BIND_LEXICAL = 2;
const BIND_FUNCTION = 3;
const BIND_SIMPLE_CATCH = 4;
const BIND_TS_TYPE = 6;
const BIND_TS_INTERFACE = 7;
const BIND_FLAGS_TS_ENUM = 256;
const BIND_FLAGS_TS_EXPORT_ONLY = 1024;
const BIND_TS_NAMESPACE = 8 | BIND_FLAGS_TS_EXPORT_ONLY;
const BIND_TS_ENUM = BIND_LEXICAL | BIND_FLAGS_TS_ENUM;
const FUNC_STATEMENT = 1;
const FUNC_HANGING_STATEMENT = 2;

const CHAR_PAREN_L = 40;
const CHAR_PAREN_R = 41;
const CHAR_COMMA = 44;
const CHAR_DOT = 46;
const CHAR_COLON = 58;
const CHAR_EQ = 61;
const CHAR_LT = 60;
const CHAR_BRACE_L = 123;
const CHAR_BRACKET_L = 91;
const CHAR_STAR = 42;
const CHAR_HASH = 35;
const CHAR_DQUOTE = 34;
const CHAR_SQUOTE = 39;

const SPECULATION_FAILED = new SyntaxError("speculative parse failed");

export const tsPlugin = definePlugin((Base) => {
  const {
    tokTypes: tt,
    keywordTypes,
    isIdentifierChar,
    isIdentifierStart,
  } = Base.acorn;
  const atType = new Base.acorn.TokenType("@");

  class TSParser extends Base {
    inType = false;
    tsNoConditional = false;
    tsAmbient = false;
    tsArrowReturn: Node | null = null;
    tsMethodTypeParams: Node | null = null;
    tsConstructorParams = false;
    tsAsyncArguments = false;
    tsDeferredFunction: Node | null = null;
    tsDecoratorStack: Node[][] = [[]];
    tsSpeculating = 0;
    tsCommentEnd = 0;
    tsBodilessAt = -1;

    constructor(options: ParserOptions, input: string, startPos?: number) {
      super(options, input, startPos);
      const onComment = this.options.onComment;
      if (typeof onComment === "function") {
        this.options.onComment = (
          block: boolean,
          text: string,
          start: number,
          end: number,
          startLoc?: Position,
          endLoc?: Position,
        ) => {
          if (start < this.tsCommentEnd) return;
          this.tsCommentEnd = end;
          onComment.call(this, block, text, start, end, startLoc, endLoc);
        };
      }
    }

    // the fields above as a new parser has them; acorn-bridge's tweaks reset acorn's
    reset() {
      this.inType = false;
      this.tsNoConditional = false;
      this.tsAmbient = false;
      this.tsArrowReturn = null;
      this.tsMethodTypeParams = null;
      this.tsConstructorParams = false;
      this.tsAsyncArguments = false;
      this.tsDeferredFunction = null;
      this.tsDecoratorStack = [[]];
      this.tsSpeculating = 0;
      this.tsCommentEnd = 0;
      this.tsBodilessAt = -1;
    }

    getTokenFromCode(code: number) {
      if (code === 64) {
        ++this.pos;
        return this.finishToken(atType);
      }
      return super.getTokenFromCode(code);
    }

    readToken_lt_gt(code: number) {
      if (this.inType) return this.finishOp(tt.relational, 1);
      return super.readToken_lt_gt(code);
    }

    tsInType<T>(fn: () => T): T {
      const old = this.inType;
      this.inType = true;
      const result = fn();
      this.inType = old;
      if (!old && this.type === tt.relational) {
        this.pos = this.start;
        this.nextToken();
      }
      return result;
    }

    tsIsLt() {
      return this.type === tt.relational && this.value === "<";
    }

    tsSplitLt() {
      if (this.type === tt.bitShift && this.value === "<<") {
        this.pos = this.start + 1;
        this.finishToken(tt.relational, "<");
      }
      return this.tsIsLt();
    }

    tsIsGt() {
      return this.type === tt.relational && this.value === ">";
    }

    tsIsBang() {
      return this.type === tt.prefix && this.value === "!";
    }

    hasPrecedingLineBreak() {
      return this.tsHasLineBreak(this.lastTokEnd, this.start);
    }

    tsHasLineBreak(from: number, to: number) {
      for (let i = from; i < to; i++) {
        const code = this.input.charCodeAt(i);
        if (code === 10 || code === 13 || code === 0x2028 || code === 0x2029)
          return true;
      }
      return false;
    }

    tsPeekPos(from: number = this.pos) {
      SKIP_WHITESPACE.lastIndex = from;
      SKIP_WHITESPACE.exec(this.input);
      return SKIP_WHITESPACE.lastIndex;
    }

    tsPeekChar() {
      return this.input.charCodeAt(this.tsPeekPos());
    }

    tsPeekWord() {
      const start = this.tsPeekPos();
      let end = start;
      while (
        end < this.input.length &&
        isIdentifierChar(this.input.charCodeAt(end))
      )
        end++;
      return this.input.slice(start, end);
    }

    tsPeekSameLine() {
      return !this.tsHasLineBreak(this.pos, this.tsPeekPos());
    }

    tsNextIsIdentifierOnSameLine() {
      return (
        this.tsPeekSameLine() &&
        isIdentifierStart(this.tsPeekChar()) &&
        !Object.hasOwn(keywordTypes, this.tsPeekWord())
      );
    }

    tsSnapshot() {
      return {
        pos: this.pos,
        type: this.type,
        value: this.value,
        start: this.start,
        end: this.end,
        startLoc: this.startLoc,
        endLoc: this.endLoc,
        lastTokStart: this.lastTokStart,
        lastTokEnd: this.lastTokEnd,
        lastTokStartLoc: this.lastTokStartLoc,
        lastTokEndLoc: this.lastTokEndLoc,
        curLine: this.curLine,
        lineStart: this.lineStart,
        context: this.context.slice(),
        exprAllowed: this.exprAllowed,
        containsEsc: this.containsEsc,
        inType: this.inType,
        tsNoConditional: this.tsNoConditional,
        tsAmbient: this.tsAmbient,
        tsArrowReturn: this.tsArrowReturn,
        scopes: this.scopeStack.length,
        privateNames: this.privateNameStack.length,
        labels: this.labels,
        labelCount: this.labels.length,
        strict: this.strict,
        yieldPos: this.yieldPos,
        awaitPos: this.awaitPos,
        awaitIdentPos: this.awaitIdentPos,
        potentialArrowAt: this.potentialArrowAt,
        potentialArrowInForAwait: this.potentialArrowInForAwait,
      };
    }

    tsRestore(state: ReturnType<TSParser["tsSnapshot"]>) {
      this.pos = state.pos;
      this.type = state.type;
      this.value = state.value;
      this.start = state.start;
      this.end = state.end;
      this.startLoc = state.startLoc;
      this.endLoc = state.endLoc;
      this.lastTokStart = state.lastTokStart;
      this.lastTokEnd = state.lastTokEnd;
      this.lastTokStartLoc = state.lastTokStartLoc;
      this.lastTokEndLoc = state.lastTokEndLoc;
      this.curLine = state.curLine;
      this.lineStart = state.lineStart;
      this.context = state.context;
      this.exprAllowed = state.exprAllowed;
      this.containsEsc = state.containsEsc;
      this.inType = state.inType;
      this.tsNoConditional = state.tsNoConditional;
      this.tsAmbient = state.tsAmbient;
      this.tsArrowReturn = state.tsArrowReturn;
      this.scopeStack.length = state.scopes;
      this.privateNameStack.length = state.privateNames;
      this.labels = state.labels;
      this.labels.length = state.labelCount;
      this.strict = state.strict;
      this.yieldPos = state.yieldPos;
      this.awaitPos = state.awaitPos;
      this.awaitIdentPos = state.awaitIdentPos;
      this.potentialArrowAt = state.potentialArrowAt;
      this.potentialArrowInForAwait = state.potentialArrowInForAwait;
    }

    raise(pos: number, message: string) {
      if (this.tsSpeculating > 0) throw SPECULATION_FAILED;
      return super.raise(pos, message);
    }

    tsRaiseFatal(pos: number, message: string): never {
      try {
        super.raise(pos, message);
      } catch (error) {
        if (error instanceof SyntaxError) error.tsFatal = true;
        throw error;
      }
      throw new Error("unreachable");
    }

    tsTry<T>(fn: () => T | undefined, lookahead = false): T | undefined {
      const state = this.tsSnapshot();
      this.tsSpeculating++;
      try {
        const result = fn();
        if (lookahead || result === undefined) this.tsRestore(state);
        return result;
      } catch (error) {
        if (!(error instanceof SyntaxError) || (!lookahead && error.tsFatal))
          throw error;
        this.tsRestore(state);
        return undefined;
      } finally {
        this.tsSpeculating--;
      }
    }

    tsLookahead(fn: () => boolean): boolean {
      return this.tsTry(fn, true) === true;
    }

    tsResetEnd(node: Node) {
      node.end = this.lastTokEnd;
      if (this.options.locations) node.loc.end = this.lastTokEndLoc;
    }

    tsResetStart(node: Node, from: Node) {
      node.start = from.start;
      if (this.options.locations) node.loc.start = from.loc.start;
    }

    tsParseTypeAnnotation(returnType = false) {
      const node = this.startNode();
      node.typeAnnotation = this.tsInType(() => {
        this.next();
        return returnType ? this.tsParseTypeOrPredicate() : this.tsParseType();
      });
      return this.finishNode(node, "TSTypeAnnotation");
    }

    tsParseBindingSuffix(node: Node, optional: boolean) {
      if (optional && this.eat(tt.question)) {
        node.optional = true;
        this.tsResetEnd(node);
      }
      if (this.type === tt.colon) {
        node.typeAnnotation = this.tsParseTypeAnnotation();
        this.tsResetEnd(node);
      }
      return node;
    }

    tsParseTypeOrPredicate() {
      if (this.type !== tt.name && this.type !== tt._this)
        return this.tsParseType();

      if (
        this.isContextual("asserts") &&
        this.tsPeekSameLine() &&
        isIdentifierStart(this.tsPeekChar())
      ) {
        const node = this.startNode();
        this.next();
        node.parameterName =
          this.type === tt._this ? this.tsParseThisType() : this.parseIdent();
        if (this.isContextual("is") && !this.hasPrecedingLineBreak())
          return this.tsParsePredicateType(node, true);
        node.asserts = true;
        node.typeAnnotation = null;
        return this.finishNode(node, "TSTypePredicate");
      }

      if (this.tsPeekWord() === "is" && this.tsPeekSameLine()) {
        const node = this.startNode();
        node.parameterName =
          this.type === tt._this
            ? this.tsParseThisType()
            : this.parseIdent(true);
        return this.tsParsePredicateType(node, false);
      }

      return this.tsParseType();
    }

    tsParsePredicateType(node: Node, asserts: boolean) {
      this.next();
      const annotation = this.startNode();
      annotation.typeAnnotation = this.tsParseType();
      node.typeAnnotation = this.finishNode(annotation, "TSTypeAnnotation");
      node.asserts = asserts;
      return this.finishNode(node, "TSTypePredicate");
    }

    tsParseThisType() {
      const node = this.startNode();
      this.next();
      return this.finishNode(node, "TSThisType");
    }

    parseWholeType(): Node {
      this.inType = true;
      this.nextToken();
      const type = this.tsParseType();
      if (this.type !== tt.eof) this.unexpected();
      return type;
    }

    tsParseType(): Node {
      const type = this.tsParseNonConditionalType();
      if (
        this.tsNoConditional ||
        this.type !== tt._extends ||
        this.hasPrecedingLineBreak()
      )
        return type;
      const node = this.startNodeAt(type.start, type.loc?.start);
      this.next();
      node.checkType = type;
      node.extendsType = this.tsWithConditional(true, () =>
        this.tsParseNonConditionalType(),
      );
      this.expect(tt.question);
      node.trueType = this.tsWithConditional(false, () => this.tsParseType());
      this.expect(tt.colon);
      node.falseType = this.tsWithConditional(false, () => this.tsParseType());
      return this.finishNode(node, "TSConditionalType");
    }

    tsWithConditional<T>(disallow: boolean, fn: () => T): T {
      const old = this.tsNoConditional;
      this.tsNoConditional = disallow;
      const result = fn();
      this.tsNoConditional = old;
      return result;
    }

    tsParseNonConditionalType(): Node {
      if (this.tsIsStartOfFunctionType())
        return this.tsParseFunctionType("TSFunctionType");
      if (
        this.type === tt._new ||
        (this.isContextual("abstract") && this.tsPeekWord() === "new")
      )
        return this.tsParseFunctionType("TSConstructorType");
      return this.tsParseUnionOrIntersection("TSUnionType", tt.bitwiseOR, () =>
        this.tsParseUnionOrIntersection(
          "TSIntersectionType",
          tt.bitwiseAND,
          () => this.tsParseTypeOperatorOrHigher(),
        ),
      );
    }

    tsParseFunctionType(type: string) {
      const node = this.startNode();
      if (type === "TSConstructorType") {
        node.abstract = this.isContextual("abstract");
        if (node.abstract) this.next();
        this.next();
      }
      this.tsWithConditional(false, () => this.tsFillSignature(node, tt.arrow));
      return this.finishNode(node, type);
    }

    tsFillSignature(node: Node, returnToken: TokenType) {
      if (this.tsIsLt()) node.typeParameters = this.tsParseTypeParameters();
      this.expect(tt.parenL);
      node.parameters = this.parseBindingList(tt.parenR, false, true);
      if (this.type === returnToken)
        node.typeAnnotation = this.tsParseTypeAnnotation(true);
      else if (returnToken === tt.arrow) this.unexpected();
    }

    tsIsStartOfFunctionType() {
      if (this.tsIsLt()) return true;
      if (this.type !== tt.parenL) return false;
      return this.tsLookahead(() => {
        this.next();
        if (this.type === tt.parenR || this.type === tt.ellipsis) return true;
        if (this.type === tt.name || this.type === tt._this) this.next();
        else if (this.type === tt.braceL || this.type === tt.bracketL)
          this.parseBindingAtom();
        else return false;
        const type = this.type;
        if (
          type === tt.colon ||
          type === tt.comma ||
          type === tt.question ||
          type === tt.eq
        )
          return true;
        if (type !== tt.parenR) return false;
        this.next();
        return this.type === tt.arrow;
      });
    }

    tsParseUnionOrIntersection(
      type: string,
      operator: TokenType,
      parseConstituent: () => Node,
    ) {
      const node = this.startNode();
      const hasLeadingOperator = this.eat(operator);
      const types: Node[] = [];
      do types.push(parseConstituent());
      while (this.eat(operator));
      if (types.length === 1 && !hasLeadingOperator) return types[0];
      node.types = types;
      return this.finishNode(node, type);
    }

    tsParseTypeOperatorOrHigher(): Node {
      if (this.type === tt.name && !this.containsEsc) {
        const value = this.value;
        if (value === "keyof" || value === "unique" || value === "readonly") {
          const node = this.startNode();
          this.next();
          node.operator = value;
          node.typeAnnotation = this.tsParseTypeOperatorOrHigher();
          return this.finishNode(node, "TSTypeOperator");
        }
        if (value === "infer") {
          const node = this.startNode();
          this.next();
          const parameter = this.startNode();
          parameter.name = this.tsParseTypeParameterName();
          const constraint = this.tsTry(() => this.tsParseInferConstraint());
          if (constraint) parameter.constraint = constraint;
          node.typeParameter = this.finishNode(parameter, "TSTypeParameter");
          return this.finishNode(node, "TSInferType");
        }
      }
      return this.tsWithConditional(false, () =>
        this.tsParseArrayTypeOrHigher(),
      );
    }

    tsParseInferConstraint() {
      if (!this.eat(tt._extends)) return;
      const constraint = this.tsWithConditional(true, () => this.tsParseType());
      if (this.tsNoConditional || this.type !== tt.question) return constraint;
      return;
    }

    tsParseTypeParameterName() {
      if (this.type !== tt.name && !this.type.keyword) this.unexpected();
      const name = this.type === tt.name ? this.value : this.type.keyword;
      this.next();
      return name;
    }

    tsParseArrayTypeOrHigher() {
      let type = this.tsParseNonArrayType();
      while (!this.hasPrecedingLineBreak() && this.eat(tt.bracketL)) {
        const node = this.startNodeAt(type.start, type.loc?.start);
        if (this.eat(tt.bracketR)) {
          node.elementType = type;
          type = this.finishNode(node, "TSArrayType");
        } else {
          node.objectType = type;
          node.indexType = this.tsParseType();
          this.expect(tt.bracketR);
          type = this.finishNode(node, "TSIndexedAccessType");
        }
      }
      return type;
    }

    tsParseNonArrayType(): Node {
      switch (this.type) {
        case tt.name:
        case tt._void:
        case tt._null: {
          const keyword = KEYWORD_TYPES.get(this.value);
          if (
            keyword &&
            (this.type !== tt.name ||
              (!this.containsEsc && this.tsPeekChar() !== CHAR_DOT))
          ) {
            const node = this.startNode();
            this.next();
            return this.finishNode(node, keyword);
          }
          return this.tsParseTypeReference();
        }
        case tt.string:
        case tt.num:
        case tt._true:
        case tt._false: {
          const node = this.startNode();
          node.literal = this.parseExprAtom();
          return this.finishNode(node, "TSLiteralType");
        }
        case tt.plusMin: {
          if (this.value !== "-") break;
          const node = this.startNode();
          const unary = this.startNode();
          this.next();
          if (this.type !== tt.num) this.unexpected();
          unary.operator = "-";
          unary.prefix = true;
          unary.argument = this.parseExprAtom();
          node.literal = this.finishNode(unary, "UnaryExpression");
          return this.finishNode(node, "TSLiteralType");
        }
        case tt.backQuote:
          return this.tsParseTemplateLiteralType();
        case tt._this: {
          const thisType = this.tsParseThisType();
          if (this.isContextual("is") && !this.hasPrecedingLineBreak()) {
            const node = this.startNodeAt(thisType.start, thisType.loc?.start);
            node.parameterName = thisType;
            return this.tsParsePredicateType(node, false);
          }
          return thisType;
        }
        case tt._typeof:
          return this.tsParseTypeQuery();
        case tt._import:
          return this.tsParseImportType();
        case tt.braceL:
          return this.tsIsStartOfMappedType()
            ? this.tsParseMappedType()
            : this.tsParseTypeLiteral();
        case tt.bracketL:
          return this.tsParseTupleType();
        case tt.parenL: {
          const node = this.startNode();
          this.next();
          node.typeAnnotation = this.tsParseType();
          this.expect(tt.parenR);
          return this.finishNode(node, "TSParenthesizedType");
        }
        default:
          if (this.type.keyword) return this.tsParseTypeReference();
      }
      return this.unexpected();
    }

    tsParseTypeReference() {
      const node = this.startNode();
      node.typeName = this.tsParseEntityName();
      if (!this.hasPrecedingLineBreak() && this.tsIsLt())
        node.typeArguments = this.tsParseTypeArguments();
      return this.finishNode(node, "TSTypeReference");
    }

    tsParseEntityName() {
      let entity = this.parseIdent(true);
      while (this.eat(tt.dot)) {
        const node = this.startNodeAt(entity.start, entity.loc?.start);
        node.left = entity;
        node.right = this.parseIdent(true);
        entity = this.finishNode(node, "TSQualifiedName");
      }
      return entity;
    }

    tsParseTypeQuery() {
      const node = this.startNode();
      this.next();
      node.exprName =
        this.type === tt._import
          ? this.tsParseImportType()
          : this.tsParseEntityName();
      if (!this.hasPrecedingLineBreak() && this.tsIsLt())
        node.typeArguments = this.tsParseTypeArguments();
      return this.finishNode(node, "TSTypeQuery");
    }

    tsParseImportType() {
      const node = this.startNode();
      this.next();
      node.argument = this.tsParseParenthesizedString();
      if (this.eat(tt.dot)) node.qualifier = this.tsParseEntityName();
      if (this.tsIsLt()) node.typeArguments = this.tsParseTypeArguments();
      return this.finishNode(node, "TSImportType");
    }

    tsParseString() {
      if (this.type !== tt.string) this.unexpected();
      return this.parseExprAtom();
    }

    tsParseParenthesizedString() {
      this.expect(tt.parenL);
      const string = this.tsParseString();
      this.expect(tt.parenR);
      return string;
    }

    tsParseTemplateLiteralType() {
      const node = this.startNode();
      const literal = this.startNode();
      this.next();
      literal.expressions = [];
      let element = this.parseTemplateElement({ isTagged: false });
      literal.quasis = [element];
      while (!element.tail) {
        if (this.type === tt.eof)
          this.raise(this.pos, "Unterminated template literal");
        this.expect(tt.dollarBraceL);
        literal.expressions.push(this.tsParseType());
        this.expect(tt.braceR);
        element = this.parseTemplateElement({ isTagged: false });
        literal.quasis.push(element);
      }
      this.next();
      node.literal = this.finishNode(literal, "TemplateLiteral");
      return this.finishNode(node, "TSLiteralType");
    }

    tsIsStartOfMappedType() {
      return this.tsLookahead(() => {
        this.next();
        if (this.type === tt.plusMin) {
          this.next();
          return this.isContextual("readonly");
        }
        if (this.isContextual("readonly")) this.next();
        if (this.type !== tt.bracketL) return false;
        this.next();
        if (this.type !== tt.name) return false;
        this.next();
        return this.type === tt._in;
      });
    }

    tsParseMappedType() {
      const node = this.startNode();
      this.expect(tt.braceL);
      if (this.type === tt.plusMin) {
        node.readonly = this.value;
        this.next();
        this.expectContextual("readonly");
      } else if (this.eatContextual("readonly")) {
        node.readonly = true;
      }
      this.expect(tt.bracketL);
      const parameter = this.startNode();
      parameter.name = this.tsParseTypeParameterName();
      this.expect(tt._in);
      parameter.constraint = this.tsParseType();
      node.typeParameter = this.finishNode(parameter, "TSTypeParameter");
      node.nameType = this.eatContextual("as") ? this.tsParseType() : null;
      this.expect(tt.bracketR);
      if (this.type === tt.plusMin) {
        node.optional = this.value;
        this.next();
        this.expect(tt.question);
      } else if (this.eat(tt.question)) {
        node.optional = true;
      }
      if (this.eat(tt.colon)) node.typeAnnotation = this.tsParseType();
      this.semicolon();
      this.expect(tt.braceR);
      return this.finishNode(node, "TSMappedType");
    }

    tsParseTypeLiteral() {
      const node = this.startNode();
      node.members = this.tsParseObjectTypeMembers();
      return this.finishNode(node, "TSTypeLiteral");
    }

    tsParseObjectTypeMembers() {
      this.expect(tt.braceL);
      const members: Node[] = [];
      while (!this.eat(tt.braceR)) members.push(this.tsParseTypeMember());
      return members;
    }

    tsParseTypeMember() {
      const node = this.startNode();
      let type = "TSPropertySignature";
      const next = this.type === tt._new ? this.tsPeekChar() : -1;
      if (this.type === tt.parenL || this.tsIsLt()) {
        type = "TSCallSignatureDeclaration";
        this.tsFillSignature(node, tt.colon);
      } else if (next === CHAR_PAREN_L || next === CHAR_LT) {
        type = "TSConstructSignatureDeclaration";
        this.next();
        this.tsFillSignature(node, tt.colon);
      } else {
        const newKey = this.type === tt._new ? this.parseIdent(true) : null;
        if (this.isContextual("readonly") && this.tsModifierCanFollow(true)) {
          this.next();
          node.readonly = true;
        }
        if (this.type === tt.bracketL && this.tsIsIndexSignature())
          return this.tsParseIndexSignature(node);

        let kind = "method";
        if (newKey) {
          node.key = newKey;
        } else {
          if (
            (this.isContextual("get") || this.isContextual("set")) &&
            this.tsModifierCanFollow(false)
          ) {
            kind = this.value;
            this.next();
          }
          this.parsePropertyName(node);
        }
        if (this.eat(tt.question)) node.optional = true;

        if (this.type === tt.parenL || this.tsIsLt()) {
          type = "TSMethodSignature";
          if (kind !== "method") node.kind = kind;
          this.tsFillSignature(node, tt.colon);
          node.kind = kind;
        } else if (this.type === tt.colon) {
          node.typeAnnotation = this.tsParseTypeAnnotation();
        }
      }
      this.tsParseTypeMemberSemicolon();
      return this.finishNode(node, type);
    }

    tsParseTypeMemberSemicolon() {
      if (!this.eat(tt.comma)) this.semicolon();
    }

    tsIsIndexSignature() {
      return this.tsLookahead(() => {
        this.next();
        if (this.type !== tt.name) return false;
        this.next();
        return this.type === tt.colon;
      });
    }

    tsParseIndexSignature(node: Node) {
      this.expect(tt.bracketL);
      node.parameters = [this.tsParseBindingSuffix(this.parseIdent(), false)];
      this.expect(tt.bracketR);
      if (this.type === tt.colon)
        node.typeAnnotation = this.tsParseTypeAnnotation();
      this.tsParseTypeMemberSemicolon();
      return this.finishNode(node, "TSIndexSignature");
    }

    tsParseTupleType() {
      const node = this.startNode();
      this.expect(tt.bracketL);
      node.elementTypes = [];
      while (!this.eat(tt.bracketR)) {
        node.elementTypes.push(this.tsParseTupleElement());
        if (this.type !== tt.bracketR) this.expect(tt.comma);
      }
      return this.finishNode(node, "TSTupleType");
    }

    tsParseTupleElement() {
      const start = this.start;
      const startLoc = this.startLoc;
      const rest = this.eat(tt.ellipsis);
      let element: Node;
      if (
        (this.type === tt.name || this.type.keyword) &&
        this.tsIsTupleLabel()
      ) {
        const node = this.startNode();
        node.label = this.parseIdent(true);
        node.optional = this.eat(tt.question);
        this.expect(tt.colon);
        node.elementType = this.tsParseType();
        element = this.finishNode(node, "TSNamedTupleMember");
      } else {
        element = this.tsParseType();
        if (this.eat(tt.question)) {
          const node = this.startNodeAt(element.start, element.loc?.start);
          node.typeAnnotation = element;
          element = this.finishNode(node, "TSOptionalType");
        }
      }
      if (rest) {
        const node = this.startNodeAt(start, startLoc);
        node.typeAnnotation = element;
        element = this.finishNode(node, "TSRestType");
      }
      return element;
    }

    tsIsTupleLabel() {
      let at = this.tsPeekPos();
      if (this.input.charCodeAt(at) === 63) at = this.tsPeekPos(at + 1);
      return this.input.charCodeAt(at) === CHAR_COLON;
    }

    tsParseTypeParameters() {
      return this.tsInType(() => {
        const node = this.startNode();
        this.next();
        node.params = [];
        while (!this.tsIsGt()) {
          const parameter = this.startNode();
          while (
            (this.type === tt._const ||
              this.type === tt._in ||
              this.isContextual("out")) &&
            isIdentifierStart(this.tsPeekChar())
          ) {
            parameter[this.value] = true;
            this.next();
          }
          parameter.name = this.tsParseTypeParameterName();
          if (this.eat(tt._extends)) parameter.constraint = this.tsParseType();
          if (this.eat(tt.eq)) parameter.default = this.tsParseType();
          node.params.push(this.finishNode(parameter, "TSTypeParameter"));
          if (!this.tsIsGt()) {
            this.expect(tt.comma);
            if (this.tsIsGt())
              node.extra = { trailingComma: this.lastTokStart };
          }
        }
        this.next();
        if (node.params.length === 0) {
          this.tsRaiseFatal(this.start, "Type parameter list cannot be empty.");
        }
        return this.finishNode(node, "TSTypeParameterDeclaration");
      });
    }

    tsParseTypeArguments() {
      return this.tsInType(() => {
        const node = this.startNode();
        this.next();
        node.params = [];
        while (!this.tsIsGt()) {
          node.params.push(this.tsParseType());
          if (!this.tsIsGt()) this.expect(tt.comma);
        }
        if (node.params.length === 0) this.unexpected();
        this.next();
        return this.finishNode(node, "TSTypeParameterInstantiation");
      });
    }

    tsParseHeritage() {
      const list: Node[] = [];
      do {
        const node = this.startNode();
        node.expression = this.tsParseEntityName();
        if (this.tsIsLt()) node.typeParameters = this.tsParseTypeArguments();
        list.push(this.finishNode(node, "TSExpressionWithTypeArguments"));
      } while (this.eat(tt.comma));
      return list;
    }

    tsTryParseDeclaration(exported = false): Node | undefined {
      if (this.type !== tt.name || this.containsEsc) {
        if (this.type === tt._const && this.tsPeekWord() === "enum")
          return this.tsParseEnum(this.startNode());
        return undefined;
      }
      if (!this.tsStartsDeclaration(this.value)) return undefined;
      if (this.value === "declare") return this.tsParseDeclare(exported);
      return this.tsParseDeclarationOf(this.startNode(), this.value);
    }

    tsStartsDeclaration(word: string) {
      switch (word) {
        case "interface":
        case "type":
        case "namespace":
          return this.tsNextIsIdentifierOnSameLine();
        case "enum":
          return isIdentifierStart(this.tsPeekChar());
        case "abstract":
          return this.tsPeekSameLine() && this.tsPeekWord() === "class";
        case "module": {
          const next = this.tsPeekChar();
          return (
            this.tsPeekSameLine() &&
            (next === CHAR_DQUOTE ||
              next === CHAR_SQUOTE ||
              isIdentifierStart(next))
          );
        }
        case "declare":
          return (
            this.tsPeekSameLine() && DECLARE_TARGETS.has(this.tsPeekWord())
          );
        case "global":
          return this.tsPeekSameLine() && this.tsPeekChar() === CHAR_BRACE_L;
      }
      return false;
    }

    tsParseDeclarationOf(node: Node, word: string) {
      switch (word) {
        case "interface":
          return this.tsParseInterface(node);
        case "type":
          return this.tsParseTypeAlias(node);
        case "enum":
          return this.tsParseEnum(node);
        case "abstract":
          return this.tsParseAbstractClass(node, true);
        case "global":
          node.global = true;
          node.id = this.parseIdent();
          node.body = this.tsParseModuleBlock();
          return this.finishNode(node, "TSModuleDeclaration");
      }
      return this.tsParseModule(node);
    }

    tsParseDeclare(exported: boolean) {
      const old = this.tsAmbient;
      this.tsAmbient = true;
      const node = this.startNode();
      this.next();
      const word = this.value;
      if (word === "const" && this.tsPeekWord() === "enum") node.const = true;
      if (!exported && DECLARE_FIRST.has(word)) node.declare = true;
      let declaration: Node;
      if (node.const) {
        declaration = this.tsParseEnum(node);
      } else if (word === "var" || word === "let" || word === "const") {
        declaration = this.parseVarStatement(node, word, true);
      } else if (word === "function") {
        this.next();
        declaration = this.parseFunction(node, FUNC_STATEMENT, false, false);
      } else if (word === "class") {
        declaration = this.parseClass(node, true);
      } else {
        declaration = this.tsParseDeclarationOf(node, word);
      }
      declaration.declare = true;
      this.tsAmbient = old;
      return declaration;
    }

    tsParseAbstractClass(node: Node, isStatement: ClassStatement) {
      this.next();
      node.abstract = true;
      return this.parseClass(node, isStatement);
    }

    tsParseInterface(node: Node) {
      this.next();
      node.id = this.parseIdent();
      this.checkLValSimple(node.id, BIND_TS_INTERFACE);
      if (this.tsIsLt()) node.typeParameters = this.tsParseTypeParameters();
      this.tsInType(() => {
        if (this.eat(tt._extends)) node.extends = this.tsParseHeritage();
        const body = this.startNode();
        body.body = this.tsParseObjectTypeMembers();
        node.body = this.finishNode(body, "TSInterfaceBody");
      });
      return this.finishNode(node, "TSInterfaceDeclaration");
    }

    tsParseTypeAlias(node: Node) {
      this.next();
      node.id = this.parseIdent();
      this.checkLValSimple(node.id, BIND_TS_TYPE);
      if (this.tsIsLt()) node.typeParameters = this.tsParseTypeParameters();
      node.typeAnnotation = this.tsInType(() => {
        this.expect(tt.eq);
        return this.tsParseType();
      });
      this.semicolon();
      return this.finishNode(node, "TSTypeAliasDeclaration");
    }

    tsParseEnum(node: Node) {
      if (this.type === tt._const) {
        node.const = true;
        this.next();
      }
      this.next();
      node.id = this.parseIdent();
      this.checkLValSimple(node.id, BIND_TS_ENUM);
      this.expect(tt.braceL);
      node.members = [];
      while (!this.eat(tt.braceR)) {
        const member = this.startNode();
        member.id =
          this.type === tt.string
            ? this.parseExprAtom()
            : this.parseIdent(true);
        if (this.eat(tt.eq)) member.initializer = this.parseMaybeAssign();
        node.members.push(this.finishNode(member, "TSEnumMember"));
        if (this.type !== tt.braceR) this.expect(tt.comma);
      }
      return this.finishNode(node, "TSEnumDeclaration");
    }

    tsParseModule(node: Node) {
      this.next();
      if (this.type === tt.string) {
        node.id = this.parseExprAtom();
        if (this.type === tt.braceL) node.body = this.tsParseModuleBlock();
        else this.semicolon();
        return this.finishNode(node, "TSModuleDeclaration");
      }
      node.id = this.parseIdent();
      this.checkLValSimple(node.id, BIND_TS_NAMESPACE);
      return this.tsParseNamespaceBody(node);
    }

    tsParseNamespaceBody(node: Node): Node {
      if (this.eat(tt.dot)) {
        const inner = this.startNode();
        inner.id = this.parseIdent();
        node.body = this.tsParseNamespaceBody(inner);
      } else {
        node.body = this.tsParseModuleBlock();
      }
      return this.finishNode(node, "TSModuleDeclaration");
    }

    tsParseModuleBlock() {
      this.enterScope(SCOPE_CLASS_STATIC_BLOCK);
      const node = this.startNode();
      this.enterScope(0);
      this.expect(tt.braceL);
      node.body = [];
      while (!this.eat(tt.braceR))
        node.body.push(this.parseStatement(null, true));
      this.exitScope();
      this.exitScope();
      return this.finishNode(node, "TSModuleBlock");
    }

    tsParseImportEquals(node: Node, isExport: boolean) {
      node.isExport = isExport;
      node.id = this.parseIdent();
      this.checkLValSimple(node.id, BIND_LEXICAL);
      this.expect(tt.eq);
      if (this.isContextual("require") && this.tsPeekChar() === CHAR_PAREN_L) {
        const reference = this.startNode();
        this.next();
        reference.expression = this.tsParseParenthesizedString();
        node.moduleReference = this.finishNode(
          reference,
          "TSExternalModuleReference",
        );
      } else {
        node.moduleReference = this.tsParseEntityName();
      }
      this.semicolon();
      return this.finishNode(node, "TSImportEqualsDeclaration");
    }

    tsPeekIsEquals() {
      const at = this.tsPeekPos();
      if (this.input.charCodeAt(at) !== CHAR_EQ) return false;
      const after = this.input.charCodeAt(at + 1);
      return after !== CHAR_EQ && after !== 62;
    }

    parseStatement(
      context: string | null,
      topLevel?: boolean,
      exports?: ExportedNames,
    ) {
      if (this.type === atType) this.tsParseDecorators(true);
      const declaration = this.tsTryParseDeclaration();
      if (declaration) return declaration;
      return super.parseStatement(context, topLevel, exports);
    }

    parseVarStatement(
      node: Node,
      kind: string,
      allowMissingInitializer: boolean,
    ) {
      return super.parseVarStatement(
        node,
        kind,
        allowMissingInitializer || this.tsAmbient,
      );
    }

    parseVarId(decl: Node, kind: string) {
      super.parseVarId(decl, kind);
      if (
        decl.id.type === "Identifier" &&
        this.tsIsBang() &&
        !this.hasPrecedingLineBreak()
      ) {
        this.next();
        decl.definite = true;
      }
      this.tsParseBindingSuffix(decl.id, false);
    }

    parseCatchClauseParam() {
      const param = this.tsParseBindingSuffix(this.parseBindingAtom(), false);
      const simple = param.type === "Identifier";
      this.enterScope(simple ? SCOPE_SIMPLE_CATCH : 0);
      this.checkLValPattern(param, simple ? BIND_SIMPLE_CATCH : BIND_LEXICAL);
      this.expect(tt.parenR);
      return param;
    }

    parseImport(node: Node) {
      this.next();
      node.importKind = "value";
      if (this.type === tt.string) {
        node.specifiers = [];
        node.source = this.parseExprAtom();
      } else {
        if (this.isContextual("type")) {
          const next = this.tsPeekChar();
          if (
            next === CHAR_BRACE_L ||
            next === CHAR_STAR ||
            (isIdentifierStart(next) && this.tsPeekWord() !== "from")
          ) {
            node.importKind = "type";
            this.next();
          }
        }
        if (this.type === tt.name && this.tsPeekIsEquals())
          return this.tsParseImportEquals(node, false);
        node.specifiers = this.parseImportSpecifiers();
        this.expectContextual("from");
        node.source = this.tsParseString();
      }
      this.tsParseAttributes(node);
      this.semicolon();
      return this.finishNode(node, "ImportDeclaration");
    }

    parseWithClause() {
      if (this.isContextual("assert") && !this.hasPrecedingLineBreak())
        this.type = tt._with;
      return this.type === tt._with ? super.parseWithClause() : undefined;
    }

    tsParseAttributes(node: Node) {
      const attributes = this.parseWithClause();
      if (attributes) node.attributes = attributes;
    }

    parseImportSpecifier() {
      return this.tsParseSpecifier("importKind", () =>
        super.parseImportSpecifier(),
      );
    }

    parseExportSpecifier(exports?: ExportedNames) {
      return this.tsParseSpecifier("exportKind", () =>
        super.parseExportSpecifier(exports),
      );
    }

    tsParseSpecifier(kindKey: string, parse: () => Node) {
      const next = this.isContextual("type") ? this.tsPeekChar() : -1;
      if (
        next === CHAR_DQUOTE ||
        next === CHAR_SQUOTE ||
        (isIdentifierStart(next) && this.tsPeekWord() !== "as")
      ) {
        const modifier = this.startNode();
        this.next();
        const node = parse();
        this.tsResetStart(node, modifier);
        node[kindKey] = "type";
        return node;
      }
      const node = parse();
      node[kindKey] = "value";
      return node;
    }

    parseExport(node: Node, exports?: ExportedNames) {
      this.next();
      if (this.eat(tt._import)) {
        node.importKind = "value";
        if (
          this.isContextual("type") &&
          isIdentifierStart(this.tsPeekChar()) &&
          this.tsPeekWord() !== "from"
        ) {
          node.importKind = "type";
          this.next();
        }
        return this.tsParseImportEquals(node, true);
      }
      if (this.eat(tt.eq)) {
        node.expression = this.parseExpression();
        this.semicolon();
        return this.finishNode(node, "TSExportAssignment");
      }
      if (this.eatContextual("as")) {
        this.expectContextual("namespace");
        node.id = this.parseIdent();
        this.semicolon();
        return this.finishNode(node, "TSNamespaceExportDeclaration");
      }

      node.exportKind = "value";
      if (this.isContextual("type")) {
        const next = this.tsPeekChar();
        if (next === CHAR_BRACE_L || next === CHAR_STAR) {
          node.exportKind = "type";
          this.next();
        }
      }

      if (this.eat(tt.star))
        return this.parseExportAllDeclaration(node, exports);

      if (this.eat(tt._default)) {
        if (
          this.isContextual("interface") &&
          this.tsNextIsIdentifierOnSameLine()
        ) {
          node.declaration = this.tsParseInterface(this.startNode());
        } else if (
          this.isContextual("abstract") &&
          this.tsPeekWord() === "class"
        ) {
          node.declaration = this.tsParseAbstractClass(
            this.startNode(),
            "nullableID",
          );
        } else {
          node.declaration = this.parseExportDefaultDeclaration();
        }
        return this.finishNode(node, "ExportDefaultDeclaration");
      }

      const isDeclare = this.isContextual("declare");
      const declaration = this.tsTryParseDeclaration(true);
      if (declaration || this.shouldParseExportStatement()) {
        node.declaration = declaration ?? this.parseStatement(null);
        if (
          isDeclare ||
          node.declaration.type === "TSInterfaceDeclaration" ||
          node.declaration.type === "TSTypeAliasDeclaration"
        ) {
          node.exportKind = "type";
        }
        node.specifiers = [];
        node.source = null;
        return this.finishNode(node, "ExportNamedDeclaration");
      }

      node.declaration = null;
      node.specifiers = this.parseExportSpecifiers(exports);
      if (this.eatContextual("from")) {
        node.source = this.tsParseString();
        this.tsParseAttributes(node);
      } else {
        for (const spec of node.specifiers) {
          this.checkUnreserved(spec.local);
          this.checkLocalExport(spec.local);
          if (spec.local.type === "Literal") {
            this.raise(
              spec.local.start,
              "A string literal cannot be used as an exported binding without `from`.",
            );
          }
        }
        node.source = null;
      }
      this.semicolon();
      return this.finishNode(node, "ExportNamedDeclaration");
    }

    parseFunction(
      node: Node,
      statement: number,
      allowExpressionBody: boolean,
      isAsync: boolean,
      forInit?: ForInit,
    ) {
      const isDeclaration = statement & FUNC_STATEMENT;
      if (isDeclaration) {
        this.tsDeferredFunction = node;
        this.tsBodilessAt = node.start;
      }
      super.parseFunction(
        node,
        statement,
        allowExpressionBody,
        isAsync,
        forInit,
      );
      this.tsDeferredFunction = null;
      const bodiless = !node.body;
      if (bodiless) node.type = "TSDeclareFunction";
      if (isDeclaration && node.id) {
        if (bodiless) {
          if (this.tsAmbient && this.currentScope().flags & SCOPE_TOP) {
            this.declareName(
              node.id.name,
              BIND_FLAGS_TS_EXPORT_ONLY,
              node.id.start,
            );
          }
          this.checkLValSimple(node.id, BIND_NONE);
        } else if (!(statement & FUNC_HANGING_STATEMENT)) {
          let bindingType = BIND_FUNCTION;
          if (this.strict || node.generator || node.async) {
            bindingType = this.treatFunctionsAsVar ? BIND_VAR : BIND_LEXICAL;
          }
          this.checkLValSimple(node.id, bindingType);
        }
      }
      return node;
    }

    parseFunctionParams(node: Node) {
      if (this.tsIsLt()) node.typeParameters = this.tsParseTypeParameters();
      super.parseFunctionParams(node);
      if (this.type === tt.colon)
        node.returnType = this.tsParseTypeAnnotation(true);
    }

    parseFunctionBody(
      node: Node,
      isArrowFunction: boolean,
      isMethod: boolean,
      forInit?: ForInit,
    ) {
      if (isMethod && this.type === tt.colon)
        node.returnType = this.tsParseTypeAnnotation(true);
      // a function may have no body, as an overload, only if it starts at `tsBodilessAt`: a declaration or a class method
      if (
        isArrowFunction ||
        this.type === tt.braceL ||
        node.start !== this.tsBodilessAt
      ) {
        super.parseFunctionBody(node, isArrowFunction, isMethod, forInit);
        return;
      }
      this.semicolon();
      this.exitScope();
    }

    parseMethod(
      isGenerator: boolean,
      isAsync: boolean,
      allowDirectSuper: boolean,
    ) {
      const typeParameters = this.tsMethodTypeParams;
      this.tsMethodTypeParams = null;
      const node = super.parseMethod(isGenerator, isAsync, allowDirectSuper);
      if (!node.body) node.type = "TSDeclareMethod";
      if (typeParameters) node.typeParameters = typeParameters;
      return node;
    }

    parseBindingList(
      close: TokenType,
      allowEmpty: boolean,
      allowTrailingComma: boolean,
      allowModifiers?: boolean,
    ) {
      const modifiers = allowModifiers === true || this.tsConstructorParams;
      this.tsConstructorParams = false;
      return super.parseBindingList(
        close,
        allowEmpty,
        allowTrailingComma,
        modifiers,
      );
    }

    tsModifierCanFollow(allowLineBreak: boolean) {
      if (!allowLineBreak && !this.tsPeekSameLine()) return false;
      const next = this.tsPeekChar();
      return (
        next === CHAR_BRACKET_L ||
        next === CHAR_BRACE_L ||
        next === CHAR_STAR ||
        next === CHAR_DOT ||
        next === CHAR_HASH ||
        next === CHAR_DQUOTE ||
        next === CHAR_SQUOTE ||
        (next >= 48 && next <= 57) ||
        isIdentifierStart(next)
      );
    }

    parseAssignableListItem(allowModifiers: boolean) {
      const decorators = this.tsParseDecoratorList();
      const start = this.start;
      const startLoc = this.startLoc;
      let accessibility: string | undefined;
      let readonly = false;
      let override = false;
      if (allowModifiers) {
        while (
          this.type === tt.name &&
          PARAMETER_MODIFIERS.has(this.value) &&
          !this.containsEsc &&
          this.tsModifierCanFollow(false)
        ) {
          if (this.value === "readonly") readonly = true;
          else if (this.value === "override") override = true;
          else accessibility = this.value;
          this.next();
        }
      }

      let left: Node;
      if (this.type === tt._this) {
        left = this.startNode();
        left.name = "this";
        this.next();
        this.finishNode(left, "Identifier");
      } else {
        left = this.parseBindingAtom();
      }
      const element =
        this.type === tt.eq
          ? this.parseMaybeDefault(start, startLoc, left)
          : this.parseMaybeDefault(
              left.start,
              left.loc?.start,
              this.tsParseBindingSuffix(left, true),
            );

      if (decorators.length > 0) element.decorators = decorators;
      if (!accessibility && !readonly && !override) return element;
      const node = this.startNodeAt(start, startLoc);
      if (accessibility) node.accessibility = accessibility;
      if (readonly) node.readonly = true;
      if (override) node.override = true;
      node.parameter = element;
      return this.finishNode(node, "TSParameterProperty");
    }

    parseBindingListItem(param: Node) {
      if (param.type === "RestElement") this.tsParseBindingSuffix(param, true);
      return param;
    }

    checkLValSimple(
      expr: Node,
      bindingType?: number,
      checkClashes?: ExportedNames,
    ): void {
      if (this.tsDeferredFunction && expr === this.tsDeferredFunction.id) {
        this.tsDeferredFunction = null;
        return;
      }
      if (!bindingType && TS_EXPRESSION_WRAPPERS.has(expr.type)) {
        this.checkLValSimple(expr.expression, bindingType, checkClashes);
        return;
      }
      switch (expr.type) {
        case "TSParameterProperty":
          this.checkLValInnerPattern(expr.parameter, bindingType, checkClashes);
          return;
        case "Identifier":
          if (expr.name === "this") return;
      }
      super.checkLValSimple(expr, bindingType, checkClashes);
    }

    toAssignable(
      node: Node,
      isBinding: boolean,
      refDestructuringErrors?: DestructuringErrors | null,
    ) {
      if (node && !isBinding && TS_EXPRESSION_WRAPPERS.has(node.type))
        return node;
      return super.toAssignable(node, isBinding, refDestructuringErrors);
    }

    declareName(name: string, bindingType: number, pos: number) {
      const scope = this.currentScope();
      if (bindingType & BIND_FLAGS_TS_EXPORT_ONLY) {
        this.tsExportDefined(scope, name);
        scope.tsExportOnly ??= [];
        scope.tsExportOnly.push(name);
        return;
      }
      if (bindingType === BIND_TS_TYPE || bindingType === BIND_TS_INTERFACE) {
        scope.tsTypes ??= [];
        if (bindingType === BIND_TS_TYPE && hasName(scope.tsTypes, name)) {
          this.raise(pos, `type '${name}' has already been declared.`);
        }
        scope.tsTypes.push(name);
        this.tsExportDefined(scope, name);
        return;
      }
      if (bindingType & BIND_FLAGS_TS_ENUM) {
        scope.tsEnums ??= [];
        if (hasName(scope.tsEnums, name)) return;
        super.declareName(name, BIND_LEXICAL, pos);
        scope.tsEnums.push(name);
        return;
      }
      super.declareName(name, bindingType, pos);
    }

    tsExportDefined(scope: Scope, name: string) {
      if (this.inModule && scope.flags & SCOPE_TOP) {
        delete this.undefinedExports[name];
      }
    }

    checkLocalExport(id: Node) {
      for (let i = this.scopeStack.length - 1; i >= 0; i--) {
        const scope = this.scopeStack[i];
        if (
          hasName(scope.tsTypes, id.name) ||
          hasName(scope.tsExportOnly, id.name)
        ) {
          return;
        }
      }
      super.checkLocalExport(id);
    }

    checkExport() {
      // skips acorn's duplicate export check, which TypeScript's overloads and merged declarations would fail
    }

    raiseRecoverable(pos: number, message: string) {
      if (message === "Duplicate constructor in the same class") return;
      super.raiseRecoverable(pos, message);
    }

    tsParseDecoratorList() {
      const decorators: Node[] = [];
      while (this.type === atType) decorators.push(this.tsParseDecorator());
      return decorators;
    }

    tsParseDecorators(allowExport: boolean) {
      const pending = this.tsDecoratorStack[this.tsDecoratorStack.length - 1];
      while (this.type === atType) pending.push(this.tsParseDecorator());
      if (this.type === tt._export) {
        if (!allowExport) this.unexpected();
      } else if (
        this.type !== tt._class &&
        !(
          (this.isContextual("abstract") || this.isContextual("declare")) &&
          this.tsPeekWord() === "class"
        )
      ) {
        this.raise(
          this.start,
          "Leading decorators must be attached to a class declaration.",
        );
      }
    }

    tsParseDecorator() {
      const node = this.startNode();
      this.next();
      this.tsDecoratorStack.push([]);
      const startPos = this.start;
      const startLoc = this.startLoc;
      let expression: Node;
      if (this.type === tt.parenL) {
        this.next();
        expression = this.parseExpression();
        this.expect(tt.parenR);
        if (this.options.preserveParens) {
          const paren = this.startNodeAt(startPos, startLoc);
          paren.expression = expression;
          expression = this.finishNode(paren, "ParenthesizedExpression");
        }
      } else {
        expression = this.parseIdent(false);
        while (this.eat(tt.dot)) {
          const member = this.startNodeAt(startPos, startLoc);
          member.object = expression;
          member.property = this.parseIdent(true);
          member.computed = false;
          expression = this.finishNode(member, "MemberExpression");
        }
      }

      const typeArguments = this.tsSplitLt()
        ? this.tsParseTypeArguments()
        : undefined;
      if (this.eat(tt.parenL)) {
        const call = this.startNodeAt(expression.start, expression.loc?.start);
        call.callee = expression;
        call.arguments = this.parseExprList(tt.parenR, false, false);
        if (typeArguments) call.typeArguments = typeArguments;
        expression = this.finishNode(call, "CallExpression");
      } else if (typeArguments) {
        const instantiation = this.startNodeAt(
          expression.start,
          expression.loc?.start,
        );
        instantiation.expression = expression;
        instantiation.typeArguments = typeArguments;
        expression = this.finishNode(
          instantiation,
          "TSInstantiationExpression",
        );
      }

      node.expression = expression;
      this.tsDecoratorStack.pop();
      return this.finishNode(node, "Decorator");
    }

    shouldParseExportStatement() {
      return this.type === atType || super.shouldParseExportStatement();
    }

    parseExprAtom(
      refDestructuringErrors?: DestructuringErrors | null,
      forInit?: ForInit,
      forNew?: boolean,
    ): Node {
      if (this.type === atType) this.tsParseDecorators(false);
      return super.parseExprAtom(refDestructuringErrors, forInit, forNew);
    }

    parseProperty(
      isPattern: boolean,
      refDestructuringErrors?: DestructuringErrors | null,
    ): Node {
      if (isPattern || this.type !== atType) {
        return super.parseProperty(isPattern, refDestructuringErrors);
      }
      const decorators = this.tsParseDecoratorList();
      const property = super.parseProperty(isPattern, refDestructuringErrors);
      if (property.type === "SpreadElement") {
        this.raise(
          property.start,
          "Decorators can't be used with SpreadElement",
        );
      }
      property.decorators = decorators;
      return property;
    }

    parseClassId(node: Node, isStatement: ClassStatement) {
      const index = this.tsDecoratorStack.length - 1;
      const decorators = this.tsDecoratorStack[index];
      if (decorators.length > 0) {
        node.decorators = decorators;
        this.tsResetStart(node, decorators[0]);
        this.tsDecoratorStack[index] = [];
      }
      if (!this.isContextual("implements") || isStatement === true) {
        super.parseClassId(node, isStatement);
      }
      if (this.tsIsLt()) node.typeParameters = this.tsParseTypeParameters();
    }

    parseClassSuper(node: Node) {
      super.parseClassSuper(node);
      if (node.superClass && this.tsIsLt())
        node.superTypeParameters = this.tsParseTypeArguments();
      if (this.eatContextual("implements"))
        node.implements = this.tsInType(() => this.tsParseHeritage());
    }

    parseClassElement(constructorAllowsSuper: boolean): Node | null {
      if (this.type === atType) {
        const decorators = this.tsParseDecoratorList();
        if (this.type === tt.braceR) {
          this.raise(
            this.start,
            "Decorators must be attached to a class element.",
          );
        }
        const element = this.parseClassElement(constructorAllowsSuper) as Node;
        element.decorators = decorators;
        this.tsResetStart(element, decorators[0]);
        return element;
      }
      if (this.eat(tt.semi)) return null;
      const node = this.startNode();

      while (
        this.type === tt.name &&
        CLASS_MODIFIERS.has(this.value) &&
        !this.containsEsc &&
        this.tsModifierCanFollow(this.value === "static")
      ) {
        const modifier = this.value;
        this.next();
        if (modifier === "static" && this.type === tt.braceL) {
          this.next();
          this.parseClassStaticBlock(node);
          return node;
        }
        if (
          modifier === "public" ||
          modifier === "private" ||
          modifier === "protected"
        ) {
          node.accessibility = modifier;
        } else {
          node[modifier] = true;
        }
      }

      if (this.type === tt.bracketL && this.tsIsIndexSignature())
        return this.tsParseIndexSignature(node);

      node.static ??= false;
      let keyName = "";
      let isGenerator = false;
      let isAsync = false;
      let kind = "method";
      if (this.eatContextual("async")) {
        if (
          (this.isClassElementNameStart() || this.type === tt.star) &&
          !this.canInsertSemicolon()
        ) {
          isAsync = true;
        } else {
          keyName = "async";
        }
      }
      if (!keyName && this.eat(tt.star)) isGenerator = true;
      if (!keyName && !isAsync && !isGenerator) {
        const lastValue = this.value;
        if (this.eatContextual("get") || this.eatContextual("set")) {
          if (this.isClassElementNameStart()) kind = lastValue;
          else keyName = lastValue;
        }
      }

      if (keyName) {
        node.computed = false;
        node.key = this.startNodeAt(this.lastTokStart, this.lastTokStartLoc);
        node.key.name = keyName;
        this.finishNode(node.key, "Identifier");
      } else {
        this.parseClassElementName(node);
      }
      if (this.eat(tt.question)) node.optional = true;

      if (
        this.type === tt.parenL ||
        this.tsIsLt() ||
        kind !== "method" ||
        isGenerator ||
        isAsync
      ) {
        const key = node.key;
        const isConstructor =
          !node.static &&
          !node.computed &&
          ((key.type === "Identifier" && key.name === "constructor") ||
            (key.type === "Literal" && key.value === "constructor"));
        node.kind = isConstructor ? "constructor" : kind;
        if (this.tsIsLt()) node.typeParameters = this.tsParseTypeParameters();
        this.tsConstructorParams = isConstructor;
        this.tsBodilessAt = this.start;
        this.parseClassMethod(
          node,
          isGenerator,
          isAsync,
          isConstructor && constructorAllowsSuper,
        );
      } else {
        if (!node.optional && this.tsIsBang()) {
          this.next();
          node.definite = true;
        }
        if (this.type === tt.colon)
          node.typeAnnotation = this.tsParseTypeAnnotation();
        this.parseClassField(node);
      }
      return node;
    }

    parseMaybeAssign(
      forInit?: ForInit,
      refDestructuringErrors?: DestructuringErrors | null,
      afterLeftParse?: (
        node: Node,
        startPos: number,
        startLoc: Position,
      ) => Node,
    ) {
      if (this.tsSplitLt()) {
        const arrow = this.tsTry(() => {
          const typeParameters = this.tsParseTypeParameters();
          const expr = super.parseMaybeAssign(
            forInit,
            refDestructuringErrors,
            afterLeftParse,
          );
          if (expr.type !== "ArrowFunctionExpression") return;
          expr.typeParameters = typeParameters;
          this.tsResetStart(expr, typeParameters);
          return expr;
        });
        if (arrow) return arrow;
      }
      return super.parseMaybeAssign(
        forInit,
        refDestructuringErrors,
        afterLeftParse,
      );
    }

    parseMaybeUnary(
      refDestructuringErrors: DestructuringErrors | null | undefined,
      sawUnary: boolean,
      incDec: boolean,
      forInit: ForInit,
    ) {
      if (this.tsSplitLt()) {
        const node = this.startNode();
        node.typeAnnotation = this.tsInType(() => {
          this.next();
          const type = this.tsParseType();
          if (!this.tsIsGt()) this.unexpected();
          this.next();
          return type;
        });
        node.expression = this.parseMaybeUnary(null, false, false, forInit);
        return this.finishNode(node, "TSTypeAssertion");
      }
      return super.parseMaybeUnary(
        refDestructuringErrors,
        sawUnary,
        incDec,
        forInit,
      );
    }

    parseMaybeConditional(
      forInit: ForInit,
      refDestructuringErrors?: DestructuringErrors | null,
    ) {
      const startPos = this.start;
      const startLoc = this.startLoc;
      const expr = this.parseExprOps(forInit, refDestructuringErrors);
      if (this.checkExpressionErrors(refDestructuringErrors)) return expr;
      if (
        this.type === tt.question &&
        !(expr.type === "ArrowFunctionExpression" && expr.start === startPos) &&
        !this.tsQuestionMarksOptionalParam()
      ) {
        this.next();
        const node = this.startNodeAt(startPos, startLoc);
        node.test = expr;
        node.consequent = this.parseMaybeAssign();
        this.expect(tt.colon);
        node.alternate = this.parseMaybeAssign(forInit);
        return this.finishNode(node, "ConditionalExpression");
      }
      return expr;
    }

    tsQuestionMarksOptionalParam() {
      const at = this.tsPeekPos();
      const next = this.input.charCodeAt(at);
      if (next === CHAR_COLON || next === CHAR_COMMA || next === CHAR_PAREN_R)
        return true;
      return next === CHAR_EQ && this.input.charCodeAt(at + 1) !== CHAR_EQ;
    }

    parseParenItem(item: Node) {
      return this.tsParseBindingSuffix(item, true);
    }

    tsTryArrowReturnType() {
      if (this.type !== tt.colon) return true;
      const returnType = this.tsTry(() => {
        const type = this.tsParseTypeAnnotation(true);
        return this.type === tt.arrow && !this.canInsertSemicolon()
          ? type
          : undefined;
      });
      if (!returnType) return false;
      this.tsArrowReturn = returnType;
      return true;
    }

    shouldParseArrow(exprList: Node[]) {
      return this.tsTryArrowReturnType() && super.shouldParseArrow(exprList);
    }

    shouldParseAsyncArrow() {
      return this.tsTryArrowReturnType() && super.shouldParseAsyncArrow();
    }

    parseArrowExpression(
      node: Node,
      params: Node[],
      isAsync: boolean,
      forInit: ForInit,
    ) {
      if (this.tsArrowReturn) {
        node.returnType = this.tsArrowReturn;
        this.tsArrowReturn = null;
      }
      return super.parseArrowExpression(node, params, isAsync, forInit);
    }

    parseExprList(
      close: TokenType,
      allowTrailingComma: boolean,
      allowEmpty: boolean,
      refDestructuringErrors?: DestructuringErrors | null,
    ) {
      if (!this.tsAsyncArguments)
        return super.parseExprList(
          close,
          allowTrailingComma,
          allowEmpty,
          refDestructuringErrors,
        );
      this.tsAsyncArguments = false;
      const elements: Node[] = [];
      let first = true;
      while (!this.eat(close)) {
        if (first) {
          first = false;
        } else {
          this.expect(tt.comma);
          if (allowTrailingComma && this.afterTrailingComma(close)) break;
        }
        if (this.type === tt.ellipsis) {
          const spread = this.parseSpread(refDestructuringErrors);
          if (this.eat(tt.question)) spread.optional = true;
          if (this.type === tt.colon)
            spread.typeAnnotation = this.tsParseTypeAnnotation();
          elements.push(spread);
        } else {
          elements.push(
            this.parseMaybeAssign(
              false,
              refDestructuringErrors,
              this.parseParenItem,
            ),
          );
        }
      }
      return elements;
    }

    parseSubscript(
      base: Node,
      startPos: number,
      startLoc: Position,
      noCalls: boolean,
      maybeAsyncArrow: boolean,
      optionalChained: boolean,
      forInit: ForInit,
    ) {
      if (this.tsIsBang() && !this.hasPrecedingLineBreak()) {
        const node = this.startNodeAt(startPos, startLoc);
        this.exprAllowed = false;
        this.next();
        node.expression = base;
        return this.finishNode(node, "TSNonNullExpression");
      }

      if (maybeAsyncArrow && this.tsIsLt()) {
        const arrow = this.tsTry(() =>
          this.tsParseGenericAsyncArrow(startPos, startLoc, forInit),
        );
        if (arrow) return arrow;
      }

      const optional =
        this.type === tt.questionDot && this.tsPeekChar() === CHAR_LT;
      if (
        this.tsIsLt() ||
        optional ||
        (this.type === tt.bitShift && this.value === "<<")
      ) {
        const typeArguments = this.tsTry(() => {
          if (optional) this.next();
          this.tsSplitLt();
          const args = this.tsParseTypeArguments();
          if (this.type === tt.parenL && !noCalls) return args;
          if (this.type === tt.backQuote) return optional ? undefined : args;
          if (optional) return;
          if (
            this.tsIsGt() ||
            this.type === tt.bitShift ||
            (this.type.startsExpr &&
              this.type !== tt.parenL &&
              !this.hasPrecedingLineBreak())
          ) {
            return;
          }
          return args;
        });
        if (typeArguments) {
          const node = this.startNodeAt(startPos, startLoc);
          if (this.type === tt.parenL && !noCalls) {
            this.next();
            node.callee = base;
            node.arguments = this.parseExprList(tt.parenR, true, false);
            node.typeArguments = typeArguments;
            if (optional) base.optional = true;
            if (optional || optionalChained) node.optional = optional;
            return this.finishNode(node, "CallExpression");
          }
          if (this.type === tt.backQuote) {
            node.tag = base;
            node.quasi = this.parseTemplate({ isTagged: true });
            node.typeArguments = typeArguments;
            return this.finishNode(node, "TaggedTemplateExpression");
          }
          node.expression = base;
          node.typeArguments = typeArguments;
          return this.finishNode(node, "TSInstantiationExpression");
        }
      }

      if (maybeAsyncArrow && this.type === tt.parenL)
        this.tsAsyncArguments = true;
      return super.parseSubscript(
        base,
        startPos,
        startLoc,
        noCalls,
        maybeAsyncArrow,
        optionalChained,
        forInit,
      );
    }

    tsParseGenericAsyncArrow(
      startPos: number,
      startLoc: Position,
      forInit: ForInit,
    ) {
      const node = this.startNodeAt(startPos, startLoc);
      node.typeParameters = this.tsParseTypeParameters();
      this.expect(tt.parenL);
      node.params = this.parseBindingList(tt.parenR, false, true);
      if (this.type === tt.colon)
        node.returnType = this.tsParseTypeAnnotation(true);
      if (this.type !== tt.arrow || this.canInsertSemicolon()) return;
      this.next();
      return this.parseArrowExpression(node, node.params, true, forInit);
    }

    parseDynamicImport(node: Node) {
      this.next();
      node.source = this.parseMaybeAssign();
      if (this.eat(tt.comma) && this.type !== tt.parenR)
        node.arguments = [this.parseExpression()];
      this.expect(tt.parenR);
      return this.finishNode(node, "ImportExpression");
    }

    parseNew() {
      const node = super.parseNew();
      if (node.callee?.type !== "TSInstantiationExpression") return node;
      const result = this.startNodeAt(node.start, node.loc?.start);
      result.callee = node.callee.expression;
      result.typeArguments = node.callee.typeArguments;
      result.arguments = node.arguments;
      return this.finishNodeAt(
        result,
        "NewExpression",
        node.end,
        node.loc?.end,
      );
    }

    parseExprOp(
      left: Node,
      leftStartPos: number,
      leftStartLoc: Position,
      minPrec: number,
      forInit: ForInit,
    ): Node {
      if (
        tt._in.binop > minPrec &&
        this.type === tt.name &&
        (this.value === "as" || this.value === "satisfies") &&
        !this.containsEsc &&
        !this.hasPrecedingLineBreak()
      ) {
        const isSatisfies = this.value === "satisfies";
        const node = this.startNodeAt(leftStartPos, leftStartLoc);
        node.expression = left;
        node.typeAnnotation = this.tsInType(() => {
          this.next();
          if (!isSatisfies && this.type === tt._const) {
            const reference = this.startNode();
            reference.typeName = this.parseIdent(true);
            return this.finishNode(reference, "TSTypeReference");
          }
          return this.tsParseType();
        });
        this.finishNode(
          node,
          isSatisfies ? "TSSatisfiesExpression" : "TSAsExpression",
        );
        return this.parseExprOp(
          node,
          leftStartPos,
          leftStartLoc,
          minPrec,
          forInit,
        );
      }
      return super.parseExprOp(
        left,
        leftStartPos,
        leftStartLoc,
        minPrec,
        forInit,
      );
    }

    parseGetterSetter(prop: Node) {
      prop.kind = prop.key.name;
      super.parseGetterSetter(prop);
    }

    parsePropertyValue(
      prop: Node,
      isPattern: boolean,
      isGenerator: boolean,
      isAsync: boolean,
      startPos: number,
      startLoc: Position,
      refDestructuringErrors: DestructuringErrors | null | undefined,
      containsEsc: boolean,
    ) {
      if (!isPattern && this.tsIsLt()) {
        this.tsMethodTypeParams = this.tsParseTypeParameters();
        if (this.type !== tt.parenL) this.unexpected();
        prop.kind = "init";
      }
      return super.parsePropertyValue(
        prop,
        isPattern,
        isGenerator,
        isAsync,
        startPos,
        startLoc,
        refDestructuringErrors,
        containsEsc,
      );
    }
  }

  return TSParser;
});
