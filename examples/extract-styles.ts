import { readFile } from "node:fs/promises";
import { createLocator, type LexedAttribute, lexComponent } from "sveast";

export interface Styles {
  /** The text between `<style>` and `</style>`. */
  styles: string;
  /** The `lang` attribute, e.g. `"scss"`; `"css"` without one. */
  lang: string;
  /**
   * The line `styles` starts on: line `n` of `styles` is line `line + n - 1`
   * of the component, to map a linter's line numbers back.
   */
  line: number;
}

/**
 * A component's `<style>`, found by `lexComponent` without parsing the
 * component, so it works for `lang="scss"` and other preprocessors too.
 */
export function extractStyles(source: string): Styles | undefined {
  const { css } = lexComponent(source);
  if (!css) return undefined;
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const { start, end } = css.content;
  return {
    styles: text.slice(start, end),
    lang: lang(css.attributes) ?? "css",
    line: createLocator(text)(start).line,
  };
}

function lang(attributes: LexedAttribute[]): string | undefined {
  const value = attributes.find(({ name }) => name === "lang")?.value;
  return typeof value === "string" ? value : undefined;
}

if (import.meta.main) {
  const files = process.argv.slice(2);
  const sources = await Promise.all(
    files.map((file) => readFile(file, "utf8")),
  );
  for (const [index, file] of files.entries()) {
    const extracted = extractStyles(sources[index] ?? "");
    if (!extracted) continue;
    console.log(`/* ${file}:${extracted.line} (${extracted.lang}) */`);
    console.log(extracted.styles);
  }
}
