// svelte's reading of `svelte-ignore` comments, from its
// utils/extract_svelte_ignore.js. svelte is MIT licensed.

const SVELTE_IGNORE = /^\s*svelte-ignore\s/;
const IGNORE_CODE = /[\w$-]+/gm;
const IGNORE_CODE_COMMA = /([\w$-]+)(,)?/gm;
const HYPHEN = /-/g;

// svelte 4's codes that svelte 5 renamed, besides `-` to `_`.
const REPLACEMENTS: Readonly<Record<string, string>> = {
  "a11y-structure": "a11y_figcaption_parent",
};

/**
 * The codes a `svelte-ignore` comment's text ignores. In runes mode only
 * svelte 5's codes, separated by commas, count; in legacy mode svelte 4's
 * codes do too, with their svelte 5 names.
 */
export function ignoreCodes(text: string, runes: boolean): string[] {
  const match = SVELTE_IGNORE.exec(text);
  if (!match) return [];
  const rest = text.slice(match[0].length);
  const codes: string[] = [];
  if (runes) {
    // Codes are separated by commas; anything after the last one is prose.
    // svelte 4's codes, with hyphens, don't count.
    for (const [, code, comma] of rest.matchAll(IGNORE_CODE_COMMA)) {
      if (!code.includes("-")) codes.push(code);
      if (!comma) break;
    }
  } else {
    for (const [code] of rest.matchAll(IGNORE_CODE)) {
      codes.push(code, REPLACEMENTS[code] ?? code.replace(HYPHEN, "_"));
    }
  }
  return codes;
}
