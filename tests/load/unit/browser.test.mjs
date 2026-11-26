import test from "node:test";
import { emptyOwnedCart, validationRace } from "../browser/journeys.mjs";
test("validation race probe detects a stale response in the current document", async () => {
  const id = "22222222-2222-4222-8222-222222222222",
    item = { productId: id, variantId: id, quantity: 1 };
  const server = createServer((request, response) => {
    if (request.url.startsWith("/api/cart/validate")) {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ items: [item], removed: [] }));
      return;
    }
    response.setHeader("content-type", "text/html");
    response.end(
      `<!doctype html><html><body><h1>Fixture</h1>${request.url.startsWith("/cart") ? `<button onclick="sessionStorage.setItem('rdk_cart_session','[]')">Remove fixture from cart</button><script>fetch('/api/cart/validate',{method:'POST',body:'{}'}).then(r=>r.json()).then(data=>sessionStorage.setItem('rdk_cart_session',JSON.stringify(data.items)));</script>` : `<button onclick='sessionStorage.setItem("rdk_cart_session",JSON.stringify([${JSON.stringify(item)}]))'>Add to Cart</button>`}</body></html>`,
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await assert.rejects(
      validationRace(
        page,
        {
          baseUrl: `http://127.0.0.1:${server.address().port}`,
          identity: { accountId: null },
        },
        { id, variantId: id },
      ),
    );
  } finally {
    await browser.close();
    server.close();
  }
});
test("cart cleanup waits for real asynchronous hydration before removing owned items", async () => {
  const id = "22222222-2222-4222-8222-222222222222";
  const server = createServer((_request, response) => {
    response.setHeader("content-type", "text/html");
    response.end(
      `<!doctype html><html><body><h1>Loading</h1><script>sessionStorage.setItem('rdk_cart_session',JSON.stringify([{productId:'${id}',variantId:'${id}',quantity:1}]));setTimeout(()=>{const button=document.createElement('button');button.textContent='Remove fixture from cart';button.onclick=()=>{sessionStorage.setItem('rdk_cart_session','[]');button.remove();};document.body.append(button);},200);</script></body></html>`,
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await emptyOwnedCart(
      page,
      `http://127.0.0.1:${server.address().port}`,
      { accountId: null },
      { products: [{ id }] },
    );
    assert.equal(
      await page.evaluate(() => sessionStorage.getItem("rdk_cart_session")),
      "[]",
    );
  } finally {
    await browser.close();
    server.close();
  }
});
import assert from "node:assert/strict";
import {
  ensureBrowserRuntime,
  validateBrowserCoverage,
  publicBrowserArtifact,
  runBrowserCohort,
} from "../browser/probe.mjs";
import { evaluateVitals } from "../browser/vitals.mjs";
import { chromium } from "@playwright/test";
import { squareShimSource } from "../browser/provider-shims.mjs";
import { createServer } from "node:http";
import { once } from "node:events";
import { EventEmitter } from "node:events";
import { collectVitals } from "../browser/vitals.mjs";
import { captureJourneyRequests } from "../browser/capture.mjs";
import { installBulkProviderRoutes } from "../browser/provider-shims.mjs";
test("enrolled Supabase traffic remains real and never receives the application phase credential", async () => {
  let handler,
    continued,
    blocked = false;
  await installBulkProviderRoutes(
    {
      route: async (_, fn) => {
        handler = fn;
      },
    },
    {
      baseUrl: "https://shop.test",
      supabaseUrl: "https://enrolled.supabase.co",
      providerMode: "simulated",
      runId: "run",
      slot: 1,
      credential: "private",
    },
  );
  await handler({
    request: () => ({
      url: () => "https://enrolled.supabase.co/rest/v1/profiles",
      headers: () => ({
        "x-load-test-credential": "private",
        "x-load-test-slot": "1",
        authorization: "Bearer customer-session",
      }),
    }),
    continue: async (options) => {
      continued = options;
    },
    abort: async () => {
      blocked = true;
    },
  });
  assert.equal(blocked, false);
  assert.equal(continued.headers["x-load-test-credential"], undefined);
  assert.equal(continued.headers.authorization, "Bearer customer-session");
});
test("public image requests cannot carry a shopper credential into a forbidden proxy route", async () => {
  let handler, continued;
  await installBulkProviderRoutes(
    {
      route: async (_, fn) => {
        handler = fn;
      },
    },
    { baseUrl: "https://shop.test", providerMode: "simulated", runId: "run", slot: 1 },
  );
  await handler({
    request: () => ({
      url: () => "https://shop.test/images/logo.png",
      headers: () => ({
        "x-load-test-credential": "private",
        "x-load-test-slot": "1",
        accept: "image/*",
      }),
    }),
    continue: async (options) => {
      continued = options;
    },
  });
  assert.equal(continued?.headers?.["x-load-test-credential"], undefined);
  assert.equal(continued?.headers?.accept, "image/*");
});
test("missing Chromium executable blocks browser evidence unless locked runtime installs", async () => {
  let installed = false;
  await assert.rejects(
    ensureBrowserRuntime({
      exists: () => false,
      install: async () => {},
      executablePath: () => "/missing",
    }),
    /Chromium/,
  );
  const result = await ensureBrowserRuntime({
    exists: () => installed,
    install: () => {
      installed = true;
      return Promise.resolve();
    },
    executablePath: () => "/locked",
  });
  assert.equal(result.executablePath, "/locked");
});
test("absent LCP and INP are unmet rather than zero latency", () => {
  assert.equal(evaluateVitals([], ["/store"]).status, "unmet");
  const samples = Array.from({ length: 20 }, (_, index) =>
    ["mobile", "desktop"].flatMap((viewport) =>
      ["LCP", "CLS"].map((name) => ({
        name,
        value: name === "LCP" ? 1000 : 0,
        route: "/store",
        viewport,
        navigationId: `${viewport}-${index}`,
      })),
    ),
  ).flat(2);
  const result = evaluateVitals(samples, ["/store"]);
  assert.equal(result.status, "unmet");
  assert.ok(result.reasons.some((x) => x.includes("INP")));
});
test("a blocked perimeter and an unstarted browser cannot satisfy achieved cohort", () => {
  assert.equal(
    validateBrowserCoverage({
      planned: 20,
      started: 19,
      errors: [],
      perimeter: { status: "pass" },
    }).status,
    "fail",
  );
  assert.equal(
    validateBrowserCoverage({
      planned: 20,
      started: 20,
      errors: [],
      perimeter: { status: "blocked" },
    }).status,
    "fail",
  );
});
test("exported browser evidence cannot include trace screenshots cookies or access URLs", () => {
  const value = publicBrowserArtifact({
    trace: "private.zip",
    screenshot: "private.png",
    cookies: [{ name: "session", value: "secret" }],
    errors: [new Error("https://stage.test/orders/a?token=secret")],
    observations: [{ name: "LCP", value: 1000 }],
  });
  const text = JSON.stringify(value);
  assert.ok(!text.includes("secret"));
  assert.ok(!text.includes("private.zip"));
  assert.ok(!text.includes("private.png"));
  assert.ok(text.includes("LCP"));
});
test("simulated card input cannot submit payment before the actual submit action", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<div id="card"></div>');
    await page.addScriptTag({ content: squareShimSource() });
    await page.evaluate(async () => {
      window.submissions = 0;
      const card = await window.Square.payments().card();
      card.addEventListener("submit", () => window.submissions++);
      await card.attach("#card");
    });
    await page
      .getByLabel("Simulated card number", { exact: true })
      .fill("4111111111111111");
    assert.equal(await page.evaluate(() => window.submissions), 0);
  } finally {
    await browser.close();
  }
});
test("actual Chromium records navigation vitals without secret URLs and blocks bulk third parties", async () => {
  const server = createServer((_req, res) => {
    res.setHeader("content-type", "text/html");
    res.end(
      '<!doctype html><html><body><h1 style="font-size:64px">Fixture page</h1><button onclick="this.textContent=\'Clicked\'">Interact</button><script src="https://sandbox.web.squarecdn.com/v1/square.js"></script></body></html>',
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ serviceWorkers: "block" }),
      page = await context.newPage(),
      samples = [];
    const counters = await installBulkProviderRoutes(context, {
      baseUrl,
      providerMode: "simulated",
      runId: "fixture",
      slot: 0,
    });
    await collectVitals(page, (x) => samples.push(x));
    const capture = captureJourneyRequests(page, baseUrl);
    await page.goto(baseUrl + "/?token=private-access");
    await page.getByRole("button", { name: "Interact", exact: true }).click();
    await page.waitForTimeout(300);
    await page.evaluate(() =>
      fetch("https://unapproved.example.test/beacon").catch(() => {}),
    );
    await page.goto("about:blank");
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.ok(samples.some((x) => x.name === "LCP" && x.value > 0));
    assert.ok(!JSON.stringify(capture.stop()).includes("private-access"));
    assert.equal(counters.square, 1);
    assert.equal(counters.blockedThirdParty, 1);
    assert.equal(counters.realThirdParty, 0);
  } finally {
    await browser.close();
    server.close();
  }
});
test("real blocked navigation records zero achieved browser slots", async () => {
  const server = createServer((_request, response) => {
    response.writeHead(403);
    response.end("Blocked");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const plan = {
      runId: "fixture-run",
      profile: "smoke",
      browserSlots: 2,
      httpSlots: 8,
      browserViewports: { mobile: 1, desktop: 1 },
      warmupSeconds: 0,
      measurementSeconds: 0,
    };
    const result = await runBrowserCohort(
      plan,
      {
        sessions: [
          { slot: 8, cookies: [] },
          { slot: 9, cookies: [] },
        ],
      },
      {
        target: {
          baseUrl: `http://127.0.0.1:${server.address().port}`,
          providerMode: "simulated",
        },
        credential: "fixture-only",
        phaseStart: 0,
      },
    );
    assert.equal(result.completed, 0);
    assert.equal(result.interrupted, 2);
    assert.ok(result.activeSamples.every((x) => x.slots === 0));
    assert.equal(
      result.resources.find((x) => x.type === "browser-coverage").status,
      "fail",
    );
  } finally {
    server.close();
  }
});
test("navigation replay captures only public Flight headers and local optimized images", async () => {
  const page = new EventEmitter(),
    capture = captureJourneyRequests(page, "https://stage.example.test");
  function response(path, type, headers = {}) {
    return {
      url: () => `https://stage.example.test${path}`,
      status: () => 200,
      request: () => ({
        resourceType: () => type,
        headers: () => headers,
        method: () => "GET",
        timing: () => ({ responseStart: 5, requestStart: 1 }),
      }),
    };
  }
  page.emit(
    "response",
    response("/store?_rsc=public", "fetch", {
      rsc: "1",
      "next-router-state-tree": encodeURIComponent(JSON.stringify(["", {}])),
      cookie: "secret",
    }),
  );
  page.emit(
    "response",
    response("/store?_rsc=private", "fetch", {
      rsc: "1",
      "next-router-state-tree": encodeURIComponent(
        JSON.stringify(["checkout?token=secret", {}]),
      ),
    }),
  );
  page.emit(
    "response",
    response("/_next/image?url=%2Fimages%2Flogo.png&w=640&q=90", "image"),
  );
  await Promise.resolve();
  const result = capture.stop();
  assert.equal(result.replay.length, 1);
  assert.equal(result.replay[0].headers.rsc, "1");
  assert.ok(result.assets.some((x) => x.includes("/_next/image?")));
  assert.ok(!JSON.stringify(result).includes("secret"));
});
test("emergency abort prevents subsequent browser navigation", async () => {
  const controller = new AbortController();
  let requests = 0;
  const server = createServer((request, response) => {
    if (!request.url.includes("favicon")) requests++;
    response.setHeader("content-type", "text/html");
    response.end("<!doctype html><html><body><h1>Fixture</h1></body></html>");
    if (requests === 1) setTimeout(() => controller.abort(), 0);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await runBrowserCohort(
      {
        runId: "fixture",
        profile: "smoke",
        browserSlots: 1,
        httpSlots: 1,
        browserViewports: { mobile: 0, desktop: 1 },
        warmupSeconds: 0,
        measurementSeconds: 0,
      },
      {
        sessions: [{ slot: 1, cookies: [] }],
        products: [{ id: "22222222-2222-4222-8222-222222222222" }],
      },
      {
        target: { baseUrl: `http://127.0.0.1:${server.address().port}` },
        phaseStart: 0,
        mode: "perimeter",
        signal: controller.signal,
      },
    );
    assert.equal(requests, 1);
  } finally {
    server.close();
  }
});
