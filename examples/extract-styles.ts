import { readFile } from "node:fs/promises";
import { type AST, parse } from "sveast";

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
 * A component's `<style>`, without parsing it as CSS, so it works for
 * `lang="scss"` and other preprocessors too.
 */
export function extractStyles(source: string): Styles | undefined {
  const css = parse(source, { css: false }).css;
  if (!css) return undefined;
  const { start, styles } = css.content;
  let line = 1;
  for (let index = source.indexOf("\n"); index !== -1 && index < start; ) {
    line++;
    index = source.indexOf("\n", index + 1);
  }
  return { styles, lang: lang(css.attributes) ?? "css", line };
}

function lang(attributes: AST.Attribute[]): string | undefined {
  for (const { name, value } of attributes) {
    if (name !== "lang" || !Array.isArray(value)) continue;
    const [text] = value;
    if (text?.type === "Text") return text.data;
  }
  return undefined;
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
