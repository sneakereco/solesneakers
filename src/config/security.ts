// src/config/security.ts

const prodConnectSrc = [
  "'self'",
  "https://*.supabase.co",
  "wss://*.supabase.co",
  "https://pci-connect.squareup.com",
  "https://pci-connect.squareupsandbox.com",
  "https://web.squarecdn.com",
  "https://sandbox.web.squarecdn.com",
  "https://o160250.ingest.sentry.io",
  "https://challenges.cloudflare.com",
  "https://cloudflareinsights.com",
  "https://pay.google.com",
  "https://google.com/pay",
  "https://api.lab.amplitude.com/sdk/vardata",
  "https://static.afterpay.com/modal",
].join(" ");

export const security = {
  contact: {
    rateLimit: {
      maxRequests: 5,
      window: "10 m",
      blockStatus: 429,
    },
    attachments: {
      maxFiles: 5,
      maxBytes: 5 * 1024 * 1024,
      allowedTypes: ["image/jpeg", "image/png", "image/webp"],
    },
  },
  proxy: {
    requestIdHeader: "x-request-id",
    botCheckPrefixes: ["/admin", "/api", "/auth", "/products", "/store"],
    rateLimitPrefixes: ["/api", "/store"],
    siteLockBypassExactPaths: [
      "/api/webhooks/shippo",
      "/api/webhooks/square",
      "/api/cron/expire-checkouts",
      "/api/cron/checkout-notifications",
      "/api/healthz",
      "/api/readyz",
    ],
    adminGuard: {
      protectedPrefixes: ["/admin", "/api/admin"],
      exemptPrefixes: ["/api/auth/2fa"],
    },

    canonicalize: {
      redirectStatus: 308,
      lowercasePathname: true,
      collapseMultipleSlashes: true,
      removeTrailingSlash: true,
      maxPathLength: 200,
    },

    bot: {
      internalProxyPrefix:
        "/149e9513-01fa-4fb0-aad4-566afd725d1b/2d206a39-8ed7-437e-a3be-862e0f06eea3",
      blockStatus: 403,
      minUserAgentLength: 8,
      maxLoggedUserAgentLength: 200,
      bypassExactPaths: ["/api/webhooks/shippo", "/api/webhooks/square"],

      allowedUserAgents: ["Googlebot", "Applebot", "Bingbot"],

      disallowedUserAgentSubstrings: [
        "curl/",
        "wget/",
        "python-requests",
        "go-http-client",
        "libwww-perl",
        "scrapy",
        "aiohttp",
        "headless",
        "phantom",
        "bot",
        "crawler",
        "spider",
        "scraper",
        "scanner",
        "whatweb",
        "nikto",
        "masscan",
        "nmap",
      ],
    },

    csrf: {
      blockStatus: 403,
      unsafeMethods: ["POST", "PUT", "PATCH", "DELETE"] as const,
      maxOriginLength: 512,

      bypassExactPaths: [
        "/api/webhooks/shippo",
        "/api/webhooks/square",
        "/api/auth/2fa/challenge/verify",
      ],
    },

    rateLimit: {
      store: "upstash",
      enabled: true,
      applyInLocalDev: false,

      blockStatus: 429,
      tooManyRequestsPath: "/too-many-requests",
    },

    admin: {
      loginPath: "/auth/login",
      homePath: "/",
      mfaChallengePath: "/auth/2fa/challenge",
      unauthorizedStatus: 401,
      forbiddenStatus: 403,
      errorStatus: 500,
    },

    adminSession: {
      cookieName: "admin_session",
      ttlSeconds: 60 * 60 * 24,
    },

    securityHeaders: {
      hsts: {
        value: "max-age=63072000; includeSubDomains; preload",
      },

      csp: {
        dev: [
          "default-src 'self'",
          "img-src 'self' data: https: blob: https://www.gstatic.com https://sandbox.api.cash.app https://api.cash.app https://franklin-assets.s3.amazonaws.com https://static.afterpay.com https://site-assets.afterpay.com",
          "style-src 'self' 'unsafe-inline' https://web.squarecdn.com https://sandbox.web.squarecdn.com https://fonts.googleapis.com https://sandbox.kit.cash.app https://kit.cash.app",
          "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://web.squarecdn.com https://sandbox.web.squarecdn.com https://js-sandbox.squarecdn.com https://js.squarecdn.com https://challenges.cloudflare.com https://static.cloudflareinsights.com/beacon.min.js https://pay.google.com/gp/p/js/pay.js https://sandbox.kit.cash.app/v1/pay.js https://kit.cash.app/v1/pay.js https://portal.sandbox.afterpay.com/afterpay.js https://portal.afterpay.com/afterpay.js https://js.afterpay.com/afterpay-1.x.js",
          "worker-src 'self' blob:",
          [
            "connect-src",
            "'self'",
            "ws://localhost:*",
            "http://localhost:*",
            "http://127.0.0.1:*",
            "https:",
          ].join(" "),
          "object-src 'none'",
          "base-uri 'self'",
          "frame-ancestors 'none'",
          "font-src 'self' data: https://cash-f.squarecdn.com https://square-fonts-production-f.squarecdn.com https://d1g145x70srn7h.cloudfront.net https://fonts.gstatic.com",
          "frame-src 'self' blob: https://web.squarecdn.com https://sandbox.web.squarecdn.com https://pci-connect.squareup.com https://pci-connect.squareupsandbox.com https://challenges.cloudflare.com https://pay.google.com https://sandbox.kit.cash.app https://kit.cash.app",
          "form-action 'self'",
        ],

        prod: [
          "default-src 'self'",
          "img-src 'self' data: blob: https://*.supabase.co https://*.cloudfront.net https://*.fastly.net https://web.squarecdn.com https://sandbox.web.squarecdn.com https://www.gstatic.com https://sandbox.api.cash.app https://api.cash.app https://franklin-assets.s3.amazonaws.com https://static.afterpay.com https://site-assets.afterpay.com",
          "style-src 'self' 'unsafe-inline' https://web.squarecdn.com https://sandbox.web.squarecdn.com https://fonts.googleapis.com https://sandbox.kit.cash.app https://kit.cash.app",
          "script-src 'self' 'unsafe-inline' https://web.squarecdn.com https://sandbox.web.squarecdn.com https://js-sandbox.squarecdn.com https://js.squarecdn.com https://challenges.cloudflare.com https://static.cloudflareinsights.com/beacon.min.js https://pay.google.com/gp/p/js/pay.js https://sandbox.kit.cash.app/v1/pay.js https://kit.cash.app/v1/pay.js https://portal.sandbox.afterpay.com/afterpay.js https://portal.afterpay.com/afterpay.js https://js.afterpay.com/afterpay-1.x.js",
          "worker-src 'self' blob:",
          "object-src 'none'",
          "base-uri 'self'",

          `connect-src ${prodConnectSrc}`,

          "frame-ancestors 'none'",
          "font-src 'self' data: https://cash-f.squarecdn.com https://square-fonts-production-f.squarecdn.com https://d1g145x70srn7h.cloudfront.net https://fonts.gstatic.com",
          "frame-src 'self' blob: https://web.squarecdn.com https://sandbox.web.squarecdn.com https://pci-connect.squareup.com https://pci-connect.squareupsandbox.com https://challenges.cloudflare.com https://pay.google.com https://sandbox.kit.cash.app https://kit.cash.app",
          "form-action 'self'",
          "upgrade-insecure-requests",
        ],
      },
    },
  },
} as const;

export function startsWithAny(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => pathname.startsWith(prefix));
}

export type CsrfUnsafeMethod = (typeof security.proxy.csrf.unsafeMethods)[number];

export function isCsrfUnsafeMethod(method: string): method is CsrfUnsafeMethod {
  const methodUpper = method.toUpperCase();
  return (security.proxy.csrf.unsafeMethods as readonly string[]).includes(methodUpper);
}
