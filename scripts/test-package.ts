import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { $ } from "bun";

const root = resolve(import.meta.dir, "..");
const dir = await mkdtemp(join(tmpdir(), "sveast-package-"));

try {
  await $`bun run build`.cwd(root).quiet();

  const bundle = await readFile(join(root, "dist/index.js"), "utf8");
  for (const pattern of [
    /["']node:/,
    /\brequire\(/,
    /\bprocess\./,
    /\bBuffer\b/,
  ]) {
    if (pattern.test(bundle))
      throw new Error(`dist/index.js matches ${pattern}`);
  }

  const types = await readFile(join(root, "dist/index.d.ts"), "utf8");
  if (/^import |\bfrom ["']/m.test(types)) {
    throw new Error("dist/index.d.ts imports another package");
  }
  const manifest = JSON.parse(
    await readFile(join(root, "dist/package.json"), "utf8"),
  );
  for (const field of [
    "dependencies",
    "peerDependencies",
    "optionalDependencies",
  ]) {
    if (manifest[field]) throw new Error(`dist/package.json has ${field}`);
  }

  const packed = await $`npm pack --pack-destination ${dir} --silent`
    .cwd(join(root, "dist"))
    .text();
  const tarball = join(dir, packed.trim());

  const svelte = await Bun.file(
    join(root, "node_modules/svelte/package.json"),
  ).json();
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({ name: "consumer", private: true, type: "module" }),
  );
  await $`npm install ${tarball} svelte@${svelte.version} --no-audit --no-fund --silent`.cwd(
    dir,
  );

  await writeFile(
    join(dir, "smoke.js"),
    `import assert from "node:assert/strict";
import { parse, parseModule } from "sveast";
import { parse as svelteParse } from "svelte/compiler";

const source = \`<script lang="ts">
  let { name }: { name: string } = $props();
</script>

{#if name}<h1 class:big={name.length > 3}>Hello {name}!</h1>{/if}
\`;
const plain = (value) => JSON.parse(JSON.stringify(value));
assert.deepEqual(
  plain(parse(source, { loc: true })),
  plain(svelteParse(source, { modern: true })),
);
assert.equal(parse(source).instance.content.body[0].type, "VariableDeclaration");

assert.throws(() => parse("{x"), { name: "ParseError", code: "expected_token" });
assert.equal(parseModule("let a: number;", { typescript: true }).body[0].type, "VariableDeclaration");
`,
  );
  await $`node smoke.js`.cwd(dir);

  await writeFile(
    join(dir, "consumer.ts"),
    `import { type AST, type ParseOptions, ParseError, parse, parseModule } from "sveast";

const options: ParseOptions = { loc: true, css: false };
const ast: AST.Root = parse("<p>{a}</p>", options);
const first: AST.Fragment["nodes"][number] | undefined = ast.fragment.nodes[0];
const program = parseModule("let a: number = 1;", { typescript: true });
const kind: string = program.body[0].type;
try {
  parse("{");
} catch (error) {
  if (error instanceof ParseError) {
    const code: string = error.code;
    const line: number | undefined = error.start?.line;
    void code;
    void line;
  }
}
void first;
void kind;

// @ts-expect-error: parse takes a string
parse(1);
`,
  );
  const tsc = join(root, "node_modules/.bin/tsc");
  await $`${tsc} --noEmit --strict --module nodenext --moduleResolution nodenext --target es2022 --skipLibCheck false consumer.ts`.cwd(
    dir,
  );

  console.log("✓ Package works in Node and type-checks for consumers");
} finally {
  await rm(dir, { recursive: true, force: true });
}
