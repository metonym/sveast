const SLOTS = 2048;

const names: Array<string | undefined> = new Array(SLOTS).fill(undefined);

export function resetNames(): void {
  names.fill(undefined);
}

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
