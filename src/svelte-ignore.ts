// svelte's reading of `svelte-ignore` comments, from its
// utils/extract_svelte_ignore.js. svelte is MIT licensed.

import { REPLACEMENTS, SVELTE_CODES } from "./warning-codes";

const SVELTE_IGNORE = /^\s*svelte-ignore\s/;
const IGNORE_CODE = /[\w$-]+/gm;
const IGNORE_CODE_COMMA = /([\w$-]+)(,)?/gm;
const HYPHEN = /-/g;
const CODES: ReadonlySet<string> = new Set(SVELTE_CODES);

/** svelte 5's name for `code`, which may be a svelte 4 code. */
export function renamedCode(code: string): string {
  return REPLACEMENTS[code] ?? code.replace(HYPHEN, "_");
}

/** Whether `code` is one a `svelte-ignore` comment can name. */
export function isSvelteCode(code: string): boolean {
  return CODES.has(code);
}

/**
 * The codes a `svelte-ignore` comment's text ignores. In runes mode only
 * svelte 5's codes, separated by commas, count; in legacy mode svelte 4's
 * codes do too, with their svelte 5 names. In runes mode `invalid` gets
 * each code that doesn't count, with its offset in `text`.
 */
export function ignoreCodes(
  text: string,
  runes: boolean,
  invalid?: (code: string, offset: number) => void,
): string[] {
  const match = SVELTE_IGNORE.exec(text);
  if (!match) return [];
  const length = match[0].length;
  const rest = text.slice(length);
  const codes: string[] = [];
  if (runes) {
    // Codes are separated by commas; anything after the last one is prose.
    for (const found of rest.matchAll(IGNORE_CODE_COMMA)) {
      const code = found[1];
      if (CODES.has(code)) codes.push(code);
      else invalid?.(code, length + found.index);
      if (!found[2]) break;
    }
  } else {
    for (const [code] of rest.matchAll(IGNORE_CODE)) {
      codes.push(code);
      if (!CODES.has(code)) {
        const replacement = renamedCode(code);
        if (CODES.has(replacement)) codes.push(replacement);
      }
    }
  }
  return codes;
}
