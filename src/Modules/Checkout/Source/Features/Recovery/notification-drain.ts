import type { CheckoutNotification } from "@/lib/checkout/checkout-notification-worker";
import {
  drainBatches,
  withDependency,
  type WorkerOptions,
  type DependencyLeases,
} from "./recovery-worker";
export type ClaimedNotification = CheckoutNotification & { leaseToken: string };
export type MailOutcome = "sent" | "retry" | "deferred" | "review" | "rejected";
export class SmtpRefusal extends Error {
  private constructor(
    readonly reply: number,
    readonly phase: string,
  ) {
    super("checkout_smtp_rejected");
  }
  static fromProvider(value: unknown, recipient: string): SmtpRefusal | null {
    if (!(value instanceof Error)) return null;
    const e = value as Error & {
      command?: string;
      code?: string;
      responseCode?: number;
      response?: string;
      accepted?: unknown[];
      rejected?: unknown[];
    };
    const reply = e.responseCode;
    if (
      typeof reply !== "number" ||
      !Number.isInteger(reply) ||
      reply < 400 ||
      reply > 599 ||
      typeof e.response !== "string" ||
      !e.response.startsWith(String(reply) + " ") ||
      (e.accepted !== undefined && (!Array.isArray(e.accepted) || e.accepted.length))
    )
      return null;
    if (
      e.code === "EAUTH" &&
      /^AUTH (PLAIN|LOGIN|XOAUTH2|CRAM-MD5)$/.test(e.command ?? "")
    )
      return new SmtpRefusal(reply, "auth");
    if (e.code === "EENVELOPE") {
      if (e.command === "MAIL FROM") return new SmtpRefusal(reply, "mail_from");
      if (
        e.command === "RCPT TO" &&
        e.rejected?.length === 1 &&
        e.rejected[0] === recipient
      )
        return new SmtpRefusal(reply, "rcpt_to");
      if (e.command === "DATA") return new SmtpRefusal(reply, "data_command");
    }
    if (e.code === "EMESSAGE" && e.command === "DATA")
      return new SmtpRefusal(reply, "data_final");
    return null;
  }
}
export type MailDelivery = { signal: AbortSignal; begin: () => Promise<void> };
export type DrainDependencies = DependencyLeases & {
  claim(n: number): Promise<ClaimedNotification[]>;
  beginHandoff(n: ClaimedNotification): Promise<boolean>;
  send(
    n: ClaimedNotification,
    signal: AbortSignal,
    begin: () => Promise<void>,
  ): Promise<void>;
  finish(
    n: ClaimedNotification,
    outcome: MailOutcome,
    refusal?: SmtpRefusal,
  ): Promise<boolean>;
  remaining(): Promise<number>;
};
export async function drainNotifications(
  options: WorkerOptions,
  deps: DrainDependencies,
) {
  const result = { sent: 0, failed: 0, remaining: 0 };
  await drainBatches(
    options,
    (n) => deps.claim(n),
    async (n, stop) => {
      let handoff = false;
      let outcome: MailOutcome = "retry";
      let rejection: SmtpRefusal | undefined;
      try {
        const completed = await withDependency(deps, "smtp", stop, async (signal) => {
          await deps.send(n, signal, async () => {
            signal.throwIfAborted();
            if (!(await deps.beginHandoff(n))) throw Error("notification_claim_lost");
            handoff = true;
            signal.throwIfAborted();
          });
        });
        outcome = completed ? "sent" : "deferred";
      } catch (error) {
        if (handoff && error instanceof SmtpRefusal) {
          rejection = error;
          outcome = "rejected";
        } else outcome = handoff ? "review" : "retry";
      }
      const owned = await deps.finish(n, outcome, rejection);
      if (owned && outcome === "sent") result.sent++;
      else result.failed++;
    },
  );
  result.remaining = await deps.remaining();
  return result;
}
