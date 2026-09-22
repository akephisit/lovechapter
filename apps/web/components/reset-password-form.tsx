"use client";

import type { ResetPasswordInput } from "@lovechapter/contracts";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";

import {
  authErrorMessage,
  createAnonymousApi,
  passwordLengthError,
  readAndScrubFragmentToken,
} from "./auth-form-utils";
import { AuthFormShell } from "./auth-form-shell";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

export function ResetPasswordForm({
  submit = (input) => createAnonymousApi().resetPassword(input),
}: {
  submit?: (input: ResetPasswordInput) => Promise<{ reset: true }>;
}) {
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fragmentRead = useRef(false);

  useEffect(() => {
    if (fragmentRead.current) return;
    fragmentRead.current = true;
    setToken(readAndScrubFragmentToken());
    setReady(true);
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) {
      setError("Invalid or expired token");
      return;
    }
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") ?? "");
    const passwordError = passwordLengthError(password);
    if (passwordError) {
      setError(passwordError);
      return;
    }
    setPending(true);
    setError(null);
    try {
      await submit({ token, password });
      setComplete(true);
    } catch (caught) {
      setError(authErrorMessage(caught, "Invalid or expired token"));
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthFormShell
      title={complete ? "Password reset" : "Choose a new password"}
      description={
        complete
          ? "Your sessions were closed and your new password is ready."
          : "Use 12–128 characters. Your password is never trimmed."
      }
    >
      {complete ? (
        <Link
          href="/sign-in"
          className="flex min-h-11 items-center justify-center rounded-full bg-[#71384b] px-5 py-2.5 text-sm font-semibold text-white"
        >
          Sign in with your new password
        </Link>
      ) : ready ? (
        <form
          className="space-y-5"
          noValidate
          onSubmit={handleSubmit}
          dir="auto"
        >
          <div className="min-w-0">
            <Label htmlFor="reset-password">New password</Label>
            <Input
              id="reset-password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              dir="auto"
            />
          </div>
          {error ? (
            <p
              role="alert"
              className="rounded-xl bg-[#f8e7e4] px-3 py-2 text-sm break-words text-[#7a2f36]"
            >
              {error}
            </p>
          ) : null}
          <Button className="w-full" type="submit" disabled={pending}>
            {pending ? "Resetting…" : "Reset password"}
          </Button>
        </form>
      ) : (
        <p role="status" className="text-center text-sm text-[#725f62]">
          Reading your secure reset link…
        </p>
      )}
    </AuthFormShell>
  );
}
