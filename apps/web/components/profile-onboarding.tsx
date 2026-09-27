"use client";

import type {
  AuthenticatedUser,
  UpdateProfileInput,
} from "@lovechapter/contracts";
import { Heart } from "lucide-react";
import { useState, type FormEvent } from "react";

import { authErrorMessage } from "./auth-form-utils";
import { LanguageSwitcher } from "./language-switcher";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { useUiCopy } from "./ui-language-provider";
import { localizeStoredUiMessage } from "../lib/ui-copy";

export interface ProfileOnboardingApi {
  updateMyProfile(input: UpdateProfileInput): Promise<AuthenticatedUser>;
}

type Props = {
  suggestedDisplayName: string;
  api: ProfileOnboardingApi;
  onComplete(user: AuthenticatedUser): void;
};

export function ProfileOnboarding({
  suggestedDisplayName,
  api,
  onComplete,
}: Props) {
  const copy = useUiCopy();
  const [displayName, setDisplayName] = useState(suggestedDisplayName);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    const normalizedDisplayName = displayName.trim();
    if (
      !normalizedDisplayName ||
      Array.from(normalizedDisplayName).length > 120
    ) {
      setMessage(copy.profile.nameLength);
      return;
    }
    setSaving(true);
    try {
      const user = await api.updateMyProfile({
        displayName: normalizedDisplayName,
      });
      onComplete(user);
    } catch (error) {
      setMessage(authErrorMessage(error, copy, "profileSave"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <Card className="w-full max-w-lg p-7 sm:p-9">
        <div className="mb-4 flex justify-end">
          <LanguageSwitcher />
        </div>
        <span className="mb-5 grid size-11 place-items-center rounded-full bg-[#71384b] text-white shadow-lg">
          <Heart aria-hidden="true" className="size-5" fill="currentColor" />
        </span>
        <p className="text-sm font-bold tracking-[0.18em] text-[#925c68] uppercase">
          {copy.profile.eyebrow}
        </p>
        <h1 className="mt-2 font-serif text-3xl font-semibold text-[#432f35]">
          {copy.profile.title}
        </h1>
        <p className="mt-3 leading-7 text-[#725f62]">
          {copy.profile.description}
        </p>
        <form className="mt-7 space-y-4" onSubmit={submit}>
          <div className="space-y-2">
            <Label htmlFor="profile-display-name">
              {copy.profile.displayName}
            </Label>
            <Input
              id="profile-display-name"
              name="displayName"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              required
              minLength={1}
              autoComplete="name"
            />
          </div>
          {message ? (
            <p
              role="alert"
              className="rounded-xl border border-[#d6aaa4] bg-[#fff3ed] px-4 py-3 text-sm text-[#743f45]"
            >
              {localizeStoredUiMessage(message, copy)}
            </p>
          ) : null}
          <Button className="w-full" type="submit" disabled={saving}>
            {saving ? copy.profile.saving : copy.profile.continue}
          </Button>
        </form>
      </Card>
    </main>
  );
}
