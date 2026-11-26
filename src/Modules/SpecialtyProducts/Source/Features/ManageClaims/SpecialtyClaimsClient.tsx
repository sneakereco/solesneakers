"use client";
import Image from "next/image";
import { useRef, useState } from "react";
import { useHydrated } from "@/components/ui/useHydrated";
import type {
  AdminClaimStatus,
  AdminSpecialtyClaim,
  SpecialtyCampaignState,
} from "./admin-claims";
type ClaimPage = { claims: AdminSpecialtyClaim[]; total: number };
const PAGE_SIZE = 25;
async function api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    ...(body
      ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      : {}),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      data?.error ?? "Claims could not be loaded. Please refresh and try again.",
    );
  return data as T;
}
export function SpecialtyClaimsClient({
  initial,
  campaign,
  products,
}: {
  initial: ClaimPage;
  campaign: SpecialtyCampaignState;
  products: Array<{ id: string; name: string }>;
}) {
  const hydrated = useHydrated();
  const [result, setResult] = useState(initial),
    [campaignState, setCampaign] = useState(campaign);
  const [status, setStatus] = useState<AdminClaimStatus | "all">("all"),
    [productId, setProductId] = useState(""),
    [page, setPage] = useState(1);
  const [saving, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const busy = saving || !hydrated;
  const pending = useRef(false);
  async function run(work: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setMessage("");
    try {
      await work();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The claim could not be updated. Please refresh.",
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function load(nextPage: number) {
    const params = new URLSearchParams({
      page: String(nextPage),
      pageSize: String(PAGE_SIZE),
    });
    if (status !== "all") params.set("status", status);
    if (productId) params.set("productId", productId);
    const next = await api<ClaimPage>("/api/admin/specialty/claims?" + params);
    setResult(next);
    setPage(nextPage);
  }
  const pages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const fieldClass =
    "min-h-11 rounded border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950";
  return (
    <div className="space-y-5">
      <section
        className="rounded border border-zinc-200 bg-white p-5 text-zinc-950"
        aria-label="Giveaway campaign controls"
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-semibold">Black Friday giveaway</h2>
            <p className="mt-1 text-sm text-zinc-600">
              {campaignState.enabled ? "Claims are open." : "Claims are closed."} Winners
              remain available for follow-up.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-label="Giveaway claims enabled"
            aria-checked={campaignState.enabled}
            disabled={busy || (!campaignState.enabled && !campaignState.keyReady)}
            className="admin-button-primary"
            onClick={() => {
              void run(async () => {
                const saved = await api<{ enabled: boolean; revision: number }>(
                  "/api/admin/specialty/campaign",
                  "PATCH",
                  {
                    enabled: !campaignState.enabled,
                    expectedRevision: campaignState.revision,
                  },
                );
                setCampaign((current) => ({ ...current, ...saved }));
              });
            }}
          >
            {campaignState.enabled ? "Close claims" : "Open claims"}
          </button>
        </div>
        {!campaignState.keyReady && (
          <p className="mt-3 text-sm text-amber-800">
            Configure the campaign&apos;s claim signing key before opening new claims.
          </p>
        )}
      </section>
      <form
        data-admin-toolbar
        className="flex flex-wrap gap-3 rounded border border-zinc-200 bg-white p-4"
        onSubmit={(event) => {
          event.preventDefault();
          void run(() => load(1));
        }}
      >
        <label className="flex flex-col gap-1 text-sm text-zinc-700">
          Product
          <select
            className={fieldClass}
            value={productId}
            onChange={(event) => setProductId(event.target.value)}
            disabled={busy}
          >
            <option value="">All specialty products</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-zinc-700">
          Follow-up status
          <select
            className={fieldClass}
            value={status}
            onChange={(event) =>
              setStatus(event.target.value as AdminClaimStatus | "all")
            }
            disabled={busy}
          >
            <option value="all">All statuses</option>
            <option value="new">New</option>
            <option value="contacted">Contacted</option>
            <option value="fulfilled">Fulfilled</option>
          </select>
        </label>
        <button disabled={busy} type="submit" className="admin-button-primary self-end">
          Apply filters
        </button>
        <button
          disabled={busy}
          type="button"
          className="admin-button-secondary self-end"
          onClick={() => {
            void run(async () => {
              const state = await api<SpecialtyCampaignState>(
                "/api/admin/specialty/campaign",
              );
              setCampaign(state);
              await load(page);
            });
          }}
        >
          Refresh
        </button>
      </form>
      {message && (
        <p
          role="alert"
          className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-800"
        >
          {message}
        </p>
      )}
      <div className="flex items-center justify-between gap-3 text-sm text-zinc-600">
        <p>
          {result.total} successful {result.total === 1 ? "claim" : "claims"}
        </p>
        {busy && <p role="status">Updating claims…</p>}
      </div>
      {!result.claims.length && (
        <p className="rounded border border-zinc-200 bg-white p-8 text-center text-zinc-600">
          No successful claims match these filters.
        </p>
      )}
      <div className="space-y-4">
        {result.claims.map((claim) => (
          <article
            key={claim.claimId}
            className="rounded border border-zinc-200 bg-white p-5 text-zinc-950"
            data-specialty-claim={claim.claimId}
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex gap-4">
                {claim.imageUrl && (
                  <Image
                    src={claim.imageUrl}
                    alt=""
                    width={64}
                    height={64}
                    className="h-16 w-16 rounded object-contain"
                  />
                )}
                <div>
                  <h2 className="font-semibold">{claim.productName}</h2>
                  <p className="mt-1 break-all text-xs text-zinc-500">
                    Claim {claim.claimId}
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">
                    Accepted{" "}
                    {new Date(claim.acceptedAt)
                      .toISOString()
                      .replace("T", " ")
                      .replace(/\.\d{3}Z$/, " UTC")}{" "}
                    · Decision #{claim.decisionOrdinal}
                  </p>
                </div>
              </div>
              <label className="flex flex-col gap-1 text-sm text-zinc-700">
                Follow-up
                <select
                  aria-label={"Follow-up for claim " + claim.claimId}
                  value={claim.status}
                  disabled={busy}
                  className={fieldClass}
                  onChange={(event) => {
                    const nextStatus = event.target.value as AdminClaimStatus;
                    void run(async () => {
                      const updated = await api<AdminSpecialtyClaim>(
                        "/api/admin/specialty/claims/" + claim.claimId,
                        "PATCH",
                        {
                          status: nextStatus,
                          expectedRevision: claim.revision,
                        },
                      );
                      setResult((current) => ({
                        ...current,
                        claims: current.claims.map((item) =>
                          item.claimId === updated.claimId ? updated : item,
                        ),
                      }));
                    });
                  }}
                >
                  <option value="new">New</option>
                  <option value="contacted">Contacted</option>
                  <option value="fulfilled">Fulfilled</option>
                </select>
              </label>
            </div>
            <div className="mt-5 grid gap-5 md:grid-cols-2">
              <div>
                <h3 className="text-xs font-medium uppercase text-zinc-500">
                  Winner contact
                </h3>
                <a
                  className="mt-2 inline-block min-h-11 text-sm underline"
                  href={
                    "https://www.instagram.com/" +
                    encodeURIComponent(claim.instagramHandle) +
                    "/"
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  @{claim.instagramHandle}
                </a>
                <address className="mt-1 text-sm not-italic">
                  {claim.address.line1}
                  <br />
                  {claim.address.line2 && (
                    <>
                      {claim.address.line2}
                      <br />
                    </>
                  )}
                  {claim.address.city}, {claim.address.state} {claim.address.postalCode}
                  <br />
                  United States
                </address>
              </div>
              <div>
                <h3 className="text-xs font-medium uppercase text-zinc-500">
                  Saved winning instructions
                </h3>
                <p className="mt-2 whitespace-pre-wrap text-sm">{claim.instructions}</p>
              </div>
            </div>
            <p className="mt-5 break-all text-xs text-zinc-500">
              {claim.updatedBy
                ? "Updated " +
                  new Date(claim.updatedAt)
                    .toISOString()
                    .replace("T", " ")
                    .replace(/\.\d{3}Z$/, " UTC") +
                  " by " +
                  claim.updatedBy
                : "No staff updates yet."}
            </p>
          </article>
        ))}
      </div>
      <div className="flex items-center justify-between gap-4">
        <button
          disabled={busy || page <= 1}
          className="admin-button-secondary"
          onClick={() => {
            void run(() => load(page - 1));
          }}
        >
          Previous
        </button>
        <p className="text-sm text-zinc-600">
          Page {page} of {pages}
        </p>
        <button
          disabled={busy || page >= pages}
          className="admin-button-secondary"
          onClick={() => {
            void run(() => load(page + 1));
          }}
        >
          Next
        </button>
      </div>
    </div>
  );
}
