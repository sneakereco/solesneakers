import { SpecialtyClaimRepository } from "@/Modules/SpecialtyProducts/Source/Features/Claim/claim-repository";
import type { AdminSupabaseClient } from "@/lib/supabase/service-role";
import type { AwardCommand } from "@/Modules/SpecialtyProducts/Source/Features/Claim/claim-contract";
import { hashRecoverySecret } from "@/Modules/SpecialtyProducts/Source/Features/Claim/normalize-identity";

const attemptId = "11111111-1111-4111-8111-111111111111";
const productId = "22222222-2222-4222-8222-222222222222";
const credentials = { attemptId, recoverySecret: "a".repeat(64) };
const receipt = {
  claimId: "33333333-3333-4333-8333-333333333333",
  productId,
  productName: "Fixture prize",
  instagramHandle: "fixture",
  instructions: "The reseller will contact you.",
  acceptedAt: "2026-11-25T00:00:00Z",
  decisionOrdinal: 1,
};
const command: AwardCommand = {
  attemptId,
  recoveryHash: hashRecoverySecret(credentials.recoverySecret),
  inputHash: "b".repeat(64),
  payloadHash: "c".repeat(64),
  eligibility: {
    campaignId: "44444444-4444-4444-8444-444444444444",
    productId,
    browserId: "fixture-browser-context",
    instagramHandle: "fixture",
    address: {
      line1: "123 FIXTURE ST",
      line2: null,
      city: "COLUMBIA",
      state: "SC",
      postalCode: "29201",
      country: "US",
    },
    addressKey: "d".repeat(64),
    instagramKey: "e".repeat(64),
    normalizationVersion: 1,
    identityKeyFingerprint: "f".repeat(64),
    expiresAt: Date.now() + 600000,
  },
};
test("award uses one server RPC and accepts its validated terminal result", async () => {
  const rpc = jest.fn().mockResolvedValue({
    data: { result: { status: "won", receipt }, replayed: false },
    error: null,
  });
  const repo = new SpecialtyClaimRepository({ rpc } as unknown as AdminSupabaseClient);
  await expect(repo.accept(command)).resolves.toEqual({
    result: { status: "won", receipt },
    replayed: false,
  });
  expect(rpc).toHaveBeenCalledWith("accept_specialty_claim", { p_command: command });
});
test("result recovery sends only a credential hash and returns bound outcome or unknown", async () => {
  const rpc = jest.fn().mockResolvedValue({
    data: {
      inputHash: command.inputHash,
      payloadHash: command.payloadHash,
      result: { status: "won", receipt },
    },
    error: null,
  });
  const repo = new SpecialtyClaimRepository({ rpc } as unknown as AdminSupabaseClient);
  expect((await repo.findAttempt(credentials))?.result).toEqual({
    status: "won",
    receipt,
  });
  expect(rpc).toHaveBeenCalledWith("read_specialty_claim_result_with_context", {
    p_attempt_id: attemptId,
    p_recovery_hash: command.recoveryHash,
  });
  expect(JSON.stringify(rpc.mock.calls)).not.toContain(credentials.recoverySecret);
  rpc.mockResolvedValue({ data: null, error: null });
  await expect(repo.findAttempt(credentials)).resolves.toBeNull();
});
test.each([
  ["specialty_attempt_unauthorized", "unauthorized"],
  ["specialty_payload_conflict", "payload_conflict"],
  ["timeout with private upstream details", "temporary_unavailable"],
])("maps %s without leaking provider details", async (message, code) => {
  const rpc = jest.fn().mockResolvedValue({ data: null, error: { message } });
  const repo = new SpecialtyClaimRepository({ rpc } as unknown as AdminSupabaseClient);
  await expect(repo.accept(command)).rejects.toMatchObject({ code });
  await expect(repo.accept(command)).rejects.not.toThrow(message);
});
test("network exceptions become recoverable failures without private details", async () => {
  const rpc = jest.fn().mockRejectedValue(new Error("private headers and address"));
  const repo = new SpecialtyClaimRepository({ rpc } as unknown as AdminSupabaseClient);
  await expect(repo.findAttempt(credentials)).rejects.toMatchObject({
    code: "temporary_unavailable",
  });
  await expect(repo.accept(command)).rejects.not.toThrow("private headers and address");
});
test("rejects malformed terminal replies and accidental raw credential fields", async () => {
  const rpc = jest.fn().mockResolvedValue({
    data: { result: { status: "won" }, replayed: false },
    error: null,
  });
  const repo = new SpecialtyClaimRepository({ rpc } as unknown as AdminSupabaseClient);
  await expect(repo.accept(command)).rejects.toMatchObject({
    code: "temporary_unavailable",
  });
  await expect(
    repo.accept({
      ...command,
      recoverySecret: credentials.recoverySecret,
    } as AwardCommand),
  ).rejects.toThrow();
});
test("recovery reads immutable product/campaign context through the additive private RPC", async () => {
  const rpc = jest.fn().mockResolvedValue({
    data: {
      inputHash: command.inputHash,
      payloadHash: command.payloadHash,
      result: { status: "won", receipt },
      productId,
      campaignId: command.eligibility.campaignId,
    },
    error: null,
  });
  const repo = new SpecialtyClaimRepository({ rpc } as unknown as AdminSupabaseClient);
  const result = await repo.findAttempt(credentials);
  expect(result).toMatchObject({ productId, campaignId: command.eligibility.campaignId });
  expect(rpc.mock.calls[0][0]).toBe("read_specialty_claim_result_with_context");
});
test("lock contention has a safe diagnostic category without exposing SQL details", async () => {
  const rpc = jest.fn().mockResolvedValue({
    data: null,
    error: { code: "55P03", message: "private SQL and contact data" },
  });
  const repo = new SpecialtyClaimRepository({ rpc } as unknown as AdminSupabaseClient);
  await expect(repo.accept(command)).rejects.toMatchObject({
    code: "temporary_unavailable",
    reason: "lock_contention",
  });
  await expect(repo.accept(command)).rejects.not.toThrow("private SQL");
});
