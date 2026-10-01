import { parseStatementAt } from "./acorn-bridge";
import { closeBlock, nextBlockClause, openBlock } from "./blocks";
import { declaration_tag_invalid_type } from "./errors";
import { readExpression } from "./expression";
import { readSpecialTag } from "./special-tags";
import type { TemplateParserState } from "./state";
import type { VariableDeclaration } from "./types/estree";

const REGEX_UNSUPPORTED_DECLARATION = /(?:var|interface|enum)\b/y;
const REGEX_MAYBE_DECLARATION = /(?:let|const|type)\b/y;

export function readTag(state: TemplateParserState): void {
  const start = state.index;
  state.index += 1;
  state.allowWhitespace();

  if (state.eat("#")) openBlock(state, start);
  else if (state.eat(":")) nextBlockClause(state, start);
  else if (state.eat("@")) readSpecialTag(state, start);
  else if (state.match("/") && !state.match("/*") && !state.match("//")) {
    state.index += 1;
    closeBlock(state);
  } else if (!readDeclarationTag(state, start)) {
    const expression = readExpression(state);
    state.eatClosingBrace();
    state.append({
      type: "ExpressionTag",
      start,
      end: state.index,
      expression,
    });
  }
}

function readDeclarationTag(
  state: TemplateParserState,
  tagStart: number,
): boolean {
  const start = state.index;

  const unsupported = state.matchRegex(REGEX_UNSUPPORTED_DECLARATION);
  if (unsupported) {
    declaration_tag_invalid_type({ start, end: start + unsupported.length });
  }
  if (!state.matchRegex(REGEX_MAYBE_DECLARATION)) return false;

  const commentsBefore = state.root.comments.length;
  const statement = parseStatementAt(state, state.source, start) as unknown as {
    type: string;
    kind?: string;
    start: number;
    end: number;
  };

  if (statement.type === "ExpressionStatement") {
    state.root.comments.length = commentsBefore;
    return false;
  }
  if (statement.kind !== "let" && statement.kind !== "const") {
    declaration_tag_invalid_type(statement);
  }

  state.index = statement.end;
  state.eatClosingBrace();
  state.append({
    type: "DeclarationTag",
    start: tagStart,
    end: state.index,
    declaration: statement as unknown as VariableDeclaration,
  });
  return true;
}
