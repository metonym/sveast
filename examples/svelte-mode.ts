import { readFile } from "node:fs/promises";
import { type AST, isReference, type Program, parse, STOP, walk } from "sveast";

const RUNES = new Set([
  "$state",
  "$derived",
  "$effect",
  "$props",
  "$bindable",
  "$inspect",
  "$host",
]);
const LEGACY_GLOBALS = new Set(["$$props", "$$restProps", "$$slots"]);

export interface SvelteMode {
  /**
   * `"runes"` or `"legacy"` when the component can only compile in that
   * mode, `"either"` when it uses neither's syntax.
   */
  mode: "runes" | "legacy" | "either";
  /**
   * What decided it, e.g. `"$state"`, `"export let"` or
   * `"<svelte:options runes={true}>"`.
   */
  reason?: string;
  line?: number;
}

/**
 * Whether a component uses runes or Svelte 4's syntax, e.g. to track a
 * migration to Svelte 5. The walk stops at the first rune, which decides
 * it; `export let`, `$:` and `$$props` only decide it if no rune follows.
 */
export function svelteMode(source: string): SvelteMode {
  const ast = parse(source, { css: false, comments: false });
  if (ast.options?.runes !== undefined) {
    return {
      mode: ast.options.runes ? "runes" : "legacy",
      reason: `<svelte:options runes={${ast.options.runes}}>`,
      line: lineOf(source, ast.options.start),
    };
  }
  const instance = ast.instance?.content;
  let runes: SvelteMode | undefined;
  let legacy: SvelteMode | undefined;
  walk(ast, {
    enter(node, parent) {
      if (
        node.type === "Identifier" &&
        RUNES.has(node.name) &&
        isReference(node, parent)
      ) {
        runes = {
          mode: "runes",
          reason: node.name,
          line: lineOf(source, node.start),
        };
        return STOP;
      }
      legacy ??= legacySyntax(source, node, parent, instance);
      return;
    },
  });
  return runes ?? legacy ?? { mode: "either" };
}

function legacySyntax(
  source: string,
  node: AST.SvelteNode,
  parent: AST.SvelteNode | null,
  instance: Program | undefined,
): SvelteMode | undefined {
  const legacy = (reason: string, start: number): SvelteMode => ({
    mode: "legacy",
    reason,
    line: lineOf(source, start),
  });
  if (node.type === "Identifier") {
    return LEGACY_GLOBALS.has(node.name) && isReference(node, parent)
      ? legacy(node.name, node.start)
      : undefined;
  }
  if (parent !== instance) return undefined;
  if (node.type === "LabeledStatement" && node.label.name === "$") {
    return legacy("$:", node.start);
  }
  if (
    node.type === "ExportNamedDeclaration" &&
    node.declaration?.type === "VariableDeclaration" &&
    node.declaration.kind === "let"
  ) {
    return legacy("export let", node.start);
  }
  return undefined;
}

const lineOf = (source: string, offset: number): number =>
  source.slice(0, offset).split("\n").length;

if (import.meta.main) {
  const files = process.argv.slice(2);
  const sources = await Promise.all(
    files.map((file) => readFile(file, "utf8")),
  );
  for (const [index, file] of files.entries()) {
    const { mode, reason, line } = svelteMode(sources[index] ?? "");
    console.log(
      reason === undefined
        ? `${file}: ${mode}`
        : `${file}: ${mode} (${reason}, line ${line})`,
    );
  }
}
