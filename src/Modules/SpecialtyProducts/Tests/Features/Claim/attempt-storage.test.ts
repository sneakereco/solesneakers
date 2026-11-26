import type * as AttemptStorageModule from "@/Modules/SpecialtyProducts/Source/Features/Claim/attempt-storage";
type AttemptStorage = typeof AttemptStorageModule;
let createAttempt: AttemptStorage["createAttempt"],
  readAttempt: AttemptStorage["readAttempt"],
  readSavedAttempts: AttemptStorage["readSavedAttempts"],
  saveAttempt: AttemptStorage["saveAttempt"],
  hasDurableAttemptStorage: AttemptStorage["hasDurableAttemptStorage"],
  attemptStorageKey: AttemptStorage["ATTEMPT_STORAGE_KEY"];
const id = "11111111-1111-4111-8111-111111111111";
const values = new Map<string, string>();
beforeEach(() => {
  jest.resetModules();
  ({
    createAttempt,
    readAttempt,
    readSavedAttempts,
    saveAttempt,
    hasDurableAttemptStorage,
    ATTEMPT_STORAGE_KEY: attemptStorageKey,
  } = jest.requireActual<AttemptStorage>(
    "@/Modules/SpecialtyProducts/Source/Features/Claim/attempt-storage",
  ));
  values.clear();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      sessionStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => {
          values.set(key, value);
        },
      },
      dispatchEvent: () => {},
    },
  });
});
afterEach(() => {
  Reflect.deleteProperty(globalThis, "window");
});
test("stores only opaque product/attempt/recovery credentials with secure entropy", () => {
  const attempt = createAttempt(id);
  saveAttempt(attempt);
  expect(attempt.attemptId).toMatch(/^[a-f0-9-]{36}$/);
  expect(attempt.recoverySecret).toMatch(/^[a-f0-9]{64}$/);
  expect(readAttempt(id)).toEqual(attempt);
  expect(JSON.parse(values.get(attemptStorageKey)!)).toEqual([attempt]);
  expect(Object.keys(attempt).sort()).toEqual([
    "attemptId",
    "productId",
    "recoverySecret",
  ]);
  expect(createAttempt(id).recoverySecret).not.toBe(attempt.recoverySecret);
});
test.each([
  "{",
  '[{"__proto__":{"polluted":true}}]',
  '[{"productId":"bad","attemptId":"bad","recoverySecret":"short"}]',
])("rejects unsafe stored data %s", (value) => {
  values.set(attemptStorageKey, value);
  expect(readSavedAttempts()).toEqual([]);
  expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
});
test("unavailable session storage retains the same attempt in memory and reports the limit", () => {
  const attempt = createAttempt("22222222-2222-4222-8222-222222222222");
  Object.defineProperty(window, "sessionStorage", {
    get() {
      throw new Error("blocked");
    },
  });
  saveAttempt(attempt);
  expect(readAttempt(attempt.productId)).toEqual(attempt);
  expect(hasDurableAttemptStorage()).toBe(false);
});
test("contact fields cannot be accidentally saved with an attempt", () => {
  expect(() =>
    saveAttempt({ ...createAttempt(id), address: "private" } as never),
  ).toThrow();
  expect(values.size).toBe(0);
});
test("readable but quota-exceeded storage preserves credentials through listener rereads", () => {
  const attempt = createAttempt(id);
  let observed: ReturnType<AttemptStorage["readSavedAttempts"]> = [];
  Object.defineProperty(window, "dispatchEvent", {
    value: () => {
      observed = readSavedAttempts();
      return true;
    },
  });
  window.sessionStorage.setItem = () => {
    throw new Error("quota exceeded");
  };
  saveAttempt(attempt);
  expect(observed.length).toBe(1);
  expect(
    observed[0]?.attemptId === attempt.attemptId &&
      observed[0]?.recoverySecret === attempt.recoverySecret,
  ).toBe(true);
  expect(readAttempt(id)?.recoverySecret === attempt.recoverySecret).toBe(true);
  expect(hasDurableAttemptStorage()).toBe(false);
  window.sessionStorage.setItem = (key, value) => {
    values.set(key, value);
  };
  saveAttempt(attempt);
  expect(hasDurableAttemptStorage()).toBe(true);
  expect(JSON.parse(values.get(attemptStorageKey)!)).toEqual([attempt]);
});
test("a confirmed closed attempt can be replaced once without losing the replacement on write failure", () => {
  const api = jest.requireActual<AttemptStorage>(
    "@/Modules/SpecialtyProducts/Source/Features/Claim/attempt-storage",
  );
  const previous = createAttempt(id);
  saveAttempt(previous);
  window.sessionStorage.setItem = () => {
    throw new Error("quota exceeded");
  };
  const next = api.replaceClosedAttempt(previous);
  expect(
    next.attemptId !== previous.attemptId &&
      next.recoverySecret !== previous.recoverySecret,
  ).toBe(true);
  expect(readAttempt(id)?.attemptId === next.attemptId).toBe(true);
  expect(readAttempt(id)?.recoverySecret === next.recoverySecret).toBe(true);
  expect(hasDurableAttemptStorage()).toBe(false);
  expect(() => api.replaceClosedAttempt(previous)).toThrow();
  expect(() => saveAttempt(previous)).toThrow();
});
