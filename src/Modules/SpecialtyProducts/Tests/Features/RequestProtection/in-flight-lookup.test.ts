import { createInFlightLookup } from "@/Modules/SpecialtyProducts/Source/Features/RequestProtection/in-flight-lookup";
test("1000 concurrent metadata reads share only the pending lookup; later reads stay fresh", async () => {
  const lookup = createInFlightLookup<number>(),
    load = jest.fn(() => Promise.resolve(42));
  expect(
    await Promise.all(Array.from({ length: 1000 }, () => lookup("prize", load))),
  ).toEqual(Array(1000).fill(42));
  expect(load).toHaveBeenCalledTimes(1);
  expect(await lookup("prize", () => Promise.resolve(43))).toBe(43);
});
test("different prizes stay independent and failed lookups can retry", async () => {
  const lookup = createInFlightLookup<number>();
  await expect(lookup("bad", () => Promise.reject(Error("unavailable")))).rejects.toThrow(
    "unavailable",
  );
  expect(await lookup("bad", () => Promise.resolve(7))).toBe(7);
  expect(
    await Promise.all([
      lookup("a", () => Promise.resolve(1)),
      lookup("b", () => Promise.resolve(2)),
    ]),
  ).toEqual([1, 2]);
});
