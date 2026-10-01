import { group, task } from "ostia";
import { ParseError, type ParseOptions, parse, parseModule } from "sveast";
import {
  CARBON_JS,
  CARBON_LARGEST,
  CARBON_TS,
  COMPONENTS,
  type Component,
  kb,
  LARGEST,
  REJECTED,
  scriptTexts,
  TYPESCRIPT,
} from "./corpus";
import { CONSTRUCTS, flat, SVELTE_OPTIONS_COMPONENTS } from "./workloads";

function mustParse(
  name: string,
  sources: string[],
  run: (source: string) => object,
): void {
  for (const source of sources) {
    try {
      run(source);
    } catch (error) {
      throw new Error(`"${name}" must parse, but threw: ${error}`, {
        cause: error,
      });
    }
  }
}

function mustThrow(name: string, sources: string[]): void {
  for (const source of sources) {
    try {
      parse(source);
    } catch (error) {
      if (error instanceof ParseError) continue;
      throw new Error(
        `"${name}" threw something other than a ParseError: ${error}`,
        { cause: error },
      );
    }
    throw new Error(`"${name}" must throw a ParseError, but parsed`);
  }
}

function errorCodes(sources: string[]): string[] {
  const codes: string[] = [];
  for (const source of sources) {
    try {
      parse(source);
    } catch (error) {
      if (!(error instanceof ParseError)) throw error;
      codes.push(error.code);
    }
  }
  return codes;
}

function lean<T>(
  run: () => T,
  digest: (result: T) => number,
): () => T | number {
  let first = true;
  return () => {
    const result = run();
    if (!first) return digest(result);
    first = false;
    return result;
  };
}

function parseTask(
  name: string,
  components: Component[],
  options?: ParseOptions,
  description = `${components.length} files, ${kb(components)}`,
) {
  const sources = components.map((c) => flat(c.source));
  mustParse(name, sources, (source) => parse(source, options));
  const run = () => sources.map((source) => parse(source, options));
  task(
    name,
    lean(run, (asts) => asts.length),
    { description },
  );
}

group("corpus", () => {
  parseTask("all files", COMPONENTS);
  parseTask("all files, loc: true", COMPONENTS, { loc: true });
  parseTask('lang="ts" files', TYPESCRIPT);
  parseTask(
    "largest file",
    [LARGEST],
    undefined,
    `${LARGEST.path}, ${kb([LARGEST])}`,
  );
});

group("carbon", () => {
  for (const component of CARBON_LARGEST) {
    parseTask(component.path, [component], undefined, kb([component]));
  }
  parseTask("largest, loc: true", CARBON_LARGEST, { loc: true });
});

group("parseModule", () => {
  const moduleTask = (
    name: string,
    inputs: string[],
    options: { typescript: boolean; loc?: boolean },
    description: string,
  ) => {
    mustParse(name, inputs, (source) => parseModule(source, options));
    const run = () => inputs.map((source) => parseModule(source, options));
    task(
      name,
      lean(run, (programs) => programs.length),
      { description },
    );
  };

  const sources = (modules: Component[]) => modules.map((m) => flat(m.source));
  moduleTask(
    "carbon .js",
    sources(CARBON_JS),
    { typescript: false },
    kb(CARBON_JS),
  );
  moduleTask(
    "carbon .d.ts",
    sources(CARBON_TS),
    { typescript: true },
    kb(CARBON_TS),
  );
  moduleTask(
    "carbon .d.ts, loc: true",
    sources(CARBON_TS),
    { typescript: true, loc: true },
    kb(CARBON_TS),
  );

  const scripts = TYPESCRIPT.flatMap(({ source }) =>
    scriptTexts(source).map(flat),
  );
  moduleTask(
    'corpus lang="ts" scripts',
    scripts,
    { typescript: true },
    `${scripts.length} scripts`,
  );
});

const SIZES = [
  ["10 kB", 10_000],
  ["100 kB", 100_000],
] as const;

group("constructs", () => {
  for (const { name, build, options, deep } of CONSTRUCTS) {
    for (const [size, bytes] of SIZES) {
      const input = flat(build(bytes));
      const label = `${name} (${size})`;
      mustParse(label, [input], (source) => parse(source, options));
      const run = () => parse(input, options);
      const digest = (ast: ReturnType<typeof run>) => ast.fragment.nodes.length;
      task(label, deep ? () => digest(run()) : lean(run, digest));
    }
  }
});

group("svelte:options", () => {
  parseTask(
    "100 small components",
    SVELTE_OPTIONS_COMPONENTS.map((source, i) => ({ path: `${i}`, source })),
  );
});

group("errors", () => {
  const errorTask = (name: string, sources: string[], description: string) => {
    mustThrow(name, sources);
    task(name, () => errorCodes(sources), { description });
  };

  errorTask(
    "corpus files svelte rejects",
    REJECTED.map((c) => flat(c.source)),
    `${REJECTED.length} files, ${kb(REJECTED)}`,
  );

  const markup = CARBON_LARGEST[0];
  errorTask(
    "error at the start of a large component",
    [flat(`{:else}\n${markup.source}`)],
    `{:else} before ${markup.path}`,
  );

  const end = markup.source.lastIndexOf("</script>");
  errorTask(
    "js_parse_error at the end of a large script",
    [
      flat(
        `${markup.source.slice(0, end)}\nconst = 1;\n${markup.source.slice(end)}`,
      ),
    ],
    `\`const = 1;\` at the end of ${markup.path}'s instance script`,
  );
});
