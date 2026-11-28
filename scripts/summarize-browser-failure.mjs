import { readFileSync } from "node:fs";
import { browserFailureDiagnostics } from "../tests/fixtures/checkout-gate.mjs";
try {
  console.error(
    "Browser failure diagnostics " +
      JSON.stringify(browserFailureDiagnostics(readFileSync(process.argv[2], "utf8"))),
  );
} catch {
  console.error("Browser failure diagnostics unavailable");
}
