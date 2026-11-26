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
