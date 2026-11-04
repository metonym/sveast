import { defineConfig } from "bivium";

export default defineConfig({
  suites: {
    unit: {
      tests: "tests/*.test.ts",
      run: "bun test --parallel {files}",
      root: "tests",
      // `bun test` runs the code: an `import type` or a declaration file
      // can't change what a test does.
      types: false,
      // How `bun test` runs.
      wiring: ["bunfig.toml"],
    },
  },
  roots: [
    "src",
    "tests",
    "scripts",
    "examples",
    "package.json",
    "tsconfig.json",
    "bunfig.toml",
  ],
  // Lint config and benchmarks: no test runs Biome, knip or ostia.
  ignore: ["**/*.md", "bench/**", "LICENSE", "biome.json", "knip.json"],
  // The corpus every parity test parses, through `tests/shared.ts`'s
  // `corpusFiles` and `readCorpus`: a corpus edit selects what imports it.
  reads: {
    "tests/shared.ts": "tests/corpus/**",
    // Seeds its mutations from the corpus.
    "scripts/fuzz-parser.ts": "tests/corpus/**",
  },
  edges: {
    // Each runs the next as a subprocess.
    "tests/fuzz.test.ts": "scripts/fuzz-parser.ts",
    "scripts/fuzz-parser.ts": "scripts/fuzz-trial.ts",
  },
  // These read or import only the paths their caller passes, or temp
  // directories, or svelte's own files under node_modules (a svelte bump
  // reaches them through `tests/shared.ts`'s `svelte/compiler` import). A
  // caller that passes one of this repository's files still names it.
  hermetic: [
    "scripts/shared.ts",
    "scripts/lexed.ts",
    "scripts/svelte-scopes.ts",
    "examples/*.ts",
    "tests/examples.test.ts",
    "tests/fuzz.test.ts",
    "tests/is-reference.test.ts",
  ],
  // Tools CI runs on its own: a bump that only reaches them selects nothing.
  inert: ["@biomejs/biome", "knip", "ostia", "@types/*"],
});
