import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "@playwright/test";

const bundle = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: "tsx",
    contents: `
      import { createRoot } from 'react-dom/client';
      import EmailConfirmPage from './src/app/(store)/email/confirm/page';
      import PrivacyPage from './src/app/(store)/legal/privacy/page';
      import RefundsPage from './src/app/(store)/legal/refunds/page';
      import TermsPage from './src/app/(store)/legal/terms/page';
      import NotFound from './src/app/(store)/not-found';

      const email = await EmailConfirmPage({ searchParams: Promise.resolve({ status: 'success' }) });
      createRoot(document.getElementById('root')).render(
        <>
          <section data-testid="email-confirm">{email}</section>
          <section data-testid="privacy"><PrivacyPage /></section>
          <section data-testid="refunds"><RefundsPage /></section>
          <section data-testid="terms"><TermsPage /></section>
          <section data-testid="not-found"><NotFound /></section>
        </>
      );
    `,
  },
  bundle: true,
  write: false,
  platform: "browser",
  format: "esm",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' },
  plugins: [
    {
      name: "storefront-branding-boundaries",
      setup(builder) {
        builder.onResolve({ filter: /^next\/link$/ }, () => ({
          path: "next/link",
          namespace: "test",
        }));
        builder.onLoad({ filter: /.*/, namespace: "test" }, () => ({
          loader: "js",
          resolveDir: process.cwd(),
          contents: `
            import React from 'react';
            export default ({ children, href, ...props }) =>
              React.createElement('a', { href, ...props }, children);
          `,
        }));
      },
    },
  ],
});

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ type: "module", content: bundle.outputFiles[0].text });

  const email = page.getByTestId("email-confirm");
  await email.getByRole("heading", { name: "Subscription confirmed" }).waitFor();
  assert.match(
    await email
      .getByRole("heading", { name: "Subscription confirmed" })
      .getAttribute("class"),
    /text-zinc-900/,
  );
  assert.doesNotMatch(
    await email.getByRole("link", { name: "Back to home" }).getAttribute("class"),
    /bg-red/,
  );

  for (const pageName of ["privacy", "refunds", "terms"]) {
    const policy = page.getByTestId(pageName);
    assert.match(await policy.innerText(), /Winston-Salem, NC/);
    assert.doesNotMatch(await policy.innerText(), /Simpsonville|South Carolina/);
  }

  const notFound = page.getByTestId("not-found");
  assert.match(await notFound.innerText(), /Solesneakers/);
  assert.doesNotMatch(
    await notFound.locator("div").first().getAttribute("class"),
    /bg-black/,
  );

  console.log("PASS: storefront customer states use current branding and location");
} finally {
  await browser.close();
}
