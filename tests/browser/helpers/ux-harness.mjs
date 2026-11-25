import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "tailwindcss";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const siteCss = fileURLToPath(new URL("../../../src/styles/site.css", import.meta.url));

export async function compileUxHarness(entry, { plugins = [] } = {}) {
  const css = await readFile(siteCss, "utf8");
  const [bundle, stylesheet] = await Promise.all([
    build({
      stdin: { resolveDir: root, loader: "tsx", contents: entry },
      bundle: true,
      write: false,
      platform: "browser",
      jsx: "automatic",
      define: { "process.env.NODE_ENV": '"development"' },
      plugins,
    }),
    postcss([
      tailwindcss({ content: [{ raw: entry, extension: "tsx" }, "./src/**/*.{ts,tsx}"] }),
    ]).process(css, { from: siteCss }),
  ]);

  return { script: bundle.outputFiles[0].text, css: stylesheet.css };
}

export async function openUxHarness(page, bundle, url = "https://ux.test/") {
  await page.route(url, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div></body></html>',
    }),
  );
  await page.goto(url);
  await page.addStyleTag({ content: bundle.css });
  await page.addScriptTag({ content: bundle.script });
}
