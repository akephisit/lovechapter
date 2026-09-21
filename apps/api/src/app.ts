import {
  AuthenticationRequiredError,
  ConflictError,
  DomainValidationError,
  NotFoundError,
  OnboardingRequiredError,
  type LoveChapterService,
} from "@lovechapter/domain";
import {
  Elysia,
  ParseError,
  status,
  t,
  ValidationError,
  type HTTPHeaders,
} from "elysia";
import { WebStandardAdapter } from "elysia/adapter/web-standard";

import "./elysia-typebox";

export type ApiDependencies = {
  publicWebOrigin: string;
  run<T>(
    request: Request,
    operation: (service: LoveChapterService) => Promise<T>,
  ): Promise<T>;
};

const idParams = t.Object({ weddingId: t.String({ format: "uuid" }) });
const guestParams = t.Object({
  weddingId: t.String({ format: "uuid" }),
  guestId: t.String({ format: "uuid" }),
});
const invitationParams = t.Object({
  invitationToken: t.String({ pattern: "^[A-Za-z0-9_-]{43}$" }),
});
const pageQuery = t.Object({
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100, default: 20 })),
  cursor: t.Optional(t.String({ minLength: 1, maxLength: 500 })),
});
const profileInput = t.Object(
  { displayName: t.String({ minLength: 1, maxLength: 120 }) },
  { additionalProperties: false },
);
const weddingInput = t.Object(
  {
    name: t.String({ minLength: 1, maxLength: 120 }),
    weddingDate: t.Optional(t.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" })),
    timeZone: t.String({ minLength: 1, maxLength: 64 }),
    locale: t.String({ minLength: 2, maxLength: 35 }),
  },
  { additionalProperties: false },
);
const guestInput = t.Object(
  {
    name: t.String({ minLength: 1, maxLength: 120 }),
    email: t.Optional(t.String({ maxLength: 320 })),
    allowedPartySize: t.Integer({ minimum: 1, maximum: 20 }),
  },
  { additionalProperties: false },
);
const rsvpInput = t.Object(
  {
    attendance: t.Union([t.Literal("attending"), t.Literal("declined")]),
    partySize: t.Integer({ minimum: 0, maximum: 20 }),
    note: t.Optional(t.String({ maxLength: 500 })),
  },
  { additionalProperties: false },
);

export function createApiApp(dependencies: ApiDependencies) {
  return new Elysia({ adapter: WebStandardAdapter })
    .afterHandle("global", ({ request, set }) => {
      applyCors(request, set.headers, dependencies.publicWebOrigin);
    })
    .error("global", ({ error, request, set }) => {
      applyCors(request, set.headers, dependencies.publicWebOrigin);
      if (error instanceof ValidationError || error instanceof ParseError) {
        return status(400, errorBody("validation_error", "Invalid request"));
      }
      if (error instanceof DomainValidationError) {
        return status(400, errorBody("validation_error", error.message));
      }
      if (error instanceof AuthenticationRequiredError) {
        return status(
          401,
          errorBody("authentication_required", "Authentication required"),
        );
      }
      if (error instanceof OnboardingRequiredError) {
        return status(
          403,
          errorBody("onboarding_required", "Profile setup required"),
        );
      }
      if (error instanceof NotFoundError) {
        return status(404, errorBody("not_found", "Resource not found"));
      }
      if (error instanceof ConflictError) {
        return status(409, errorBody("conflict", error.message));
      }
      return status(500, errorBody("internal_error", "Internal server error"));
    })
    .options("/*", ({ request, set }) => {
      applyCors(request, set.headers, dependencies.publicWebOrigin);
      return status(204);
    })
    .get("/health", () => ({ status: "ok" as const }))
    .get("/v1/me", ({ request }) =>
      dependencies.run(request, (service) => service.getMe()),
    )
    .patch("/v1/me", { body: profileInput }, ({ body, request }) =>
      dependencies.run(request, (service) => service.updateMyProfile(body)),
    )
    .get("/v1/weddings", { query: pageQuery }, ({ query, request }) =>
      dependencies.run(request, (service) =>
        service.listWeddings({
          limit: query.limit ?? 20,
          ...(query.cursor ? { cursor: query.cursor } : {}),
        }),
      ),
    )
    .post("/v1/weddings", { body: weddingInput }, async ({ body, request }) =>
      status(
        201,
        await dependencies.run(request, (service) =>
          service.createWedding(body),
        ),
      ),
    )
    .get(
      "/v1/weddings/:weddingId/guests",
      { params: idParams, query: pageQuery },
      ({ params, query, request }) =>
        dependencies.run(request, (service) =>
          service.listGuests(params.weddingId, {
            limit: query.limit ?? 20,
            ...(query.cursor ? { cursor: query.cursor } : {}),
          }),
        ),
    )
    .post(
      "/v1/weddings/:weddingId/guests",
      { params: idParams, body: guestInput },
      async ({ params, body, request }) =>
        status(
          201,
          await dependencies.run(request, (service) =>
            service.addGuest(params.weddingId, body),
          ),
        ),
    )
    .post(
      "/v1/weddings/:weddingId/guests/:guestId/invitations",
      { params: guestParams },
      async ({ params, request }) =>
        status(
          201,
          await dependencies.run(request, (service) =>
            service.createInvitation(params.weddingId, params.guestId),
          ),
        ),
    )
    .get(
      "/v1/public/invitations/:invitationToken",
      { params: invitationParams },
      ({ params, request }) =>
        dependencies.run(request, (service) =>
          service.getPublicInvitation(params.invitationToken),
        ),
    )
    .put(
      "/v1/public/invitations/:invitationToken/rsvp",
      { params: invitationParams, body: rsvpInput },
      ({ params, body, request }) =>
        dependencies.run(request, (service) =>
          service.submitRsvp(params.invitationToken, body),
        ),
    );
}

function errorBody(code: string, message: string) {
  return { error: { code, message } };
}

function applyCors(
  request: Request,
  headers: HTTPHeaders | Headers,
  publicWebOrigin: string,
): void {
  if (request.headers.get("origin") !== publicWebOrigin) return;
  if (headers instanceof Headers) {
    headers.set("Access-Control-Allow-Origin", publicWebOrigin);
    headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,OPTIONS");
    headers.set("Vary", "Origin");
    return;
  }
  headers["Access-Control-Allow-Origin"] = publicWebOrigin;
  headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization";
  headers["Access-Control-Allow-Methods"] = "GET,POST,PUT,PATCH,OPTIONS";
  headers.Vary = "Origin";
}
