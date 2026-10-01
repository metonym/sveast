import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** What `JSON.parse` produces. */
export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The `code` of a thrown svelte or sveast error, if it has one. */
export function errorCode(error: unknown): string | undefined {
  return isRecord(error) && typeof error.code === "string"
    ? error.code
    : undefined;
}

/** Orders strings by UTF-16 code unit, as a bare `sort()` does. */
export function byCodeUnit(a: string, b: string): -1 | 0 | 1 {
  if (a < b) return -1;
  return a > b ? 1 : 0;
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
