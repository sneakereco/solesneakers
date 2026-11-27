import { GET } from "@/app/api/readyz/route";
import { createClient } from "@supabase/supabase-js";
import { Redis } from "@upstash/redis";

jest.mock("@supabase/supabase-js", () => ({ createClient: jest.fn() }));
jest.mock("@upstash/redis", () => ({ Redis: jest.fn() }));
it("retains public dependency probe failures without returning raw DB, Redis or reply data", async () => {
  const limit = jest.fn();
  const ping = jest.fn();
  jest
    .mocked(createClient)
    .mockReturnValue({ from: () => ({ select: () => ({ limit }) }) } as never);
  jest.mocked(Redis).mockImplementation(() => ({ ping }) as never);
  limit.mockResolvedValue({ error: null });
  limit.mockResolvedValueOnce({ error: { message: "SYNTHETIC_SECRET_DB" } });
  ping.mockRejectedValueOnce(Error("SYNTHETIC_SECRET_REDIS"));
  ping.mockResolvedValueOnce("SYNTHETIC_SECRET_REPLY");
  for (const reason of [
    "Supabase query failed",
    "Redis unreachable",
    "Upstash returned invalid response",
  ]) {
    const result = await GET();
    expect(result.status).toBe(500);
    const body = await result.text();
    expect(body).toContain(reason);
    expect(body.includes("SYNTHETIC_SECRET")).toBe(false);
  }
});
