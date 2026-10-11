import type { AST, Identifier } from "../src/index";
import { parse, walk } from "../src/index";
import { analyzeScopes, type Binding, type Scopes } from "../src/scope";
import { attempt } from "./shared";

const COMPILER = "../node_modules/svelte/src/compiler";

interface SvelteIdentifier {
  name: string;
  start?: number;
}

interface SvelteBinding {
  node: SvelteIdentifier;
  references: { node: SvelteIdentifier }[];
}

interface SvelteScope {
  declarations: Map<string, SvelteBinding>;
  references: Map<string, { node: SvelteIdentifier }[]>;
}

interface SvelteRoot {
  metadata: { ts: boolean };
  fragment: object;
  instance?: { content: object };
  module?: { content: object };
}

interface SvelteInternals {
  parse(source: string): SvelteRoot;
  remove_typescript_nodes<T>(node: T): T;
  create_scopes(
    ast: object,
    root: object,
    reactive: boolean,
    parent: SvelteScope | null,
  ): { scope: SvelteScope; scopes: Map<object, SvelteScope> };
  ScopeRoot: new () => object;
  reset(options: object): void;
}

const svelte = Object.assign(
  {},
  ...(await Promise.all(
    [
      "phases/1-parse/index.js",
      "phases/1-parse/remove_typescript_nodes.js",
      "phases/scope.js",
      "state.js",
    ].map((path): Promise<object> => import(`${COMPILER}/${path}`)),
  )),
) as SvelteInternals;

/** Each name svelte's analyzer resolves, by `start`: its binding's `start`, or `null`. */
function svelteResolutions(source: string): Map<string, number | null> {
  svelte.reset({ warning: () => false, filename: "Component.svelte" });
  let parsed = svelte.parse(source);
  if (parsed.metadata.ts) {
    parsed = {
      ...parsed,
      fragment: svelte.remove_typescript_nodes(parsed.fragment),
      instance:
        parsed.instance && svelte.remove_typescript_nodes(parsed.instance),
      module: parsed.module && svelte.remove_typescript_nodes(parsed.module),
    };
  }
  const root = new svelte.ScopeRoot();
  const empty = { type: "Program", start: -1, end: -1, body: [] };
  const module = svelte.create_scopes(
    parsed.module?.content ?? empty,
    root,
    false,
    null,
  );
  const instance = svelte.create_scopes(
    parsed.instance?.content ?? empty,
    root,
    true,
    module.scope,
  );
  const template = svelte.create_scopes(
    parsed.fragment,
    root,
    false,
    instance.scope,
  );
  const scopes = new Set([module.scope, instance.scope, template.scope]);
  for (const { scopes: map } of [module, instance, template]) {
    for (const scope of map.values()) scopes.add(scope);
  }
  const findSlotScopes = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) findSlotScopes(item);
    } else if (typeof value === "object" && value !== null) {
      const node = value as Record<string, unknown>;
      const metadata = node.metadata as
        | { scopes?: Record<string, SvelteScope> }
        | undefined;
      for (const scope of Object.values(metadata?.scopes ?? {})) {
        scopes.add(scope);
      }
      for (const key in node) if (key !== "metadata") findSlotScopes(node[key]);
    }
  };
  findSlotScopes(parsed.fragment);

  const resolved = new Map<string, number | null>();
  for (const scope of scopes) {
    for (const binding of scope.declarations.values()) {
      for (const { node } of binding.references) {
        if (node.start === undefined) continue;
        resolved.set(`${node.name}@${node.start}`, binding.node.start ?? -1);
      }
    }
  }
  for (const [name, references] of module.scope.references) {
    if (module.scope.declarations.has(name)) continue;
    for (const { node } of references) {
      if (node.start !== undefined) resolved.set(`${name}@${node.start}`, null);
    }
  }
  return resolved;
}

function startOf(binding: Binding | null): number | null {
  if (binding === null) return null;
  if (binding.node) return binding.node.start;
  const { declaration } = binding;
  return declaration.type === "LetDirective" ? declaration.start : -1;
}

function identifiers(ast: AST.SvelteNode): Map<string, Identifier[]> {
  const found = new Map<string, Identifier[]>();
  walk(ast, {
    enter(node) {
      if (node.type !== "Identifier") return;
      const key = `${node.name}@${node.start}`;
      const list = found.get(key);
      if (list) list.push(node);
      else found.set(key, [node]);
    },
  });
  return found;
}

function bindingAt(
  scopes: Scopes,
  nodes: Identifier[] | undefined,
): Binding | null {
  for (const node of nodes ?? []) {
    const binding = scopes.bindingOf(node);
    if (binding !== null) return binding;
  }
  return null;
}

/**
 * Where svelte's analyzer differs and sveast is right: a class
 * expression's name inside its body, a snippet's name (svelte looks it up
 * among the snippet's parameters) and `var` declared twice (svelte keeps
 * the second; both are the same variable).
 */
function knownDifference(
  binding: Binding | null,
  expected: number | null,
): boolean {
  if (binding === null) return false;
  if (
    binding.kind === "class" &&
    binding.declaration.type === "ClassExpression"
  ) {
    return expected === null;
  }
  if (binding.kind === "snippet" && expected !== null) return true;
  return binding.kind === "var" && expected !== null;
}

export interface ScopeComparison {
  /** Names both resolved. */
  compared: number;
  /** `$name` subscriptions, which svelte's analyzer leaves to a later step. */
  stores: number;
  mismatches: string[];
}

/**
 * `analyzeScopes` against svelte's `create_scopes` on one component, by
 * each name's `start`; `undefined` if either parser rejects it.
 */
export function compareScopes(source: string): ScopeComparison | undefined {
  const ast = attempt(() => parse(source));
  const expected = attempt(() => svelteResolutions(source));
  if (!ast || !expected) return undefined;
  const scopes = analyzeScopes(ast);
  const ours = identifiers(ast);
  const result: ScopeComparison = { compared: 0, stores: 0, mismatches: [] };
  for (const [key, start] of expected) {
    if (!ours.has(key)) continue;
    result.compared++;
    const binding = bindingAt(scopes, ours.get(key));
    let found = startOf(binding);
    if (
      start === null &&
      binding !== null &&
      key.startsWith(`$${binding.name}@`) &&
      binding.references.some((reference) => reference.store)
    ) {
      result.stores++;
      found = null;
    }
    if (found !== start && !knownDifference(binding, start)) {
      result.mismatches.push(`${key}: svelte ${start}, sveast ${found}`);
    }
  }
  for (const [key, nodes] of ours) {
    const binding = bindingAt(scopes, nodes);
    if (
      binding?.node &&
      expected.has(`${binding.name}@${binding.node.start}`) &&
      binding.references.some((reference) => nodes.includes(reference.node)) &&
      !expected.has(key)
    ) {
      result.mismatches.push(`${key}: only sveast finds it`);
    }
  }
  return result;
}
