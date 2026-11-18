// svelte's html-tree-validation.js, for `node_invalid_placement_ssr`:
// the tags a browser moves, drops or closes when it parses them where
// they are. svelte is MIT licensed.

type Rule =
  | { direct: string[] }
  | { descendant: string[]; resetBy?: string[] }
  | { only: string[] };

const HEADINGS = ["h1", "h2", "h3", "h4", "h5", "h6"];
const TABLE_ROWS = ["tr", "style", "script", "template"];

const DISALLOWED_CHILDREN: Record<string, Rule> = {
  li: { direct: ["li"] },
  dt: { descendant: ["dt", "dd"], resetBy: ["dl"] },
  dd: { descendant: ["dt", "dd"], resetBy: ["dl"] },
  p: {
    descendant:
      "address article aside blockquote div dl fieldset footer form h1 h2 h3 h4 h5 h6 header hgroup hr main menu nav ol p pre section table ul".split(
        " ",
      ),
  },
  rt: { descendant: ["rt", "rp"] },
  rp: { descendant: ["rt", "rp"] },
  optgroup: { descendant: ["optgroup"] },
  option: { descendant: ["option", "optgroup"] },
  // svelte's `only` rules for these replace their autoclosing ones.
  thead: { only: TABLE_ROWS },
  tbody: { only: TABLE_ROWS },
  tfoot: { only: TABLE_ROWS },
  tr: { only: ["th", "td", "style", "script", "template"] },
  td: { direct: ["td", "th", "tr"] },
  th: { direct: ["td", "th", "tr"] },
  form: { descendant: ["form"] },
  a: { descendant: ["a"] },
  button: { descendant: ["button"] },
  h1: { descendant: HEADINGS },
  h2: { descendant: HEADINGS },
  h3: { descendant: HEADINGS },
  h4: { descendant: HEADINGS },
  h5: { descendant: HEADINGS },
  h6: { descendant: HEADINGS },
  "#document": { only: ["html"] },
  html: { only: ["head", "body", "frameset"] },
  frameset: { only: ["frame"] },
  colgroup: { only: ["col", "template"] },
  table: {
    only: [
      "caption",
      "colgroup",
      "tbody",
      "thead",
      "tfoot",
      "style",
      "script",
      "template",
    ],
  },
  head: {
    only: [
      "base",
      "basefont",
      "bgsound",
      "link",
      "meta",
      "title",
      "noscript",
      "noframes",
      "style",
      "script",
      "template",
    ],
  },
};
const rule = (tag: string): Rule | undefined =>
  Object.hasOwn(DISALLOWED_CHILDREN, tag)
    ? DISALLOWED_CHILDREN[tag]
    : undefined;

/**
 * svelte's `is_tag_valid_with_ancestor`: why `child` can't sit under the
 * last of `ancestors`, which start at its parent; `null` if it can.
 */
export function invalidWithAncestor(
  child: string,
  ancestors: readonly string[],
): string | null {
  if (child.includes("-")) return null;
  const ancestor = ancestors[ancestors.length - 1];
  const disallowed = rule(ancestor);
  if (disallowed === undefined) return null;
  if ("resetBy" in disallowed && disallowed.resetBy) {
    for (let i = ancestors.length - 2; i >= 0; i--) {
      if (ancestors[i].includes("-")) return null;
      if (disallowed.resetBy.includes(ancestors[i])) return null;
    }
  }
  if ("descendant" in disallowed && disallowed.descendant.includes(child)) {
    return `\`<${child}>\` cannot be a descendant of \`<${ancestor}>\``;
  }
  return null;
}

/**
 * svelte's `is_tag_valid_with_parent`: why `child` can't sit right under
 * `parent`; `null` if it can.
 */
export function invalidWithParent(
  child: string,
  parent: string,
): string | null {
  if (child.includes("-") || parent.includes("-")) return null;
  if (parent === "template") return null;
  const disallowed = rule(parent);
  if (disallowed !== undefined) {
    if ("direct" in disallowed && disallowed.direct.includes(child)) {
      return `\`<${child}>\` cannot be a direct child of \`<${parent}>\``;
    }
    if ("descendant" in disallowed && disallowed.descendant.includes(child)) {
      return `\`<${child}>\` cannot be a child of \`<${parent}>\``;
    }
    if ("only" in disallowed) {
      if (disallowed.only.includes(child)) return null;
      const allowed = disallowed.only.map((tag) => `\`<${tag}>\``).join(", ");
      return `\`<${child}>\` cannot be a child of \`<${parent}>\`. \`<${parent}>\` only allows these children: ${allowed}`;
    }
  }
  switch (child) {
    case "body":
    case "caption":
    case "col":
    case "colgroup":
    case "frameset":
    case "frame":
    case "head":
    case "html":
      return `\`<${child}>\` cannot be a child of \`<${parent}>\``;
    case "thead":
    case "tbody":
    case "tfoot":
      return `\`<${child}>\` must be the child of a \`<table>\`, not a \`<${parent}>\``;
    case "td":
    case "th":
      return `\`<${child}>\` must be the child of a \`<tr>\`, not a \`<${parent}>\``;
    case "tr":
      return `\`<tr>\` must be the child of a \`<thead>\`, \`<tbody>\`, or \`<tfoot>\`, not a \`<${parent}>\``;
  }
  return null;
}
