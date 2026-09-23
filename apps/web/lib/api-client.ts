import type {
  AcceptedResponse,
  AuthenticatedUser,
  AuthSessionResponse,
  BulkGuestAffiliationInput,
  BulkGuestIdsInput,
  BulkGuestResult,
  CreateGuestAffiliationInput,
  CreateGuestInput,
  CreateWeddingInput,
  EnvelopePrintData,
  EnvelopePrintDataInput,
  EnvelopeTemplate,
  EnvelopeTemplateInput,
  ForgotPasswordInput,
  GuestAffiliation,
  GuestDetail,
  GuestListInput,
  GuestImportCommitInput,
  GuestImportCommitResult,
  GuestImportMappingInput,
  GuestImportPreview,
  GuestSummary,
  InvitationCreated,
  Page,
  PublicInvitation,
  ResendVerificationInput,
  ResetPasswordInput,
  RsvpResponse,
  SetGuestAffiliationInput,
  SignInInput,
  SignUpInput,
  SubmitRsvpInput,
  UpdateGuestAffiliationInput,
  UpdateGuestInput,
  UpdateProfileInput,
  VerifyEmailInput,
  WeddingSummary,
  PlanningTask,
  PlanningOverview,
  PlanningTaskFilter,
  CreatePlanningTaskInput,
  UpdatePlanningTaskInput,
  Budget,
  BudgetCategory,
  BudgetCategoryInput,
  BudgetOverview,
  Expense,
  ExpenseInput,
  Vendor,
  VendorInput,
  RunSheetItem,
  RunSheetItemInput,
  SeatingTable,
  SeatingTableInput,
  SeatingAssignment,
} from "@lovechapter/contracts";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }

  static async fromResponse(response: Response): Promise<ApiError> {
    const fallback = `Request failed (${response.status})`;
    try {
      const payload = (await response.json()) as {
        error?: { code?: string; message?: string };
      };
      return new ApiError(
        payload.error?.message ?? fallback,
        response.status,
        payload.error?.code,
      );
    } catch {
      return new ApiError(fallback, response.status);
    }
  }
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new Error("API paths must be root-relative");
  }
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(`/api${path}`, {
    ...init,
    headers,
    credentials: "same-origin",
  });
  if (!response.ok) throw await ApiError.fromResponse(response);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export type AuthenticationRequiredHandler = () => void | Promise<void>;

export function createLoveChapterApi(
  onAuthenticationRequired: AuthenticationRequiredHandler,
) {
  const request = <T>(path: string, init?: RequestInit) =>
    authenticatedRequest<T>(onAuthenticationRequired, path, init);

  return {
    signUp: (input: SignUpInput) =>
      apiRequest<AcceptedResponse>("/v1/auth/sign-up", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    resendVerificationEmail: (input: ResendVerificationInput) =>
      apiRequest<AcceptedResponse>("/v1/auth/verification-email", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    verifyEmail: (input: VerifyEmailInput) =>
      apiRequest<{ verified: true }>("/v1/auth/verify-email", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    signIn: (input: SignInInput) =>
      apiRequest<{ signedIn: true }>("/v1/auth/sign-in", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    getSession: () => request<AuthSessionResponse>("/v1/auth/session"),
    signOut: () =>
      apiRequest<void>("/v1/auth/sign-out", {
        method: "POST",
        body: "{}",
      }),
    forgotPassword: (input: ForgotPasswordInput) =>
      apiRequest<AcceptedResponse>("/v1/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    resetPassword: (input: ResetPasswordInput) =>
      apiRequest<{ reset: true }>("/v1/auth/reset-password", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    getMe: () => request<AuthenticatedUser>("/v1/me"),
    updateMyProfile: (input: UpdateProfileInput) =>
      request<AuthenticatedUser>("/v1/me", {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    listWeddings: (cursor?: string) =>
      request<Page<WeddingSummary>>(`/v1/weddings?${pageQuery(cursor)}`),
    createWedding: (input: CreateWeddingInput) =>
      request<WeddingSummary>("/v1/weddings", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    getPlanningOverview: (weddingId: string) =>
      request<PlanningOverview>(
        `/v1/weddings/${encodeURIComponent(weddingId)}/planning-overview`,
      ),
    listPlanningTasks: (
      weddingId: string,
      options: { filter?: PlanningTaskFilter; cursor?: string } = {},
    ) => {
      const query = new URLSearchParams({
        limit: "20",
        filter: options.filter ?? "all",
      });
      if (options.cursor) query.set("cursor", options.cursor);
      return request<Page<PlanningTask>>(
        `/v1/weddings/${encodeURIComponent(weddingId)}/planning-tasks?${query}`,
      );
    },
    createPlanningTask: (weddingId: string, input: CreatePlanningTaskInput) =>
      request<PlanningTask>(
        `/v1/weddings/${encodeURIComponent(weddingId)}/planning-tasks`,
        {
          method: "POST",
          body: JSON.stringify(input),
        },
      ),
    updatePlanningTask: (
      weddingId: string,
      taskId: string,
      input: UpdatePlanningTaskInput,
    ) =>
      request<PlanningTask>(
        `/v1/weddings/${encodeURIComponent(weddingId)}/planning-tasks/${encodeURIComponent(taskId)}`,
        {
          method: "PATCH",
          body: JSON.stringify(input),
        },
      ),
    deletePlanningTask: (weddingId: string, taskId: string) =>
      request<void>(
        `/v1/weddings/${encodeURIComponent(weddingId)}/planning-tasks/${encodeURIComponent(taskId)}`,
        {
          method: "DELETE",
          body: "{}",
        },
      ),
    getBudgetOverview: (weddingId: string) =>
      request<BudgetOverview>(
        `/v1/weddings/${encodeURIComponent(weddingId)}/budget`,
      ),
    setBudget: (weddingId: string, input: Budget) =>
      request<Budget>(`/v1/weddings/${encodeURIComponent(weddingId)}/budget`, {
        method: "PUT",
        body: JSON.stringify(input),
      }),
    listBudgetCategories: (weddingId: string) =>
      request<BudgetCategory[]>(
        `/v1/weddings/${encodeURIComponent(weddingId)}/budget/categories`,
      ),
    saveBudgetCategory: (
      weddingId: string,
      id: string | null,
      input: BudgetCategoryInput,
    ) =>
      request<BudgetCategory>(
        `/v1/weddings/${encodeURIComponent(weddingId)}/budget/categories${id ? `/${encodeURIComponent(id)}` : ""}`,
        { method: id ? "PUT" : "POST", body: JSON.stringify(input) },
      ),
    deleteBudgetCategory: (weddingId: string, id: string) =>
      request<void>(
        `/v1/weddings/${encodeURIComponent(weddingId)}/budget/categories/${encodeURIComponent(id)}`,
        { method: "DELETE", body: "{}" },
      ),
    listVendors: (weddingId: string, cursor?: string) =>
      request<Page<Vendor>>(
        `/v1/weddings/${encodeURIComponent(weddingId)}/vendors?${pageQuery(cursor)}`,
      ),
    saveVendor: (weddingId: string, id: string | null, input: VendorInput) =>
      request<Vendor>(
        `/v1/weddings/${encodeURIComponent(weddingId)}/vendors${id ? `/${encodeURIComponent(id)}` : ""}`,
        { method: id ? "PUT" : "POST", body: JSON.stringify(input) },
      ),
    deleteVendor: (weddingId: string, id: string) =>
      request<void>(
        `/v1/weddings/${encodeURIComponent(weddingId)}/vendors/${encodeURIComponent(id)}`,
        { method: "DELETE", body: "{}" },
      ),
    listExpenses: (weddingId: string, cursor?: string) =>
      request<Page<Expense>>(
        `/v1/weddings/${encodeURIComponent(weddingId)}/expenses?${pageQuery(cursor)}`,
      ),
    saveExpense: (weddingId: string, id: string | null, input: ExpenseInput) =>
      request<Expense>(
        `/v1/weddings/${encodeURIComponent(weddingId)}/expenses${id ? `/${encodeURIComponent(id)}` : ""}`,
        { method: id ? "PUT" : "POST", body: JSON.stringify(input) },
      ),
    deleteExpense: (weddingId: string, id: string) =>
      request<void>(
        `/v1/weddings/${encodeURIComponent(weddingId)}/expenses/${encodeURIComponent(id)}`,
        { method: "DELETE", body: "{}" },
      ),
    listRunSheet: (weddingId: string, cursor?: string) =>
      request<Page<RunSheetItem>>(
        `/v1/weddings/${encodeURIComponent(weddingId)}/run-sheet?${pageQuery(cursor)}`,
      ),
    saveRunSheetItem: (
      weddingId: string,
      id: string | null,
      input: RunSheetItemInput,
    ) =>
      request<RunSheetItem>(
        `/v1/weddings/${encodeURIComponent(weddingId)}/run-sheet${id ? `/${encodeURIComponent(id)}` : ""}`,
        { method: id ? "PUT" : "POST", body: JSON.stringify(input) },
      ),
    deleteRunSheetItem: (weddingId: string, id: string) =>
      request<void>(
        `/v1/weddings/${encodeURIComponent(weddingId)}/run-sheet/${encodeURIComponent(id)}`,
        { method: "DELETE", body: "{}" },
      ),
    listSeatingTables: (weddingId: string) =>
      request<SeatingTable[]>(
        `/v1/weddings/${encodeURIComponent(weddingId)}/seating/tables`,
      ),
    saveSeatingTable: (
      weddingId: string,
      id: string | null,
      input: SeatingTableInput,
    ) =>
      request<SeatingTable>(
        `/v1/weddings/${encodeURIComponent(weddingId)}/seating/tables${id ? `/${encodeURIComponent(id)}` : ""}`,
        { method: id ? "PUT" : "POST", body: JSON.stringify(input) },
      ),
    deleteSeatingTable: (weddingId: string, id: string) =>
      request<void>(
        `/v1/weddings/${encodeURIComponent(weddingId)}/seating/tables/${encodeURIComponent(id)}`,
        { method: "DELETE", body: "{}" },
      ),
    listSeatingAssignments: (weddingId: string, tableId: string) =>
      request<SeatingAssignment[]>(
        `/v1/weddings/${encodeURIComponent(weddingId)}/seating/tables/${encodeURIComponent(tableId)}/assignments`,
      ),
    assignSeating: (
      weddingId: string,
      guestId: string,
      tableId: string | null,
    ) =>
      request<void>(
        `/v1/weddings/${encodeURIComponent(weddingId)}/seating/guests/${encodeURIComponent(guestId)}`,
        { method: "PUT", body: JSON.stringify({ tableId }) },
      ),
    listGuestAffiliations: (weddingId: string) =>
      request<GuestAffiliation[]>(
        `/v1/weddings/${encodeURIComponent(weddingId)}/guest-affiliations`,
      ),
    createGuestAffiliation: (
      weddingId: string,
      input: CreateGuestAffiliationInput,
    ) =>
      request<GuestAffiliation>(
        `/v1/weddings/${encodeURIComponent(weddingId)}/guest-affiliations`,
        { method: "POST", body: JSON.stringify(input) },
      ),
    updateGuestAffiliation: (
      weddingId: string,
      affiliationId: string,
      input: UpdateGuestAffiliationInput,
    ) =>
      request<GuestAffiliation>(
        `/v1/weddings/${encodeURIComponent(weddingId)}/guest-affiliations/${encodeURIComponent(affiliationId)}`,
        { method: "PATCH", body: JSON.stringify(input) },
      ),
    reorderGuestAffiliations: (weddingId: string, ids: string[]) =>
      request<GuestAffiliation[]>(
        `/v1/weddings/${encodeURIComponent(weddingId)}/guest-affiliations/order`,
        { method: "PUT", body: JSON.stringify({ ids }) },
      ),
    deleteGuestAffiliation: (weddingId: string, affiliationId: string) =>
      request<void>(
        `/v1/weddings/${encodeURIComponent(weddingId)}/guest-affiliations/${encodeURIComponent(affiliationId)}`,
        { method: "DELETE", body: "{}" },
      ),
    listGuests: (
      weddingId: string,
      input: GuestListInput | string = { limit: 20, view: "active" },
    ) =>
      request<Page<GuestSummary>>(
        `/v1/weddings/${encodeURIComponent(weddingId)}/guests?${guestListQuery(input)}`,
      ),
    listGuestManagement: (weddingId: string, input: GuestListInput) =>
      request<Page<GuestSummary>>(
        `/v1/weddings/${encodeURIComponent(weddingId)}/guests?${guestListQuery(input)}`,
      ),
    downloadGuestCsv: (
      weddingId: string,
      filters: Partial<
        Pick<GuestListInput, "search" | "affiliation" | "rsvp" | "view">
      >,
    ) =>
      downloadCsv(
        onAuthenticationRequired,
        `/v1/weddings/${encodeURIComponent(weddingId)}/guests/export.csv?${guestExportQuery(filters)}`,
      ),
    listEnvelopeTemplates: (weddingId: string) =>
      request<EnvelopeTemplate[]>(
        `/v1/weddings/${encodeURIComponent(weddingId)}/envelope-templates`,
      ),
    createEnvelopeTemplate: (weddingId: string, input: EnvelopeTemplateInput) =>
      request<EnvelopeTemplate>(
        `/v1/weddings/${encodeURIComponent(weddingId)}/envelope-templates`,
        { method: "POST", body: JSON.stringify(input) },
      ),
    updateEnvelopeTemplate: (
      weddingId: string,
      templateId: string,
      input: EnvelopeTemplateInput,
    ) =>
      request<EnvelopeTemplate>(
        `/v1/weddings/${encodeURIComponent(weddingId)}/envelope-templates/${encodeURIComponent(templateId)}`,
        { method: "PATCH", body: JSON.stringify(input) },
      ),
    deleteEnvelopeTemplate: (weddingId: string, templateId: string) =>
      request<void>(
        `/v1/weddings/${encodeURIComponent(weddingId)}/envelope-templates/${encodeURIComponent(templateId)}`,
        { method: "DELETE", body: "{}" },
      ),
    getEnvelopePrintData: (weddingId: string, input: EnvelopePrintDataInput) =>
      request<EnvelopePrintData>(
        `/v1/weddings/${encodeURIComponent(weddingId)}/envelope-print-data`,
        { method: "POST", body: JSON.stringify(input) },
      ),
    uploadGuestCsv: (weddingId: string, file: File) =>
      request<GuestImportPreview>(
        `/v1/weddings/${encodeURIComponent(weddingId)}/guest-imports`,
        { method: "POST", headers: { "content-type": "text/csv" }, body: file },
      ),
    getGuestImportPreview: (
      weddingId: string,
      batchId: string,
      cursor?: string,
    ) => {
      const query = new URLSearchParams({ limit: "100" });
      if (cursor) query.set("cursor", cursor);
      return request<GuestImportPreview>(
        `/v1/weddings/${encodeURIComponent(weddingId)}/guest-imports/${encodeURIComponent(batchId)}?${query}`,
      );
    },
    updateGuestImportMapping: (
      weddingId: string,
      batchId: string,
      input: GuestImportMappingInput,
    ) =>
      request<GuestImportPreview>(
        `/v1/weddings/${encodeURIComponent(weddingId)}/guest-imports/${encodeURIComponent(batchId)}/mapping`,
        { method: "PATCH", body: JSON.stringify(input) },
      ),
    commitGuestImport: (
      weddingId: string,
      batchId: string,
      input: GuestImportCommitInput,
    ) =>
      request<GuestImportCommitResult>(
        `/v1/weddings/${encodeURIComponent(weddingId)}/guest-imports/${encodeURIComponent(batchId)}/commit`,
        { method: "POST", body: JSON.stringify(input) },
      ),
    addGuest: (weddingId: string, input: CreateGuestInput) =>
      request<GuestSummary>(
        `/v1/weddings/${encodeURIComponent(weddingId)}/guests`,
        { method: "POST", body: JSON.stringify(input) },
      ),
    setGuestAffiliation: (
      weddingId: string,
      guestId: string,
      input: SetGuestAffiliationInput,
    ) =>
      request<GuestSummary>(
        `/v1/weddings/${encodeURIComponent(weddingId)}/guests/${encodeURIComponent(guestId)}/affiliation`,
        { method: "PATCH", body: JSON.stringify(input) },
      ),
    getGuest: (weddingId: string, guestId: string) =>
      request<GuestDetail>(
        `/v1/weddings/${encodeURIComponent(weddingId)}/guests/${encodeURIComponent(guestId)}`,
      ),
    updateGuest: (
      weddingId: string,
      guestId: string,
      input: UpdateGuestInput,
    ) =>
      request<GuestDetail>(
        `/v1/weddings/${encodeURIComponent(weddingId)}/guests/${encodeURIComponent(guestId)}`,
        { method: "PATCH", body: JSON.stringify(input) },
      ),
    archiveGuest: (weddingId: string, guestId: string) =>
      request<GuestDetail>(
        `/v1/weddings/${encodeURIComponent(weddingId)}/guests/${encodeURIComponent(guestId)}/archive`,
        { method: "POST", body: "{}" },
      ),
    restoreGuest: (weddingId: string, guestId: string) =>
      request<GuestDetail>(
        `/v1/weddings/${encodeURIComponent(weddingId)}/guests/${encodeURIComponent(guestId)}/restore`,
        { method: "POST", body: "{}" },
      ),
    bulkSetGuestAffiliation: (
      weddingId: string,
      input: BulkGuestAffiliationInput,
    ) =>
      request<BulkGuestResult>(
        `/v1/weddings/${encodeURIComponent(weddingId)}/guests/bulk-affiliation`,
        { method: "PATCH", body: JSON.stringify(input) },
      ),
    bulkArchiveGuests: (weddingId: string, input: BulkGuestIdsInput) =>
      request<BulkGuestResult>(
        `/v1/weddings/${encodeURIComponent(weddingId)}/guests/bulk-archive`,
        { method: "POST", body: JSON.stringify(input) },
      ),
    createInvitation: (weddingId: string, guestId: string) =>
      request<InvitationCreated>(
        `/v1/weddings/${encodeURIComponent(weddingId)}/guests/${encodeURIComponent(guestId)}/invitations`,
        { method: "POST", body: "{}" },
      ),
    replaceInvitation: (weddingId: string, guestId: string) =>
      request<InvitationCreated>(
        `/v1/weddings/${encodeURIComponent(weddingId)}/guests/${encodeURIComponent(guestId)}/invitations/replace`,
        { method: "POST", body: "{}" },
      ),
  };
}

export const loveChapterPublicApi = {
  getInvitation: (token: string) =>
    apiRequest<PublicInvitation>(
      `/v1/public/invitations/${encodeURIComponent(token)}`,
    ),
  submitRsvp: (token: string, input: SubmitRsvpInput) =>
    apiRequest<RsvpResponse>(
      `/v1/public/invitations/${encodeURIComponent(token)}/rsvp`,
      { method: "PUT", body: JSON.stringify(input) },
    ),
};

async function authenticatedRequest<T>(
  onAuthenticationRequired: AuthenticationRequiredHandler,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  try {
    return await apiRequest<T>(path, init);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      await onAuthenticationRequired();
    }
    throw error;
  }
}

function pageQuery(cursor?: string): string {
  const query = new URLSearchParams({ limit: "20" });
  if (cursor) query.set("cursor", cursor);
  return query.toString();
}

export function guestListQuery(input: GuestListInput | string): string {
  const query = new URLSearchParams({ limit: "20" });
  if (typeof input === "string") {
    query.set("cursor", input);
    query.set("view", "active");
    return query.toString();
  }
  query.set("limit", String(input.limit));
  query.set("view", input.view);
  if (input.cursor) query.set("cursor", input.cursor);
  if (input.search) query.set("search", input.search);
  if (input.affiliation) query.set("affiliation", input.affiliation);
  if (input.rsvp) query.set("rsvp", input.rsvp);
  return query.toString();
}

function guestExportQuery(
  filters: Partial<
    Pick<GuestListInput, "search" | "affiliation" | "rsvp" | "view">
  >,
): string {
  const query = new URLSearchParams(
    guestListQuery({ limit: 20, view: filters.view ?? "active", ...filters }),
  );
  query.delete("limit");
  return query.toString();
}

async function downloadCsv(
  onAuthenticationRequired: AuthenticationRequiredHandler,
  path: string,
): Promise<void> {
  const response = await fetch(`/api${path}`, {
    credentials: "same-origin",
    headers: { accept: "text/csv" },
  });
  if (!response.ok) {
    const error = await ApiError.fromResponse(response);
    if (error.status === 401) await onAuthenticationRequired();
    throw error;
  }
  const blob = await response.blob();
  const match = /^attachment;\s*filename="([A-Za-z0-9._-]+\.csv)"$/iu.exec(
    response.headers.get("content-disposition") ?? "",
  );
  const filename = match?.[1] ?? "lovechapter-guests.csv";
  const objectUrl = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
