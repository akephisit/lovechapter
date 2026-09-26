import type {
  EnvelopePrintData,
  EnvelopePrintDataInput,
  EnvelopeTemplate,
  EnvelopeTemplateInput,
} from "@lovechapter/contracts";

import { ConflictError, NotFoundError } from "../errors";
import { normalizeEnvelopeTemplateInput } from "../envelope-printing";
import type { EnvelopeRepository, LoveChapterRepository } from "../ports";

export class InMemoryEnvelopeRepository implements EnvelopeRepository {
  private readonly templates = new Map<string, EnvelopeTemplate[]>();
  constructor(private readonly guests: LoveChapterRepository) {}
  private async authorized(userId: string, weddingId: string) {
    await this.guests.listGuestAffiliations(userId, weddingId);
  }
  async listEnvelopeTemplates(
    userId: string,
    weddingId: string,
  ): Promise<EnvelopeTemplate[]> {
    await this.authorized(userId, weddingId);
    return [...(this.templates.get(weddingId) ?? [])].toSorted(
      (a, b) =>
        b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id),
    );
  }
  async createEnvelopeTemplate(
    userId: string,
    weddingId: string,
    id: string,
    input: EnvelopeTemplateInput,
  ): Promise<EnvelopeTemplate> {
    const existing = await this.listEnvelopeTemplates(userId, weddingId);
    if (
      existing.length >= 50 ||
      existing.some(
        (item) =>
          item.name.toLocaleLowerCase() === input.name.toLocaleLowerCase(),
      )
    )
      throw new ConflictError("Envelope template limit or name conflict");
    const now = new Date().toISOString();
    const template = { ...input, id, createdAt: now, updatedAt: now };
    this.templates.set(weddingId, [...existing, template]);
    return template;
  }
  async updateEnvelopeTemplate(
    userId: string,
    weddingId: string,
    templateId: string,
    input: EnvelopeTemplateInput,
  ): Promise<EnvelopeTemplate> {
    const existing = await this.listEnvelopeTemplates(userId, weddingId);
    const old = existing.find((item) => item.id === templateId);
    if (!old) throw new NotFoundError("Envelope template not found");
    if (
      existing.some(
        (item) =>
          item.id !== templateId &&
          item.name.toLocaleLowerCase() === input.name.toLocaleLowerCase(),
      )
    )
      throw new ConflictError("Envelope template name conflict");
    const updated = { ...old, ...input, updatedAt: new Date().toISOString() };
    this.templates.set(
      weddingId,
      existing.map((item) => (item.id === templateId ? updated : item)),
    );
    return updated;
  }
  async deleteEnvelopeTemplate(
    userId: string,
    weddingId: string,
    templateId: string,
  ): Promise<void> {
    const existing = await this.listEnvelopeTemplates(userId, weddingId);
    if (!existing.some((item) => item.id === templateId))
      throw new NotFoundError("Envelope template not found");
    this.templates.set(
      weddingId,
      existing.filter((item) => item.id !== templateId),
    );
  }
  async getEnvelopePrintData(
    userId: string,
    weddingId: string,
    input: EnvelopePrintDataInput,
  ): Promise<EnvelopePrintData> {
    await this.authorized(userId, weddingId);
    const saved = input.templateId
      ? (await this.listEnvelopeTemplates(userId, weddingId)).find(
          (item) => item.id === input.templateId,
        )
      : null;
    if (input.templateId && !saved)
      throw new NotFoundError("Envelope template not found");
    const template = saved ? templateInput(saved) : input.template;
    if (!template) throw new NotFoundError("Envelope template not found");
    const guests = await Promise.all(
      input.guestIds.map(async (id) => {
        const guest = await this.guests.getGuest(userId, weddingId, id);
        if (guest.archivedAt)
          throw new NotFoundError("Guest not found or archived");
        return {
          id,
          envelopeName: guest.envelopeName ?? guest.name,
          postalAddress: guest.postalAddress ?? null,
        };
      }),
    );
    return { template, guests };
  }
}
function templateInput(value: EnvelopeTemplate): EnvelopeTemplateInput {
  return normalizeEnvelopeTemplateInput(value);
}
