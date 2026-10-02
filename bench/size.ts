import { rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { $, build, gzipSync } from "bun";

const dist = resolve(import.meta.dir, "../dist");

const BUNDLES: [string, string][] = [
  ["svelte/compiler", 'export { parse } from "svelte/compiler";'],
  ["sveast", `export { parse } from "${dist}/index.js";`],
  [
    "sveast/core, createParser()",
    `export { createParser } from "${dist}/core.js";`,
  ],
];

const kb = (bytes: number) => `${(bytes / 1000).toFixed(1)} kB`;

async function bundle(entry: string, code: string): Promise<string> {
  writeFileSync(entry, code);
  const result = await build({
    entrypoints: [entry],
    minify: true,
    target: "browser",
  });
  if (!result.success) throw new AggregateError(result.logs, entry);
  const texts = await Promise.all(
    result.outputs.map((output) => output.text()),
  );
  return texts.join("");
}

await $`bun run build`.quiet();
const entries = BUNDLES.map((_, i) =>
  join(import.meta.dir, `.size-entry-${i}.js`),
);
try {
  const texts = await Promise.all(
    BUNDLES.map(([, code], i) => bundle(entries[i] as string, code)),
  );
  console.log("parse alone, bundled and minified with Bun for the browser\n");
  for (const [i, [name]] of BUNDLES.entries()) {
    const text = texts[i] as string;
    console.log(
      `${name.padEnd(30)}${kb(text.length).padStart(10)} minified${kb(gzipSync(text).length).padStart(10)} gzipped`,
    );
  }
} finally {
  for (const entry of entries) rmSync(entry, { force: true });
}
