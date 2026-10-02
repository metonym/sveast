import { statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type AST, parse, parseImportsExports } from "sveast";

const TYPESCRIPT_FILE = /\.[cm]?ts$/;
const EXTENSIONS = ["", ".ts", ".js", ".svelte", "/index.ts", "/index.js"];

/**
 * The modules a file imports or re-exports from, as written:
 * `"./Button.svelte"`, `"svelte/store"`. A component's `<script>`s are read with
 * `parseImportsExports`, which skips everything but the import and export
 * statements, and `parse` with `script: false` only finds where they are.
 */
export function importsOf(file: string, source: string): string[] {
  const specifiers = new Set<string>();
  const add = (code: string, typescript: boolean): void => {
    for (const node of parseImportsExports(code, {
      typescript,
      localExports: false,
    })) {
      if ("source" in node && node.source) specifiers.add(node.source.value);
    }
  };
  if (file.endsWith(".svelte")) {
    const ast = parse(source, { css: false, script: false });
    for (const script of [ast.module, ast.instance]) {
      if (!script) continue;
      const { start, end } = script.content;
      add(source.slice(start, end), lang(script.attributes) === "ts");
    }
  } else {
    add(source, TYPESCRIPT_FILE.test(file));
  }
  return [...specifiers];
}

function lang(attributes: AST.Attribute[]): string | undefined {
  for (const { name, value } of attributes) {
    if (name !== "lang" || !Array.isArray(value)) continue;
    const [text] = value;
    if (text?.type === "Text") return text.data;
  }
  return undefined;
}

export interface ModuleGraph {
  /** Each file reached from the entries, with the local files it imports. */
  files: Record<string, string[]>;
  /** Relative imports that resolve to no file, as `file: specifier`. */
  missing: string[];
  /**
   * The packages they import, e.g. `"svelte"` or `"@scope/name/sub"`, in
   * the order they're first seen.
   */
  packages: string[];
}

/**
 * Every file reachable from `entries` through relative imports, e.g. to see
 * what a route pulls in, or which files nothing imports. A specifier
 * without an extension resolves like a bundler would: `.ts`, `.js`,
 * `.svelte`, then an `index` file.
 */
export async function moduleGraph(entries: string[]): Promise<ModuleGraph> {
  const files: Record<string, string[]> = {};
  const packages = new Set<string>();
  const missing: string[] = [];
  const visit = async (batch: string[]): Promise<void> => {
    const fresh = [...new Set(batch)].filter((file) => !(file in files));
    if (fresh.length === 0) return;
    const sources = await Promise.all(
      fresh.map((file) => readFile(file, "utf8")),
    );
    const next: string[] = [];
    for (const [index, file] of fresh.entries()) {
      const local: string[] = [];
      for (const specifier of importsOf(file, sources[index] ?? "")) {
        if (!specifier.startsWith(".")) {
          packages.add(specifier);
          continue;
        }
        const resolved = resolveFile(join(dirname(file), specifier));
        if (resolved === undefined) missing.push(`${file}: ${specifier}`);
        else local.push(resolved);
      }
      files[file] = local;
      next.push(...local);
    }
    await visit(next);
  };
  await visit(entries);
  return { files, missing, packages: [...packages] };
}

function resolveFile(path: string): string | undefined {
  for (const extension of EXTENSIONS) {
    const candidate = path + extension;
    if (statSync(candidate, { throwIfNoEntry: false })?.isFile()) {
      return candidate;
    }
  }
  return undefined;
}

if (import.meta.main) {
  const graph = await moduleGraph(process.argv.slice(2));
  console.log(JSON.stringify(graph, null, 2));
}
