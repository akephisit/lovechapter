import { describe, expect, it, vi } from "vitest";

import {
  createResendEmailSender,
  EmailDeliveryError,
  type EmailMessage,
} from "./resend-email-sender";

const message: EmailMessage = {
  from: "auth@example.test",
  to: "couple@example.test",
  subject: "Verify your LoveChapter email",
  text: "Open the verification link.",
  html: "<p>Open the verification link.</p>",
};

describe("Resend email sender", () => {
  it("uses standard fetch with a stable idempotency key", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ id: "email_123" }, { status: 200 }),
    );
    const sender = createResendEmailSender({
      apiKey: "re_test_secret",
      fetch: fetchMock,
    });

    await expect(
      sender.send(message, "auth-email/018f0000-0000-7000-8000-000000000001"),
    ).resolves.toEqual({ providerMessageId: "email_123" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer re_test_secret",
          "Content-Type": "application/json",
          "Idempotency-Key": "auth-email/018f0000-0000-7000-8000-000000000001",
        }),
      }),
    );
  });

  it.each([
    ["concurrent_idempotent_requests", "provider_unavailable", true],
    ["invalid_idempotent_request", "provider_rejected", false],
  ] as const)(
    "classifies Resend 409 %s without exposing its response body",
    async (name, code, retryable) => {
      const sender = createResendEmailSender({
        apiKey: "re_test_secret",
        fetch: async () =>
          Response.json(
            { name, message: "sensitive provider detail" },
            {
              status: 409,
            },
          ),
      });

      await expect(sender.send(message, "auth-email/job-id")).rejects.toEqual(
        expect.objectContaining({ code, retryable }),
      );
    },
  );

  it("classifies timeouts with a sanitized retryable code", async () => {
    const sender = createResendEmailSender({
      apiKey: "re_test_secret",
      fetch: async () => {
        throw new DOMException("request timed out", "TimeoutError");
      },
    });

    await expect(sender.send(message, "auth-email/job-id")).rejects.toEqual(
      new EmailDeliveryError("provider_timeout", true),
    );
  });
});
