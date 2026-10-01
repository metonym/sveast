import { existsSync, watch } from "node:fs";
import { cp, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { $, type BunPlugin, build } from "bun";
import { bundleDts } from "./bundle-dts";
import type { Json } from "./shared";
import { shrinkParser } from "./shrink-parser";

interface PackageManifest {
  main: string;
  types: string;
  [field: string]: Json;
}

const STRIP_PKG_FIELDS = new Set(["devDependencies", "scripts"]);
const DIST_PREFIX = /^\.\/dist\//;

const isWatchMode =
  process.argv.includes("-w") || process.argv.includes("--watch");
const root = process.cwd();
const outDir = resolve(root, "dist");

await $`rm -rf ${outDir}; mkdir ${outDir}`;

await Promise.all(
  ["README.md", "LICENSE", "package.json"].map(async (asset) => {
    const path = resolve(root, asset);
    if (existsSync(path)) {
      await cp(path, resolve(outDir, asset));
    }
  }),
);

const SUBPATHS = ["core", "typescript", "entities"];

async function emitTypeDeclarations() {
  try {
    await Promise.all(
      ["index", ...SUBPATHS].map((entry) =>
        bundleDts({
          root,
          source: resolve(root, `src/${entry}.ts`),
          outFile: resolve(outDir, `${entry}.d.ts`),
        }),
      ),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    if (!isWatchMode) {
      process.exit(1);
    }
  }
}

async function slimPackageManifest() {
  const manifestPath = resolve(outDir, "package.json");
  const pkg: PackageManifest = await Bun.file(manifestPath).json();

  for (const key of STRIP_PKG_FIELDS) {
    delete pkg[key];
  }

  pkg.main = pkg.main.replace(DIST_PREFIX, "./");
  pkg.types = pkg.types.replace(DIST_PREFIX, "./");
  const exports: Record<string, Json> = {
    ".": { types: pkg.types, import: pkg.main, default: pkg.main },
  };
  for (const subpath of SUBPATHS) {
    const js = `./${subpath}.js`;
    exports[`./${subpath}`] = {
      types: `./${subpath}.d.ts`,
      import: js,
      default: js,
    };
  }

  const ordered: Record<string, Json> = {};
  for (const [key, value] of Object.entries(pkg)) {
    ordered[key] = value;
    if (key === "types") ordered.exports = exports;
  }

  await writeFile(manifestPath, `${JSON.stringify(ordered, null, 2)}\n`);
}

const ENTRY = /[\\/]src[\\/]index\.ts$/;
const RELATIVE = /^\.\//;

const reexportEntries: BunPlugin = {
  name: "sveast-reexport-entries",
  setup(bundler) {
    bundler.onResolve({ filter: RELATIVE }, (args) =>
      ENTRY.test(args.importer)
        ? { path: `${args.path}.js`, external: true }
        : undefined,
    );
  },
};

async function buildProject() {
  const result = await build({
    entrypoints: [
      "./src/index.ts",
      "./src/parse.ts",
      "./src/parse-module.ts",
      "./src/is-valid-type.ts",
      "./src/walk.ts",
      ...SUBPATHS.map((subpath) => `./src/${subpath}.ts`),
    ],
    root: "./src",
    outdir: outDir,
    naming: { entry: "[name].[ext]", chunk: "shared-[hash].[ext]" },
    format: "esm",
    target: "browser",
    minify: true,
    splitting: true,
    packages: "bundle",
    plugins: [reexportEntries, shrinkParser],
  });

  if (!result.success) {
    console.error("Build failed");
    for (const log of result.logs) {
      console.error(log);
    }
    if (!isWatchMode) {
      process.exit(1);
    }
    return;
  }

  await emitTypeDeclarations();
  await slimPackageManifest();
  console.log("✓ Build completed");
}

if (isWatchMode) {
  console.log("Watching for changes...\n");

  await buildProject();

  let debounceTimer: Timer | null = null;
  let isBuilding = false;

  const watcher = watch(
    "./src",
    { recursive: true },
    (_eventType, filename) => {
      if (filename && !isBuilding) {
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }

        debounceTimer = setTimeout(async () => {
          console.log(`\nFile changed: ${filename}`);
          isBuilding = true;
          await buildProject();
          isBuilding = false;
        }, 100);
      }
    },
  );

  setInterval(() => {
    // keeps the process alive while watching
  }, 1000);

  process.on("SIGINT", () => {
    console.log("\nStopping watch mode...");
    watcher.close();
    process.exit(0);
  });
} else {
  await buildProject();
}
