"use client";

import type {
  AcceptedResponse,
  ForgotPasswordInput,
} from "@lovechapter/contracts";
import { useState, type FormEvent } from "react";

import { authErrorMessage, createAnonymousApi } from "./auth-form-utils";
import { AuthFormShell } from "./auth-form-shell";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { useUiCopy } from "./ui-language-provider";
import { localizeStoredUiMessage } from "../lib/ui-copy";

export function ForgotPasswordForm({
  submit = (input) => createAnonymousApi().forgotPassword(input),
}: {
  submit?: (input: ForgotPasswordInput) => Promise<AcceptedResponse>;
}) {
  const copy = useUiCopy();
  const [pending, setPending] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      await submit({ email: String(data.get("email") ?? "") });
      setComplete(true);
    } catch (caught) {
      setError(authErrorMessage(caught, copy, "resetLink"));
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthFormShell
      title={complete ? copy.auth.checkEmail : copy.auth.forgotTitle}
      description={
        complete ? copy.auth.forgotSent : copy.auth.forgotDescription
      }
      alternate={{ href: "/sign-in", label: copy.auth.returnSignIn }}
    >
      {complete ? (
        <p
          role="status"
          className="text-center text-sm break-words text-[#725f62]"
        >
          {copy.auth.forgotNext}
        </p>
      ) : (
        <form
          className="space-y-5"
          noValidate
          onSubmit={handleSubmit}
          dir="auto"
        >
          <div className="min-w-0">
            <Label htmlFor="forgot-email">{copy.auth.email}</Label>
            <Input
              id="forgot-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              dir="auto"
            />
          </div>
          {error ? (
            <p role="alert" className="text-sm break-words text-[#7a2f36]">
              {localizeStoredUiMessage(error, copy)}
            </p>
          ) : null}
          <Button className="w-full" type="submit" disabled={pending}>
            {pending ? copy.auth.sending : copy.auth.sendReset}
          </Button>
        </form>
      )}
    </AuthFormShell>
  );
}
