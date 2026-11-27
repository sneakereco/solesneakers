import { renderToStaticMarkup } from "react-dom/server";
import type * as React from "react";
import { UnlockTimer } from "@/app/locked/unlock-timer";

const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  refresh: jest.fn(),
};
let mockEffect: () => void | (() => void);
let mockRefIndex = 0;
let mockRefs: { current: unknown }[] = [];

jest.mock("next/navigation", () => ({ useRouter: () => mockRouter }));
jest.mock("react", () => {
  const actual = jest.requireActual<typeof React>("react");
  return {
    ...actual,
    useEffect: (effect: typeof mockEffect) => {
      mockEffect = effect;
    },
    useRef: (initial: unknown) => {
      const index = mockRefIndex++;
      mockRefs[index] ??= { current: initial };
      return mockRefs[index];
    },
  };
});

// SSR supplies the real component render; run its captured client effect and
// retain ref cells when replaying it or changing props on the same mount.
function renderTimer(unlockAtIso: string) {
  mockRefIndex = 0;
  renderToStaticMarkup(<UnlockTimer unlockAtIso={unlockAtIso} />);
  return mockEffect;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2026-11-27T12:00:00.000Z"));
  jest.clearAllMocks();
  mockRefs = [];
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

it("navigates only once while the expired timer remains mounted", () => {
  const cleanup = renderTimer("2026-11-27T11:59:59.000Z")();
  jest.advanceTimersByTime(10_000);

  expect(mockRouter.push.mock.calls.length + mockRouter.replace.mock.calls.length).toBe(
    1,
  );
  expect(mockRouter.replace).toHaveBeenCalledWith("/");
  expect(mockRouter.refresh).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
  cleanup?.();
});

it("does not repeat navigation when StrictMode replays the effect", () => {
  const effect = renderTimer("2026-11-27T11:59:59.000Z");
  effect()?.();
  const cleanup = effect();
  jest.advanceTimersByTime(5_000);

  expect(mockRouter.replace).toHaveBeenCalledTimes(1);
  expect(mockRouter.push).not.toHaveBeenCalled();
  expect(mockRouter.refresh).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
  cleanup?.();
});

it("counts down to a future opening and releases the interval at zero", () => {
  const cleanup = renderTimer("2026-11-27T12:00:03.000Z")();
  jest.advanceTimersByTime(2_000);
  expect(mockRouter.replace).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(1);

  jest.advanceTimersByTime(1_000);
  expect(mockRouter.replace).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
  jest.advanceTimersByTime(10_000);
  expect(mockRouter.replace).toHaveBeenCalledTimes(1);
  cleanup?.();
});

it("cleans up on unmount and starts a new countdown when the opening changes", () => {
  let cleanup = renderTimer("2026-11-27T11:59:59.000Z")();
  cleanup?.();
  cleanup = renderTimer("2026-11-27T12:00:05.000Z")();
  jest.advanceTimersByTime(4_000);
  expect(mockRouter.replace).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(1);
  jest.advanceTimersByTime(1_000);
  expect(mockRouter.replace).toHaveBeenCalledTimes(2);
  expect(jest.getTimerCount()).toBe(0);
  cleanup?.();

  cleanup = renderTimer("2026-11-27T12:01:00.000Z")();
  expect(jest.getTimerCount()).toBe(1);
  cleanup?.();
  expect(jest.getTimerCount()).toBe(0);
  jest.advanceTimersByTime(60_000);
  expect(mockRouter.replace).toHaveBeenCalledTimes(2);
});

it("never navigates for an invalid opening timestamp", () => {
  const cleanup = renderTimer("invalid")();
  jest.advanceTimersByTime(10_000);
  expect(mockRouter.replace).not.toHaveBeenCalled();
  expect(mockRouter.push).not.toHaveBeenCalled();
  expect(mockRouter.refresh).not.toHaveBeenCalled();
  cleanup?.();
  expect(jest.getTimerCount()).toBe(0);
});
