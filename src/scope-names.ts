const SET_FROM = 16;

const sets = new WeakMap<string[], { names: Set<string>; length: number }>();

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
