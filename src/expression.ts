import { parseExpressionAt } from "./acorn-bridge";
import { position } from "./locator";
import { skipWhitespace } from "./markup";
import { RESERVED_WORDS } from "./reserved-words";
import { scanIdentifier, type TemplateParserState } from "./state";
import type {
  Expression,
  Identifier,
  Node,
  SimpleLiteral,
} from "./types/estree";

// acorn's `binop` for each binary operator the fast path reads
const PRECEDENCE: Record<string, number> = {
  "||": 1,
  "??": 1,
  "&&": 2,
  "==": 6,
  "!=": 6,
  "===": 6,
  "!==": 6,
  "<": 7,
  ">": 7,
  "<=": 7,
  ">=": 7,
  "+": 9,
  "-": 9,
  "*": 10,
  "/": 10,
  "%": 10,
};

function literal(
  source: string,
  start: number,
  end: number,
  value: SimpleLiteral["value"],
): SimpleLiteral {
  return { type: "Literal", start, end, value, raw: source.slice(start, end) };
}

function scanLiteral(source: string, from: number): SimpleLiteral | null {
  const first = source.charCodeAt(from);
  if (first === 34 || first === 39) {
    for (let end = from + 1; end < source.length; end++) {
      const code = source.charCodeAt(end);
      if (code === first) {
        return literal(source, from, end + 1, source.slice(from + 1, end));
      }
      if (code === 92 || code === 10 || code === 13) return null;
    }
    return null;
  }
  let end = from;
  for (; end < source.length; end++) {
    const code = source.charCodeAt(end);
    if (code < 48 || code > 57) break;
  }
  if (end === from || (first === 48 && end - from > 1)) return null;
  return literal(source, from, end, Number(source.slice(from, end)));
}

function scanAtom(
  source: string,
  from: number,
  typescript: boolean,
): Expression | null {
  const identifierEnd = scanIdentifier(source, from);
  if (identifierEnd === from) return scanLiteral(source, from);

  const name = source.slice(from, identifierEnd);
  if (name === "true" || name === "false" || name === "null") {
    return literal(
      source,
      from,
      identifierEnd,
      name === "null" ? null : name === "true",
    );
  }
  if (RESERVED_WORDS.has(name)) return null;

  let node: Expression = {
    type: "Identifier",
    start: from,
    end: identifierEnd,
    name,
  };

  for (let index = identifierEnd; ; ) {
    const next = source.charCodeAt(index);
    if (next === 40) {
      const call = scanArguments(source, index + 1, typescript);
      if (!call) return null;
      node = {
        type: "CallExpression",
        start: from,
        end: call.end,
        callee: node,
        arguments: call.arguments,
        optional: false,
      };
      index = call.end;
      continue;
    }
    let property: Identifier | SimpleLiteral | null;
    let end: number;
    if (next === 46) {
      end = scanIdentifier(source, index + 1);
      if (end === index + 1) return null;
      property = {
        type: "Identifier",
        start: index + 1,
        end,
        name: source.slice(index + 1, end),
      };
    } else if (next === 91) {
      property = scanLiteral(source, index + 1);
      if (!property || source.charCodeAt(property.end) !== 93) return null;
      end = property.end + 1;
    } else {
      return node;
    }
    node = {
      type: "MemberExpression",
      start: from,
      end,
      object: node,
      property,
      computed: next === 91,
      optional: false,
    };
    index = end;
  }
}

/** The arguments of a call from after its `(`, and where the `)` ends. */
function scanArguments(
  source: string,
  from: number,
  typescript: boolean,
): { arguments: Expression[]; end: number } | null {
  const args: Expression[] = [];
  let index = skipWhitespace(source, from);
  if (source.charCodeAt(index) === 41)
    return { arguments: args, end: index + 1 };
  for (;;) {
    const argument = scanConditional(source, index, typescript);
    if (!argument) return null;
    args.push(argument);
    index = skipWhitespace(source, argument.end);
    const code = source.charCodeAt(index);
    if (code === 41) return { arguments: args, end: index + 1 };
    if (code !== 44) return null;
    index = skipWhitespace(source, index + 1);
    if (source.charCodeAt(index) === 41) return null;
  }
}

function scanUnary(
  source: string,
  from: number,
  typescript: boolean,
): Expression | null {
  const code = source.charCodeAt(from);
  const next = source.charCodeAt(from + 1);
  if (
    !(code === 33 && next !== 61) &&
    !(code === 45 && next !== 45 && next !== 61)
  ) {
    return scanAtom(source, from, typescript);
  }
  const argument = scanUnary(
    source,
    skipWhitespace(source, from + 1),
    typescript,
  );
  if (!argument) return null;
  return {
    type: "UnaryExpression",
    start: from,
    end: argument.end,
    operator: code === 33 ? "!" : "-",
    prefix: true,
    argument,
  };
}

/** The binary operator at `index`, if the fast path reads it: not `**`, `<<`, a compound assignment, a comment, or `<` and `>` in TypeScript. */
function operatorAt(
  source: string,
  index: number,
  typescript: boolean,
): string | null {
  const code = source.charCodeAt(index);
  const next = source.charCodeAt(index + 1);
  switch (code) {
    case 124:
      return next === 124 && source.charCodeAt(index + 2) !== 61 ? "||" : null;
    case 38:
      return next === 38 && source.charCodeAt(index + 2) !== 61 ? "&&" : null;
    case 63:
      return next === 63 && source.charCodeAt(index + 2) !== 61 ? "??" : null;
    case 61:
      if (next !== 61) return null;
      return source.charCodeAt(index + 2) === 61 ? "===" : "==";
    case 33:
      if (next !== 61) return null;
      return source.charCodeAt(index + 2) === 61 ? "!==" : "!=";
    case 60:
    case 62:
      if (typescript || next === code) return null;
      if (next === 61) return code === 60 ? "<=" : ">=";
      return code === 60 ? "<" : ">";
    case 43:
      return next === 43 || next === 61 ? null : "+";
    case 45:
      return next === 45 || next === 61 ? null : "-";
    case 42:
      return next === 42 || next === 61 ? null : "*";
    case 47:
      return next === 47 || next === 42 || next === 61 ? null : "/";
    case 37:
      return next === 61 ? null : "%";
    default:
      return null;
  }
}

/** acorn's `parseExprOp`: binary operators above `minPrecedence` after `left`. */
function scanBinary(
  source: string,
  left: Expression,
  minPrecedence: number,
  typescript: boolean,
): Expression | null {
  if (isClosing(source.charCodeAt(left.end))) return left;
  const index = skipWhitespace(source, left.end);
  const operator = operatorAt(source, index, typescript);
  if (operator === null) return left;
  const precedence = PRECEDENCE[operator];
  if (precedence <= minPrecedence) return left;
  const logical = operator === "||" || operator === "&&";
  const coalesce = operator === "??";
  const operand = scanUnary(
    source,
    skipWhitespace(source, index + operator.length),
    typescript,
  );
  if (!operand) return null;
  const right = scanBinary(
    source,
    operand,
    coalesce ? 2 : precedence,
    typescript,
  );
  if (!right) return null;
  const node: Expression =
    logical || coalesce
      ? {
          type: "LogicalExpression",
          start: left.start,
          end: right.end,
          left,
          operator: operator as "||" | "&&" | "??",
          right,
        }
      : {
          type: "BinaryExpression",
          start: left.start,
          end: right.end,
          left,
          operator: operator as "==",
          right,
        };
  if (logical || coalesce) {
    const after = operatorAt(
      source,
      skipWhitespace(source, node.end),
      typescript,
    );
    // acorn rejects `??` next to `||` or `&&` without parentheses
    if (coalesce ? after === "||" || after === "&&" : after === "??")
      return null;
  }
  return scanBinary(source, node, minPrecedence, typescript);
}

/** acorn's `parseMaybeConditional`, without assignments. */
function scanConditional(
  source: string,
  from: number,
  typescript: boolean,
): Expression | null {
  const operand = scanUnary(source, from, typescript);
  if (!operand) return null;
  const test = scanBinary(source, operand, -1, typescript);
  if (!test || isClosing(source.charCodeAt(test.end))) return test;
  const question = skipWhitespace(source, test.end);
  if (source.charCodeAt(question) !== 63) return test;
  const next = source.charCodeAt(question + 1);
  if (next === 46 || next === 63) return null;
  const consequent = scanConditional(
    source,
    skipWhitespace(source, question + 1),
    typescript,
  );
  if (!consequent) return null;
  const colon = skipWhitespace(source, consequent.end);
  if (source.charCodeAt(colon) !== 58) return null;
  const alternate = scanConditional(
    source,
    skipWhitespace(source, colon + 1),
    typescript,
  );
  if (!alternate) return null;
  return {
    type: "ConditionalExpression",
    start: test.start,
    end: alternate.end,
    test,
    consequent,
    alternate,
  };
}

/** `}`, `)`, `,` or `:`, which end an operand wherever the fast path reads one. */
function isClosing(code: number): boolean {
  return code === 125 || code === 41 || code === 44 || code === 58;
}

function atTerminator(source: string, from: number): boolean {
  const index = skipWhitespace(source, from);
  if (index >= source.length) return false;
  const code = source.charCodeAt(index);
  return code === 125 || code === 41;
}

/**
 * The expression at `from` if it's made only of what acorn reads the same
 * way every time, names, simple literals, member chains, calls, unary `!`
 * and `-`, binary and logical operators and conditionals, and is followed
 * by `}` or `)`; otherwise `null`, and acorn reads it.
 */
function scanTrivialExpression(
  source: string,
  from: number,
  typescript: boolean,
): Expression | null {
  const node = scanConditional(source, from, typescript);
  return node && atTerminator(source, node.end) ? node : null;
}

function addLocations(node: Node): void {
  node.loc = { start: position(node.start), end: position(node.end) };
  switch (node.type) {
    case "MemberExpression":
      addLocations(node.object);
      addLocations(node.property);
      break;
    case "CallExpression":
      addLocations(node.callee);
      for (const argument of node.arguments) addLocations(argument);
      break;
    case "UnaryExpression":
      addLocations(node.argument);
      break;
    case "BinaryExpression":
    case "LogicalExpression":
      addLocations(node.left);
      addLocations(node.right);
      break;
    case "ConditionalExpression":
      addLocations(node.test);
      addLocations(node.consequent);
      addLocations(node.alternate);
      break;
  }
}

export function readExpression(state: TemplateParserState): Expression {
  const trivial =
    !state.loc || state.lfOnly
      ? scanTrivialExpression(state.source, state.index, state.isTypeScript)
      : null;
  if (trivial) {
    state.index = trivial.end;
    if (state.loc) addLocations(trivial);
    return trivial;
  }

  const { node, end } = parseExpressionAt(state, state.source, state.index);
  state.index = end;
  return node;
}
