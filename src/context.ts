import { parseExpressionAt, parsePatternAt } from "./acorn-bridge";
import { matchBracket } from "./bracket";
import { expected_pattern } from "./errors";
import { assertType } from "./nodes";
import type { TemplateParserState } from "./state";
import type { AssignmentExpression, Pattern } from "./types/estree";
import type { TSTypeAnnotation } from "./types/typescript";

const REGEX_OPTIONAL_PARAM_COLON = /\?\s*:/g;

export function readPattern(state: TemplateParserState): Pattern {
  const start = state.index;
  const id = state.readIdentifierName();

  if (id.name !== "")
    return { ...id, typeAnnotation: readTypeAnnotation(state) };

  const char = state.source[state.index];
  if (char !== "{" && char !== "[") expected_pattern(state.index);

  state.index = matchBracket(state.source, start);

  const pattern =
    parsePatternAt(state, state.source.slice(0, state.index), start) ??
    assignedPattern(state, start);
  assertType(pattern, "ObjectPattern", "ArrayPattern");
  const typeAnnotation = readTypeAnnotation(state);
  pattern.typeAnnotation = typeAnnotation;
  if (typeAnnotation) pattern.end = typeAnnotation.end;
  return pattern;
}

function assignedPattern(
  state: TemplateParserState,
  start: number,
): AssignmentExpression["left"] {
  const { node } = parseExpressionAt(
    state,
    `${state.source.slice(0, state.index)} = 1`,
    start,
  );
  assertType(node, "AssignmentExpression");
  return node.left;
}

function readTypeAnnotation(
  state: TemplateParserState,
): TSTypeAnnotation | undefined {
  const start = state.index;
  state.allowWhitespace();

  if (!state.eat(":")) {
    state.index = start;
    return undefined;
  }

  const insert = "_ as ";
  const a = state.index - insert.length;
  const synthetic =
    state.source.slice(0, a) +
    insert +
    state.source.slice(state.index).replace(REGEX_OPTIONAL_PARAM_COLON, ":");

  let expression = parseExpressionAt(state, synthetic, a).node;
  if (expression.type === "AssignmentExpression") {
    let b = expression.right.start;
    while (synthetic[b] !== "=") b -= 1;
    expression = parseExpressionAt(state, synthetic.slice(0, b), a).node;
  }
  if (expression.type === "SequenceExpression") {
    expression = expression.expressions[0];
  }
  assertType(expression, "TSAsExpression");

  state.index = expression.end;
  return {
    type: "TSTypeAnnotation",
    start,
    end: state.index,
    typeAnnotation: expression.typeAnnotation,
  };
}
