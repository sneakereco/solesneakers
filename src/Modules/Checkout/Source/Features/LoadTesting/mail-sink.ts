import { randomUUID } from "node:crypto";
import { loadDigest } from "./contracts";
import { resolveFixtureContext } from "./context";
import type { LoadTestSettings } from "./settings";
import type { RunStore } from "./run-store";

export type LoadTestMail = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
};
export async function captureLoadTestEmail(
  input: LoadTestMail,
  settings: LoadTestSettings,
  store: RunStore,
): Promise<{ messageId: string }> {
  const context = await resolveFixtureContext("email", input.to, settings, store);
  if (!context) throw new Error("Load-test email recipient is unregistered");
  const fault = await store.get<{ kind?: string }>("fault", context.runId);
  if (fault?.kind === "smtp-outage") throw new Error("Synthetic SMTP outage");
  const messageId = `load-mail-${randomUUID()}`;
  await store.mutate<{
    runId: string;
    count: number;
    messages: {
      messageId: string;
      at: number;
      subjectDigest: string;
      bodyDigest: string;
    }[];
  }>(
    "mail",
    loadDigest(input.to),
    { runId: context.runId, count: 0, messages: [] },
    (old) => ({
      runId: context.runId,
      count: old.count + 1,
      messages: [
        ...old.messages,
        {
          messageId,
          at: Date.now(),
          subjectDigest: loadDigest(input.subject),
          bodyDigest: loadDigest(input.html),
        },
      ],
    }),
  );
  return { messageId };
}
