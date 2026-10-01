import { type AnyNode, parseExpressionAt } from "./acorn-bridge";
import { matchBracket } from "./bracket";
import { expected_pattern } from "./errors";
import type { TemplateParserState } from "./state";
import type { Pattern } from "./types/estree";

const REGEX_OPTIONAL_PARAM_COLON = /\?\s*:/g;

export function readPattern(state: TemplateParserState): Pattern {
  const start = state.index;
  const id = state.readIdentifierName();

  if (id.name !== "") {
    const typeAnnotation = readTypeAnnotation(state);
    return { ...id, typeAnnotation } as unknown as Pattern;
  }

  const char = state.source[state.index];
  if (char !== "{" && char !== "[") expected_pattern(state.index);

  state.index = matchBracket(state.source, start);

  const { node } = parseExpressionAt(
    state,
    `${state.source.slice(0, state.index)} = 1`,
    start,
  );
  const pattern = node.left as AnyNode;
  const typeAnnotation = readTypeAnnotation(state);
  pattern.typeAnnotation = typeAnnotation;
  if (typeAnnotation) pattern.end = typeAnnotation.end;
  return pattern as unknown as Pattern;
}

function readTypeAnnotation(state: TemplateParserState): AnyNode | undefined {
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
    let b = (expression.right as AnyNode).start;
    while (synthetic[b] !== "=") b -= 1;
    expression = parseExpressionAt(state, synthetic.slice(0, b), a).node;
  }
  if (expression.type === "SequenceExpression") {
    expression = (expression.expressions as AnyNode[])[0];
  }

  state.index = expression.end;
  return {
    type: "TSTypeAnnotation",
    start,
    end: state.index,
    typeAnnotation: expression.typeAnnotation,
  };
}
