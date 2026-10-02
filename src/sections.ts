import { componentState, finishComponent, readNode } from "./component";
import { topLevelTags } from "./component-lexer";
import { readElement } from "./elements";
import { decodeCharacterReferences } from "./html-entities";
import type { ParseOptions } from "./options";
import type { TemplateParserState } from "./state";
import type { Support } from "./support";
import type { AST } from "./types/svelte-ast";

export function parseComponentSections(
  source: string,
  options: ParseOptions | undefined,
  support: Support,
): AST.Root {
  const state = componentState(source, options, support);
  readTopLevelTags(state);
  return finishComponent(state);
}

/**
 * Reads only the top-level `<script>`, `<style>` and `<svelte:options>`
 * tags. The top-level comments and the text between them stay in the
 * fragment while they're read, as in a full parse, so a section gets the
 * HTML comment before it; markup between them is kept as text.
 */
function readTopLevelTags(state: TemplateParserState): void {
  const { source } = state;
  const { tags, comments } = topLevelTags(source);
  const nodes = state.root.fragment.nodes;
  const appendText = (start: number, end: number) => {
    if (end <= start) return;
    const raw = source.slice(start, end);
    const markup = raw.includes("<") || raw.includes("{");
    const data = markup
      ? raw
      : decodeCharacterReferences(raw, false, state.entityNames);
    nodes.push({ type: "Text", start, end, raw, data });
  };

  let index = 0;
  let comment = 0;
  for (const start of tags) {
    for (
      ;
      comment < comments.length && comments[comment] < start;
      comment += 2
    ) {
      const commentStart = comments[comment];
      if (commentStart < index) continue;
      const end = comments[comment + 1];
      appendText(index, commentStart);
      nodes.push({
        type: "Comment",
        start: commentStart,
        end,
        data: source.slice(commentStart + 4, end - 3),
      });
      index = end;
    }
    if (start < index) continue;
    appendText(index, start);
    state.index = start;
    readElement(state);
    while (state.stack.length > 1 && state.index < source.length) {
      readNode(state);
    }
    index = state.index;
  }
  const options = nodes.filter((node) => node.type === "SvelteOptions");
  nodes.length = 0;
  nodes.push(...options);
}
