jest.mock("@/lib/auth/session", () => ({ getServerSession: jest.fn() }));
jest.mock("@/lib/store-access/get-store-access-settings", () => ({
  getStoreAccessSettings: jest.fn(),
}));
jest.mock("@/components/shell/ClientShell", () => ({
  ClientShell: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("next/navigation", () => ({
  redirect: jest.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));
jest.mock("@/lib/utils/log", () => ({ logError: jest.fn() }));
import StoreLayout from "@/app/(store)/layout";
import { getServerSession } from "@/lib/auth/session";
import { getStoreAccessSettings } from "@/lib/store-access/get-store-access-settings";

beforeEach(() => jest.clearAllMocks());
it.each([null, "customer"] as const)(
  "blocks locked storefront rendering for role %s",
  async (role) => {
    jest.mocked(getServerSession).mockResolvedValue(
      role
        ? {
            role,
            user: { id: "customer-1", email: "customer@example.com" },
            profile: null,
          }
        : null,
    );
    jest.mocked(getStoreAccessSettings).mockResolvedValue({
      isSiteLocked: true,
      tenantId: "store-1",
      settings: {
        siteLockEnabled: true,
        siteUnlockAt: null,
        checkoutLockEnabled: false,
        checkoutLockMessage: "Paused",
      },
    });
    await expect(StoreLayout({ children: "private storefront" })).rejects.toThrow(
      "redirect:/locked",
    );
  },
);
it.each(["admin", "super_admin", "dev"] as const)(
  "keeps %s access available without requiring a lock settings read",
  async (role) => {
    jest.mocked(getServerSession).mockResolvedValue({
      role,
      user: { id: "staff-1", email: "staff@example.com" },
      profile: null,
    });
    await expect(StoreLayout({ children: "staff preview" })).resolves.toBeTruthy();
    expect(getStoreAccessSettings).not.toHaveBeenCalled();
  },
);
it("admits ordinary visitors when the effective lock is off", async () => {
  jest.mocked(getServerSession).mockResolvedValue(null);
  jest.mocked(getStoreAccessSettings).mockResolvedValue({
    isSiteLocked: false,
    tenantId: "store-1",
    settings: {
      siteLockEnabled: false,
      siteUnlockAt: null,
      checkoutLockEnabled: false,
      checkoutLockMessage: "Paused",
    },
  });
  await expect(StoreLayout({ children: "open storefront" })).resolves.toBeTruthy();
});
it("fails closed when the store configuration is missing", async () => {
  jest.mocked(getServerSession).mockResolvedValue(null);
  jest.mocked(getStoreAccessSettings).mockResolvedValue(null);
  await expect(StoreLayout({ children: "private storefront" })).rejects.toThrow(
    "redirect:/locked",
  );
});
it("fails closed for customers when settings cannot be read", async () => {
  jest.mocked(getServerSession).mockResolvedValue(null);
  jest.mocked(getStoreAccessSettings).mockRejectedValue(new Error("unavailable"));
  await expect(StoreLayout({ children: "private storefront" })).rejects.toThrow(
    "redirect:/locked",
  );
});
