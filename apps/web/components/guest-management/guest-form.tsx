import type {
  CreateGuestInput,
  GuestAffiliation,
  PostalAddressInput,
} from "@lovechapter/contracts";
import { useState, type FormEvent } from "react";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select } from "../ui/select";

export function GuestForm({
  affiliations,
  busy,
  onCreate,
}: {
  affiliations: GuestAffiliation[];
  busy: boolean;
  onCreate(input: CreateGuestInput): Promise<void>;
}) {
  const [includeAddress, setIncludeAddress] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const affiliationId = value(data, "affiliationId");
    const postalAddress = includeAddress ? addressFrom(data) : undefined;
    try {
      await onCreate({
        name: value(data, "name"),
        allowedPartySize: Number(value(data, "allowedPartySize")),
        ...optional("email", data),
        ...optional("phone", data),
        ...optional("envelopeName", data),
        ...optional("note", data),
        ...(affiliationId ? { affiliationId } : {}),
        ...(postalAddress ? { postalAddress } : {}),
      });
      form.reset();
      setIncludeAddress(false);
    } catch {
      // The workspace displays the API error; keep entered values for correction.
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Field label="Guest name" htmlFor="guest-name">
          <Input id="guest-name" name="name" required maxLength={120} />
        </Field>
        <Field label="Email (optional)" htmlFor="guest-email">
          <Input id="guest-email" name="email" type="email" maxLength={320} />
        </Field>
        <Field label="Guest affiliation" htmlFor="guest-affiliation">
          <Select id="guest-affiliation" name="affiliationId">
            <option value="">No affiliation</option>
            {affiliations.map((affiliation) => (
              <option key={affiliation.id} value={affiliation.id}>
                {affiliation.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Party allowance" htmlFor="party-allowance">
          <Input
            id="party-allowance"
            name="allowedPartySize"
            type="number"
            min={1}
            max={20}
            defaultValue={1}
            required
          />
        </Field>
      </div>
      <details className="rounded-xl border border-[#eadbd3] p-4">
        <summary className="cursor-pointer font-semibold text-[#60464d]">
          Optional contact, envelope, and mailing details
        </summary>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Phone" htmlFor="guest-phone">
            <Input id="guest-phone" name="phone" maxLength={40} />
          </Field>
          <Field label="Envelope name" htmlFor="guest-envelope-name">
            <Input
              id="guest-envelope-name"
              name="envelopeName"
              maxLength={180}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Note" htmlFor="guest-note">
              <textarea
                id="guest-note"
                name="note"
                maxLength={2000}
                className="min-h-24 w-full rounded-xl border border-[#d8c9c3] bg-white px-3 py-2"
              />
            </Field>
          </div>
          <label className="flex items-center gap-2 sm:col-span-2">
            <input
              type="checkbox"
              checked={includeAddress}
              onChange={(event) =>
                setIncludeAddress(event.currentTarget.checked)
              }
            />
            Include postal address
          </label>
          {includeAddress ? <AddressFields prefix="guest" /> : null}
        </div>
      </details>
      <Button type="submit" disabled={busy}>
        {busy ? "Adding…" : "Add guest"}
      </Button>
    </form>
  );
}

export function AddressFields({ prefix }: { prefix: string }) {
  return (
    <>
      <Field label="Address line 1" htmlFor={`${prefix}-address-line-1`}>
        <Input
          id={`${prefix}-address-line-1`}
          name="addressLine1"
          required
          maxLength={180}
        />
      </Field>
      <Field label="Address line 2" htmlFor={`${prefix}-address-line-2`}>
        <Input
          id={`${prefix}-address-line-2`}
          name="addressLine2"
          maxLength={180}
        />
      </Field>
      <Field label="Locality" htmlFor={`${prefix}-locality`}>
        <Input id={`${prefix}-locality`} name="locality" maxLength={120} />
      </Field>
      <Field
        label="Administrative area"
        htmlFor={`${prefix}-administrative-area`}
      >
        <Input
          id={`${prefix}-administrative-area`}
          name="administrativeArea"
          maxLength={120}
        />
      </Field>
      <Field label="Postal code" htmlFor={`${prefix}-postal-code`}>
        <Input id={`${prefix}-postal-code`} name="postalCode" maxLength={32} />
      </Field>
      <Field label="Country code" htmlFor={`${prefix}-country-code`}>
        <Input
          id={`${prefix}-country-code`}
          name="countryCode"
          pattern="[A-Za-z]{2}"
          maxLength={2}
        />
      </Field>
    </>
  );
}

export function addressFrom(data: FormData): PostalAddressInput {
  const result: PostalAddressInput = {
    addressLine1: value(data, "addressLine1"),
  };
  for (const [key, name] of [
    ["addressLine2", "addressLine2"],
    ["locality", "locality"],
    ["administrativeArea", "administrativeArea"],
    ["postalCode", "postalCode"],
    ["countryCode", "countryCode"],
  ] as const) {
    const fieldValue = value(data, name);
    if (fieldValue) result[key] = fieldValue;
  }
  return result;
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

function value(data: FormData, name: string): string {
  return String(data.get(name) ?? "").trim();
}

function optional<K extends "email" | "phone" | "envelopeName" | "note">(
  key: K,
  data: FormData,
): Partial<Record<K, string>> {
  const fieldValue = value(data, key);
  return fieldValue
    ? ({ [key]: fieldValue } as Partial<Record<K, string>>)
    : {};
}
