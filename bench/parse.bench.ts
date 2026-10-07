import { tsPlugin as acornTypeScript } from "@sveltejs/acorn-typescript";
import { Parser } from "acorn";
import { group, task } from "ostia";
import { parse } from "sveast";
import { parse as svelteParse } from "svelte/compiler";
import { tsPlugin } from "../src/ts-plugin";
import {
  CARBON_LARGEST,
  CARBON_TS,
  COMPONENTS,
  type Component,
  kb,
  LARGEST,
  scriptTexts,
  TYPESCRIPT,
} from "./corpus";

const INPUTS: [string, Component[]][] = [
  [`corpus (${COMPONENTS.length} files, ${kb(COMPONENTS)})`, COMPONENTS],
  [`lang="ts" (${TYPESCRIPT.length} files, ${kb(TYPESCRIPT)})`, TYPESCRIPT],
  [`largest (${kb([LARGEST])})`, [LARGEST]],
  [
    `carbon largest (${CARBON_LARGEST.length} files, ${kb(CARBON_LARGEST)})`,
    CARBON_LARGEST,
  ],
];

for (const [name, components] of INPUTS) {
  const sources = components.map((c) => c.source);
  group(name, () => {
    task("sveast", () => sources.map((source) => parse(source)));
    task("svelte/compiler", () =>
      sources.map((source) => svelteParse(source, { modern: true })),
    );
  });
}

const sources = COMPONENTS.map((c) => c.source);
group(`options (${COMPONENTS.length} files)`, () => {
  task("default", () => sources.map((source) => parse(source)));
  task("loc: true", () =>
    sources.map((source) => parse(source, { loc: true })),
  );
  task("css: false", () =>
    sources.map((source) => parse(source, { css: false })),
  );
});

const allScripts = TYPESCRIPT.flatMap(({ source }) => scriptTexts(source));
const Ours = Parser.extend(tsPlugin);
const Theirs = Parser.extend(acornTypeScript());
const OPTIONS = { sourceType: "module", ecmaVersion: "latest" } as const;
const bothParse = (source: string) => {
  try {
    Ours.parse(source, OPTIONS);
    Theirs.parse(source, { ...OPTIONS, locations: true });
    return true;
  } catch {
    return false;
  }
};
const scripts = allScripts.filter(bothParse);

group(`ts scripts (${scripts.length})`, () => {
  task("tsPlugin", () => scripts.map((source) => Ours.parse(source, OPTIONS)));
  task("acorn-typescript", () =>
    scripts.map((source) =>
      Theirs.parse(source, { ...OPTIONS, locations: true }),
    ),
  );
});

const modules = CARBON_TS.map((m) => m.source).filter(bothParse);
group(`carbon .d.ts (${modules.length})`, () => {
  task("tsPlugin", () => modules.map((source) => Ours.parse(source, OPTIONS)));
  task("acorn-typescript", () =>
    modules.map((source) =>
      Theirs.parse(source, { ...OPTIONS, locations: true }),
    ),
  );
});
