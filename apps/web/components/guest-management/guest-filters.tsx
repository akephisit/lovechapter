import type {
  GuestAffiliation,
  GuestRsvpFilter,
  GuestView,
} from "@lovechapter/contracts";

import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select } from "../ui/select";
import { useUiCopy } from "../ui-language-provider";

export type GuestFilters = {
  search: string;
  affiliation?: string | "unassigned";
  rsvp?: GuestRsvpFilter;
  view: GuestView;
};

export function GuestFiltersForm({
  filters,
  affiliations,
  onChange,
}: {
  filters: GuestFilters;
  affiliations: GuestAffiliation[];
  onChange(filters: GuestFilters): void;
}) {
  const copy = useUiCopy();
  return (
    <div className="grid gap-3 rounded-2xl border border-[#eadbd3] bg-white p-4 sm:grid-cols-2 xl:grid-cols-4">
      <div>
        <Label htmlFor="guest-search">{copy.guest.search}</Label>
        <Input
          id="guest-search"
          value={filters.search}
          maxLength={120}
          placeholder={copy.guest.searchPlaceholder}
          onChange={(event) =>
            onChange({ ...filters, search: event.currentTarget.value })
          }
        />
      </div>
      <div>
        <Label htmlFor="guest-view">{copy.guest.view}</Label>
        <Select
          id="guest-view"
          value={filters.view}
          onChange={(event) =>
            onChange({
              ...filters,
              view: event.currentTarget.value as GuestView,
            })
          }
        >
          <option value="active">{copy.guest.active}</option>
          <option value="archived">{copy.guest.archived}</option>
        </Select>
      </div>
      <div>
        <Label htmlFor="guest-affiliation-filter">
          {copy.guest.affiliation}
        </Label>
        <Select
          id="guest-affiliation-filter"
          value={filters.affiliation ?? ""}
          onChange={(event) => {
            const affiliation = event.currentTarget.value;
            const remaining = { ...filters };
            delete remaining.affiliation;
            onChange(affiliation ? { ...remaining, affiliation } : remaining);
          }}
        >
          <option value="">{copy.guest.allAffiliations}</option>
          <option value="unassigned">{copy.guest.unassigned}</option>
          {affiliations.map((affiliation) => (
            <option key={affiliation.id} value={affiliation.id}>
              {affiliation.name}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="guest-rsvp-filter">{copy.guest.rsvpStatus}</Label>
        <Select
          id="guest-rsvp-filter"
          value={filters.rsvp ?? ""}
          onChange={(event) => {
            const rsvp = event.currentTarget.value;
            const remaining = { ...filters };
            delete remaining.rsvp;
            onChange(
              rsvp
                ? { ...remaining, rsvp: rsvp as GuestRsvpFilter }
                : remaining,
            );
          }}
        >
          <option value="">{copy.guest.allStatuses}</option>
          <option value="pending">{copy.guest.pending}</option>
          <option value="attending">{copy.guest.attending}</option>
          <option value="declined">{copy.guest.declined}</option>
        </Select>
      </div>
    </div>
  );
}
