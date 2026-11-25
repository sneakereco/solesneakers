import { AuthRetryableFetchError, AuthSessionMissingError } from "@supabase/supabase-js";
import { NextRequest } from "next/server";

import { POST as verifyCode } from "@/app/api/auth/forgot-password/verify-code/route";
import { POST as updatePassword } from "@/app/api/auth/update-password/route";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ProfileRepository } from "@/repositories/profile-repo";
import { AdminAuthService } from "@/services/admin-auth-service";

jest.mock("@/lib/supabase/server");
jest.mock("@/repositories/profile-repo");
jest.mock("@/services/admin-auth-service");
jest.mock("@/lib/utils/log");

const owner = "3fd71135-d895-4d08-a964-56bdebedd2dc";
const otherOwner = "131b6d15-6e44-485b-a9f4-c4d0feca2aeb";
const user = { id: owner, email: "customer@example.test" };
const password = "Example1!Secure";
const getUser = jest.fn();
const verifyOtp = jest.fn();
const updateUser = jest.fn();
const getAuthViewByUserId = jest.fn();
const getMfaRequirements = jest.fn();

function request(path: string, payload: object) {
  return new NextRequest(`https://shop.example.test/api/auth/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: { getUser, verifyOtp, updateUser },
  } as never);
  jest
    .mocked(ProfileRepository)
    .mockImplementation(() => ({ getAuthViewByUserId }) as never);
  jest
    .mocked(AdminAuthService)
    .mockImplementation(() => ({ getMfaRequirements }) as never);
  verifyOtp.mockResolvedValue({ data: { user }, error: null });
  getUser.mockResolvedValue({ data: { user }, error: null });
  getAuthViewByUserId.mockResolvedValue({ role: "customer" });
  updateUser.mockResolvedValue({ error: null });
});

it("returns the OTP-verified recovery owner and accepts first and retried writes for that owner", async () => {
  const verified = await verifyCode(
    request("forgot-password/verify-code", { email: user.email, code: "123456" }),
  );
  expect(verified.status).toBe(200);
  expect(await verified.json()).toMatchObject({ ok: true, recoveryOwnerId: owner });

  updateUser.mockResolvedValueOnce({ error: new Error("Failed write") });
  const first = await updatePassword(
    request("update-password", { password, recoveryOwnerId: owner }),
  );
  expect(first.status).toBe(400);
  const retry = await updatePassword(
    request("update-password", { password, recoveryOwnerId: owner }),
  );
  expect(retry.status).toBe(200);
  expect(updateUser).toHaveBeenCalledTimes(2);
  expect(updateUser).toHaveBeenCalledWith({ password });
  expect(verifyOtp).toHaveBeenCalledTimes(1);
});

it.each([{ id: otherOwner }, null])(
  "rejects a changed or missing current recovery owner %p before writing",
  async (currentUser) => {
    getUser.mockResolvedValue({
      data: { user: currentUser },
      error: currentUser ? null : new AuthSessionMissingError(),
    });
    const response = await updatePassword(
      request("update-password", { password, recoveryOwnerId: owner }),
    );
    expect(response.status).toBe(409);
    expect(updateUser).not.toHaveBeenCalled();
  },
);

it("rejects a password update missing the recovery owner before writing", async () => {
  const response = await updatePassword(request("update-password", { password }));
  expect(response.status).toBe(400);
  expect(updateUser).not.toHaveBeenCalled();
});

it("blocks a retry when the authenticated account changed after the first write attempt", async () => {
  updateUser.mockResolvedValueOnce({ error: new Error("Failed write") });
  const first = await updatePassword(
    request("update-password", { password, recoveryOwnerId: owner }),
  );
  expect(first.status).toBe(400);
  expect(updateUser).toHaveBeenCalledTimes(1);

  updateUser.mockClear();
  getUser.mockResolvedValue({ data: { user: { id: otherOwner } }, error: null });
  const retry = await updatePassword(
    request("update-password", { password, recoveryOwnerId: owner }),
  );
  expect(retry.status).toBe(409);
  expect(updateUser).not.toHaveBeenCalled();
});

it("returns a retryable status when the authenticated recovery session cannot be read", async () => {
  getUser.mockResolvedValue({
    data: { user: null },
    error: new AuthRetryableFetchError("Provider unavailable", 0),
  });
  const response = await updatePassword(
    request("update-password", { password, recoveryOwnerId: owner }),
  );
  expect(response.status).toBe(503);
  expect(updateUser).not.toHaveBeenCalled();
});

it("does not issue a recovery owner from a different session than the accepted OTP", async () => {
  getUser.mockResolvedValue({ data: { user: { id: otherOwner } }, error: null });
  const verified = await verifyCode(
    request("forgot-password/verify-code", { email: user.email, code: "123456" }),
  );
  expect(verified.status).toBe(409);
  expect(await verified.json()).not.toHaveProperty("recoveryOwnerId");
});

it.each(["requiresTwoFASetup", "requiresTwoFAChallenge"] as const)(
  "keeps the %s branch before issuing a recovery owner",
  async (field) => {
    getAuthViewByUserId.mockResolvedValue({ role: "admin" });
    getMfaRequirements.mockResolvedValue({ [field]: true });
    const verified = await verifyCode(
      request("forgot-password/verify-code", { email: user.email, code: "123456" }),
    );
    const body = await verified.json();
    expect(verified.status).toBe(200);
    expect(body).toMatchObject({ ok: true, [field]: true });
    expect(body).not.toHaveProperty("recoveryOwnerId");
  },
);
