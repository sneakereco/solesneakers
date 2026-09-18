import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "@playwright/test";

const bundle = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: "tsx",
    contents: `
      import { createRoot } from 'react-dom/client';
      import PrivacyPage from './src/app/(store)/legal/privacy/page';
      import RefundsPage from './src/app/(store)/legal/refunds/page';
      import TermsPage from './src/app/(store)/legal/terms/page';
      import NotFound from './src/app/(store)/not-found';
      import ContactPage from './src/app/(store)/contact/page';
      import { Footer } from './src/components/shell/Footer';

      createRoot(document.getElementById('root')).render(
        <>
          <section data-testid="privacy"><PrivacyPage /></section>
          <section data-testid="refunds"><RefundsPage /></section>
          <section data-testid="terms"><TermsPage /></section>
          <section data-testid="not-found"><NotFound /></section>
          <section data-testid="contact"><ContactPage /></section>
          <Footer />
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
  let contactPayload;
  await page.route("https://example.com/**", async (route) => {
    if (route.request().url().endsWith("/api/contact")) {
      assert.match(route.request().headers()["content-type"], /application\/json/);
      contactPayload = route.request().postDataJSON();
      await route.fulfill({ json: { ok: true } });
    } else {
      await route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' });
    }
  });
  await page.goto("https://example.com");
  await page.addScriptTag({ type: "module", content: bundle.outputFiles[0].text });

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

  const footer = page.locator("footer");
  assert.equal(await footer.locator('a[href="/shipping"]').count(), 1);
  assert.equal(await page.locator('a[href="/bug-report"]').count(), 0);
  const contact = page.getByTestId("contact");
  assert.equal(await contact.locator('input[type="file"]').count(), 0);
  await contact.getByLabel("Name", { exact: true }).fill("Test Customer");
  await contact.getByLabel("Email", { exact: true }).fill("customer@example.com");
  await contact.getByLabel("Message", { exact: true }).fill("Question about my order");
  await contact.getByRole("button", { name: "Send Message" }).click();
  await contact
    .getByText("Thank you for your message! We'll get back to you soon.")
    .waitFor();
  assert.deepEqual(contactPayload, {
    name: "Test Customer",
    email: "customer@example.com",
    message: "Question about my order",
    subject: "Website contact form",
  });
  assert.equal(await contact.getByLabel("Message", { exact: true }).inputValue(), "");

  console.log("PASS: storefront customer states use current branding and location");
} finally {
  await browser.close();
}
