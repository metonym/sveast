import { group, task } from "ostia";
import {
  type AST,
  createLocator,
  extractIdentifiers,
  isReference,
  isRunesMode,
  isValidType,
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
import { createParser } from "sveast/core";
import { createModuleParser } from "sveast/module";
import { isCommonType } from "../src/common-type";
import {
  CARBON_COMPONENTS,
  CARBON_JS,
  CARBON_LARGEST,
  CARBON_TS,
  COMPONENTS,
  type Component,
  jsdocTypes,
  kb,
  kbOf,
  LANG_TS,
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

const sourcesOf = (components: Component[]) =>
  components.map((c) => flat(c.source));

const filesDescription = (components: Component[]) =>
  `${components.length} files, ${kb(components)}`;

const scriptsDescription = (scripts: string[]) =>
  `${scripts.length} scripts, ${kbOf(scripts)}`;

const largest = (sources: string[]) =>
  sources.reduce((a, b) => (b.length > a.length ? b : a));

function mustRun<T>(
  name: string,
  inputs: T[],
  run: (input: T) => unknown,
): void {
  for (const input of inputs) {
    try {
      run(input);
    } catch (error) {
      throw new Error(`"${name}" must parse, but threw: ${error}`, {
        cause: error,
      });
    }
  }
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

function mapTask<T>(
  name: string,
  inputs: T[],
  run: (input: T) => unknown,
  description: string,
): void {
  mustRun(name, inputs, run);
  task(
    name,
    lean(
      () => inputs.map(run),
      (results) => results.length,
    ),
    { description },
  );
}

function parseTask(
  name: string,
  components: Component[],
  options?: ParseOptions,
  description = filesDescription(components),
): void {
  mapTask(
    name,
    sourcesOf(components),
    (source) => parse(source, options),
    description,
  );
}

const CARBON_SCRIPTS = CARBON_COMPONENTS.flatMap(({ source }) =>
  scriptTexts(source).map(flat),
);
const LARGEST_CARBON_SCRIPT = largest(CARBON_SCRIPTS);

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
  parseTask("all components", CARBON_COMPONENTS);
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
    options: { typescript: boolean; loc?: boolean; comments?: boolean },
    description: string,
  ) =>
    mapTask(
      name,
      inputs,
      (source) => parseModule(source, options),
      description,
    );

  moduleTask(
    "carbon .js",
    sourcesOf(CARBON_JS),
    { typescript: false },
    kb(CARBON_JS),
  );
  moduleTask(
    "barrel of long names",
    [LONG_NAME_BARREL],
    { typescript: false },
    `500 re-exports, ${kbOf([LONG_NAME_BARREL])}`,
  );
  moduleTask(
    "carbon .d.ts",
    sourcesOf(CARBON_TS),
    { typescript: true },
    kb(CARBON_TS),
  );
  moduleTask(
    "carbon .d.ts, loc: true",
    sourcesOf(CARBON_TS),
    { typescript: true, loc: true },
    kb(CARBON_TS),
  );
  moduleTask(
    "carbon .d.ts, comments: false",
    sourcesOf(CARBON_TS),
    { typescript: true, comments: false },
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
    mapTask(
      name,
      inputs,
      (source) => parseImportsExports(source, options),
      description,
    );
  };

  importsTask("carbon .js", sourcesOf(CARBON_JS), false, kb(CARBON_JS));
  importsTask("carbon .d.ts", sourcesOf(CARBON_TS), true, kb(CARBON_TS));
  importsTask(
    "carbon scripts",
    CARBON_SCRIPTS,
    false,
    scriptsDescription(CARBON_SCRIPTS),
  );
  importsTask(
    "carbon scripts, localExports: false",
    CARBON_SCRIPTS,
    false,
    scriptsDescription(CARBON_SCRIPTS),
    false,
  );
  importsTask(
    "largest carbon script",
    [LARGEST_CARBON_SCRIPT],
    false,
    kbOf([LARGEST_CARBON_SCRIPT]),
  );
});

group("lexImportsExports", () => {
  mapTask("carbon .js", sourcesOf(CARBON_JS), lexImportsExports, kb(CARBON_JS));
  mapTask(
    "carbon .d.ts",
    sourcesOf(CARBON_TS),
    lexImportsExports,
    kb(CARBON_TS),
  );
  mapTask(
    "carbon scripts",
    CARBON_SCRIPTS,
    lexImportsExports,
    scriptsDescription(CARBON_SCRIPTS),
  );
  mapTask(
    "largest carbon script",
    [LARGEST_CARBON_SCRIPT],
    lexImportsExports,
    kbOf([LARGEST_CARBON_SCRIPT]),
  );
});

group("lexStrings", () => {
  mapTask("carbon .js", sourcesOf(CARBON_JS), lexStrings, kb(CARBON_JS));
  mapTask("carbon .d.ts", sourcesOf(CARBON_TS), lexStrings, kb(CARBON_TS));
  mapTask(
    "carbon scripts",
    CARBON_SCRIPTS,
    lexStrings,
    scriptsDescription(CARBON_SCRIPTS),
  );
});

group("lexComponent", () => {
  for (const [name, components] of [
    ["all files", COMPONENTS],
    ["carbon largest", CARBON_LARGEST],
    ["carbon components", CARBON_COMPONENTS],
  ] as const) {
    mapTask(
      name,
      sourcesOf(components),
      lexComponent,
      filesDescription(components),
    );
  }
});

group("parseSections", () => {
  for (const [name, components] of [
    ["all files", COMPONENTS],
    ["carbon components", CARBON_COMPONENTS],
  ] as const) {
    mapTask(
      name,
      sourcesOf(components),
      (source) => parseSections(source),
      filesDescription(components),
    );
  }
});

group("isRunesMode", () => {
  for (const [name, components] of [
    ["all files", COMPONENTS],
    ["carbon components", CARBON_COMPONENTS],
  ] as const) {
    const sources = sourcesOf(components);
    mustRun(name, sources, isRunesMode);
    task(name, () => sources.filter(isRunesMode).length, {
      description: filesDescription(components),
    });
  }
});

group("isValidType", () => {
  const types = [
    ...new Set(
      [...COMPONENTS, ...CARBON_JS].flatMap(({ source }) =>
        jsdocTypes(source).map(flat),
      ),
    ),
  ];
  const uncommon = types.filter((type) => !isCommonType(type));
  const typesTask = (name: string, inputs: string[], inline: boolean) =>
    task(name, () => inputs.filter((type) => isValidType(type, { inline })), {
      description: `${inputs.length} types`,
    });

  typesTask("corpus JSDoc types", types, false);
  typesTask("corpus JSDoc types, inline: true", types, true);
  typesTask("JSDoc types the fast path leaves to the parser", uncommon, false);
});

const CORPUS_ASTS = COMPONENTS.map(({ source }) => parse(flat(source)));

group("analysis", () => {
  const starts = COMPONENTS.map(({ source }, i) => {
    const offsets: number[] = [];
    walk(CORPUS_ASTS[i], {
      enter(node) {
        if ("start" in node) offsets.push(node.start);
      },
    });
    return { source: flat(source), offsets };
  });
  task(
    "createLocator, every node's start",
    () => {
      let lines = 0;
      for (const { source, offsets } of starts) {
        const locate = createLocator(source);
        for (const offset of offsets) lines += locate(offset).line;
      }
      return lines;
    },
    {
      description: `${starts.reduce((n, { offsets }) => n + offsets.length, 0)} nodes`,
    },
  );

  const identifiers: [AST.SvelteNode, AST.SvelteNode | null][] = [];
  const patterns: Parameters<typeof extractIdentifiers>[0][] = [];
  for (const ast of CORPUS_ASTS) {
    walk(ast, {
      enter(node, parent) {
        if (node.type === "Identifier") identifiers.push([node, parent]);
        else if (node.type === "VariableDeclarator") patterns.push(node.id);
        else if (
          node.type === "FunctionDeclaration" ||
          node.type === "FunctionExpression" ||
          node.type === "ArrowFunctionExpression"
        ) {
          patterns.push(...node.params);
        } else if (node.type === "EachBlock" && node.context) {
          patterns.push(node.context);
        }
      },
    });
  }
  task(
    "isReference, every identifier",
    () => identifiers.filter(([node, parent]) => isReference(node, parent)),
    { description: `${identifiers.length} identifiers` },
  );
  task(
    "extractIdentifiers, every binding pattern",
    () => patterns.map(extractIdentifiers),
    { description: `${patterns.length} patterns` },
  );
});

group("sveast/core", () => {
  const { parse: coreParse } = createParser();
  const javascript = CARBON_LARGEST.filter(
    ({ source }) => !LANG_TS.test(source),
  );
  mapTask(
    "createParser(), carbon largest",
    sourcesOf(javascript),
    (source) => coreParse(source),
    filesDescription(javascript),
  );

  const { parseModule: moduleParse } = createModuleParser();
  mapTask(
    "createModuleParser(), carbon .js",
    sourcesOf(CARBON_JS),
    (source) => moduleParse(source),
    kb(CARBON_JS),
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
      mustRun(label, [input], (source) => parse(source, options));
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
  walkTask("corpus files", CORPUS_ASTS);
  walkTask("corpus files, markupVisitorKeys", CORPUS_ASTS, markupVisitorKeys);
});

group("errors", () => {
  const errorTask = (name: string, sources: string[], description: string) => {
    const codes = () =>
      sources.map((source) => {
        try {
          parse(source);
        } catch (error) {
          if (error instanceof ParseError) return error.code;
          throw new Error(
            `"${name}" threw something other than a ParseError: ${error}`,
            { cause: error },
          );
        }
        throw new Error(`"${name}" must throw a ParseError, but parsed`);
      });
    codes();
    task(name, codes, { description });
  };

  errorTask(
    "corpus files svelte rejects",
    sourcesOf(REJECTED),
    filesDescription(REJECTED),
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
