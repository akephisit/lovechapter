"use client";

import type {
  Attendance,
  PublicInvitation,
  RsvpResponse,
  SubmitRsvpInput,
} from "@lovechapter/contracts";
import { CalendarDays, Check, Heart, MapPin } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { ApiError, loveChapterApi } from "../lib/api-client";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Label } from "./ui/label";
import { Select } from "./ui/select";
import { Textarea } from "./ui/textarea";

export interface PublicRsvpApi {
  getInvitation(token: string): Promise<PublicInvitation>;
  submitRsvp(token: string, input: SubmitRsvpInput): Promise<RsvpResponse>;
}

export function PublicRsvp({
  token,
  api = loveChapterApi,
}: {
  token: string;
  api?: PublicRsvpApi;
}) {
  const [invitation, setInvitation] = useState<PublicInvitation | null>(null);
  const [attendance, setAttendance] = useState<Attendance>("attending");
  const [partySize, setPartySize] = useState(1);
  const [note, setNote] = useState("");
  const [state, setState] = useState<
    "loading" | "load-error" | "ready" | "saving" | "saved" | "unavailable"
  >("loading");
  const [error, setError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    void api
      .getInvitation(token)
      .then((result) => {
        if (!current) return;
        setInvitation(result);
        if (result.rsvp) {
          setAttendance(result.rsvp.attendance);
          setPartySize(result.rsvp.partySize);
          setNote(result.rsvp.note ?? "");
        }
        setState("ready");
      })
      .catch((caught: unknown) => {
        if (!current) return;
        if (
          caught instanceof ApiError &&
          (caught.status === 404 || caught.status === 410)
        ) {
          setState("unavailable");
          return;
        }
        setError("We couldn't load this invitation. Please try again.");
        setState("load-error");
      });
    return () => {
      current = false;
    };
  }, [api, loadAttempt, token]);

  async function saveRsvp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("saving");
    setError(null);
    try {
      const trimmedNote = note.trim();
      const saved = await api.submitRsvp(token, {
        attendance,
        partySize: attendance === "attending" ? partySize : 0,
        ...(trimmedNote ? { note: trimmedNote } : {}),
      });
      setInvitation((current) =>
        current ? { ...current, rsvp: saved } : current,
      );
      setState("saved");
    } catch (caught) {
      setError(
        caught instanceof Error && caught.message
          ? caught.message
          : "We couldn't save your RSVP. Please try again.",
      );
      setState("ready");
    }
  }

  if (state === "loading") {
    return <CenteredMessage>Opening your invitation…</CenteredMessage>;
  }

  if (state === "load-error") {
    return (
      <CenteredMessage>
        <Heart className="mx-auto mb-5 size-8 text-[#9d6471]" />
        <h1 className="font-serif text-3xl font-semibold text-[#432f35]">
          We couldn&apos;t open this invitation
        </h1>
        <p className="mt-3 leading-7 text-[#786568]">{error}</p>
        <Button
          className="mt-6"
          type="button"
          onClick={() => {
            setError(null);
            setState("loading");
            setLoadAttempt((attempt) => attempt + 1);
          }}
        >
          Try again
        </Button>
      </CenteredMessage>
    );
  }

  if (state === "unavailable" || !invitation) {
    return (
      <CenteredMessage>
        <Heart className="mx-auto mb-5 size-8 text-[#9d6471]" />
        <h1 className="font-serif text-3xl font-semibold text-[#432f35]">
          Invitation unavailable
        </h1>
        <p className="mt-3 leading-7 text-[#786568]">
          This invitation may have expired or been replaced. Please ask the
          couple for a new link.
        </p>
      </CenteredMessage>
    );
  }

  const options = Array.from(
    { length: invitation.guest.allowedPartySize },
    (_, index) => index + 1,
  );

  return (
    <main className="relative min-h-screen overflow-hidden px-4 py-8 sm:px-6 sm:py-12">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_12%_12%,rgba(199,147,142,0.3),transparent_32%),radial-gradient(circle_at_88%_24%,rgba(173,142,167,0.24),transparent_34%)]" />
      <div className="mx-auto max-w-5xl">
        <header className="mb-8 flex items-center justify-center gap-2 text-[#71384b]">
          <Heart aria-hidden="true" className="size-4" fill="currentColor" />
          <span className="text-sm font-bold tracking-[0.16em] uppercase">
            LoveChapter
          </span>
        </header>
        <Card className="overflow-hidden">
          <div className="grid lg:grid-cols-[1.05fr_0.95fr]">
            <section className="relative overflow-hidden bg-[#71384b] px-6 py-10 text-white sm:px-10 sm:py-14 lg:min-h-[42rem] lg:px-12 lg:py-16">
              <div className="absolute -top-20 -right-20 size-64 rounded-full border border-white/10" />
              <div className="absolute -right-12 -bottom-20 size-52 rounded-full bg-white/5" />
              <p className="mb-5 text-xs font-bold tracking-[0.24em] text-[#f1d7d8] uppercase">
                A celebration of love
              </p>
              <h1 className="font-serif text-4xl leading-tight font-semibold sm:text-5xl">
                You&apos;re invited,
                <br />
                {invitation.guest.name}.
              </h1>
              <p className="mt-6 text-lg leading-8 text-white/75">
                Join us as we begin a beautiful new chapter together.
              </p>
              <div className="mt-12 border-t border-white/15 pt-8">
                <p className="font-serif text-3xl font-semibold">
                  {invitation.wedding.name}
                </p>
                <div className="mt-5 space-y-3 text-sm text-white/75">
                  <p className="flex items-center gap-3">
                    <CalendarDays aria-hidden="true" className="size-4" />
                    {formatWeddingDate(invitation)}
                  </p>
                  <p className="flex items-center gap-3">
                    <MapPin aria-hidden="true" className="size-4" />
                    Times shown in {invitation.wedding.timeZone}
                  </p>
                </div>
              </div>
            </section>

            <section className="px-6 py-9 sm:px-10 sm:py-12 lg:px-12 lg:py-16">
              <Badge className="mb-4">Private RSVP</Badge>
              <h2 className="font-serif text-3xl font-semibold text-[#432f35]">
                Will you join us?
              </h2>
              <p className="mt-2 leading-7 text-[#7c686b]">
                Your response can be updated later using this same invitation.
              </p>

              <form onSubmit={saveRsvp} className="mt-8 space-y-6">
                <fieldset>
                  <legend className="mb-3 text-sm font-semibold text-[#574248]">
                    Your response
                  </legend>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                    <ResponseChoice
                      label="Joyfully accept"
                      value="attending"
                      checked={attendance === "attending"}
                      onChange={() => {
                        setAttendance("attending");
                        if (partySize < 1) setPartySize(1);
                      }}
                    />
                    <ResponseChoice
                      label="Regretfully decline"
                      value="declined"
                      checked={attendance === "declined"}
                      onChange={() => {
                        setAttendance("declined");
                        setPartySize(0);
                      }}
                    />
                  </div>
                </fieldset>

                {attendance === "attending" ? (
                  <div>
                    <Label htmlFor="party-size">Party size</Label>
                    <Select
                      id="party-size"
                      value={partySize}
                      onChange={(event) =>
                        setPartySize(Number(event.target.value))
                      }
                    >
                      {options.map((size) => (
                        <option key={size} value={size}>
                          {size} {size === 1 ? "guest" : "guests"}
                        </option>
                      ))}
                    </Select>
                    <p className="mt-1.5 text-xs text-[#8b7779]">
                      This invitation welcomes up to{" "}
                      {invitation.guest.allowedPartySize}.
                    </p>
                  </div>
                ) : null}

                <div>
                  <Label htmlFor="rsvp-note">Note (optional)</Label>
                  <Textarea
                    id="rsvp-note"
                    value={note}
                    maxLength={500}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="Share a warm note with the couple…"
                  />
                </div>

                {error ? (
                  <p
                    role="alert"
                    className="rounded-xl border border-[#d6aaa4] bg-[#fff3ed] px-3 py-2 text-sm text-[#743f45]"
                  >
                    {error}
                  </p>
                ) : null}

                <Button
                  className="w-full"
                  type="submit"
                  disabled={state === "saving"}
                >
                  {state === "saving" ? "Saving…" : "Save RSVP"}
                </Button>

                {state === "saved" ? (
                  <p
                    role="status"
                    className="flex items-center justify-center gap-2 text-sm font-semibold text-[#456648]"
                  >
                    <Check aria-hidden="true" className="size-4" />
                    Your RSVP is saved.
                  </p>
                ) : null}
              </form>
            </section>
          </div>
        </Card>
        <p className="mt-6 text-center text-xs leading-5 text-[#8b7779]">
          No account or password is needed. Keep this private invitation link
          safe.
        </p>
      </div>
    </main>
  );
}

function ResponseChoice({
  label,
  value,
  checked,
  onChange,
}: {
  label: string;
  value: Attendance;
  checked: boolean;
  onChange(): void;
}) {
  return (
    <label className="flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border border-[#d8c7bd] bg-white/80 px-4 py-3 text-sm font-semibold text-[#574248] transition has-[:checked]:border-[#895160] has-[:checked]:bg-[#f8edeb]">
      <input
        type="radio"
        name="attendance"
        value={value}
        checked={checked}
        onChange={onChange}
        className="size-4 accent-[#71384b]"
      />
      {label}
    </label>
  );
}

function CenteredMessage({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <Card className="max-w-lg p-8 text-center sm:p-10">{children}</Card>
    </main>
  );
}

function formatWeddingDate(invitation: PublicInvitation): string {
  if (!invitation.wedding.weddingDate) return "Date to be announced";
  return new Intl.DateTimeFormat(invitation.wedding.locale, {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(`${invitation.wedding.weddingDate}T12:00:00.000Z`));
}
