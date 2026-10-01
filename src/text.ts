import { decodeCharacterReferences } from "./html-entities";
import type { TemplateParserState } from "./state";

export function readText(state: TemplateParserState): void {
  const { source, index: start } = state;
  if (state.nextAngle < start) state.nextAngle = find(source, "<", start);
  if (state.nextBrace < start) state.nextBrace = find(source, "{", start);
  const end = Math.min(state.nextAngle, state.nextBrace);
  state.index = end;
  const raw = source.slice(start, end);
  state.append({
    type: "Text",
    start,
    end,
    raw,
    data: decodeCharacterReferences(raw, false),
  });
}

function find(source: string, char: string, from: number): number {
  const index = source.indexOf(char, from);
  return index === -1 ? source.length : index;
}
