const SET_FROM = 16;

const sets = new WeakMap<string[], { names: Set<string>; length: number }>();

/**
 * `names.includes(name)` for the name lists acorn and the TypeScript plugin
 * keep per scope, which only grow: past a few names, a `Set` kept in step
 * with the list, so declaring n names in one scope isn't O(n²).
 */
export function hasName(names: string[] | undefined, name: string): boolean {
  if (names === undefined) return false;
  if (names.length < SET_FROM) return names.includes(name);
  let entry = sets.get(names);
  if (entry === undefined || entry.length > names.length) {
    entry = { names: new Set(), length: 0 };
    sets.set(names, entry);
  }
  while (entry.length < names.length) entry.names.add(names[entry.length++]);
  return entry.names.has(name);
}
