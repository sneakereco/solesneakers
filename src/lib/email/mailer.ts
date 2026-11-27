// src/lib/email/mailer.ts
import nodemailer, { type Transporter } from "nodemailer";

import { env } from "@/config/env";
import { MAIL_FROM_EMAIL, MAIL_FROM_NAME } from "@/config/constants/mail";

type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
};

type RetryOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  timeoutMs?: number;
};

const getTransporter = (timeoutMs?: number): Transporter =>
  nodemailer.createTransport({
    host: env.SES_SMTP_HOST,
    port: 465,
    secure: true,
    ...(timeoutMs === undefined
      ? {}
      : {
          connectionTimeout: timeoutMs,
          greetingTimeout: timeoutMs,
          socketTimeout: timeoutMs,
        }),
    auth: {
      user: env.SES_SMTP_USER,
      pass: env.SES_SMTP_PASS,
    },
  });

const buildFrom = () => `"${MAIL_FROM_NAME}" <${MAIL_FROM_EMAIL}>`;

const sendWithTransport = async (input: SendEmailInput, timeoutMs?: number) => {
  const result = await getTransporter(timeoutMs).sendMail({
    from: buildFrom(),
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
    ...(input.replyTo ? { replyTo: input.replyTo } : {}),
  });

  return { messageId: result.messageId };
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type SendEmailResult = { messageId?: string };

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  return sendWithTransport(input);
}

export async function sendEmailWithRetry(
  input: SendEmailInput,
  options: RetryOptions = {},
): Promise<SendEmailResult> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 500);
  const timeoutMs = Math.max(1000, options.timeoutMs ?? 5000);

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      // Let SMTP settle under its own connection/idle timeouts. Racing a send
      // against an application timer can discard a later successful acceptance.
      return await sendWithTransport(input, timeoutMs);
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        await delay(baseDelayMs * attempt);
      }
    }
  }

  throw lastError;
}
