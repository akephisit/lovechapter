export type EmailMessage = {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
};

export interface EmailSender {
  send(
    message: EmailMessage,
    idempotencyKey: string,
  ): Promise<{ providerMessageId: string }>;
}

export type EmailDeliveryErrorCode =
  | "provider_timeout"
  | "provider_rate_limited"
  | "provider_rejected"
  | "provider_unavailable";

export class EmailDeliveryError extends Error {
  override readonly name = "EmailDeliveryError";

  constructor(
    readonly code: EmailDeliveryErrorCode,
    readonly retryable: boolean,
  ) {
    super(code);
  }
}

type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export function createResendEmailSender(options: {
  apiKey: string;
  fetch?: FetchImplementation;
  timeoutMilliseconds?: number;
}): EmailSender {
  const fetchImplementation = options.fetch ?? fetch;
  const timeoutMilliseconds = options.timeoutMilliseconds ?? 10_000;
  return {
    async send(message, idempotencyKey) {
      let response: Response;
      try {
        response = await fetchImplementation("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey,
          },
          body: JSON.stringify(message),
          signal: AbortSignal.timeout(timeoutMilliseconds),
        });
      } catch (error) {
        if (error instanceof EmailDeliveryError) throw error;
        if (
          error instanceof DOMException &&
          ["AbortError", "TimeoutError"].includes(error.name)
        ) {
          throw new EmailDeliveryError("provider_timeout", true);
        }
        throw new EmailDeliveryError("provider_unavailable", true);
      }

      if (response.ok) {
        const body = await safeJson(response);
        const providerMessageId = stringProperty(body, "id");
        if (providerMessageId) return { providerMessageId };
        throw new EmailDeliveryError("provider_unavailable", true);
      }

      if (response.status === 409) {
        const body = await safeJson(response);
        const name = stringProperty(body, "name");
        if (name === "concurrent_idempotent_requests") {
          throw new EmailDeliveryError("provider_unavailable", true);
        }
        throw new EmailDeliveryError("provider_rejected", false);
      }
      if (response.status === 429) {
        throw new EmailDeliveryError("provider_rate_limited", true);
      }
      if (response.status >= 500) {
        throw new EmailDeliveryError("provider_unavailable", true);
      }
      throw new EmailDeliveryError("provider_rejected", false);
    },
  };
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function stringProperty(value: unknown, property: string): string | null {
  if (!value || typeof value !== "object" || !(property in value)) return null;
  const result = value[property as keyof typeof value];
  return typeof result === "string" && result ? result : null;
}
