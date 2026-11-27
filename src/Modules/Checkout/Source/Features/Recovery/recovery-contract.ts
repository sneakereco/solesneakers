import { z } from "zod";

const recoveryKind = z.enum(["reconcile_payment", "expire_reservation", "square_event"]);
export type RecoveryKind = z.infer<typeof recoveryKind>;

export type RecoveryInput = {
  uniqueKey: string;
  dueAt: string;
  reason: string | null;
} & (
  | { kind: "square_event"; eventId: string }
  | { kind: "reconcile_payment" | "expire_reservation"; orderId: string }
);

export type ClaimRecoveryInput = {
  limit: number;
  leaseSeconds: number;
  now: string;
};

export type FinishRecoveryInput = {
  id: string;
  leaseToken: string;
  result: "done" | "retry" | "review";
  nextAttemptAt?: string;
  reason?: string | null;
};

export const recoveryJobSchema = z
  .strictObject({
    id: z.guid(),
    kind: recoveryKind,
    orderId: z.guid().nullable(),
    eventId: z.string().min(1).max(128).nullable(),
    leaseToken: z.guid(),
    attempts: z.number().int().positive(),
    unresolvedObservations: z.number().int().nonnegative(),
  })
  .refine(({ kind, orderId, eventId }) =>
    kind === "square_event"
      ? eventId !== null && orderId === null
      : orderId !== null && eventId === null,
  );

export type RecoveryJob = z.infer<typeof recoveryJobSchema>;

export function validateRecoveryReason(reason?: string | null) {
  if (reason === null || reason === undefined) return undefined;
  if (!/^[a-z][a-z0-9_]{0,79}$/.test(reason)) {
    throw new Error("Invalid checkout recovery reason");
  }
  return reason;
}
