import { Redis } from "@upstash/redis";
import { createLoadRunStore } from "../../../Source/Features/LoadTesting/run-store";
import { fixtureSettings } from "./fixtures";
jest.mock("@upstash/redis", () => ({ Redis: jest.fn() }));
test("sibling deployments share a resource lock while their adapter data remains separate", async () => {
  const get = jest.fn().mockResolvedValue(null),
    evaluate = jest.fn().mockResolvedValue(1);
  jest
    .mocked(Redis)
    .mockImplementation(() => ({ get, eval: evaluate }) as unknown as Redis);
  const { settings } = fixtureSettings(),
    other = {
      ...settings,
      target: {
        ...settings.target,
        expected: { ...settings.target.expected, deploymentId: "dpl_other" },
      },
    };
  const first = createLoadRunStore(settings),
    second = createLoadRunStore(other);
  for (const store of [first, second])
    await store.mutate(
      "lock",
      "target",
      { runId: "run", expiresAt: 1 },
      (value) => value,
    );
  expect(evaluate.mock.calls[0][1][0]).toBe(evaluate.mock.calls[1][1][0]);
  get.mockClear();
  await first.get("run", "same");
  await second.get("run", "same");
  expect(get.mock.calls[0][0]).not.toBe(get.mock.calls[1][0]);
});
