import {
  css_empty_declaration,
  css_expected_identifier,
  css_selector_invalid,
  unexpected_eof,
} from "./errors";
import { isWhitespace, type TemplateParserState } from "./state";
import type { AST } from "./types/svelte-ast";

const REGEX_NTH_OF =
  /(even|odd|\+?(\d+|\d*n(\s*[+-]\s*\d+)?)|-\d*n(\s*\+\s*\d+))((?=\s*[,)])|\s+of(\s+|(?=[.#[*:&])))/y;
const REGEX_PERCENTAGE = /\d+(\.\d+)?%/y;
const REGEX_UNICODE_SEQUENCE = /\\[0-9a-fA-F]{1,6}(\r\n|\s)?/y;
const REGEX_CLOSING_STYLE_TAG_END = /\s*>/y;

const NONE = -1;
const DOUBLE_QUOTE = 34;
const HASH = 35;
const DOLLAR = 36;
const AMPERSAND = 38;
const SINGLE_QUOTE = 39;
const OPEN_PAREN = 40;
const CLOSE_PAREN = 41;
const ASTERISK = 42;
const PLUS = 43;
const HYPHEN = 45;
const DOT = 46;
const SLASH = 47;
const COLON = 58;
const SEMICOLON = 59;
const LESS_THAN = 60;
const EQUALS = 61;
const GREATER_THAN = 62;
const OPEN_BRACKET = 91;
const BACKSLASH = 92;
const CLOSE_BRACKET = 93;
const CARET = 94;
const OPEN_BRACE = 123;
const PIPE = 124;
const CLOSE_BRACE = 125;
const TILDE = 126;

type BodyNode = AST.CSS.Rule | AST.CSS.Atrule;
type BlockNode = AST.CSS.Declaration | AST.CSS.Rule | AST.CSS.Atrule;

let comments: AST.CSS.CSSComment[] = [];

export function readStyle(
  state: TemplateParserState,
  start: number,
  attributes: AST.Attribute[],
): AST.CSS.StyleSheet {
  const contentStart = state.index;
  comments = [];
  const children = state.css ? readBody(state) : skipBody(state);
  const contentEnd = state.index;

  state.eat("</style", true);
  state.read(REGEX_CLOSING_STYLE_TAG_END);

  return {
    type: "StyleSheet",
    start,
    end: state.index,
    attributes,
    children,
    comments,
    content: {
      start: contentStart,
      end: contentEnd,
      styles: state.source.slice(contentStart, contentEnd),
      comment: null,
    },
  };
}

function skipBody(state: TemplateParserState): BodyNode[] {
  const source = state.source;
  let index = state.index;
  while (index < source.length) {
    const code = source.charCodeAt(index);
    if (code === SLASH && source.charCodeAt(index + 1) === ASTERISK) {
      const end = source.indexOf("*/", index + 2);
      index = end === -1 ? source.length : end + 2;
    } else if (code === DOUBLE_QUOTE || code === SINGLE_QUOTE) {
      index++;
      while (index < source.length) {
        const next = source.charCodeAt(index);
        if (next === code || next === 10) break;
        index += next === BACKSLASH ? 2 : 1;
      }
      index++;
    } else if (code === LESS_THAN && source.startsWith("</style", index)) {
      break;
    } else {
      index++;
    }
  }
  state.index = Math.min(index, source.length);
  return [];
}

function readBody(state: TemplateParserState): BodyNode[] {
  const children: BodyNode[] = [];

  for (;;) {
    allowCommentOrWhitespace(state, true);
    if (state.match("</style") || state.index >= state.source.length) break;
    children.push(state.match("@") ? readAtRule(state) : readRule(state));
  }

  return children;
}

function readAtRule(state: TemplateParserState): AST.CSS.Atrule {
  const start = state.index;
  state.eat("@", true);

  const name = readIdentifier(state);
  const prelude = readValue(state, true);

  let block: AST.CSS.Block | null = null;

  if (state.match("{")) {
    block = readBlock(state);
  } else {
    state.eat(";", true);
  }

  return {
    type: "Atrule",
    start,
    end: state.index,
    name,
    prelude,
    block,
  };
}

function readRule(state: TemplateParserState): AST.CSS.Rule {
  const start = state.index;

  return {
    type: "Rule",
    prelude: readSelectorList(state, false),
    block: readBlock(state),
    start,
    end: state.index,
  };
}

function readSelectorList(
  state: TemplateParserState,
  insidePseudoClass: boolean,
): AST.CSS.SelectorList {
  const children: AST.CSS.ComplexSelector[] = [];

  allowCommentOrWhitespace(state, true);

  const start = state.index;

  while (state.index < state.source.length) {
    children.push(readSelector(state, insidePseudoClass));

    const end = state.index;

    allowCommentOrWhitespace(state, true);

    if (state.match(insidePseudoClass ? ")" : "{")) {
      return { type: "SelectorList", start, end, children };
    }

    state.eat(",", true);
    allowCommentOrWhitespace(state, true);
  }

  return unexpected_eof(state.source.length);
}

function createRelativeSelector(
  combinator: AST.CSS.Combinator | null,
  start: number,
): AST.CSS.RelativeSelector {
  return {
    type: "RelativeSelector",
    combinator,
    selectors: [],
    start,
    end: -1,
  };
}

function readSelector(
  state: TemplateParserState,
  insidePseudoClass: boolean,
): AST.CSS.ComplexSelector {
  const source = state.source;
  const listStart = state.index;
  const children: AST.CSS.RelativeSelector[] = [];

  let relativeSelector = createRelativeSelector(null, state.index);

  while (state.index < source.length) {
    const start = state.index;
    const code = source.charCodeAt(start);
    const selectors = relativeSelector.selectors;

    if (code === AMPERSAND) {
      state.index++;
      selectors.push({
        type: "NestingSelector",
        name: "&",
        start,
        end: state.index,
      });
    } else if (code === ASTERISK) {
      state.index++;
      selectors.push(readTypeSelectorRest(state, start, "*"));
    } else if (code === HASH) {
      state.index++;
      selectors.push({
        type: "IdSelector",
        name: readIdentifier(state),
        start,
        end: state.index,
      });
    } else if (code === DOT) {
      state.index++;
      selectors.push({
        type: "ClassSelector",
        name: readIdentifier(state),
        start,
        end: state.index,
      });
    } else if (code === COLON) {
      const isElement = source.charCodeAt(start + 1) === COLON;
      state.index += isElement ? 2 : 1;
      const name = readIdentifier(state);
      let args: AST.CSS.SelectorList | null = null;

      if (state.eat("(")) {
        args = readSelectorList(state, true);
        state.eat(")", true);
      }

      if (isElement) {
        selectors.push({
          type: "PseudoElementSelector",
          name,
          start,
          end: state.index,
          ...(args && { args }),
        });
      } else {
        selectors.push({
          type: "PseudoClassSelector",
          name,
          args,
          start,
          end: state.index,
        });
      }
    } else if (code === OPEN_BRACKET) {
      state.index++;
      selectors.push(readAttributeSelector(state, start));
    } else {
      const nth = insidePseudoClass ? state.read(REGEX_NTH_OF) : null;
      const percentage =
        !nth && isDigit(code) ? state.read(REGEX_PERCENTAGE) : null;
      if (nth) {
        selectors.push({ type: "Nth", value: nth, start, end: state.index });
      } else if (percentage) {
        selectors.push({
          type: "Percentage",
          value: percentage,
          start,
          end: state.index,
        });
      } else if (combinatorLength(source, start) === 0) {
        const name = readIdentifier(state);
        selectors.push(readTypeSelectorRest(state, start, name));
      }
    }

    const index = state.index;
    allowCommentOrWhitespace(state, false);
    const end = state.match(",") || state.match(insidePseudoClass ? ")" : "{");
    state.index = index;

    if (end) {
      relativeSelector.end = index;
      children.push(relativeSelector);

      return {
        type: "ComplexSelector",
        start: listStart,
        end: index,
        children,
      };
    }

    const combinator = readCombinator(state);

    if (combinator) {
      if (relativeSelector.selectors.length > 0) {
        relativeSelector.end = index;
        children.push(relativeSelector);
      }

      relativeSelector = createRelativeSelector(combinator, combinator.start);

      state.allowWhitespace();

      if (state.match(",") || state.match(insidePseudoClass ? ")" : "{")) {
        css_selector_invalid(state.index);
      }
    }
  }

  return unexpected_eof(source.length);
}

function readTypeSelectorRest(
  state: TemplateParserState,
  start: number,
  first: string,
): AST.CSS.TypeSelector {
  let name = first;
  let namespace: string | undefined;

  if (state.eat("|")) {
    namespace = name;
    name = state.eat("*") ? "*" : readIdentifier(state);
  }

  return {
    type: "TypeSelector",
    name,
    ...(namespace !== undefined && { namespace }),
    start,
    end: state.index,
  };
}

function readAttributeSelector(
  state: TemplateParserState,
  start: number,
): AST.CSS.AttributeSelector {
  const source = state.source;
  state.allowWhitespace();
  const name = readIdentifier(state);
  state.allowWhitespace();

  let value: string | null = null;
  let matcher: string | null = null;

  const code = source.charCodeAt(state.index);
  if (code === EQUALS) {
    matcher = "=";
  } else if (
    (code === TILDE ||
      code === CARET ||
      code === DOLLAR ||
      code === ASTERISK ||
      code === PIPE) &&
    source.charCodeAt(state.index + 1) === EQUALS
  ) {
    matcher = source.slice(state.index, state.index + 2);
  }

  if (matcher) {
    state.index += matcher.length;
    state.allowWhitespace();
    value = readAttributeValue(state);
  }

  state.allowWhitespace();

  const flagsStart = state.index;
  while (isAsciiLetter(source.charCodeAt(state.index))) state.index++;
  const flags =
    state.index > flagsStart ? source.slice(flagsStart, state.index) : null;

  state.allowWhitespace();
  state.eat("]", true);

  return {
    type: "AttributeSelector",
    start,
    end: state.index,
    name,
    matcher,
    value,
    flags,
  };
}

function combinatorLength(source: string, index: number): 0 | 1 | 2 {
  const code = source.charCodeAt(index);
  if (code === PLUS || code === TILDE || code === GREATER_THAN) return 1;
  if (code === PIPE && source.charCodeAt(index + 1) === PIPE) return 2;
  return 0;
}

function readCombinator(state: TemplateParserState): AST.CSS.Combinator | null {
  const start = state.index;
  state.allowWhitespace();

  const index = state.index;
  const length = combinatorLength(state.source, index);

  if (length > 0) {
    state.index += length;
    const end = state.index;
    state.allowWhitespace();

    return {
      type: "Combinator",
      name: state.source.slice(index, end),
      start: index,
      end,
    };
  }

  if (state.index !== start) {
    return { type: "Combinator", name: " ", start, end: state.index };
  }

  return null;
}

function readBlock(state: TemplateParserState): AST.CSS.Block {
  const start = state.index;

  state.eat("{", true);

  const children: BlockNode[] = [];

  while (state.index < state.source.length) {
    allowCommentOrWhitespace(state, true);

    if (state.match("}")) break;
    children.push(readBlockItem(state));
  }

  state.eat("}", true);

  return { type: "Block", start, end: state.index, children };
}

function readBlockItem(state: TemplateParserState): BlockNode {
  if (state.match("@")) return readAtRule(state);

  const start = state.index;
  readValue(state, false);
  const code = state.source.charCodeAt(state.index);
  state.index = start;

  return code === OPEN_BRACE ? readRule(state) : readDeclaration(state);
}

function readDeclaration(state: TemplateParserState): AST.CSS.Declaration {
  const source = state.source;
  const start = state.index;

  if (start >= source.length) unexpected_eof(source.length);
  let propertyEnd = start;
  while (propertyEnd < source.length) {
    const code = source.charCodeAt(propertyEnd);
    if (code === COLON || isWhitespace(code)) break;
    propertyEnd++;
  }
  const property = source.slice(start, propertyEnd);
  state.index = propertyEnd;

  state.allowWhitespace();
  state.eat(":");
  const index = state.index;
  state.allowWhitespace();

  const value = readValue(state, true);

  if (!value && !property.startsWith("--")) {
    css_empty_declaration({ start, end: index });
  }

  const end = state.index;

  if (!state.match("}")) state.eat(";", true);

  return { type: "Declaration", start, end, property, value };
}

function readValue(state: TemplateParserState, capture: boolean): string {
  const source = state.source;
  const length = source.length;
  let value = "";
  let segmentStart = state.index;
  let valueComments: AST.CSS.CSSComment[] | null = null;
  let escaped = false;
  let inUrl = false;
  let quoteMark = NONE;
  let i = state.index;

  while (i < length) {
    const code = source.charCodeAt(i);

    if (escaped) {
      escaped = false;
      i++;
      continue;
    }
    if (code === BACKSLASH) {
      escaped = true;
      i++;
      continue;
    }

    if (code === quoteMark) {
      quoteMark = NONE;
    } else if (code === CLOSE_PAREN) {
      inUrl = false;
    } else if (
      quoteMark === NONE &&
      (code === DOUBLE_QUOTE || code === SINGLE_QUOTE)
    ) {
      quoteMark = code;
    } else if (code === OPEN_PAREN) {
      if (endsWithUrl(source, value, segmentStart, i)) inUrl = true;
    } else if (
      (code === SEMICOLON || code === OPEN_BRACE || code === CLOSE_BRACE) &&
      !inUrl &&
      quoteMark === NONE
    ) {
      state.index = i;
      if (!capture) return "";

      value += source.slice(segmentStart, i);
      if (valueComments) {
        const leadingWhitespace = value.length - value.trimStart().length;
        for (const comment of valueComments) {
          comment.position = Math.max(
            0,
            (comment.position ?? 0) - leadingWhitespace,
          );
        }
      }
      return value.trim();
    } else if (
      code === SLASH &&
      !inUrl &&
      quoteMark === NONE &&
      source.charCodeAt(i + 1) === ASTERISK
    ) {
      value += source.slice(segmentStart, i);
      state.index = i;
      const comment = readComment(state);
      if (capture) {
        comment.position = value.length;
        comments.push(comment);
        valueComments ??= [];
        valueComments.push(comment);
      }
      i = state.index;
      segmentStart = i;
      continue;
    }

    i++;
  }

  state.index = length;
  return unexpected_eof(length);
}

function endsWithUrl(
  source: string,
  value: string,
  segmentStart: number,
  end: number,
): boolean {
  if (end - segmentStart >= 3) {
    return (
      source.charCodeAt(end - 3) === 117 &&
      source.charCodeAt(end - 2) === 114 &&
      source.charCodeAt(end - 1) === 108
    );
  }
  return (value + source.slice(segmentStart, end)).endsWith("url");
}

function readAttributeValue(state: TemplateParserState): string {
  const source = state.source;
  let quoteMark = NONE;
  if (state.eat('"')) quoteMark = DOUBLE_QUOTE;
  else if (state.eat("'")) quoteMark = SINGLE_QUOTE;
  const start = state.index;
  let escaped = false;
  let i = start;

  while (i < source.length) {
    const code = source.charCodeAt(i);
    if (escaped) {
      escaped = false;
    } else if (code === BACKSLASH) {
      escaped = true;
    } else if (
      quoteMark === NONE
        ? code === CLOSE_BRACKET || isWhitespace(code)
        : code === quoteMark
    ) {
      state.index = quoteMark === NONE ? i : i + 1;
      return source.slice(start, i).trim();
    }
    i++;
  }

  state.index = i;
  return unexpected_eof(source.length);
}

function readIdentifier(state: TemplateParserState): string {
  const source = state.source;
  const start = state.index;

  const first = source.charCodeAt(start);
  if (
    isDigit(first) ||
    (first === HYPHEN && isDigit(source.charCodeAt(start + 1)))
  ) {
    css_expected_identifier(start);
  }

  let identifier = "";
  let runStart = start;
  let i = start;

  while (i < source.length) {
    const code = source.charCodeAt(i);
    if (code === BACKSLASH) {
      identifier += source.slice(runStart, i);
      state.index = i;
      const sequence = state.matchRegex(REGEX_UNICODE_SEQUENCE);
      if (sequence) {
        const character = String.fromCodePoint(
          Number.parseInt(sequence.slice(1), 16),
        );
        identifier += character === "\\" ? "\\\\" : character;
        i += sequence.length;
      } else {
        identifier += `\\${source[i + 1]}`;
        i += 2;
      }
      runStart = i;
    } else if (code >= 160 || isIdentifierChar(code)) {
      i++;
    } else {
      break;
    }
  }

  identifier += source.slice(runStart, i);
  state.index = i;

  if (identifier === "") css_expected_identifier(start);

  return identifier;
}

function allowCommentOrWhitespace(
  state: TemplateParserState,
  capture: boolean,
): void {
  const source = state.source;
  state.allowWhitespace();

  for (;;) {
    const code = source.charCodeAt(state.index);
    if (code === SLASH && source.charCodeAt(state.index + 1) === ASTERISK) {
      const comment = readComment(state);
      if (capture) comments.push(comment);
    } else if (code === LESS_THAN && state.eat("<!--")) {
      state.readUntil("-->");
      state.eat("-->", true);
    } else {
      break;
    }

    state.allowWhitespace();
  }
}

function readComment(state: TemplateParserState): AST.CSS.CSSComment {
  const start = state.index;
  state.eat("/*", true);
  const value = state.readUntil("*/");
  state.eat("*/", true);

  return { type: "CSSComment", value, start, end: state.index };
}

function isDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}

function isAsciiLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isIdentifierChar(code: number): boolean {
  return isAsciiLetter(code) || isDigit(code) || code === 95 || code === 45;
}
