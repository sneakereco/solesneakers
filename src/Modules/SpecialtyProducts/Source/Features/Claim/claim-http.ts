export const MAX_CLAIM_BODY_BYTES = 16 * 1024;
export class ClaimBodyError extends Error {
  constructor(readonly status: 413 | 422) {
    super("Invalid claim request.");
  }
}
export async function readClaimJson(request: Request): Promise<unknown> {
  if (Number(request.headers.get("content-length")) > MAX_CLAIM_BODY_BYTES)
    throw new ClaimBodyError(413);
  const reader = request.body?.getReader();
  if (!reader) throw new ClaimBodyError(422);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_CLAIM_BODY_BYTES) {
        await reader.cancel();
        throw new ClaimBodyError(413);
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    if (error instanceof ClaimBodyError) throw error;
    throw new ClaimBodyError(422);
  } finally {
    reader.releaseLock();
  }
}
export function privateClaimReply(
  body: unknown,
  status = 200,
  retryAfter?: number,
): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      ...(retryAfter ? { "Retry-After": String(retryAfter) } : {}),
    },
  });
}
