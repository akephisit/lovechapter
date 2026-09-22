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

export function ForgotPasswordForm({
  submit = (input) => createAnonymousApi().forgotPassword(input),
}: {
  submit?: (input: ForgotPasswordInput) => Promise<AcceptedResponse>;
}) {
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
      setError(authErrorMessage(caught, "We couldn't send the reset link."));
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthFormShell
      title={complete ? "Check your email" : "Reset your password"}
      description={
        complete
          ? "If an eligible account exists, a reset link is on its way."
          : "Enter your email and we'll send a secure reset link."
      }
      alternate={{ href: "/sign-in", label: "Return to sign in" }}
    >
      {complete ? (
        <p
          role="status"
          className="text-center text-sm break-words text-[#725f62]"
        >
          If an eligible account exists, you will receive an email shortly.
        </p>
      ) : (
        <form
          className="space-y-5"
          noValidate
          onSubmit={handleSubmit}
          dir="auto"
        >
          <div className="min-w-0">
            <Label htmlFor="forgot-email">Email address</Label>
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
              {error}
            </p>
          ) : null}
          <Button className="w-full" type="submit" disabled={pending}>
            {pending ? "Sending…" : "Send reset link"}
          </Button>
        </form>
      )}
    </AuthFormShell>
  );
}
