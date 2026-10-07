import { readPattern } from "./context";
import {
  const_tag_invalid_expression,
  debug_tag_invalid_arguments,
  expected_tag,
  render_tag_invalid_expression,
} from "./errors";
import { readExpression } from "./expression";
import {
  REGEX_WHITESPACE_THEN_CLOSING_BRACE,
  type TemplateParserState,
} from "./state";
import type {
  Expression,
  Identifier,
  Pattern,
  VariableDeclarator,
} from "./types/estree";
import type { AST } from "./types/svelte-ast";

function isCall(
  expression: Expression,
): expression is AST.RenderTag["expression"] {
  return (
    expression.type === "CallExpression" ||
    (expression.type === "ChainExpression" &&
      expression.expression.type === "CallExpression")
  );
}

export function readSpecialTag(
  state: TemplateParserState,
  start: number,
): void {
  if (state.eat("html")) {
    state.requireWhitespace();
    const expression = readExpression(state);
    state.eatClosingBrace();
    state.append({ type: "HtmlTag", start, end: state.index, expression });
  } else if (state.eat("debug")) {
    const identifiers: Identifier[] = [];
    if (!state.read(REGEX_WHITESPACE_THEN_CLOSING_BRACE)) {
      const expression = readExpression(state);
      const nodes =
        expression.type === "SequenceExpression"
          ? expression.expressions
          : [expression];
      for (const node of nodes) {
        if (node.type !== "Identifier") debug_tag_invalid_arguments(node.start);
        identifiers.push(node);
      }
      state.eatClosingBrace();
    }
    state.append({ type: "DebugTag", start, end: state.index, identifiers });
  } else if (state.eat("const")) {
    state.requireWhitespace();
    const id = readPattern(state);
    state.allowWhitespace();
    state.eat("=", true);
    state.allowWhitespace();

    const expressionStart = state.index;
    const init = readExpression(state);
    const declaratorEnd = state.index;
    if (
      init.type === "SequenceExpression" &&
      !state.source.slice(expressionStart, init.start).includes("(")
    ) {
      const_tag_invalid_expression(init);
    }
    state.eatClosingBrace();

    const declarator: VariableDeclarator & { id: Pattern; init: Expression } = {
      type: "VariableDeclarator",
      id,
      init,
      start: id.start,
      end: declaratorEnd,
    };

    state.append({
      type: "ConstTag",
      start,
      end: state.index,
      declaration: {
        type: "VariableDeclaration",
        kind: "const",
        declarations: [declarator],
        start: start + 2,
        end: state.index - 1,
      },
    });
  } else if (state.eat("render")) {
    state.requireWhitespace();
    const expression = readExpression(state);
    if (!isCall(expression)) render_tag_invalid_expression(expression);
    state.eatClosingBrace();
    state.append({
      type: "RenderTag",
      start,
      end: state.index,
      expression,
    });
  } else {
    expected_tag(state.index);
  }
}
