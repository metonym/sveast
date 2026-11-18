// What svelte's analyzer knows of each binding when it gives its scope
// warnings, and the warnings it gives before and after its walk:
// store_rune_conflict and non_reactive_update in runes mode,
// export_let_unused in legacy mode (2-analyze/index.js). js-warnings.ts
// gives the rest as it walks. svelte is MIT licensed.

import { extractIdentifiers } from "./extract-identifiers";
import { RUNE_NAMES, RUNES } from "./rune-names";
import type { Binding, Reference, Scope, Scopes } from "./scope";
import type { CallExpression, Expression, Identifier } from "./types/estree";
import type { AST } from "./types/svelte-ast";
import { valueVisitorKeys, walk } from "./walk";

type Node = AST.SvelteNode;
interface Span {
  start: number;
  end: number;
}
type Warn = (node: Span, code: string, message: string) => void;

/** svelte's `binding.kind`, for a binding a rune declares. */
export type RuneKind =
  "state" | "raw_state" | "derived" | "prop" | "rest_prop" | "bindable_prop";

const link = (code: string) => `\nhttps://svelte.dev/e/${code}`;
const NO_IGNORES: ReadonlySet<string> = new Set();

// The runes, without `$`, that a local binding can turn into a store
// subscription.
const RUNE_STORE = /\$(?:state|derived|props|bindable|effect|inspect|host)\b/;
const LEGACY_PROP = /\bexport\b/;
const LABEL = /\$\s*:/;
const RUNE_DECLARATION = /\$(?:state|derived|props)\b/;
// `new X({`: legacy_component_creation.
const CREATION = /new\s+[\w$]+\s*\(\s*\{/;
/** Whether `new X({ target })` may be in the source. */
function mayCreateComponent(source: string): boolean {
  return source.includes("target") && CREATION.test(source);
}

// A `{let}` or `{const}` tag.
const DECLARATION_TAG = /\{\s*(?:let|const)\s/;

/**
 * Whether a component may get a scope warning, from its source and the
 * scripts' syntax. Each check is cheaper than the scopes it saves, and
 * each passes whenever svelte may warn.
 */
export function mayHaveScopeWarnings(
  ast: AST.Root,
  source: string,
  runes: boolean,
  customElementProps: boolean,
): boolean {
  if (mayCreateComponent(source)) return true;
  if (!runes) {
    if (RUNE_STORE.test(source)) return true;
    return (
      (ast.instance !== null && LEGACY_PROP.test(source)) || LABEL.test(source)
    );
  }
  if (customElementProps && source.includes("$props")) return true;
  if (ast.instance === null && ast.module === null) {
    // A `{let}` tag declares the only bindings.
    return RUNE_DECLARATION.test(source) && DECLARATION_TAG.test(source);
  }
  const gate = new Gate(ast, source);
  return gate.storeRuneConflict() || gate.nonReactiveUpdate() || gate.state();
}

const RUNE_BASES = new Set([...RUNE_NAMES].map((rune) => rune.slice(1)));

/** The rune a call names, without the scopes: runes mode can't shadow `$x`. */
function staticRune(node: Node | null | undefined): string | null {
  const call = unwrap(node);
  if (call?.type !== "CallExpression") return null;
  let callee: Node = call.callee;
  let keypath = "";
  while (callee.type === "MemberExpression") {
    if (callee.computed || callee.property.type !== "Identifier") return null;
    keypath = `.${callee.property.name}${keypath}`;
    callee = callee.object;
  }
  if (callee.type !== "Identifier") return null;
  keypath = callee.name + keypath;
  return RUNES.has(keypath) ? keypath : null;
}

/** svelte's `should_proxy` without the lookup of an identifier. */
function mayProxy(node: Node): boolean {
  const value = unwrap(node);
  return !(
    value.type === "Literal" ||
    value.type === "TemplateLiteral" ||
    value.type === "ArrowFunctionExpression" ||
    value.type === "FunctionExpression" ||
    value.type === "UnaryExpression" ||
    value.type === "BinaryExpression" ||
    (value.type === "Identifier" && value.name === "undefined")
  );
}

/** Whether `text` has `name` as a whole word. */
function hasWord(text: string, name: string): boolean {
  for (
    let at = text.indexOf(name);
    at !== -1;
    at = text.indexOf(name, at + 1)
  ) {
    if (!isWordChar(text, at - 1) && !isWordChar(text, at + name.length)) {
      return true;
    }
  }
  return false;
}

function isWordChar(text: string, at: number): boolean {
  const code = text.charCodeAt(at);
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code === 36 ||
    code === 95
  );
}

// A destructuring assignment.
const DESTRUCTURE = /[\]}]\s*=(?![=>])/;

/**
 * The scope-free checks behind {@link mayHaveScopeWarnings} in runes mode,
 * for a component with a script.
 */
class Gate {
  private readonly ast: AST.Root;
  private readonly source: string;
  private markupText: string | undefined;
  // The top-level declarations of the scripts, by name.
  private topLevel: Map<string, Node> | undefined;

  constructor(ast: AST.Root, source: string) {
    this.ast = ast;
    this.source = source;
  }

  /** The source outside the scripts and `<style>`. */
  private markup(): string {
    if (this.markupText === undefined) {
      const { ast, source } = this;
      const cuts: Span[] = [];
      if (ast.module) cuts.push(ast.module);
      if (ast.instance) cuts.push(ast.instance);
      if (ast.css) cuts.push(ast.css);
      cuts.sort((a, b) => a.start - b.start);
      let text = "";
      let at = 0;
      for (const cut of cuts) {
        text += source.slice(at, cut.start);
        at = cut.end;
      }
      this.markupText = text + source.slice(at);
    }
    return this.markupText;
  }

  /** The scripts' top-level declarations: the declarator, or the statement. */
  private declarations(): Map<string, Node> {
    if (this.topLevel === undefined) {
      const declarations = new Map<string, Node>();
      for (const script of [this.ast.module, this.ast.instance]) {
        for (let statement of script?.content.body ?? []) {
          if (
            (statement.type === "ExportNamedDeclaration" ||
              statement.type === "ExportDefaultDeclaration") &&
            statement.declaration
          ) {
            statement = statement.declaration as unknown as typeof statement;
          }
          if (statement.type === "VariableDeclaration") {
            for (const declarator of statement.declarations) {
              for (const id of extractIdentifiers(declarator.id)) {
                declarations.set(id.name, declarator);
              }
            }
          } else if (statement.type === "ImportDeclaration") {
            for (const specifier of statement.specifiers) {
              declarations.set(specifier.local.name, statement);
            }
          } else if (
            (statement.type === "FunctionDeclaration" ||
              statement.type === "ClassDeclaration") &&
            statement.id
          ) {
            declarations.set(statement.id.name, statement);
          }
        }
      }
      this.topLevel = declarations;
    }
    return this.topLevel;
  }

  private markupWritten: Set<string> | null | undefined;

  /** Whether `name` may be reassigned: a script's syntax, or the markup's source. */
  private mayBeWritten(name: string): boolean {
    if (this.markupWritten === undefined) {
      // `null`: the markup may write any name.
      const markup = this.markup();
      if (DESTRUCTURE.test(markup)) {
        this.markupWritten = null;
      } else {
        this.markupWritten = markupWrites(markup);
      }
    }
    return (
      this.markupWritten === null ||
      this.markupWritten.has(name) ||
      this.scan().writes.has(name)
    );
  }

  /** store_rune_conflict: `$x(...)` with a top-level `x` that isn't `x = $x(...)`. */
  storeRuneConflict(): boolean {
    if (!RUNE_STORE.test(this.source)) return false;
    for (const [name, declaration] of this.declarations()) {
      if (!RUNE_BASES.has(name) || !this.source.includes(`$${name}`)) continue;
      const rune =
        declaration.type === "VariableDeclarator"
          ? staticRune(declaration.init)
          : null;
      if (rune === null || (rune === "$props" && name !== "props")) return true;
    }
    return false;
  }

  /**
   * non_reactive_update: a top-level binding no rune declares, which the
   * markup names and something may reassign.
   */
  nonReactiveUpdate(): boolean {
    for (const [name, declaration] of this.declarations()) {
      if (
        declaration.type === "ImportDeclaration" ||
        (declaration.type === "VariableDeclarator" &&
          staticRune(declaration.init) !== null)
      ) {
        continue;
      }
      if (this.mayBeWritten(name) && hasWord(this.markup(), name)) return true;
    }
    return false;
  }

  /**
   * state_referenced_locally: a script reads a rune's binding with no
   * function between them, or a `{let}` tag declares a rune's binding.
   */
  state(): boolean {
    if (!RUNE_DECLARATION.test(this.source)) return false;
    if (DECLARATION_TAG.test(this.markup())) return true;
    return this.scan().reads.some(
      ({ name, ifWritten }) => !ifWritten || this.mayBeWritten(name),
    );
  }

  private scanned: Scan | undefined;

  /** One walk of the scripts, for {@link state} and {@link mayBeWritten}. */
  private scan(): Scan {
    if (this.scanned === undefined) {
      this.scanned = { writes: new Set(), reads: [] };
      for (const script of [this.ast.module, this.ast.instance]) {
        if (script) scanScript(script.content, this.scanned);
      }
    }
    return this.scanned;
  }
}

interface Scan {
  /** The names an assignment, `++`, `--` or `export { x }` may reassign. */
  writes: Set<string>;
  /**
   * The reads of a rune's binding with no function between them.
   * `ifWritten`: a `$state(...)` that only warns once reassigned.
   */
  reads: { name: string; ifWritten: boolean }[];
}

/** Adds a script's writes and same-function rune reads to `scan`. */
function scanScript(program: Node, scan: Scan): void {
  // The rune bindings each function declares, the innermost last; a
  // `$derived(...)` and a `$props()` pattern count as functions, since
  // svelte reads them one function deeper. `true`: only if reassigned.
  const frames: Map<string, boolean>[] = [new Map()];
  const opened = new Set<Node>();
  const declared = new Set<Node>();
  const declare = (pattern: Parameters<typeof extractIdentifiers>[0]) => {
    for (const id of extractIdentifiers(pattern)) declared.add(id);
  };
  walk(
    program,
    {
      enter(node, parent, key) {
        switch (node.type) {
          case "FunctionDeclaration":
          case "FunctionExpression":
          case "ArrowFunctionExpression":
            if (node.type !== "ArrowFunctionExpression" && node.id) {
              declared.add(node.id);
            }
            for (const param of node.params) declare(param);
            frames.push(new Map());
            opened.add(node);
            return;
          case "ClassDeclaration":
          case "ClassExpression":
            if (node.id) declared.add(node.id);
            return;
          case "CatchClause":
            if (node.param) declare(node.param);
            return;
          case "VariableDeclarator":
            declare(node.id);
            return;
          case "AssignmentExpression":
            if (node.left.type !== "MemberExpression") {
              for (const id of extractIdentifiers(node.left)) {
                scan.writes.add(id.name);
              }
            }
            return;
          case "UpdateExpression": {
            const argument = unwrap(node.argument as Node);
            if (argument.type === "Identifier") scan.writes.add(argument.name);
            return;
          }
          case "ExportSpecifier": {
            const local = node.local as Node;
            if (local.type === "Identifier") scan.writes.add(local.name);
            return;
          }
          case "CallExpression": {
            const rune = staticRune(node);
            if (rune === "$derived" || rune === "$derived.by") {
              frames.push(new Map());
              opened.add(node);
            }
            return;
          }
          case "ObjectPattern":
            if (
              parent?.type === "VariableDeclarator" &&
              key === "id" &&
              staticRune(parent.init) === "$props"
            ) {
              frames.push(new Map());
              opened.add(node);
            }
            return;
          case "Identifier": {
            const ifWritten = frames[frames.length - 1].get(node.name);
            if (
              ifWritten === undefined ||
              declared.has(node) ||
              (parent?.type === "MemberExpression" &&
                key === "property" &&
                !parent.computed) ||
              ((parent?.type === "Property" ||
                parent?.type === "MethodDefinition" ||
                parent?.type === "PropertyDefinition") &&
                key === "key" &&
                !parent.computed) ||
              (parent?.type === "AssignmentExpression" && key === "left") ||
              parent?.type === "UpdateExpression" ||
              parent?.type === "LabeledStatement" ||
              parent?.type === "BreakStatement" ||
              parent?.type === "ContinueStatement"
            ) {
              return;
            }
            scan.reads.push({ name: node.name, ifWritten });
            return;
          }
        }
      },
      leave(node) {
        if (opened.has(node)) frames.pop();
        if (node.type !== "VariableDeclarator") return;
        // svelte gives the binding its rune's kind as its walk reaches the
        // declarator.
        const rune = staticRune(node.init);
        if (rune === null || !STATE_RUNES.has(rune)) return;
        let ifWritten = false;
        if (rune === "$state") {
          const { arguments: args } = unwrap(node.init) as CallExpression;
          ifWritten =
            args.length !== 1 ||
            args[0].type === "SpreadElement" ||
            (mayProxy(args[0] as Node) &&
              unwrap(args[0] as Node).type !== "Identifier");
        }
        const frame = frames[frames.length - 1];
        for (const id of extractIdentifiers(node.id)) {
          frame.set(id.name, ifWritten);
        }
      },
    },
    valueVisitorKeys,
  );
}

const isWord = (code: number) =>
  (code >= 48 && code <= 57) ||
  (code >= 65 && code <= 90) ||
  (code >= 97 && code <= 122) ||
  code === 95 ||
  code === 36;

const SPACE = /\s/;

/** The word that ends before `before`, past spaces. */
function wordBefore(text: string, before: number): string {
  let end = before;
  while (end > 0 && SPACE.test(text[end - 1])) end--;
  let start = end;
  while (start > 0 && isWord(text.charCodeAt(start - 1))) start--;
  return text.slice(start, end);
}

/** The word that starts at `after`, past spaces. */
function wordAfter(text: string, after: number): string {
  let start = after;
  while (start < text.length && SPACE.test(text[start])) start++;
  let end = start;
  while (end < text.length && isWord(text.charCodeAt(end))) end++;
  return text.slice(start, end);
}

/**
 * The names an assignment, `++`, `--` or `bind:` in the markup may write,
 * from its source. An attribute's name counts too.
 */
function markupWrites(markup: string): Set<string> {
  const names = new Set<string>();
  for (let i = markup.indexOf("="); i !== -1; i = markup.indexOf("=", i + 1)) {
    const next = markup[i + 1];
    const previous = markup[i - 1];
    if (next === "=" || next === ">" || previous === "=" || previous === "!") {
      continue;
    }
    let end = i;
    while (end > 0 && "+-*/%&|^<>?".includes(markup[end - 1])) end--;
    names.add(wordBefore(markup, end));
  }
  for (const operator of ["++", "--"]) {
    for (
      let i = markup.indexOf(operator);
      i !== -1;
      i = markup.indexOf(operator, i + 2)
    ) {
      names.add(wordBefore(markup, i));
      names.add(wordAfter(markup, i + 2));
    }
  }
  for (
    let i = markup.indexOf("bind:");
    i !== -1;
    i = markup.indexOf("bind:", i + 5)
  ) {
    const name = wordAfter(markup, i + 5);
    names.add(name);
    const at = i + 5 + name.length;
    if (markup.startsWith("={", at)) {
      const close = markup.indexOf("}", at);
      const expression = markup.slice(at, close === -1 ? undefined : close);
      for (const word of expression.match(WORDS) ?? []) names.add(word);
    }
  }
  return names;
}

const WORDS = /[\w$]+/g;

const FUNCTION_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
]);
const STATE_RUNES = new Set([
  "$state",
  "$state.raw",
  "$derived",
  "$derived.by",
  "$props",
]);

/**
 * Whether the scope warnings need a walk of the scripts. In runes mode,
 * state_referenced_locally needs a rune's binding read in a script with
 * no function between them; the walk's depths then decide.
 */
export function needsScriptWalk(
  ast: AST.Root,
  source: string,
  runes: boolean,
  facts: ScopeFacts,
  customElement: boolean,
): boolean {
  if (mayCreateComponent(source) || source.includes("svelte-ignore"))
    return true;
  if (!runes) return LABEL.test(source);
  if (customElement && source.includes("$props")) return true;
  const scripts: Span[] = [];
  if (ast.module) scripts.push(ast.module);
  if (ast.instance) scripts.push(ast.instance);
  // svelte reads a `$derived(...)` initializer and a `$props()`
  // pattern's fallbacks one function deeper.
  const deeper: Span[] = [];
  const all = facts.scopes as Scopes & {
    allReferences(): Iterable<Reference>;
  };
  const candidates: Reference[] = [];
  const exported = facts.exports(ast);
  for (const reference of all.allReferences()) {
    const { binding, parent } = reference;
    if (
      binding === null ||
      reference.store ||
      reference.type ||
      !reference.reads ||
      parent.type === "UpdateExpression"
    ) {
      continue;
    }
    const kind = facts.staticKind(binding);
    if (
      kind === null ||
      (kind === "$state" && !facts.mayBeStatic(binding, exported)) ||
      !scripts.some((script) => contains(script, reference.node))
    ) {
      continue;
    }
    let scope: Scope | null = reference.scope;
    while (scope !== null && scope !== binding.scope) {
      if (FUNCTION_TYPES.has(scope.node?.type ?? "")) break;
      scope = scope.parent;
    }
    if (scope === binding.scope) candidates.push(reference);
  }
  if (candidates.length === 0) return false;
  for (const reference of all.allReferences()) {
    const { binding } = reference;
    if (binding === null) continue;
    const kind = facts.staticKind(binding);
    if (kind !== "$derived" && kind !== "$props") continue;
    const declaration = binding.declaration as AST.SvelteNode & {
      id: Span;
      init: Span;
    };
    deeper.push(kind === "$props" ? declaration.id : declaration.init);
  }
  return candidates.some(
    (reference) => !deeper.some((span) => contains(span, reference.node)),
  );
}

/**
 * Whether the scope warnings need a walk of the markup: for
 * state_referenced_locally on a `{let}` tag's binding,
 * legacy_component_creation and reactive_declaration_invalid_placement
 * in an event handler. A script's bindings never warn there.
 */
export function needsMarkupWalk(source: string, runes: boolean): boolean {
  return (
    mayCreateComponent(source) ||
    (runes ? DECLARATION_TAG.test(source) : LABEL.test(source))
  );
}

// What svelte's remove_typescript_nodes.js replaces with its expression.
const TYPE_WRAPPERS = new Set([
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "TSTypeAssertion",
  "TSInstantiationExpression",
]);

/** `node` without TypeScript's wrappers, as svelte's analyzer sees it. */
function unwrap<T extends Node | null | undefined>(node: T): T {
  let inner = node;
  while (inner != null && TYPE_WRAPPERS.has(inner.type)) {
    inner = (inner as unknown as { expression: T }).expression;
  }
  return inner;
}

/**
 * What svelte's analyzer learns of the bindings as it walks, which its
 * warnings read at the time.
 */
export class ScopeFacts {
  readonly scopes: Scopes;
  /** The kinds the rune declarators the walk has reached give. */
  readonly kinds = new Map<Binding, RuneKind>();
  /** Their `scope.function_depth`. */
  readonly depths = new Map<Binding, number>();
  /** The bindings `export { x }` in runes mode's instance marks reassigned. */
  readonly exported = new Set<Binding>();
  private lastDeclared: Map<Binding, Identifier> | null = null;
  /** The first values svelte gives `$props()`'s bindings: the fallbacks. */
  readonly initials = new Map<Binding, AST.SvelteNode | null>();
  /** svelte's `ignore_map`, for the identifiers the walk reaches. */
  readonly ignores = new Map<Identifier, ReadonlySet<string>>();
  private readonly updated = new Map<Binding, boolean>();

  constructor(scopes: Scopes) {
    this.scopes = scopes;
  }

  /**
   * svelte's `binding.reassigned`: an assignment, `++`, `--` or `bind:`
   * targets it, or `export { x }` in runes mode's instance names it. Not
   * `for (x of y)`. A pattern in `for ([x] of y)` counts, which svelte's
   * doesn't.
   */
  reassigned(binding: Binding): boolean {
    if (this.exported.has(binding)) return true;
    let reassigned = this.updated.get(binding);
    if (reassigned === undefined) {
      reassigned = binding.references.some(
        (reference) =>
          reference.writes &&
          !reference.store &&
          !(
            (reference.parent.type === "ForOfStatement" ||
              reference.parent.type === "ForInStatement") &&
            reference.parent.left === reference.node
          ),
      );
      this.updated.set(binding, reassigned);
    }
    return reassigned;
  }

  /** The binding an identifier refers to, as svelte's `scope.get`; not a store's. */
  referenced(node: Identifier): Binding | null {
    const reference = this.scopes.referenceOf(node);
    if (reference === null || reference.store) return null;
    const { binding } = reference;
    // svelte drops type-only imports, so their names are globals.
    if (binding?.kind === "import") {
      const specifier = binding.declaration as { importKind?: string };
      const declaration = binding.initial as { importKind?: string } | null;
      if (
        specifier.importKind === "type" ||
        declaration?.importKind === "type"
      ) {
        return null;
      }
    }
    return binding;
  }

  /**
   * The identifier svelte gives a binding's warnings at. svelte gives a
   * `var` declared again a new binding, so its warnings point at the
   * last declaration.
   */
  nodeOf(binding: Binding): Identifier | null {
    if (binding.kind !== "var") return binding.node;
    if (this.lastDeclared === null) {
      this.lastDeclared = new Map();
      const all = this.scopes as Scopes & {
        allDeclared(): Iterable<[Identifier, Binding]>;
      };
      for (const [node, declared] of all.allDeclared()) {
        if (declared.kind !== "var") continue;
        const last = this.lastDeclared.get(declared);
        if (last === undefined || last.start < node.start) {
          this.lastDeclared.set(declared, node);
        }
      }
    }
    return this.lastDeclared.get(binding) ?? binding.node;
  }

  /**
   * Whether a `$state(...)` binding's reads may take only its first
   * value, as {@link stateIsStatic} has it once the walk is done: it may
   * be reassigned or exported, or its value may not be proxied.
   */
  mayBeStatic(binding: Binding, exported: readonly Binding[]): boolean {
    // `export { x }` marks it reassigned.
    if (this.reassigned(binding) || exported.includes(binding)) return true;
    const initial = unwrap(binding.initial);
    if (initial?.type !== "CallExpression") return true;
    const { arguments: args } = initial as CallExpression;
    if (args.length !== 1 || args[0].type === "SpreadElement") return false;
    const argument = unwrap(args[0] as Node);
    return argument.type === "Identifier" || !this.shouldProxy(argument, false);
  }

  /**
   * Whether a rune declares the binding, once svelte's walk has reached
   * every declarator: `$state`, `$derived` or `$props`.
   */
  staticKind(binding: Binding): string | null {
    const { declaration } = binding;
    if (declaration.type !== "VariableDeclarator") return null;
    const rune = this.rune(declaration.init);
    return rune !== null && STATE_RUNES.has(rune) ? rune : null;
  }

  /**
   * After the walk: the names `export { x }` in runes mode's instance
   * exports, which svelte marks reassigned when it reaches them.
   */
  exportedNames(ast: AST.Root): void {
    for (const binding of this.exports(ast)) this.exported.add(binding);
  }

  /** The bindings runes mode's instance names in `export { x }`. */
  exports(ast: AST.Root): Binding[] {
    const bindings: Binding[] = [];
    for (const node of ast.instance?.content.body ?? []) {
      if (
        node.type !== "ExportNamedDeclaration" ||
        node.source != null ||
        node.exportKind === "type"
      ) {
        continue;
      }
      for (const specifier of node.specifiers) {
        if (
          specifier.exportKind === "type" ||
          specifier.local.type !== "Identifier"
        ) {
          continue;
        }
        const binding = this.scopes.instance.get(specifier.local.name);
        if (binding !== null) bindings.push(binding);
      }
    }
    return bindings;
  }

  /** A binding's first value, as svelte has it: a prop's is its fallback. */
  private initialOf(binding: Binding): Node | null {
    if (!this.initials.has(binding)) return binding.initial;
    return this.initials.get(binding) ?? null;
  }

  /** svelte's `get_rune`. */
  rune(node: Node | null | undefined): string | null {
    const call = unwrap(node);
    if (call?.type !== "CallExpression") return null;
    let callee: Node = call.callee;
    let keypath = "";
    while (callee.type === "MemberExpression") {
      if (callee.computed || callee.property.type !== "Identifier") {
        return null;
      }
      keypath = `.${callee.property.name}${keypath}`;
      callee = callee.object;
    }
    if (
      callee.type === "CallExpression" &&
      callee.callee.type === "Identifier"
    ) {
      keypath = `()${keypath}`;
      callee = callee.callee;
    }
    if (callee.type !== "Identifier") return null;
    const reference = this.scopes.referenceOf(callee);
    if (reference !== null && (reference.binding !== null || reference.store)) {
      return null;
    }
    keypath = callee.name + keypath;
    return RUNES.has(keypath) ? keypath : null;
  }

  /** svelte's `should_proxy`, for the argument of `$state(...)`. */
  shouldProxy(node: Node | null, lookup: boolean): boolean {
    const value = unwrap(node);
    if (value === null || !mayProxy(value)) return false;
    if (value.type === "Identifier" && lookup) {
      const binding = this.referenced(value);
      const initial = binding === null ? null : this.initialOf(binding);
      if (
        binding !== null &&
        !this.reassigned(binding) &&
        initial !== null &&
        initial.type !== "FunctionDeclaration" &&
        initial.type !== "ClassDeclaration" &&
        initial.type !== "ImportDeclaration" &&
        initial.type !== "EachBlock" &&
        initial.type !== "SnippetBlock"
      ) {
        return this.shouldProxy(initial, false);
      }
    }
    return true;
  }

  /**
   * Whether a reference to a `$state(...)` binding takes only its first
   * value: it's reassigned, or its value isn't proxied.
   */
  stateIsStatic(binding: Binding): boolean {
    if (this.reassigned(binding)) return true;
    const initial = unwrap(binding.initial);
    if (initial?.type !== "CallExpression") return false;
    const { arguments: args } = initial as CallExpression;
    return (
      args.length === 1 &&
      args[0].type !== "SpreadElement" &&
      !this.shouldProxy(args[0] as Expression, true)
    );
  }

  warn(warn: Warn, node: Identifier, code: string, message: string): void {
    if (!(this.ignores.get(node) ?? NO_IGNORES).has(code)) {
      warn(node, code, message + link(code));
    }
  }
}

/**
 * store_rune_conflict: `$state(...)` and the like where a local binding
 * makes it a store subscription. svelte gives it before its walk, so no
 * `svelte-ignore` silences it.
 */
export function storeRuneConflicts(facts: ScopeFacts, warn: Warn): void {
  for (const rune of RUNE_NAMES) {
    const name = rune.slice(1);
    const binding = facts.scopes.instance.get(name);
    if (binding === null) continue;
    for (const reference of binding.references) {
      if (reference.store && reference.parent.type === "CallExpression") {
        warn(
          reference.node,
          "store_rune_conflict",
          `It looks like you're using the \`$${name}\` rune, but there is a local binding called \`${name}\`. Referencing a local variable with a \`$\` prefix will create a store subscription. Please rename \`${name}\` to avoid the ambiguity${link("store_rune_conflict")}`,
        );
      }
    }
  }
}

function contains(outer: Span, inner: Span): boolean {
  return outer.start <= inner.start && inner.end <= outer.end;
}

const MARKUP_BLOCKS = new Set([
  "IfBlock",
  "EachBlock",
  "AwaitBlock",
  "KeyBlock",
]);

/** The markup's functions, `bind:this` directives and blocks. */
function markupSpans(fragment: AST.Fragment): {
  functions: Span[];
  bindThis: Span[];
  blocks: Span[];
} {
  const functions: Span[] = [];
  const bindThis: Span[] = [];
  const blocks: Span[] = [];
  walk(
    fragment,
    {
      enter(node) {
        if (
          node.type === "FunctionDeclaration" ||
          node.type === "FunctionExpression" ||
          node.type === "ArrowFunctionExpression"
        ) {
          functions.push(node);
        } else if (node.type === "BindDirective" && node.name === "this") {
          bindThis.push(node);
        } else if (MARKUP_BLOCKS.has(node.type)) {
          blocks.push(node as Span);
        }
      },
    },
    valueVisitorKeys,
  );
  return { functions, bindThis, blocks };
}

/**
 * non_reactive_update: a script's binding that's reassigned but not
 * state, which the markup reads outside a function. `bind:this` counts
 * only in a block.
 */
export function nonReactiveUpdates(
  ast: AST.Root,
  facts: ScopeFacts,
  warn: Warn,
): void {
  const scripts: Span[] = [];
  if (ast.module) scripts.push(ast.module);
  if (ast.instance) scripts.push(ast.instance);
  const inScript = (node: Span) =>
    scripts.some((script) => contains(script, node));
  let spans: ReturnType<typeof markupSpans> | undefined;
  for (const scope of [facts.scopes.module, facts.scopes.instance]) {
    outer: for (const [name, binding] of scope.declarations) {
      if (binding.node === null || facts.staticKind(binding) !== null) {
        continue;
      }
      const references = binding.references.filter(
        (reference) => !reference.store && !inScript(reference.node),
      );
      if (references.length === 0 || !facts.reassigned(binding)) continue;
      spans ??= markupSpans(ast.fragment);
      inner: for (const reference of references) {
        // The markup's ancestors, the outermost first.
        let bindThis: Span | null = null;
        for (const span of spans.bindThis) {
          if (contains(span, reference.node)) bindThis = span;
        }
        for (const span of spans.functions) {
          if (
            contains(span, reference.node) &&
            (bindThis === null || contains(bindThis, span))
          ) {
            continue inner;
          }
        }
        if (bindThis !== null) {
          const span = bindThis;
          if (!spans.blocks.some((block) => contains(block, span))) {
            continue;
          }
        }
        facts.warn(
          warn,
          facts.nodeOf(binding) as Identifier,
          "non_reactive_update",
          `\`${name}\` is updated, but is not declared with \`$state(...)\`. Changing its value will not correctly trigger updates`,
        );
        continue outer;
      }
    }
  }
}

/**
 * export_let_unused: a legacy prop nothing reads. As svelte's analyzer
 * has it, the props are the names `export let`, `export var` or
 * `export { x }` of a `let` or `var` exports, whatever their initializer.
 */
export function unusedExports(
  ast: AST.Root,
  facts: ScopeFacts,
  warn: Warn,
): void {
  const { instance } = facts.scopes;
  const props = new Set<Binding>();
  for (const node of ast.instance?.content.body ?? []) {
    if (node.type !== "ExportNamedDeclaration") continue;
    const { declaration } = node;
    if (declaration?.type === "VariableDeclaration") {
      if (declaration.kind === "const") continue;
      for (const declarator of declaration.declarations) {
        for (const id of extractIdentifiers(declarator.id)) {
          const binding = instance.get(id.name);
          if (binding !== null) props.add(binding);
        }
      }
    } else if (declaration == null) {
      for (const specifier of node.specifiers) {
        if (
          specifier.local.type !== "Identifier" ||
          specifier.exported.type !== "Identifier"
        ) {
          continue;
        }
        const binding = instance.get(specifier.local.name);
        if (binding?.kind === "let" || binding?.kind === "var") {
          props.add(binding);
        }
      }
    }
  }
  for (const [name, binding] of instance.declarations) {
    if (!props.has(binding) || binding.node === null || name === "$$props") {
      continue;
    }
    // A `$name` subscription counts as a use.
    if (
      binding.references.every(
        (reference) => reference.parent.type === "ExportSpecifier",
      )
    ) {
      facts.warn(
        warn,
        facts.nodeOf(binding) as Identifier,
        "export_let_unused",
        `Component has unused export property '${name}'. If it is for external reference only, please consider using \`export const ${name}\``,
      );
    }
  }
}
