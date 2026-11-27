import { readJsonResponse, ResponseError } from "@/lib/http/read-json-response";

const fallback = "Orders could not load.";

describe("readJsonResponse", () => {
  it("returns parsed JSON from a successful response", async () => {
    await expect(
      readJsonResponse<{ orders: string[] }>(
        Response.json({ orders: ["order-1"] }),
        fallback,
      ),
    ).resolves.toEqual({ orders: ["order-1"] });
  });

  it.each([
    [401, "Unauthorized"],
    [429, "Too Many Requests"],
    [503, "Service Unavailable"],
  ])(
    "classifies an HTTP %i without exposing the server response",
    async (status, statusText) => {
      const response = Response.json(
        { error: "Private database connection details" },
        { status, statusText },
      );
      const result = readJsonResponse(response, fallback);

      await expect(result).rejects.toBeInstanceOf(ResponseError);
      await expect(result).rejects.toMatchObject({ status, message: fallback });
    },
  );

  it("uses the HTTP status when a failed response has no JSON body", async () => {
    const result = readJsonResponse(
      new Response("<h1>Gateway error</h1>", { status: 503 }),
      fallback,
    );

    await expect(result).rejects.toBeInstanceOf(ResponseError);
    await expect(result).rejects.toMatchObject({ status: 503, message: fallback });
  });

  it("reports malformed success data without exposing the parse error", async () => {
    const result = readJsonResponse(
      new Response("<html>Private upstream response</html>"),
      fallback,
    );

    await expect(result).rejects.toBeInstanceOf(ResponseError);
    await expect(result).rejects.toMatchObject({ status: 200, message: fallback });
  });
});
