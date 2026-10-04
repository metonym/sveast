import { group, task } from "ostia";
import {
  type AST,
  isRunesMode,
  lexComponent,
  lexImportsExports,
  lexStrings,
  markupVisitorKeys,
  ParseError,
  type ParseOptions,
  parse,
  parseImportsExports,
  parseModule,
  parseSections,
  type VisitorKeys,
  walk,
} from "sveast";
import {
  CARBON_COMPONENTS,
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
import {
  CONSTRUCTS,
  flat,
  LONG_NAME_BARREL,
  SVELTE_OPTIONS_COMPONENTS,
} from "./workloads";

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
  parseTask("all components, comments: false", CARBON_COMPONENTS, {
    comments: false,
  });
  parseTask("all components, script: false", CARBON_COMPONENTS, {
    comments: false,
    script: false,
  });
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
    "barrel of long names",
    [LONG_NAME_BARREL],
    { typescript: false },
    `500 re-exports, ${Math.round(LONG_NAME_BARREL.length / 1000)} kB`,
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

group("parseImportsExports", () => {
  const importsTask = (
    name: string,
    inputs: string[],
    typescript: boolean,
    description: string,
    localExports = true,
  ) => {
    const options = { typescript, localExports };
    mustParse(name, inputs, (source) => parseImportsExports(source, options));
    const run = () =>
      inputs.map((source) => parseImportsExports(source, options));
    task(
      name,
      lean(run, (lists) => lists.length),
      { description },
    );
  };

  const sources = (modules: Component[]) => modules.map((m) => flat(m.source));
  importsTask("carbon .js", sources(CARBON_JS), false, kb(CARBON_JS));
  importsTask("carbon .d.ts", sources(CARBON_TS), true, kb(CARBON_TS));
  const scripts = CARBON_COMPONENTS.flatMap(({ source }) =>
    scriptTexts(source).map(flat),
  );
  const scriptsKb = `${scripts.length} scripts, ${Math.round(scripts.join("").length / 1000)} kB`;
  importsTask("carbon scripts", scripts, false, scriptsKb);
  importsTask(
    "carbon scripts, localExports: false",
    scripts,
    false,
    scriptsKb,
    false,
  );
  const largest = scripts.reduce((a, b) => (b.length > a.length ? b : a));
  importsTask(
    "largest carbon script",
    [largest],
    false,
    `${Math.round(largest.length / 1000)} kB`,
  );
});

group("lexImportsExports", () => {
  const lexTask = (name: string, inputs: string[], description: string) => {
    const run = () => inputs.map(lexImportsExports);
    task(
      name,
      lean(run, (lists) => lists.length),
      { description },
    );
  };

  const sources = (modules: Component[]) => modules.map((m) => flat(m.source));
  lexTask("carbon .js", sources(CARBON_JS), kb(CARBON_JS));
  lexTask("carbon .d.ts", sources(CARBON_TS), kb(CARBON_TS));
  const scripts = CARBON_COMPONENTS.flatMap(({ source }) =>
    scriptTexts(source).map(flat),
  );
  lexTask(
    "carbon scripts",
    scripts,
    `${scripts.length} scripts, ${Math.round(scripts.join("").length / 1000)} kB`,
  );
  const largest = scripts.reduce((a, b) => (b.length > a.length ? b : a));
  lexTask(
    "largest carbon script",
    [largest],
    `${Math.round(largest.length / 1000)} kB`,
  );
});

group("lexStrings", () => {
  const lexTask = (name: string, inputs: string[], description: string) => {
    const run = () => inputs.map(lexStrings);
    task(
      name,
      lean(run, (lists) => lists.length),
      { description },
    );
  };

  lexTask(
    "carbon .js",
    CARBON_JS.map((m) => flat(m.source)),
    kb(CARBON_JS),
  );
  const scripts = CARBON_COMPONENTS.flatMap(({ source }) =>
    scriptTexts(source).map(flat),
  );
  lexTask(
    "carbon scripts",
    scripts,
    `${scripts.length} scripts, ${Math.round(scripts.join("").length / 1000)} kB`,
  );
});

group("lexComponent", () => {
  const lexTask = (name: string, components: Component[]) => {
    const sources = components.map((c) => flat(c.source));
    const run = () => sources.map(lexComponent);
    task(
      name,
      lean(run, (lexed) => lexed.length),
      { description: `${components.length} files, ${kb(components)}` },
    );
  };

  lexTask("all files", COMPONENTS);
  lexTask("carbon largest", CARBON_LARGEST);
});

group("parseSections", () => {
  const sources = COMPONENTS.map((c) => flat(c.source));
  mustParse("parseSections", sources, (source) => parseSections(source));
  task(
    "all files",
    lean(
      () => sources.map((source) => parseSections(source)),
      (asts) => asts.length,
    ),
    { description: `${COMPONENTS.length} files, ${kb(COMPONENTS)}` },
  );
});

group("isRunesMode", () => {
  const sources = COMPONENTS.map((c) => flat(c.source));
  mustParse("isRunesMode", sources, (source) => ({
    runes: isRunesMode(source),
  }));
  task("all files", () => sources.filter(isRunesMode).length, {
    description: `${COMPONENTS.length} files, ${kb(COMPONENTS)}`,
  });
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

group("walk", () => {
  const walkTask = (
    name: string,
    nodes: AST.SvelteNode[],
    keys?: VisitorKeys,
  ) => {
    let count = 0;
    const visitor = {
      enter() {
        count++;
      },
    };
    const run = () => {
      count = 0;
      for (const node of nodes) walk(node, visitor, keys);
      return count;
    };
    task(name, run, { description: `${run()} nodes` });
  };

  const carbon = CARBON_COMPONENTS.map(({ source }) => parse(flat(source)));
  walkTask(
    "carbon module, instance and fragment",
    carbon.flatMap(({ module, instance, fragment }) =>
      [module, instance, fragment].filter((node) => node !== undefined),
    ),
  );
  const corpus = COMPONENTS.map(({ source }) => parse(flat(source)));
  walkTask("corpus files", corpus);
  walkTask("corpus files, markupVisitorKeys", corpus, markupVisitorKeys);
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
