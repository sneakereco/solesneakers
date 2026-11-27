# Locked Store Registration Repair Plan

> **For agentic workers:** Use superpowers:executing-plans for inline implementation and one final independent review.

**Goal:** Reject new customer signup while the effective site lock is active and prevent post-authentication navigation from displaying cached unlocked storefront pages.

**Requirements:** Explicitly requested by the user on November 26, 2026. Preserve scheduled opening and existing staff sign-in. Keep the earlier accessories change intact. Do not alter live settings or deploy outside the established release gates.

**Approach:** Add a shared fail-closed registration availability check to the signup page and POST handler. Enforce account creation at the database boundary with a migration so the public Auth endpoint cannot bypass the application rule. Use a same-origin full document navigation after successful authentication, and check storefront access in the server layout as a second enforcement point.

## Task 1: Block signup

- [ ] Add failing API/page tests for active locks, unavailable settings, and normal unlocked signup; verify no Auth creation is called when blocked.
- [ ] Implement the shared registration availability decision; redirect a locked registration page and return HTTP 423 from signup POST (503 for unavailable settings).
- [ ] Redirect a previously opened signup form to the lock page when its POST is rejected.
- [ ] Add a guarded SQL migration that rejects inserts into `auth.users` while the effective site lock is active. Test future, indefinite, expired, and disabled locks against a disposable local database, including Auth's database role and rollback of rejected creation.

## Task 2: Prevent cached post-authentication access

- [ ] Add a browser reproduction where a cached storefront destination remains available through a client-router push after verification; require the actual lock page instead.
- [ ] Add a same-origin authentication navigation helper and use it after email verification, password login, and OTP login. Preserve staff MFA destinations; reject external and script destinations.
- [ ] Add a server layout check that admits staff, redirects locked customers, and fails closed on unavailable lock settings.
- [ ] Verify ordinary open-store signup/login still work, staff sign-in remains possible, and cached signup submissions cannot create accounts after a lock is enabled.

## Review focus

- Direct provider signup must be covered, not just the website form.
- Existing staff sessions must still reach the store and administration.
- A lock beginning between form load and submission must reject creation.
- A lock beginning between signup and verification must prevent storefront access.
- Redirect targets must remain same-origin when navigation switches to a document load.
- The new account guard must preserve existing users and normal signup after scheduled opening.

## Validation and delivery

- [ ] Run focused tests, browser regressions, disposable database checks, lint, typecheck, formatting, and build.
- [ ] Obtain a fresh review; resolve material findings.
- [ ] Commit the scoped code and tests locally and report the deployment/migration requirement accurately.
