# Checkout final payment design

Approved by the user on November 27, 2026: implement the researched later stock claim together with the production checkout repairs. Research and incident evidence are in `docs/operations/inventory-payment-finalization-research-2026-11-27.md` and `checkout-guest-afterpay-investigation-2026-11-27.md`.

Shopping, address review, totals review, and Square SDK approval must not reserve inventory. The first valid final server submission to atomically claim all requested units wins. The server must claim inventory before CreatePayment, so a competing shopper fails before a backend charge. No payment-first/refund-loser strategy.

Use a nonreserving review operation built from the existing trusted preparation validation. After SDK tokenization, send one final request that runs existing guarded preparation, issues a fresh short-lived payment permit, and dispatches payment. Preserve signed guest ownership, address confirmation, exact quote and cents, pickup contacts, Turnstile, database locking, idempotency, and durable recovery. A financial timeout never proves failure and must lead to original-order recovery. Existing original-order retries keep their identity and guards.

An accepted address owns its own quote; a same-owner session recheck must not compare that quote to an unrelated parent form address. Identity verification waits and provider tokenization must be bounded and retired on cancellation. Late provider callbacks must not dispatch payment. Apple Pay must invoke tokenization directly from the click action.

Admin labels must distinguish automatic checkout expiration from customer cancellation and outstanding payment reconciliation. Keep database financial states intact. Include the recovery fixes already on main; production deployment and live provider qualification remain separate release gates.
