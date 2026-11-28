import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import { chromium } from "@playwright/test";
import { build } from "esbuild";
import sharp from "sharp";

// Exercise the real Next.js optimizer using the repository's production image
// configuration. The isolated app requires no database, auth, or provider secrets.
// Optionally verify an existing public remote image with IMAGE_OPTIMIZATION_REMOTE_URL.
const root = process.cwd();
const output = path.resolve(".superpowers/verification/image-optimization");
const fixture = mkdtempSync(path.join(tmpdir(), "solesneakers-image-optimization-"));
const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");
const remote = process.env.IMAGE_OPTIMIZATION_REMOTE_URL;
Object.assign(process.env, {
  NODE_ENV: "production",
  NEXT_TELEMETRY_DISABLED: "1",
  NEXT_PUBLIC_SITE_URL: "https://example.com",
  NEXT_PUBLIC_SUPABASE_URL: "https://jxwulwjbtjtcqmyrzqiv.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
  SUPABASE_SECRET_KEY: "test-secret-key",
  SUPABASE_DB_URL: "postgresql://user:pass@localhost:5432/testdb",
  SHIPPO_API_TOKEN: "test-shippo-token",
  SHIPPO_WEBHOOK_TOKEN: "test-shippo-webhook-token",
  UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "test-upstash-token",
  ADMIN_SESSION_SECRET: "test-admin-session-secret",
  ORDER_ACCESS_TOKEN_SECRET: "1234567890abcdef",
  SES_SMTP_HOST: "smtp.example.com",
  SES_SMTP_USER: "test-user",
  SES_SMTP_PASS: "test-pass",
});
const { PHASE_PRODUCTION_BUILD } = require("next/constants");
const config = await require("next/dist/server/config").default(
  PHASE_PRODUCTION_BUILD,
  root,
);
assert.equal(config.images.unoptimized, false, "hosted images must be optimized");
assert.deepEqual(config.images.formats, ["image/webp"]);
assert.equal(config.images.minimumCacheTTL, 14_400);
mkdirSync(path.join(fixture, "app"), { recursive: true });
mkdirSync(output, { recursive: true });
symlinkSync(
  path.join(root, "node_modules"),
  path.join(fixture, "node_modules"),
  "junction",
);
cpSync("public/images", path.join(fixture, "public/images"), { recursive: true });
writeFileSync(path.join(fixture, "package.json"), '{"private":true}');
writeFileSync(
  path.join(fixture, "next.config.js"),
  `module.exports = ${JSON.stringify({ images: config.images, outputFileTracingRoot: root })};`,
);
writeFileSync(
  path.join(fixture, "tsconfig.json"),
  JSON.stringify({
    compilerOptions: {
      allowJs: true,
      baseUrl: ".",
      paths: { "@/*": [path.join(root, "src/*")] },
    },
  }),
);
execFileSync(
  process.execPath,
  [
    require.resolve("tailwindcss/lib/cli.js"),
    "--input",
    "src/styles/site.css",
    "--output",
    path.join(fixture, "app/style.css"),
    "--minify",
  ],
  { stdio: "pipe" },
);
writeFileSync(
  path.join(fixture, "app/layout.jsx"),
  `import './style.css'; export default function Layout({children}) { return <html lang="en"><body>{children}</body></html>; }`,
);
await build({
  entryPoints: [path.join(root, "src/components/home/OutfitSlideshow.tsx")],
  outfile: path.join(fixture, "app/OutfitSlideshow.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  jsx: "automatic",
  external: ["react", "react/*", "next/*", "lucide-react"],
  banner: { js: '"use client";' },
});
writeFileSync(
  path.join(fixture, "app/page.jsx"),
  `import Image from 'next/image';
   import { OutfitSlideshow } from './OutfitSlideshow';
   export default function Page() { return <main>
     <div style={{position:'relative',width:300,height:200}}><Image src="/images/hero.jpg" alt="Local homepage photograph" fill sizes="300px" /></div>
     ${remote ? `<div style={{position:'relative',width:300,height:300}}><Image src={${JSON.stringify(remote)}} alt="Existing Supabase photograph" fill sizes="300px" /></div>` : ""}
     <div style={{height:1600}} />
     <OutfitSlideshow />
   </main>; }`,
);
const buildLog = path.join(output, "build.log");
try {
  execFileSync(process.execPath, [nextBin, "build", fixture, "--webpack"], {
    stdio: ["ignore", openSync(buildLog, "w"), openSync(buildLog, "a")],
    env: process.env,
  });
} catch (error) {
  console.error(readFileSync(buildLog, "utf8").slice(-8000));
  throw error;
}
const reservation = createServer();
await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const base = `http://127.0.0.1:${port}`;
const serverLog = path.join(output, "server.log");
const server = spawn(
  process.execPath,
  [nextBin, "start", fixture, "-H", "127.0.0.1", "-p", String(port)],
  {
    stdio: ["ignore", openSync(serverLog, "w"), openSync(serverLog, "a")],
    env: process.env,
  },
);
let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(readFileSync(serverLog, "utf8"));
    try {
      ready = (await fetch(base)).ok;
    } catch {
      /* startup */
    }
    if (ready) break;
    await setTimeout(300);
  }
  assert(ready, "isolated production server starts");
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
  });
  const requests = [];
  const errors = [];
  page.on("request", (request) => requests.push(request.url()));
  page.on("pageerror", (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(base);
  const measurements = [];
  for (const alt of [
    "Local homepage photograph",
    ...(remote ? ["Existing Supabase photograph"] : []),
  ]) {
    const image = page.getByRole("img", { name: alt, exact: true });
    await image.evaluate((element) => element.decode());
    const url = new URL(await image.evaluate((element) => element.currentSrc));
    assert.equal(url.pathname, "/_next/image");
    assert(
      Number(url.searchParams.get("w")) <= 640,
      "a 300px image selects a small rendition",
    );
    const response = await page.request.get(url.href, {
      headers: { Accept: "image/webp" },
    });
    assert.equal(response.status(), 200);
    assert.match(response.headers()["content-type"], /^image\/webp/);
    const body = await response.body();
    const metadata = await sharp(body).metadata();
    const repeat = await page.request.get(url.href, {
      headers: { Accept: "image/webp" },
    });
    assert.equal(repeat.headers()["x-nextjs-cache"], "HIT");
    if (alt === "Local homepage photograph")
      assert(body.length < readFileSync("public/images/hero.jpg").length);
    measurements.push({
      alt,
      source: url.searchParams.get("url"),
      bytes: body.length,
      width: metadata.width,
      format: metadata.format,
      repeatCache: repeat.headers()["x-nextjs-cache"],
    });
  }
  const slideshow = page.getByRole("region", { name: "Outfit inspiration" });
  await slideshow.scrollIntoViewIfNeeded();
  await slideshow.locator('img[aria-hidden="true"]').first().waitFor();
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await slideshow.scrollIntoViewIfNeeded();
    const active = slideshow.locator('div[aria-hidden="false"] img');
    assert.equal(await active.count(), 2);
    await active.evaluateAll((images) =>
      Promise.all(images.map((image) => image.decode())),
    );
    const sources = await active.evaluateAll((images) =>
      images.map((image) => image.currentSrc),
    );
    assert.equal(
      sources[0],
      sources[1],
      "backdrop and foreground share the optimized rendition",
    );
    assert.equal(new URL(sources[0]).pathname, "/_next/image");
    await slideshow.screenshot({
      path: path.join(output, `slideshow-${width}.png`),
      animations: "disabled",
    });
  }
  assert.equal(
    requests.filter((url) =>
      new URL(url).pathname.startsWith("/images/homepage_outfits/"),
    ).length,
    0,
    "no raw slideshow background downloads",
  );
  assert.deepEqual(errors, []);
  writeFileSync(path.join(output, "results.json"), JSON.stringify(measurements, null, 2));
  console.log(
    "PASS: production image sizing, WebP bytes, cache reuse and slideshow delivery",
    JSON.stringify(measurements),
  );
} finally {
  await browser?.close();
  server.kill();
}
