import type {
  GuestAffiliation,
  GuestRsvpFilter,
  GuestView,
} from "@lovechapter/contracts";

import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select } from "../ui/select";

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
  return (
    <div className="grid gap-3 rounded-2xl border border-[#eadbd3] bg-white p-4 sm:grid-cols-2 xl:grid-cols-4">
      <div>
        <Label htmlFor="guest-search">Search guests</Label>
        <Input
          id="guest-search"
          value={filters.search}
          maxLength={120}
          placeholder="Name, email, or phone"
          onChange={(event) =>
            onChange({ ...filters, search: event.currentTarget.value })
          }
        />
      </div>
      <div>
        <Label htmlFor="guest-view">Guest view</Label>
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
          <option value="active">Active</option>
          <option value="archived">Archived</option>
        </Select>
      </div>
      <div>
        <Label htmlFor="guest-affiliation-filter">Affiliation</Label>
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
          <option value="">All affiliations</option>
          <option value="unassigned">Unassigned</option>
          {affiliations.map((affiliation) => (
            <option key={affiliation.id} value={affiliation.id}>
              {affiliation.name}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="guest-rsvp-filter">RSVP status</Label>
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
          <option value="">All RSVP statuses</option>
          <option value="pending">Pending</option>
          <option value="attending">Attending</option>
          <option value="declined">Declined</option>
        </Select>
      </div>
    </div>
  );
}
