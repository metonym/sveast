// A port of svelte's check for unused CSS selectors: its CSS analysis
// (phases/2-analyze/css/css-analyze.js), pruning (css-prune.js), warning
// (css-warn.js) and their helpers (css/utils.js), with the element paths
// and snippet links its template analysis records (phases/2-analyze/
// visitors/RegularElement.js, RenderTag.js, shared/component.js). The
// metadata svelte writes onto the AST lives in maps here, so the AST is
// never changed. svelte is MIT licensed.
import { analyzeScopes, type Binding, type Scopes } from "./scope";
import { ignoreCodes } from "./svelte-ignore";
import type { Expression, Identifier } from "./types/estree";
import type { AST } from "./types/svelte-ast";
import { forEachChild, markupVisitorKeys } from "./walk";

type CssNode = AST.CSS.Node;
type Rule = AST.CSS.Rule;
type ComplexSelector = AST.CSS.ComplexSelector;
type RelativeSelector = AST.CSS.RelativeSelector;
type SimpleSelector = AST.CSS.SimpleSelector;
type SelectorList = AST.CSS.SelectorList;

type Element = AST.RegularElement | AST.SvelteElement;
type ComponentLike = AST.Component | AST.SvelteComponent | AST.SvelteSelf;
type Renderer = AST.RenderTag | ComponentLike;
/** A markup node, or a `Fragment`, which has no offsets. */
interface Node {
  type: string;
}

/** What svelte keeps on a `RelativeSelector`'s `metadata`, but `scoped`. */
interface RelativeMeta {
  isGlobal: boolean;
  isGlobalLike: boolean;
}
/** What svelte keeps on a `ComplexSelector`'s `metadata`, but `scoped`. */
interface ComplexMeta {
  used: boolean;
  rule: Rule | null;
}
/** What svelte keeps on a `Rule`'s `metadata`, but the `has_*` flags. */
interface RuleMeta {
  parentRule: Rule | null;
  isGlobalBlock: boolean;
}

const NODE_PROBABLY_EXISTS = 0;
const NODE_DEFINITELY_EXISTS = 1;
const FORWARD = 0;
const BACKWARD = 1;
type Direction = typeof FORWARD | typeof BACKWARD;
type Existence = typeof NODE_PROBABLY_EXISTS | typeof NODE_DEFINITELY_EXISTS;

const CSS_BROWSER_PREFIX = /^-((webkit)|(moz)|(o)|(ms))-/;
const BACKSLASH_AND_FOLLOWING = /\\(.)/g;
const STARTS_WITH_WHITESPACE = /^\s/;
const ENDS_WITH_WHITESPACE = /\s$/;
const WHITESPACE = /\s/;

const WHITELIST_ATTRIBUTE_SELECTOR: ReadonlyMap<string, readonly string[]> =
  new Map([
    ["details", ["open"]],
    ["dialog", ["open"]],
  ]);

const CASE_INSENSITIVE_ATTRIBUTES: ReadonlySet<string> = new Set([
  "accept-charset",
  "autocapitalize",
  "autocomplete",
  "behavior",
  "charset",
  "crossorigin",
  "decoding",
  "dir",
  "direction",
  "draggable",
  "enctype",
  "enterkeyhint",
  "fetchpriority",
  "formenctype",
  "formmethod",
  "formtarget",
  "hidden",
  "http-equiv",
  "inputmode",
  "kind",
  "loading",
  "method",
  "preload",
  "referrerpolicy",
  "rel",
  "rev",
  "role",
  "rules",
  "scope",
  "shape",
  "spellcheck",
  "target",
  "translate",
  "type",
  "valign",
  "wrap",
]);

const VIEW_TRANSITION_PSEUDO_ELEMENTS: ReadonlySet<string> = new Set([
  "view-transition",
  "view-transition-group",
  "view-transition-old",
  "view-transition-new",
  "view-transition-image-pair",
]);

const DESCENDANT_COMBINATOR: AST.CSS.Combinator = {
  type: "Combinator",
  name: " ",
  start: -1,
  end: -1,
};

const NESTING_SELECTOR: RelativeSelector = {
  type: "RelativeSelector",
  start: -1,
  end: -1,
  combinator: null,
  selectors: [{ type: "NestingSelector", name: "&", start: -1, end: -1 }],
};

const ANY_SELECTOR: RelativeSelector = {
  type: "RelativeSelector",
  start: -1,
  end: -1,
  combinator: null,
  selectors: [{ type: "TypeSelector", name: "*", start: -1, end: -1 }],
};

/** A value `gatherPossibleValues` can't know. */
const UNKNOWN = {};

/** The children of a CSS node, in the order svelte's walks visit them. */
function cssChildren(node: CssNode): readonly CssNode[] {
  switch (node.type) {
    case "StyleSheet":
    case "SelectorList":
    case "ComplexSelector":
    case "Block":
      return node.children;
    case "Rule":
      return [node.prelude, node.block];
    case "Atrule":
      return node.block ? [node.block] : [];
    case "RelativeSelector":
      return node.combinator
        ? [node.combinator, ...node.selectors]
        : node.selectors;
    case "PseudoClassSelector":
    case "PseudoElementSelector":
      return node.args ? [node.args] : [];
    default:
      return [];
  }
}

function isKeyframes(node: AST.CSS.Atrule): boolean {
  return node.name.replace(CSS_BROWSER_PREFIX, "") === "keyframes";
}

function isGlobalBlockSelector(selector: SimpleSelector): boolean {
  return (
    selector.type === "PseudoClassSelector" &&
    selector.name === "global" &&
    selector.args === null
  );
}

function isUnscopedPseudoClass(selector: SimpleSelector): boolean {
  return (
    selector.type === "PseudoClassSelector" &&
    // These make the selector scoped
    ((selector.name !== "has" &&
      selector.name !== "is" &&
      selector.name !== "where" &&
      // :not is unscoped, unless it holds more than one selector, such
      // as :not(.x .y)
      (selector.name !== "not" ||
        selector.args === null ||
        selector.args.children.every((c) => c.children.length === 1))) ||
      // selectors with has/is/where/not can also be global if all their
      // children are global
      selector.args === null ||
      selector.args.children.every((c) =>
        c.children.every((r) => isGlobalRelative(r)),
      ))
  );
}

/** svelte's `is_global` from css/utils.js. */
function isGlobalRelative(relative: RelativeSelector): boolean {
  const first = relative.selectors[0];
  return (
    first.type === "PseudoClassSelector" &&
    first.name === "global" &&
    (first.args === null ||
      // :global(button).x is still scoped because of the .x
      relative.selectors.every(
        (selector) =>
          isUnscopedPseudoClass(selector) ||
          selector.type === "PseudoElementSelector",
      ))
  );
}

function getAttributeExpression(
  attribute: AST.Attribute,
): Expression | undefined {
  const { value } = attribute;
  if (value === true) return;
  if (!Array.isArray(value)) return stripTs(value.expression);
  if (value.length === 1 && value[0].type === "ExpressionTag")
    return stripTs(value[0].expression);
}

const TS_WRAPPERS: ReadonlySet<string> = new Set([
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "TSTypeAssertion",
  "TSInstantiationExpression",
]);

/** The expression without the TypeScript wrappers svelte strips before it analyzes. */
function stripTs(expression: Expression): Expression {
  let node = expression;
  while (TS_WRAPPERS.has(node.type)) {
    node = (node as unknown as { expression: Expression }).expression;
  }
  return node;
}

function unwrapOptional(expression: Expression): Expression {
  const node = stripTs(expression);
  return node.type === "ChainExpression"
    ? stripTs(node.expression as Expression)
    : node;
}

/** svelte's `is_resolved_snippet`, on sveast's bindings. */
function isResolvedSnippet(binding: Binding | null): boolean {
  return (
    !binding ||
    binding.kind === "import" ||
    binding.prop !== null ||
    binding.rune === "$props" ||
    binding.initial?.type === "SnippetBlock"
  );
}

/**
 * The selectors in a component's `<style>` that svelte's compiler warns
 * match nothing in the markup, as svelte's `css_unused_selector` warnings.
 */
export function cssUnusedSelectors(
  ast: AST.Root,
  runes: boolean,
  warn: (node: AST.CSS.ComplexSelector, code: string, message: string) => void,
): void {
  const stylesheet = ast.css;
  if (!stylesheet || stylesheet.children.length === 0) return;
  const { comment } = stylesheet.content;
  if (
    comment &&
    ignoreCodes(comment.data, runes).includes("css_unused_selector")
  ) {
    return;
  }
  new UnusedSelectors(ast, stylesheet).run(warn);
}

class UnusedSelectors {
  private readonly ast: AST.Root;
  private readonly stylesheet: AST.CSS.StyleSheet;
  private scopes: Scopes | undefined;

  // The template's metadata.
  private readonly elements: Element[] = [];
  private readonly paths = new Map<Node, readonly Node[]>();
  private readonly snippetsOf = new Map<Renderer, Set<AST.SnippetBlock>>();
  private readonly sitesOf = new Map<AST.SnippetBlock, Set<Renderer>>();

  // The stylesheet's metadata.
  private readonly relatives = new Map<RelativeSelector, RelativeMeta>();
  private readonly complexes = new Map<ComplexSelector, ComplexMeta>();
  private readonly rules = new Map<Rule, RuleMeta>();

  constructor(ast: AST.Root, stylesheet: AST.CSS.StyleSheet) {
    this.ast = ast;
    this.stylesheet = stylesheet;
    this.relatives.set(NESTING_SELECTOR, {
      isGlobal: false,
      isGlobalLike: false,
    });
    this.relatives.set(ANY_SELECTOR, { isGlobal: false, isGlobalLike: false });
  }

  run(
    warn: (node: ComplexSelector, code: string, message: string) => void,
  ): void {
    this.analyzeTemplate();
    this.analyzeCss(this.stylesheet, null);
    this.prune(this.stylesheet);
    this.warnUnused(this.stylesheet, [], warn);
  }

  // --- metadata ---

  private relative(node: RelativeSelector): RelativeMeta {
    let meta = this.relatives.get(node);
    if (!meta) {
      meta = { isGlobal: false, isGlobalLike: false };
      this.relatives.set(node, meta);
    }
    return meta;
  }

  private complex(node: ComplexSelector): ComplexMeta {
    let meta = this.complexes.get(node);
    if (!meta) {
      meta = { used: false, rule: null };
      this.complexes.set(node, meta);
    }
    return meta;
  }

  private rule(node: Rule): RuleMeta {
    let meta = this.rules.get(node);
    if (!meta) {
      meta = { parentRule: null, isGlobalBlock: false };
      this.rules.set(node, meta);
    }
    return meta;
  }

  /** A copy of `node` with `fields`, which shares its metadata, as svelte's spread copies do. */
  private copyRelative(
    node: RelativeSelector,
    fields: Partial<RelativeSelector>,
  ): RelativeSelector {
    const copy = { ...node, ...fields };
    this.relatives.set(copy, this.relative(node));
    return copy;
  }

  private markUsedDeep(node: CssNode): void {
    if (node.type === "ComplexSelector") this.complex(node).used = true;
    for (const child of cssChildren(node)) this.markUsedDeep(child);
  }

  /** Marks the outermost complex selectors in `node` used, as a walk that doesn't go into them. */
  private markUsedShallow(node: CssNode): void {
    if (node.type === "ComplexSelector") {
      this.complex(node).used = true;
      return;
    }
    for (const child of cssChildren(node)) this.markUsedShallow(child);
  }

  // --- the template ---

  private bindingOf(identifier: Identifier): Binding | null {
    this.scopes ??= analyzeScopes(this.ast);
    return this.scopes.bindingOf(identifier);
  }

  private analyzeTemplate(): void {
    const all = new Set<AST.SnippetBlock>();
    const renderers = new Map<Renderer, boolean>();
    const path: Node[] = [];
    let heads = 0;
    const visit = (node: Node): void => {
      switch (node.type) {
        case "RegularElement":
        case "SvelteElement":
          this.paths.set(node, path.slice());
          // Elements in <svelte:head> aren't scoped.
          if (heads === 0) this.elements.push(node as Element);
          break;
        case "SnippetBlock":
          all.add(node as AST.SnippetBlock);
          break;
        case "RenderTag":
          this.paths.set(node, path.slice());
          renderers.set(
            node as AST.RenderTag,
            this.linkRenderTag(node as AST.RenderTag),
          );
          break;
        case "Component":
        case "SvelteComponent":
        case "SvelteSelf":
          this.paths.set(node, path.slice());
          renderers.set(
            node as ComponentLike,
            this.linkComponent(node as ComponentLike),
          );
          break;
      }
      if (node.type === "SvelteHead") heads++;
      path.push(node);
      if (
        node.type === "Component" ||
        node.type === "SvelteComponent" ||
        node.type === "SvelteSelf"
      ) {
        // svelte visits each slot's children as a fragment of their own,
        // so a `slot="…"` child isn't a sibling of the others.
        for (const fragment of slotFragments(node as ComponentLike)) {
          path.push(fragment);
          for (const child of fragment.nodes) visit(child);
          path.pop();
        }
      } else {
        forEachChild(node as AST.SvelteNode, visit, markupVisitorKeys);
      }
      path.pop();
      if (node.type === "SvelteHead") heads--;
    };
    visit(this.ast.fragment);

    for (const [node, resolved] of renderers) {
      // A renderer that can't be resolved could render any snippet.
      if (!resolved) this.snippetsOf.set(node, all);
      for (const snippet of this.snippets(node)) {
        let sites = this.sitesOf.get(snippet);
        if (!sites) {
          sites = new Set();
          this.sitesOf.set(snippet, sites);
        }
        sites.add(node);
      }
    }
  }

  private snippets(node: Renderer): ReadonlySet<AST.SnippetBlock> {
    return this.snippetsOf.get(node) ?? new Set();
  }

  private addSnippet(node: Renderer, snippet: AST.SnippetBlock): void {
    let snippets = this.snippetsOf.get(node);
    if (!snippets) {
      snippets = new Set();
      this.snippetsOf.set(node, snippets);
    }
    snippets.add(snippet);
  }

  /** Links a render tag to the snippet it renders; whether that's all it can render. */
  private linkRenderTag(node: AST.RenderTag): boolean {
    const callee = stripTs(
      (unwrapOptional(node.expression) as { callee: Expression }).callee,
    );
    const binding =
      callee.type === "Identifier" ? this.bindingOf(callee) : null;
    if (binding?.initial?.type === "SnippetBlock") {
      this.addSnippet(node, binding.initial as AST.SnippetBlock);
    }
    return callee.type === "Identifier" && isResolvedSnippet(binding);
  }

  /** Links a component to the snippets it's given; whether those are all it can render. */
  private linkComponent(node: ComponentLike): boolean {
    let resolved = true;
    for (const attribute of node.attributes) {
      if (
        attribute.type === "SpreadAttribute" ||
        attribute.type === "BindDirective"
      ) {
        resolved = false;
        continue;
      }
      if (attribute.type !== "Attribute") continue;
      const expression = getAttributeExpression(attribute);
      if (!expression) continue;
      if (expression.type === "Identifier") {
        const binding = this.bindingOf(expression);
        resolved &&= isResolvedSnippet(binding);
        if (binding?.initial?.type === "SnippetBlock") {
          this.addSnippet(node, binding.initial as AST.SnippetBlock);
        }
      } else if (expression.type !== "Literal") {
        resolved = false;
      }
    }
    if (resolved) {
      for (const child of node.fragment.nodes) {
        if (child.type === "SnippetBlock") this.addSnippet(node, child);
      }
    }
    return resolved;
  }

  private pathOf(node: Node): readonly Node[] {
    return this.paths.get(node) ?? [];
  }

  // --- css-analyze.js ---

  private analyzeCss(node: CssNode, rule: Rule | null): void {
    switch (node.type) {
      case "Rule":
        this.analyzeRule(node, rule);
        return;
      case "ComplexSelector": {
        for (const child of node.children) this.analyzeCss(child, rule);
        const meta = this.complex(node);
        meta.rule = rule;
        const isGlobal = node.children.every((child) => {
          const relative = this.relative(child);
          return relative.isGlobal || relative.isGlobalLike;
        });
        meta.used ||= isGlobal;
        const parentRule = rule && this.rule(rule).parentRule;
        if (
          parentRule &&
          node.children[0]?.selectors[0]?.type === "NestingSelector"
        ) {
          const first = node.children[0]?.selectors[1];
          const noNestingScope =
            first?.type !== "PseudoClassSelector" ||
            isUnscopedPseudoClass(first);
          const parentIsGlobal = parentRule.prelude.children.some(
            (child) =>
              child.children.length === 1 &&
              this.relative(child.children[0]).isGlobal,
          );
          // `&:hover` in `:global(.foo) { &:hover { … } }` is used
          if (noNestingScope && parentIsGlobal) meta.used = true;
        }
        return;
      }
      case "RelativeSelector": {
        const meta = this.relative(node);
        meta.isGlobal = node.selectors.length > 0 && isGlobalRelative(node);
        if (
          node.selectors.length > 0 &&
          node.selectors.every(
            (selector) =>
              selector.type === "PseudoClassSelector" ||
              selector.type === "PseudoElementSelector",
          )
        ) {
          const first = node.selectors[0];
          meta.isGlobalLike ||=
            (first.type === "PseudoClassSelector" && first.name === "host") ||
            (first.type === "PseudoElementSelector" &&
              VIEW_TRANSITION_PSEUDO_ELEMENTS.has(first.name));
        }
        meta.isGlobalLike ||=
          node.selectors.some(
            (child) =>
              child.type === "PseudoClassSelector" && child.name === "root",
          ) &&
          // :root.y:has(.x) isn't global: .x in :has(…) is scoped
          !node.selectors.some(
            (child) =>
              child.type === "PseudoClassSelector" && child.name === "has",
          );
        if (meta.isGlobalLike || meta.isGlobal) {
          // So that selectors like `:root:not(.x)` aren't unused
          for (const child of node.selectors) this.markUsedDeep(child);
        }
        for (const child of node.selectors) this.analyzeCss(child, rule);
        return;
      }
      case "PseudoElementSelector":
        return;
      default:
        for (const child of cssChildren(node)) this.analyzeCss(child, rule);
    }
  }

  private analyzeRule(node: Rule, parentRule: Rule | null): void {
    const meta = this.rule(node);
    meta.parentRule = parentRule;
    for (const complex of node.prelude.children) {
      let isGlobalBlock = false;
      for (let index = 0; index < complex.children.length; index++) {
        const child = complex.children[index];
        const at = child.selectors.findIndex(isGlobalBlockSelector);
        // Every selector after :global is unscoped
        if (isGlobalBlock) this.relative(child).isGlobalLike = true;
        if (
          at === 0 &&
          !(child.selectors.length > 1 && index === 0 && parentRule === null)
        ) {
          // `child` starts with `:global`
          meta.isGlobalBlock = isGlobalBlock = true;
          for (let i = 1; i < child.selectors.length; i++) {
            this.markUsedShallow(child.selectors[i]);
          }
        }
      }
    }
    this.analyzeCss(node.prelude, node);
    this.analyzeCss(node.block, node);
  }

  // --- css-prune.js ---

  private prune(node: CssNode): void {
    if (node.type === "Rule" && this.rule(node).isGlobalBlock) {
      this.prune(node.prelude);
      return;
    }
    if (node.type === "ComplexSelector") {
      this.pruneComplex(node);
      return;
    }
    for (const child of cssChildren(node)) this.prune(child);
  }

  private pruneComplex(node: ComplexSelector): void {
    const meta = this.complex(node);
    const selectors = this.relativeSelectors(node);
    const rule = meta.rule as Rule;
    // Global rules don't depend on an element in this component
    if (this.everyIsGlobal(selectors, 0, selectors.length, rule)) {
      meta.used = true;
    }
    // Matching an element can mark the selectors in `:is(…)`, `:has(…)`,
    // `:not(…)` or a parent rule used, so svelte tries every element. Without
    // those, the first match is enough.
    const marks = selectors.some(marksOthers);
    if (meta.used && !marks) return;
    for (const element of this.elements) {
      if (this.applySelector(selectors, rule, element, BACKWARD)) {
        meta.used = true;
        if (!marks) return;
      }
    }
  }

  private relativeSelectors(node: ComplexSelector): RelativeSelector[] {
    const selectors = this.truncate(node);
    const rule = this.complex(node).rule;
    if (rule && this.rule(rule).parentRule && selectors.length > 0) {
      // nesting could be inside pseudo classes like :is, :has or :where
      const hasNesting = selectors.some((selector) =>
        hasNestingSelector(selector),
      );
      if (!hasNesting) {
        if (selectors[0].combinator === null) {
          selectors[0] = this.copyRelative(selectors[0], {
            combinator: DESCENDANT_COMBINATOR,
          });
        }
        selectors.unshift(NESTING_SELECTOR);
      }
    }
    return selectors;
  }

  private truncate(node: ComplexSelector): RelativeSelector[] {
    const i = node.children.findLastIndex((child) => {
      const meta = this.relative(child);
      const first = child.selectors[0];
      return (
        // not after a :global selector
        !meta.isGlobalLike &&
        !(
          first.type === "PseudoClassSelector" &&
          first.name === "global" &&
          first.args === null
        ) &&
        // not a :global(...) without a scoped :has/is/where(...) modifier
        !meta.isGlobal
      );
    });
    return node.children.slice(0, i + 1).map((child) => {
      // In `:root.y:has(...)`, `y` is unscoped, but `:has(...)` is scoped
      // if not global, so only `:has` counts.
      const root = child.selectors.find(
        (s) => s.type === "PseudoClassSelector" && s.name === "root",
      );
      if (!root || this.relative(child).isGlobalLike) return child;
      return this.copyRelative(child, {
        selectors: child.selectors.filter(
          (s) => s.type === "PseudoClassSelector" && s.name === "has",
        ),
      });
    });
  }

  private applySelector(
    relatives: readonly RelativeSelector[],
    rule: Rule,
    element: Node,
    direction: Direction,
    from = 0,
    to = relatives.length,
  ): boolean {
    if (from >= to) return false;
    const index = direction === FORWARD ? from : to - 1;
    const relative = relatives[index];
    const restFrom = direction === FORWARD ? from + 1 : from;
    const restTo = direction === FORWARD ? to : to - 1;
    return (
      this.mightApply(relative, rule, element as Element, direction) &&
      this.applyCombinator(
        relative,
        relatives,
        restFrom,
        restTo,
        rule,
        element,
        direction,
      )
    );
  }

  private applyCombinator(
    relative: RelativeSelector,
    relatives: readonly RelativeSelector[],
    from: number,
    to: number,
    rule: Rule,
    node: Node,
    direction: Direction,
  ): boolean {
    let combinator: AST.CSS.Combinator | null | undefined = relative.combinator;
    if (direction === FORWARD)
      combinator = from < to ? relatives[from].combinator : undefined;
    if (!combinator) return true;

    switch (combinator.name) {
      case " ":
      case ">": {
        const adjacent = combinator.name === ">";
        const parents =
          direction === FORWARD
            ? this.descendantElements(node, adjacent)
            : this.ancestorElements(node, adjacent);
        let matched = false;
        for (const parent of parents) {
          if (this.applySelector(relatives, rule, parent, direction, from, to))
            matched = true;
        }
        return (
          matched ||
          (direction === BACKWARD &&
            (!adjacent || parents.length === 0) &&
            this.everyIsGlobal(relatives, from, to, rule))
        );
      }
      case "+":
      case "~": {
        const siblings = this.possibleElementSiblings(
          node,
          direction,
          combinator.name === "+",
        );
        let matched = false;
        for (const sibling of siblings.keys()) {
          if (
            sibling.type === "RenderTag" ||
            sibling.type === "SlotElement" ||
            sibling.type === "Component"
          ) {
            // `{@render foo()}<p>foo</p>` with `:global(.x) + p` is a match
            if (to - from === 1 && this.relative(relatives[from]).isGlobal)
              matched = true;
          } else if (
            this.applySelector(relatives, rule, sibling, direction, from, to)
          ) {
            matched = true;
          }
        }
        return (
          matched ||
          (direction === BACKWARD &&
            this.elementParent(node) === null &&
            this.everyIsGlobal(relatives, from, to, rule))
        );
      }
      default:
        return true;
    }
  }

  private everyIsGlobal(
    relatives: readonly RelativeSelector[],
    from: number,
    to: number,
    rule: Rule,
  ): boolean {
    for (let i = from; i < to; i++) {
      if (!this.isGlobal(relatives[i], rule)) return false;
    }
    return true;
  }

  /** svelte's `is_global` from css-prune.js. */
  private isGlobal(selector: RelativeSelector, rule: Rule): boolean {
    const meta = this.relative(selector);
    if (meta.isGlobal || meta.isGlobalLike) return true;
    let explicitlyGlobal = false;
    for (const s of selector.selectors) {
      let list: SelectorList | null = null;
      let canBeGlobal = false;
      let owner = rule;
      if (s.type === "PseudoClassSelector") {
        if ((s.name === "is" || s.name === "where") && s.args) {
          list = s.args;
        } else {
          canBeGlobal = isUnscopedPseudoClass(s);
        }
      }
      if (s.type === "NestingSelector") {
        owner = this.rule(rule).parentRule as Rule;
        list = owner.prelude;
      }
      const hasGlobal = Boolean(
        list?.children.some((complex) =>
          complex.children.every((relative) => this.isGlobal(relative, owner)),
        ),
      );
      explicitlyGlobal ||= hasGlobal;
      if (!hasGlobal && !canBeGlobal) return false;
    }
    return explicitlyGlobal || selector.selectors.length === 0;
  }

  private parentRules(rule: Rule): Rule[] {
    const rules: Rule[] = [];
    let current: Rule | null = rule;
    while (current) {
      rules.push(current);
      current = this.rule(current).parentRule;
    }
    return rules;
  }

  private mightApply(
    relative: RelativeSelector,
    rule: Rule,
    element: Element,
    direction: Direction,
  ): boolean {
    let includeSelf: boolean | undefined;
    for (const selector of relative.selectors) {
      if (
        selector.type === "PseudoClassSelector" &&
        selector.name === "has" &&
        selector.args
      ) {
        if (includeSelf === undefined) {
          // A :has in a global selector includes the element itself, since
          // the global selector might be for an element outside the
          // component: :root:has(.scoped), :global(.foo):has(.scoped)
          const rules = this.parentRules(rule);
          includeSelf =
            rules.some((r) =>
              r.prelude.children.some((c) =>
                c.children.some((s) => this.isGlobal(s, r)),
              ),
            ) ||
            rules[rules.length - 1].prelude.children.some((c) =>
              c.children.some((r) =>
                r.selectors.some(
                  (s) =>
                    s.type === "PseudoClassSelector" &&
                    (s.name === "root" || (s.name === "global" && s.args)),
                ),
              ),
            );
        }
        // `.x:has(.y)` looks down the tree: match what's in :has(...)
        // first, as if it were `.x .y`.
        let matched = false;
        for (const complex of selector.args.children) {
          const [first, ...rest] = this.truncate(complex);
          // if it was just a :global(...)
          if (!first) {
            this.complex(complex).used = true;
            matched = true;
            continue;
          }
          if (includeSelf) {
            const includingSelf = [
              first.combinator
                ? this.copyRelative(first, { combinator: null })
                : first,
              ...rest,
            ];
            if (this.applySelector(includingSelf, rule, element, FORWARD)) {
              this.complex(complex).used = true;
              matched = true;
            }
          }
          const excludingSelf = [
            ANY_SELECTOR,
            first.combinator
              ? first
              : this.copyRelative(first, { combinator: DESCENDANT_COMBINATOR }),
            ...rest,
          ];
          if (this.applySelector(excludingSelf, rule, element, FORWARD)) {
            this.complex(complex).used = true;
            matched = true;
          }
        }
        if (!matched) return false;
        continue;
      }

      if (selector.type === "Percentage" || selector.type === "Nth") continue;

      const name = selector.name.includes("\\")
        ? selector.name.replace(BACKSLASH_AND_FOLLOWING, "$1")
        : selector.name;

      switch (selector.type) {
        case "PseudoClassSelector": {
          if (name === "host" || name === "root") return false;
          if (
            name === "global" &&
            selector.args !== null &&
            relative.selectors.length === 1
          ) {
            return this.applySelector(
              selector.args.children[0].children,
              rule,
              element,
              BACKWARD,
            );
          }
          // Everything after a :global is global, so a potential match
          if (name === "global" && selector.args === null) return true;
          // :not(...) stays unscoped, so all of it counts as used
          if (name === "not" && selector.args) {
            for (const complex of selector.args.children)
              this.markUsedDeep(complex);
            break;
          }
          if ((name === "is" || name === "where") && selector.args) {
            let matched = false;
            for (const complex of selector.args.children) {
              const relatives = this.truncate(complex);
              if (relatives.length === 0) {
                this.complex(complex).used = true;
                matched = true;
              } else if (
                this.applySelector(relatives, rule, element, BACKWARD)
              ) {
                this.complex(complex).used = true;
                matched = true;
              } else if (complex.children.length > 1) {
                // `foo :is(bar baz)` can also mean bar is an ancestor of
                // foo and baz a descendant; svelte assumes it matches.
                this.complex(complex).used = true;
                matched = true;
              }
            }
            if (!matched) return false;
          }
          break;
        }
        case "PseudoElementSelector":
          break;
        case "AttributeSelector": {
          const whitelisted = WHITELIST_ATTRIBUTE_SELECTOR.get(
            element.name.toLowerCase(),
          );
          if (
            !whitelisted?.includes(selector.name.toLowerCase()) &&
            !attributeMatches(
              element,
              selector.name,
              selector.value && unquote(selector.value),
              selector.matcher,
              (selector.flags?.includes("i") ?? false) ||
                (!selector.flags?.includes("s") &&
                  CASE_INSENSITIVE_ATTRIBUTES.has(selector.name.toLowerCase())),
            )
          ) {
            return false;
          }
          break;
        }
        case "ClassSelector":
          if (!attributeMatches(element, "class", name, "~=", false))
            return false;
          break;
        case "IdSelector":
          if (!attributeMatches(element, "id", name, "=", false)) return false;
          break;
        case "TypeSelector":
          if (
            element.name.toLowerCase() !== name.toLowerCase() &&
            name !== "*" &&
            element.type !== "SvelteElement"
          ) {
            return false;
          }
          break;
        case "NestingSelector": {
          let matched = false;
          const parent = this.rule(rule).parentRule as Rule;
          for (const complex of parent.prelude.children) {
            if (
              this.applySelector(
                this.relativeSelectors(complex),
                parent,
                element,
                direction,
              ) ||
              complex.children.every((s) => this.isGlobal(s, parent))
            ) {
              this.complex(complex).used = true;
              matched = true;
            }
          }
          if (!matched) return false;
          break;
        }
      }
    }
    // possible match
    return true;
  }

  private ancestorElements(
    node: Node,
    adjacentOnly: boolean,
    seen = new Set<AST.SnippetBlock>(),
  ): Node[] {
    const ancestors: Node[] = [];
    const path = this.pathOf(node);
    let i = path.length;
    while (i--) {
      const parent = path[i];
      if (parent.type === "SnippetBlock") {
        const snippet = parent as AST.SnippetBlock;
        if (!seen.has(snippet)) {
          seen.add(snippet);
          for (const site of this.sitesOf.get(snippet) ?? []) {
            ancestors.push(...this.ancestorElements(site, adjacentOnly, seen));
          }
        }
        break;
      }
      if (parent.type === "RegularElement" || parent.type === "SvelteElement") {
        // Elements in an <option> are also descendants of the
        // <selectedcontent> in its <select>, which clones the selected
        // option's content.
        if (
          parent.type === "RegularElement" &&
          (parent as AST.RegularElement).name === "option"
        ) {
          const isDirectChild = ancestors.length === 0;
          const select = path.findLast(
            (element, j) =>
              element.type === "RegularElement" &&
              (element as AST.RegularElement).name === "select" &&
              j < i,
          );
          if (select && (!adjacentOnly || isDirectChild)) {
            const selectedcontent = findSelectedcontent(select);
            if (adjacentOnly && isDirectChild && selectedcontent) {
              return [selectedcontent, parent];
            }
            if (selectedcontent) ancestors.push(selectedcontent);
          }
        }
        ancestors.push(parent);
        if (adjacentOnly) break;
      }
    }
    return ancestors;
  }

  private descendantElements(
    node: Node,
    adjacentOnly: boolean,
    seen = new Set<AST.SnippetBlock>(),
  ): Node[] {
    const descendants: Node[] = [];
    const visit = (child: Node): void => {
      if (child.type === "RegularElement" || child.type === "SvelteElement") {
        descendants.push(child);
        if (!adjacentOnly) visitChildren(child);
      } else if (child.type === "RenderTag") {
        for (const snippet of this.snippets(child as AST.RenderTag)) {
          if (seen.has(snippet)) continue;
          seen.add(snippet);
          visit(snippet.body);
        }
      } else {
        visitChildren(child);
      }
    };
    const visitChildren = (child: Node): void =>
      forEachChild(child as AST.SvelteNode, visit, markupVisitorKeys);

    visit(node.type === "RenderTag" ? node : (node as Element).fragment);

    // <selectedcontent> clones the selected <option>'s content, so what's
    // in the <option>s of its <select> are its descendants too.
    if (
      node.type === "RegularElement" &&
      (node as AST.RegularElement).name === "selectedcontent"
    ) {
      const select = this.pathOf(node).findLast(
        (element) =>
          element.type === "RegularElement" &&
          (element as AST.RegularElement).name === "select",
      );
      if (select) {
        const inSelect = (child: Node, insideOption: boolean): void => {
          if (
            child.type === "RegularElement" &&
            (child as AST.RegularElement).name === "option"
          ) {
            forEachChild(
              child as AST.SvelteNode,
              (c) => inSelect(c, true),
              markupVisitorKeys,
            );
          } else if (insideOption) {
            visit(child);
          } else {
            forEachChild(
              child as AST.SvelteNode,
              (c) => inSelect(c, false),
              markupVisitorKeys,
            );
          }
        };
        inSelect(select, false);
      }
    }
    return descendants;
  }

  private elementParent(node: Node): Node | null {
    const path = this.pathOf(node);
    let i = path.length;
    while (i--) {
      const parent = path[i];
      if (parent.type === "RegularElement" || parent.type === "SvelteElement")
        return parent;
    }
    return null;
  }

  private possibleElementSiblings(
    node: Node,
    direction: Direction,
    adjacentOnly: boolean,
    seen = new Set<AST.SnippetBlock>(),
  ): Map<Node, Existence> {
    const result = new Map<Node, Existence>();
    const path = this.pathOf(node);
    let current: Node | undefined = node;
    let i = path.length;
    while (i--) {
      const fragment = path[i--] as unknown as AST.Fragment;
      let j =
        (fragment.nodes as Node[]).indexOf(current) +
        (direction === FORWARD ? 1 : -1);
      while (j >= 0 && j < fragment.nodes.length) {
        const sibling = fragment.nodes[j] as Node;
        if (sibling.type === "RegularElement") {
          const hasSlot = (sibling as AST.RegularElement).attributes.some(
            (attribute) =>
              attribute.type === "Attribute" &&
              attribute.name.toLowerCase() === "slot",
          );
          if (!hasSlot) {
            result.set(sibling, NODE_DEFINITELY_EXISTS);
            if (adjacentOnly) return result;
          }
          // Slots, render tags and <svelte:element>s could resolve to no
          // siblings, so keep looking for a definite one even with `+`.
        } else if (isBlock(sibling) || sibling.type === "Component") {
          if (sibling.type === "SlotElement" || sibling.type === "Component") {
            result.set(sibling, NODE_PROBABLY_EXISTS);
          }
          const possibleLastChild = this.possibleNestedSiblings(
            sibling,
            direction,
            adjacentOnly,
          );
          addToMap(possibleLastChild, result);
          if (
            adjacentOnly &&
            sibling.type !== "Component" &&
            hasDefiniteElements(possibleLastChild)
          ) {
            return result;
          }
        } else if (sibling.type === "SvelteElement") {
          result.set(sibling, NODE_PROBABLY_EXISTS);
        } else if (sibling.type === "RenderTag") {
          result.set(sibling, NODE_PROBABLY_EXISTS);
          for (const snippet of this.snippets(sibling as AST.RenderTag)) {
            addToMap(
              this.possibleNestedSiblings(snippet, direction, adjacentOnly),
              result,
            );
          }
        }
        j = direction === FORWARD ? j + 1 : j - 1;
      }

      current = path[i];
      if (!current) break;
      if (
        current.type === "Component" ||
        current.type === "SvelteComponent" ||
        current.type === "SvelteSelf"
      ) {
        continue;
      }
      if (current.type === "SnippetBlock") {
        const snippet = current as AST.SnippetBlock;
        if (seen.has(snippet)) break;
        seen.add(snippet);
        const sites = this.sitesOf.get(snippet) ?? new Set();
        for (const site of sites) {
          const siblings = this.possibleElementSiblings(
            site,
            direction,
            adjacentOnly,
            seen,
          );
          addToMap(siblings, result);
          if (adjacentOnly && sites.size === 1 && hasDefiniteElements(siblings))
            return result;
        }
      }
      if (!isBlock(current)) break;
      if (
        current.type === "EachBlock" &&
        fragment === (current as AST.EachBlock).body
      ) {
        // `{#each ...}<a /><b />{/each}`: `<b>` can be before `<a />`
        addToMap(
          this.possibleNestedSiblings(current, direction, adjacentOnly),
          result,
        );
      }
    }
    return result;
  }

  private possibleNestedSiblings(
    node: Node,
    direction: Direction,
    adjacentOnly: boolean,
    seen = new Set<AST.SnippetBlock>(),
  ): Map<Node, Existence> {
    const fragments: (AST.Fragment | null | undefined)[] = [];
    switch (node.type) {
      case "EachBlock": {
        const each = node as AST.EachBlock;
        fragments.push(each.body, each.fallback);
        break;
      }
      case "IfBlock": {
        const block = node as AST.IfBlock;
        fragments.push(block.consequent, block.alternate);
        break;
      }
      case "AwaitBlock": {
        const block = node as AST.AwaitBlock;
        fragments.push(block.pending, block.then, block.catch);
        break;
      }
      case "KeyBlock":
      case "SlotElement":
        fragments.push((node as AST.KeyBlock).fragment);
        break;
      case "SnippetBlock": {
        const snippet = node as AST.SnippetBlock;
        if (seen.has(snippet)) return new Map();
        seen.add(snippet);
        fragments.push(snippet.body);
        break;
      }
      case "Component": {
        const component = node as AST.Component;
        fragments.push(component.fragment);
        for (const snippet of this.snippets(component))
          fragments.push(snippet.body);
        break;
      }
    }

    const result = new Map<Node, Existence>();
    let exhaustive =
      node.type !== "SlotElement" && node.type !== "SnippetBlock";
    for (const fragment of fragments) {
      if (fragment == null) {
        exhaustive = false;
        continue;
      }
      const map = this.loopChild(
        fragment.nodes as Node[],
        direction,
        adjacentOnly,
        seen,
      );
      exhaustive &&= hasDefiniteElements(map);
      addToMap(map, result);
    }
    if (!exhaustive) {
      for (const key of result.keys()) result.set(key, NODE_PROBABLY_EXISTS);
    }
    return result;
  }

  private loopChild(
    children: readonly Node[],
    direction: Direction,
    adjacentOnly: boolean,
    seen: Set<AST.SnippetBlock>,
  ): Map<Node, Existence> {
    const result = new Map<Node, Existence>();
    let i = direction === FORWARD ? 0 : children.length - 1;
    while (i >= 0 && i < children.length) {
      const child = children[i];
      if (child.type === "RegularElement") {
        result.set(child, NODE_DEFINITELY_EXISTS);
        if (adjacentOnly) break;
      } else if (child.type === "SvelteElement") {
        result.set(child, NODE_PROBABLY_EXISTS);
      } else if (child.type === "RenderTag") {
        for (const snippet of this.snippets(child as AST.RenderTag)) {
          addToMap(
            this.possibleNestedSiblings(snippet, direction, adjacentOnly, seen),
            result,
          );
        }
      } else if (isBlock(child)) {
        const childResult = this.possibleNestedSiblings(
          child,
          direction,
          adjacentOnly,
          seen,
        );
        addToMap(childResult, result);
        if (adjacentOnly && hasDefiniteElements(childResult)) break;
      }
      i = direction === FORWARD ? i + 1 : i - 1;
    }
    return result;
  }

  // --- css-warn.js ---

  private warnUnused(
    node: CssNode,
    path: CssNode[],
    warn: (
      node: AST.CSS.ComplexSelector,
      code: string,
      message: string,
    ) => void,
  ): void {
    switch (node.type) {
      case "Atrule":
        if (isKeyframes(node)) return;
        break;
      case "PseudoClassSelector":
        if (node.name !== "is" && node.name !== "where") return;
        break;
      case "PseudoElementSelector":
        return;
      case "ComplexSelector": {
        const outer = path.at(-4);
        if (
          !this.complex(node).used &&
          // `.unused:is(.unused)` warns once
          (path.at(-2)?.type !== "PseudoClassSelector" ||
            (outer !== undefined &&
              this.complex(outer as ComplexSelector).used))
        ) {
          const { content } = this.stylesheet;
          const text = content.styles.slice(
            node.start - content.start,
            node.end - content.start,
          );
          warn(
            node,
            "css_unused_selector",
            `Unused CSS selector "${text}"\nhttps://svelte.dev/e/css_unused_selector`,
          );
        }
        break;
      }
      case "Rule":
        if (this.rule(node).isGlobalBlock) {
          path.push(node);
          this.warnUnused(node.prelude, path, warn);
          path.pop();
          return;
        }
        break;
    }
    path.push(node);
    for (const child of cssChildren(node)) this.warnUnused(child, path, warn);
    path.pop();
  }
}

function hasNestingSelector(node: CssNode): boolean {
  if (node.type === "NestingSelector") return true;
  for (const child of cssChildren(node)) {
    if (hasNestingSelector(child)) return true;
  }
  return false;
}

/** Whether matching `node` can mark other selectors used. */
function marksOthers(node: CssNode): boolean {
  if (node.type === "NestingSelector") return true;
  if (node.type === "PseudoClassSelector" && node.args) return true;
  for (const child of cssChildren(node)) {
    if (marksOthers(child)) return true;
  }
  return false;
}

const ELEMENT_NODES: ReadonlySet<string> = new Set([
  "SvelteElement",
  "RegularElement",
  "SvelteFragment",
  "Component",
  "SvelteComponent",
  "SvelteSelf",
  "SlotElement",
]);

/** svelte's `determine_slot`: the slot a component's child goes in. */
function slotOf(node: Node): string | null {
  if (!ELEMENT_NODES.has(node.type)) return null;
  for (const attribute of (node as AST.RegularElement).attributes) {
    if (attribute.type !== "Attribute" || attribute.name !== "slot") continue;
    const { value } = attribute;
    if (Array.isArray(value) && value.length === 1 && value[0].type === "Text")
      return value[0].data;
  }
  return null;
}

/** A component's children, split by slot into copies of its fragment, as svelte visits them. */
function slotFragments(node: ComponentLike): AST.Fragment[] {
  let comments: Node[] = [];
  const slots = new Map<string, Node[]>([["default", []]]);
  for (const child of node.fragment.nodes as Node[]) {
    if (child.type === "Comment") {
      comments.push(child);
      continue;
    }
    const name = slotOf(child) ?? "default";
    let nodes = slots.get(name);
    if (!nodes) {
      nodes = [];
      slots.set(name, nodes);
    }
    nodes.push(...comments, child);
    if (name !== "default") comments = [];
  }
  return [...slots.values()].map(
    (nodes) => ({ ...node.fragment, nodes }) as AST.Fragment,
  );
}

function findSelectedcontent(select: Node): Node | null {
  let found: Node | null = null;
  const visit = (node: Node): void => {
    if (found) return;
    if (
      node.type === "RegularElement" &&
      (node as AST.RegularElement).name === "selectedcontent"
    ) {
      found = node;
      return;
    }
    forEachChild(node as AST.SvelteNode, visit, markupVisitorKeys);
  };
  visit(select);
  return found;
}

function isBlock(node: Node): boolean {
  return (
    node.type === "IfBlock" ||
    node.type === "EachBlock" ||
    node.type === "AwaitBlock" ||
    node.type === "KeyBlock" ||
    node.type === "SlotElement"
  );
}

function hasDefiniteElements(result: ReadonlyMap<Node, Existence>): boolean {
  for (const exists of result.values()) {
    if (exists === NODE_DEFINITELY_EXISTS) return true;
  }
  return false;
}

function addToMap(
  from: ReadonlyMap<Node, Existence>,
  to: Map<Node, Existence>,
): void {
  for (const [element, exists] of from) {
    const existing = to.get(element);
    to.set(
      element,
      existing === undefined || exists > existing ? exists : existing,
    );
  }
}

function unquote(text: string): string {
  // svelte's check, quirk included: a leading `"` is enough
  if ((text.startsWith("'") && text.endsWith("'")) || text.startsWith('"')) {
    return text.slice(1, text.length - 1);
  }
  return text;
}

function testAttribute(
  operator: string | null,
  expected: string,
  caseInsensitive: boolean,
  actual: string,
): boolean {
  let want = expected;
  let value = actual;
  if (caseInsensitive) {
    want = want.toLowerCase();
    value = value.toLowerCase();
  }
  switch (operator) {
    case "=":
      return value === want;
    case "~=":
      return value.split(WHITESPACE).includes(want);
    case "|=":
      return `${value}-`.startsWith(`${want}-`);
    case "^=":
      return value.startsWith(want);
    case "$=":
      return value.endsWith(want);
    case "*=":
      return value.includes(want);
    default:
      throw new Error("this shouldn't happen");
  }
}

function attributeMatches(
  node: Element,
  name: string,
  expected: string | null,
  operator: string | null,
  caseInsensitive: boolean,
): boolean {
  const nameLower = name.toLowerCase();
  for (const attribute of node.attributes) {
    if (attribute.type === "SpreadAttribute") return true;
    if (attribute.type === "BindDirective" && attribute.name === name)
      return true;
    // match attributes against their directive, but not exactly
    if (attribute.type === "StyleDirective" && nameLower === "style")
      return true;
    if (attribute.type === "ClassDirective" && nameLower === "class") {
      if (operator === "~=") {
        if (attribute.name === expected) return true;
      } else {
        return true;
      }
    }
    if (attribute.type !== "Attribute") continue;
    if (attribute.name.toLowerCase() !== nameLower) continue;
    if (attribute.value === true) return operator === null;
    if (expected === null) return true;

    const { value } = attribute;
    if (
      Array.isArray(value) &&
      value.length === 1 &&
      value[0].type === "Text"
    ) {
      const matches = testAttribute(
        operator,
        expected,
        caseInsensitive,
        value[0].data,
      );
      // a class or style directive may still match
      if (!matches && (nameLower === "class" || nameLower === "style"))
        continue;
      return matches;
    }

    const chunks = Array.isArray(value) ? value : [value];
    const possible = new Set<string>();
    let previous: string[] = [];
    for (const chunk of chunks) {
      const current = possibleValues(chunk, nameLower === "class");
      // impossible to find out all combinations
      if (!current) return true;
      if (previous.length > 0) {
        const startWithSpace: string[] = [];
        const remaining: string[] = [];
        for (const candidate of current) {
          if (STARTS_WITH_WHITESPACE.test(candidate))
            startWithSpace.push(candidate);
          else remaining.push(candidate);
        }
        if (remaining.length > 0) {
          if (startWithSpace.length > 0) {
            for (const candidate of previous) possible.add(candidate);
          }
          const combined: string[] = [];
          for (const prefix of previous) {
            for (const candidate of remaining)
              combined.push(prefix + candidate);
          }
          previous = combined;
          for (const candidate of startWithSpace) {
            if (ENDS_WITH_WHITESPACE.test(candidate)) possible.add(candidate);
            else previous.push(candidate);
          }
          continue;
        }
        for (const candidate of previous) possible.add(candidate);
        previous = [];
      }
      for (const candidate of current) {
        if (ENDS_WITH_WHITESPACE.test(candidate)) possible.add(candidate);
        else previous.push(candidate);
      }
      if (previous.length < current.length) previous.push(" ");
      // might grow exponentially, bail out
      if (previous.length > 20) return true;
    }
    for (const candidate of previous) possible.add(candidate);
    for (const candidate of possible) {
      if (testAttribute(operator, expected, caseInsensitive, candidate))
        return true;
    }
  }
  return false;
}

function possibleValues(
  chunk: AST.Text | AST.ExpressionTag,
  isClass: boolean,
): string[] | null {
  const values = new Set<unknown>();
  if (chunk.type === "Text") values.add(chunk.data);
  else gatherPossibleValues(chunk.expression, isClass, values);
  if (values.has(UNKNOWN)) return null;
  return [...values].map((value) => String(value));
}

function gatherPossibleValues(
  expression: Expression,
  isClass: boolean,
  set: Set<unknown>,
  isNested = false,
): void {
  const node = stripTs(expression);
  // no point going any further
  if (set.has(UNKNOWN)) return;
  switch (node.type) {
    case "Literal":
      set.add(String(node.value));
      return;
    case "ConditionalExpression":
      gatherPossibleValues(node.consequent, isClass, set, isNested);
      gatherPossibleValues(node.alternate, isClass, set, isNested);
      return;
    case "LogicalExpression":
      if (node.operator === "&&") {
        // The left side counts only when it's falsy, which keeps
        // `class={[condition && 'blah']}` from giving up on `condition`.
        const left = new Set<unknown>();
        gatherPossibleValues(node.left, isClass, left, isNested);
        if (left.has(UNKNOWN)) {
          // clsx drops falsy values in a nested `class`
          if (!isClass || !isNested) {
            set.add("");
            set.add(false);
            set.add(Number.NaN);
            set.add(0);
          }
        } else {
          for (const value of left) {
            // biome-ignore lint/suspicious/noDoubleEquals: svelte's check, null and undefined both
            if (!value && value != undefined && (!isClass || !isNested))
              set.add(value);
          }
        }
        gatherPossibleValues(node.right, isClass, set, isNested);
      } else {
        gatherPossibleValues(node.left, isClass, set, isNested);
        gatherPossibleValues(node.right, isClass, set, isNested);
      }
      return;
    case "ArrayExpression":
      if (isClass) {
        for (const entry of node.elements) {
          if (entry)
            gatherPossibleValues(entry as Expression, isClass, set, true);
        }
        return;
      }
      break;
    case "ObjectExpression":
      if (isClass) {
        for (const property of node.properties) {
          if (
            property.type === "Property" &&
            !property.computed &&
            (property.key.type === "Identifier" ||
              property.key.type === "Literal")
          ) {
            set.add(
              property.key.type === "Identifier"
                ? property.key.name
                : String(property.key.value),
            );
          } else {
            set.add(UNKNOWN);
          }
        }
        return;
      }
      break;
  }
  set.add(UNKNOWN);
}
