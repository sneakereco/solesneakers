import { z } from "zod";

export const storeAccessSettingsSchema = z
  .object({
    siteLockEnabled: z.boolean(),
    siteUnlockAt: z.string().datetime({ offset: true }).nullable().optional(),
    checkoutLockEnabled: z.boolean(),
    checkoutLockMessage: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
