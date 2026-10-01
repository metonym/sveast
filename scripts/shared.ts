import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

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
  return files.sort();
}

export function firstDifference(
  a: unknown,
  b: unknown,
  skip: (path: string, key: string) => boolean = () => false,
  path = "",
): string | null {
  if (Object.is(a, b)) return null;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) {
    return typeof a === "bigint" || typeof b === "bigint"
      ? String(a) === String(b)
        ? null
        : path
      : path;
  }
  if (a instanceof RegExp || b instanceof RegExp) {
    return String(a) === String(b) ? null : path;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return path;
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (skip(path, key)) continue;
    const found = firstDifference(
      (a as Record<string, unknown>)[key],
      (b as Record<string, unknown>)[key],
      skip,
      `${path}.${key}`,
    );
    if (found) return found;
  }
  return null;
}
