import { closingTagOmitted } from "./autoclosing";
import {
  attribute_duplicate,
  attribute_empty_shorthand,
  block_invalid_placement,
  directive_invalid_value,
  directive_missing_name,
  element_invalid_closing_tag,
  element_invalid_closing_tag_autoclosed,
  expected_attribute_value,
  expected_token,
  script_duplicate,
  style_duplicate,
  svelte_component_invalid_this,
  svelte_component_missing_this,
  svelte_element_missing_this,
  svelte_meta_duplicate,
  svelte_meta_invalid_placement,
  svelte_meta_invalid_tag,
  tag_invalid_name,
  tag_invalid_placement,
  unexpected_eof,
  void_element_invalid_content,
} from "./errors";
import { readExpression } from "./expression";
import { decodeCharacterReferences } from "./html-entities";
import type { ParseError } from "./parse-error";
import { readScript } from "./script";
import {
  isWhitespace,
  type StackNode,
  type TemplateParserState,
} from "./state";
import { readStyle } from "./style";
import type { AST } from "./types/svelte-ast";

const REGEX_CLOSING_TEXTAREA = /<\/textarea(\s[^>]*)?>/iy;
const REGEX_DOCTYPE_NAME = /^![a-zA-Z]+$/;
const REGEX_NAMESPACED_NAME =
  /^[a-zA-Z][a-zA-Z0-9]*:[a-zA-Z][a-zA-Z0-9-]*[a-zA-Z0-9]$/;
const REGEX_CUSTOM_ELEMENT_NAME =
  /^[a-zA-Z][a-zA-Z0-9]*(-[a-zA-Z0-9.\-_\u00B7\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u037D\u037F-\u1FFF\u200C-\u200D\u203F-\u2040\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\u{10000}-\u{EFFFF}]*)?$/u;

// biome-ignore format: kept on one line so the lint suppression below stays adjacent to it
// biome-ignore lint/suspicious/noMisleadingCharacterClass: ZWNJ and ZWJ are allowed in identifiers on their own
const REGEX_COMPONENT_NAME = /^(?:\p{Lu}[$‌‍\p{ID_Continue}.]*|\p{ID_Start}[$‌‍\p{ID_Continue}]*(?:\.[$‌‍\p{ID_Continue}]+)+)$/u;

const VOID_ELEMENTS = new Set(
  "area base br col command embed hr img input keygen link meta param source track wbr".split(
    " ",
  ),
);

const DIRECTIVES = new Map<string, AST.Directive["type"]>([
  ["use", "UseDirective"],
  ["animate", "AnimateDirective"],
  ["bind", "BindDirective"],
  ["class", "ClassDirective"],
  ["style", "StyleDirective"],
  ["on", "OnDirective"],
  ["let", "LetDirective"],
  ["in", "TransitionDirective"],
  ["out", "TransitionDirective"],
  ["transition", "TransitionDirective"],
]);

type ElementType = AST.ElementLike["type"];
type Chunk = AST.Text | AST.ExpressionTag;
type AttributeLike =
  | AST.Attribute
  | AST.SpreadAttribute
  | AST.Directive
  | AST.AttachTag;

const META_TAGS = new Map<string, [type: ElementType, rootOnly: boolean]>([
  ["svelte:head", ["SvelteHead", true]],
  ["svelte:options", ["SvelteOptions" as ElementType, true]],
  ["svelte:window", ["SvelteWindow", true]],
  ["svelte:document", ["SvelteDocument", true]],
  ["svelte:body", ["SvelteBody", true]],
  ["svelte:element", ["SvelteElement", false]],
  ["svelte:component", ["SvelteComponent", false]],
  ["svelte:self", ["SvelteSelf", false]],
  ["svelte:fragment", ["SvelteFragment", false]],
  ["svelte:boundary", ["SvelteBoundary", false]],
]);

const META_TAG_NAMES = [...META_TAGS.keys()];
const META_TAG_LIST = `${META_TAG_NAMES.slice(0, -1).join(", ")} or ${META_TAG_NAMES.at(-1)}`;

const SLASH = 47;
const GT = 62;
const EQUALS = 61;
const DOUBLE_QUOTE = 34;
const SINGLE_QUOTE = 39;
const BRACE = 123;

const isQuote = (code: number) =>
  code === DOUBLE_QUOTE || code === SINGLE_QUOTE;

/** End of a tag or attribute name: stops at whitespace, `/` and `>`, and for attributes at quotes and `=`. */
function nameEnd(source: string, from: number, attribute: boolean): number {
  let i = from;
  for (; i < source.length; i++) {
    const code = source.charCodeAt(i);
    if (isWhitespace(code) || code === SLASH || code === GT) break;
    if (attribute && (isQuote(code) || code === EQUALS)) break;
  }
  return i;
}

function readName(state: TemplateParserState, attribute: boolean) {
  const start = state.index;
  if (start >= state.source.length) unexpected_eof(state.source.length);
  const end = nameEnd(state.source, start, attribute);
  state.index = end;
  return {
    name: state.source.slice(start, end),
    start,
    end,
    loc: state.sourceLocation(start, end),
  };
}

const text = (start: number, end: number, raw: string, data = raw) =>
  ({ start, end, type: "Text", raw, data }) as AST.Text;

function isVoid(name: string): boolean {
  return (
    VOID_ELEMENTS.has(name) ||
    (name.charCodeAt(0) === 33 && name.toLowerCase() === "!doctype")
  );
}

function isComponentName(name: string): boolean {
  const first = name.charCodeAt(0);
  if (first >= 97 && first <= 122 && !name.includes(".")) return false;
  return REGEX_COMPONENT_NAME.test(name);
}

function isElementName(name: string): boolean {
  let simple = true;
  for (let i = 0; i < name.length && simple; i++) {
    const code = name.charCodeAt(i);
    simple = (code >= 97 && code <= 122) || (i > 0 && code >= 48 && code <= 57);
  }
  return (
    (simple && name.length > 0) ||
    REGEX_DOCTYPE_NAME.test(name) ||
    REGEX_NAMESPACED_NAME.test(name) ||
    REGEX_CUSTOM_ELEMENT_NAME.test(name)
  );
}

function hasAncestor(
  stack: StackNode[],
  matches: (node: StackNode) => boolean | undefined,
): boolean {
  for (let i = stack.length - 1; i >= 0; i--) {
    const found = matches(stack[i]);
    if (found !== undefined) return found;
  }
  return false;
}

function elementType(
  state: TemplateParserState,
  name: string,
  isComponent: boolean,
): ElementType {
  const meta = META_TAGS.get(name);
  if (meta) return meta[0];
  if (isComponent) return "Component";
  if (name === "title") {
    const inHead = hasAncestor(state.stack, ({ type }) =>
      type === "SvelteHead"
        ? true
        : type === "RegularElement" || type === "Component"
          ? false
          : undefined,
    );
    if (inHead) return "TitleElement";
  }
  if (name === "slot") {
    const inShadowRoot = hasAncestor(state.stack, (node) =>
      node.type === "RegularElement" &&
      node.attributes.some(
        (a) => a.type === "Attribute" && a.name === "shadowrootmode",
      )
        ? true
        : undefined,
    );
    if (!inShadowRoot) return "SlotElement";
  }
  return "RegularElement";
}

export function readElement(state: TemplateParserState): void {
  const start = state.index++;
  if (state.eat("!--")) {
    const data = state.readUntil("-->");
    state.eat("-->", true);
    state.append({ type: "Comment", start, end: state.index, data });
  } else if (state.eat("/")) {
    closeElement(state, start);
  } else {
    openElement(state, start);
  }
}

function closeElement(state: TemplateParserState, start: number): void {
  const { name } = readName(state, false);
  state.allowWhitespace();
  state.eat(">", true);
  if (isVoid(name)) void_element_invalid_content(start);

  let open = state.current();
  while ((open as { name?: string }).name !== name) {
    if (open.type !== "RegularElement") {
      const autoClosed = state.lastAutoClosedTag;
      if (autoClosed?.tag === name) {
        element_invalid_closing_tag_autoclosed(start, name, autoClosed.reason);
      }
      element_invalid_closing_tag(start, name);
    }
    open.end = start;
    state.close();
    open = state.current();
  }
  open.end = state.index;
  state.close();

  if (state.stack.length < (state.lastAutoClosedTag?.depth ?? 0)) {
    state.lastAutoClosedTag = undefined;
  }
}

function openElement(state: TemplateParserState, start: number): void {
  const tag = readName(state, false);
  const { name } = tag;
  const meta = META_TAGS.get(name);

  if (!meta && name.startsWith("svelte:")) {
    svelte_meta_invalid_tag(tag, META_TAG_LIST);
  }
  const isComponent = isComponentName(name);
  if (!isComponent && !isElementName(name)) tag_invalid_name(tag);
  if (meta?.[1]) {
    if (state.metaTags.has(name)) svelte_meta_duplicate(start, name);
    if (state.current().type !== "Root") {
      svelte_meta_invalid_placement(start, name);
    }
    state.metaTags.add(name);
  }

  const element = {
    type: elementType(state, name, isComponent),
    start,
    end: -1,
    name,
  } as AST.ElementLike;
  if (state.loc) element.name_loc = tag.loc as never;
  element.attributes = [];
  element.fragment = { type: "Fragment", nodes: [] };

  state.allowWhitespace();

  const parent = state.current();
  if (
    parent.type === "RegularElement" &&
    closingTagOmitted(parent.name, name)
  ) {
    parent.end = start;
    state.close();
    state.lastAutoClosedTag = {
      tag: parent.name,
      reason: name,
      depth: state.stack.length,
    };
  }

  const topLevel =
    (name === "script" || name === "style") && state.current().type === "Root";
  readAttributes(state, element.attributes as AttributeLike[], topLevel);

  if (element.type === "SvelteComponent") {
    const definition = takeThis(element);
    if (!definition) svelte_component_missing_this(start);
    if (!isExpressionValue(definition.value)) {
      svelte_component_invalid_this(definition.start);
    }
    element.expression = expressionOf(definition.value);
  } else if (element.type === "SvelteElement") {
    const definition = takeThis(element);
    if (!definition) svelte_element_missing_this(start);
    if (definition.value === true) svelte_element_missing_this(definition);
    element.tag = isExpressionValue(definition.value)
      ? expressionOf(definition.value)
      : literalTag((definition.value as Chunk[])[0]);
  }

  if (topLevel) {
    readTopLevelBlock(state, element, start);
    return;
  }

  if (!state.eat("/") && !isVoid(name)) {
    state.eat(">", true);
    if (name === "textarea") {
      element.fragment.nodes = readSequence(
        state,
        (source, i) => {
          REGEX_CLOSING_TEXTAREA.lastIndex = i;
          return REGEX_CLOSING_TEXTAREA.test(source);
        },
        "inside <textarea>",
      );
      state.read(REGEX_CLOSING_TEXTAREA);
    } else if (name === "script" || name === "style") {
      element.fragment.nodes.push(readRawText(state, `</${name}>`));
    } else {
      state.open(element as StackNode & AST.ElementLike, element.fragment);
      return;
    }
  } else {
    state.eat(">", true);
  }
  element.end = state.index;
  state.append(element);
}

function readRawText(state: TemplateParserState, closer: string): AST.Text {
  const start = state.index;
  const found = state.source.indexOf(closer, start);
  state.index = found === -1 ? state.source.length : found;
  const node = text(start, state.index, state.source.slice(start, state.index));
  state.eat(closer, true);
  return node;
}

function readTopLevelBlock(
  state: TemplateParserState,
  element: AST.ElementLike,
  start: number,
): void {
  state.eat(">", true);
  const attributes = element.attributes as AST.Attribute[];
  const comment = commentBefore(state.root.fragment.nodes, start);

  if (element.name === "style") {
    const css = readStyle(state, start, attributes);
    (css.content as { comment: AST.Comment | null }).comment = comment;
    if (state.root.css) style_duplicate(start);
    state.root.css = css;
    return;
  }

  const script = readScript(state, start, attributes);
  if (comment) {
    script.content.leadingComments = [{ type: "Line", value: comment.data }];
  }
  const slot = script.context === "module" ? "module" : "instance";
  if (state.root[slot]) script_duplicate(start);
  state.root[slot] = script;
}

/** The HTML comment that a top-level `<script>`/`<style>` at `start` directly follows, whitespace aside. */
function commentBefore(
  nodes: AST.Fragment["nodes"],
  start: number,
): AST.Comment | null {
  const last = nodes.length - 1;
  if (last < 0 || nodes[last].end !== start) return null;
  for (let i = last; i >= 0; i--) {
    const node = nodes[i];
    if (node.type === "Comment") return node;
    if (node.type !== "Text" || node.data.trim()) return null;
  }
  return null;
}

function takeThis(element: AST.ElementLike): AST.Attribute {
  const attributes = element.attributes as AST.Attribute[];
  const index = attributes.findIndex(
    (a) => a.type === "Attribute" && a.name === "this",
  );
  return (index === -1 ? undefined : attributes.splice(index, 1)[0]) as never;
}

function isExpressionValue(value: AST.Attribute["value"]): boolean {
  if (value === true) return false;
  if (!Array.isArray(value)) return true;
  return value.length === 1 && value[0].type === "ExpressionTag";
}

function expressionOf(value: AST.Attribute["value"]) {
  return ((Array.isArray(value) ? value[0] : value) as AST.ExpressionTag)
    .expression;
}

function literalTag(chunk: Chunk) {
  if (chunk.type !== "Text") return chunk.expression;
  return {
    type: "Literal",
    value: chunk.data,
    raw: `'${chunk.raw}'`,
    start: chunk.start,
    end: chunk.end,
  } as never;
}

/** Reads attributes up to `>` or `/>`, rejecting a repeated name as svelte does. */
function readAttributes(
  state: TemplateParserState,
  into: AttributeLike[],
  isStatic: boolean,
): void {
  const seen = new Set<string>();
  for (;;) {
    const attribute = isStatic
      ? readStaticAttribute(state)
      : readAttribute(state);
    if (!attribute) return;
    const { type } = attribute;
    if (
      type === "Attribute" ||
      type === "BindDirective" ||
      type === "StyleDirective" ||
      type === "ClassDirective"
    ) {
      const key = `${type === "BindDirective" ? "Attribute" : type}${attribute.name}`;
      if (seen.has(key)) attribute_duplicate(attribute);
      if (attribute.name !== "this") seen.add(key);
    }
    into.push(attribute);
    state.allowWhitespace();
  }
}

function attribute(
  state: TemplateParserState,
  name: { name: string; loc?: AST.Attribute["name_loc"] },
  start: number,
  end: number,
  value: AST.Attribute["value"],
): AST.Attribute {
  const node = {
    type: "Attribute",
    start,
    end,
    name: name.name,
  } as AST.Attribute;
  if (state.loc) node.name_loc = name.loc;
  node.value = value;
  return node;
}

function rejectQuote(state: TemplateParserState): void {
  if (isQuote(state.source.charCodeAt(state.index))) {
    expected_token(state.index, "=");
  }
}

/** An attribute of a top-level `<script>` or `<style>`: a plain value, no expressions or directives. */
function readStaticAttribute(state: TemplateParserState): AST.Attribute | null {
  const start = state.index;
  const name = readName(state, true);
  if (!name.name) return null;

  let value: true | AST.Text[] = true;
  if (state.eat("=")) {
    state.allowWhitespace();
    const { source } = state;
    const at = state.index;
    let end = -1;
    if (isQuote(source.charCodeAt(at))) {
      const close = source.indexOf(source[at], at + 1);
      if (close !== -1) end = close + 1;
    }
    if (end === -1) {
      end = at;
      while (
        end < source.length &&
        source.charCodeAt(end) !== GT &&
        !isWhitespace(source.charCodeAt(end))
      ) {
        end++;
      }
      if (end === at) expected_attribute_value(at);
    }
    state.index = end;
    const quotes = isQuote(source.charCodeAt(at)) ? 1 : 0;
    const raw = source.slice(at + quotes, end - quotes);
    value = [
      text(
        end - raw.length - quotes,
        end - quotes,
        raw,
        decodeCharacterReferences(raw, true),
      ),
    ];
  }

  rejectQuote(state);
  return attribute(state, name, start, state.index, value);
}

function readJsComment(state: TemplateParserState): boolean {
  const start = state.index;
  const block = state.match("/*");
  if (!block && !state.match("//")) return false;
  state.index += 2;
  const value = state.readUntil(block ? "*/" : "\n");
  if (block) state.eat("*/");
  const comment = {
    type: block ? "Block" : "Line",
    start,
    end: state.index,
    value,
  };
  const loc = state.sourceLocation(start, state.index);
  if (loc) (comment as AST.JSComment).loc = loc;
  state.root.comments.push(comment as never);
  return true;
}

function readAttribute(state: TemplateParserState): AttributeLike | null {
  while (readJsComment(state)) state.allowWhitespace();
  const start = state.index;
  if (state.eat("{")) return readBraceAttribute(state, start);

  const name = readName(state, true);
  if (!name.name) return null;
  let end = state.index;
  state.allowWhitespace();

  let value: true | AST.ExpressionTag | Chunk[] = true;
  if (state.eat("=")) {
    state.allowWhitespace();
    if (state.match("/>")) {
      value = [text(state.index, state.index + 1, "/")];
      state.index++;
    } else {
      value = readAttributeValue(state);
    }
    end = state.index;
  } else {
    rejectQuote(state);
  }

  const colon = name.name.indexOf(":");
  const type =
    colon > 0 ? DIRECTIVES.get(name.name.slice(0, colon)) : undefined;
  return type
    ? directive(state, type, name, colon, start, end, value)
    : attribute(state, name, start, end, value);
}

function readBraceAttribute(
  state: TemplateParserState,
  start: number,
): AttributeLike {
  state.allowWhitespace();
  if (state.eat("@attach")) {
    state.requireWhitespace();
    const expression = readExpression(state);
    state.eatClosingBrace();
    return { type: "AttachTag", start, end: state.index, expression };
  }
  if (state.eat("...")) {
    const expression = readExpression(state);
    state.eatClosingBrace();
    return { type: "SpreadAttribute", start, end: state.index, expression };
  }
  const id = state.readIdentifierName();
  if (id.name === "") attribute_empty_shorthand(start);
  state.eatClosingBrace();
  const value = {
    type: "ExpressionTag",
    start: id.start,
    end: id.end,
    expression: id,
  } as AST.ExpressionTag;
  return attribute(state, id as never, start, state.index, value);
}

function directive(
  state: TemplateParserState,
  type: AST.Directive["type"],
  tag: { name: string; loc?: unknown },
  colon: number,
  start: number,
  end: number,
  value: true | AST.ExpressionTag | Chunk[],
): AST.Directive {
  const [name, ...modifiers] = tag.name.slice(colon + 1).split("|");
  if (name === "") {
    directive_missing_name({ start, end: start + colon + 1 }, tag.name);
  }

  const node = { start, end, type, name } as AST.Directive;
  if (state.loc) node.name_loc = tag.loc as never;

  if (node.type === "StyleDirective") {
    node.modifiers = modifiers as AST.StyleDirective["modifiers"];
    node.value = value;
    return node;
  }

  const first =
    value === true ? undefined : Array.isArray(value) ? value[0] : value;
  if (
    first &&
    ((Array.isArray(value) && value.length > 1) || first.type === "Text")
  ) {
    directive_invalid_value(first.start);
  }
  const target = node as { expression: unknown; modifiers: string[] };
  target.expression =
    (first as AST.ExpressionTag | undefined)?.expression ?? null;
  target.modifiers = modifiers;

  if (node.type === "TransitionDirective") {
    const direction = tag.name.slice(0, colon);
    node.intro = direction !== "out";
    node.outro = direction !== "in";
  }

  if (
    (type === "BindDirective" || type === "ClassDirective") &&
    !target.expression
  ) {
    target.expression = {
      start: start + colon + 1,
      end,
      type: "Identifier",
      name,
    } as never;
  }
  return node;
}

/** `"..."`, `'...'` or an unquoted value, as text and `{expression}` chunks. */
function readAttributeValue(
  state: TemplateParserState,
): AST.ExpressionTag | Chunk[] {
  const quote = state.source.charCodeAt(state.index);
  const quoted = isQuote(quote);
  if (quoted) {
    state.index++;
    if (state.source.charCodeAt(state.index) === quote) {
      state.index++;
      return [text(state.index - 1, state.index - 1, "")];
    }
  }

  let value: Chunk[];
  try {
    value = readSequence(
      state,
      quoted
        ? (source, i) => source.charCodeAt(i) === quote
        : endsUnquotedValue,
      "in attribute value",
      quoted ? quote : undefined,
    );
  } catch (error) {
    // `<a b={{c:1} />`: acorn read `/>` as the start of a regex.
    const at = (error as ParseError).position?.[0];
    if (
      (error as ParseError).code === "js_parse_error" &&
      at !== undefined &&
      state.source.startsWith("/>", at - 1)
    ) {
      state.index = at;
      expected_token(at, quoted ? String.fromCharCode(quote) : "}");
    }
    throw error;
  }

  if (quoted) state.index++;
  else if (value.length === 0) expected_attribute_value(state.index);

  return quoted || value.length > 1 || value[0].type === "Text"
    ? value
    : value[0];
}

function endsUnquotedValue(source: string, i: number): boolean {
  const code = source.charCodeAt(i);
  return (
    isWhitespace(code) ||
    isQuote(code) ||
    code === EQUALS ||
    code === 60 ||
    code === GT ||
    code === 96 ||
    (code === SLASH && source.charCodeAt(i + 1) === GT)
  );
}

/**
 * Text and `{expression}` chunks up to where `ends` says. With `quote`, text
 * runs up to the next `{` or quote are skipped in one go.
 */
function readSequence(
  state: TemplateParserState,
  ends: (source: string, i: number) => boolean,
  location: string,
  quote?: number,
): Chunk[] {
  const { source } = state;
  const chunks: Chunk[] = [];
  let textStart = state.index;

  const flushText = (end: number) => {
    if (end <= textStart) return;
    const raw = source.slice(textStart, end);
    chunks.push(
      text(textStart, end, raw, decodeCharacterReferences(raw, true)),
    );
  };

  while (state.index < source.length) {
    const at = state.index;
    if (ends(source, at)) {
      flushText(at);
      return chunks;
    }
    if (source.charCodeAt(at) !== BRACE) {
      state.index++;
      if (quote !== undefined) {
        while (
          state.index < source.length &&
          source.charCodeAt(state.index) !== BRACE &&
          source.charCodeAt(state.index) !== quote
        ) {
          state.index++;
        }
      }
      continue;
    }

    state.index++;
    const marker = source.charCodeAt(state.index);
    if (marker === 35 || marker === 64) {
      state.index++;
      const nameStart = state.index;
      while (
        state.index < source.length &&
        source.charCodeAt(state.index) >= 97 &&
        source.charCodeAt(state.index) <= 122
      ) {
        state.index++;
      }
      const name = source.slice(nameStart, state.index);
      (marker === 35 ? block_invalid_placement : tag_invalid_placement)(
        at,
        name,
        location,
      );
    }

    flushText(at);
    state.allowWhitespace();
    const expression = readExpression(state);
    state.eatClosingBrace();
    chunks.push({
      type: "ExpressionTag",
      start: at,
      end: state.index,
      expression,
    } as AST.ExpressionTag);
    textStart = state.index;
  }

  unexpected_eof(source.length);
}
