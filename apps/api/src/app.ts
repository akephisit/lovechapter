import { AuthServiceError, type AuthService } from "@lovechapter/auth";
import type { GuestImportMapping } from "@lovechapter/contracts";
import type { EnvelopeTemplateInput } from "@lovechapter/contracts";
import {
  AuthenticationRequiredError,
  ConflictError,
  DomainValidationError,
  NotFoundError,
  OnboardingRequiredError,
  RateLimitExceededError,
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
import { parseGuestCsv } from "./guest-csv-parser";
import {
  authorizeIngress,
  RequestSecurityError,
  requireJsonContentType,
  isGuestCsvUpload,
  requireGuestCsvContentType,
  requireMutationOrigin,
} from "./request-security";
import {
  expireSessionCookie,
  readSessionCookie,
  serializeSessionCookie,
  type CookieEnvironment,
} from "./session-cookie";

export type ApiDependencies = {
  authService: Pick<
    AuthService,
    | "signUp"
    | "resendVerificationEmail"
    | "verifyEmail"
    | "signIn"
    | "resolveSession"
    | "signOut"
    | "forgotPassword"
    | "resetPassword"
  >;
  nodeEnvironment: CookieEnvironment;
  publicWebOrigin: string;
  proxyCredential: string;
  fingerprintKey: Uint8Array;
  readiness(): Promise<void>;
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
const guestImportParams = t.Object({
  weddingId: t.String({ format: "uuid" }),
  batchId: t.String({ format: "uuid" }),
});
const envelopeTemplateParams = t.Object({
  weddingId: t.String({ format: "uuid" }),
  templateId: t.String({ format: "uuid" }),
});
const envelopeTemplateInput = t.Object(
  {
    name: t.String({ minLength: 1, maxLength: 80 }),
    widthMm: t.Integer({ minimum: 90, maximum: 330 }),
    heightMm: t.Integer({ minimum: 55, maximum: 480 }),
    orientation: t.Union([t.Literal("landscape"), t.Literal("portrait")]),
    marginTopMm: t.Integer({ minimum: 0, maximum: 480 }),
    marginRightMm: t.Integer({ minimum: 0, maximum: 480 }),
    marginBottomMm: t.Integer({ minimum: 0, maximum: 480 }),
    marginLeftMm: t.Integer({ minimum: 0, maximum: 480 }),
    alignment: t.Union([
      t.Literal("left"),
      t.Literal("center"),
      t.Literal("right"),
    ]),
    fontFamily: t.Union([
      t.Literal("noto-sans-thai"),
      t.Literal("noto-serif-thai"),
    ]),
    fontSizePt: t.Integer({ minimum: 8, maximum: 72 }),
    lineSpacingPercent: t.Integer({ minimum: 80, maximum: 250 }),
    showAddress: t.Boolean(),
  },
  { additionalProperties: false },
);
const envelopePrintInput = t.Object(
  {
    guestIds: t.Array(t.String({ format: "uuid" }), {
      minItems: 1,
      maxItems: 500,
      uniqueItems: true,
    }),
    templateId: t.Optional(t.String({ format: "uuid" })),
    template: t.Optional(envelopeTemplateInput),
  },
  { additionalProperties: false },
);
const guestImportMappingInput = t.Object(
  {
    expectedVersion: t.Integer({ minimum: 1 }),
    mapping: t.Record(
      t.String(),
      t.Union([t.Integer({ minimum: 0, maximum: 39 }), t.Null()]),
    ),
    affiliationMappings: t.Record(t.String(), t.String({ format: "uuid" })),
    excludedRowIds: t.Array(t.String({ format: "uuid" }), {
      maxItems: 5000,
      uniqueItems: true,
    }),
  },
  { additionalProperties: false },
);
const guestImportCommitInput = t.Object(
  {
    expectedVersion: t.Integer({ minimum: 1 }),
    includedRowIds: t.Array(t.String({ format: "uuid" }), {
      maxItems: 5000,
      uniqueItems: true,
    }),
    createAnywayRowIds: t.Array(t.String({ format: "uuid" }), {
      maxItems: 5000,
      uniqueItems: true,
    }),
    idempotencyKey: t.String({ minLength: 1, maxLength: 128 }),
  },
  { additionalProperties: false },
);
const affiliationParams = t.Object({
  weddingId: t.String({ format: "uuid" }),
  affiliationId: t.String({ format: "uuid" }),
});
const invitationParams = t.Object({
  invitationToken: t.String({ pattern: "^[A-Za-z0-9_-]{43}$" }),
});
const pageQuery = t.Object({
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100, default: 20 })),
  cursor: t.Optional(t.String({ minLength: 1, maxLength: 500 })),
});
const guestListQuery = t.Object({
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100, default: 20 })),
  cursor: t.Optional(t.String({ minLength: 1, maxLength: 500 })),
  search: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
  affiliation: t.Optional(
    t.Union([t.Literal("unassigned"), t.String({ format: "uuid" })]),
  ),
  rsvp: t.Optional(
    t.Union([
      t.Literal("pending"),
      t.Literal("attending"),
      t.Literal("declined"),
    ]),
  ),
  view: t.Optional(
    t.Union([t.Literal("active"), t.Literal("archived")], {
      default: "active",
    }),
  ),
});
const guestExportQuery = t.Pick(guestListQuery, [
  "search",
  "affiliation",
  "rsvp",
  "view",
]);
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
const planningTaskCreateInput = t.Object(
  {
    title: t.String({ minLength: 1, maxLength: 180 }),
    category: t.Optional(t.String({ maxLength: 80 })),
    note: t.Optional(t.String({ maxLength: 2_000 })),
    dueDate: t.Optional(t.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" })),
  },
  { additionalProperties: false },
);
const planningTaskPatchInput = t.Object(
  {
    title: t.Optional(t.String({ minLength: 1, maxLength: 180 })),
    category: t.Optional(t.Union([t.String({ maxLength: 80 }), t.Null()])),
    note: t.Optional(t.Union([t.String({ maxLength: 2_000 }), t.Null()])),
    dueDate: t.Optional(
      t.Union([t.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" }), t.Null()]),
    ),
    completed: t.Optional(t.Boolean()),
  },
  { additionalProperties: false },
);
const planningTaskParams = t.Object({
  weddingId: t.String({ format: "uuid" }),
  taskId: t.String({ format: "uuid" }),
});
const planningTaskQuery = t.Object(
  {
    limit: t.Optional(t.Numeric({ minimum: 1, maximum: 50 })),
    cursor: t.Optional(t.String({ minLength: 1, maxLength: 256 })),
    filter: t.Optional(
      t.Union([t.Literal("all"), t.Literal("open"), t.Literal("completed")]),
    ),
  },
  { additionalProperties: false },
);
const operationsPageQuery = t.Object(
  {
    limit: t.Optional(t.Numeric({ minimum: 1, maximum: 50 })),
    cursor: t.Optional(t.String({ minLength: 1, maxLength: 256 })),
  },
  { additionalProperties: false },
);
const amount = t.Integer({ minimum: 0, maximum: 1_000_000_000_000 });
const nullable = <
  T extends ReturnType<typeof t.String> | ReturnType<typeof t.Integer>,
>(
  field: T,
) => t.Optional(t.Union([field, t.Null()]));
const operationDate = t.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" });
const utcInstant = t.String({
  pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?Z$",
});
const budgetInput = t.Object(
  {
    currency: t.String({ pattern: "^[A-Za-z]{3}$" }),
    targetMinor: nullable(amount),
  },
  { additionalProperties: false },
);
const categoryInput = t.Object(
  { name: t.String({ minLength: 1, maxLength: 80 }) },
  { additionalProperties: false },
);
const vendorInput = t.Object(
  {
    name: t.String({ minLength: 1, maxLength: 180 }),
    status: t.Union([
      t.Literal("researching"),
      t.Literal("contacted"),
      t.Literal("booked"),
      t.Literal("cancelled"),
    ]),
    contactName: nullable(t.String({ maxLength: 120 })),
    email: nullable(t.String({ maxLength: 320 })),
    phone: nullable(t.String({ maxLength: 40 })),
    quoteMinor: nullable(amount),
    note: nullable(t.String({ maxLength: 2000 })),
  },
  { additionalProperties: false },
);
const expenseInput = t.Object(
  {
    title: t.String({ minLength: 1, maxLength: 180 }),
    plannedMinor: amount,
    paidMinor: amount,
    categoryId: nullable(t.String({ format: "uuid" })),
    vendorId: nullable(t.String({ format: "uuid" })),
    dueDate: nullable(operationDate),
    note: nullable(t.String({ maxLength: 2000 })),
  },
  { additionalProperties: false },
);
const runSheetInput = t.Object(
  {
    title: t.String({ minLength: 1, maxLength: 180 }),
    startsAt: utcInstant,
    endsAt: utcInstant,
    location: nullable(t.String({ maxLength: 180 })),
    responsible: nullable(t.String({ maxLength: 120 })),
    note: nullable(t.String({ maxLength: 2000 })),
  },
  { additionalProperties: false },
);
const tableInput = t.Object(
  {
    name: t.String({ minLength: 1, maxLength: 80 }),
    capacity: t.Integer({ minimum: 1, maximum: 100 }),
  },
  { additionalProperties: false },
);
const assignmentInput = t.Object(
  {
    tableId: t.Union([t.String({ format: "uuid" }), t.Null()]),
  },
  { additionalProperties: false },
);
const categoryParams = t.Object({
  weddingId: t.String({ format: "uuid" }),
  categoryId: t.String({ format: "uuid" }),
});
const vendorParams = t.Object({
  weddingId: t.String({ format: "uuid" }),
  vendorId: t.String({ format: "uuid" }),
});
const expenseParams = t.Object({
  weddingId: t.String({ format: "uuid" }),
  expenseId: t.String({ format: "uuid" }),
});
const runSheetParams = t.Object({
  weddingId: t.String({ format: "uuid" }),
  itemId: t.String({ format: "uuid" }),
});
const seatingTableParams = t.Object({
  weddingId: t.String({ format: "uuid" }),
  tableId: t.String({ format: "uuid" }),
});
const postalAddressInput = t.Object(
  {
    addressLine1: t.String({ minLength: 1, maxLength: 180 }),
    addressLine2: t.Optional(t.String({ maxLength: 180 })),
    locality: t.Optional(t.String({ maxLength: 120 })),
    administrativeArea: t.Optional(t.String({ maxLength: 120 })),
    postalCode: t.Optional(t.String({ maxLength: 32 })),
    countryCode: t.Optional(t.String({ pattern: "^[A-Za-z]{2}$" })),
  },
  { additionalProperties: false },
);
const guestInput = t.Object(
  {
    name: t.String({ minLength: 1, maxLength: 120 }),
    email: t.Optional(t.String({ maxLength: 320 })),
    phone: t.Optional(t.String({ maxLength: 40 })),
    allowedPartySize: t.Integer({ minimum: 1, maximum: 20 }),
    affiliationId: t.Optional(t.String({ format: "uuid" })),
    envelopeName: t.Optional(t.String({ maxLength: 180 })),
    note: t.Optional(t.String({ maxLength: 2_000 })),
    postalAddress: t.Optional(postalAddressInput),
  },
  { additionalProperties: false },
);
const guestUpdateInput = t.Object(
  {
    name: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
    email: t.Optional(t.String({ maxLength: 320 })),
    phone: t.Optional(t.String({ maxLength: 40 })),
    allowedPartySize: t.Optional(t.Integer({ minimum: 1, maximum: 20 })),
    affiliationId: t.Optional(t.String({ format: "uuid" })),
    envelopeName: t.Optional(t.String({ maxLength: 180 })),
    note: t.Optional(t.String({ maxLength: 2_000 })),
    postalAddress: t.Optional(t.Union([postalAddressInput, t.Null()])),
  },
  { additionalProperties: false },
);
const bulkGuestIdsInput = t.Object(
  {
    guestIds: t.Array(t.String({ format: "uuid" }), {
      minItems: 1,
      maxItems: 200,
      uniqueItems: true,
    }),
  },
  { additionalProperties: false },
);
const bulkGuestAffiliationInput = t.Object(
  {
    guestIds: t.Array(t.String({ format: "uuid" }), {
      minItems: 1,
      maxItems: 200,
      uniqueItems: true,
    }),
    affiliationId: t.Union([t.String({ format: "uuid" }), t.Null()]),
  },
  { additionalProperties: false },
);
const guestAffiliationInput = t.Object(
  {
    name: t.String({ minLength: 1, maxLength: 80 }),
    color: t.String({ pattern: "^#[0-9A-Fa-f]{6}$" }),
  },
  { additionalProperties: false },
);
const guestAffiliationOrderInput = t.Object(
  {
    ids: t.Array(t.String({ format: "uuid" }), {
      maxItems: 100,
      uniqueItems: true,
    }),
  },
  { additionalProperties: false },
);
const setGuestAffiliationInput = t.Object(
  {
    affiliationId: t.Union([t.String({ format: "uuid" }), t.Null()]),
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
const emailInput = t.Object(
  { email: t.String({ minLength: 1, maxLength: 320 }) },
  { additionalProperties: false },
);
const signUpInput = t.Object(
  {
    displayName: t.String({ minLength: 1, maxLength: 120 }),
    email: t.String({ minLength: 1, maxLength: 320 }),
    password: t.String({ minLength: 1, maxLength: 512 }),
  },
  { additionalProperties: false },
);
const signInInput = t.Object(
  {
    email: t.String({ minLength: 1, maxLength: 320 }),
    password: t.String({ minLength: 1, maxLength: 512 }),
  },
  { additionalProperties: false },
);
const tokenInput = t.Object(
  { token: t.String({ minLength: 1, maxLength: 512 }) },
  { additionalProperties: false },
);
const resetPasswordInput = t.Object(
  {
    token: t.String({ minLength: 1, maxLength: 512 }),
    password: t.String({ minLength: 1, maxLength: 512 }),
  },
  { additionalProperties: false },
);

export function createApiApp(dependencies: ApiDependencies) {
  return new Elysia({ adapter: WebStandardAdapter })
    .request(({ request }) => {
      enforceRequestSecurity(request, dependencies);
    })
    .derive("global", ({ request }) => {
      if (new URL(request.url).pathname === "/health/live") {
        return { ingressFingerprint: "" };
      }
      const ingress = authorizeIngress(request, {
        proxyCredential: dependencies.proxyCredential,
        fingerprintKey: dependencies.fingerprintKey,
      });
      return {
        ingressFingerprint: ingress.allowed ? ingress.fingerprint : "",
      };
    })
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
      if (error instanceof AuthServiceError) {
        return status(error.status, errorBody(error.code, error.message));
      }
      if (error instanceof RateLimitExceededError) {
        return status(429, errorBody(error.code, error.message));
      }
      if (error instanceof RequestSecurityError) {
        return status(error.status, errorBody(error.code, "Request rejected"));
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
      if (isDependencyUnavailable(error)) {
        return status(
          503,
          errorBody(
            "dependency_unavailable",
            "Service temporarily unavailable",
          ),
        );
      }
      return status(500, errorBody("internal_error", "Internal server error"));
    })
    .options("/*", ({ request, set }) => {
      applyCors(request, set.headers, dependencies.publicWebOrigin);
      return status(204);
    })
    .get("/health/live", () => ({ status: "ok" as const }))
    .get("/health/ready", async () => {
      try {
        await dependencies.readiness();
        return { status: "ok" as const };
      } catch {
        return status(503, { status: "unavailable" as const });
      }
    })
    .post(
      "/v1/auth/sign-up",
      { body: signUpInput },
      async ({ body, ingressFingerprint }) =>
        status(
          202,
          await dependencies.authService.signUp(body, ingressFingerprint),
        ),
    )
    .post(
      "/v1/auth/verification-email",
      { body: emailInput },
      async ({ body, ingressFingerprint }) =>
        status(
          202,
          await dependencies.authService.resendVerificationEmail(
            body,
            ingressFingerprint,
          ),
        ),
    )
    .post(
      "/v1/auth/verify-email",
      { body: tokenInput },
      ({ body, ingressFingerprint }) =>
        dependencies.authService.verifyEmail(body, ingressFingerprint),
    )
    .post(
      "/v1/auth/sign-in",
      { body: signInInput },
      async ({ body, ingressFingerprint, set }) => {
        const session = await dependencies.authService.signIn(
          body,
          ingressFingerprint,
        );
        set.headers["Set-Cookie"] = serializeSessionCookie(
          session.token,
          new Date(session.absoluteExpiresAt),
          dependencies.nodeEnvironment,
        );
        return { signedIn: true as const };
      },
    )
    .get("/v1/auth/session", async ({ request }) => {
      const token = readSessionCookie(request, dependencies.nodeEnvironment);
      const principal = token
        ? await dependencies.authService.resolveSession(token)
        : null;
      if (!principal) throw new AuthenticationRequiredError();
      return {
        user: {
          id: principal.subject,
          displayName: principal.displayName,
          ...(principal.email ? { email: principal.email } : {}),
          onboardingComplete: true,
        },
      };
    })
    .post("/v1/auth/sign-out", async ({ request, set }) => {
      await dependencies.authService.signOut(
        readSessionCookie(request, dependencies.nodeEnvironment),
      );
      set.headers["Set-Cookie"] = expireSessionCookie(
        dependencies.nodeEnvironment,
      );
      return status(204);
    })
    .post(
      "/v1/auth/forgot-password",
      { body: emailInput },
      async ({ body, ingressFingerprint }) =>
        status(
          202,
          await dependencies.authService.forgotPassword(
            body,
            ingressFingerprint,
          ),
        ),
    )
    .post(
      "/v1/auth/reset-password",
      { body: resetPasswordInput },
      async ({ body, ingressFingerprint, set }) => {
        const result = await dependencies.authService.resetPassword(
          body,
          ingressFingerprint,
        );
        set.headers["Set-Cookie"] = expireSessionCookie(
          dependencies.nodeEnvironment,
        );
        return result;
      },
    )
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
      "/v1/weddings/:weddingId/planning-overview",
      { params: idParams },
      ({ params, request }) =>
        dependencies.run(request, (service) =>
          service.getPlanningOverview(params.weddingId),
        ),
    )
    .get(
      "/v1/weddings/:weddingId/planning-tasks",
      { params: idParams, query: planningTaskQuery },
      ({ params, query, request }) =>
        dependencies.run(request, (service) =>
          service.listPlanningTasks(params.weddingId, {
            limit: query.limit ?? 20,
            filter: query.filter ?? "all",
            ...(query.cursor ? { cursor: query.cursor } : {}),
          }),
        ),
    )
    .post(
      "/v1/weddings/:weddingId/planning-tasks",
      { params: idParams, body: planningTaskCreateInput },
      async ({ params, body, request }) =>
        status(
          201,
          await dependencies.run(request, (service) =>
            service.createPlanningTask(params.weddingId, body),
          ),
        ),
    )
    .patch(
      "/v1/weddings/:weddingId/planning-tasks/:taskId",
      { params: planningTaskParams, body: planningTaskPatchInput },
      ({ params, body, request }) =>
        dependencies.run(request, (service) =>
          service.updatePlanningTask(params.weddingId, params.taskId, body),
        ),
    )
    .delete(
      "/v1/weddings/:weddingId/planning-tasks/:taskId",
      { params: planningTaskParams },
      async ({ params, request }) => {
        await dependencies.run(request, (service) =>
          service.deletePlanningTask(params.weddingId, params.taskId),
        );
        return status(204);
      },
    )
    .get(
      "/v1/weddings/:weddingId/budget",
      { params: idParams },
      ({ params, request }) =>
        dependencies.run(request, (service) =>
          service.getBudgetOverview(params.weddingId),
        ),
    )
    .put(
      "/v1/weddings/:weddingId/budget",
      { params: idParams, body: budgetInput },
      ({ params, body, request }) =>
        dependencies.run(request, (service) =>
          service.setBudget(params.weddingId, {
            currency: body.currency,
            targetMinor: body.targetMinor ?? null,
          }),
        ),
    )
    .get(
      "/v1/weddings/:weddingId/budget/categories",
      { params: idParams },
      ({ params, request }) =>
        dependencies.run(request, (service) =>
          service.listBudgetCategories(params.weddingId),
        ),
    )
    .post(
      "/v1/weddings/:weddingId/budget/categories",
      { params: idParams, body: categoryInput },
      async ({ params, body, request }) =>
        status(
          201,
          await dependencies.run(request, (service) =>
            service.saveBudgetCategory(params.weddingId, null, body),
          ),
        ),
    )
    .put(
      "/v1/weddings/:weddingId/budget/categories/:categoryId",
      { params: categoryParams, body: categoryInput },
      ({ params, body, request }) =>
        dependencies.run(request, (service) =>
          service.saveBudgetCategory(params.weddingId, params.categoryId, body),
        ),
    )
    .delete(
      "/v1/weddings/:weddingId/budget/categories/:categoryId",
      { params: categoryParams },
      async ({ params, request }) => {
        await dependencies.run(request, (service) =>
          service.deleteBudgetCategory(params.weddingId, params.categoryId),
        );
        return status(204);
      },
    )
    .get(
      "/v1/weddings/:weddingId/vendors",
      { params: idParams, query: operationsPageQuery },
      ({ params, query, request }) =>
        dependencies.run(request, (service) =>
          service.listVendors(params.weddingId, {
            limit: query.limit ?? 20,
            ...(query.cursor ? { cursor: query.cursor } : {}),
          }),
        ),
    )
    .post(
      "/v1/weddings/:weddingId/vendors",
      { params: idParams, body: vendorInput },
      async ({ params, body, request }) =>
        status(
          201,
          await dependencies.run(request, (service) =>
            service.saveVendor(params.weddingId, null, body),
          ),
        ),
    )
    .put(
      "/v1/weddings/:weddingId/vendors/:vendorId",
      { params: vendorParams, body: vendorInput },
      ({ params, body, request }) =>
        dependencies.run(request, (service) =>
          service.saveVendor(params.weddingId, params.vendorId, body),
        ),
    )
    .delete(
      "/v1/weddings/:weddingId/vendors/:vendorId",
      { params: vendorParams },
      async ({ params, request }) => {
        await dependencies.run(request, (service) =>
          service.deleteVendor(params.weddingId, params.vendorId),
        );
        return status(204);
      },
    )
    .get(
      "/v1/weddings/:weddingId/expenses",
      { params: idParams, query: operationsPageQuery },
      ({ params, query, request }) =>
        dependencies.run(request, (service) =>
          service.listExpenses(params.weddingId, {
            limit: query.limit ?? 20,
            ...(query.cursor ? { cursor: query.cursor } : {}),
          }),
        ),
    )
    .post(
      "/v1/weddings/:weddingId/expenses",
      { params: idParams, body: expenseInput },
      async ({ params, body, request }) =>
        status(
          201,
          await dependencies.run(request, (service) =>
            service.saveExpense(params.weddingId, null, body),
          ),
        ),
    )
    .put(
      "/v1/weddings/:weddingId/expenses/:expenseId",
      { params: expenseParams, body: expenseInput },
      ({ params, body, request }) =>
        dependencies.run(request, (service) =>
          service.saveExpense(params.weddingId, params.expenseId, body),
        ),
    )
    .delete(
      "/v1/weddings/:weddingId/expenses/:expenseId",
      { params: expenseParams },
      async ({ params, request }) => {
        await dependencies.run(request, (service) =>
          service.deleteExpense(params.weddingId, params.expenseId),
        );
        return status(204);
      },
    )
    .get(
      "/v1/weddings/:weddingId/run-sheet",
      { params: idParams, query: operationsPageQuery },
      ({ params, query, request }) =>
        dependencies.run(request, (service) =>
          service.listRunSheet(params.weddingId, {
            limit: query.limit ?? 20,
            ...(query.cursor ? { cursor: query.cursor } : {}),
          }),
        ),
    )
    .post(
      "/v1/weddings/:weddingId/run-sheet",
      { params: idParams, body: runSheetInput },
      async ({ params, body, request }) =>
        status(
          201,
          await dependencies.run(request, (service) =>
            service.saveRunSheetItem(params.weddingId, null, body),
          ),
        ),
    )
    .put(
      "/v1/weddings/:weddingId/run-sheet/:itemId",
      { params: runSheetParams, body: runSheetInput },
      ({ params, body, request }) =>
        dependencies.run(request, (service) =>
          service.saveRunSheetItem(params.weddingId, params.itemId, body),
        ),
    )
    .delete(
      "/v1/weddings/:weddingId/run-sheet/:itemId",
      { params: runSheetParams },
      async ({ params, request }) => {
        await dependencies.run(request, (service) =>
          service.deleteRunSheetItem(params.weddingId, params.itemId),
        );
        return status(204);
      },
    )
    .get(
      "/v1/weddings/:weddingId/seating/tables",
      { params: idParams },
      ({ params, request }) =>
        dependencies.run(request, (service) =>
          service.listSeatingTables(params.weddingId),
        ),
    )
    .post(
      "/v1/weddings/:weddingId/seating/tables",
      { params: idParams, body: tableInput },
      async ({ params, body, request }) =>
        status(
          201,
          await dependencies.run(request, (service) =>
            service.saveSeatingTable(params.weddingId, null, body),
          ),
        ),
    )
    .put(
      "/v1/weddings/:weddingId/seating/tables/:tableId",
      { params: seatingTableParams, body: tableInput },
      ({ params, body, request }) =>
        dependencies.run(request, (service) =>
          service.saveSeatingTable(params.weddingId, params.tableId, body),
        ),
    )
    .delete(
      "/v1/weddings/:weddingId/seating/tables/:tableId",
      { params: seatingTableParams },
      async ({ params, request }) => {
        await dependencies.run(request, (service) =>
          service.deleteSeatingTable(params.weddingId, params.tableId),
        );
        return status(204);
      },
    )
    .get(
      "/v1/weddings/:weddingId/seating/tables/:tableId/assignments",
      { params: seatingTableParams },
      ({ params, request }) =>
        dependencies.run(request, (service) =>
          service.listSeatingAssignments(params.weddingId, params.tableId),
        ),
    )
    .put(
      "/v1/weddings/:weddingId/seating/guests/:guestId",
      { params: guestParams, body: assignmentInput },
      async ({ params, body, request }) => {
        await dependencies.run(request, (service) =>
          service.assignSeating(params.weddingId, params.guestId, body.tableId),
        );
        return status(204);
      },
    )
    .get(
      "/v1/weddings/:weddingId/guest-affiliations",
      { params: idParams },
      ({ params, request }) =>
        dependencies.run(request, (service) =>
          service.listGuestAffiliations(params.weddingId),
        ),
    )
    .post(
      "/v1/weddings/:weddingId/guest-affiliations",
      { params: idParams, body: guestAffiliationInput },
      async ({ params, body, request }) =>
        status(
          201,
          await dependencies.run(request, (service) =>
            service.createGuestAffiliation(params.weddingId, body),
          ),
        ),
    )
    .put(
      "/v1/weddings/:weddingId/guest-affiliations/order",
      { params: idParams, body: guestAffiliationOrderInput },
      ({ params, body, request }) =>
        dependencies.run(request, (service) =>
          service.reorderGuestAffiliations(params.weddingId, body.ids),
        ),
    )
    .patch(
      "/v1/weddings/:weddingId/guest-affiliations/:affiliationId",
      { params: affiliationParams, body: guestAffiliationInput },
      ({ params, body, request }) =>
        dependencies.run(request, (service) =>
          service.updateGuestAffiliation(
            params.weddingId,
            params.affiliationId,
            body,
          ),
        ),
    )
    .delete(
      "/v1/weddings/:weddingId/guest-affiliations/:affiliationId",
      { params: affiliationParams },
      async ({ params, request }) => {
        await dependencies.run(request, (service) =>
          service.deleteGuestAffiliation(
            params.weddingId,
            params.affiliationId,
          ),
        );
        return status(204);
      },
    )
    .get(
      "/v1/weddings/:weddingId/guests",
      { params: idParams, query: guestListQuery },
      ({ params, query, request }) =>
        dependencies.run(request, (service) =>
          service.listGuests(params.weddingId, {
            limit: query.limit ?? 20,
            ...(query.cursor ? { cursor: query.cursor } : {}),
            ...(query.search ? { search: query.search } : {}),
            ...(query.affiliation ? { affiliation: query.affiliation } : {}),
            ...(query.rsvp ? { rsvp: query.rsvp } : {}),
            view: query.view ?? "active",
          }),
        ),
    )
    .get(
      "/v1/weddings/:weddingId/guests/export.csv",
      { params: idParams, query: guestExportQuery },
      async ({ params, query, request }) =>
        new Response(
          await dependencies.run(request, (service) =>
            service.streamGuestCsv(params.weddingId, query),
          ),
          {
            headers: {
              "content-type": "text/csv; charset=utf-8",
              "content-disposition":
                'attachment; filename="lovechapter-guests.csv"',
              "cache-control": "no-store",
            },
          },
        ),
    )
    .post(
      "/v1/weddings/:weddingId/guest-imports",
      { params: idParams },
      ({ params, request }) =>
        dependencies.run(request, async (service) => {
          await service.listGuestAffiliations(params.weddingId);
          const parsed = await parseGuestCsv(
            new Uint8Array(await request.arrayBuffer()),
          );
          return status(
            201,
            await service.stageGuestImport(params.weddingId, parsed),
          );
        }),
    )
    .get(
      "/v1/weddings/:weddingId/guest-imports/:batchId",
      { params: guestImportParams, query: pageQuery },
      ({ params, query, request }) =>
        dependencies.run(request, (service) =>
          service.getGuestImport(params.weddingId, params.batchId, {
            limit: query.limit ?? 100,
            ...(query.cursor ? { cursor: query.cursor } : {}),
          }),
        ),
    )
    .patch(
      "/v1/weddings/:weddingId/guest-imports/:batchId/mapping",
      { params: guestImportParams, body: guestImportMappingInput },
      ({ params, body, request }) =>
        dependencies.run(request, (service) =>
          service.updateGuestImportMapping(params.weddingId, params.batchId, {
            ...body,
            mapping: body.mapping as GuestImportMapping,
          }),
        ),
    )
    .post(
      "/v1/weddings/:weddingId/guest-imports/:batchId/commit",
      { params: guestImportParams, body: guestImportCommitInput },
      ({ params, body, request }) =>
        dependencies.run(request, (service) =>
          service.commitGuestImport(params.weddingId, params.batchId, body),
        ),
    )
    .get(
      "/v1/weddings/:weddingId/envelope-templates",
      { params: idParams },
      ({ params, request }) =>
        dependencies.run(request, (service) =>
          service.listEnvelopeTemplates(params.weddingId),
        ),
    )
    .post(
      "/v1/weddings/:weddingId/envelope-templates",
      { params: idParams, body: envelopeTemplateInput },
      async ({ params, body, request }) =>
        status(
          201,
          await dependencies.run(request, (service) =>
            service.createEnvelopeTemplate(params.weddingId, body),
          ),
        ),
    )
    .patch(
      "/v1/weddings/:weddingId/envelope-templates/:templateId",
      { params: envelopeTemplateParams, body: envelopeTemplateInput },
      ({ params, body, request }) =>
        dependencies.run(request, (service) =>
          service.updateEnvelopeTemplate(
            params.weddingId,
            params.templateId,
            body,
          ),
        ),
    )
    .delete(
      "/v1/weddings/:weddingId/envelope-templates/:templateId",
      { params: envelopeTemplateParams },
      async ({ params, request }) => {
        await dependencies.run(request, (service) =>
          service.deleteEnvelopeTemplate(params.weddingId, params.templateId),
        );
        return status(204);
      },
    )
    .post(
      "/v1/weddings/:weddingId/envelope-print-data",
      { params: idParams, body: envelopePrintInput },
      ({ params, body, request }) =>
        dependencies.run(request, (service) =>
          service.getEnvelopePrintData(
            params.weddingId,
            body as {
              guestIds: string[];
              templateId?: string;
              template?: EnvelopeTemplateInput;
            },
          ),
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
    .patch(
      "/v1/weddings/:weddingId/guests/bulk-affiliation",
      { params: idParams, body: bulkGuestAffiliationInput },
      ({ params, body, request }) =>
        dependencies.run(request, (service) =>
          service.bulkSetGuestAffiliation(
            params.weddingId,
            body.guestIds,
            body.affiliationId,
          ),
        ),
    )
    .post(
      "/v1/weddings/:weddingId/guests/bulk-archive",
      { params: idParams, body: bulkGuestIdsInput },
      ({ params, body, request }) =>
        dependencies.run(request, (service) =>
          service.bulkArchiveGuests(params.weddingId, body.guestIds),
        ),
    )
    .get(
      "/v1/weddings/:weddingId/guests/:guestId",
      { params: guestParams },
      ({ params, request }) =>
        dependencies.run(request, (service) =>
          service.getGuest(params.weddingId, params.guestId),
        ),
    )
    .patch(
      "/v1/weddings/:weddingId/guests/:guestId",
      { params: guestParams, body: guestUpdateInput },
      ({ params, body, request }) =>
        dependencies.run(request, (service) =>
          service.updateGuest(params.weddingId, params.guestId, body),
        ),
    )
    .post(
      "/v1/weddings/:weddingId/guests/:guestId/archive",
      { params: guestParams },
      ({ params, request }) =>
        dependencies.run(request, (service) =>
          service.archiveGuest(params.weddingId, params.guestId),
        ),
    )
    .post(
      "/v1/weddings/:weddingId/guests/:guestId/restore",
      { params: guestParams },
      ({ params, request }) =>
        dependencies.run(request, (service) =>
          service.restoreGuest(params.weddingId, params.guestId),
        ),
    )
    .patch(
      "/v1/weddings/:weddingId/guests/:guestId/affiliation",
      { params: guestParams, body: setGuestAffiliationInput },
      ({ params, body, request }) =>
        dependencies.run(request, (service) =>
          service.setGuestAffiliation(
            params.weddingId,
            params.guestId,
            body.affiliationId,
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
    .post(
      "/v1/weddings/:weddingId/guests/:guestId/invitations/replace",
      { params: guestParams },
      async ({ params, request }) =>
        status(
          201,
          await dependencies.run(request, (service) =>
            service.replaceInvitation(params.weddingId, params.guestId),
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

function enforceRequestSecurity(
  request: Request,
  dependencies: Pick<
    ApiDependencies,
    "proxyCredential" | "fingerprintKey" | "publicWebOrigin"
  >,
): void {
  if (new URL(request.url).pathname === "/health/live") return;
  const ingress = authorizeIngress(request, {
    proxyCredential: dependencies.proxyCredential,
    fingerprintKey: dependencies.fingerprintKey,
  });
  if (!ingress.allowed) {
    throw new RequestSecurityError("request_ingress_rejected", 403);
  }
  if (
    request.method !== "GET" &&
    request.method !== "HEAD" &&
    request.method !== "OPTIONS"
  ) {
    requireMutationOrigin(request, dependencies.publicWebOrigin);
    if (isGuestCsvUpload(request)) requireGuestCsvContentType(request);
    else requireJsonContentType(request);
  }
}

function isDependencyUnavailable(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  const code = String(error.code);
  return (
    code.startsWith("08") ||
    ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "57P01"].includes(code)
  );
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
