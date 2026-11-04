// svelte's `fuzzymatch` (src/compiler/utils/fuzzymatch.js), which it
// adapted from fuzzyset.js (BSD, https://github.com/Glench/fuzzyset.js),
// for the suggestions in `a11y_unknown_aria_attribute` and
// `a11y_unknown_role`. Ported as it is, quirks included, so the
// suggestions match.

type Match = [score: number, match: string];

const GRAM_SIZE_LOWER = 2;
const GRAM_SIZE_UPPER = 3;
const NON_WORD = /[^\w, ]+/;

/** The name in `names` closest to `name`, if it's close enough. */
export function fuzzymatch(
  name: string,
  names: readonly string[],
): string | null {
  if (names.length === 0) return null;
  const matches = new FuzzySet(names).get(name);
  return matches && matches[0][0] > 0.7 ? matches[0][1] : null;
}

function distance(a: string, b: string): number {
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

function levenshtein(a: string, b: string): number {
  const current: number[] = [];
  let prev = 0;
  for (let i = 0; i <= b.length; i++) {
    for (let j = 0; j <= a.length; j++) {
      let value: number;
      if (i && j) {
        value =
          a.charAt(j - 1) === b.charAt(i - 1)
            ? prev
            : Math.min(current[j], current[j - 1], prev) + 1;
      } else {
        value = i + j;
      }
      prev = current[j];
      current[j] = value;
    }
  }
  return current.pop() as number;
}

function grams(value: string, size: number): string[] {
  const simplified = `-${value.toLowerCase().replace(NON_WORD, "")}-`;
  const result: string[] = [];
  for (let i = 0; i < simplified.length - size + 1; ++i) {
    result.push(simplified.slice(i, i + size));
  }
  return result;
}

function gramCounts(value: string, size: number): Map<string, number> {
  const counts = new Map<string, number>();
  for (const gram of grams(value, size))
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  return counts;
}

const descending = (a: Match, b: Match) => b[0] - a[0];

class FuzzySet {
  private readonly exact = new Map<string, string>();
  private readonly matchDict = new Map<
    string,
    [index: number, count: number][]
  >();
  private readonly items = new Map<number, [normal: number, value: string][]>();

  constructor(values: readonly string[]) {
    for (let size = GRAM_SIZE_LOWER; size <= GRAM_SIZE_UPPER; ++size)
      this.items.set(size, []);
    for (const value of values) {
      if (this.exact.has(value.toLowerCase())) continue;
      for (let size = GRAM_SIZE_LOWER; size <= GRAM_SIZE_UPPER; ++size)
        this.add(value, size);
    }
  }

  private add(value: string, size: number): void {
    const normalized = value.toLowerCase();
    const items = this.items.get(size) ?? [];
    const index = items.length;
    let sumOfSquares = 0;
    for (const [gram, count] of gramCounts(normalized, size)) {
      sumOfSquares += count ** 2;
      const list = this.matchDict.get(gram);
      if (list) list.push([index, count]);
      else this.matchDict.set(gram, [[index, count]]);
    }
    items.push([Math.sqrt(sumOfSquares), normalized]);
    this.exact.set(normalized, value);
  }

  get(value: string): Match[] | null {
    const exact = this.exact.get(value.toLowerCase());
    if (exact) return [[1, exact]];
    // The largest grams first, then smaller ones if they match nothing.
    for (let size = GRAM_SIZE_UPPER; size >= GRAM_SIZE_LOWER; --size) {
      const results = this.match(value, size);
      if (results.length > 0) return results;
    }
    return null;
  }

  private match(value: string, size: number): Match[] {
    const normalized = value.toLowerCase();
    const matches = new Map<number, number>();
    const items = this.items.get(size) ?? [];
    let sumOfSquares = 0;
    for (const [gram, count] of gramCounts(normalized, size)) {
      sumOfSquares += count ** 2;
      for (const [index, other] of this.matchDict.get(gram) ?? []) {
        matches.set(index, (matches.get(index) ?? 0) + count * other);
      }
    }
    const normal = Math.sqrt(sumOfSquares);
    // fuzzyset.js keeps the matches in an object, so they're in index order.
    const scored: Match[] = [...matches]
      .sort((a, b) => a[0] - b[0])
      .map(([index, score]) => [
        score / (normal * items[index][0]),
        items[index][1],
      ]);
    scored.sort(descending);
    const top = scored
      .slice(0, 50)
      .map(([, match]): Match => [distance(match, normalized), match]);
    top.sort(descending);
    return top
      .filter(([score]) => score === top[0][0])
      .map(([score, match]) => [score, this.exact.get(match) ?? match]);
  }
}
