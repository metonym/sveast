// The warnings svelte's analyzer gives as it walks every node of the
// scripts and the markup: bidirectional_control_characters (Literal.js,
// TemplateElement.js, Text.js), perf_avoid_inline_class
// (NewExpression.js), perf_avoid_nested_class (ClassDeclaration.js),
// and legacy_code and unknown_code, which its utils/extract_svelte_ignore.js
// gives in runes mode for each `svelte-ignore` comment it reads, as often
// as it reads it. svelte is MIT licensed.

import { fuzzymatch } from "./a11y-fuzzymatch";
import { extractIdentifiers } from "./extract-identifiers";
import { isTypeScript } from "./markup";
import { fieldsOf, isNode } from "./nodes";
import type { Scopes } from "./scope";
import {
  mayHaveScopeWarnings,
  needsMarkupWalk,
  needsScriptWalk,
  nonReactiveUpdates,
  type RuneKind,
  ScopeFacts,
  storeRuneConflicts,
  unusedExports,
} from "./scope-warnings";
import { ignoreCodes, isSvelteCode, renamedCode } from "./svelte-ignore";
import { slotOf } from "./template-warnings";
import type {
  ExpressionStatement,
  Identifier,
  VariableDeclarator,
} from "./types/estree";
import type { AST } from "./types/svelte-ast";
import { type VisitorKeys, valueVisitorKeys } from "./walk";
import { SVELTE_CODES } from "./warning-codes";

type Node = AST.SvelteNode;
interface Span {
  start: number;
  end: number;
}
type Warn = (node: Span, code: string, message: string) => void;
type Section = "module" | "instance" | "template";

const NO_IGNORES: ReadonlySet<string> = new Set();
const link = (code: string) => `\nhttps://svelte.dev/e/${code}`;

// svelte's `regex_bidirectional_control_characters`. Its `g` flag keeps
// `lastIndex` from one `test` to the next, so after a match svelte can
// miss the next string's; this shares the regex the same way.
const BIDI = /[\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069]+/g;
// A superset of the bidirectional control characters, which one range
// finds faster than two. Their JavaScript escapes and HTML character
// references follow.
const MAY_HAVE_BIDI = /[\u202a-\u2069]/;
const BIDI_ESCAPE = /\\u\{?0*20(?:2[a-e]|6[6-9])/i;
const BIDI_REFERENCE = /&#(?:x0*20(?:2[a-e]|6[6-9])|0*(?:823[4-8]|829[4-7]))/i;
const STARTS_WITH_NEWLINE = /^\r?\n/;
// After `class` at a word start: a class declaration or expression, and
// some text that isn't one, such as `class name` in prose. `class=`,
// `class:` and `{class}` don't match.
const CLASS_REST = /class(?:\s+[\w$]|\s*[{<]|\s*\/[*/])/y;
const BIDI_MESSAGE =
  "A bidirectional control character was detected in your code. These characters can be used to alter the visual direction of your code and could have unintended consequences";

// What svelte's remove_typescript_nodes.js drops, comments and all.
const TYPE_ONLY = new Set([
  "TSInterfaceDeclaration",
  "TSTypeAliasDeclaration",
  "TSDeclareFunction",
  "TSDeclareMethod",
  "TSModuleDeclaration",
  "TSEnumDeclaration",
  "TSAbstractMethodDefinition",
  "TSAbstractPropertyDefinition",
  "TSAbstractAccessorProperty",
]);
// What it replaces with its expression or parameter.
const TYPE_WRAPPERS: Readonly<Record<string, string>> = {
  TSAsExpression: "expression",
  TSSatisfiesExpression: "expression",
  TSNonNullExpression: "expression",
  TSTypeAssertion: "expression",
  TSInstantiationExpression: "expression",
  TSParameterProperty: "parameter",
};
// The kind each rune gives the bindings it declares, at first.
const RUNE_KINDS: Readonly<Record<string, RuneKind>> = {
  $state: "state",
  "$state.raw": "raw_state",
  $derived: "derived",
  "$derived.by": "derived",
  $props: "prop",
};
// The blocks whose fragments are scopes of their own.
const BLOCKS = new Set([
  "IfBlock",
  "EachBlock",
  "AwaitBlock",
  "KeyBlock",
  "SnippetBlock",
]);
const FUNCTIONS = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
]);

/** Whether svelte drops `node`, with its comments, before its analysis. */
function typeOnly(node: Node): boolean {
  if (TYPE_ONLY.has(node.type)) return true;
  const fields = fieldsOf(node);
  if (fields.declare === true) return true;
  switch (node.type) {
    case "MethodDefinition":
      return fields.abstract === true;
    case "ImportDeclaration":
      return (
        node.importKind === "type" ||
        (node.specifiers.length > 0 &&
          node.specifiers.every(
            (specifier) => fieldsOf(specifier).importKind === "type",
          ))
      );
    case "ExportNamedDeclaration":
      if (node.exportKind === "type") return true;
      if (node.declaration) return typeOnly(node.declaration);
      // `export {}` too.
      return node.specifiers.every(
        (specifier) => fieldsOf(specifier).exportKind === "type",
      );
    case "ExportDefaultDeclaration":
    case "ExportAllDeclaration":
    case "ExportSpecifier":
      return fields.exportKind === "type";
  }
  return false;
}

const keysByType = new Map<string, ReadonlySet<string>>();

/** The fields of a `type` node that hold values, not types. */
function fieldKeys(type: string): ReadonlySet<string> {
  let keys = keysByType.get(type);
  if (keys === undefined) {
    const list = (valueVisitorKeys as VisitorKeys)[type];
    if (list === undefined) throw new Error(`unknown node type: ${type}`);
    keys = new Set(list);
    keysByType.set(type, keys);
  }
  return keys;
}

function mayHaveBidi(source: string): boolean {
  return (
    MAY_HAVE_BIDI.test(source) ||
    (source.includes("\\u") && BIDI_ESCAPE.test(source)) ||
    (source.includes("&#") && BIDI_REFERENCE.test(source))
  );
}

/** A `class` keyword, found faster than a regular expression would. */
function mayHaveClass(source: string): boolean {
  let index = source.indexOf("class");
  while (index !== -1) {
    const before = index === 0 ? 32 : source.charCodeAt(index - 1);
    if (!isWordCode(before)) {
      CLASS_REST.lastIndex = index;
      if (CLASS_REST.test(source)) return true;
    }
    index = source.indexOf("class", index + 5);
  }
  return false;
}

/** `\w` and `$`, as character codes. */
function isWordCode(code: number): boolean {
  const lower = code | 32;
  return (
    (lower >= 97 && lower <= 122) ||
    (code >= 48 && code <= 57) ||
    code === 95 ||
    code === 36
  );
}

interface JsComment {
  value: string;
  start?: number;
}

export interface JsWarningsOptions {
  runes: boolean;
  /** Whether the component compiles as a custom element. */
  customElement: boolean;
  scopes: () => Scopes;
}

export function jsWarnings(
  ast: AST.Root,
  source: string,
  options: JsWarningsOptions,
  warn: Warn,
): void {
  const { runes } = options;
  const customElementProps =
    options.customElement && ast.options?.customElement?.props == null;
  const facts = mayHaveScopeWarnings(ast, source, runes, customElementProps)
    ? new ScopeFacts(options.scopes())
    : null;
  // Each other warning needs a bidirectional control character, a class
  // or, in runes mode, a `svelte-ignore` comment; most components have
  // none.
  const others =
    (runes && source.includes("svelte-ignore")) ||
    mayHaveBidi(source) ||
    mayHaveClass(source);
  if (facts === null && !others) return;
  // svelte gives store_rune_conflict before its walk.
  if (facts !== null) storeRuneConflicts(facts, warn);
  const scriptFacts =
    facts !== null &&
    needsScriptWalk(ast, source, runes, facts, customElementProps);
  const markupFacts = facts !== null && needsMarkupWalk(source, runes);
  if (others || scriptFacts || markupFacts) {
    const walker = new Walker(runes, isTypeScript(source), warn, facts);
    walker.customElementProps = customElementProps;
    walker.run(ast, others, scriptFacts, markupFacts);
  }
  if (facts === null) return;
  if (runes) {
    facts.exportedNames(ast);
    nonReactiveUpdates(ast, facts, warn);
  } else {
    unusedExports(ast, facts, warn);
  }
}

class Walker {
  private section: Section = "module";
  // svelte's `scope.function_depth`.
  private depth = 0;

  private readonly runes: boolean;
  // svelte strips TypeScript only from a `lang="ts"` component.
  private readonly typescript: boolean;
  private readonly report: Warn;
  // What the scope warnings need, when the component may have one.
  private facts: ScopeFacts | null;
  /** Whether a `$props()` declaration warns: a custom element without `customElement.props`. */
  customElementProps = false;
  // svelte's `state.function_depth`.
  private functionDepth = 0;
  // The nodes from the walk's root to the one it visits, with
  // TypeScript's wrappers left out.
  private readonly path: Node[] = [];
  // Whether the walk is in the first pass of a top-level `$:`.
  private reactive = false;

  constructor(
    runes: boolean,
    typescript: boolean,
    report: Warn,
    facts: ScopeFacts | null,
  ) {
    this.runes = runes;
    this.typescript = typescript;
    this.report = report;
    this.facts = facts;
  }

  /**
   * `others`: whether a warning that isn't a scope warning may come.
   * `scriptFacts` and `markupFacts`: whether a scope warning may come
   * from the walk of the scripts or of the markup.
   */
  run(
    ast: AST.Root,
    others: boolean,
    scriptFacts: boolean,
    markupFacts: boolean,
  ): void {
    BIDI.lastIndex = 0;
    const facts = this.facts;
    // svelte walks the module, the instance and the markup, with the
    // scopes' depths: the module's is 0, each one inside is 1 more.
    this.facts = scriptFacts ? facts : null;
    if (others || scriptFacts) {
      if (ast.module) this.walk("module", 0, ast.module.content);
      if (ast.instance) this.walk("instance", 1, ast.instance.content);
    }
    this.facts = markupFacts ? facts : null;
    if (others || markupFacts) this.walk("template", 2, ast.fragment);
    // svelte reads the comment before `<style>` after its walk, from the
    // comment's start rather than its text's.
    const comment = ast.css?.content.comment;
    if (comment) this.codes(comment.data, comment.start, NO_IGNORES);
  }

  private walk(section: Section, depth: number, node: Node): void {
    this.section = section;
    this.depth = depth;
    this.functionDepth = depth;
    this.visit(node, null, null, -1, NO_IGNORES);
  }

  private warn(
    ignores: ReadonlySet<string>,
    node: Span,
    code: string,
    message: string,
  ): void {
    if (!ignores.has(code)) this.report(node, code, message + link(code));
  }

  /**
   * The codes a comment ignores. In runes mode it warns of each code
   * that doesn't count, unless `ignores`, the codes around the comment,
   * hold `legacy_code` or `unknown_code`.
   */
  private codes(
    text: string,
    offset: number | undefined,
    ignores: ReadonlySet<string>,
  ): string[] {
    return ignoreCodes(
      text,
      this.runes,
      // svelte has no offset for the comment before a `<script>`, and its
      // warning about one would throw.
      offset === undefined
        ? undefined
        : (code, at) => {
            const start = offset + at;
            const span = { start, end: start + code.length };
            const replacement = renamedCode(code);
            if (isSvelteCode(replacement)) {
              this.warn(
                ignores,
                span,
                "legacy_code",
                `\`${code}\` is no longer valid — please use \`${replacement}\` instead`,
              );
            } else {
              const suggestion = fuzzymatch(code, SVELTE_CODES);
              this.warn(
                ignores,
                span,
                "unknown_code",
                suggestion
                  ? `\`${code}\` is not a recognised code (did you mean \`${suggestion}\`?)`
                  : `\`${code}\` is not a recognised code`,
              );
            }
          },
    );
  }

  /**
   * svelte's analyzer's `_` visitor, then its visitor for `node`.
   * `siblings` is the fragment `node` is in, as svelte groups a
   * component's children, and `index` its place there.
   */
  private visit(
    node: Node,
    parent: Node | null,
    siblings: readonly Node[] | null,
    index: number,
    ignored: ReadonlySet<string>,
  ): void {
    const fields = fieldsOf(node);
    if (this.typescript && typeOnly(node)) return;
    const wrapped = TYPE_WRAPPERS[node.type];
    if (wrapped !== undefined && this.typescript) {
      this.visit(fields[wrapped] as Node, parent, siblings, index, ignored);
      return;
    }

    const codes: string[] = [];
    if (siblings !== null && node.type !== "Comment" && node.type !== "Text") {
      for (let i = index - 1; i >= 0; i--) {
        const previous = siblings[i];
        if (previous.type === "Comment") {
          codes.push(...this.codes(previous.data, previous.start + 4, ignored));
        } else if (previous.type !== "Text") {
          break;
        }
      }
    } else {
      const comments = fields.leadingComments as JsComment[] | undefined;
      if (comments) {
        for (const comment of comments) {
          const offset =
            comment.start === undefined ? undefined : comment.start + 2;
          codes.push(...this.codes(comment.value, offset, ignored));
        }
      }
    }
    const ignores =
      codes.length > 0 ? new Set([...ignored, ...codes]) : ignored;
    this.path.push(node);
    this.visitNode(node, parent, siblings, ignores);
    this.path.pop();
  }

  /** `node` without TypeScript's wrappers, as svelte sees it. */
  private unwrap(node: Node): Node {
    if (!this.typescript) return node;
    let inner = node;
    let wrapped = TYPE_WRAPPERS[inner.type];
    while (wrapped !== undefined) {
      inner = fieldsOf(inner)[wrapped] as Node;
      wrapped = TYPE_WRAPPERS[inner.type];
    }
    return inner;
  }

  /** Visits `node`'s children with `functionDepth` one more. */
  private deeper(node: Node, ignores: ReadonlySet<string>): void {
    this.functionDepth++;
    this.children(node, ignores);
    this.functionDepth--;
  }

  /** Visits `node`'s children in a scope of its own. */
  private scoped(node: Node, ignores: ReadonlySet<string>): void {
    this.depth++;
    this.children(node, ignores);
    this.depth--;
  }

  private visitNode(
    node: Node,
    parent: Node | null,
    siblings: readonly Node[] | null,
    ignores: ReadonlySet<string>,
  ): void {
    switch (node.type) {
      case "Literal":
        if (typeof node.value === "string" && BIDI.test(node.value)) {
          this.warn(
            ignores,
            node,
            "bidirectional_control_characters",
            BIDI_MESSAGE,
          );
        }
        return;
      case "TemplateElement":
        if (BIDI.test(node.value.cooked ?? "")) {
          this.warn(
            ignores,
            node,
            "bidirectional_control_characters",
            BIDI_MESSAGE,
          );
        }
        return;
      case "Text":
        this.text(node, siblings, ignores);
        return;
      case "Identifier":
        if (this.facts !== null) this.identifier(node, parent, ignores);
        return;
      case "ExportSpecifier":
        // In runes mode, `export { x }` in the instance makes `x` reassigned.
        if (
          this.facts !== null &&
          this.runes &&
          this.section === "instance" &&
          node.local.type === "Identifier"
        ) {
          const binding = this.facts.scopes.instance.get(node.local.name);
          if (binding !== null) this.facts.exported.add(binding);
        }
        return;
      case "ImportDeclaration":
      case "LetDirective":
        return;
      case "VariableDeclarator":
        if (this.facts !== null && this.runes) {
          this.declarator(node, ignores);
          return;
        }
        break;
      case "CallExpression":
        if (this.facts !== null && this.runes) {
          const rune = this.facts.rune(node);
          // svelte reads `$derived(x)` and `$inspect(x)` as in a function.
          if (rune === "$derived" || rune === "$inspect") {
            this.deeper(node, ignores);
            return;
          }
        }
        break;
      case "ExpressionStatement":
        if (this.facts !== null) this.componentCreation(node, ignores);
        break;
      case "FunctionDeclaration":
      case "FunctionExpression":
      case "ArrowFunctionExpression": {
        const outer = this.functionDepth;
        this.functionDepth = Math.max(this.depth, outer) + 1;
        this.children(node, ignores);
        this.functionDepth = outer;
        return;
      }
      case "ClassDeclaration":
        if (this.depth > (this.section === "module" ? 0 : 1)) {
          this.warn(
            ignores,
            node,
            "perf_avoid_nested_class",
            "Avoid declaring classes below the top level scope",
          );
        }
        break;
      case "NewExpression":
        if (node.callee.type === "ClassExpression" && this.depth > 0) {
          this.warn(
            ignores,
            node,
            "perf_avoid_inline_class",
            "Avoid 'new class' — instead, declare the class at the top level scope",
          );
        }
        break;
      case "BlockStatement":
        // A function's body is a scope of its own; other blocks share it.
        if (parent !== null && FUNCTIONS.has(parent.type)) {
          this.depth++;
          this.children(node, ignores);
          this.depth--;
          return;
        }
        break;
      case "LabeledStatement":
        if (node.label.name !== "$") break;
        // svelte walks a `$:` statement twice, in a scope of its own, and
        // finds its dependencies in the first walk.
        if (this.section === "instance" && parent?.type === "Program") {
          this.depth++;
          const outer = this.functionDepth;
          this.functionDepth = this.depth;
          this.reactive = true;
          this.children(node, ignores);
          this.reactive = false;
          this.functionDepth = outer;
          this.children(node, ignores);
          this.depth--;
          return;
        }
        if (this.facts !== null && !this.runes) {
          this.warn(
            ignores,
            node,
            "reactive_declaration_invalid_placement",
            "Reactive declarations only exist at the top level of the instance script",
          );
        }
        break;
      case "Fragment":
        // A block's fragment and the markup are scopes of their own; an
        // element's isn't.
        if (parent === null || BLOCKS.has(parent.type)) {
          this.depth++;
          this.fragment(node.nodes, ignores);
          this.depth--;
          return;
        }
        this.fragment(node.nodes, ignores);
        return;
      case "RegularElement":
        if (node.name === "textarea") {
          this.depth++;
          this.textarea(node, ignores);
          this.depth--;
          return;
        }
        this.scoped(node, ignores);
        return;
      case "SlotElement":
      case "SvelteFragment":
        this.scoped(node, ignores);
        return;
      case "IfBlock":
        this.child(node.test, node, ignores);
        this.child(node.consequent, node, ignores);
        this.child(node.alternate, node, ignores);
        return;
      case "EachBlock":
        this.child(node.expression, node, ignores);
        this.depth++;
        this.fragment(node.body.nodes, ignores);
        this.child(node.key, node, ignores);
        this.depth--;
        this.child(node.fallback, node, ignores);
        return;
      case "AwaitBlock":
        this.child(node.expression, node, ignores);
        this.child(node.pending, node, ignores);
        this.child(node.then, node, ignores);
        this.child(node.catch, node, ignores);
        return;
      case "KeyBlock":
        this.child(node.expression, node, ignores);
        this.child(node.fragment, node, ignores);
        return;
      case "SnippetBlock":
        this.scoped(node, ignores);
        return;
      case "ConstTag": {
        const [declarator] = node.declaration.declarations;
        this.child(declarator.id, node, ignores);
        this.functionDepth++;
        this.child(declarator.init, node, ignores);
        this.functionDepth--;
        return;
      }
      case "DeclarationTag": {
        const outer = this.functionDepth;
        this.functionDepth = this.depth;
        this.child(node.declaration, node, ignores);
        this.functionDepth = outer;
        return;
      }
      case "RenderTag": {
        const call =
          node.expression.type === "ChainExpression"
            ? node.expression.expression
            : node.expression;
        this.child(call.callee, node, ignores);
        for (const argument of call.arguments) {
          this.child(argument, node, ignores);
        }
        return;
      }
      case "SvelteElement":
        this.child(node.tag, node, ignores);
        this.depth++;
        for (const attribute of node.attributes) {
          this.child(attribute, node, ignores);
        }
        this.child(node.fragment, node, ignores);
        this.depth--;
        return;
      case "SvelteComponent":
        this.child(node.expression, node, ignores);
        this.component(node, ignores);
        return;
      case "Component":
      case "SvelteSelf":
        this.component(node, ignores);
        return;
    }
    this.children(node, ignores);
  }

  private child(
    node: Node | null | undefined,
    parent: Node,
    ignores: ReadonlySet<string>,
  ): void {
    if (node) this.visit(node, parent, null, -1, ignores);
  }

  /**
   * Visits `node`'s children as zimmerframe does, in the order of the
   * node's own fields: acorn puts a template literal's `expressions`
   * before its `quasis`, and the shared regex sees that order.
   */
  private children(node: Node, ignores: ReadonlySet<string>): void {
    const fields = fieldsOf(node);
    const keys = fieldKeys(node.type);
    for (const key in fields) {
      if (!keys.has(key)) continue;
      const value = fields[key];
      if (Array.isArray(value)) {
        for (const child of value) {
          if (isNode(child)) this.visit(child, node, null, -1, ignores);
        }
      } else if (isNode(value)) {
        this.visit(value, node, null, -1, ignores);
      }
    }
  }

  private fragment(nodes: readonly Node[], ignores: ReadonlySet<string>): void {
    for (let i = 0; i < nodes.length; i++) {
      this.visit(nodes[i], null, nodes, i, ignores);
    }
  }

  /** svelte's `visit_component`: its attributes, then each slot's children. */
  private component(
    node: AST.Component | AST.SvelteComponent | AST.SvelteSelf,
    ignores: ReadonlySet<string>,
  ): void {
    for (const attribute of node.attributes) {
      this.child(attribute, node, ignores);
    }
    // svelte groups the children by slot, each with the comments before
    // it: the default slot's comments carry on past its children.
    let comments: Node[] = [];
    const slots = new Map<string, Node[]>();
    for (const child of node.fragment.nodes) {
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
    // Each slot is a scope of its own, but the default one of a
    // component that's itself in a slot.
    const inSlot = slotOf(node) !== null;
    for (const [slot, nodes] of slots) {
      const scoped = slot !== "default" || !inSlot;
      if (scoped) this.depth++;
      this.fragment(nodes, ignores);
      if (scoped) this.depth--;
    }
  }

  /**
   * svelte's `Identifier` visitor: state_referenced_locally in runes
   * mode, reactive_declaration_module_script_dependency in legacy mode.
   */
  private identifier(
    node: Identifier,
    parent: Node | null,
    ignores: ReadonlySet<string>,
  ): void {
    const facts = this.facts as ScopeFacts;
    facts.ignores.set(node, ignores);
    // Its reference, if it's one: the scopes see past TypeScript's wrappers.
    const binding = facts.referenced(node);
    if (binding === null || binding.node === node) return;
    if (this.runes) {
      const kind = facts.kinds.get(binding);
      if (
        kind === undefined ||
        kind === "bindable_prop" ||
        (kind === "state" && !facts.stateIsStatic(binding)) ||
        facts.depths.get(binding) !== this.functionDepth ||
        (parent?.type === "AssignmentExpression" &&
          this.unwrap(parent.left) === node) ||
        parent?.type === "UpdateExpression"
      ) {
        return;
      }
      this.warn(
        ignores,
        node,
        "state_referenced_locally",
        `This reference only captures the initial value of \`${node.name}\`. Did you mean to reference it inside a ${this.capture()} instead?`,
      );
    } else if (
      this.reactive &&
      binding.scope === facts.scopes.module &&
      facts.reassigned(binding)
    ) {
      this.warn(
        ignores,
        node,
        "reactive_declaration_module_script_dependency",
        "Reassignments of module-level declarations will not cause reactive statements to update",
      );
    }
  }

  /**
   * What would keep the reference up to date: `$derived` around
   * `$state(f(x))`. svelte doesn't look at the identifier itself, so
   * `$state(x)` gives `closure`.
   */
  private capture(): string {
    const facts = this.facts as ScopeFacts;
    for (let i = this.path.length - 2; i >= 0; i--) {
      const node = this.path[i];
      if (FUNCTIONS.has(node.type)) break;
      if (node.type === "CallExpression" && i < this.path.length - 2) {
        const child = this.path[i + 1];
        if (!node.arguments.some((arg) => this.unwrap(arg) === child)) continue;
        const rune = facts.rune(node);
        if (rune === "$state" || rune === "$state.raw") return "derived";
      }
    }
    return "closure";
  }

  /** svelte's `VariableDeclarator` visitor in runes mode. */
  private declarator(
    node: VariableDeclarator,
    ignores: ReadonlySet<string>,
  ): void {
    const facts = this.facts as ScopeFacts;
    const rune = facts.rune(node.init);
    if (
      rune === "$state" ||
      rune === "$state.raw" ||
      rune === "$derived" ||
      rune === "$derived.by" ||
      rune === "$props"
    ) {
      const kind = RUNE_KINDS[rune];
      for (const id of extractIdentifiers(node.id)) {
        const binding = facts.scopes.bindingOf(id);
        if (binding === null) continue;
        facts.kinds.set(binding, kind);
        facts.depths.set(binding, this.depth);
      }
    }
    if (rune === "$props") {
      this.props(node.id, ignores);
      // svelte reads a prop's fallback as in a function.
      this.functionDepth++;
      this.child(node.id, node, ignores);
      this.functionDepth--;
      this.child(node.init, node, ignores);
      return;
    }
    this.children(node, ignores);
  }

  /** The kinds and first values of `$props()`'s bindings, and custom_element_props_identifier. */
  private props(
    id: VariableDeclarator["id"],
    ignores: ReadonlySet<string>,
  ): void {
    const facts = this.facts as ScopeFacts;
    let rest: Span | null = null;
    if (id.type === "Identifier") {
      const binding = facts.scopes.bindingOf(id);
      if (binding !== null) {
        facts.kinds.set(binding, "rest_prop");
        facts.initials.set(binding, null);
      }
      rest = id;
    } else if (id.type === "ObjectPattern") {
      for (const property of id.properties) {
        if (property.type === "RestElement") {
          rest ??= property;
          for (const name of extractIdentifiers(property.argument)) {
            const binding = facts.scopes.bindingOf(name);
            if (binding !== null) facts.kinds.set(binding, "rest_prop");
          }
          continue;
        }
        const value =
          property.value.type === "AssignmentPattern"
            ? property.value.left
            : property.value;
        if (value.type !== "Identifier") continue;
        const binding = facts.scopes.bindingOf(value);
        if (binding === null) continue;
        const initial =
          property.value.type === "AssignmentPattern"
            ? property.value.right
            : null;
        if (
          initial?.type === "CallExpression" &&
          initial.callee.type === "Identifier" &&
          initial.callee.name === "$bindable"
        ) {
          const [first] = initial.arguments;
          facts.initials.set(binding, first ?? null);
          facts.kinds.set(binding, "bindable_prop");
        } else {
          facts.initials.set(binding, initial);
        }
      }
    }
    if (this.customElementProps && rest !== null) {
      this.warn(
        ignores,
        rest,
        "custom_element_props_identifier",
        "Using a rest element or a non-destructured declaration with `$props()` means that Svelte can't infer what properties to expose when creating a custom element. Consider destructuring all the props or explicitly specifying the `customElement.props` option.",
      );
    }
  }

  /** legacy_component_creation: `new App({ target })` of a `.svelte` file's default export. */
  private componentCreation(
    node: ExpressionStatement,
    ignores: ReadonlySet<string>,
  ): void {
    const expression = this.unwrap(node.expression);
    if (expression.type !== "NewExpression") return;
    const callee = this.unwrap(expression.callee);
    if (callee.type !== "Identifier" || expression.arguments.length !== 1) {
      return;
    }
    const [argument] = expression.arguments;
    const options = this.unwrap(argument);
    if (
      options.type !== "ObjectExpression" ||
      !options.properties.some(
        (p) =>
          p.type === "Property" &&
          p.key.type === "Identifier" &&
          p.key.name === "target",
      )
    ) {
      return;
    }
    const binding = (this.facts as ScopeFacts).referenced(callee);
    const declaration = binding?.initial;
    if (
      binding?.kind === "import" &&
      declaration?.type === "ImportDeclaration" &&
      String(declaration.source.value).endsWith(".svelte") &&
      declaration.specifiers.some(
        (s) =>
          s.type === "ImportDefaultSpecifier" && s.local.name === binding.name,
      )
    ) {
      this.warn(
        ignores,
        expression,
        "legacy_component_creation",
        "Svelte 5 components are no longer classes. Instantiate them using `mount` or `hydrate` (imported from 'svelte') instead.",
      );
    }
  }

  /**
   * svelte moves a `<textarea>`'s children into a `value` attribute,
   * unless they're one text, and strips the first one's leading newline.
   */
  private textarea(
    node: AST.RegularElement,
    ignores: ReadonlySet<string>,
  ): void {
    const { nodes } = node.fragment;
    if (
      nodes.length === 0 ||
      (nodes.length === 1 && nodes[0].type === "Text")
    ) {
      this.children(node, ignores);
      return;
    }
    for (const attribute of node.attributes) {
      this.child(attribute, node, ignores);
    }
    for (const child of nodes) {
      if (child === nodes[0] && child.type === "Text") {
        const data = child.data.replace(STARTS_WITH_NEWLINE, "");
        this.text(child, null, ignores, data);
      } else {
        this.visit(child, node, null, -1, ignores);
      }
    }
  }

  /** svelte's `Text` visitor. */
  private text(
    node: AST.Text,
    siblings: readonly Node[] | null,
    ignores: ReadonlySet<string>,
    data = node.data,
  ): void {
    BIDI.lastIndex = 0;
    for (const match of data.matchAll(BIDI)) {
      // A `svelte-ignore` comment before it in its fragment counts.
      let ignored = false;
      if (siblings !== null) {
        for (const sibling of siblings) {
          if (sibling === node) break;
          if (sibling.type === "Comment" && !ignored) {
            ignored = this.codes(
              sibling.data,
              sibling.start + 4,
              ignores,
            ).includes("bidirectional_control_characters");
          }
        }
      }
      if (!ignored) {
        const start = match.index + node.start;
        this.warn(
          ignores,
          { start, end: start + match[0].length },
          "bidirectional_control_characters",
          BIDI_MESSAGE,
        );
      }
    }
  }
}
