import {
  type AST,
  markupVisitorKeys,
  parse,
  parseModule,
  SKIP,
  STOP,
  visitorKeys,
  walk,
} from "sveast";
import { byCodeUnit, isRecord } from "../scripts/shared";
import { corpusAsts } from "./shared";

const COMMENTS = new Set(["comments", "leadingComments", "trailingComments"]);
const UNORDERED = new Set([
  "Root",
  "TemplateLiteral",
  "SvelteElement",
  "SvelteComponent",
]);

const ASTS = corpusAsts();

function unreached(root: AST.SvelteNode, reached: Set<object>): string[] {
  const found: string[] = [];
  const visit = (value: unknown, owner: string) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item, owner);
      return;
    }
    if (!isRecord(value)) return;
    const type = typeof value.type === "string" ? value.type : undefined;
    if (type && !reached.has(value)) {
      found.push(owner);
      return;
    }
    for (const key in value) {
      if (COMMENTS.has(key) || (type === "Root" && key === "options")) {
        continue;
      }
      visit(value[key], type ? `${type}.${key}` : `${owner}.${key}`);
    }
  };
  visit(root, "(root)");
  return found;
}

function position(node: AST.SvelteNode): number | undefined {
  if (node.type === "Fragment") return node.nodes[0]?.start;
  return "start" in node ? node.start : undefined;
}

const SHARED = new Set(["ImportSpecifier.local", "ExportSpecifier.exported"]);

test("walk reaches every node in the corpus once", () => {
  const found = new Set<string>();
  for (const ast of ASTS) {
    const reached = new Set<object>();
    walk(ast, {
      enter(node, parent, key) {
        const at = `${parent?.type}.${key}`;
        if (reached.has(node) && !SHARED.has(at)) {
          found.add(`${at}: visited twice`);
        }
        reached.add(node);
      },
    });
    for (const owner of unreached(ast, reached)) found.add(owner);
  }
  expect([...found].sort(byCodeUnit)).toEqual([]);
});

test("walk visits each node's children in source order", () => {
  const found = new Set<string>();
  for (const ast of ASTS) {
    const last = new Map<AST.SvelteNode, { at: number; key: string }>();
    walk(ast, {
      enter(node, parent, key) {
        if (!parent || !key || UNORDERED.has(parent.type)) return;
        const at = position(node);
        if (at === undefined) return;
        const previous = last.get(parent);
        if (previous && at < previous.at) {
          found.add(`${parent.type}.${key} before ${previous.key}`);
        }
        last.set(parent, { at, key });
      },
    });
  }
  expect([...found].sort(byCodeUnit)).toEqual([]);
});

test("parent, key and index locate the node", () => {
  const found = new Set<string>();
  const roots: unknown[] = [];
  for (const ast of ASTS) {
    walk(ast, {
      enter(node, parent, key, index) {
        if (parent === null || key === null) {
          roots.push([node, parent, key, index]);
          return;
        }
        const field: unknown = Reflect.get(parent, key);
        const held =
          index === null ? field : Array.isArray(field) && field[index];
        if (held !== node) found.add(`${parent.type}.${key}`);
      },
    });
  }
  expect([...found].sort(byCodeUnit)).toEqual([]);
  expect(roots).toEqual(ASTS.map((ast) => [ast, null, null, null]));
});

const MARKUP_TYPES = new Set(Object.keys(markupVisitorKeys));

test("markupVisitorKeys visits the markup nodes the full walk reaches outside scripts, styles and expressions", () => {
  let components = 0;
  let mismatched = 0;
  for (const ast of ASTS) {
    if (ast.type !== "Root") continue;
    components++;
    const expected: AST.SvelteNode[] = [];
    let outside = 0;
    walk(ast, {
      enter(node, parent) {
        const markup =
          MARKUP_TYPES.has(node.type) &&
          (parent?.type !== "Root" || node.type === "Fragment");
        if (!markup) outside++;
        else if (outside === 0) expected.push(node);
      },
      leave(node, parent) {
        const markup =
          MARKUP_TYPES.has(node.type) &&
          (parent?.type !== "Root" || node.type === "Fragment");
        if (!markup) outside--;
      },
    });
    const reached: AST.SvelteNode[] = [];
    walk(
      ast,
      {
        enter(node) {
          reached.push(node);
        },
      },
      markupVisitorKeys,
    );
    const same =
      reached.length === expected.length &&
      reached.every((node, i) => node === expected[i]);
    if (!same) mismatched++;
  }
  expect(mismatched).toBe(0);
  expect(components).toBeGreaterThan(300);
});

test("walk throws on a node its keys have no entry for", () => {
  const ast = parse("<script>let a;</script>");
  expect(() =>
    walk(ast.instance?.content ?? ast, {}, markupVisitorKeys),
  ).toThrow("unknown node type: Program");
});

test("enter returning SKIP skips the children, and leave still runs", () => {
  const ast = parse("<div><p>{a}</p></div><span></span>");
  const events: string[] = [];
  walk(ast.fragment, {
    enter(node) {
      events.push(`enter ${node.type}`);
      if (node.type === "RegularElement" && node.name === "p") return SKIP;
    },
    leave(node) {
      events.push(`leave ${node.type}`);
    },
  });
  expect(events).toEqual([
    "enter Fragment",
    "enter RegularElement",
    "enter Fragment",
    "enter RegularElement",
    "leave RegularElement",
    "leave Fragment",
    "leave RegularElement",
    "enter RegularElement",
    "enter Fragment",
    "leave Fragment",
    "leave RegularElement",
    "leave Fragment",
  ]);
});

test("enter returning false or another value visits the children", () => {
  const names = new Set<string>();
  walk(parse("<div><A /><p><B.C>{d}</B.C></p></div>"), {
    enter: (node) => node.type === "Component" && names.add(node.name),
  });
  expect([...names]).toEqual(["A", "B.C"]);
});

function walkEvents(
  source: string,
  stopAt: (event: string) => boolean,
): string[] {
  const seen: string[] = [];
  const record = (event: string) => {
    seen.push(event);
    return stopAt(event) ? STOP : undefined;
  };
  walk(parse(source).fragment, {
    enter: (node) => record(`enter ${node.type}`),
    leave: (node) => record(`leave ${node.type}`),
  });
  return seen;
}

test("enter returning STOP ends the walk", () => {
  expect(
    walkEvents("<div><p>{a}{b}</p><i></i></div><span></span>", (event) =>
      event.endsWith("Identifier"),
    ),
  ).toEqual([
    "enter Fragment",
    "enter RegularElement",
    "enter Fragment",
    "enter RegularElement",
    "enter Fragment",
    "enter ExpressionTag",
    "enter Identifier",
  ]);
});

test("leave returning STOP ends the walk", () => {
  expect(
    walkEvents(
      "<div><p>{a}</p><i></i></div><span></span>",
      (event) => event === "leave ExpressionTag",
    ),
  ).toEqual([
    "enter Fragment",
    "enter RegularElement",
    "enter Fragment",
    "enter RegularElement",
    "enter Fragment",
    "enter ExpressionTag",
    "enter Identifier",
    "leave Identifier",
    "leave ExpressionTag",
  ]);
});

test("STOP from the node walk was called with skips everything else", () => {
  expect(walkEvents("<p></p>", (event) => event === "enter Fragment")).toEqual([
    "enter Fragment",
  ]);
});

const CASTS = new Set([
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "TSTypeAssertion",
]);

test("enter returning a node replaces this one and walks it instead", () => {
  const program = parseModule("f(<A>a!, (b as B) satisfies C);", {
    typescript: true,
  });
  const events: string[] = [];
  walk(program, {
    enter(node, parent, key, index) {
      events.push(`enter ${node.type} ${parent?.type}.${key}[${index}]`);
      if (CASTS.has(node.type) && "expression" in node) return node.expression;
    },
    leave(node) {
      events.push(`leave ${node.type}`);
    },
  });
  expect(events).toEqual([
    "enter Program undefined.null[null]",
    "enter ExpressionStatement Program.body[0]",
    "enter CallExpression ExpressionStatement.expression[null]",
    "enter Identifier CallExpression.callee[null]",
    "leave Identifier",
    "enter TSTypeAssertion CallExpression.arguments[0]",
    "enter TSNonNullExpression CallExpression.arguments[0]",
    "enter Identifier CallExpression.arguments[0]",
    "leave Identifier",
    "enter TSSatisfiesExpression CallExpression.arguments[1]",
    "enter TSAsExpression CallExpression.arguments[1]",
    "enter Identifier CallExpression.arguments[1]",
    "leave Identifier",
    "leave CallExpression",
    "leave ExpressionStatement",
    "leave Program",
  ]);
  const statement = program.body[0];
  if (
    statement?.type !== "ExpressionStatement" ||
    statement.expression.type !== "CallExpression"
  ) {
    throw new Error("expected a call");
  }
  expect(statement.expression.arguments.map((node) => node.type)).toEqual([
    "Identifier",
    "Identifier",
  ]);
});

test("enter replaces a node held in a field, not an array", () => {
  const ast = parse('<script lang="ts">let a = b as C;</script>');
  const names: string[] = [];
  walk(ast, {
    enter(node) {
      if (node.type === "TSAsExpression") return node.expression;
      if (node.type === "Identifier") names.push(node.name);
    },
  });
  const declaration = ast.instance?.content.body[0];
  if (declaration?.type !== "VariableDeclaration") {
    throw new Error("expected a declaration");
  }
  expect(declaration.declarations[0]?.init?.type).toBe("Identifier");
  expect(names).toEqual(["a", "b"]);
});

test("walk throws when enter replaces the node it was called with", () => {
  const program = parseModule("a;");
  expect(() =>
    walk(program, {
      enter: (node) => (node.type === "Program" ? program.body[0] : undefined),
    }),
  ).toThrow("walk can't replace the node it was called with");
});

test("walk visits a component's sections in scope order", () => {
  const ast = parse(
    "<style>p{}</style><p>{a}</p><script>let a;</script><script module>export const b = 1;</script>",
  );
  const sections: string[] = [];
  walk(ast, {
    enter(node, parent, key) {
      if (parent?.type === "Root" && key) sections.push(`${key} ${node.type}`);
    },
  });
  expect(sections).toEqual([
    "module Script",
    "instance Script",
    "fragment Fragment",
    "css StyleSheet",
  ]);
});

test("walk throws on a node type it doesn't know", () => {
  const node: AST.SvelteNode = JSON.parse('{"type":"Unknown"}');
  expect(() => walk(node, {})).toThrow("unknown node type: Unknown");
});

test("visitorKeys lists the fields that hold children", () => {
  expect(visitorKeys.IfBlock).toEqual(["test", "consequent", "alternate"]);
  expect(visitorKeys.Text).toEqual([]);
});
