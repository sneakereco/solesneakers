"use client";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ModalPortal } from "@/components/ui/ModalPortal";
import type {
  ClaimDecision,
  ClaimSubmission,
  EligibilityAddress,
  SpecialtyPublicProduct,
} from "./claim-contract";
import {
  createAttempt,
  hasDurableAttemptStorage,
  readAttempt,
  replaceClosedAttempt,
  saveAttempt,
  type SavedAttempt,
} from "./attempt-storage";
import {
  ClaimClientError,
  recoverClaim,
  settleClaimAttempt,
  validateClaimEligibility,
} from "./claim-client";
type Phase = "form" | "validating" | "checking" | "unknown" | "decided";
const blankAddress: EligibilityAddress = {
  line1: "",
  line2: null,
  city: "",
  state: "",
  postalCode: "",
  country: "US",
};
export function ClaimDialog({
  product,
  open,
  onClose,
}: {
  product: SpecialtyPublicProduct;
  open: boolean;
  onClose(): void;
}) {
  const headingId = useId(),
    noteId = useId();
  const dialog = useRef<HTMLDivElement>(null),
    attempt = useRef<SavedAttempt | null>(null),
    frozen = useRef<ClaimSubmission | null>(null);
  const operation = useRef<AbortController | null>(null),
    locked = useRef(false),
    active = useRef(false);
  const [handle, setHandle] = useState(""),
    [address, setAddress] = useState<EligibilityAddress>(blankAddress);
  const [phase, setPhase] = useState<Phase>(() =>
      readAttempt(product.id) ? "checking" : "form",
    ),
    [decision, setDecision] = useState<ClaimDecision | null>(null),
    [message, setMessage] = useState("");
  const [canReenter, setCanReenter] = useState(true);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [storageLimited, setStorageLimited] = useState(() =>
    Boolean(readAttempt(product.id) && !hasDurableAttemptStorage()),
  );
  const [correction, setCorrection] = useState<{
    address: EligibilityAddress;
    token: string;
  } | null>(null);
  const showResult = useCallback(
    async (saved: SavedAttempt, payload: ClaimSubmission | null, checkFirst = false) => {
      operation.current?.abort();
      const controller = new AbortController();
      operation.current = controller;
      locked.current = true;
      try {
        const previous = checkFirst ? await recoverClaim(saved, controller.signal) : null;
        const result =
          previous && "result" in previous
            ? previous
            : await settleClaimAttempt(saved, payload, controller.signal);
        if (!active.current || controller.signal.aborted) return;
        if ("result" in result) {
          setDecision(result.result);
          setPhase("decided");
        } else setPhase("unknown");
      } catch (error) {
        if (!active.current || controller.signal.aborted) return;
        if (
          error instanceof ClaimClientError &&
          ["invalid", "validation_required"].includes(error.code)
        ) {
          setPhase("form");
          setMessage(
            "Please check and validate your original details again. Your attempt has been kept.",
          );
        } else {
          setPhase("unknown");
        }
      } finally {
        locked.current = false;
      }
    },
    [],
  );
  useEffect(() => {
    if (!open) return;
    active.current = true;
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const saved = readAttempt(product.id);
    attempt.current = saved;
    const frame = requestAnimationFrame(() => {
      (
        dialog.current?.querySelector<HTMLInputElement>("input") ??
        dialog.current?.querySelector<HTMLButtonElement>("button")
      )?.focus();
      // Recover once the portal is visible, and cancel this work if it closes before paint.
      if (saved) void showResult(saved, null);
    });
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
      if (event.key !== "Tab" || !dialog.current) return;
      const elements = Array.from(
        dialog.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]',
        ),
      );
      const first = elements[0],
        last = elements[elements.length - 1];
      if (!first) {
        event.preventDefault();
        dialog.current.focus();
        return;
      }
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          !dialog.current.contains(document.activeElement))
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last ||
          !dialog.current.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      active.current = false;
      operation.current?.abort();
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", keydown);
      previousFocus?.focus();
    };
  }, [open, product.id, onClose, showResult]);
  const editAddress = (
    field: Exclude<keyof EligibilityAddress, "country">,
    value: string,
  ) => {
    setAddress((current) => ({
      ...current,
      [field]:
        field === "state"
          ? value.toUpperCase()
          : field === "line2"
            ? value || null
            : value,
    }));
    setCorrection(null);
    setMessage("");
    setFieldErrors({});
  };
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked.current) return;
    locked.current = true;
    setPhase("validating");
    setMessage("");
    setFieldErrors({});
    try {
      const result = await validateClaimEligibility({
        productId: product.id,
        instagramHandle: handle,
        address: correction?.address ?? address,
        ...(correction ? { correctionToken: correction.token } : {}),
      });
      if (!active.current) return;
      if (result.status === "invalid") {
        setPhase("form");
        setFieldErrors(result.fields);
        requestAnimationFrame(() =>
          dialog.current
            ?.querySelector<HTMLInputElement>(
              result.fields.instagramHandle
                ? '[name="instagramHandle"]'
                : '[name="line1"]',
            )
            ?.focus(),
        );
        return;
      }
      if (result.status === "unavailable") {
        setPhase("form");
        setMessage("We couldn't validate your details right now. Please try again.");
        return;
      }
      if (result.status === "correction_required") {
        setCorrection({ address: result.address, token: result.correctionToken });
        setPhase("form");
        return;
      }
      setAddress(result.address);
      setCorrection(null);
      const saved =
        attempt.current ?? readAttempt(product.id) ?? createAttempt(product.id);
      saveAttempt(saved);
      attempt.current = saved;
      setStorageLimited(!hasDurableAttemptStorage());
      const payload: ClaimSubmission = {
        ...saved,
        instagramHandle: handle,
        address: result.address,
        validationToken: result.validationToken,
      };
      frozen.current = payload;
      setCanReenter(false);
      setPhase("checking");
      await showResult(saved, payload);
    } catch {
      if (active.current) {
        setPhase("form");
        setMessage("We couldn't validate your details right now. Please try again.");
      }
    } finally {
      locked.current = false;
    }
  }
  const fieldClass =
    "mt-1 w-full rounded border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-950 focus:outline focus:outline-2 focus:outline-zinc-900";
  const checking = phase === "checking" || phase === "validating";
  return (
    <ModalPortal open={open} onClose={onClose}>
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        aria-describedby={phase === "form" ? noteId : undefined}
        tabIndex={-1}
        data-specialty-claim-dialog
        className="ph-no-capture ph-no-record max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-lg overflow-y-auto overscroll-contain rounded-xl bg-white p-5 text-zinc-950 shadow-xl sm:p-7"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id={headingId} className="text-xl font-semibold">
            {phase === "decided" && decision
              ? {
                  won: "Congrats!",
                  sold_out: "Already claimed",
                  already_claimed: "Giveaway limit reached",
                  closed: "Claims are closed",
                }[decision.status]
              : "Claim " + product.name}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close claim form"
            className="min-h-11 min-w-11 rounded border border-zinc-300"
          >
            ✕
          </button>
        </div>
        {phase === "form" && (
          <p id={noteId} className="mt-2 text-sm text-zinc-600">
            Opening this form does not reserve the prize. The first complete, valid
            submission accepted by the server wins.
          </p>
        )}
        {checking && (
          <p role="status" aria-live="polite" className="my-6">
            {phase === "validating"
              ? "Checking your details…"
              : "Checking your claim. Please keep this confirmation open…"}
          </p>
        )}
        {message && (
          <p role="alert" className="my-4 text-sm text-red-700">
            {message}
          </p>
        )}
        {phase === "unknown" && (
          <div className="my-6 space-y-4">
            <p role="status">
              Your result is not confirmed yet. This does not mean you lost. Check the
              same attempt again.
            </p>
            <button
              className="min-h-11 rounded bg-zinc-950 px-5 py-2 text-white"
              onClick={() => {
                if (attempt.current && !locked.current) {
                  setPhase("checking");
                  setMessage("");
                  void showResult(attempt.current, frozen.current, true);
                }
              }}
            >
              Check result again
            </button>
            {canReenter && (
              <div>
                <p className="text-sm text-zinc-600">
                  If this submission never completed, re-enter your original details using
                  the same attempt.
                </p>
                <button
                  className="mt-2 min-h-11 underline"
                  onClick={() => {
                    setPhase("form");
                    setMessage(
                      "Re-enter the original Instagram handle and address. Your claim attempt has been kept.",
                    );
                  }}
                >
                  Re-enter original details
                </button>
              </div>
            )}
          </div>
        )}
        {phase === "decided" && decision && (
          <div className="my-6 space-y-4" role="status" aria-live="polite">
            {decision.status === "won" ? (
              <>
                <p>Your claim is confirmed. This prize is yours.</p>
                <h3 className="font-semibold">{decision.receipt.productName}</h3>
                <p className="whitespace-pre-wrap">{decision.receipt.instructions}</p>
                <p className="text-sm text-zinc-600">
                  Claim confirmation: {decision.receipt.claimId}
                </p>
                <p className="text-sm text-zinc-600">
                  Accepted{" "}
                  <time dateTime={decision.receipt.acceptedAt}>
                    {new Date(decision.receipt.acceptedAt).toLocaleString()}
                  </time>
                </p>
              </>
            ) : (
              <p>
                {decision.status === "sold_out"
                  ? "Unfortunately, someone else claimed this item before you."
                  : decision.status === "already_claimed"
                    ? "You have already claimed a specialty product in this giveaway."
                    : "This giveaway is currently closed."}
              </p>
            )}
            {decision.status === "closed" && product.claimable && (
              <button
                type="button"
                className="min-h-11 rounded bg-zinc-950 px-5 py-2 text-white"
                onClick={() => {
                  if (locked.current || !attempt.current) return;
                  try {
                    const next = replaceClosedAttempt(attempt.current);
                    operation.current?.abort();
                    attempt.current = next;
                    frozen.current = null;
                    setDecision(null);
                    setMessage("");
                    setCorrection(null);
                    setFieldErrors({});
                    setCanReenter(true);
                    setStorageLimited(!hasDurableAttemptStorage());
                    setPhase("form");
                    requestAnimationFrame(() =>
                      dialog.current?.querySelector<HTMLInputElement>("input")?.focus(),
                    );
                  } catch {
                    setMessage(
                      "Reopen the claim form to check your current result before trying again.",
                    );
                  }
                }}
              >
                Try claiming again
              </button>
            )}
          </div>
        )}
        {phase === "form" && (
          <form
            className="mt-5 space-y-4"
            onSubmit={(event) => {
              void submit(event);
            }}
          >
            <label className="block text-sm">
              Instagram handle
              <input
                autoComplete="off"
                name="instagramHandle"
                aria-invalid={Boolean(fieldErrors.instagramHandle)}
                aria-describedby={
                  fieldErrors.instagramHandle ? headingId + "-ig-error" : undefined
                }
                required
                maxLength={100}
                value={handle}
                onChange={(event) => {
                  setHandle(event.target.value);
                  setCorrection(null);
                  setMessage("");
                  setFieldErrors({});
                }}
                className={fieldClass}
              />
            </label>
            {fieldErrors.instagramHandle && (
              <p
                id={headingId + "-ig-error"}
                role="alert"
                className="text-sm text-red-700"
              >
                {fieldErrors.instagramHandle}
              </p>
            )}
            <label className="block text-sm">
              Street address
              <input
                autoComplete="address-line1"
                name="line1"
                aria-invalid={Boolean(fieldErrors.address)}
                aria-describedby={
                  fieldErrors.address ? headingId + "-address-error" : undefined
                }
                required
                maxLength={100}
                value={address.line1}
                onChange={(event) => editAddress("line1", event.target.value)}
                className={fieldClass}
              />
            </label>
            {fieldErrors.address && (
              <p
                id={headingId + "-address-error"}
                role="alert"
                className="text-sm text-red-700"
              >
                {fieldErrors.address}
              </p>
            )}
            <label className="block text-sm">
              Apartment / unit (optional)
              <input
                autoComplete="address-line2"
                name="line2"
                maxLength={50}
                value={address.line2 ?? ""}
                onChange={(event) => editAddress("line2", event.target.value)}
                className={fieldClass}
              />
            </label>
            <label className="block text-sm">
              City
              <input
                autoComplete="address-level2"
                name="city"
                required
                maxLength={64}
                value={address.city}
                onChange={(event) => editAddress("city", event.target.value)}
                className={fieldClass}
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm">
                State
                <input
                  autoComplete="address-level1"
                  name="state"
                  required
                  pattern="[A-Za-z]{2}"
                  maxLength={2}
                  value={address.state}
                  onChange={(event) => editAddress("state", event.target.value)}
                  className={fieldClass}
                />
              </label>
              <label className="block text-sm">
                ZIP code
                <input
                  autoComplete="postal-code"
                  name="postalCode"
                  inputMode="numeric"
                  required
                  pattern="[0-9]{5}(-[0-9]{4})?"
                  value={address.postalCode}
                  onChange={(event) => editAddress("postalCode", event.target.value)}
                  className={fieldClass}
                />
              </label>
            </div>
            {correction && (
              <div className="rounded border border-zinc-300 p-3">
                <p className="font-medium">Confirm the recommended address</p>
                <p className="mt-2 whitespace-pre-line">
                  {[
                    correction.address.line1,
                    correction.address.line2,
                    correction.address.city +
                      ", " +
                      correction.address.state +
                      " " +
                      correction.address.postalCode,
                  ]
                    .filter(Boolean)
                    .join("\n")}
                </p>
                <button
                  type="button"
                  className="mt-2 min-h-11 underline"
                  onClick={() => {
                    setCorrection(null);
                    setMessage("Edit your address, then submit again.");
                  }}
                >
                  Edit address
                </button>
              </div>
            )}
            <p className="text-xs text-zinc-600">
              US eligibility address required. Your address enforces the one-person limit;
              the reseller will contact you on Instagram to arrange the prize.
            </p>
            <button
              type="submit"
              disabled={checking}
              className="min-h-12 w-full rounded bg-zinc-950 px-5 py-3 text-white disabled:opacity-50"
            >
              {correction ? "Confirm address and claim" : "Submit claim"}
            </button>
          </form>
        )}
        {storageLimited && (
          <p role="note" className="mt-4 text-sm text-amber-800">
            Your browser cannot save this claim for refresh or reopen. Keep this
            confirmation open and save your winning confirmation for your records.
          </p>
        )}
      </div>
    </ModalPortal>
  );
}
