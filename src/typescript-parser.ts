import { declarations, tweaks } from "./acorn-bridge";
import { extendParser } from "./acorn-internals";
import { tsPlugin } from "./ts-plugin";

export const TypeScriptParser = /* @__PURE__ */ extendParser(
  declarations,
  tsPlugin,
  tweaks,
);
