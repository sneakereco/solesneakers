# Single-page checkout verification — 2026-09-07

## Automated commands

| Command | Result |
| --- | --- |
| `npm run test:jest:unit -- --runInBand --testPathIgnorePatterns=.worktrees` | PASS — 79 suites, 275 tests |
| `npm run test:jest:integration -- --runInBand --testPathIgnorePatterns=.worktrees` | PASS — 3 suites, 19 tests |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS after ESLint corrected import ordering in `prepare-checkout.ts` |
| `npm run build` | PASS — `/checkout`, `/api/checkout/quote`, and `/icon.png` generated |

The focused Square payment-method test also passed after the final wallet lifecycle adjustment: 1 suite, 3 tests. The generated icon loaded from `http://localhost:3000/icon.png` as a 64 × 64 image without a browser error.

## Desktop capture

Blocked by local test data. At `2026-09-07`, `npm run dev:test` loaded `/store` successfully but the connected catalog returned `0 Products`, leaving the cart empty. `/checkout` therefore rendered its intentional empty-cart state, so a truthful 1440 × 1000 populated-checkout capture could not be produced without mutating inventory or bypassing the cart. The browser console contained no error on the empty storefront state.

The rendered-surface contract is covered by unit tests: Express checkout, Contact, Delivery, Payment, card, guest verification, Pay, purchased items, and totals render without a Continue/Update gate. Excluded marketing, upsell, insurance, discount, shipping-method, saved-info, and reassurance controls are absent.

## Mobile capture

Blocked by the same empty local catalog. Responsive source and component tests establish order-summary-first mobile DOM order and immediate checkout-section rendering, but a 390 × 844 screenshot, overflow check, and real Square iframe keyboard traversal still require a populated environment.

## Successful transaction matrix

| Flow | Status | Evidence still required |
| --- | --- | --- |
| Signed-in shipping | Pending staging deploy | Prefill, flat shipping, displayed total, Square/local order IDs, final webhook status |
| Guest shipping + Card | Pending staging deploy and Turnstile hostname update | Challenge success, displayed total, Square/local order IDs, final webhook status |
| Pickup + Card | Pending staging deploy | Zero shipping, ASAP pickup fulfillment, Square/local order IDs, final webhook status |
| Apple Pay / Google Pay / Cash App Pay | Pending eligible-device tests | Record each eligible method or device/browser unavailability; rendered buttons alone are not proof |
| Afterpay + refund | Pending staging operational test | Eligibility, payment status, webhook reconciliation, refund evidence |

For every staging attempt, record timestamp, account mode, fulfillment, displayed total, Square order ID, local order ID, and final status.

## External blockers

1. Deploy these commits to `soles-stg.vercel.app`; current staging cannot prove the new local implementation.
2. Add `soles-stg.vercel.app` to the Cloudflare Turnstile widget's **Hostname Management** list. Error `110200` remains expected until this dashboard change is complete.
3. Supply at least one purchasable staging item so desktop/mobile checkout and both fulfillment choices can be exercised through the real cart.
4. Use eligible Safari/Apple hardware for Apple Pay and a supported browser/device for Google Pay and Cash App Pay; record unavailable methods rather than forcing them visible.
5. Complete staffed test purchases, webhook reconciliation, and the Afterpay refund before checkout is considered release-verified.
