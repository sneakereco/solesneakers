"use client";

import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { AuthError } from "@/components/auth/ui/AuthError";
import { AuthHeader } from "@/components/auth/ui/AuthHeader";
import { authStyles } from "@/components/auth/ui/authStyles";
import { SixDigitCodeField } from "@/components/auth/ui/SixDigitCodeField";
import { ActionButton } from "@/components/ui/ActionButton";
import { FeedbackLink } from "@/components/ui/FeedbackLink";
import { LoadingState, Skeleton } from "@/components/ui/Skeleton";
import { useAsyncAction } from "@/components/ui/useAsyncAction";
import { useSession } from "@/contexts/SessionContext";
import { isMobileDevice } from "@/lib/utils/device";
import { mfaEnroll, mfaVerifyEnrollment } from "@/services/mfa-service";

const QRDisplay = lazy(() =>
  import("./QRDisplay").then((module) => ({ default: module.QRDisplay })),
);

type Enrollment = {
  factorId: string;
  qrCode?: string;
  manualSecret: string;
};

function extractSecret(uri?: string) {
  try {
    return uri ? (new URL(uri).searchParams.get("secret") ?? "") : "";
  } catch {
    return "";
  }
}

async function copyManualKey(secret: string, invoker: HTMLButtonElement) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(secret);
    return;
  }

  const input = document.createElement("textarea");
  input.value = secret;
  input.style.cssText = "position:fixed;top:-1000px";
  document.body.appendChild(input);
  try {
    input.select();
    if (!document.execCommand("copy")) throw new Error("Clipboard unavailable");
  } finally {
    input.remove();
    invoker.focus({ preventScroll: true });
  }
}

export function EnrollmentForm() {
  const router = useRouter();
  const { refreshSession } = useSession();
  const enrollmentAction = useAsyncAction();
  const copyAction = useAsyncAction();
  const [operation, setOperation] = useState<"generate" | "verify">("generate");
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [previouslyGenerated, setPreviouslyGenerated] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copyResult, setCopyResult] = useState<"copied" | "error" | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const generating = enrollmentAction.pending && operation === "generate";
  const verifying = (enrollmentAction.pending && operation === "verify") || continuing;
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Device detection is browser-only.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsMobile(isMobileDevice());
  }, []);

  useEffect(() => {
    if (enrollment) codeRef.current?.focus({ preventScroll: true });
    if (!enrollment?.qrCode || isMobile) return;

    const timer = window.setTimeout(
      () => {
        setEnrollment((current) => (current === enrollment ? null : current));
        setError("QR code expired. Generate a new one to continue.");
      },
      5 * 60 * 1000,
    );
    return () => window.clearTimeout(timer);
  }, [enrollment, isMobile]);

  function generate() {
    if (continuing || copyAction.pending) return;
    void enrollmentAction.run(async () => {
      setOperation("generate");
      setError(null);
      setCopyResult(null);
      try {
        const result = await mfaEnroll(isMobile);
        const manualSecret = extractSecret(result.uri);
        if (isMobile ? !manualSecret : !result.qrCode) {
          throw new Error(
            "Authenticator setup details were incomplete. Please try again.",
          );
        }
        setEnrollment({ factorId: result.factorId, qrCode: result.qrCode, manualSecret });
        setPreviouslyGenerated(true);
        setCode("");
      } catch (failure) {
        setError(
          failure instanceof Error
            ? failure.message
            : "Could not generate authenticator setup details.",
        );
      }
    });
  }

  function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!enrollment || continuing || code.length !== 6) return;
    void enrollmentAction.run(async () => {
      setOperation("verify");
      setError(null);
      try {
        await mfaVerifyEnrollment(enrollment.factorId, code);
        setContinuing(true);
        void refreshSession();
        router.push("/admin");
      } catch (failure) {
        setContinuing(false);
        setError(
          failure instanceof Error
            ? failure.message
            : "Could not verify your setup code.",
        );
      }
    });
  }

  function copy(invoker: HTMLButtonElement) {
    if (!enrollment?.manualSecret || generating) return;
    void copyAction.run(async () => {
      setCopyResult(null);
      try {
        await copyManualKey(enrollment.manualSecret, invoker);
        setCopyResult("copied");
      } catch {
        setCopyResult("error");
      }
    });
  }

  const generationLabel = isMobile
    ? "Generate setup key"
    : enrollment
      ? "Regenerate QR code"
      : previouslyGenerated
        ? "Generate new QR code"
        : "Generate QR code";

  return (
    <div className="space-y-6">
      <AuthHeader
        title="Set up 2FA"
        description={
          isMobile
            ? "Copy the setup key to your authenticator app, then verify."
            : "Scan the QR code with your authenticator app, then verify."
        }
      />

      <form onSubmit={verify} className="space-y-4">
        {!enrollment && (
          <div className={authStyles.panel}>
            {isMobile
              ? "Generate a setup key for your authenticator app."
              : "Generate a QR code and scan it with your authenticator app."}
          </div>
        )}

        {!isMobile && enrollment?.qrCode && (
          <Suspense
            fallback={
              <LoadingState
                label="Loading authenticator QR code"
                className="flex justify-center border border-zinc-300 bg-white p-6"
              >
                <Skeleton className="h-48 w-48" />
              </LoadingState>
            }
          >
            <QRDisplay
              qrCode={enrollment.qrCode}
              onQrError={() => {
                setEnrollment(null);
                setError(
                  "The QR code could not be displayed. Generate a new one to continue.",
                );
              }}
            />
          </Suspense>
        )}

        {enrollment?.manualSecret && (
          <div className={`${authStyles.panel} space-y-3`}>
            <label htmlFor="manual-setup-key" className={authStyles.label}>
              Manual setup key
            </label>
            <input
              id="manual-setup-key"
              readOnly
              value={enrollment.manualSecret.replace(/(.{4})/g, "$1 ").trim()}
              onFocus={(event) => event.currentTarget.select()}
              className="w-full select-all border border-zinc-300 bg-[#f8f8f7] px-3 py-3 font-mono text-xs tracking-[0.12em] text-zinc-900 focus:border-zinc-500 sm:text-sm"
              aria-describedby="setup-key-help"
            />
            <p id="setup-key-help" className="text-[0.82rem] text-zinc-600">
              Paste this key into your authenticator app.
            </p>
            <ActionButton
              type="button"
              onClick={(event) => copy(event.currentTarget)}
              disabled={generating}
              pending={copyAction.pending}
              pendingLabel="Copying key…"
              className={authStyles.secondaryButton}
            >
              Copy setup key
            </ActionButton>
            {copyResult && (
              <p
                role={copyResult === "copied" ? "status" : "alert"}
                className="text-[0.82rem]"
              >
                {copyResult === "copied"
                  ? "Setup key copied."
                  : "Could not copy the key. Select and copy it manually."}
              </p>
            )}
          </div>
        )}

        {(!enrollment || !isMobile) && (
          <ActionButton
            type="button"
            onClick={generate}
            disabled={verifying || copyAction.pending}
            pending={generating}
            pendingLabel={isMobile ? "Generating setup key…" : "Generating QR code…"}
            className={authStyles.primaryButton}
          >
            {generationLabel}
          </ActionButton>
        )}

        {enrollment && (
          <SixDigitCodeField
            id="enroll-code"
            label="Verification code"
            value={code}
            onChange={setCode}
            readOnly={generating || verifying}
            aria-describedby={error ? "mfa-enrollment-error" : undefined}
            ref={codeRef}
          />
        )}
        <AuthError id="mfa-enrollment-error" message={error} />

        {enrollment && (
          <ActionButton
            type="submit"
            disabled={code.length !== 6 || generating}
            pending={verifying}
            pendingLabel="Verifying…"
            className={authStyles.primaryButton}
          >
            Verify &amp; continue
          </ActionButton>
        )}

        <FeedbackLink href="/auth/login" className={authStyles.neutralLink}>
          Back to sign in
        </FeedbackLink>
      </form>
    </div>
  );
}
