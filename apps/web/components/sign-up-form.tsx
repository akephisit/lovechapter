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

export function SignUpForm({
  submit = (input) => createAnonymousApi().signUp(input),
}: {
  submit?: (input: SignUpInput) => Promise<AcceptedResponse>;
}) {
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
    const passwordError = passwordLengthError(input.password);
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
      setError(authErrorMessage(caught, "We couldn't create your account."));
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthFormShell
      title={complete ? "Check your email" : "Create your account"}
      description={
        complete
          ? "We sent a verification link if the address can receive one."
          : "Start a private planning space for your celebration."
      }
      alternate={{ href: "/sign-in", label: "Already registered? Sign in" }}
    >
      {complete ? (
        <p
          role="status"
          className="text-center text-sm break-words text-[#725f62]"
        >
          Open the link in your email to verify your address before signing in.
        </p>
      ) : (
        <form
          className="space-y-5"
          noValidate
          onSubmit={handleSubmit}
          dir="auto"
        >
          <Field id="sign-up-name" label="Display name">
            <Input
              id="sign-up-name"
              name="displayName"
              autoComplete="name"
              required
              maxLength={120}
              dir="auto"
            />
          </Field>
          <Field id="sign-up-email" label="Email address">
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
          <Field id="sign-up-password" label="Password">
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
              Use 12–128 characters. Spaces and Unicode are welcome.
            </p>
          </Field>
          {error ? <FormAlert>{error}</FormAlert> : null}
          <Button className="w-full" type="submit" disabled={pending}>
            {pending ? "Creating account…" : "Create account"}
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
