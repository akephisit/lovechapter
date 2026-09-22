"use client";

import type { SignInInput } from "@lovechapter/contracts";
import Link from "next/link";
import { useState, type FormEvent } from "react";

import { authErrorMessage, createAnonymousApi } from "./auth-form-utils";
import { AuthFormShell } from "./auth-form-shell";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

export function SignInForm({
  submit = (input) => createAnonymousApi().signIn(input),
  onSignedIn = async () => window.location.assign("/"),
}: {
  submit?: (input: SignInInput) => Promise<{ signedIn: true }>;
  onSignedIn?: () => Promise<void> | void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const input = {
      email: String(data.get("email") ?? ""),
      password: String(data.get("password") ?? ""),
    };
    setPending(true);
    setError(null);
    try {
      await submit(input);
      await onSignedIn();
    } catch (caught) {
      setError(authErrorMessage(caught, "We couldn't sign you in."));
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthFormShell
      title="Welcome back"
      description="Sign in to continue planning your chapter."
      alternate={{ href: "/sign-up", label: "New here? Create an account" }}
    >
      <form className="space-y-5" noValidate onSubmit={handleSubmit} dir="auto">
        <div className="min-w-0">
          <Label htmlFor="sign-in-email">Email address</Label>
          <Input
            id="sign-in-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            dir="auto"
          />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <Label htmlFor="sign-in-password">Password</Label>
            <Link
              href="/forgot-password"
              className="text-xs font-semibold text-[#71384b] underline underline-offset-4"
            >
              Forgot password?
            </Link>
          </div>
          <Input
            id="sign-in-password"
            name="password"
            type="password"
            autoComplete="current-password"
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
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </AuthFormShell>
  );
}
