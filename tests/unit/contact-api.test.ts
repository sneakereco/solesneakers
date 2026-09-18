jest.mock("@upstash/redis", () => ({ Redis: jest.fn() }));
jest.mock("@upstash/ratelimit", () => ({
  Ratelimit: Object.assign(
    jest.fn(() => ({ limit: () => Promise.resolve({ success: true }) })),
    { slidingWindow: jest.fn() },
  ),
}));
jest.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: () =>
    Promise.resolve({
      auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
    }),
}));
jest.mock("@/lib/supabase/service-role", () => ({
  createSupabaseAdminClient: jest.fn(),
}));
jest.mock("@/lib/email/mailer", () => ({ sendEmail: jest.fn() }));

import { POST } from "@/app/api/contact/route";
import { createSupabaseAdminClient } from "@/lib/supabase/service-role";
import { sendEmail } from "@/lib/email/mailer";

const message = {
  name: "Customer",
  email: "customer@example.com",
  subject: "Order question",
  message: "Is <script> safe?",
};
const insert = jest.fn(() => ({
  select: () => ({
    single: () => Promise.resolve({ data: { id: "message-id" }, error: null }),
  }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  jest
    .mocked(createSupabaseAdminClient)
    .mockReturnValue({ from: () => ({ insert }) } as never);
});

it("saves a text contact message and emails support with escaped content", async () => {
  const response = await POST(
    new Request("https://example.com/api/contact", {
      method: "POST",
      body: JSON.stringify(message),
      headers: { "content-type": "application/json" },
    }) as never,
  );
  expect(response.status).toBe(200);
  expect(insert).toHaveBeenCalledWith({
    ...message,
    source: "contact_form",
    user_id: null,
  });
  expect(sendEmail).toHaveBeenCalledWith(
    expect.objectContaining({
      to: "SolesneakersLLC@yahoo.com",
      subject: "Contact: Order question",
      html: expect.stringContaining("&lt;script&gt;"),
    }),
  );
  expect(jest.mocked(sendEmail).mock.calls[0][0]).not.toHaveProperty("attachments");
});

it.each([{ source: "bug_report" }, { attachments: ["photo.png"] }])(
  "rejects removed contact features: %j",
  async (extra) => {
    const response = await POST(
      new Request("https://example.com/api/contact", {
        method: "POST",
        body: JSON.stringify({ ...message, ...extra }),
        headers: { "content-type": "application/json" },
      }) as never,
    );
    expect(response.status).toBe(400);
    expect(insert).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  },
);

it("rejects multipart uploads before processing files", async () => {
  const body = new FormData();
  Object.entries(message).forEach(([key, value]) => body.append(key, value));
  body.append("attachments", new Blob(["image"], { type: "image/png" }), "photo.png");
  const response = await POST(
    new Request("https://example.com/api/contact", {
      method: "POST",
      body,
    }) as never,
  );
  expect(response.status).toBe(415);
  expect(insert).not.toHaveBeenCalled();
});
