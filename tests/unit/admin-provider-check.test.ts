const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
const key = "label:fixture";
const storageKey = "admin-check:" + key;
const loadChecks = () => import("@/components/admin/admin-command");

describe("label purchase admission", () => {
  const records = new Map<string, string>();
  const storage = {
    getItem: jest.fn((name: string) => records.get(name) ?? null),
    setItem: jest.fn((name: string, value: string) => {
      records.set(name, value);
    }),
    removeItem: jest.fn((name: string) => {
      records.delete(name);
    }),
  };
  beforeEach(() => {
    records.clear();
    jest.resetModules();
    jest.clearAllMocks();
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: storage,
    });
  });
  afterAll(() => {
    if (originalStorage)
      Object.defineProperty(globalThis, "sessionStorage", originalStorage);
    else Reflect.deleteProperty(globalThis, "sessionStorage");
  });

  it("denies admission when the initial write throws or reads back absent", async () => {
    const checks = await loadChecks();
    storage.setItem.mockImplementationOnce(() => {
      throw Error("quota");
    });
    expect(checks.transitionProviderCheck(key, null, "support")).toBe(false);
    storage.setItem.mockImplementationOnce(() => {});
    expect(checks.transitionProviderCheck(key, null, "support")).toBe(false);
    expect(checks.pendingProviderCheck(key)).toBeNull();
  });

  it("does not overwrite an unreadable prior receipt to admit a purchase", async () => {
    const checks = await loadChecks();
    records.set(storageKey, "purchased_without_tracking:ref");
    storage.getItem.mockImplementationOnce(() => {
      throw Error("storage blocked");
    });
    expect(checks.transitionProviderCheck(key, null, "support")).toBe(false);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(checks.pendingProviderCheck(key)).toBe("purchased_without_tracking:ref");
  });

  it("retains support-only admission after an enrichment failure and a fresh module load", async () => {
    const checks = await loadChecks();
    expect(checks.transitionProviderCheck(key, null, "support")).toBe(true);
    expect(records.get(storageKey)).toBe("support");
    storage.setItem.mockImplementationOnce(() => {
      throw Error("quota");
    });
    checks.rememberProviderCheck(key, "purchased_without_tracking:receipt");
    expect(checks.pendingProviderCheck(key)).toBe("purchased_without_tracking:receipt");
    expect(checks.transitionProviderCheck(key, "support", "unknown")).toBe(false);
    jest.resetModules();
    const reloaded = await loadChecks();
    expect(reloaded.pendingProviderCheck(key)).toBe("support");
    expect(reloaded.transitionProviderCheck(key, null, "support")).toBe(false);
  });

  it("only clears verified unknown evidence and retains protection when removal fails", async () => {
    const checks = await loadChecks();
    expect(checks.transitionProviderCheck(key, null, "support")).toBe(true);
    expect(checks.transitionProviderCheck(key, "unknown", null)).toBe(false);
    expect(checks.transitionProviderCheck(key, "support", "unknown")).toBe(true);
    storage.removeItem.mockImplementationOnce(() => {});
    expect(checks.transitionProviderCheck(key, "unknown", null)).toBe(false);
    expect(checks.pendingProviderCheck(key)).toBe("unknown");
    expect(checks.transitionProviderCheck(key, "unknown", null)).toBe(true);
    expect(checks.pendingProviderCheck(key)).toBeNull();
  });
});
