import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type AST, parse } from "sveast";

/**
 * The components a file renders, each mapped to the module it's imported
 * from, or `null` when no import declares it (e.g. a component passed as a
 * prop). `<Modal.Root>` resolves through the import of `Modal`.
 */
export function componentsUsed(source: string): Record<string, string | null> {
  const ast = parse(source, { css: false });
  const imports = importedNames(ast);
  const used: Record<string, string | null> = {};
  const visit = (node: object): void => {
    if (
      "type" in node &&
      node.type === "Component" &&
      "name" in node &&
      typeof node.name === "string"
    ) {
      const [binding = node.name] = node.name.split(".");
      used[node.name] = imports.get(binding) ?? null;
    }
    for (const child of Object.values(node)) {
      if (typeof child === "object" && child !== null) visit(child);
    }
  };
  visit(ast.fragment);
  return used;
}

function importedNames(ast: AST.Root): Map<string, string> {
  const imports = new Map<string, string>();
  for (const script of [ast.module, ast.instance]) {
    for (const statement of script?.content.body ?? []) {
      if (statement.type !== "ImportDeclaration") continue;
      for (const specifier of statement.specifiers) {
        imports.set(specifier.local.name, statement.source.value);
      }
    }
  }
  return imports;
}

/**
 * A dependency graph of the given files: for each file, the components it
 * renders and the path they're imported from, joined to the file's
 * directory when relative.
 */
export async function dependencyGraph(
  files: string[],
): Promise<Record<string, Record<string, string | null>>> {
  const sources = await Promise.all(
    files.map((file) => readFile(file, "utf8")),
  );
  const graph: Record<string, Record<string, string | null>> = {};
  for (const [index, file] of files.entries()) {
    const used = componentsUsed(sources[index] ?? "");
    for (const [name, from] of Object.entries(used)) {
      if (from?.startsWith(".")) used[name] = join(dirname(file), from);
    }
    graph[file] = used;
  }
  return graph;
}

if (import.meta.main) {
  const graph = await dependencyGraph(process.argv.slice(2));
  console.log(JSON.stringify(graph, null, 2));
}
