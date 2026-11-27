import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "@playwright/test";
import { createServer } from "node:http";

// Real verification UI, with Next's boundary modeling a previously cached route.
// Document navigations receive a fresh server lock response; no accounts are made.
const bundle = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: "tsx",
    contents: `import {createRoot} from 'react-dom/client';
      import {VerifyEmailForm} from './src/components/auth/login/VerifyEmailForm';
      import {PasswordLoginForm} from './src/components/auth/login/PasswordLoginForm';
      import {OtpLoginForm} from './src/components/auth/login/OtpLoginForm';
      import {RegisterForm} from './src/components/auth/register/RegisterForm';
      const forms={verify:<VerifyEmailForm email="customer@example.com" flow="signup"/>,password:<PasswordLoginForm onRequiresEmailVerification={()=>{}} onSwitchToOtp={()=>{}} onForgotPassword={()=>{}}/>,otp:<OtpLoginForm onRequiresEmailVerification={()=>{}}/>,register:<RegisterForm/>};
      createRoot(document.getElementById('root')).render(forms[location.pathname.split('/').pop()]);`,
  },
  bundle: true,
  write: false,
  platform: "browser",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' },
  plugins: [
    {
      name: "next-cache-boundary",
      setup(builder) {
        builder.onResolve({ filter: /^next\/(navigation|link)$/ }, (args) => ({
          path: args.path,
          namespace: "fixture",
        }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
          loader: "js",
          resolveDir: process.cwd(),
          contents:
            args.path === "next/navigation"
              ? `export const useSearchParams=()=>new URLSearchParams();export const useRouter=()=>({push(path){history.pushState({},'',path);document.body.innerHTML='<h1>Cached unlocked storefront</h1>';}});`
              : `import React from 'react';export default ({href,children,...props})=>React.createElement('a',{href,...props},children);`,
        }));
      },
    },
  ],
});
let freshStoreRequests = 0;
let locked = true;
let staffMfa = false;
const server = createServer((request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  request.resume();
  if (pathname === "/api/auth/register") {
    response.writeHead(locked ? 423 : 200, { "Content-Type": "application/json" });
    return response.end(
      JSON.stringify({ ok: !locked, error: locked ? "Storefront is locked" : undefined }),
    );
  }
  if (pathname.startsWith("/api/auth/")) {
    response.writeHead(200, { "Content-Type": "application/json" });
    return response.end(
      JSON.stringify({
        ok: true,
        nextPath: "/",
        isAdmin: staffMfa,
        requiresTwoFASetup: staffMfa,
      }),
    );
  }
  if (pathname === "/") {
    freshStoreRequests++;
    if (locked) {
      response.writeHead(307, { Location: "/locked" });
      return response.end();
    }
    response.writeHead(200, { "Content-Type": "text/html" });
    return response.end("<h1>Storefront open</h1>");
  }
  response.writeHead(200, { "Content-Type": "text/html" });
  response.end(
    pathname === "/locked"
      ? "<h1>Storefront temporarily closed.</h1>"
      : pathname === "/auth/2fa/setup"
        ? "<h1>Staff MFA setup</h1>"
        : pathname === "/auth/login"
          ? "<h1>Verify your account</h1>"
          : '<div id="root"></div>',
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
try {
  for (const sample of [
    { flow: "verify", locked: true },
    { flow: "password", locked: true },
    { flow: "otp", locked: true },
    { flow: "register", locked: true },
    { flow: "verify", locked: false },
    { flow: "password", locked: false },
    { flow: "register", locked: false },
    { flow: "password", locked: true, staff: true },
  ]) {
    locked = sample.locked;
    staffMfa = Boolean(sample.staff);
    freshStoreRequests = 0;
    const page = await browser.newPage();
    page.setDefaultTimeout(8000);
    await page.goto(`${origin}/form/${sample.flow}`);
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    if (sample.flow === "register") {
      await page.locator('input[name="email"]').fill("customer@example.com");
      await page.locator('input[name="password"]').fill("SecurePassword123!");
      await page.locator('input[name="confirmPassword"]').fill("SecurePassword123!");
      await page.getByRole("button", { name: "Sign up", exact: true }).click();
    } else if (sample.flow === "password") {
      await page.getByTestId("login-email").fill("customer@example.com");
      await page.getByTestId("login-password").fill("SecurePassword123!");
      await page.getByTestId("login-submit").click();
    } else {
      if (sample.flow === "otp") {
        await page.locator('input[type="email"]').fill("customer@example.com");
        await page.getByRole("button", { name: "Send code", exact: true }).click();
      }
      await page.getByLabel("Verification code", { exact: true }).fill("123456");
      await page
        .getByRole("button", {
          name: sample.flow === "otp" ? "Sign in" : "Verify & continue",
          exact: true,
        })
        .click();
    }
    const signupVerification = sample.flow === "register" && !sample.locked;
    const heading = sample.staff
      ? "Staff MFA setup"
      : signupVerification
        ? "Verify your account"
        : sample.locked
          ? "Storefront temporarily closed."
          : "Storefront open";
    await page.getByRole("heading", { name: heading, exact: true }).waitFor();
    assert.equal(
      new URL(page.url()).pathname,
      sample.staff
        ? "/auth/2fa/setup"
        : signupVerification
          ? "/auth/login"
          : sample.locked
            ? "/locked"
            : "/",
    );
    assert.equal(
      freshStoreRequests,
      sample.flow === "register" || sample.staff ? 0 : 1,
      "auth must re-enter the server gate instead of using cached UI",
    );
    await page.close();
  }
  console.log(
    "PASS: verification, password/OTP login and a previously opened signup form respect the lock without manual refresh; open-store and staff MFA navigation are preserved",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
