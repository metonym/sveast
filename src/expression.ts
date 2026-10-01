import { parseExpressionAt } from "./acorn-bridge";
import { position } from "./locator";
import {
  RESERVED_WORDS,
  scanIdentifier,
  skipWhitespace,
  type TemplateParserState,
} from "./state";
import type {
  Expression,
  Identifier,
  Node,
  SimpleLiteral,
} from "./types/estree";

const OPERATORS = ["===", "!==", "==", "!=", "&&", "||", "??"] as const;

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

function scanAtom(source: string, from: number): Expression | null {
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

function scanOperand(source: string, from: number): Expression | null {
  if (source.charCodeAt(from) !== 33 || source.charCodeAt(from + 1) === 61) {
    return scanAtom(source, from);
  }
  const argument = scanOperand(source, skipWhitespace(source, from + 1));
  if (!argument) return null;
  return {
    type: "UnaryExpression",
    start: from,
    end: argument.end,
    operator: "!",
    prefix: true,
    argument,
  };
}

function atTerminator(source: string, from: number): boolean {
  const index = skipWhitespace(source, from);
  if (index >= source.length) return false;
  const code = source.charCodeAt(index);
  return code === 125 || code === 41;
}

function scanTrivialExpression(
  source: string,
  from: number,
): Expression | null {
  const left = scanOperand(source, from);
  if (!left || atTerminator(source, left.end)) return left;

  const operatorStart = skipWhitespace(source, left.end);
  const operator = OPERATORS.find((op) => source.startsWith(op, operatorStart));
  if (!operator) return null;

  const right = scanOperand(
    source,
    skipWhitespace(source, operatorStart + operator.length),
  );
  if (!right || !atTerminator(source, right.end)) return null;

  const { end } = right;
  if (operator === "&&" || operator === "||" || operator === "??") {
    return {
      type: "LogicalExpression",
      start: left.start,
      end,
      left,
      operator,
      right,
    };
  }
  return {
    type: "BinaryExpression",
    start: left.start,
    end,
    left,
    operator,
    right,
  };
}

function addLocations(node: Node): void {
  node.loc = { start: position(node.start), end: position(node.end) };
  if (node.type === "MemberExpression") {
    addLocations(node.object);
    addLocations(node.property);
  } else if (node.type === "UnaryExpression") {
    addLocations(node.argument);
  } else if (
    node.type === "BinaryExpression" ||
    node.type === "LogicalExpression"
  ) {
    addLocations(node.left);
    addLocations(node.right);
  }
}

export function readExpression(state: TemplateParserState): Expression {
  const trivial =
    !state.loc || state.lfOnly
      ? scanTrivialExpression(state.source, state.index)
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
