import { extractIdentifiers } from "./extract-identifiers";
import { isReference } from "./is-reference";
import { fieldsOf, isNode } from "./nodes";
import { RUNE_NAMES, RUNES } from "./rune-names";
import type {
  ArrowFunctionExpression,
  Expression,
  FunctionDeclaration,
  FunctionExpression,
  Identifier,
  Pattern,
  Program,
  VariableDeclaration,
  VariableDeclarator,
} from "./types/estree";
import type { AST } from "./types/svelte-ast";
import type { TSParameterProperty } from "./types/typescript";
import { valueVisitorKeys } from "./walk";

/** How a {@link Binding} is declared. */
export type BindingKind =
  | "import"
  | "var"
  | "let"
  | "const"
  | "using"
  | "function"
  | "class"
  | "enum"
  | "enum-member"
  | "namespace"
  | "param"
  | "catch"
  | "reactive"
  | "each"
  | "each-index"
  | "let-directive"
  | "snippet"
  | "snippet-param"
  | "const-tag"
  | "await-value"
  | "await-error";

/** A name declared in a {@link Scope}. */
export interface Binding {
  readonly name: string;
  /**
   * What declares it: `"import"`, `"var"`, `"let"`, `"const"` (`{let}`
   * and `{const}` tags included), `"using"`, `"function"`, `"class"`,
   * `"enum"`, `"enum-member"`, `"namespace"`, `"param"`, `"catch"`,
   * `"reactive"` (`x` in `$: x = ...` without a declaration of `x`),
   * `"each"` and `"each-index"` (`item` and `i` in `{#each items as item,
   * i}`), `"let-directive"`, `"snippet"` (its name), `"snippet-param"`,
   * `"const-tag"` (`{@const}`), `"await-value"` and `"await-error"` (`{:then
   * value}` and `{:catch error}`).
   */
  readonly kind: BindingKind;
  /**
   * The `Identifier` that declares it; `null` for an each block's index
   * and `let:x` without a value, whose names are strings.
   */
  readonly node: Identifier | null;
  /**
   * The node that declares it: the import specifier, the
   * `VariableDeclarator`, the function or class, the function a
   * parameter belongs to, the `CatchClause`, the `LabeledStatement` of
   * `$:`, the `EachBlock`, `LetDirective`, `SnippetBlock` or `AwaitBlock`,
   * the enum, enum member or namespace, or `import a = b`.
   */
  readonly declaration: AST.SvelteNode;
  /**
   * What it starts as, as svelte's analyzer has it: a variable's
   * initializer, the function or class, the `ImportDeclaration`, the
   * `SnippetBlock` for a snippet's name, the `EachBlock` for an index,
   * the right side of `$: x = ...`, an enum member's initializer. For a
   * prop destructured from `$props()`, its default, without `$bindable`:
   * `"md"` in `let { size = "md" } = $props()` or in `let { size =
   * $bindable("md") } = $props()`. `null` otherwise.
   */
  readonly initial: AST.SvelteNode | null;
  readonly scope: Scope;
  /**
   * Every use of it, in source order: reads, writes, and `$name`
   * subscriptions if it's a store. Not the identifiers that declare it,
   * but for `x` in `$: x = ...`, which declares `x` and writes it each
   * time the statement runs.
   */
  readonly references: readonly Reference[];
  /**
   * The rune its declarator's initializer calls, such as `"$state"`,
   * `"$state.raw"`, `"$derived"`, `"$derived.by"` or `"$props"`, unless
   * a binding or a store shadows it; `null` otherwise.
   */
  readonly rune: string | null;
  /**
   * The name a parent passes it as, for a prop: `"class"` for `klass` in
   * `let { class: klass } = $props()` and in `export { klass as class }`,
   * `"size"` in `export let size`. `null` otherwise, including for `rest`
   * in `let { a, ...rest } = $props()`.
   */
  readonly prop: string | null;
}

/** A use of a name. */
export interface Reference {
  /**
   * The `Identifier`. For a name the AST holds only as a string, such as
   * `Foo` in `<Foo.Bar>`, `a` in `use:a`, `transition:a`, `in:a`,
   * `out:a` and `animate:a`, and `color` in `style:color`, a new
   * `Identifier` with the name's `start` and `end`.
   */
  readonly node: Identifier;
  /** The node that holds it. */
  readonly parent: AST.SvelteNode;
  /** The scope it's in. */
  readonly scope: Scope;
  /** What it refers to; `null` for a global, such as `window` or a rune. */
  readonly binding: Binding | null;
  /**
   * Whether it reads the value: all but the target of a plain `=`, and
   * every store subscription.
   */
  readonly reads: boolean;
  /**
   * Whether it assigns a new value: the target of `=`, `+=` and the like,
   * `++` and `--`, `bind:`, or `for (a of b)`.
   */
  readonly writes: boolean;
  /**
   * Whether it changes a property of the value: `a` in `a.b = c`,
   * `a.b++` and `bind:value={a.b}`.
   */
  readonly mutates: boolean;
  /**
   * Whether it's a store subscription: `$count` refers to `count`, and
   * `$count = 1` mutates it.
   */
  readonly store: boolean;
}

/**
 * The names a function, block, element or other node declares, and the
 * scopes around it.
 */
export interface Scope {
  /**
   * The node that makes it, or `null` for a component's `<script>` or
   * `<script module>` that isn't there.
   */
  readonly node: AST.SvelteNode | null;
  readonly parent: Scope | null;
  /** Its own bindings, by name, in the order they're declared. */
  readonly declarations: ReadonlyMap<string, Binding>;
  /**
   * The binding `name` refers to here, declared in this scope or one
   * around it; `null` if none does.
   */
  get(name: string): Binding | null;
}

/** What {@link analyzeScopes} found. */
export interface Scopes {
  /** The `<script module>`'s scope, or a module's. */
  readonly module: Scope;
  /** The `<script>`'s scope, inside `module`; a module's, for a module. */
  readonly instance: Scope;
  /**
   * The scope `node` is in: for a function, the scope around it, while
   * its parameters are in its own. `null` for a node in a type, in the
   * `<style>` or outside the AST.
   */
  scopeOf(node: AST.SvelteNode): Scope | null;
  /**
   * The binding an `Identifier` declares or refers to; `null` for a
   * global, and for a name that isn't a reference, such as a property
   * key or a name in a type.
   */
  bindingOf(node: Identifier): Binding | null;
  /**
   * The use an `Identifier` is, with whether it reads, writes or
   * mutates its binding or subscribes to it as a store; `null` for an
   * `Identifier` that declares a binding or isn't a reference. A global's
   * use has no binding.
   */
  referenceOf(node: Identifier): Reference | null;
  /**
   * The bindings of the scope `node` makes, by name; empty if it makes
   * none. A function's are its parameters, and a function expression's
   * name; its body's declarations are its body's.
   */
  declaredIn(node: AST.SvelteNode): ReadonlyMap<string, Binding>;
}

class ScopeNode implements Scope {
  readonly node: AST.SvelteNode | null;
  readonly parent: ScopeNode | null;
  readonly porous: boolean;
  readonly declarations = new Map<string, BindingNode>();

  constructor(
    node: AST.SvelteNode | null,
    parent: ScopeNode | null,
    porous: boolean,
  ) {
    this.node = node;
    this.parent = parent;
    this.porous = porous;
  }

  get(name: string): BindingNode | null {
    for (let scope: ScopeNode | null = this; scope; scope = scope.parent) {
      const binding = scope.declarations.get(name);
      if (binding !== undefined) return binding;
    }
    return null;
  }
}

class BindingNode implements Binding {
  readonly name: string;
  readonly kind: BindingKind;
  readonly node: Identifier | null;
  readonly declaration: AST.SvelteNode;
  initial: AST.SvelteNode | null;
  readonly scope: ScopeNode;
  readonly references: ReferenceNode[] = [];
  rune: string | null = null;
  prop: string | null = null;

  constructor(
    name: string,
    kind: BindingKind,
    node: Identifier | null,
    declaration: AST.SvelteNode,
    initial: AST.SvelteNode | null,
    scope: ScopeNode,
  ) {
    this.name = name;
    this.kind = kind;
    this.node = node;
    this.declaration = declaration;
    this.initial = initial;
    this.scope = scope;
  }
}

class ReferenceNode implements Reference {
  readonly node: Identifier;
  readonly parent: AST.SvelteNode;
  readonly scope: ScopeNode;
  binding: BindingNode | null = null;
  reads: boolean;
  writes: boolean;
  mutates: boolean;
  store = false;

  constructor(
    node: Identifier,
    parent: AST.SvelteNode,
    scope: ScopeNode,
    reads: boolean,
    writes: boolean,
    mutates: boolean,
  ) {
    this.node = node;
    this.parent = parent;
    this.scope = scope;
    this.reads = reads;
    this.writes = writes;
    this.mutates = mutates;
  }
}

type FunctionNode =
  | ArrowFunctionExpression
  | FunctionDeclaration
  | FunctionExpression;

type DeclaredPattern = Pattern | TSParameterProperty;

type LetExpression = NonNullable<AST.LetDirective["expression"]>;

const keysByType: Partial<Record<string, readonly string[]>> = Object.assign(
  Object.create(null),
  valueVisitorKeys,
);

const ELEMENTS = new Set([
  "SvelteElement",
  "RegularElement",
  "SvelteFragment",
  "Component",
  "SvelteComponent",
  "SvelteSelf",
  "SlotElement",
]);

const NO_BINDINGS: ReadonlyMap<string, Binding> = new Map();

/**
 * Finds every scope, binding and reference in a component, its scripts
 * and its markup together, or in a module, as svelte's analyzer does:
 * which declaration each name refers to, and where each binding is read,
 * written or subscribed to.
 *
 * Besides JavaScript's scopes, it knows the markup's: `{#each items as
 * item, i (key)}` declares `item` and `i` for the key and the body, a
 * snippet its parameters, `{:then value}` and `{:catch error}` their
 * names, `{@const}` a name for its whole fragment, and `let:` a name for
 * the element, or for a component's default or named slot (`let:a={b}`
 * declares `b`). Store subscriptions such as `$count` are uses of
 * `count`, unless they're runes. `bind:` writes its target, and
 * `$: x = ...` declares `x` if nothing else does. A binding records the
 * rune that initializes it, such as `$state` or `$props`, and the name a
 * prop is passed as.
 *
 * Names in TypeScript types aren't references, and types aren't
 * declarations: `interface` and `type` declare nothing. A top-level
 * snippet is declared in the markup's scope, as in svelte's analyzer, so
 * a `<script>` that uses it refers to a global.
 *
 * ```ts
 * import { parse } from "sveast";
 * import { analyzeScopes } from "sveast/scope";
 *
 * const ast = parse(source);
 * const scopes = analyzeScopes(ast);
 * const size = scopes.instance.get("size");
 * size?.prop; // "size", for `let { size } = $props()`
 * size?.references.some((reference) => reference.writes || reference.mutates);
 * ```
 *
 * It reads the AST but doesn't change it.
 */
export function analyzeScopes(ast: AST.Root | Program): Scopes {
  return new Analysis(ast);
}

class Analysis implements Scopes {
  readonly module: ScopeNode;
  readonly instance: ScopeNode;
  private readonly instanceProgram: Program | null = null;
  private readonly component: boolean;
  private readonly scopeIn = new Map<AST.SvelteNode, ScopeNode>();
  private readonly made = new Map<AST.SvelteNode, ScopeNode>();
  private readonly declared = new Map<Identifier, BindingNode>();
  private readonly references = new Map<Identifier, ReferenceNode>();
  private readonly pending: ReferenceNode[] = [];
  private readonly declarators: [VariableDeclarator, ScopeNode][] = [];
  private readonly implicit: [
    Identifier,
    AST.SvelteNode,
    AST.SvelteNode | null,
  ][] = [];
  private readonly stores = new Map<string, BindingNode | null | false>();

  constructor(ast: AST.Root | Program) {
    if (ast.type === "Program") {
      this.component = false;
      this.module = new ScopeNode(ast, null, false);
      this.instance = this.module;
      this.made.set(ast, this.module);
      this.visit(ast, null, this.module);
    } else {
      this.component = true;
      const module = ast.module?.content ?? null;
      const instance = ast.instance?.content ?? null;
      this.module = new ScopeNode(module, null, false);
      this.instance = new ScopeNode(instance, this.module, false);
      this.instanceProgram = instance;
      this.scopeIn.set(ast, this.module);
      for (const [script, scope] of [
        [ast.module, this.module],
        [ast.instance, this.instance],
      ] as const) {
        if (script === undefined) continue;
        this.scopeIn.set(script, scope);
        this.made.set(script.content, scope);
        for (const attribute of script.attributes) {
          this.visit(attribute, script, scope);
        }
        this.visit(script.content, script, scope);
      }
      this.visit(ast.fragment, ast, this.instance);
    }
    this.declareImplicit();
    this.resolve();
    this.findRunesAndProps();
  }

  scopeOf(node: AST.SvelteNode): Scope | null {
    return this.scopeIn.get(node) ?? null;
  }

  bindingOf(node: Identifier): Binding | null {
    return (
      this.declared.get(node) ?? this.references.get(node)?.binding ?? null
    );
  }

  referenceOf(node: Identifier): Reference | null {
    return this.references.get(node) ?? null;
  }

  declaredIn(node: AST.SvelteNode): ReadonlyMap<string, Binding> {
    return this.made.get(node)?.declarations ?? NO_BINDINGS;
  }

  private child(
    scope: ScopeNode,
    node: AST.SvelteNode,
    porous: boolean,
  ): ScopeNode {
    const made = new ScopeNode(node, scope, porous);
    this.made.set(node, made);
    return made;
  }

  private declare(
    scope: ScopeNode,
    node: Identifier | null,
    name: string,
    kind: BindingKind,
    declaration: AST.SvelteNode,
    initial: AST.SvelteNode | null,
  ): void {
    let target = scope;
    if (kind === "var") {
      while (target.porous && target.parent !== null) target = target.parent;
    }
    const existing = target.declarations.get(name);
    if (
      existing !== undefined &&
      existing.declaration.type !== "TSDeclareFunction"
    ) {
      if (node !== null) this.declared.set(node, existing);
      return;
    }
    const binding = new BindingNode(
      name,
      kind,
      node,
      declaration,
      initial,
      target,
    );
    target.declarations.set(name, binding);
    if (node !== null) this.declared.set(node, binding);
  }

  private reference(
    node: Identifier,
    parent: AST.SvelteNode,
    scope: ScopeNode,
    reads: boolean,
    writes: boolean,
    mutates: boolean,
  ): void {
    this.pending.push(
      new ReferenceNode(node, parent, scope, reads, writes, mutates),
    );
  }

  private referenceName(
    name: string,
    start: number,
    parent: AST.SvelteNode,
    scope: ScopeNode,
  ): void {
    const root = name.split(".")[0];
    const node: Identifier = {
      type: "Identifier",
      name: root,
      start,
      end: start + root.length,
    };
    this.scopeIn.set(node, scope);
    this.reference(node, parent, scope, true, false, false);
  }

  private visit(
    node: AST.SvelteNode,
    parent: AST.SvelteNode | null,
    scope: ScopeNode,
  ): void {
    this.scopeIn.set(node, scope);
    switch (node.type) {
      case "Identifier":
        if (parent !== null && isReference(node, parent)) {
          this.reference(node, parent, scope, true, false, false);
        }
        this.visitFields(node, scope);
        return;
      case "ImportDeclaration":
        for (const specifier of node.specifiers) {
          this.scopeIn.set(specifier, scope);
          this.scopeIn.set(specifier.local, scope);
          if (specifier.type === "ImportSpecifier") {
            this.scopeIn.set(specifier.imported, scope);
          }
          this.declare(
            scope,
            specifier.local,
            specifier.local.name,
            "import",
            specifier,
            node,
          );
        }
        this.visit(node.source, node, scope);
        for (const attribute of node.attributes ?? []) {
          this.visit(attribute, node, scope);
        }
        return;
      case "ExportNamedDeclaration":
        if (node.declaration) this.visit(node.declaration, node, scope);
        for (const specifier of node.specifiers) {
          this.scopeIn.set(specifier, scope);
          this.scopeIn.set(specifier.local, scope);
          this.scopeIn.set(specifier.exported, scope);
          if (!node.source && specifier.local.type === "Identifier") {
            this.reference(
              specifier.local,
              specifier,
              scope,
              true,
              false,
              false,
            );
          }
        }
        if (node.source) this.visit(node.source, node, scope);
        for (const attribute of node.attributes ?? []) {
          this.visit(attribute, node, scope);
        }
        return;
      case "VariableDeclaration":
        this.visitDeclaration(node, parent, scope);
        return;
      case "FunctionDeclaration":
        if (node.id) {
          this.scopeIn.set(node.id, scope);
          this.declare(scope, node.id, node.id.name, "function", node, node);
        }
        this.visitFunction(node, this.child(scope, node, true));
        return;
      case "FunctionExpression": {
        const inner = this.child(scope, node, true);
        if (node.id) {
          this.scopeIn.set(node.id, inner);
          this.declare(inner, node.id, node.id.name, "function", node, node);
        }
        this.visitFunction(node, inner);
        return;
      }
      case "ArrowFunctionExpression":
        this.visitFunction(node, this.child(scope, node, true));
        return;
      case "ClassDeclaration":
      case "ClassExpression": {
        let inner = scope;
        if (node.id) {
          if (node.type === "ClassExpression") {
            inner = this.child(scope, node, false);
          }
          this.scopeIn.set(node.id, inner);
          this.declare(inner, node.id, node.id.name, "class", node, node);
        }
        for (const decorator of node.decorators ?? []) {
          this.visit(decorator, node, scope);
        }
        if (node.superClass) this.visit(node.superClass, node, inner);
        this.visit(node.body, node, inner);
        return;
      }
      case "BlockStatement":
        this.visitFields(
          node,
          this.child(
            scope,
            node,
            !(parent !== null && isFunction(parent) && parent.body === node),
          ),
        );
        return;
      case "StaticBlock":
        this.visitFields(node, this.child(scope, node, false));
        return;
      case "ForStatement":
      case "SwitchStatement":
        this.visitFields(node, this.child(scope, node, true));
        return;
      case "ForInStatement":
      case "ForOfStatement": {
        const inner = this.child(scope, node, true);
        if (node.left.type === "VariableDeclaration") {
          this.visit(node.left, node, inner);
        } else {
          this.visitTarget(node.left, node, inner, false);
        }
        this.visit(node.right, node, inner);
        this.visit(node.body, node, inner);
        return;
      }
      case "CatchClause": {
        if (!node.param) break;
        const inner = this.child(scope, node, true);
        this.declarePattern(node.param, node, inner, "catch", node, null);
        this.visit(node.body, node, inner);
        return;
      }
      case "AssignmentExpression":
        this.visitTarget(node.left, node, scope, node.operator !== "=");
        this.visit(node.right, node, scope);
        return;
      case "UpdateExpression":
        this.visitTarget(node.argument, node, scope, true);
        return;
      case "LabeledStatement":
        if (parent === this.instanceProgram && node.label.name === "$") {
          this.visitReactive(node, scope);
          return;
        }
        break;
      case "TSEnumDeclaration": {
        this.scopeIn.set(node.id, scope);
        this.declare(scope, node.id, node.id.name, "enum", node, node);
        const inner = this.child(scope, node, false);
        for (const member of node.members) {
          this.scopeIn.set(member, inner);
          this.scopeIn.set(member.id, inner);
          if (member.id.type === "Identifier") {
            this.declare(
              inner,
              member.id,
              member.id.name,
              "enum-member",
              member,
              member.initializer ?? null,
            );
          }
        }
        for (const member of node.members) {
          if (member.initializer) this.visit(member.initializer, member, inner);
        }
        return;
      }
      case "TSModuleDeclaration":
        this.scopeIn.set(node.id, scope);
        if (node.id.type === "Identifier" && !node.global) {
          this.declare(scope, node.id, node.id.name, "namespace", node, node);
        }
        if (node.body) {
          this.visit(node.body, node, this.child(scope, node, false));
        }
        return;
      case "TSImportEqualsDeclaration": {
        this.scopeIn.set(node.id, scope);
        this.declare(
          scope,
          node.id,
          node.id.name,
          "import",
          node,
          node.moduleReference,
        );
        let name: AST.SvelteNode = node.moduleReference;
        while (name.type === "TSQualifiedName") {
          this.scopeIn.set(name, scope);
          this.scopeIn.set(name.right, scope);
          name = name.left;
        }
        if (name.type === "Identifier") {
          this.scopeIn.set(name, scope);
          this.reference(name, node, scope, true, false, false);
        } else {
          this.visit(name, node, scope);
        }
        return;
      }
      case "TSDeclareFunction":
        if (node.id) {
          this.scopeIn.set(node.id, scope);
          if (!scope.declarations.has(node.id.name)) {
            this.declare(scope, node.id, node.id.name, "function", node, node);
          }
        }
        return;
      case "Fragment":
        this.visitFields(node, this.child(scope, node, false));
        return;
      case "RegularElement":
      case "SvelteElement":
      case "SlotElement":
      case "SvelteFragment":
        this.visitFields(node, this.child(scope, node, false));
        return;
      case "Component":
      case "SvelteComponent":
      case "SvelteSelf":
        this.visitComponent(node, scope);
        return;
      case "LetDirective":
        this.visitLet(node, scope);
        return;
      case "EachBlock":
        this.visitEach(node, scope);
        return;
      case "AwaitBlock":
        this.visitAwait(node, scope);
        return;
      case "SnippetBlock": {
        this.scopeIn.set(node.expression, scope);
        const { name } = node.expression;
        this.declare(scope, node.expression, name, "snippet", node, node);
        const inner = this.child(scope, node, false);
        for (const parameter of node.parameters ?? []) {
          this.declarePattern(
            parameter,
            node,
            inner,
            "snippet-param",
            node,
            null,
          );
        }
        this.visit(node.body, node, inner);
        return;
      }
      case "BindDirective":
        if (node.expression.type === "SequenceExpression") break;
        this.visitTarget(node.expression, node, scope, true);
        return;
      case "TransitionDirective":
      case "AnimateDirective":
      case "UseDirective": {
        this.referenceName(
          node.name,
          node.start + prefixLength(node),
          node,
          scope,
        );
        break;
      }
      case "StyleDirective":
        if (node.value === true) {
          this.referenceName(node.name, node.start + 6, node, scope);
        }
        break;
    }
    this.visitFields(node, scope);
  }

  private visitFields(node: AST.SvelteNode, scope: ScopeNode): void {
    const keys = keysByType[node.type];
    if (keys === undefined) throw new Error(`unknown node type: ${node.type}`);
    const fields = fieldsOf(node);
    for (let k = 0; k < keys.length; k++) {
      const value = fields[keys[k]];
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
          const child: unknown = value[i];
          if (isNode(child)) this.visit(child, node, scope);
        }
      } else if (isNode(value)) {
        this.visit(value, node, scope);
      }
    }
  }

  private visitDeclaration(
    node: VariableDeclaration,
    parent: AST.SvelteNode | null,
    scope: ScopeNode,
  ): void {
    let kind: BindingKind = node.kind === "await using" ? "using" : node.kind;
    if (parent?.type === "ConstTag") kind = "const-tag";
    for (const declarator of node.declarations) {
      this.scopeIn.set(declarator, scope);
      this.declarePattern(
        declarator.id,
        declarator,
        scope,
        kind,
        declarator,
        declarator.init ?? null,
      );
      this.declarators.push([declarator, scope]);
      if (declarator.init) this.visit(declarator.init, declarator, scope);
    }
  }

  private visitFunction(node: FunctionNode, scope: ScopeNode): void {
    for (const param of node.params) {
      if (param.type === "Identifier" && param.name === "this") {
        this.scopeIn.set(param, scope);
        continue;
      }
      this.declarePattern(param, node, scope, "param", node, null);
    }
    this.visit(node.body, node, scope);
  }

  private declarePattern(
    pattern: DeclaredPattern,
    parent: AST.SvelteNode,
    scope: ScopeNode,
    kind: BindingKind,
    declaration: AST.SvelteNode,
    initial: AST.SvelteNode | null,
  ): void {
    this.scopeIn.set(pattern, scope);
    switch (pattern.type) {
      case "Identifier":
        this.declare(scope, pattern, pattern.name, kind, declaration, initial);
        break;
      case "ObjectPattern":
        for (const property of pattern.properties) {
          this.scopeIn.set(property, scope);
          if (property.type === "RestElement") {
            this.declarePattern(
              property,
              pattern,
              scope,
              kind,
              declaration,
              initial,
            );
            continue;
          }
          if (property.computed) this.visit(property.key, property, scope);
          else this.scopeIn.set(property.key, scope);
          this.declarePattern(
            property.value,
            property,
            scope,
            kind,
            declaration,
            initial,
          );
        }
        break;
      case "ArrayPattern":
        for (const element of pattern.elements) {
          if (element) {
            this.declarePattern(
              element,
              pattern,
              scope,
              kind,
              declaration,
              initial,
            );
          }
        }
        break;
      case "RestElement":
        this.declarePattern(
          pattern.argument,
          pattern,
          scope,
          kind,
          declaration,
          initial,
        );
        break;
      case "AssignmentPattern":
        this.declarePattern(
          pattern.left,
          pattern,
          scope,
          kind,
          declaration,
          initial,
        );
        this.visit(pattern.right, pattern, scope);
        break;
      case "TSParameterProperty":
        this.declarePattern(
          pattern.parameter,
          pattern,
          scope,
          kind,
          declaration,
          initial,
        );
        break;
      default:
        this.visit(pattern, parent, scope);
        return;
    }
    if ("decorators" in pattern && pattern.decorators) {
      for (const decorator of pattern.decorators) {
        this.visit(decorator, pattern, scope);
      }
    }
  }

  private visitTarget(
    target: AST.SvelteNode,
    parent: AST.SvelteNode,
    scope: ScopeNode,
    reads: boolean,
  ): void {
    this.scopeIn.set(target, scope);
    switch (target.type) {
      case "Identifier":
        this.reference(target, parent, scope, reads, true, false);
        return;
      case "MemberExpression": {
        let object: AST.SvelteNode = target;
        let holder: AST.SvelteNode = parent;
        while (object.type === "MemberExpression") {
          this.scopeIn.set(object, scope);
          if (object.computed) this.visit(object.property, object, scope);
          else this.scopeIn.set(object.property, scope);
          holder = object;
          object = object.object;
        }
        if (object.type === "Identifier") {
          this.scopeIn.set(object, scope);
          this.reference(object, holder, scope, true, false, true);
        } else {
          this.visit(object, holder, scope);
        }
        return;
      }
      case "ObjectPattern":
        for (const property of target.properties) {
          this.scopeIn.set(property, scope);
          if (property.type === "RestElement") {
            this.visitTarget(property, target, scope, false);
            continue;
          }
          if (property.computed) this.visit(property.key, property, scope);
          else this.scopeIn.set(property.key, scope);
          this.visitTarget(property.value, property, scope, false);
        }
        return;
      case "ArrayPattern":
        for (const element of target.elements) {
          if (element) this.visitTarget(element, target, scope, false);
        }
        return;
      case "RestElement":
        this.visitTarget(target.argument, target, scope, false);
        return;
      case "AssignmentPattern":
        this.visitTarget(target.left, target, scope, false);
        this.visit(target.right, target, scope);
        return;
    }
    if (
      target.type === "TSAsExpression" ||
      target.type === "TSSatisfiesExpression" ||
      target.type === "TSNonNullExpression" ||
      target.type === "TSTypeAssertion"
    ) {
      this.visitTarget(target.expression, target, scope, reads);
      return;
    }
    this.visit(target, parent, scope);
  }

  private visitReactive(
    node: Extract<AST.SvelteNode, { type: "LabeledStatement" }>,
    scope: ScopeNode,
  ): void {
    const inner = this.child(scope, node, false);
    this.scopeIn.set(node.label, scope);
    const { body } = node;
    if (
      body.type === "ExpressionStatement" &&
      body.expression.type === "AssignmentExpression"
    ) {
      const { left, right } = body.expression;
      for (const id of extractIdentifiers(left)) {
        if (!id.name.startsWith("$")) this.implicit.push([id, node, right]);
      }
    }
    this.visit(body, node, inner);
  }

  private visitComponent(
    node: AST.Component | AST.SvelteComponent | AST.SvelteSelf,
    scope: ScopeNode,
  ): void {
    if (node.type === "Component") {
      this.referenceName(node.name, node.start + 1, node, scope);
    }
    const slotted = slotOf(node) !== null;
    const defaults = new ScopeNode(node, scope, false);
    const lets = slotted ? scope : defaults;
    this.made.set(node, lets);
    if (node.type === "SvelteComponent") {
      this.visit(node.expression, node, scope);
    }
    for (const attribute of node.attributes) {
      this.visit(
        attribute,
        node,
        attribute.type === "LetDirective" ? lets : scope,
      );
    }
    this.scopeIn.set(node.fragment, defaults);
    for (const child of node.fragment.nodes) {
      const slot = slotOf(child);
      this.visit(
        child,
        node.fragment,
        slot === null ? defaults : this.child(scope, child, false),
      );
    }
  }

  private visitLet(node: AST.LetDirective, scope: ScopeNode): void {
    if (node.expression === null) {
      this.declare(scope, null, node.name, "let-directive", node, null);
      return;
    }
    const declare = (expression: LetExpression | Expression | Pattern) => {
      this.scopeIn.set(expression, scope);
      switch (expression.type) {
        case "Identifier":
          this.declare(
            scope,
            expression,
            expression.name,
            "let-directive",
            node,
            null,
          );
          return;
        case "ObjectExpression":
          for (const property of expression.properties) {
            this.scopeIn.set(property, scope);
            if (property.type === "SpreadElement") {
              declare(property.argument);
            } else {
              this.scopeIn.set(property.key, scope);
              declare(property.value);
            }
          }
          return;
        case "ArrayExpression":
          for (const element of expression.elements) {
            if (element === null) continue;
            if (element.type === "SpreadElement") {
              this.scopeIn.set(element, scope);
              declare(element.argument);
            } else {
              declare(element);
            }
          }
      }
    };
    declare(node.expression);
  }

  private visitEach(node: AST.EachBlock, scope: ScopeNode): void {
    this.visit(node.expression, node, scope);
    if (node.fallback) this.visit(node.fallback, node, scope);
    const inner = this.child(scope, node, false);
    if (node.context) {
      this.declarePattern(node.context, node, inner, "each", node, null);
    }
    if (node.index !== undefined) {
      this.declare(inner, null, node.index, "each-index", node, node);
    }
    if (node.key) this.visit(node.key, node, inner);
    this.scopeIn.set(node.body, inner);
    for (const child of node.body.nodes) this.visit(child, node.body, inner);
  }

  private visitAwait(node: AST.AwaitBlock, scope: ScopeNode): void {
    this.visit(node.expression, node, scope);
    if (node.pending) this.visit(node.pending, node, scope);
    for (const [fragment, pattern, kind] of [
      [node.then, node.value, "await-value"],
      [node.catch, node.error, "await-error"],
    ] as const) {
      if (fragment === null) continue;
      this.visit(fragment, node, scope);
      const inner = this.made.get(fragment);
      if (pattern !== null && inner !== undefined) {
        this.declarePattern(pattern, node, inner, kind, node, null);
      }
    }
  }

  private declareImplicit(): void {
    for (const [id, label, right] of this.implicit) {
      if (this.instance.get(id.name) === null) {
        this.declare(this.instance, id, id.name, "reactive", label, right);
      }
    }
  }

  private resolve(): void {
    const unordered = new Set<BindingNode>();
    for (const reference of this.pending) {
      const { node } = reference;
      const declared = this.declared.get(node);
      if (declared !== undefined && declared.kind !== "reactive") continue;
      this.references.set(node, reference);
      let binding = reference.scope.get(node.name);
      if (binding === null && this.component) {
        const store = this.storeOf(node.name);
        if (store !== false) {
          reference.store = true;
          reference.mutates ||= reference.writes;
          reference.reads = true;
          reference.writes = false;
          binding = store;
        }
      }
      if (binding !== null) {
        reference.binding = binding;
        const last = binding.references.at(-1);
        if (last !== undefined && last.node.start > node.start) {
          unordered.add(binding);
        }
        binding.references.push(reference);
      }
    }
    for (const binding of unordered) {
      binding.references.sort((a, b) => a.node.start - b.node.start);
    }
  }

  private storeOf(name: string): BindingNode | null | false {
    const cached = this.stores.get(name);
    if (cached !== undefined) return cached;
    let store: BindingNode | null | false = false;
    if (name.length > 1 && name.startsWith("$") && !name.startsWith("$$")) {
      const declaration = this.instance.get(name.slice(1));
      if (!RUNE_NAMES.has(name)) {
        store = declaration;
      } else if (declaration !== null) {
        const initial = declaration.initial;
        const rune = runeOf(initial, this.instance, null);
        if (
          (rune === null || (name !== "$props" && rune === "$props")) &&
          !(
            name === "$derived" &&
            initial?.type === "ImportDeclaration" &&
            initial.source.value === "svelte/store"
          )
        ) {
          store = declaration;
        }
      }
    }
    this.stores.set(name, store);
    return store;
  }

  private findRunesAndProps(): void {
    for (const [declarator, scope] of this.declarators) {
      const rune = runeOf(declarator.init ?? null, scope, this.references);
      if (rune === null) continue;
      for (const id of extractIdentifiers(declarator.id)) {
        const binding = this.declared.get(id);
        if (binding?.declaration === declarator) binding.rune = rune;
      }
      if (rune !== "$props") continue;
      if (declarator.id.type === "Identifier") {
        const binding = this.declared.get(declarator.id);
        if (binding) binding.initial = null;
        continue;
      }
      if (declarator.id.type !== "ObjectPattern") continue;
      for (const property of declarator.id.properties) {
        if (property.type === "RestElement") {
          for (const id of extractIdentifiers(property)) {
            const binding = this.declared.get(id);
            if (binding) binding.initial = null;
          }
          continue;
        }
        const value =
          property.value.type === "AssignmentPattern"
            ? property.value.left
            : property.value;
        const binding =
          value.type === "Identifier" ? this.declared.get(value) : undefined;
        if (binding === undefined || property.computed) continue;
        binding.prop = keyName(property.key);
        binding.initial =
          property.value.type === "AssignmentPattern"
            ? unwrapBindable(property.value.right)
            : null;
      }
    }
    this.findLegacyProps();
  }

  private findLegacyProps(): void {
    if (this.instanceProgram === null) return;
    for (const statement of this.instanceProgram.body) {
      if (statement.type !== "ExportNamedDeclaration") continue;
      const { declaration } = statement;
      if (declaration?.type === "VariableDeclaration") {
        if (declaration.kind !== "let" && declaration.kind !== "var") continue;
        for (const declarator of declaration.declarations) {
          for (const id of extractIdentifiers(declarator.id)) {
            const binding = this.declared.get(id);
            if (binding) binding.prop = id.name;
          }
        }
        continue;
      }
      if (statement.source) continue;
      for (const specifier of statement.specifiers) {
        if (specifier.local.type !== "Identifier") continue;
        const binding = this.instance.declarations.get(specifier.local.name);
        if (binding?.kind !== "let" && binding?.kind !== "var") continue;
        binding.prop =
          specifier.exported.type === "Identifier"
            ? specifier.exported.name
            : String(specifier.exported.value);
      }
    }
  }
}

function isFunction(node: AST.SvelteNode): node is FunctionNode {
  return (
    node.type === "ArrowFunctionExpression" ||
    node.type === "FunctionExpression" ||
    node.type === "FunctionDeclaration"
  );
}

function slotOf(node: AST.SvelteNode): string | null {
  if (!ELEMENTS.has(node.type) || !("attributes" in node)) return null;
  for (const attribute of node.attributes ?? []) {
    if (
      attribute.type === "Attribute" &&
      attribute.name === "slot" &&
      Array.isArray(attribute.value) &&
      attribute.value.length === 1 &&
      attribute.value[0].type === "Text"
    ) {
      return attribute.value[0].data;
    }
  }
  return null;
}

function runeOf(
  initial: AST.SvelteNode | null,
  scope: ScopeNode,
  references: ReadonlyMap<Identifier, ReferenceNode> | null,
): string | null {
  if (initial?.type !== "CallExpression") return null;
  let node: AST.SvelteNode = initial.callee;
  let keypath = "";
  while (node.type === "MemberExpression") {
    if (node.computed || node.property.type !== "Identifier") return null;
    keypath = `.${node.property.name}${keypath}`;
    node = node.object;
  }
  if (node.type === "CallExpression" && node.callee.type === "Identifier") {
    keypath = `()${keypath}`;
    node = node.callee;
  }
  if (node.type !== "Identifier") return null;
  if (references !== null) {
    const reference = references.get(node);
    if (reference?.binding !== null || reference.store) return null;
  } else if (scope.get(node.name) !== null) {
    return null;
  }
  keypath = node.name + keypath;
  return RUNES.has(keypath) ? keypath : null;
}

function unwrapBindable(node: Expression): Expression | null {
  if (
    node.type === "CallExpression" &&
    node.callee.type === "Identifier" &&
    node.callee.name === "$bindable"
  ) {
    const [argument] = node.arguments;
    return argument === undefined || argument.type === "SpreadElement"
      ? null
      : argument;
  }
  return node;
}

function prefixLength(
  node: AST.TransitionDirective | AST.AnimateDirective | AST.UseDirective,
): number {
  if (node.type === "UseDirective") return "use:".length;
  if (node.type === "AnimateDirective") return "animate:".length;
  if (node.intro && node.outro) return "transition:".length;
  return node.intro ? "in:".length : "out:".length;
}

function keyName(key: AST.SvelteNode): string | null {
  if (key.type === "Identifier") return key.name;
  return key.type === "Literal" ? String(key.value) : null;
}
