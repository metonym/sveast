// The markup warnings svelte's compiler gives besides the a11y ones, from
// svelte 5's phases/2-analyze/visitors: block_empty, the attribute
// checks in shared/element.js and shared/attribute.js, the checks in
// RegularElement.js, BindDirective.js and the deprecations. svelte is MIT
// licensed.

import { invalidWithAncestor, invalidWithParent } from "./html-tree-validation";
import type { Binding, Scope, Scopes } from "./scope";
import { skipTypeWrappers } from "./skip-type-wrappers";
import { ignoreCodes } from "./svelte-ignore";
import type {
  Expression,
  Identifier,
  ImportDeclaration,
  ImportSpecifier,
  Pattern,
} from "./types/estree";
import type { AST } from "./types/svelte-ast";

type Node = AST.SvelteNode;
type Element = AST.ElementLike;
interface Span {
  start: number;
  end: number;
}
type Warn = (node: Span, code: string, message: string) => void;

export interface TemplateWarningsOptions {
  runes: boolean;
  source: string;
  filename: string | undefined;
  customElement: boolean;
  scopes: () => Scopes;
}

const NO_IGNORES: ReadonlySet<string> = new Set();

const link = (code: string) => `\nhttps://svelte.dev/e/${code}`;

// svelte's utils.js.
const VOID = new Set(
  "area base br col command embed hr img input keygen link meta param source track wbr".split(
    " ",
  ),
);
const SVG = new Set(
  "altGlyph altGlyphDef altGlyphItem animate animateColor animateMotion animateTransform circle clipPath color-profile cursor defs desc discard ellipse feBlend feColorMatrix feComponentTransfer feComposite feConvolveMatrix feDiffuseLighting feDisplacementMap feDistantLight feDropShadow feFlood feFuncA feFuncB feFuncG feFuncR feGaussianBlur feImage feMerge feMergeNode feMorphology feOffset fePointLight feSpecularLighting feSpotLight feTile feTurbulence filter font font-face font-face-format font-face-name font-face-src font-face-uri foreignObject g glyph glyphRef hatch hatchpath hkern image line linearGradient marker mask mesh meshgradient meshpatch meshrow metadata missing-glyph mpath path pattern polygon polyline radialGradient rect set solidcolor stop svg switch symbol text textPath tref tspan unknown use view vkern".split(
    " ",
  ),
);
const MATHML = new Set(
  "annotation annotation-xml maction math merror mfrac mi mmultiscripts mn mo mover mpadded mphantom mprescripts mroot mrow ms mspace msqrt mstyle msub msubsup msup mtable mtd mtext mtr munder munderover semantics".split(
    " ",
  ),
);
const REACT_ATTRIBUTES: ReadonlyMap<string, string> = new Map([
  ["className", "class"],
  ["htmlFor", "for"],
]);
// svelte's `element_nodes`: what `determine_slot` reads a `slot` from.
const ELEMENTS = new Set([
  "Component",
  "TitleElement",
  "SlotElement",
  "RegularElement",
  "SvelteBody",
  "SvelteBoundary",
  "SvelteComponent",
  "SvelteDocument",
  "SvelteElement",
  "SvelteFragment",
  "SvelteHead",
  "SvelteOptions",
  "SvelteSelf",
  "SvelteWindow",
]);
const NAMESPACE_PREFIX = /[a-zA-Z-]*:/g;
const NOT_IDENTIFIER = /[^a-zA-Z0-9_$]/g;
const LEADING_DIGIT = /^[0-9]/;
const PATH_SEPARATOR = /[/\\]/;

/**
 * The markup warnings svelte's compiler gives besides the `a11y_…` and
 * `css_unused_selector` ones, in svelte's order, without the ones a
 * `<!-- svelte-ignore -->` comment silences.
 */
export function templateWarnings(
  ast: AST.Root,
  options: TemplateWarningsOptions,
  warn: Warn,
): void {
  new TemplateWarnings(ast, options, warn).run();
}

class TemplateWarnings {
  private readonly ast: AST.Root;
  private readonly options: TemplateWarningsOptions;
  private readonly report: Warn;
  private readonly runes: boolean;
  // The names value imports declare, read from the scripts without scopes.
  private imports: Set<string> | undefined;
  // How many `{#each}` blocks with a `...rest` in their context are open.
  private restEaches = 0;
  // The nodes above the one being visited, as svelte's `context.path`.
  private readonly path: Node[] = [];
  // svelte's `parent_element`: the element the markup sits in, until a
  // component, snippet or `<svelte:element>` resets it.
  private parentElement: string | null = null;

  constructor(ast: AST.Root, options: TemplateWarningsOptions, warn: Warn) {
    this.ast = ast;
    this.options = options;
    this.report = warn;
    this.runes = options.runes;
  }

  run(): void {
    this.fragment(this.ast.fragment.nodes, NO_IGNORES);
  }

  private warn(
    ignores: ReadonlySet<string>,
    node: Span,
    code: string,
    message: string,
  ): void {
    if (!ignores.has(code)) this.report(node, code, message + link(code));
  }

  /** Visits a fragment's nodes, as svelte's analyzer with its `svelte-ignore` comments. */
  private fragment(nodes: readonly Node[], ignored: ReadonlySet<string>): void {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (node.type === "Comment" || node.type === "Text") continue;
      let ignores = ignored;
      const previous = i > 0 ? nodes[i - 1].type : "";
      if (previous === "Comment" || previous === "Text") {
        const codes = this.ignoredBefore(nodes, i);
        if (codes.length > 0) ignores = new Set([...ignored, ...codes]);
      }
      this.visit(node, ignores);
    }
  }

  /** The codes the comments right before `nodes[index]` ignore. */
  private ignoredBefore(nodes: readonly Node[], index: number): string[] {
    const codes: string[] = [];
    for (let i = index - 1; i >= 0; i--) {
      const previous = nodes[i];
      if (previous.type === "Comment")
        codes.push(...ignoreCodes(previous.data, this.runes));
      else if (previous.type !== "Text") break;
    }
    return codes;
  }

  private visit(node: Node, ignores: ReadonlySet<string>): void {
    this.path.push(node);
    this.visitNode(node, ignores);
    this.path.pop();
  }

  /** Visits `node`'s fragment with `parentElement` as svelte's `parent_element`. */
  private within(
    parentElement: string | null,
    nodes: readonly Node[],
    ignores: ReadonlySet<string>,
  ): void {
    const outer = this.parentElement;
    this.parentElement = parentElement;
    this.fragment(nodes, ignores);
    this.parentElement = outer;
  }

  private visitNode(node: Node, ignores: ReadonlySet<string>): void {
    switch (node.type) {
      case "RegularElement":
        this.placement(node, ignores);
        this.validateElement(node, ignores);
        this.componentNameLowercase(node, ignores);
        this.selfClosing(node, ignores);
        this.directives(node, ignores);
        this.within(node.name, node.fragment.nodes, ignores);
        return;
      case "SvelteElement":
        this.validateElement(node, ignores);
        this.directives(node, ignores);
        this.within(null, node.fragment.nodes, ignores);
        return;
      case "SvelteComponent":
        if (this.runes) {
          this.warn(
            ignores,
            node,
            "svelte_component_deprecated",
            "`<svelte:component>` is deprecated in runes mode — components are dynamic by default",
          );
        }
        this.component(node, ignores);
        return;
      case "SvelteSelf":
        if (this.runes && !ignores.has("svelte_self_deprecated")) {
          const [name, basename] = this.selfName();
          this.warn(
            ignores,
            node,
            "svelte_self_deprecated",
            `\`<svelte:self>\` is deprecated — use self-imports (e.g. \`import ${name} from './${basename}'\`) instead`,
          );
        }
        this.component(node, ignores);
        return;
      case "Component":
        this.component(node, ignores);
        return;
      case "SvelteWindow":
      case "SvelteDocument":
      case "SvelteBody":
        for (const attribute of node.attributes) {
          if (
            attribute.type === "Attribute" &&
            attribute.name.startsWith("on")
          ) {
            const expression = expressionOf(attribute);
            if (expression !== null) {
              this.globalEventReference(attribute, expression, ignores);
            }
          }
        }
        this.directives(node, ignores);
        return;
      case "SlotElement":
        if (this.runes && !this.options.customElement) {
          this.warn(
            ignores,
            node,
            "slot_element_deprecated",
            "Using `<slot>` to render parent content is deprecated. Use `{@render ...}` tags instead",
          );
        }
        this.directives(node, ignores);
        this.fragment(node.fragment.nodes, ignores);
        return;
      case "IfBlock":
        this.blockEmpty(node.consequent, ignores);
        this.blockEmpty(node.alternate, ignores);
        this.fragment(node.consequent.nodes, ignores);
        if (node.alternate) this.fragment(node.alternate.nodes, ignores);
        return;
      case "EachBlock": {
        this.blockEmpty(node.body, ignores);
        this.blockEmpty(node.fallback, ignores);
        const rest = node.context !== null && hasRest(node.context);
        if (rest) this.restEaches++;
        this.fragment(node.body.nodes, ignores);
        if (rest) this.restEaches--;
        if (node.fallback) this.fragment(node.fallback.nodes, ignores);
        return;
      }
      case "AwaitBlock":
        this.blockEmpty(node.pending, ignores);
        this.blockEmpty(node.then, ignores);
        this.blockEmpty(node.catch, ignores);
        if (node.pending) this.fragment(node.pending.nodes, ignores);
        if (node.then) this.fragment(node.then.nodes, ignores);
        if (node.catch) this.fragment(node.catch.nodes, ignores);
        return;
      case "KeyBlock":
        this.blockEmpty(node.fragment, ignores);
        this.fragment(node.fragment.nodes, ignores);
        return;
      case "SnippetBlock":
        this.blockEmpty(node.body, ignores);
        this.within(null, node.body.nodes, ignores);
        return;
      case "SvelteFragment":
        this.directives(node, ignores);
        this.within(null, node.fragment.nodes, ignores);
        return;
      case "TitleElement":
      case "SvelteBoundary":
      case "SvelteHead":
        this.directives(node, ignores);
        this.fragment(node.fragment.nodes, ignores);
        return;
    }
  }

  // --- elements ---

  /**
   * svelte's placement check: an element the browser would move out of
   * where it sits. svelte fails the build unless a block stands between,
   * and warns then, since the client builds each block on its own.
   */
  private placement(
    node: AST.RegularElement,
    ignores: ReadonlySet<string>,
  ): void {
    const parent = this.parentElement;
    if (parent === null || ignores.has("node_invalid_placement_ssr")) return;
    let pastParent = false;
    let inBlock = false;
    const ancestors = [parent];
    // `path` ends with `node` itself.
    for (let i = this.path.length - 2; i >= 0; i--) {
      const ancestor = this.path[i];
      switch (ancestor.type) {
        case "IfBlock":
        case "EachBlock":
        case "AwaitBlock":
        case "KeyBlock":
          inBlock = true;
          break;
        case "RegularElement": {
          let message: string | null;
          if (pastParent) {
            ancestors.push(ancestor.name);
            message = invalidWithAncestor(node.name, ancestors);
          } else {
            if (ancestor.name !== parent) break;
            message = invalidWithParent(node.name, parent);
            pastParent = true;
          }
          if (message !== null && inBlock) {
            this.warn(
              ignores,
              node,
              "node_invalid_placement_ssr",
              `${message}. When rendering this component on the server, the resulting HTML will be modified by the browser (by moving, removing, or inserting elements), likely resulting in a \`hydration_mismatch\` warning`,
            );
          }
          break;
        }
        case "Component":
        case "SvelteComponent":
        case "SvelteElement":
        case "SvelteSelf":
        case "SnippetBlock":
          if (pastParent) return;
          break;
      }
    }
  }

  /** svelte's `validate_element`, for the warnings it gives. */
  private validateElement(
    node: AST.RegularElement | AST.SvelteElement,
    ignores: ReadonlySet<string>,
  ): void {
    for (const attribute of node.attributes) {
      if (attribute.type !== "Attribute") continue;
      const { name } = attribute;
      if (this.runes) this.attributeQuoted(attribute, node, ignores);
      if (name.length > 2 && name.startsWith("on")) {
        const expression = expressionOf(attribute);
        if (expression !== null) {
          this.globalEventReference(attribute, expression, ignores);
        }
      }
      if (name === "is") {
        this.warn(
          ignores,
          attribute,
          "attribute_avoid_is",
          'The "is" attribute is not supported cross-browser and should be avoided',
        );
      }
      const correct = REACT_ATTRIBUTES.get(name);
      if (correct !== undefined) {
        this.warn(
          ignores,
          attribute,
          "attribute_invalid_property_name",
          `'${name}' is not a valid HTML attribute. Did you mean '${correct}'?`,
        );
      }
      this.attributeName(attribute, ignores);
    }
  }

  /** svelte's `validate_attribute`, for `attribute_quoted`. */
  private attributeQuoted(
    attribute: AST.Attribute,
    parent: Element,
    ignores: ReadonlySet<string>,
  ): void {
    const { value } = attribute;
    if (
      Array.isArray(value) &&
      value.length === 1 &&
      value[0].type === "ExpressionTag" &&
      (parent.type === "Component" ||
        parent.type === "SvelteComponent" ||
        parent.type === "SvelteSelf" ||
        (parent.type === "RegularElement" && isCustomElement(parent)))
    ) {
      this.warn(
        ignores,
        attribute,
        "attribute_quoted",
        "Quoted attributes on components and custom elements will be stringified in a future version of Svelte. If this isn't what you want, remove the quotes",
      );
    }
  }

  /** svelte's `validate_attribute_name`. */
  private attributeName(
    attribute: AST.Attribute,
    ignores: ReadonlySet<string>,
  ): void {
    const { name } = attribute;
    if (
      name.includes(":") &&
      !name.startsWith("xmlns:") &&
      !name.startsWith("xlink:") &&
      !name.startsWith("xml:")
    ) {
      this.warn(
        ignores,
        attribute,
        "attribute_illegal_colon",
        "Attributes should not contain ':' characters to prevent ambiguity with Svelte directives",
      );
    }
  }

  /** svelte's `check_global_event_reference`: `onclick={onclick}` with no `onclick` declared. */
  private globalEventReference(
    attribute: AST.Attribute,
    expression: Expression,
    ignores: ReadonlySet<string>,
  ): void {
    const value = skipTypeWrappers(expression);
    if (value.type !== "Identifier" || value.name !== attribute.name) return;
    if (ignores.has("attribute_global_event_reference")) return;
    if (this.resolve(value) !== null) return;
    this.warn(
      ignores,
      attribute,
      "attribute_global_event_reference",
      `You are referencing \`globalThis.${attribute.name}\`. Did you forget to declare a variable with that name?`,
    );
  }

  private componentNameLowercase(
    node: AST.RegularElement,
    ignores: ReadonlySet<string>,
  ): void {
    const { name } = node;
    if (!this.importNames().has(name)) return;
    if (ignores.has("component_name_lowercase")) return;
    // svelte looks the name up in the element's scope, which holds its
    // `let:` directives.
    const scopes = this.options.scopes();
    const own = scopes.declaredIn(node).get(name);
    const binding =
      own !== undefined && !isTypeOnly(own)
        ? own
        : valueBinding(scopes.scopeOf(node), name);
    if (
      binding !== null &&
      binding.kind === "import" &&
      !binding.references.some(
        (reference) => !reference.type && !reference.store,
      )
    ) {
      this.warn(
        ignores,
        node,
        "component_name_lowercase",
        `\`<${name}>\` will be treated as an HTML element unless it begins with a capital letter`,
      );
    }
  }

  /** The names the scripts' value imports declare. */
  private importNames(): Set<string> {
    if (this.imports !== undefined) return this.imports;
    const names = new Set<string>();
    for (const script of [this.ast.module, this.ast.instance]) {
      if (!script) continue;
      for (const statement of script.content.body) {
        if (
          statement.type !== "ImportDeclaration" ||
          statement.importKind === "type"
        ) {
          continue;
        }
        for (const specifier of statement.specifiers) {
          if (
            specifier.type !== "ImportSpecifier" ||
            specifier.importKind !== "type"
          ) {
            names.add(specifier.local.name);
          }
        }
      }
    }
    this.imports = names;
    return names;
  }

  private selfClosing(
    node: AST.RegularElement,
    ignores: ReadonlySet<string>,
  ): void {
    if (this.options.source.charCodeAt(node.end - 2) !== 47 /* / */) return;
    const name = node.name.replace(NAMESPACE_PREFIX, "");
    if (VOID.has(name) || SVG.has(name) || MATHML.has(name)) return;
    if (name.toLowerCase() === "!doctype") return;
    this.warn(
      ignores,
      node,
      "element_invalid_self_closing_tag",
      `Self-closing HTML tags for non-void elements are ambiguous — use \`<${node.name} ...></${node.name}>\` rather than \`<${node.name} ... />\``,
    );
  }

  /** The `bind:` and `on:` directives on an element, in order. */
  private directives(node: Element, ignores: ReadonlySet<string>): void {
    for (const attribute of node.attributes) {
      if (attribute.type === "BindDirective") {
        this.bindEachRest(attribute, ignores);
      } else if (
        attribute.type === "OnDirective" &&
        this.runes &&
        (node.type === "RegularElement" || node.type === "SvelteElement")
      ) {
        this.warn(
          ignores,
          attribute,
          "event_directive_deprecated",
          `Using \`on:${attribute.name}\` to listen to the ${attribute.name} event is deprecated. Use the event attribute \`on${attribute.name}\` instead`,
        );
      }
    }
  }

  /** `bind:value={rest.x}` where `rest` comes from `...rest` in an `{#each}`'s context. */
  private bindEachRest(
    node: AST.BindDirective,
    ignores: ReadonlySet<string>,
  ): void {
    if (this.restEaches === 0 || ignores.has("bind_invalid_each_rest")) return;
    let left = skipTypeWrappers(node.expression);
    if (left.type === "SequenceExpression") return;
    while (left.type === "MemberExpression") {
      left = skipTypeWrappers(left.object as Expression);
    }
    if (left.type !== "Identifier") return;
    const binding = this.resolve(left);
    if (
      binding === null ||
      binding.kind !== "each" ||
      binding.node === null ||
      binding.declaration.type !== "EachBlock"
    ) {
      return;
    }
    const { context } = binding.declaration;
    if (context === null || !insideRest(context, binding.node)) return;
    this.warn(
      ignores,
      binding.node,
      "bind_invalid_each_rest",
      `The rest operator (...) will create a new object and binding '${binding.node.name}' with the original object will not work`,
    );
  }

  // --- components ---

  /** svelte's `visit_component`, for the warnings it gives. */
  private component(
    node: AST.Component | AST.SvelteComponent | AST.SvelteSelf,
    ignores: ReadonlySet<string>,
  ): void {
    for (const attribute of node.attributes) {
      if (attribute.type !== "Attribute") continue;
      if (this.runes) this.attributeQuoted(attribute, node, ignores);
      this.attributeName(attribute, ignores);
    }
    this.directives(node, ignores);
    const children = node.fragment.nodes;
    // With no comment and no named slot, svelte's grouping keeps the
    // children as they are.
    if (
      !children.some(
        (child) => child.type === "Comment" || slotOf(child) !== null,
      )
    ) {
      this.within(null, children, ignores);
      return;
    }
    // svelte groups the children by slot, each with the comments before
    // it, and walks each group as a fragment: the default slot's comments
    // carry on past its children.
    let comments: Node[] = [];
    const slots = new Map<string, Node[]>([["default", []]]);
    for (const child of children) {
      if (child.type === "Comment") {
        comments.push(child);
        continue;
      }
      const slot = slotOf(child) ?? "default";
      const nodes = slots.get(slot);
      if (nodes === undefined) slots.set(slot, [...comments, child]);
      else nodes.push(...comments, child);
      if (slot !== "default") comments = [];
    }
    for (const nodes of slots.values()) this.within(null, nodes, ignores);
  }

  // --- blocks ---

  private blockEmpty(
    fragment: AST.Fragment | null | undefined,
    ignores: ReadonlySet<string>,
  ): void {
    if (fragment?.nodes.length !== 1) return;
    const [text] = fragment.nodes;
    if (text.type === "Text" && text.raw.trim() === "") {
      this.warn(ignores, text, "block_empty", "Empty block");
    }
  }

  // --- names ---

  /** The binding svelte resolves `identifier` to, without type-only imports. */
  private resolve(identifier: Identifier): Binding | null {
    const scopes = this.options.scopes();
    const reference = scopes.referenceOf(identifier);
    const binding = reference?.binding ?? scopes.bindingOf(identifier);
    if (binding === null) return null;
    if (reference?.store) return null;
    if (!isTypeOnly(binding)) return binding;
    return valueBinding(binding.scope.parent, identifier.name);
  }

  /** The name and file name svelte's `svelte_self_deprecated` suggests. */
  private selfName(): [string, string] {
    const { filename } = this.options;
    if (filename === undefined || filename === "(unknown)") {
      return ["Self", "Self.svelte"];
    }
    const parts = filename.split(PATH_SEPARATOR);
    const basename = parts.pop() as string;
    const folder = parts.at(-1);
    let name = basename.replace(".svelte", "");
    if (name === "index" && folder && folder !== "src") name = folder;
    name = name[0].toUpperCase() + name.slice(1);
    return [this.generate(name), basename];
  }

  /** svelte's `Scope#generate` for the component's name, before anything else is generated. */
  private generate(preferred: string): string {
    const base = preferred
      .replace(NOT_IDENTIFIER, "_")
      .replace(LEADING_DIGIT, "_");
    const taken = (
      this.options.scopes() as Scopes & { names(): Set<string> }
    ).names();
    // Each `{#each}` takes a `$$index` name as svelte reads the markup.
    const eaches = countEaches(this.ast.fragment);
    for (let i = 0; i < eaches; i++) {
      taken.add(i === 0 ? "$$index" : `$$index_${i}`);
    }
    let n = base === "$$index" ? eaches : 0;
    let name: string;
    if (n === 0) {
      name = base;
      n = 1;
    } else {
      name = `${base}_${n}`;
      n++;
    }
    // It starts with a capital, `_` or `$`, so it is never a reserved word.
    while (taken.has(name)) name = `${base}_${n++}`;
    return name;
  }
}

/** The expression of `{x}` or `"{x}"`; `null` for any other value. */
function expressionOf(attribute: AST.Attribute): Expression | null {
  const { value } = attribute;
  if (value === true) return null;
  if (!Array.isArray(value)) return value.expression;
  if (value.length === 1 && value[0].type === "ExpressionTag") {
    return value[0].expression;
  }
  return null;
}

/** svelte's `is_custom_element_node`. */
function isCustomElement(node: AST.RegularElement): boolean {
  return (
    node.name.includes("-") ||
    node.attributes.some(
      (attribute) => attribute.type === "Attribute" && attribute.name === "is",
    )
  );
}

/** svelte's `determine_slot`: the static `slot` attribute of an element. */
export function slotOf(node: Node): string | null {
  if (!ELEMENTS.has(node.type)) return null;
  for (const attribute of (node as Element).attributes) {
    if (attribute.type !== "Attribute" || attribute.name !== "slot") continue;
    const { value } = attribute;
    if (Array.isArray(value) && value.length === 1 && value[0].type === "Text")
      return value[0].data;
  }
  return null;
}

/** Whether a binding is a type-only import, which svelte drops. */
function isTypeOnly(binding: Binding): boolean {
  return (
    binding.kind === "import" &&
    ((binding.initial as ImportDeclaration | null)?.importKind === "type" ||
      (binding.declaration as ImportSpecifier).importKind === "type")
  );
}

/** `scope.get(name)`, past type-only imports. */
function valueBinding(scope: Scope | null, name: string): Binding | null {
  for (let at = scope; at !== null; at = at.parent) {
    const binding = at.declarations.get(name);
    if (binding !== undefined && !isTypeOnly(binding)) return binding;
  }
  return null;
}

function hasRest(pattern: Pattern): boolean {
  switch (pattern.type) {
    case "RestElement":
      return true;
    case "ObjectPattern":
      return pattern.properties.some((property) =>
        property.type === "RestElement" ? true : hasRest(property.value),
      );
    case "ArrayPattern":
      return pattern.elements.some(
        (element) => element !== null && hasRest(element),
      );
    case "AssignmentPattern":
      return hasRest(pattern.left);
    default:
      return false;
  }
}

/** Whether `id` is declared under a `...rest` in `pattern`. */
function insideRest(pattern: Pattern, id: Identifier): boolean {
  switch (pattern.type) {
    case "RestElement":
      return id.start >= pattern.start && id.end <= pattern.end;
    case "ObjectPattern":
      return pattern.properties.some((property) =>
        insideRest(
          property.type === "RestElement" ? property : property.value,
          id,
        ),
      );
    case "ArrayPattern":
      return pattern.elements.some(
        (element) => element !== null && insideRest(element, id),
      );
    case "AssignmentPattern":
      return insideRest(pattern.left, id);
    default:
      return false;
  }
}

function countEaches(fragment: AST.Fragment): number {
  let count = 0;
  const visit = (nodes: readonly Node[]): void => {
    for (const node of nodes) {
      switch (node.type) {
        case "EachBlock":
          count++;
          visit(node.body.nodes);
          if (node.fallback) visit(node.fallback.nodes);
          break;
        case "IfBlock":
          visit(node.consequent.nodes);
          if (node.alternate) visit(node.alternate.nodes);
          break;
        case "AwaitBlock":
          if (node.pending) visit(node.pending.nodes);
          if (node.then) visit(node.then.nodes);
          if (node.catch) visit(node.catch.nodes);
          break;
        case "KeyBlock":
          visit(node.fragment.nodes);
          break;
        case "SnippetBlock":
          visit(node.body.nodes);
          break;
        default:
          if ("fragment" in node && node.fragment) {
            visit((node.fragment as AST.Fragment).nodes);
          }
      }
    }
  };
  visit(fragment.nodes);
  return count;
}
