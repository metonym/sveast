import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseModule, parse as sveastParse } from "sveast";
import { parse } from "svelte/compiler";

export interface Component {
  path: string;
  source: string;
}

const ROOT = existsSync(join(process.cwd(), "tests/corpus"))
  ? process.cwd()
  : join(import.meta.dir, "..");
const CORPUS = join(ROOT, "tests/corpus");
export const LANG_TS = /<script[^>]*\blang=["']?ts\b/;

export function scriptTexts(source: string): string[] {
  const { instance, module } = sveastParse(source);
  return [instance, module].flatMap((script) => {
    if (!script) return [];
    const { content } = script;
    if (
      !("start" in content && typeof content.start === "number") ||
      !("end" in content && typeof content.end === "number")
    ) {
      throw new Error("a script's program has no start and end");
    }
    return [source.slice(content.start, content.end)];
  });
}

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

export const CARBON_COMPONENTS = read(CARBON, [".svelte"]).filter(
  ({ source }) => parses(source),
);

export const CARBON_LARGEST = [...CARBON_COMPONENTS]
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

export const kbOf = (sources: string[]) =>
  `${Math.round(sources.reduce((n, source) => n + source.length, 0) / 1000)} kB`;

export const kb = (components: Component[]) =>
  kbOf(components.map((c) => c.source));

const JSDOC_TAG =
  /@(?:type|param|returns?|property|typedef|prop|template|satisfies)\s*\{/g;

export function jsdocTypes(source: string): string[] {
  const types: string[] = [];
  for (const { index, 0: tag } of source.matchAll(JSDOC_TAG)) {
    const start = index + tag.length;
    let depth = 1;
    let i = start;
    for (; i < source.length && depth > 0; i++) {
      if (source[i] === "{") depth++;
      else if (source[i] === "}") depth--;
    }
    if (depth === 0) types.push(source.slice(start, i - 1));
  }
  return types;
}
