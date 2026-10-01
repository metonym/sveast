// biome-ignore format: one word per line reads worse than packed lists
const AUTOCLOSING_CHILDREN: Record<string, string[]> = {
  li: ["li"],
  dt: ["dt", "dd"],
  dd: ["dt", "dd"],
  p: [
    "address", "article", "aside", "blockquote", "div", "dl", "fieldset", "footer", "form",
    "h1", "h2", "h3", "h4", "h5", "h6", "header", "hgroup", "hr", "main", "menu", "nav", "ol",
    "p", "pre", "section", "table", "ul",
  ],
  rt: ["rt", "rp"],
  rp: ["rt", "rp"],
  optgroup: ["optgroup"],
  option: ["option", "optgroup"],
  thead: ["tbody", "tfoot"],
  tbody: ["tbody", "tfoot"],
  tfoot: ["tbody"],
  tr: ["tr", "tbody"],
  td: ["td", "th", "tr"],
  th: ["td", "th", "tr"],
};

export function closingTagOmitted(current: string, next: string): boolean {
  return (
    Object.hasOwn(AUTOCLOSING_CHILDREN, current) &&
    AUTOCLOSING_CHILDREN[current].includes(next)
  );
}
