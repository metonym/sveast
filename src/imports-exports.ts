import { parseStatementsAt } from "./acorn-bridge";
import type { ParserConstructor } from "./acorn-internals";
import { setSource } from "./locator";
import type { ParseImportsExportsOptions } from "./options";
import { scan } from "./scan";
import type { ModuleDeclaration } from "./types/estree";

export function parseImportsExportsWith(
  source: string,
  options: ParseImportsExportsOptions,
  typescript: ParserConstructor | undefined,
): ModuleDeclaration[] {
  setSource(source);
  const context = {
    isTypeScript: options.typescript ?? false,
    typescript,
    loc: false,
    comments: false,
    root: { comments: [] },
  };
  return parseStatementsAt(context, source, (parseAt) =>
    scan(source, options.localExports ?? true, parseAt),
  ) as ModuleDeclaration[];
}
