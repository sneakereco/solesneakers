import { createRequire, registerHooks } from "node:module";
import { register } from "tsx/cjs/api";
export const requireAnalytics = createRequire(import.meta.url);
registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(
      specifier === "server-only" ? "next/dist/compiled/server-only/empty.js" : specifier,
      context,
    );
  },
});
register();
