import { parseExpressionAt } from "./acorn-bridge";
import { matchBracket } from "./bracket";
import { readPattern } from "./context";
import {
  block_duplicate_clause,
  block_invalid_continuation_placement,
  block_invalid_elseif,
  block_unexpected_close,
  expected_block_type,
  expected_identifier,
  expected_token,
} from "./errors";
import { readExpression } from "./expression";
import { assertType, mapChildren, type TSAsExpression } from "./nodes";
import { ParseError } from "./parse-error";
import type { TemplateParserState } from "./state";
import type { Expression, Node, Pattern } from "./types/estree";
import type { AST } from "./types/svelte-ast";

const REGEX_WHITESPACE_THEN_CLOSING_BRACE = /\s*}/y;

const CLOSING_WORDS: Partial<Record<string, string>> = {
  IfBlock: "if",
  EachBlock: "each",
  KeyBlock: "key",
  AwaitBlock: "await",
  SnippetBlock: "snippet",
};

const fragment = (): AST.Fragment => ({ type: "Fragment", nodes: [] });

export function openBlock(state: TemplateParserState, start: number): void {
  if (state.eat("if")) {
    state.requireWhitespace();
    const test = readExpression(state);
    state.eatClosingBrace();
    const consequent = fragment();
    state.open(
      {
        type: "IfBlock",
        elseif: false,
        start,
        end: -1,
        test,
        consequent,
        alternate: null,
      },
      consequent,
    );
  } else if (state.eat("each")) {
    openEach(state, start);
  } else if (state.eat("await")) {
    state.requireWhitespace();
    const expression = readExpression(state);
    state.allowWhitespace();

    const block: AST.AwaitBlock = {
      type: "AwaitBlock",
      start,
      end: -1,
      expression,
      value: null,
      error: null,
      pending: null,
      // biome-ignore lint/suspicious/noThenProperty: svelte's own AwaitBlock field name
      then: null,
      catch: null,
    };
    const body = fragment();
    if (state.eat("then")) {
      block.value = readAwaitBinding(state);
      // biome-ignore lint/suspicious/noThenProperty: svelte's own AwaitBlock field name
      block.then = body;
    } else if (state.eat("catch")) {
      block.error = readAwaitBinding(state);
      block.catch = body;
    } else {
      block.pending = body;
    }
    state.eat("}", true);
    state.open(block, body);
  } else if (state.eat("key")) {
    state.requireWhitespace();
    const expression = readExpression(state);
    state.eatClosingBrace();
    const body = fragment();
    state.open(
      { type: "KeyBlock", start, end: -1, expression, fragment: body },
      body,
    );
  } else if (state.eat("snippet")) {
    openSnippet(state, start);
  } else {
    expected_block_type(state.index);
  }
}

function readAwaitBinding(state: TemplateParserState): Pattern | null {
  if (state.matchRegex(REGEX_WHITESPACE_THEN_CLOSING_BRACE)) {
    state.allowWhitespace();
    return null;
  }
  state.requireWhitespace();
  const pattern = readPattern(state);
  state.allowWhitespace();
  return pattern;
}

/**
 * Without `as`, acorn reads `{#each items as item}` as `items as item`, a
 * type assertion. Unwraps the one ending where the expression does, and
 * returns it so the caller can rewind to its `as`.
 */
function stripAssertion(root: Expression): {
  expression: Expression;
  assertion: TSAsExpression | null;
} {
  const found: { assertion: TSAsExpression | null } = { assertion: null };
  let end = root.end;

  const unwrap = (node: Node): Node => {
    if (node.type === "TSAsExpression" && node.end === root.end) {
      found.assertion = node;
      end = node.expression.end;
      return node.expression;
    }
    mapChildren(node, unwrap);
    return node;
  };

  let expression = root;
  if (root.type === "TSAsExpression") {
    found.assertion = root;
    expression = root.expression;
    end = expression.end;
  } else {
    mapChildren(root, unwrap);
  }
  expression.end = end;
  return { expression, assertion: found.assertion };
}

function openEach(state: TemplateParserState, start: number): void {
  state.requireWhitespace();

  const source = state.source;
  let expression: Expression | undefined;
  while (!expression) {
    try {
      expression = readExpression(state);
    } catch (error) {
      const position = error instanceof ParseError ? error.position : undefined;
      let end = (position?.[0] ?? start) - 2;
      while (end > start && state.source.slice(end, end + 2) !== "as") end -= 1;
      if (end <= start) {
        state.source = source;
        throw error;
      }
      state.source = source.slice(0, end);
    }
  }
  state.source = source;

  state.allowWhitespace();

  if (!state.match("as")) {
    if (expression.type === "SequenceExpression") {
      expression = expression.expressions[0];
    }

    const stripped = stripAssertion(expression);
    expression = stripped.expression;

    if (stripped.assertion) {
      let rewind = stripped.assertion.typeAnnotation.start - 2;
      while (state.source.slice(rewind, rewind + 2) !== "as") rewind -= 1;
      state.index = rewind;
    }
  }

  let context: Pattern | null = null;
  let index: string | undefined;
  let key: Expression | undefined;

  if (state.eat("as")) {
    state.requireWhitespace();
    context = readPattern(state);
  } else {
    state.index = expression.end;
  }

  state.allowWhitespace();

  if (state.eat(",")) {
    state.allowWhitespace();
    index = state.readIdentifierName().name;
    if (!index) expected_identifier(state.index);
    state.allowWhitespace();
  }

  if (state.eat("(")) {
    state.allowWhitespace();
    key = readExpression(state);
    state.allowWhitespace();
    state.eat(")", true);
    state.allowWhitespace();
  }

  state.eat("}", true);

  const body = fragment();
  state.open(
    {
      type: "EachBlock",
      start,
      end: -1,
      expression,
      body,
      context,
      index,
      key,
    },
    body,
  );
}

function openSnippet(state: TemplateParserState, start: number): void {
  state.requireWhitespace();
  const id = state.readIdentifierName();
  if (id.name === "") expected_identifier(state.index);
  state.allowWhitespace();

  const paramsStart = state.index;
  let typeParams: string | undefined;

  if (state.isTypeScript && state.match("<")) {
    const end = matchBracket(state.source, paramsStart, { "<": ">" });
    typeParams = state.source.slice(paramsStart + 1, end - 1);
    state.index = end;
  }

  state.allowWhitespace();
  state.eat("(", true);

  let parentheses = 1;
  while (
    state.index < state.source.length &&
    (!state.match(")") || parentheses !== 1)
  ) {
    if (state.match("(")) parentheses++;
    if (state.match(")")) parentheses--;
    state.index += 1;
  }
  state.eat(")", true);

  const { node } = parseExpressionAt(
    state,
    `${state.source.slice(0, state.index)} => {}`,
    paramsStart,
    true,
  );
  assertType(node, "ArrowFunctionExpression");
  const { params: parameters } = node;

  state.eatClosingBrace();

  const body = fragment();
  state.open(
    {
      type: "SnippetBlock",
      start,
      end: -1,
      expression: id,
      typeParams,
      parameters,
      body,
    },
    body,
  );
}

export function nextBlockClause(
  state: TemplateParserState,
  tagStart: number,
): void {
  const start = state.index - 1;
  const block = state.current();

  if (block.type === "IfBlock") {
    if (!state.eat("else")) expected_token(start, "{:else} or {:else if}");
    if (state.eat("if")) block_invalid_elseif(start);

    state.allowWhitespace();
    block.alternate = fragment();
    state.setFragment(block.alternate);

    if (state.eat("if")) {
      state.requireWhitespace();
      const test = readExpression(state);
      state.eatClosingBrace();
      const consequent = fragment();
      state.open(
        {
          start: tagStart,
          end: -1,
          type: "IfBlock",
          elseif: true,
          test,
          consequent,
          alternate: null,
        },
        consequent,
      );
    } else {
      state.eatClosingBrace();
    }
  } else if (block.type === "EachBlock") {
    if (!state.eat("else")) expected_token(start, "{:else}");
    state.eatClosingBrace();
    block.fallback = fragment();
    state.setFragment(block.fallback);
  } else if (block.type === "AwaitBlock") {
    let clause: "then" | "catch";
    if (state.eat("then")) clause = "then";
    else if (state.eat("catch")) clause = "catch";
    else expected_token(start, "{:then ...} or {:catch ...}");
    if (block[clause]) block_duplicate_clause(start, `{:${clause}}`);
    if (!state.eat("}")) {
      state.requireWhitespace();
      const pattern = readPattern(state);
      if (clause === "then") block.value = pattern;
      else block.error = pattern;
      state.eatClosingBrace();
    }
    const body = fragment();
    block[clause] = body;
    state.setFragment(body);
  } else {
    block_invalid_continuation_placement(start);
  }
}

export function closeBlock(state: TemplateParserState): void {
  let block = state.current();
  const word = CLOSING_WORDS[block.type];
  if (!word) block_unexpected_close(state.index - 1);
  state.eat(word, true);
  state.eatClosingBrace();

  while (block.type === "IfBlock" && block.elseif) {
    block.end = state.index;
    state.close();
    block = state.current();
  }
  block.end = state.index;
  state.close();
}
