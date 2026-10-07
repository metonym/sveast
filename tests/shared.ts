import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { Parser } from "acorn";
import { type AST, parse, parseModule } from "sveast";
import { parse as svelteParse } from "svelte/compiler";
import { MODULE_FILES } from "../scripts/lexed";
import {
  attempt,
  collectFiles,
  errorMessage,
  isRecord,
  LOC_KEYS,
  plain,
} from "../scripts/shared";
import { SNIPPETS } from "./ts-snippets";

export const CORPUS = join(import.meta.dir, "corpus");

export function corpusFiles(pattern: RegExp, dir = CORPUS): string[] {
  return collectFiles([dir], pattern).map((file) => relative(dir, file));
}

export function readCorpus(file: string, dir = CORPUS): string {
  return readFileSync(join(dir, file), "utf8");
}

export function corpusAsts(options: { loc?: boolean } = {}): AST.SvelteNode[] {
  const asts = corpusFiles(MODULE_FILES).flatMap((file) => {
    const source = readCorpus(file);
    const ast = attempt(() =>
      file.endsWith(".svelte")
        ? parse(source, options)
        : parseModule(source, { ...options, typescript: file.endsWith(".ts") }),
    );
    return ast ? [ast] : [];
  });
  for (const snippet of Object.values(SNIPPETS)) {
    asts.push(parseModule(snippet, { ...options, typescript: true }));
  }
  return asts;
}

export function* mutated(
  texts: readonly string[],
  edits: readonly string[],
  count: number,
  length = 4000,
): Generator<[text: string, index: number]> {
  let seed = 1;
  const random = (n: number) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  for (let trial = 0; trial < count; trial++) {
    const index = random(texts.length);
    let text = texts[index].slice(0, length);
    for (let n = 1 + random(3); n > 0; n--) {
      const at = random(text.length + 1);
      const edit = edits[random(edits.length)];
      const removed = random(3) === 0 ? 0 : 1 + random(5);
      text = text.slice(0, at) + edit + text.slice(at + removed);
    }
    yield [text, index];
  }
}

export function* singleEdits(
  texts: readonly string[],
  inserts: readonly string[],
): Generator<string> {
  for (const text of texts) {
    for (let i = 0; i <= text.length; i++) {
      yield text.slice(0, i) + text.slice(i + 1);
      for (const insert of inserts) {
        yield text.slice(0, i) + insert + text.slice(i);
      }
    }
  }
}

export function outcome(run: () => object, drop?: ReadonlySet<string>) {
  try {
    return { ast: plain(run(), drop) };
  } catch (thrown) {
    if (!isRecord(thrown)) throw thrown;
    const { code, message, position, start, end, frame } = thrown;
    return { error: { code, message, position, start, end, frame } };
  }
}

export function svelteParity(source: string) {
  const theirs = () => svelteParse(source, { modern: true });
  return {
    ours: [
      outcome(() => parse(source, { loc: true })),
      outcome(() => parse(source)),
    ],
    theirs: [outcome(theirs), outcome(theirs, LOC_KEYS)],
  };
}

export function acornOutcome(
  ParserClass: typeof Parser,
  source: string,
  options: Parameters<typeof Parser.parse>[1],
): string {
  try {
    ParserClass.parse(source, options);
    return "ok";
  } catch (error) {
    return errorMessage(error);
  }
}
