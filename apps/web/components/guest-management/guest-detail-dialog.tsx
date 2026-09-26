import type {
  GuestDetail,
  PostalAddressInput,
  UpdateGuestInput,
} from "@lovechapter/contracts";
import { useState, type FormEvent } from "react";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { AddressFields, addressFrom } from "./guest-form";

export function GuestDetailDialog({
  guest,
  busy,
  onClose,
  onSave,
}: {
  guest: GuestDetail;
  busy: boolean;
  onClose(): void;
  onSave(input: UpdateGuestInput): Promise<void>;
}) {
  const [includeAddress, setIncludeAddress] = useState(
    guest.postalAddress !== null,
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await onSave({
      name: text(data, "name"),
      email: text(data, "email"),
      phone: text(data, "phone"),
      allowedPartySize: Number(text(data, "allowedPartySize")),
      envelopeName: text(data, "envelopeName"),
      note: text(data, "note"),
      postalAddress: includeAddress ? addressFrom(data) : null,
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Edit ${guest.name}`}
      className="fixed inset-0 z-50 grid place-items-center bg-black/35 p-4"
    >
      <form
        onSubmit={(event) => void submit(event)}
        className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl bg-white p-6 shadow-xl"
      >
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="font-serif text-2xl font-semibold">
            Edit {guest.name}
          </h2>
          <Button type="button" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Guest name" htmlFor="edit-guest-name">
            <Input
              id="edit-guest-name"
              name="name"
              required
              defaultValue={guest.name}
            />
          </Field>
          <Field label="Email" htmlFor="edit-guest-email">
            <Input
              id="edit-guest-email"
              name="email"
              defaultValue={guest.email ?? ""}
            />
          </Field>
          <Field label="Party allowance" htmlFor="edit-party-allowance">
            <Input
              id="edit-party-allowance"
              name="allowedPartySize"
              type="number"
              min={1}
              max={20}
              required
              defaultValue={guest.allowedPartySize}
            />
          </Field>
        </div>
        <details className="mt-4 rounded-xl border border-[#eadbd3] p-4">
          <summary className="cursor-pointer font-semibold text-[#60464d]">
            Optional contact, envelope, and mailing details
          </summary>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Phone" htmlFor="edit-guest-phone">
              <Input
                id="edit-guest-phone"
                name="phone"
                defaultValue={guest.phone ?? ""}
              />
            </Field>
            <Field label="Envelope name" htmlFor="edit-envelope-name">
              <Input
                id="edit-envelope-name"
                name="envelopeName"
                defaultValue={guest.envelopeName ?? ""}
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Note" htmlFor="edit-note">
                <textarea
                  id="edit-note"
                  name="note"
                  defaultValue={guest.note ?? ""}
                  className="min-h-24 w-full rounded-xl border border-[#d8c9c3] p-3"
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
            {includeAddress ? (
              <AddressDefaults address={guest.postalAddress} />
            ) : null}
          </div>
        </details>
        <Button className="mt-5" type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save guest"}
        </Button>
      </form>
    </div>
  );
}

function AddressDefaults({ address }: { address: PostalAddressInput | null }) {
  if (!address) return <AddressFields prefix="edit" />;
  return (
    <>
      <label>
        <Label htmlFor="edit-address-line-1">Address line 1</Label>
        <Input
          id="edit-address-line-1"
          name="addressLine1"
          required
          defaultValue={address.addressLine1}
        />
      </label>
      <label>
        <Label htmlFor="edit-address-line-2">Address line 2</Label>
        <Input
          id="edit-address-line-2"
          name="addressLine2"
          defaultValue={address.addressLine2 ?? ""}
        />
      </label>
      <label>
        <Label htmlFor="edit-locality">Locality</Label>
        <Input
          id="edit-locality"
          name="locality"
          defaultValue={address.locality ?? ""}
        />
      </label>
      <label>
        <Label htmlFor="edit-administrative-area">Administrative area</Label>
        <Input
          id="edit-administrative-area"
          name="administrativeArea"
          defaultValue={address.administrativeArea ?? ""}
        />
      </label>
      <label>
        <Label htmlFor="edit-postal-code">Postal code</Label>
        <Input
          id="edit-postal-code"
          name="postalCode"
          defaultValue={address.postalCode ?? ""}
        />
      </label>
      <label>
        <Label htmlFor="edit-country-code">Country code</Label>
        <Input
          id="edit-country-code"
          name="countryCode"
          defaultValue={address.countryCode ?? ""}
        />
      </label>
    </>
  );
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

function text(data: FormData, name: string): string {
  return String(data.get(name) ?? "").trim();
}
