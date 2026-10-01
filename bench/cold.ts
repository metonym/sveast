import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PARSERS = ["sveast", "svelte/compiler"];
const PROCESSES = 7;
const FIRST = ["template", "typescript"] as const;

const [name, corpusFile, first] = process.argv.slice(2);

if (name === undefined) {
  const { COMPONENTS, LARGEST, TYPESCRIPT } = await import("./corpus");
  const ts = TYPESCRIPT.reduce((a, b) =>
    b.source.length > a.source.length ? b : a,
  );
  const file = join(tmpdir(), "sveast-bench-cold.json");
  writeFileSync(
    file,
    JSON.stringify({
      template: LARGEST.source,
      typescript: ts.source,
      sources: COMPONENTS.map((c) => c.source),
    }),
  );
  console.log(
    `Median of ${PROCESSES} fresh processes each: module load, first parse (${LARGEST.path}, or the lang="ts" ${ts.path}), then the whole corpus once\n`,
  );
  for (const parser of PARSERS) {
    const runs = FIRST.map((kind) =>
      Array.from({ length: PROCESSES }, () => {
        const child = spawnSync(
          process.execPath,
          [import.meta.path, parser, file, kind],
          { encoding: "utf8" },
        );
        if (child.status !== 0) throw new Error(child.stderr);
        const timings: Record<string, number> = JSON.parse(child.stdout);
        return timings;
      }),
    );
    const median = (values: number[]) =>
      values.sort((a, b) => a - b)[values.length >> 1];
    const [template, typescript] = runs;
    const load = median(runs.flat().map((run) => run.load));
    const firstTemplate = median(template.map((run) => run.first));
    const firstTs = median(typescript.map((run) => run.first));
    const corpus = median(template.map((run) => run.corpus));
    console.log(
      `${parser.padEnd(18)}load ${load.toFixed(1)} ms, first parse ${firstTemplate.toFixed(1)} ms (template) / ${firstTs.toFixed(1)} ms (lang="ts"), corpus ${corpus.toFixed(1)} ms`,
    );
  }
} else {
  const inputs = JSON.parse(readFileSync(corpusFile, "utf8"));
  const t0 = Bun.nanoseconds();
  const parse: (source: string) => object =
    name === "sveast"
      ? (await import("sveast")).parse
      : await import("svelte/compiler").then(
          ({ parse: svelteParse }) =>
            (source: string) =>
              svelteParse(source, { modern: true }),
        );
  const t1 = Bun.nanoseconds();
  parse(inputs[first]);
  const t2 = Bun.nanoseconds();
  for (const source of inputs.sources) parse(source);
  const t3 = Bun.nanoseconds();
  console.log(
    JSON.stringify({
      load: (t1 - t0) / 1e6,
      first: (t2 - t1) / 1e6,
      corpus: (t3 - t2) / 1e6,
    }),
  );
}
