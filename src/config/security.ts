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
          "img-src 'self' data: https: blob:",
          "style-src 'self' 'unsafe-inline' https://web.squarecdn.com https://sandbox.web.squarecdn.com",
          "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://web.squarecdn.com https://sandbox.web.squarecdn.com https://challenges.cloudflare.com https://static.cloudflareinsights.com/beacon.min.js",
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
          "font-src 'self' data: https://square-fonts-production-f.squarecdn.com https://d1g145x70srn7h.cloudfront.net",
          "frame-src 'self' blob: https://web.squarecdn.com https://sandbox.web.squarecdn.com https://pci-connect.squareup.com https://pci-connect.squareupsandbox.com https://challenges.cloudflare.com",
          "form-action 'self'",
        ],

        prod: [
          "default-src 'self'",
          "img-src 'self' data: blob: https://*.supabase.co https://*.cloudfront.net https://*.fastly.net",
          "style-src 'self' 'unsafe-inline' https://web.squarecdn.com https://sandbox.web.squarecdn.com",
          "script-src 'self' 'unsafe-inline' https://web.squarecdn.com https://sandbox.web.squarecdn.com https://challenges.cloudflare.com https://static.cloudflareinsights.com/beacon.min.js",
          "worker-src 'self' blob:",
          "object-src 'none'",
          "base-uri 'self'",

          `connect-src ${prodConnectSrc}`,

          "frame-ancestors 'none'",
          "font-src 'self' data: https://square-fonts-production-f.squarecdn.com https://d1g145x70srn7h.cloudfront.net",
          "frame-src 'self' blob: https://web.squarecdn.com https://sandbox.web.squarecdn.com https://pci-connect.squareup.com https://pci-connect.squareupsandbox.com https://challenges.cloudflare.com",
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
