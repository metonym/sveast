# Examples

Runnable versions of the README's recipes. Each file exports its functions and, run directly, is a CLI over the files you pass it. `tests/examples.test.ts` runs both.

```sh
bun examples/components-used.ts src/**/*.svelte   # JSON: each file's components and where they're imported from
bun examples/unused-classes.ts src/**/*.svelte    # file:line .class, for each class the styles declare but the markup never uses
bun examples/props.ts src/**/*.svelte             # Button.svelte: size = "md", aria-label, ...rest
bun examples/check-syntax.ts src/**/*.svelte      # file:line:column code: reason, with svelte's frame; exits 1 on any error
bun examples/extract-styles.ts src/**/*.svelte    # each <style>, with its file, line and lang
```

`check-syntax.ts` also reads `.ts` and `.js` modules. As a pre-commit check:

```sh
git diff --cached --name-only --diff-filter=ACM -- '*.svelte' '*.ts' '*.js' | xargs bun examples/check-syntax.ts
```

They import `sveast`, which resolves to `src/` through `tsconfig.json` here; in your project, install `sveast` and copy the file.
