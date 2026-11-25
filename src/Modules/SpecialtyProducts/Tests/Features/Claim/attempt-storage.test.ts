import {
  createAttempt,
  readAttempt,
  readSavedAttempts,
  saveAttempt,
  hasDurableAttemptStorage,
  ATTEMPT_STORAGE_KEY,
} from "@/Modules/SpecialtyProducts/Source/Features/Claim/attempt-storage";
const id = "11111111-1111-4111-8111-111111111111";
const values = new Map<string, string>();
beforeEach(() => {
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
  expect(JSON.parse(values.get(ATTEMPT_STORAGE_KEY)!)).toEqual([attempt]);
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
  values.set(ATTEMPT_STORAGE_KEY, value);
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
