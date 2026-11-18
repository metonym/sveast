import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { compile } from "svelte/compiler";

export type Json =
  null | boolean | number | string | Json[] | { [key: string]: Json };

export const LOC_KEYS: ReadonlySet<string> = new Set(["loc", "name_loc"]);
export const SVELTE_FILES = /\.svelte$/;

// svelte tests every string for bidirectional control characters with one
// regular expression with the `g` flag, so after a match its next test
// starts mid-string, even in the next component. sveast starts each
// component afresh. Compiling an empty string makes svelte do the same:
// a test that fails sets the regex back to the start.
export function resetSvelteBidi(): void {
  compile('<script>"";</script>', { generate: false });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function errorCode(error: unknown): string | undefined {
  return isRecord(error) && typeof error.code === "string"
    ? error.code
    : undefined;
}

export function attempt<T>(run: () => T): T | undefined {
  try {
    return run();
  } catch {
    return;
  }
}

export function byCodeUnit(a: string, b: string): -1 | 0 | 1 {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

export function toJson(
  value: unknown,
  drop: ReadonlySet<string> = new Set(),
): string {
  return JSON.stringify(value, (key, item) => {
    if (drop.has(key)) return;
    return typeof item === "bigint" ? `${item}n` : item;
  });
}

export function plain(value: unknown, drop?: ReadonlySet<string>): Json {
  return JSON.parse(toJson(value, drop));
}

export function collectFiles(paths: string[], pattern: RegExp): string[] {
  const files: string[] = [];
  const visit = (path: string) => {
    const stat = statSync(path, { throwIfNoEntry: false });
    if (!stat) return;
    if (stat.isFile()) {
      if (pattern.test(path)) files.push(path);
      return;
    }
    for (const entry of readdirSync(path)) {
      if (entry !== "node_modules" && !entry.startsWith(".")) {
        visit(join(path, entry));
      }
    }
  };
  for (const path of paths) visit(path);
  return files.sort(byCodeUnit);
}

export function firstDifference(
  a: unknown,
  b: unknown,
  skip: (path: string, key: string) => boolean = () => false,
  path = "",
): string | null {
  if (Object.is(a, b)) return null;
  if (!isRecord(a) || !isRecord(b)) {
    if (typeof a === "bigint" || typeof b === "bigint") {
      return String(a) === String(b) ? null : path;
    }
    return path;
  }
  if (a instanceof RegExp || b instanceof RegExp) {
    return String(a) === String(b) ? null : path;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return path;
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (skip(path, key)) continue;
    const found = firstDifference(a[key], b[key], skip, `${path}.${key}`);
    if (found) return found;
  }
  return null;
}

export function mulberry32(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return (t ^ (t >>> 14)) >>> 0;
  };
}

export function compareArgs(pattern: RegExp): {
  files: string[];
  list: boolean;
} {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { list: { type: "boolean", default: false } },
  });
  return { files: collectFiles(positionals, pattern), list: values.list };
}

export function printList(
  title: string,
  lines: readonly string[],
  all: boolean,
  limit = 10,
  indent = "",
): void {
  if (lines.length === 0) return;
  console.log(`\n${title}:`);
  for (const line of all ? lines : lines.slice(0, limit)) {
    console.log(indent + line);
  }
  if (!all && lines.length > limit) {
    console.log(`${indent}... ${lines.length - limit} more`);
  }
}

export function report(
  summary: string,
  mismatches: string[],
  all: boolean,
): void {
  console.log(summary);
  printList("Mismatches", mismatches, all);
  process.exitCode = mismatches.length > 0 ? 1 : 0;
}

/** The codes `compilerWarnings` gives. */
export const WARNING_CODES: ReadonlySet<string> = new Set([
  "attribute_avoid_is",
  "attribute_global_event_reference",
  "attribute_illegal_colon",
  "attribute_invalid_property_name",
  "attribute_quoted",
  "bidirectional_control_characters",
  "bind_invalid_each_rest",
  "block_empty",
  "component_name_lowercase",
  "css_unused_selector",
  "custom_element_props_identifier",
  "element_implicitly_closed",
  "element_invalid_self_closing_tag",
  "event_directive_deprecated",
  "export_let_unused",
  "legacy_code",
  "legacy_component_creation",
  "node_invalid_placement_ssr",
  "non_reactive_update",
  "options_deprecated_accessors",
  "options_deprecated_immutable",
  "options_missing_custom_element",
  "perf_avoid_inline_class",
  "perf_avoid_nested_class",
  "reactive_declaration_invalid_placement",
  "reactive_declaration_module_script_dependency",
  "script_context_deprecated",
  "script_unknown_attribute",
  "slot_element_deprecated",
  "state_referenced_locally",
  "store_rune_conflict",
  "svelte_component_deprecated",
  "svelte_element_invalid_this",
  "svelte_self_deprecated",
  "unknown_code",
]);
