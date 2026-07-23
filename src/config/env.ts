import { z } from "zod";

const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string(),
  SUPABASE_SECRET_KEY: z.string(),
  SUPABASE_DB_URL: z.string(),

  SHIPPO_API_TOKEN: z.string(),
  SHIPPO_WEBHOOK_TOKEN: z.string(),

  UPSTASH_REDIS_REST_URL: z.string().url(),
  UPSTASH_REDIS_REST_TOKEN: z.string(),

  SES_SMTP_HOST: z.string(),
  SES_SMTP_USER: z.string(),
  SES_SMTP_PASS: z.string(),

  ADMIN_SESSION_SECRET: z.string(),
  ORDER_ACCESS_TOKEN_SECRET: z.string().min(16),

  NEXT_PUBLIC_SITE_URL: z.string(),

  NODE_ENV: z
    .enum(["development", "test", "production"])
    .optional()
    .default("development"),
});

export const env = schema.parse(process.env);
