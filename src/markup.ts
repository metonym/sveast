const REGEX_LANG_ATTRIBUTE =
  /<!--[\s\S]*?-->|<script\s+(?:[^>]*|(?:[^=>'"/]+=(?:"[^"]*"|'[^']*'|[^>\s]+)\s+)*)lang=(["'])?([^"' >]+)\1[^>]*>/y;

export function isWhitespace(code: number): boolean {
  if (code === 32 || (code <= 13 && code >= 9)) return true;
  if (code < 160) return false;
  return (
    code === 160 ||
    code === 5760 ||
    (code >= 8192 && code <= 8202) ||
    code === 8232 ||
    code === 8233 ||
    code === 8239 ||
    code === 8287 ||
    code === 12288 ||
    code === 65279
  );
}

export function skipWhitespace(source: string, from: number): number {
  let index = from;
  while (index < source.length && isWhitespace(source.charCodeAt(index)))
    index++;
  return index;
}

/** Whether svelte parses the component as TypeScript: its first `<script>` with a `lang`, outside comments, has `lang="ts"`. */
export function isTypeScript(source: string): boolean {
  let index = source.indexOf("<");
  while (index !== -1) {
    const next = source.charCodeAt(index + 1);
    if (next === 33 || next === 115) {
      REGEX_LANG_ATTRIBUTE.lastIndex = index;
      const match = REGEX_LANG_ATTRIBUTE.exec(source);
      if (match) {
        if (next === 115) return match[2] === "ts";
        index = source.indexOf("<", REGEX_LANG_ATTRIBUTE.lastIndex);
        continue;
      }
    }
    index = source.indexOf("<", index + 1);
  }
  return false;
}

const VOID_ELEMENTS = new Set(
  "area base br col command embed hr img input keygen link meta param source track wbr".split(
    " ",
  ),
);

export function isVoid(name: string): boolean {
  return (
    VOID_ELEMENTS.has(name) ||
    (name.charCodeAt(0) === 33 && name.toLowerCase() === "!doctype")
  );
}

/** The offset of the `</style` that ends a `<style>`'s content starting at `from`, past comments and strings, or the source's length. */
export function styleContentEnd(source: string, from: number): number {
  let index = from;
  while (index < source.length) {
    const code = source.charCodeAt(index);
    if (code === 47 && source.charCodeAt(index + 1) === 42) {
      const end = source.indexOf("*/", index + 2);
      index = end === -1 ? source.length : end + 2;
    } else if (code === 34 || code === 39) {
      index++;
      while (index < source.length) {
        const next = source.charCodeAt(index);
        if (next === code || next === 10) break;
        index += next === 92 ? 2 : 1;
      }
      index++;
    } else if (code === 60 && source.startsWith("</style", index)) {
      break;
    } else {
      index++;
    }
  }
  return Math.min(index, source.length);
}

const DOUBLE_QUOTE = 34;
const SINGLE_QUOTE = 39;
const SLASH = 47;
const EQUALS = 61;
const GT = 62;

export const isQuote = (code: number) =>
  code === DOUBLE_QUOTE || code === SINGLE_QUOTE;

/** End of a tag or attribute name: stops at whitespace, `/` and `>`, and for attributes at quotes and `=`. */
export function nameEnd(
  source: string,
  from: number,
  isAttribute: boolean,
): number {
  let i = from;
  for (; i < source.length; i++) {
    const code = source.charCodeAt(i);
    if (isWhitespace(code) || code === SLASH || code === GT) break;
    if (isAttribute && (isQuote(code) || code === EQUALS)) break;
  }
  return i;
}

export function endsUnquotedValue(source: string, i: number): boolean {
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
