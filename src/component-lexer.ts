import { closingTagOmitted } from "./autoclosing";
import {
  endsUnquotedValue,
  isQuote,
  isTypeScript,
  isVoid,
  isWhitespace,
  nameEnd,
  skipWhitespace,
  styleContentEnd,
} from "./markup";
import { closingBracket } from "./scan";

/** An attribute of a top-level `<script>`, `<style>` or `<svelte:options>`. */
export interface LexedAttribute {
  name: string;
  /**
   * The value as written, without its quotes: character references
   * aren't decoded, and an expression keeps its braces, as in `"{true}"`
   * for `runes={true}`. `true` for an attribute without a value.
   */
  value: string | true;
  /** The offset of the name. */
  start: number;
  /** The offset after the value, or after the name without one. */
  end: number;
}

/** The text between a top-level element's tags. */
export interface LexedContent {
  start: number;
  end: number;
}

/** A top-level `<script>`. */
export interface LexedScript {
  /** The offset of `<script`. */
  start: number;
  /** The offset after `</script>`. */
  end: number;
  /** `"module"` for `<script module>` or `<script context="module">`. */
  context: "default" | "module";
  attributes: LexedAttribute[];
  content: LexedContent;
}

/** The top-level `<style>`. */
export interface LexedStyle {
  /** The offset of `<style`. */
  start: number;
  /** The offset after `</style>`. */
  end: number;
  attributes: LexedAttribute[];
  content: LexedContent;
}

/** `<svelte:options>`. */
export interface LexedOptions {
  /** The offset of `<svelte:options`. */
  start: number;
  /** The offset after `/>` or `</svelte:options>`. */
  end: number;
  attributes: LexedAttribute[];
}

/** A component's top-level sections, as {@link lexComponent} finds them. */
export interface LexedComponent {
  /**
   * Whether `parse` reads the component as TypeScript, which needs the
   * TypeScript plugin: svelte decides it from the first `<script>` with a
   * `lang`, so this is `true` when that one has `lang="ts"`.
   */
  typescript: boolean;
  /** The `<script>` without `module`, as `parse`'s `instance`. */
  instance: LexedScript | null;
  /** The `<script module>`, as `parse`'s `module`. */
  module: LexedScript | null;
  /** The `<style>`, as `parse`'s `css`. */
  css: LexedStyle | null;
  /** `<svelte:options>`, as `parse`'s `options`. */
  options: LexedOptions | null;
}

const BLOCK = "{";
const LT = 60;
const GT = 62;
const SLASH = 47;
const EQUALS = 61;
const BRACE = 123;

const REGEX_SECTION_TAG = /<(?:script|style|svelte:options)(?![^\s/>])/g;
const REGEX_CLOSING_SCRIPT_TAG = /<\/script\s*>/g;
const REGEX_CLOSING_STYLE_TAG_END = /\s*>/y;
const REGEX_CLOSING_TEXTAREA = /<\/textarea(\s[^>]*)?>/iy;
const CLOSING_OPTIONS_TAG = "</svelte:options";

/**
 * A component's top-level `<script>`, `<script module>`, `<style>` and
 * `<svelte:options>`, with their attributes and the offsets of their tags
 * and content, read without a parser: e.g. to find a component's
 * language or imports, or to rewrite its scripts, without parsing the
 * markup. The offsets are `parse`'s, so they're into the source without
 * a leading byte order mark.
 *
 * The markup is skipped by tracking only tags, attribute values, blocks
 * and the brackets, strings, comments and templates of each `{…}`
 * expression, so a `<script>` inside an element, a block, a string or a
 * comment isn't one. It stops after the last `<script`, `<style` or
 * `<svelte:options`. Where `parse` accepts the component, the sections
 * are the same as its `instance`, `module`, `css` and `options`; it
 * doesn't check syntax and never throws.
 */
export function lexComponent(input: string): LexedComponent {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const source = text.trimEnd();
  return lex(source, isTypeScript(source), null);
}

export interface TopLevelTags {
  tags: number[];
  comments: number[];
}

export function topLevelTags(source: string): TopLevelTags {
  const found: TopLevelTags = { tags: [], comments: [] };
  lex(source, false, found);
  return found;
}

function lex(
  source: string,
  typescript: boolean,
  found: TopLevelTags | null,
): LexedComponent {
  const component: LexedComponent = {
    typescript,
    instance: null,
    module: null,
    css: null,
    options: null,
  };
  const last = lastSectionTag(source);
  const stack: string[] = [];
  let i = 0;
  while (i <= last) {
    const code = source.charCodeAt(i);
    if (code === LT) i = readTag(source, i, stack, component, found);
    else if (code === BRACE) i = readMustache(source, i, stack);
    else i++;
  }
  return component;
}

function lastSectionTag(source: string): number {
  let last = -1;
  REGEX_SECTION_TAG.lastIndex = 0;
  for (
    let match = REGEX_SECTION_TAG.exec(source);
    match !== null;
    match = REGEX_SECTION_TAG.exec(source)
  ) {
    last = match.index;
  }
  return last;
}

function expressionEnd(source: string, from: number): number {
  return Math.min(closingBracket(source, from) + 1, source.length);
}

function readMustache(source: string, start: number, stack: string[]): number {
  let i = skipWhitespace(source, start + 1);
  const code = source.charCodeAt(i);
  const next = source.charCodeAt(i + 1);
  if (
    code === 35 ||
    code === 58 ||
    code === 64 ||
    (code === SLASH && next !== SLASH && next !== 42)
  ) {
    i++;
    while (i < source.length) {
      const letter = source.charCodeAt(i);
      if (letter < 97 || letter > 122) break;
      i++;
    }
    if (code === 35) stack.push(BLOCK);
    else if (code === SLASH) {
      const open = stack.lastIndexOf(BLOCK);
      if (open !== -1) stack.length = open;
    }
  }
  return expressionEnd(source, i);
}

function readTag(
  source: string,
  start: number,
  stack: string[],
  component: LexedComponent,
  found: TopLevelTags | null,
): number {
  if (source.startsWith("!--", start + 1)) {
    const close = source.indexOf("-->", start + 4);
    const end = close === -1 ? source.length : close + 3;
    if (found && stack.length === 0) found.comments.push(start, end);
    return end;
  }
  if (source.charCodeAt(start + 1) === SLASH) {
    const nameStart = start + 2;
    const name = source.slice(nameStart, nameEnd(source, nameStart, false));
    const open = stack.lastIndexOf(name);
    if (open !== -1) stack.length = open;
    return eatGreaterThan(
      source,
      skipWhitespace(source, nameStart + name.length),
    );
  }

  const name = source.slice(start + 1, nameEnd(source, start + 1, false));
  let i = skipWhitespace(source, start + 1 + name.length);
  const parent = stack[stack.length - 1];
  if (parent !== undefined && closingTagOmitted(parent, name)) stack.pop();
  const topLevel = stack.length === 0;

  if (
    found &&
    topLevel &&
    (name === "script" || name === "style" || name === "svelte:options")
  ) {
    found.tags.push(start);
  }

  if (topLevel && (name === "script" || name === "style")) {
    const attributes: LexedAttribute[] = [];
    i = eatGreaterThan(source, readStaticAttributes(source, i, attributes));
    if (name === "script") {
      const script = readScript(source, start, i, attributes);
      if (script.context === "module") component.module ??= script;
      else component.instance ??= script;
      return script.end;
    }
    const css = readStyle(source, start, i, attributes);
    component.css ??= css;
    return css.end;
  }

  const attributes: LexedAttribute[] | null =
    topLevel && name === "svelte:options" ? [] : null;
  i = readAttributes(source, i, attributes);
  if (source.charCodeAt(i) === SLASH || isVoid(name)) {
    if (source.charCodeAt(i) === SLASH) i++;
    i = eatGreaterThan(source, i);
  } else {
    i = eatGreaterThan(source, i);
    if (name === "textarea") return textareaEnd(source, i);
    if (name === "script" || name === "style") {
      const closer = `</${name}>`;
      const close = source.indexOf(closer, i);
      return close === -1 ? source.length : close + closer.length;
    }
    if (attributes && source.startsWith(CLOSING_OPTIONS_TAG, i)) {
      i = eatGreaterThan(
        source,
        skipWhitespace(source, i + CLOSING_OPTIONS_TAG.length),
      );
    } else {
      stack.push(name);
      return i;
    }
  }
  if (attributes) component.options ??= { start, end: i, attributes };
  return i;
}

function eatGreaterThan(source: string, i: number): number {
  return source.charCodeAt(i) === GT ? i + 1 : i;
}

function readScript(
  source: string,
  start: number,
  contentStart: number,
  attributes: LexedAttribute[],
): LexedScript {
  REGEX_CLOSING_SCRIPT_TAG.lastIndex = contentStart;
  const close = REGEX_CLOSING_SCRIPT_TAG.exec(source);
  const contentEnd = close ? close.index : source.length;
  const module = attributes.some(
    (attribute) => attribute.name === "module" || attribute.name === "context",
  );
  return {
    start,
    end: close ? close.index + close[0].length : source.length,
    context: module ? "module" : "default",
    attributes,
    content: { start: contentStart, end: contentEnd },
  };
}

function readStyle(
  source: string,
  start: number,
  contentStart: number,
  attributes: LexedAttribute[],
): LexedStyle {
  const contentEnd = styleContentEnd(source, contentStart);
  let end = contentEnd;
  if (source.startsWith("</style", end)) {
    end += 7;
    REGEX_CLOSING_STYLE_TAG_END.lastIndex = end;
    const close = REGEX_CLOSING_STYLE_TAG_END.exec(source);
    if (close) end += close[0].length;
  }
  return {
    start,
    end,
    attributes,
    content: { start: contentStart, end: contentEnd },
  };
}

function readStaticAttributes(
  source: string,
  from: number,
  into: LexedAttribute[],
): number {
  let i = from;
  for (;;) {
    const start = i;
    const end = nameEnd(source, i, true);
    if (end === start) return i;
    i = end;
    let value: string | true = true;
    if (source.charCodeAt(i) === EQUALS) {
      const at = skipWhitespace(source, i + 1);
      const quote = source.charCodeAt(at);
      let valueEnd = -1;
      if (isQuote(quote)) {
        const close = source.indexOf(source[at], at + 1);
        if (close !== -1) valueEnd = close + 1;
      }
      if (valueEnd === -1) {
        valueEnd = at;
        while (
          valueEnd < source.length &&
          source.charCodeAt(valueEnd) !== GT &&
          !isWhitespace(source.charCodeAt(valueEnd))
        ) {
          valueEnd++;
        }
      }
      const quotes = isQuote(quote) ? 1 : 0;
      value = source.slice(at + quotes, valueEnd - quotes);
      i = valueEnd;
    }
    into.push({ name: source.slice(start, end), value, start, end: i });
    i = skipWhitespace(source, i);
  }
}

function readAttributes(
  source: string,
  from: number,
  into: LexedAttribute[] | null,
): number {
  let i = from;
  for (;;) {
    for (;;) {
      if (source.startsWith("/*", i)) {
        const end = source.indexOf("*/", i + 2);
        i = end === -1 ? source.length : end + 2;
      } else if (source.startsWith("//", i)) {
        const end = source.indexOf("\n", i + 2);
        i = end === -1 ? source.length : end;
      } else {
        break;
      }
      i = skipWhitespace(source, i);
    }
    const start = i;
    if (source.charCodeAt(i) === BRACE) {
      i = skipWhitespace(source, expressionEnd(source, i + 1));
      continue;
    }
    const nameEndAt = nameEnd(source, i, true);
    if (nameEndAt === start) return i;
    let end = nameEndAt;
    let value: string | true = true;
    i = skipWhitespace(source, nameEndAt);
    if (source.charCodeAt(i) === EQUALS) {
      const at = skipWhitespace(source, i + 1);
      end = source.startsWith("/>", at)
        ? at + 1
        : attributeValueEnd(source, at);
      value = isQuote(source.charCodeAt(at))
        ? source.slice(at + 1, Math.max(at + 1, end - 1))
        : source.slice(at, end);
      i = skipWhitespace(source, end);
    }
    into?.push({
      name: source.slice(start, nameEndAt),
      value,
      start,
      end,
    });
  }
}

function attributeValueEnd(source: string, from: number): number {
  const quote = source.charCodeAt(from);
  if (isQuote(quote)) {
    let i = from + 1;
    while (i < source.length) {
      const code = source.charCodeAt(i);
      if (code === quote) return i + 1;
      i = code === BRACE ? expressionEnd(source, i + 1) : i + 1;
    }
    return source.length;
  }
  let i = from;
  while (i < source.length && !endsUnquotedValue(source, i)) {
    i = source.charCodeAt(i) === BRACE ? expressionEnd(source, i + 1) : i + 1;
  }
  return i;
}

function textareaEnd(source: string, from: number): number {
  let i = from;
  while (i < source.length) {
    const code = source.charCodeAt(i);
    if (code === LT) {
      REGEX_CLOSING_TEXTAREA.lastIndex = i;
      if (REGEX_CLOSING_TEXTAREA.test(source)) {
        return REGEX_CLOSING_TEXTAREA.lastIndex;
      }
    }
    i = code === BRACE ? expressionEnd(source, i + 1) : i + 1;
  }
  return source.length;
}
