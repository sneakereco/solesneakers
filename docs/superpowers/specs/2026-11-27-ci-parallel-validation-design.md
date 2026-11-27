# Parallel PR validation

The user approved removing duplicate browser runs and parallelizing the database and browser checks without losing test coverage.

Keep all unique cases, both database modes, fault-injection controls, migration ordering rehearsals, measurement/analytics suites, the credential-free build, private diagnostics, and the existing changed-path scope rules.

Run ordinary validation, database checks, and browser checks as independent GitHub Actions jobs. A short scope job supplies the existing checkout scope outputs. Database migration rehearsals and measurement/analytics browser suites remain unconditional. Keep the required check named `validate`; it must wait for every lane and fail on failures, cancellations, skips, or missing results.

The full checkout-outcome browser suite already includes the receipt and actual-checkout subsets invoked by `checkout-success.mjs` and `checkout-progress.mjs`. Remove only those two invocations from the aggregate browser runner. Keep both standalone wrappers available.

Approaches: the approved first pass changes scheduling and removes duplicate executions. Database templates and Chromium process reuse would reduce repeated setup but are outside this change. Use one database lane and one browser lane initially, retaining their current internal execution and isolation.

No production behavior, deployment workflows, external provider calls, or required check settings change. Measure the remote run before reporting a speedup.
