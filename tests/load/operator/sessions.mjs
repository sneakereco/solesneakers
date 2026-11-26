import { randomUUID } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import { boundedFetch } from "./preflight.mjs";
export function accountSlotsForPlan(plan) {
  const slots = new Set(),
    budget = Math.round(plan.totalSlots * 0.3);
  let offset = plan.httpSlots;
  for (const count of [plan.browserViewports.mobile, plan.browserViewports.desktop]) {
    const desired = Math.min(
      budget - slots.size,
      count ? Math.max(1, Math.round(count * 0.3)) : 0,
    );
    for (let index = 0; index < desired; index++)
      slots.add(offset + Math.floor(((index + 0.5) * count) / desired));
    offset += count;
  }
  let remaining = budget - slots.size;
  for (let slot = 0; slot < plan.httpSlots && remaining > 0; slot++)
    if (slot % 10 < 3) {
      slots.add(slot);
      remaining--;
    }
  if (remaining) throw Error("Insufficient disjoint account slots");
  return slots;
}

export function createSessionAuth(target, publishableKey, verify) {
  async function authenticate(account, previous) {
    let cookies = [...(previous?.cookies ?? [])];
    const client = createServerClient(target.resources.supabase.url, publishableKey, {
      global: { fetch: boundedFetch },
      auth: { autoRefreshToken: false },
      cookies: {
        getAll: () => cookies,
        setAll(values) {
          for (const cookie of values) {
            cookies = cookies.filter((x) => x.name !== cookie.name);
            if (cookie.options?.maxAge !== 0) cookies.push(cookie);
          }
        },
      },
    });
    const result = previous
      ? await client.auth.refreshSession()
      : await client.auth.signInWithPassword({
          email: account.email,
          password: account.password,
        });
    if (result.error || !result.data.session || result.data.user?.id !== account.id)
      throw Error("Synthetic session authentication failed");
    const session = { cookies, expiresAt: result.data.session.expires_at * 1000 };
    if (verify) await verify(account, session);
    return session;
  }
  return {
    login: (account) => authenticate(account),
    refresh: (account, previous) => authenticate(account, previous),
  };
}
export async function prepareSessionPool(target, plan, fixtures, clients) {
  const accounts = [];
  // Bounded control-plane login, outside measured storefront traffic. No OTP.
  for (const account of fixtures.accounts) {
    await clients.assertActive?.();
    accounts.push({ account, session: await clients.auth.login(account), leased: false });
  }
  return { runId: plan.runId, accounts, auth: clients.auth, activeSlots: new Set() };
}
export async function leaseShopper(
  pool,
  slot,
  generation,
  { account = slot % 10 < 3 } = {},
) {
  if (
    !Number.isSafeInteger(slot) ||
    slot < 0 ||
    !Number.isSafeInteger(generation) ||
    generation < 0
  )
    throw Error("Invalid logical session");
  if (pool.activeSlots.has(slot)) throw Error("Slot already leased");
  const entry = account ? pool.accounts.find((x) => !x.leased) : null;
  if (account && !entry) throw Error("Every account is leased");
  if (entry) entry.leased = true;
  pool.activeSlots.add(slot);
  try {
    if (entry && entry.session.expiresAt < Date.now() + 60000)
      entry.session = await pool.auth.refresh(entry.account, entry.session);
    const sessionId = randomUUID();
    let released = false;
    return {
      slot,
      generation,
      sessionId,
      deviceId: randomUUID(),
      cartId: randomUUID(),
      idempotencyKey: randomUUID(),
      accountId: entry?.account.id ?? null,
      email:
        entry?.account.email ??
        `guest-${slot}-${generation}-${sessionId}@${pool.runId}.load.test`,
      cookies: structuredClone(entry?.session.cookies ?? []),
      expiresAt: entry?.session.expiresAt ?? null,
      async release() {
        if (released) return;
        released = true;
        if (entry) entry.leased = false;
        pool.activeSlots.delete(slot);
      },
    };
  } catch (error) {
    if (entry) entry.leased = false;
    pool.activeSlots.delete(slot);
    throw error;
  }
}
