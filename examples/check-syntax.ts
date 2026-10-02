import { readFile } from "node:fs/promises";
import { ParseError, parse, parseModule } from "sveast";

/**
 * The syntax error in a component or module, formatted as
 * `file:line:column code: reason` followed by svelte's code frame, or
 * `undefined` when it parses. Styles aren't checked, since `<style
 * lang="scss">` isn't CSS until it's preprocessed.
 */
export function checkSyntax(file: string, source: string): string | undefined {
  try {
    if (file.endsWith(".svelte")) parse(source, { css: false });
    else parseModule(source, { typescript: file.endsWith(".ts") });
    return undefined;
  } catch (error) {
    if (!(error instanceof ParseError)) throw error;
    const at = error.start
      ? `:${error.start.line}:${error.start.column + 1}`
      : "";
    const frame = error.frame ? `\n${error.frame}` : "";
    return `${file}${at} ${error.code}: ${error.reason}${frame}`;
  }
}

if (import.meta.main) {
  const files = process.argv.slice(2);
  const sources = await Promise.all(
    files.map((file) => readFile(file, "utf8")),
  );
  for (const [index, file] of files.entries()) {
    const error = checkSyntax(file, sources[index] ?? "");
    if (error === undefined) continue;
    console.error(error);
    process.exitCode = 1;
  }
}
