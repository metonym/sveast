import { readPattern } from "./context";
import {
  const_tag_invalid_expression,
  debug_tag_invalid_arguments,
  expected_tag,
  render_tag_invalid_expression,
} from "./errors";
import { readExpression } from "./expression";
import type { TemplateParserState } from "./state";
import type {
  Identifier,
  SimpleCallExpression,
  VariableDeclarator,
} from "./types/estree";
import type { AST } from "./types/svelte-ast";

const REGEX_WHITESPACE_THEN_CLOSING_BRACE = /\s*}/y;

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
    let identifiers: Identifier[] = [];
    if (!state.read(REGEX_WHITESPACE_THEN_CLOSING_BRACE)) {
      const expression = readExpression(state);
      identifiers =
        expression.type === "SequenceExpression"
          ? (expression.expressions as Identifier[])
          : [expression as Identifier];
      for (const node of identifiers) {
        if (node.type !== "Identifier") {
          debug_tag_invalid_arguments(
            (node as unknown as { start: number }).start,
          );
        }
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
      !state.source
        .substring(expressionStart, (init as { start?: number }).start)
        .includes("(")
    ) {
      const_tag_invalid_expression(init as never);
    }
    state.eatClosingBrace();

    const declarator = {
      type: "VariableDeclarator",
      id,
      init,
      start: (id as unknown as { start: number }).start,
      end: declaratorEnd,
    } as unknown as VariableDeclarator;

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
      } as unknown as AST.ConstTag["declaration"],
    });
  } else if (state.eat("render")) {
    state.requireWhitespace();
    const expression = readExpression(state);
    if (
      expression.type !== "CallExpression" &&
      (expression.type !== "ChainExpression" ||
        expression.expression.type !== "CallExpression")
    ) {
      render_tag_invalid_expression(expression as never);
    }
    state.eatClosingBrace();
    state.append({
      type: "RenderTag",
      start,
      end: state.index,
      expression: expression as unknown as SimpleCallExpression,
    });
  } else {
    expected_tag(state.index);
  }
}
