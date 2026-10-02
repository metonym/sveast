import { parseProgram } from "./acorn-bridge";
import type { ParserConstructor } from "./acorn-internals";
import { setSource } from "./locator";
import type { ParseModuleOptions } from "./options";
import type { Program } from "./types/estree";

export function parseModuleWith(
  source: string,
  options: ParseModuleOptions,
  typescript: ParserConstructor | undefined,
): Program {
  setSource(source);
  return parseProgram(
    {
      isTypeScript: options.typescript ?? false,
      typescript,
      loc: options.loc ?? false,
      comments: options.comments ?? true,
      root: { comments: [] },
    },
    source,
  );
}
