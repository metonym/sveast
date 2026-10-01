import { heapStats } from "bun:jsc";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PARSERS = ["sveast", "sveast, loc: true", "svelte/compiler"];
const COPIES = 10;
const PROCESSES = 3;

const [name, corpusFile] = process.argv.slice(2);

if (name === undefined) {
  const { COMPONENTS, kb } = await import("./corpus");
  const file = join(tmpdir(), "sveast-bench-mem.json");
  writeFileSync(file, JSON.stringify(COMPONENTS.map((c) => c.source)));
  console.log(
    `${COMPONENTS.length} components (${kb(COMPONENTS)}) parsed ${COPIES} times, ASTs kept alive; median of ${PROCESSES} processes\n`,
  );
  for (const parser of PARSERS) {
    const readings = Array.from({ length: PROCESSES }, () => {
      const child = spawnSync(
        process.execPath,
        [import.meta.path, parser, file],
        { encoding: "utf8" },
      );
      if (child.status !== 0) throw new Error(child.stderr);
      return JSON.parse(child.stdout).mb as number;
    });
    const mb = readings.sort((a, b) => a - b)[PROCESSES >> 1];
    console.log(`${parser.padEnd(20)}${mb.toFixed(1).padStart(8)} MB retained`);
  }
} else {
  const sources: string[] = JSON.parse(readFileSync(corpusFile, "utf8"));
  const parse: (source: string) => unknown = name.startsWith("sveast")
    ? await import("sveast").then(
        ({ parse }) =>
          (source: string) =>
            parse(source, { loc: name.includes("loc") }),
      )
    : await import("svelte/compiler").then(
        ({ parse }) =>
          (source: string) =>
            parse(source, { modern: true }),
      );
  for (const source of sources.slice(0, 50)) parse(source);

  Bun.gc(true);
  const before = heapStats().heapSize;
  const asts: unknown[] = [];
  for (let i = 0; i < COPIES; i++) {
    for (const source of sources) asts.push(parse(source));
  }
  Bun.gc(true);
  const after = heapStats().heapSize;
  console.log(
    JSON.stringify({ mb: (after - before) / 1e6, asts: asts.length }),
  );
}
