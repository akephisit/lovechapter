import type {
  EnvelopePrintData,
  EnvelopePrintDataInput,
  EnvelopeTemplate,
  EnvelopeTemplateInput,
  PostalAddressInput,
} from "@lovechapter/contracts";
import {
  ConflictError,
  NotFoundError,
  normalizeEnvelopeTemplateInput,
  normalizeEnvelopePrintDataInput,
  type EnvelopeRepository,
} from "@lovechapter/domain";

import {
  buildDeleteEnvelopeTemplateQuery,
  buildEnvelopePrintGuestsQuery,
  buildGetEnvelopeTemplateQuery,
  buildInsertEnvelopeTemplateQuery,
  buildListEnvelopeTemplatesQuery,
  buildLockEnvelopeWeddingQuery,
  buildUpdateEnvelopeTemplateQuery,
} from "./envelope-queries";
import type { QueryExecutor } from "./repository";

type TemplateRow = {
  id: string;
  name: string;
  width_mm: number;
  height_mm: number;
  orientation: EnvelopeTemplateInput["orientation"];
  margin_top_mm: number;
  margin_right_mm: number;
  margin_bottom_mm: number;
  margin_left_mm: number;
  alignment: EnvelopeTemplateInput["alignment"];
  font_family: EnvelopeTemplateInput["fontFamily"];
  font_size_pt: number;
  line_spacing_percent: number;
  show_address: boolean;
  created_at: string | Date;
  updated_at: string | Date;
};
type PrintRow = {
  id: string;
  envelope_name: string;
  address_line_1: string | null;
  address_line_2: string | null;
  locality: string | null;
  administrative_area: string | null;
  postal_code: string | null;
  country_code: string | null;
};
function mapTemplate(row: TemplateRow): EnvelopeTemplate {
  return {
    id: row.id,
    name: row.name,
    widthMm: row.width_mm,
    heightMm: row.height_mm,
    orientation: row.orientation,
    marginTopMm: row.margin_top_mm,
    marginRightMm: row.margin_right_mm,
    marginBottomMm: row.margin_bottom_mm,
    marginLeftMm: row.margin_left_mm,
    alignment: row.alignment,
    fontFamily: row.font_family,
    fontSizePt: row.font_size_pt,
    lineSpacingPercent: row.line_spacing_percent,
    showAddress: row.show_address,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : row.created_at,
    updatedAt:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : row.updated_at,
  };
}
function inputFromTemplate(value: EnvelopeTemplate): EnvelopeTemplateInput {
  return normalizeEnvelopeTemplateInput(value);
}
export class PostgresEnvelopeRepository implements EnvelopeRepository {
  constructor(private readonly executor: QueryExecutor) {}

  async listEnvelopeTemplates(
    userId: string,
    weddingId: string,
  ): Promise<EnvelopeTemplate[]> {
    const scope = { userId, weddingId };
    const authorized = await this.executor.execute<{ id: string }>(
      buildLockEnvelopeWeddingQuery(scope),
    );
    if (!authorized.rows[0]) throw new NotFoundError("Wedding not found");
    const result = await this.executor.execute<TemplateRow>(
      buildListEnvelopeTemplatesQuery(scope),
    );
    if (result.rows.length > 50)
      throw new ConflictError("Too many envelope templates");
    return result.rows.map(mapTemplate);
  }

  async createEnvelopeTemplate(
    userId: string,
    weddingId: string,
    id: string,
    template: EnvelopeTemplateInput,
  ): Promise<EnvelopeTemplate> {
    const scope = { userId, weddingId };
    try {
      return await this.executor.transaction(async (transaction) => {
        const locked = await transaction.execute<{ id: string }>(
          buildLockEnvelopeWeddingQuery(scope),
        );
        if (!locked.rows[0]) throw new NotFoundError("Wedding not found");
        const existing = await transaction.execute<TemplateRow>(
          buildListEnvelopeTemplatesQuery(scope),
        );
        if (existing.rows.length >= 50)
          throw new ConflictError(
            "A wedding can save at most 50 envelope templates",
          );
        const result = await transaction.execute<TemplateRow>(
          buildInsertEnvelopeTemplateQuery({ ...scope, id, template }),
        );
        if (!result.rows[0]) throw new NotFoundError("Wedding not found");
        return mapTemplate(result.rows[0]);
      });
    } catch (error) {
      throw duplicateNameConflict(error);
    }
  }

  async updateEnvelopeTemplate(
    userId: string,
    weddingId: string,
    templateId: string,
    template: EnvelopeTemplateInput,
  ): Promise<EnvelopeTemplate> {
    try {
      const result = await this.executor.execute<TemplateRow>(
        buildUpdateEnvelopeTemplateQuery({
          userId,
          weddingId,
          templateId,
          template,
        }),
      );
      if (!result.rows[0])
        throw new NotFoundError("Envelope template not found");
      return mapTemplate(result.rows[0]);
    } catch (error) {
      throw duplicateNameConflict(error);
    }
  }
  async deleteEnvelopeTemplate(
    userId: string,
    weddingId: string,
    templateId: string,
  ): Promise<void> {
    const result = await this.executor.execute<{ id: string }>(
      buildDeleteEnvelopeTemplateQuery({ userId, weddingId, templateId }),
    );
    if (!result.rows[0]) throw new NotFoundError("Envelope template not found");
  }

  async getEnvelopePrintData(
    userId: string,
    weddingId: string,
    input: EnvelopePrintDataInput,
  ): Promise<EnvelopePrintData> {
    input = normalizeEnvelopePrintDataInput(input);
    const scope = { userId, weddingId };
    let template = input.template;
    if (input.templateId) {
      const found = await this.executor.execute<TemplateRow>(
        buildGetEnvelopeTemplateQuery({
          ...scope,
          templateId: input.templateId,
        }),
      );
      if (!found.rows[0])
        throw new NotFoundError("Envelope template not found");
      template = inputFromTemplate(mapTemplate(found.rows[0]));
    }
    if (!template) throw new NotFoundError("Envelope template not found");
    const result = await this.executor.execute<PrintRow>(
      buildEnvelopePrintGuestsQuery({ ...scope, guestIds: input.guestIds }),
    );
    if (result.rows.length !== input.guestIds.length)
      throw new NotFoundError("One or more guests were not found or archived");
    return {
      template,
      guests: result.rows.map((row) => {
        const postalAddress: PostalAddressInput | null = row.address_line_1
          ? {
              addressLine1: row.address_line_1,
              ...(row.address_line_2
                ? { addressLine2: row.address_line_2 }
                : {}),
              ...(row.locality ? { locality: row.locality } : {}),
              ...(row.administrative_area
                ? { administrativeArea: row.administrative_area }
                : {}),
              ...(row.postal_code ? { postalCode: row.postal_code } : {}),
              ...(row.country_code ? { countryCode: row.country_code } : {}),
            }
          : null;
        return { id: row.id, envelopeName: row.envelope_name, postalAddress };
      }),
    };
  }
}
function duplicateNameConflict(error: unknown): unknown {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
    ? new ConflictError("Envelope template name already exists")
    : error;
}
