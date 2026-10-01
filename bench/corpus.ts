import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseModule } from "sveast";
import { parse } from "svelte/compiler";

export type Component = { path: string; source: string };

const ROOT = existsSync(join(process.cwd(), "tests/corpus"))
  ? process.cwd()
  : join(import.meta.dir, "..");
const CORPUS = join(ROOT, "tests/corpus");
export const LANG_TS = /<script[^>]*\blang=["']?ts\b/;

const parses = (source: string) => {
  try {
    parse(source, { modern: true });
    return true;
  } catch {
    return false;
  }
};

function read(dir: string, extensions: string[]): Component[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((path) => extensions.some((extension) => path.endsWith(extension)))
    .sort()
    .map((path) => ({
      path: path.replaceAll("\\", "/"),
      source: readFileSync(join(dir, path), "utf8"),
    }));
}

const ALL = read(CORPUS, [".svelte"]);

export const COMPONENTS: Component[] = ALL.filter(({ source }) =>
  parses(source),
);

export const REJECTED: Component[] = ALL.filter(
  ({ source }) => !parses(source),
);

export const TYPESCRIPT = COMPONENTS.filter(({ source }) =>
  LANG_TS.test(source),
);

export const LARGEST = COMPONENTS.reduce((a, b) =>
  b.source.length > a.source.length ? b : a,
);

const CARBON = join(CORPUS, "carbon");

export const CARBON_LARGEST = read(CARBON, [".svelte"])
  .sort((a, b) => b.source.length - a.source.length)
  .slice(0, 5);

const modules = (extension: string, typescript: boolean) =>
  read(CARBON, [extension]).filter(({ source }) => {
    try {
      parseModule(source, { typescript });
      return true;
    } catch {
      return false;
    }
  });

export const CARBON_JS = modules(".js", false);

export const CARBON_TS = modules(".ts", true);

export const kb = (components: Component[]) =>
  `${Math.round(components.reduce((n, c) => n + c.source.length, 0) / 1000)} kB`;
