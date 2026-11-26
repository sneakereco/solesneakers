# Specialty claim result clarity

Follow-up to staging feedback on PR #46. Base: `22cdded90a4ac1ed8eaebb4527de7e6861ac0ae8`.

Confirmed winners now see **Congrats!** and **Your claim is confirmed. This prize is yours.** Opening/no-reservation instructions appear only while entering the form, not on confirmed win/loss/closed results or during result recovery. Terminal headings describe the actual outcome.

An exhausted active, published specialty product retains a public, noindex product page with **Already claimed**, a clear explanation and a link back to Shop All. A fresh server-side lookup checks the current stock and winning ordinal, independently of the ordinary 60-second product cache. A quantity-two prize remains claimable after its first win and becomes claimed after its second. A newly created zero-quantity product is not falsely described as won. Sold-out prizes remain excluded from discovery.

The page uses neutral **This product has already been claimed** wording because it cannot identify the visitor's result without their recovery credential. A saved attempt retains **Check claim result** and a recovery hint. Confirmed losers still see the specific someone-else-claimed-first result in the dialog. This avoids telling a returning winner on another device that someone else won.

No new environment variable, dependency or database migration is required. The private lookup projects only public prize facts; it does not expose winner/contact data. Award transactions, stock writes, identity limits and ordinary available-product rendering are unchanged. Missing, inactive, archived and unpublished products retain their existing unavailable behavior.

## Evidence

- Dialog regression RED: rendered heading was `You claimed it!` and the entry disclaimer remained after a win. GREEN: `Congrats!`, explicit confirmation and no entry disclaimer for wins, losses or closed results. Actual Chromium also passed corrections, uncertain recovery, storage failures, keyboard/mobile and duplicate-click checks.
- Product-page regression RED: exhausted prize raised `NOT_FOUND`; stale cached availability did not show the claimed state; metadata said Product Not Found. GREEN: claimed page, fresh stock check, disabled fresh claim and correct noindex metadata. Ordinary available rendering and unrelated missing-product 404s passed.
- One independent read-only review found two Important issues: unverified visitor wording inferred someone else won, and case-sensitive UUID comparison rejected uppercase links. Both were reproduced RED and fixed GREEN. The real local Next/PostgreSQL test includes an uppercase claimed-product URL.
- Full unit suite: **138 suites / 706 tests passed** after review corrections.
- Integration suite: **3 suites / 21 tests passed**.
- Actual local Next/Redis/PostgREST/PostgreSQL browser: **PASS** for winner confirmation, cached-prize refresh, saved winning receipt recovery, HTTP 200/noindex for exhausted prize, quantity-two lifecycle, discovery exclusion and unrelated-product 404. Auth/address providers were explicit fixtures; BotID used its supported development verdict.
- Changed-source ESLint: **PASS**, zero errors/warnings. Formatting and Git whitespace checks: **PASS**.
- Standalone TypeScript check: **PASS**, run sequentially after the completed build.
- Production webpack build: **PASS**, including TypeScript and static generation, using an owned synthetic fixture environment. This is not hosted provider evidence. The existing local Turbopack/node_modules-junction limitation remains.

The initial standalone typecheck overlapped Next dev regenerating ignored route types and reported missing generated files. The sequential check after the completed build passed; no application typing rule or tsconfig was weakened.

The staging deployment and real campaign were not changed by local verification. Temporary services and private fixture files were cleaned up. The marker-owned disposable database was removed after verification. Existing hosted provider and 1,000-submission qualification gaps remain separate; this patch does not establish launch capacity.
