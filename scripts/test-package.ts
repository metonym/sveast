import { readFileSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { $ } from "bun";

const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
const RELATIVE_IMPORT = /["']\.\/([^"']+\.js)["']/g;

const root = resolve(import.meta.dir, "..");
const dir = await mkdtemp(join(tmpdir(), "sveast-package-"));

try {
  await $`bun run build`.cwd(root).quiet();

  const dist = join(root, "dist");
  const bundles = (await readdir(dist)).filter((file) => file.endsWith(".js"));
  for (const file of bundles) {
    const bundle = readFileSync(join(dist, file), "utf8");
    for (const pattern of [
      /["']node:/,
      /\brequire\(/,
      /\bprocess\./,
      /\bBuffer\b/,
    ]) {
      if (pattern.test(bundle))
        throw new Error(`dist/${file} matches ${pattern}`);
    }
  }

  const reach = (entry: string): Set<string> => {
    const reached = new Set([entry]);
    for (const file of reached) {
      const code = readFileSync(join(dist, file), "utf8");
      for (const [, imported] of code.matchAll(RELATIVE_IMPORT)) {
        reached.add(imported);
      }
    }
    return reached;
  };
  if (reach("parse-module.js").has("parse.js")) {
    throw new Error("dist/parse-module.js imports the template parser");
  }
  const acorn = reach("is-valid-type.js");
  for (const file of reach("walk.js")) {
    if (file === "parse.js" || acorn.has(file)) {
      throw new Error(`dist/walk.js imports the parser: ${file}`);
    }
  }

  const holding = (marker: string) =>
    bundles.filter((file) =>
      readFileSync(join(dist, file), "utf8").includes(marker),
    );
  const optional = {
    "the TypeScript plugin": holding('"satisfies"'),
    "the entity table": holding("AElig"),
  };
  for (const [part, files] of Object.entries(optional)) {
    if (files.length !== 1) {
      throw new Error(`expected one dist file with ${part}: ${files}`);
    }
    if (reach("core.js").has(files[0])) {
      throw new Error(`dist/core.js imports ${part}: ${files[0]}`);
    }
  }

  for (const entry of ["index", "core", "typescript", "entities"]) {
    const types = readFileSync(
      join(root, `dist/${entry}.d.ts`),
      "utf8",
    ).replace(BLOCK_COMMENT, "");
    if (/^import |\bfrom ["']/m.test(types)) {
      throw new Error(`dist/${entry}.d.ts imports another package`);
    }
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
import { parse, parseModule, STOP, walk } from "sveast";
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

const classes = [];
walk(parse(source), {
  enter(node) {
    if (node.type === "ClassDirective") classes.push(node.name);
  },
});
assert.deepEqual(classes, ["big"]);

let first;
walk(parse(source), {
  enter(node) {
    if (node.type !== "Identifier") return;
    first = node.name;
    return STOP;
  },
});
assert.equal(first, "name");

const core = await import("sveast/core");
const { typescript } = await import("sveast/typescript");
const { entities } = await import("sveast/entities");
assert.equal(core.ParseError, (await import("sveast")).ParseError);
const full = core.createParser({ typescript, entities });
assert.deepEqual(plain(full.parse(source)), plain(parse(source)));
const js = core.createParser();
assert.throws(() => js.parse(source), (error) => !(error instanceof core.ParseError));
assert.equal(js.parse("<p>&copy; &amp;</p>").fragment.nodes[0].fragment.nodes[0].data, "&copy; &");
assert.equal(js.parseModule("let a = 1;").body[0].type, "VariableDeclaration");
`,
  );
  await $`node smoke.js`.cwd(dir);

  await writeFile(
    join(dir, "consumer.ts"),
    `import {
  type AST,
  type Function as AnyFunction,
  isValidType,
  type Node,
  type ParseOptions,
  type Pattern,
  type Program,
  type TSInterfaceDeclaration,
  type TSParameterProperty,
  type Visitor,
  ParseError,
  parse,
  parseModule,
  STOP,
  visitorKeys,
  walk,
} from "sveast";
import {
  type AST as CoreAST,
  createParser,
  type Parser,
  type Program as CoreProgram,
} from "sveast/core";
import { entities } from "sveast/entities";
import { typescript } from "sveast/typescript";

type CoreRoot = CoreAST.Root;

const options: ParseOptions = {
  loc: true,
  css: false,
  script: false,
  comments: false,
};
const ast: AST.Root = parse("<p>{a}</p>", options);
const first: AST.Fragment["nodes"][number] | undefined = ast.fragment.nodes[0];
const program = parseModule("let a: number = 1;", { typescript: true });
const kind: string = program.body[0].type;
const empty: [] = ast.js;
const scriptStart: number | undefined = ast.instance?.content.start;
const module: Program = parseModule("interface A extends B<C> {}", { typescript: true });
const statement = module.body[0];
if (statement.type === "TSInterfaceDeclaration") {
  const declaration: TSInterfaceDeclaration = statement;
  const argument: string | undefined = declaration.extends?.[0].typeParameters?.params[0].type;
  void argument;
}
const node: Node = module;
const span: number = node.end - node.start;
void empty;
void scriptStart;
void span;
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

const exported = parseModule("export function f(a) {}").body[0];
if (exported.type === "ExportNamedDeclaration" && exported.declaration?.type === "FunctionDeclaration") {
  const params: Pattern[] = exported.declaration.params;
  void params;
}
const paramsOf = (fn: AnyFunction): Array<Pattern | TSParameterProperty> => fn.params;
void paramsOf;
const inline: boolean = isValidType("string // a", { inline: true });
void inline;

const ifKeys: readonly ["test", "consequent", "alternate"] = visitorKeys.IfBlock;
void ifKeys;
const visitor: Visitor = {
  enter(node, parent) {
    if (node.type === "IfBlock" && parent?.type === "Fragment") {
      const test: Node = node.test;
      void test;
      return false;
    }
  },
  leave(node) {
    if (node.type === "Fragment") return STOP;
  },
};
walk(ast, visitor);

// @ts-expect-error: parse takes a string
parse(1);

const parser: Parser = createParser({ typescript, entities });
const coreAst: CoreRoot = parser.parse("<p>{a}</p>", { comments: false });
const coreProgram: CoreProgram = parser.parseModule("let a;", { typescript: true });
const fromSveast: AST.Root = coreAst;
void coreProgram;
void fromSveast;
// @ts-expect-error: typescript comes from sveast/typescript
createParser({ typescript: true });
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
