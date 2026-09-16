import {
  DEFAULT_CHECKOUT_LOCK_MESSAGE,
  StoreAccessSettingsRepository,
} from "@/repositories/store-access-settings-repo";
import { StoreAccessSettingsService } from "@/services/store-access-settings-service";

type SelectChain = {
  select: jest.Mock<SelectChain, [string]>;
  eq: jest.Mock<SelectChain, [string, string]>;
  upsert: jest.Mock<SelectChain, [unknown, unknown]>;
  maybeSingle: jest.Mock<Promise<{ data: unknown; error: unknown }>, []>;
  single: jest.Mock<Promise<{ data: unknown; error: unknown }>, []>;
};

function createSupabaseMock(
  readResult: { data: unknown; error: unknown },
  writeResult = readResult,
) {
  const chain: SelectChain = {
    select: jest.fn(),
    eq: jest.fn(),
    upsert: jest.fn(),
    maybeSingle: jest.fn(),
    single: jest.fn(),
  };

  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.upsert.mockReturnValue(chain);
  chain.maybeSingle.mockResolvedValue(readResult);
  chain.single.mockResolvedValue(writeResult);

  return {
    from: jest.fn(() => chain),
  };
}

describe("StoreAccessSettingsRepository", () => {
  it("returns defaults when a tenant has no persisted settings", async () => {
    const supabase = createSupabaseMock({ data: null, error: null });
    const repo = new StoreAccessSettingsRepository(supabase as never);

    await expect(repo.getByTenant("tenant-1")).resolves.toEqual({
      siteLockEnabled: false,
      siteUnlockAt: null,
      checkoutLockEnabled: false,
      checkoutLockMessage: DEFAULT_CHECKOUT_LOCK_MESSAGE,
    });
  });

  it("normalizes the exact legacy default from reads and writes", async () => {
    const legacyMessage =
      "sorry we currently can not accept payments please message @realdealkickzsc on instagram the items you would like to purchase.";
    const row = {
      site_lock_enabled: false,
      site_unlock_at: null,
      checkout_lock_enabled: true,
      checkout_lock_message: legacyMessage,
    };
    const repo = new StoreAccessSettingsRepository(
      createSupabaseMock({ data: row, error: null }) as never,
    );

    await expect(repo.getByTenant("tenant-1")).resolves.toMatchObject({
      checkoutLockMessage: DEFAULT_CHECKOUT_LOCK_MESSAGE,
    });
    await expect(
      repo.upsert("tenant-1", {
        siteLockEnabled: false,
        siteUnlockAt: null,
        checkoutLockEnabled: true,
        checkoutLockMessage: legacyMessage,
      }),
    ).resolves.toMatchObject({ checkoutLockMessage: DEFAULT_CHECKOUT_LOCK_MESSAGE });
  });

  it("preserves custom messages from reads and writes", async () => {
    const customMessage = "Checkout is paused until 3 PM. Please try again then.";
    const row = {
      site_lock_enabled: false,
      site_unlock_at: null,
      checkout_lock_enabled: true,
      checkout_lock_message: customMessage,
    };
    const repo = new StoreAccessSettingsRepository(
      createSupabaseMock({ data: row, error: null }) as never,
    );

    await expect(repo.getByTenant("tenant-1")).resolves.toMatchObject({
      checkoutLockMessage: customMessage,
    });
    await expect(
      repo.upsert("tenant-1", {
        siteLockEnabled: false,
        siteUnlockAt: null,
        checkoutLockEnabled: true,
        checkoutLockMessage: customMessage,
      }),
    ).resolves.toMatchObject({ checkoutLockMessage: customMessage });
  });
});

describe("StoreAccessSettingsService", () => {
  it("treats enabled lock with a future unlock time as locked", () => {
    const service = new StoreAccessSettingsService({} as never);

    expect(
      service.isSiteLocked(
        {
          siteLockEnabled: true,
          siteUnlockAt: "2099-01-01T00:00:00.000Z",
        },
        new Date("2026-05-15T12:00:00.000Z"),
      ),
    ).toBe(true);
  });

  it("treats checkout lock as a direct toggle", () => {
    const service = new StoreAccessSettingsService({} as never);

    expect(service.isCheckoutLocked({ checkoutLockEnabled: true })).toBe(true);
    expect(service.isCheckoutLocked({ checkoutLockEnabled: false })).toBe(false);
  });
});
