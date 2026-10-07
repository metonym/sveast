import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { $ } from "bun";
import { parse } from "../src/index";
import { collectFiles, errorCode, isRecord, SVELTE_FILES } from "./shared";

const ROOT = join(import.meta.dir, "..");
const CORPUS = join(ROOT, "tests/corpus");
const apply = process.argv.includes("--apply");
const work = mkdtempSync(join(tmpdir(), "sveast-minimize-"));
const probe = join(work, "probe.test.ts");
writeFileSync(
  probe,
  `import { readFileSync } from "node:fs";
import { parse } from ${JSON.stringify(join(ROOT, "src/index.ts"))};
test("parse", () => {
  const source = readFileSync(process.env.FILE ?? "", "utf8");
  for (const options of [undefined, { loc: true }, { css: false }]) {
    try {
      parse(source, options);
    } catch {}
  }
});
`,
);

const files = collectFiles([CORPUS], SVELTE_FILES).map((file) =>
  relative(CORPUS, file),
);
const FUZZ_FIXTURE = /(^|\/)fuzz-/;
const alwaysKeep = (f: string) =>
  f.startsWith("carbon/") || FUZZ_FIXTURE.test(f);

async function lines(file: string, i: number): Promise<Set<string>> {
  const dir = join(work, String(i));
  await $`FILE=${join(CORPUS, file)} bun test ${probe} --coverage --coverage-reporter=lcov --coverage-dir=${dir}`
    .cwd(ROOT)
    .quiet()
    .nothrow();
  const out = new Set<string>();
  let sf = "";
  for (const line of readFileSync(`${dir}/lcov.info`, "utf8").split("\n")) {
    if (line.startsWith("SF:")) sf = line.slice(3);
    else if (line.startsWith("DA:") && !sf.includes("html-entities-data")) {
      const [n, hits] = line.slice(3).split(",");
      if (Number(hits) > 0) out.add(`${sf}:${n}`);
    }
  }
  return out;
}

function shapes(source: string): Set<string> {
  const out = new Set<string>();
  try {
    const visit = (node: unknown) => {
      if (Array.isArray(node)) return node.forEach(visit);
      if (!isRecord(node)) return;
      const record = node;
      const type = typeof record.type === "string" ? record.type : "?";
      out.add(`node:${type}`);
      for (const [key, value] of Object.entries(record)) {
        if (value === null || value === undefined || key === "loc") continue;
        out.add(`key:${type}.${key}`);
        visit(value);
      }
    };
    visit(parse(source, { loc: true }));
  } catch (error) {
    out.add(`error:${errorCode(error)}`);
  }
  return out;
}

const features = new Map<string, Set<string>>();
const queue = files.map((f, i) => [f, i] as const);
const workers = Array.from({ length: 8 }, async () => {
  for (let next = queue.shift(); next; next = queue.shift()) {
    const [file, i] = next;
    // biome-ignore lint/performance/noAwaitInLoops: each worker runs its probes one at a time
    const set = await lines(file, i);
    for (const s of shapes(readFileSync(join(CORPUS, file), "utf8")))
      set.add(s);
    features.set(file, set);
  }
});
await Promise.all(workers);

const covered = new Set<string>();
const kept = files.filter(alwaysKeep);
for (const f of kept) for (const s of features.get(f) ?? []) covered.add(s);
const baseline = covered.size;

const size = (f: string) => readFileSync(join(CORPUS, f)).length;
let candidates = files.filter((f) => !alwaysKeep(f));
for (;;) {
  let best: string | undefined;
  let bestGain = 0;
  for (const f of candidates) {
    let gain = 0;
    for (const s of features.get(f) ?? []) if (!covered.has(s)) gain++;
    if (
      gain > bestGain ||
      (gain === bestGain && gain > 0 && best && size(f) < size(best))
    ) {
      best = f;
      bestGain = gain;
    }
  }
  if (!best) break;
  kept.push(best);
  for (const s of features.get(best) ?? []) covered.add(s);
  candidates = candidates.filter((f) => f !== best);
}

const all = new Set<string>();
for (const set of features.values()) for (const s of set) all.add(s);
console.log(
  `${files.length} files, ${all.size} features. Always kept: ${files.filter(alwaysKeep).length} (${baseline} features). Kept after greedy: ${kept.length} (${covered.size} features). Redundant: ${candidates.length}.`,
);
const byDir = new Map<string, number>();
for (const f of candidates) {
  const d = f.split("/").slice(0, 2).join("/");
  byDir.set(d, (byDir.get(d) ?? 0) + 1);
}
console.log(
  [...byDir]
    .sort((a, b) => b[1] - a[1])
    .map(([d, n]) => `  ${n} ${d}`)
    .join("\n"),
);
if (apply) for (const f of candidates) rmSync(join(CORPUS, f));
rmSync(work, { recursive: true, force: true });
