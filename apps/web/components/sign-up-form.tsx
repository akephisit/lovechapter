"use client";

import type { AcceptedResponse, SignUpInput } from "@lovechapter/contracts";
import { useState, type FormEvent } from "react";

import {
  authErrorMessage,
  createAnonymousApi,
  passwordLengthError,
} from "./auth-form-utils";
import { AuthFormShell } from "./auth-form-shell";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { useUiCopy } from "./ui-language-provider";
import { localizeStoredUiMessage } from "../lib/ui-copy";

export function SignUpForm({
  submit = (input) => createAnonymousApi().signUp(input),
}: {
  submit?: (input: SignUpInput) => Promise<AcceptedResponse>;
}) {
  const copy = useUiCopy();
  const [pending, setPending] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const input = {
      displayName: String(data.get("displayName") ?? ""),
      email: String(data.get("email") ?? ""),
      password: String(data.get("password") ?? ""),
    };
    const passwordError = passwordLengthError(input.password, copy);
    if (passwordError) {
      setError(passwordError);
      return;
    }
    setPending(true);
    setError(null);
    try {
      await submit(input);
      setComplete(true);
    } catch (caught) {
      setError(authErrorMessage(caught, copy, "signUp"));
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthFormShell
      title={complete ? copy.auth.checkEmail : copy.auth.signUpTitle}
      description={
        complete ? copy.auth.signUpSent : copy.auth.signUpDescription
      }
      alternate={{ href: "/sign-in", label: copy.auth.signUpAlternate }}
    >
      {complete ? (
        <p
          role="status"
          className="text-center text-sm break-words text-[#725f62]"
        >
          {copy.auth.signUpNext}
        </p>
      ) : (
        <form
          className="space-y-5"
          noValidate
          onSubmit={handleSubmit}
          dir="auto"
        >
          <Field id="sign-up-name" label={copy.auth.displayName}>
            <Input
              id="sign-up-name"
              name="displayName"
              autoComplete="name"
              required
              maxLength={120}
              dir="auto"
            />
          </Field>
          <Field id="sign-up-email" label={copy.auth.email}>
            <Input
              id="sign-up-email"
              name="email"
              type="text"
              inputMode="email"
              autoComplete="email"
              required
              maxLength={320}
              dir="auto"
            />
          </Field>
          <Field id="sign-up-password" label={copy.auth.password}>
            <Input
              id="sign-up-password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              aria-describedby="sign-up-password-help"
              dir="auto"
            />
            <p
              id="sign-up-password-help"
              className="mt-1.5 text-xs text-[#806d70]"
            >
              {copy.auth.passwordHelp}
            </p>
          </Field>
          {error ? (
            <FormAlert>{localizeStoredUiMessage(error, copy)}</FormAlert>
          ) : null}
          <Button className="w-full" type="submit" disabled={pending}>
            {pending ? copy.auth.creating : copy.auth.createAccount}
          </Button>
        </form>
      )}
    </AuthFormShell>
  );
}

function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

function FormAlert({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-xl bg-[#f8e7e4] px-3 py-2 text-sm break-words text-[#7a2f36]"
    >
      {children}
    </p>
  );
}
