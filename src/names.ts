const SLOTS = 2048;

const names: Array<string | undefined> = new Array(SLOTS).fill(undefined);

/** Forgets the names read so far, which hold on to the source they were sliced from. */
export function resetNames(): void {
  names.fill(undefined);
}

/**
 * `input.slice(start, end)`, but the string returned last time for the
 * same text when it's still in its slot, so an AST holds one string per
 * name rather than one per occurrence, and repeats allocate nothing.
 * `hash` is any hash of the text.
 */
export function internName(
  input: string,
  start: number,
  end: number,
  hash: number,
): string {
  const slot = hash & (SLOTS - 1);
  const name = names[slot];
  if (
    name !== undefined &&
    name.length === end - start &&
    input.startsWith(name, start)
  ) {
    return name;
  }
  const word = input.slice(start, end);
  names[slot] = word;
  return word;
}
