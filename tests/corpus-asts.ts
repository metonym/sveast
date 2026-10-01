import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type AST, parse, parseModule } from "sveast";
import { byCodeUnit } from "../scripts/shared";
import { SNIPPETS } from "./ts-snippets";

const CORPUS = join(import.meta.dir, "corpus");
const FILES = readdirSync(CORPUS, { recursive: true, encoding: "utf8" }).sort(
  byCodeUnit,
);

export function corpusAsts(): AST.SvelteNode[] {
  const asts: AST.SvelteNode[] = [];
  for (const path of FILES) {
    const source = () => readFileSync(join(CORPUS, path), "utf8");
    try {
      if (path.endsWith(".svelte")) {
        asts.push(parse(source()));
      } else if (path.endsWith(".js") || path.endsWith(".ts")) {
        asts.push(parseModule(source(), { typescript: path.endsWith(".ts") }));
      }
    } catch {
      // files neither parser accepts have no AST to walk
    }
  }
  for (const snippet of Object.values(SNIPPETS)) {
    asts.push(parseModule(snippet, { typescript: true }));
  }
  return asts;
}
