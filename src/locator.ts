export interface Location {
  line: number;
  column: number;
  character: number;
}

let source = "";
let lineStarts: number[] | undefined;
let lastLine = 0;

export function setSource(value: string): void {
  source = value;
  lineStarts = undefined;
  lastLine = 0;
}

export function locate(index: number): Location {
  if (!lineStarts) {
    lineStarts = [0];
    let i = source.indexOf("\n");
    while (i !== -1) {
      lineStarts.push(i + 1);
      i = source.indexOf("\n", i + 1);
    }
  }
  let low = 0;
  let high = lineStarts.length - 1;
  if (index >= lineStarts[lastLine]) low = lastLine;
  else high = lastLine - 1;
  if (low < high && index < lineStarts[low + 1]) high = low;
  while (low < high) {
    const mid = (low + high + 1) >>> 1;
    if (lineStarts[mid] <= index) low = mid;
    else high = mid - 1;
  }
  lastLine = low;
  return { line: low + 1, column: index - lineStarts[low], character: index };
}

export function position(index: number): { line: number; column: number } {
  const { line, column } = locate(index);
  return { line, column };
}

export function sourceLines(): string[] {
  return source.split("\n");
}
