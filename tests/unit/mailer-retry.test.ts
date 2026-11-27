const mockSendMail = jest.fn();
const mockCreateTransport = jest.fn();
jest.mock("nodemailer", () => ({
  __esModule: true,
  default: { createTransport: mockCreateTransport },
}));

const message = {
  to: "recipient@example.invalid",
  subject: "Fixture",
  html: "<p>Fixture</p>",
};

beforeEach(() => {
  jest.resetModules();
  jest.useFakeTimers();
  mockSendMail.mockReset();
  mockCreateTransport.mockReset().mockReturnValue({ sendMail: mockSendMail });
});
afterEach(() => jest.useRealTimers());

it("awaits a slow successful transport without timing out and sending a duplicate", async () => {
  const accepted: string[] = [];
  mockSendMail.mockImplementation(
    () =>
      new Promise((resolve) =>
        setTimeout(() => {
          accepted.push("accepted");
          resolve({ messageId: "slow-acceptance" });
        }, 1100),
      ),
  );
  const { sendEmailWithRetry } = await import("@/lib/email/mailer");
  const result = sendEmailWithRetry(message, {
    maxAttempts: 2,
    baseDelayMs: 0,
    timeoutMs: 1000,
  }).then(
    (value) => ({ value }),
    (error) => ({ error: error.message }),
  );
  await jest.advanceTimersByTimeAsync(2200);
  expect(await result).toEqual({ value: { messageId: "slow-acceptance" } });
  expect(mockSendMail).toHaveBeenCalledTimes(1);
  expect(accepted).toHaveLength(1);
});

it("uses bounded transport timeouts and retries a definite rejection", async () => {
  mockSendMail
    .mockRejectedValueOnce(new Error("SMTP rejected"))
    .mockResolvedValueOnce({ messageId: "retry-accepted" });
  const { sendEmailWithRetry } = await import("@/lib/email/mailer");
  const result = sendEmailWithRetry(message, {
    maxAttempts: 2,
    baseDelayMs: 100,
    timeoutMs: 1000,
  });
  await jest.advanceTimersByTimeAsync(100);
  await expect(result).resolves.toEqual({ messageId: "retry-accepted" });
  expect(mockSendMail).toHaveBeenCalledTimes(2);
  expect(mockCreateTransport).toHaveBeenCalledWith(
    expect.objectContaining({
      connectionTimeout: 1000,
      greetingTimeout: 1000,
      socketTimeout: 1000,
    }),
  );
});

it("propagates a failed single attempt so the durable queue can schedule a retry", async () => {
  mockSendMail.mockRejectedValue(new Error("SMTP rejected"));
  const { sendEmailWithRetry } = await import("@/lib/email/mailer");
  await expect(sendEmailWithRetry(message, { maxAttempts: 1 })).rejects.toThrow(
    "SMTP rejected",
  );
  expect(mockSendMail).toHaveBeenCalledTimes(1);
});
