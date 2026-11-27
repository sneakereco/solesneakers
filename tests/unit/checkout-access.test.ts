import { createSupabaseAdminClient } from "@/lib/supabase/service-role";
import { assertCheckoutOpen } from "@/lib/checkout/checkout-access";
import { StoreAccessSettingsService } from "@/services/store-access-settings-service";

jest.mock("@/lib/supabase/service-role", () => ({
  createSupabaseAdminClient: jest.fn(),
}));

jest.mock("@/Modules/Checkout/Source/Features/Operations/checkout-controls", () => ({
  readCheckoutControls: jest.fn(),
}));
import { readCheckoutControls } from "@/Modules/Checkout/Source/Features/Operations/checkout-controls";
const mockCreateSupabaseAdminClient = jest.mocked(createSupabaseAdminClient);

const unlockedSettings = {
  siteLockEnabled: false,
  siteUnlockAt: null,
  checkoutLockEnabled: false,
  checkoutLockMessage: "Configured lock message",
};

describe("assertCheckoutOpen", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    mockCreateSupabaseAdminClient.mockReturnValue({} as never);
  });

  it("allows checkout only when persisted settings are explicitly unlocked", async () => {
    jest
      .spyOn(StoreAccessSettingsService.prototype, "getSettings")
      .mockResolvedValue(unlockedSettings);

    await expect(assertCheckoutOpen("tenant-1")).resolves.toEqual({ open: true });
  });

  it("returns the configured message when checkout is locked", async () => {
    jest.spyOn(StoreAccessSettingsService.prototype, "getSettings").mockResolvedValue({
      ...unlockedSettings,
      checkoutLockEnabled: true,
      checkoutLockMessage: "Online sales are paused for maintenance.",
    });

    await expect(assertCheckoutOpen("tenant-1")).resolves.toEqual({
      open: false,
      message: "Online sales are paused for maintenance.",
    });
  });

  it("fails closed when settings cannot be loaded", async () => {
    jest
      .spyOn(StoreAccessSettingsService.prototype, "getSettings")
      .mockRejectedValue(new Error("database unavailable"));

    await expect(assertCheckoutOpen("tenant-1")).resolves.toEqual({
      open: false,
      message: "Online checkout is temporarily unavailable.",
    });
  });
});

it.each([
  [true, false],
  [false, true],
  [true, true],
  [false, false],
])(
  "applies independent allocation and dispatch switches (%s, %s)",
  async (newPause, dispatchPause) => {
    jest
      .spyOn(StoreAccessSettingsService.prototype, "getSettings")
      .mockResolvedValue(unlockedSettings);
    jest.mocked(readCheckoutControls).mockResolvedValue({
      pauseNewCheckouts: newPause,
      pausePaymentDispatch: dispatchPause,
    });
    expect((await assertCheckoutOpen("tenant", "new_prepare")).open).toBe(!newPause);
    expect((await assertCheckoutOpen("tenant", "gateway_attempt")).open).toBe(
      !dispatchPause,
    );
    expect((await assertCheckoutOpen("tenant", "resume")).open).toBe(true);
  },
);
