import { setAnalyticsConsent } from "@/Modules/Analytics/Source/Features/VisitorMeasurement/consent";
it("serializes simultaneous grants so another tab can reuse the first response cookie", async () => {
  // Simulate two requests reaching the route while neither has received a grant cookie.
  let receipt: string | null = null;
  let issued = 0;
  const fetcher = jest.spyOn(globalThis, "fetch").mockImplementation(async () => {
    const cookie = receipt;
    await new Promise((resolve) => setTimeout(resolve, 5));
    receipt = cookie ?? "123e4567-e89b-42d3-a456-" + String(++issued).padStart(12, "0");
    return Response.json({ choice: "accepted", receiptId: receipt });
  });
  let tail = Promise.resolve<unknown>(undefined);
  const locks = {
    request: (_name: string, job: () => Promise<unknown>) => {
      const next = tail.then(job);
      tail = next;
      return next;
    },
  };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { navigator: { locks }, localStorage: { getItem: () => null } },
  });
  try {
    const [a, b] = await Promise.all([
      setAnalyticsConsent("accepted"),
      setAnalyticsConsent("accepted"),
    ]);
    expect(a).toEqual(b);
    expect(issued).toBe(1);
  } finally {
    fetcher.mockRestore();
    Reflect.deleteProperty(globalThis, "window");
  }
});
it("refuses concurrent new grants without Web Locks and still withdraws a previous receipt", async () => {
  const active = new Set(["previous"]);
  let cookie = "previous",
    n = 0;
  const fetcher = jest.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
    const { choice } = JSON.parse(String(init?.body));
    if (choice === "accepted") {
      cookie = "grant-" + ++n;
      active.add(cookie);
    } else active.delete(cookie);
    return Promise.resolve(
      Response.json({ choice, receiptId: "123e4567-e89b-42d3-a456-426614174000" }),
    );
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      navigator: {},
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    },
  });
  try {
    const choices = await Promise.allSettled([
      setAnalyticsConsent("accepted"),
      setAnalyticsConsent("accepted"),
    ]);
    expect(choices.map((choice) => choice.status)).toEqual(["rejected", "rejected"]);
    expect(fetcher).not.toHaveBeenCalled();
    expect(await setAnalyticsConsent("declined")).toEqual({ choice: "declined" });
    expect(active.size).toBe(0);
  } finally {
    fetcher.mockRestore();
    Reflect.deleteProperty(globalThis, "window");
  }
});
