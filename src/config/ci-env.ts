import { z } from "zod";

const ciSchema = z.object({
  VERCEL_TOKEN: z.string(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string(),
  SUPABASE_SECRET_KEY: z.string(),
  SUPABASE_DB_URL: z.string().url(),
  UPSTASH_REDIS_REST_URL: z.string().url(),
  UPSTASH_REDIS_REST_TOKEN: z.string(),
  SENTRY_DSN: z.string(),
});

export const ciEnv = ciSchema.parse(process.env);
