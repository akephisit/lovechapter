import type {
  AuthenticatedUser,
  BulkGuestResult,
  CreateGuestAffiliationInput,
  CreateGuestInput,
  CreateWeddingInput,
  EnvelopePrintData,
  EnvelopePrintDataInput,
  EnvelopeTemplate,
  EnvelopeTemplateInput,
  GuestAffiliation,
  GuestDetail,
  GuestImportMapping,
  GuestImportCommitInput,
  GuestImportCommitResult,
  GuestImportMappingInput,
  GuestImportPreview,
  GuestListInput,
  GuestSummary,
  InvitationCreated,
  Page,
  PageInput,
  PostalAddressInput,
  PublicInvitation,
  RsvpResponse,
  SubmitRsvpInput,
  UpdateGuestAffiliationInput,
  UpdateGuestInput,
  UpdateProfileInput,
  WeddingSummary,
  CreatePlanningTaskInput,
  UpdatePlanningTaskInput,
  PlanningTask,
  PlanningTaskFilter,
  PlanningOverview,
} from "@lovechapter/contracts";

import { decodeCursor } from "./cursor";
import {
  normalizeEnvelopePrintDataInput,
  normalizeEnvelopeTemplateInput,
} from "./envelope-printing";
import { encodeGuestCsvHeader, encodeGuestCsvRow } from "./guest-csv";
import {
  addWithinFileDuplicateWarnings,
  autoMapGuestHeaders,
  buildGuestImportCandidates,
  decodeGuestImportCursor,
  validateGuestImportMapping,
} from "./guest-import";
import {
  AuthenticationRequiredError,
  ConflictError,
  DomainValidationError,
  NotFoundError,
  OnboardingRequiredError,
} from "./errors";
import type { IdentityProvider } from "./identity";
import { generateInvitationToken, hashInvitationToken } from "./invitations";
import type {
  GuestListRepositoryInput,
  GuestExportPageRow,
  GuestImportRepository,
  EnvelopeRepository,
  GuestImportSourceRow,
  GuestImportStagedRow,
  LoveChapterRepository,
  NormalizedGuestUpdate,
  RepositoryPageInput,
} from "./ports";
import { validateRsvp } from "./rsvp";
import {
  normalizePlanningTaskCreate,
  normalizePlanningTaskPatch,
} from "./planning";
import type { PlanningRepository } from "./ports";

export class LoveChapterService {
  private readonly publicWebOrigin: string;

  constructor(
    private readonly identity: IdentityProvider,
    private readonly repository: LoveChapterRepository,
    publicWebOrigin: string,
    private readonly request?: Request,
    private readonly guestImportRepository?: Pick<
      GuestImportRepository,
      | "stageGuestImport"
      | "getGuestImport"
      | "loadGuestImportForMapping"
      | "findLikelyGuestDuplicates"
      | "replaceGuestImportPreview"
      | "commitGuestImport"
    >,
    private readonly envelopeRepository?: EnvelopeRepository,
    private readonly planningRepository?: PlanningRepository,
  ) {
    this.publicWebOrigin = publicWebOrigin.replace(/\/$/, "");
  }

  async getMe(): Promise<AuthenticatedUser> {
    return this.requireUser();
  }

  private requireEnvelopeRepository(): EnvelopeRepository {
    if (!this.envelopeRepository)
      throw new Error("Envelope repository is not configured");
    return this.envelopeRepository;
  }

  private requirePlanningRepository(): PlanningRepository {
    if (!this.planningRepository)
      throw new Error("Planning repository is not configured");
    return this.planningRepository;
  }

  async listPlanningTasks(
    weddingId: string,
    page: PageInput & { filter: PlanningTaskFilter },
  ): Promise<Page<PlanningTask>> {
    const user = await this.requireOnboardedUser();
    if (!Number.isInteger(page.limit) || page.limit < 1 || page.limit > 50)
      throw new DomainValidationError(
        "Planning task page must have 1–50 items",
      );
    if (!["all", "open", "completed"].includes(page.filter))
      throw new DomainValidationError("Invalid task filter");
    return this.requirePlanningRepository().listPlanningTasks(
      user.id,
      weddingId,
      { ...normalizePage(page), filter: page.filter },
    );
  }
  async getPlanningOverview(weddingId: string): Promise<PlanningOverview> {
    const user = await this.requireOnboardedUser();
    return this.requirePlanningRepository().getPlanningOverview(
      user.id,
      weddingId,
    );
  }
  async createPlanningTask(
    weddingId: string,
    input: CreatePlanningTaskInput,
  ): Promise<PlanningTask> {
    const user = await this.requireOnboardedUser();
    return this.requirePlanningRepository().createPlanningTask(
      user.id,
      weddingId,
      crypto.randomUUID(),
      normalizePlanningTaskCreate(input),
    );
  }
  async updatePlanningTask(
    weddingId: string,
    taskId: string,
    input: UpdatePlanningTaskInput,
  ): Promise<PlanningTask> {
    const user = await this.requireOnboardedUser();
    if (!isUuid(taskId)) throw new DomainValidationError("Invalid task ID");
    return this.requirePlanningRepository().updatePlanningTask(
      user.id,
      weddingId,
      taskId,
      normalizePlanningTaskPatch(input),
    );
  }
  async deletePlanningTask(weddingId: string, taskId: string): Promise<void> {
    const user = await this.requireOnboardedUser();
    if (!isUuid(taskId)) throw new DomainValidationError("Invalid task ID");
    return this.requirePlanningRepository().deletePlanningTask(
      user.id,
      weddingId,
      taskId,
    );
  }

  async listEnvelopeTemplates(weddingId: string): Promise<EnvelopeTemplate[]> {
    const user = await this.requireOnboardedUser();
    return this.requireEnvelopeRepository().listEnvelopeTemplates(
      user.id,
      weddingId,
    );
  }
  async createEnvelopeTemplate(
    weddingId: string,
    input: EnvelopeTemplateInput,
  ): Promise<EnvelopeTemplate> {
    const user = await this.requireOnboardedUser();
    return this.requireEnvelopeRepository().createEnvelopeTemplate(
      user.id,
      weddingId,
      crypto.randomUUID(),
      normalizeEnvelopeTemplateInput(input),
    );
  }
  async updateEnvelopeTemplate(
    weddingId: string,
    templateId: string,
    input: EnvelopeTemplateInput,
  ): Promise<EnvelopeTemplate> {
    const user = await this.requireOnboardedUser();
    if (!isUuid(templateId))
      throw new DomainValidationError("Invalid template ID");
    return this.requireEnvelopeRepository().updateEnvelopeTemplate(
      user.id,
      weddingId,
      templateId,
      normalizeEnvelopeTemplateInput(input),
    );
  }
  async deleteEnvelopeTemplate(
    weddingId: string,
    templateId: string,
  ): Promise<void> {
    const user = await this.requireOnboardedUser();
    if (!isUuid(templateId))
      throw new DomainValidationError("Invalid template ID");
    return this.requireEnvelopeRepository().deleteEnvelopeTemplate(
      user.id,
      weddingId,
      templateId,
    );
  }
  async getEnvelopePrintData(
    weddingId: string,
    input: EnvelopePrintDataInput,
  ): Promise<EnvelopePrintData> {
    const user = await this.requireOnboardedUser();
    return this.requireEnvelopeRepository().getEnvelopePrintData(
      user.id,
      weddingId,
      normalizeEnvelopePrintDataInput(input),
    );
  }

  async updateMyProfile(input: UpdateProfileInput): Promise<AuthenticatedUser> {
    const user = await this.requireUser();
    const displayName = input.displayName.trim();
    if (!displayName || Array.from(displayName).length > 120) {
      throw new DomainValidationError("Display name must be 1–120 characters");
    }
    return this.repository.updateUserProfile(user.id, { displayName });
  }

  async createWedding(input: CreateWeddingInput): Promise<WeddingSummary> {
    const user = await this.requireOnboardedUser();
    return this.repository.createWedding(
      user.id,
      crypto.randomUUID(),
      normalizeWedding(input),
    );
  }

  async listWeddings(page: PageInput): Promise<Page<WeddingSummary>> {
    const user = await this.requireOnboardedUser();
    return this.repository.listWeddings(user.id, normalizePage(page));
  }

  async listGuestAffiliations(weddingId: string): Promise<GuestAffiliation[]> {
    const user = await this.requireOnboardedUser();
    return this.repository.listGuestAffiliations(user.id, weddingId);
  }

  async createGuestAffiliation(
    weddingId: string,
    input: CreateGuestAffiliationInput,
  ): Promise<GuestAffiliation> {
    const user = await this.requireOnboardedUser();
    return this.repository.createGuestAffiliation(
      user.id,
      weddingId,
      crypto.randomUUID(),
      normalizeGuestAffiliation(input),
    );
  }

  async updateGuestAffiliation(
    weddingId: string,
    affiliationId: string,
    input: UpdateGuestAffiliationInput,
  ): Promise<GuestAffiliation> {
    const user = await this.requireOnboardedUser();
    return this.repository.updateGuestAffiliation(
      user.id,
      weddingId,
      affiliationId,
      normalizeGuestAffiliation(input),
    );
  }

  async reorderGuestAffiliations(
    weddingId: string,
    affiliationIds: string[],
  ): Promise<GuestAffiliation[]> {
    const user = await this.requireOnboardedUser();
    if (
      affiliationIds.length > 100 ||
      new Set(affiliationIds).size !== affiliationIds.length
    ) {
      throw new DomainValidationError("Invalid guest affiliation order");
    }
    return this.repository.reorderGuestAffiliations(
      user.id,
      weddingId,
      affiliationIds,
    );
  }

  async deleteGuestAffiliation(
    weddingId: string,
    affiliationId: string,
  ): Promise<void> {
    const user = await this.requireOnboardedUser();
    await this.repository.deleteGuestAffiliation(
      user.id,
      weddingId,
      affiliationId,
    );
  }

  async addGuest(
    weddingId: string,
    input: CreateGuestInput,
  ): Promise<GuestSummary> {
    const user = await this.requireOnboardedUser();
    return this.repository.createGuest(
      user.id,
      weddingId,
      crypto.randomUUID(),
      normalizeGuestCreate(input),
    );
  }

  async setGuestAffiliation(
    weddingId: string,
    guestId: string,
    affiliationId: string | null,
  ): Promise<GuestSummary> {
    const user = await this.requireOnboardedUser();
    return this.repository.setGuestAffiliation(
      user.id,
      weddingId,
      guestId,
      affiliationId,
    );
  }

  async listGuests(
    weddingId: string,
    input: PageInput & Partial<Omit<GuestListInput, keyof PageInput>>,
  ): Promise<Page<GuestSummary>> {
    const user = await this.requireOnboardedUser();
    return this.repository.listGuests(
      user.id,
      weddingId,
      normalizeGuestList(input),
    );
  }

  async streamGuestCsv(
    weddingId: string,
    filters: Partial<
      Pick<GuestListInput, "search" | "affiliation" | "rsvp" | "view">
    >,
  ): Promise<ReadableStream<Uint8Array>> {
    const user = await this.requireOnboardedUser();
    const normalized = normalizeGuestList({ limit: 100, ...filters });
    const input: GuestListRepositoryInput & { limit: 500 } = {
      ...normalized,
      limit: 500,
    };
    // Fetch once before sending headers so tenant errors remain ordinary HTTP errors.
    const first = await this.repository.listGuestExportPage(
      user.id,
      weddingId,
      input,
    );
    let rows: GuestExportPageRow[] = first.items;
    let offset = 0;
    let cursor = first.nextCursor;
    let headerSent = false;
    let cancelled = false;
    const encoder = new TextEncoder();
    return new ReadableStream<Uint8Array>(
      {
        pull: async (controller) => {
          if (cancelled) return;
          try {
            if (!headerSent) {
              headerSent = true;
              controller.enqueue(encoder.encode(encodeGuestCsvHeader()));
              return;
            }
            while (offset >= rows.length) {
              if (!cursor) {
                controller.close();
                return;
              }
              const page = await this.repository.listGuestExportPage(
                user.id,
                weddingId,
                {
                  ...input,
                  cursor: decodeCursor(cursor),
                },
              );
              if (cancelled) return;
              rows = page.items;
              offset = 0;
              cursor = page.nextCursor;
            }
            controller.enqueue(
              encoder.encode(encodeGuestCsvRow(rows[offset++]!)),
            );
          } catch (error) {
            if (!cancelled) controller.error(error);
          }
        },
        cancel: () => {
          cancelled = true;
          rows = [];
        },
      },
      { highWaterMark: 0 },
    );
  }

  async stageGuestImport(
    weddingId: string,
    source: {
      sourceSha256: string;
      headers: string[];
      rows: string[][];
    },
  ): Promise<GuestImportPreview> {
    const user = await this.requireOnboardedUser();
    const store = this.requireGuestImportRepository();
    const affiliations = await this.repository.listGuestAffiliations(
      user.id,
      weddingId,
    );
    const mapping = autoMapGuestHeaders(source.headers);
    validateGuestImportMapping(source.headers, mapping);
    const rows: GuestImportSourceRow[] = source.rows.map((values, index) => ({
      id: crypto.randomUUID(),
      rowNumber: index + 2,
      values,
      included: true,
    }));
    const staged = await this.buildImportRows(
      user.id,
      weddingId,
      rows,
      mapping,
      affiliations,
      {},
    );
    return store.stageGuestImport({
      id: crypto.randomUUID(),
      userId: user.id,
      weddingId,
      sourceSha256: source.sourceSha256,
      headers: source.headers,
      mapping,
      affiliationMappings: {},
      rows: staged,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });
  }

  async getGuestImport(
    weddingId: string,
    batchId: string,
    page: PageInput,
  ): Promise<GuestImportPreview> {
    const user = await this.requireOnboardedUser();
    if (!Number.isInteger(page.limit) || page.limit < 1 || page.limit > 100) {
      throw new DomainValidationError("Limit must be between 1 and 100");
    }
    return this.requireGuestImportRepository().getGuestImport(
      user.id,
      weddingId,
      batchId,
      {
        limit: page.limit,
        ...(page.cursor
          ? { cursor: decodeGuestImportCursor(page.cursor) }
          : {}),
      },
    );
  }

  async updateGuestImportMapping(
    weddingId: string,
    batchId: string,
    input: GuestImportMappingInput,
  ): Promise<GuestImportPreview> {
    const user = await this.requireOnboardedUser();
    const store = this.requireGuestImportRepository();
    const state = await store.loadGuestImportForMapping(
      user.id,
      weddingId,
      batchId,
    );
    if (
      state.status !== "previewed" ||
      state.mappingVersion !== input.expectedVersion
    ) {
      throw new ConflictError("Guest import preview has changed");
    }
    validateGuestImportMapping(state.headers, input.mapping);
    const excluded = new Set(input.excludedRowIds);
    if (
      excluded.size !== input.excludedRowIds.length ||
      input.excludedRowIds.some(
        (id) => !state.rows.some((row) => row.id === id),
      )
    ) {
      throw new DomainValidationError("Unknown or duplicate excluded row");
    }
    const affiliations = await this.repository.listGuestAffiliations(
      user.id,
      weddingId,
    );
    const sourceRows = state.rows.map((row) => ({
      ...row,
      included: !excluded.has(row.id),
    }));
    const rows = await this.buildImportRows(
      user.id,
      weddingId,
      sourceRows,
      input.mapping,
      affiliations,
      input.affiliationMappings,
    );
    return store.replaceGuestImportPreview({
      userId: user.id,
      weddingId,
      batchId,
      expectedVersion: input.expectedVersion,
      mapping: input.mapping,
      affiliationMappings: input.affiliationMappings,
      rows,
    });
  }

  async commitGuestImport(
    weddingId: string,
    batchId: string,
    input: GuestImportCommitInput,
  ): Promise<GuestImportCommitResult> {
    const user = await this.requireOnboardedUser();
    if (
      !Number.isInteger(input.expectedVersion) ||
      input.expectedVersion < 1 ||
      !/^[\x21-\x7e]{1,128}$/u.test(input.idempotencyKey)
    ) {
      throw new DomainValidationError(
        "Invalid import version or idempotency key",
      );
    }
    for (const ids of [input.includedRowIds, input.createAnywayRowIds]) {
      if (
        ids.length > 5000 ||
        new Set(ids).size !== ids.length ||
        ids.some((id) => !isUuid(id))
      ) {
        throw new DomainValidationError("Invalid guest import row IDs");
      }
    }
    return this.requireGuestImportRepository().commitGuestImport({
      userId: user.id,
      weddingId,
      batchId,
      ...input,
    });
  }

  private async buildImportRows(
    userId: string,
    weddingId: string,
    sourceRows: GuestImportSourceRow[],
    mapping: GuestImportMapping,
    affiliations: GuestAffiliation[],
    affiliationMappings: Record<string, string>,
  ): Promise<GuestImportStagedRow[]> {
    const rows = addWithinFileDuplicateWarnings(
      buildGuestImportCandidates({
        rows: sourceRows,
        mapping,
        affiliations,
        affiliationMappings,
      }),
    );
    const keys = rows
      .filter((row) => row.candidate)
      .map((row) => ({
        rowId: row.id,
        normalizedEmail: row.candidate!.email?.toLocaleLowerCase() ?? null,
        normalizedName: row.candidate!.name.toLocaleLowerCase(),
        normalizedPhone: row.candidate!.phone ?? null,
      }));
    const matches =
      await this.requireGuestImportRepository().findLikelyGuestDuplicates(
        userId,
        weddingId,
        keys,
      );
    const warnings = new Map<string, Set<string>>();
    for (const match of matches) {
      const values = warnings.get(match.rowId) ?? new Set<string>();
      values.add(
        match.kind === "email"
          ? "Likely existing guest email"
          : "Likely existing guest name and phone",
      );
      warnings.set(match.rowId, values);
    }
    return sourceRows.map((source, index) => ({
      ...source,
      candidate: rows[index]!.candidate,
      errors: rows[index]!.errors,
      warnings: [...rows[index]!.warnings, ...(warnings.get(source.id) ?? [])],
    }));
  }

  private requireGuestImportRepository() {
    if (!this.guestImportRepository)
      throw new Error("Guest import repository unavailable");
    return this.guestImportRepository;
  }

  async getGuest(weddingId: string, guestId: string): Promise<GuestDetail> {
    const user = await this.requireOnboardedUser();
    return this.repository.getGuest(user.id, weddingId, guestId);
  }

  async updateGuest(
    weddingId: string,
    guestId: string,
    input: UpdateGuestInput,
  ): Promise<GuestDetail> {
    const user = await this.requireOnboardedUser();
    return this.repository.updateGuest(
      user.id,
      weddingId,
      guestId,
      normalizeGuestUpdate(input),
    );
  }

  async archiveGuest(weddingId: string, guestId: string): Promise<GuestDetail> {
    const user = await this.requireOnboardedUser();
    return this.repository.archiveGuest(user.id, weddingId, guestId);
  }

  async restoreGuest(weddingId: string, guestId: string): Promise<GuestDetail> {
    const user = await this.requireOnboardedUser();
    return this.repository.restoreGuest(user.id, weddingId, guestId);
  }

  async bulkSetGuestAffiliation(
    weddingId: string,
    guestIds: string[],
    affiliationId: string | null,
  ): Promise<BulkGuestResult> {
    const user = await this.requireOnboardedUser();
    return this.repository.bulkSetGuestAffiliation(
      user.id,
      weddingId,
      normalizeGuestIds(guestIds),
      affiliationId,
    );
  }

  async bulkArchiveGuests(
    weddingId: string,
    guestIds: string[],
  ): Promise<BulkGuestResult> {
    const user = await this.requireOnboardedUser();
    return this.repository.bulkArchiveGuests(
      user.id,
      weddingId,
      normalizeGuestIds(guestIds),
    );
  }

  async createInvitation(
    weddingId: string,
    guestId: string,
  ): Promise<InvitationCreated> {
    const user = await this.requireOnboardedUser();
    const token = generateInvitationToken();
    const created = await this.repository.createInvitation({
      id: crypto.randomUUID(),
      weddingId,
      guestId,
      createdByUserId: user.id,
      tokenHash: await hashInvitationToken(token),
    });
    return {
      ...created,
      token,
      publicUrl: `${this.publicWebOrigin}/i/${token}`,
    };
  }

  async replaceInvitation(
    weddingId: string,
    guestId: string,
  ): Promise<InvitationCreated> {
    const user = await this.requireOnboardedUser();
    const token = generateInvitationToken();
    const created = await this.repository.replaceInvitation({
      id: crypto.randomUUID(),
      weddingId,
      guestId,
      createdByUserId: user.id,
      tokenHash: await hashInvitationToken(token),
    });
    return {
      ...created,
      token,
      publicUrl: `${this.publicWebOrigin}/i/${token}`,
    };
  }

  async getPublicInvitation(token: string): Promise<PublicInvitation> {
    assertTokenShape(token);
    const invitation = await this.repository.findPublicInvitation(
      await hashInvitationToken(token),
    );
    if (!invitation) throw new NotFoundError("Invitation not found");
    return invitation;
  }

  async submitRsvp(
    token: string,
    input: SubmitRsvpInput,
  ): Promise<RsvpResponse> {
    assertTokenShape(token);
    const normalized = validateRsvp(input, Number.MAX_SAFE_INTEGER);
    const result = await this.repository.upsertRsvp(
      await hashInvitationToken(token),
      crypto.randomUUID(),
      normalized,
    );
    if (result.kind === "not_found") {
      throw new NotFoundError("Invitation not found");
    }
    if (result.kind === "invalid_party_size") {
      validateRsvp(normalized, result.allowedPartySize);
      throw new DomainValidationError("Invalid RSVP");
    }
    return result.value;
  }

  private async requireUser(): Promise<AuthenticatedUser> {
    const principal = await this.identity.resolve(this.request);
    if (!principal) {
      throw new AuthenticationRequiredError("Authentication required");
    }
    return this.repository.syncUser(principal);
  }

  private async requireOnboardedUser(): Promise<AuthenticatedUser> {
    const user = await this.requireUser();
    if (!user.onboardingComplete) {
      throw new OnboardingRequiredError("Profile setup required");
    }
    return user;
  }
}

function normalizePage(page: PageInput): RepositoryPageInput {
  if (!Number.isInteger(page.limit) || page.limit < 1 || page.limit > 100) {
    throw new DomainValidationError("Limit must be between 1 and 100");
  }
  return page.cursor
    ? { limit: page.limit, cursor: decodeCursor(page.cursor) }
    : { limit: page.limit };
}

function normalizeWedding(input: CreateWeddingInput): CreateWeddingInput {
  const name = input.name.trim();
  if (!name || name.length > 120) {
    throw new DomainValidationError("Wedding name must be 1–120 characters");
  }
  try {
    new Intl.DateTimeFormat("en", { timeZone: input.timeZone });
    new Intl.Locale(input.locale);
  } catch {
    throw new DomainValidationError("Invalid locale or time zone");
  }
  if (input.weddingDate && !isIsoDate(input.weddingDate)) {
    throw new DomainValidationError("Wedding date must use YYYY-MM-DD");
  }
  return input.weddingDate
    ? {
        name,
        weddingDate: input.weddingDate,
        timeZone: input.timeZone,
        locale: input.locale,
      }
    : { name, timeZone: input.timeZone, locale: input.locale };
}

export function normalizeGuestCreate(
  input: CreateGuestInput,
): CreateGuestInput {
  const name = input.name.trim();
  if (!name || characterLength(name) > 120) {
    throw new DomainValidationError("Guest name must be 1–120 characters");
  }
  if (
    !Number.isInteger(input.allowedPartySize) ||
    input.allowedPartySize < 1 ||
    input.allowedPartySize > 20
  ) {
    throw new DomainValidationError("Party allowance must be between 1 and 20");
  }
  const email = normalizeEmail(input.email);
  const phone = normalizeOptionalText(input.phone, 40, "Guest phone");
  const envelopeName = normalizeOptionalText(
    input.envelopeName,
    180,
    "Envelope name",
  );
  const note = normalizeOptionalText(input.note, 2_000, "Guest note");
  const result: CreateGuestInput = {
    name,
    allowedPartySize: input.allowedPartySize,
  };
  if (email) result.email = email;
  if (phone) result.phone = phone;
  if (input.affiliationId) result.affiliationId = input.affiliationId;
  if (envelopeName) result.envelopeName = envelopeName;
  if (note) result.note = note;
  if (input.postalAddress) {
    result.postalAddress = normalizePostalAddress(input.postalAddress);
  }
  return result;
}

function normalizeGuestUpdate(input: UpdateGuestInput): NormalizedGuestUpdate {
  const result: NormalizedGuestUpdate = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name || characterLength(name) > 120) {
      throw new DomainValidationError("Guest name must be 1–120 characters");
    }
    result.name = name;
  }
  if (input.email !== undefined)
    result.email = normalizeEmail(input.email) ?? null;
  if (input.phone !== undefined) {
    result.phone =
      normalizeOptionalText(input.phone, 40, "Guest phone") ?? null;
  }
  if (input.allowedPartySize !== undefined) {
    if (
      !Number.isInteger(input.allowedPartySize) ||
      input.allowedPartySize < 1 ||
      input.allowedPartySize > 20
    ) {
      throw new DomainValidationError(
        "Party allowance must be between 1 and 20",
      );
    }
    result.allowedPartySize = input.allowedPartySize;
  }
  if (input.affiliationId !== undefined) {
    result.affiliationId = input.affiliationId || null;
  }
  if (input.envelopeName !== undefined) {
    result.envelopeName =
      normalizeOptionalText(input.envelopeName, 180, "Envelope name") ?? null;
  }
  if (input.note !== undefined) {
    result.note =
      normalizeOptionalText(input.note, 2_000, "Guest note") ?? null;
  }
  if (input.postalAddress !== undefined) {
    result.postalAddress = input.postalAddress
      ? normalizePostalAddress(input.postalAddress)
      : null;
  }
  return result;
}

function normalizePostalAddress(input: PostalAddressInput): PostalAddressInput {
  const addressLine1 = input.addressLine1.trim();
  if (!addressLine1 || characterLength(addressLine1) > 180) {
    throw new DomainValidationError("Address line 1 must be 1–180 characters");
  }
  const result: PostalAddressInput = { addressLine1 };
  const addressLine2 = normalizeOptionalText(
    input.addressLine2,
    180,
    "Address line 2",
  );
  const locality = normalizeOptionalText(input.locality, 120, "Locality");
  const administrativeArea = normalizeOptionalText(
    input.administrativeArea,
    120,
    "Administrative area",
  );
  const postalCode = normalizeOptionalText(input.postalCode, 32, "Postal code");
  const countryCode = input.countryCode?.trim().toUpperCase();
  if (countryCode && !/^[A-Z]{2}$/.test(countryCode)) {
    throw new DomainValidationError("Country code must be two letters");
  }
  if (addressLine2) result.addressLine2 = addressLine2;
  if (locality) result.locality = locality;
  if (administrativeArea) result.administrativeArea = administrativeArea;
  if (postalCode) result.postalCode = postalCode;
  if (countryCode) result.countryCode = countryCode;
  return result;
}

function normalizeEmail(value: string | undefined): string | undefined {
  const email = value?.trim().toLowerCase();
  if (!email) return undefined;
  if (
    characterLength(email) > 320 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    throw new DomainValidationError("Invalid guest email");
  }
  return email;
}

function normalizeOptionalText(
  value: string | undefined,
  limit: number,
  field: string,
): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  if (characterLength(normalized) > limit) {
    throw new DomainValidationError(
      `${field} must be at most ${limit} characters`,
    );
  }
  return normalized;
}

function normalizeGuestIds(guestIds: string[]): string[] {
  if (
    guestIds.length < 1 ||
    guestIds.length > 200 ||
    new Set(guestIds).size !== guestIds.length ||
    guestIds.some((id) => !isUuid(id))
  ) {
    throw new DomainValidationError(
      "Bulk guest actions accept 1–200 unique guests",
    );
  }
  return guestIds;
}

function normalizeGuestList(
  input: PageInput & Partial<Omit<GuestListInput, keyof PageInput>>,
): GuestListRepositoryInput {
  const page = normalizePage(input);
  const result: GuestListRepositoryInput = {
    ...page,
    view: input.view ?? "active",
  };
  const search = normalizeOptionalText(input.search, 120, "Guest search");
  if (search) result.search = search;
  if (input.affiliation) result.affiliation = input.affiliation;
  if (input.rsvp) result.rsvp = input.rsvp;
  return result;
}

function characterLength(value: string): number {
  return Array.from(value).length;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function normalizeGuestAffiliation(
  input: CreateGuestAffiliationInput,
): CreateGuestAffiliationInput {
  const name = input.name.trim();
  if (!name || Array.from(name).length > 80) {
    throw new DomainValidationError(
      "Guest affiliation name must be 1–80 characters",
    );
  }
  const color = input.color.toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(color)) {
    throw new DomainValidationError("Guest affiliation color is invalid");
  }
  return { name, color };
}

function assertTokenShape(token: string): void {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new NotFoundError("Invitation not found");
  }
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
  );
}
