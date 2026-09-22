"use client";

import type { VerifyEmailInput } from "@lovechapter/contracts";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import {
  authErrorMessage,
  createAnonymousApi,
  readAndScrubFragmentToken,
} from "./auth-form-utils";
import { AuthFormShell } from "./auth-form-shell";

type Verify = (input: VerifyEmailInput) => Promise<{ verified: true }>;

export function VerifyEmailForm({
  verify = defaultVerify,
}: {
  verify?: Verify;
}) {
  const [state, setState] = useState<"working" | "complete" | "error">(
    "working",
  );
  const [message, setMessage] = useState("Verifying your email…");
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = readAndScrubFragmentToken();
    if (!token) {
      setState("error");
      setMessage("Invalid or expired token");
      return;
    }
    void verify({ token })
      .then(() => {
        setState("complete");
        setMessage("Verification complete.");
      })
      .catch((error: unknown) => {
        setState("error");
        setMessage(authErrorMessage(error, "Invalid or expired token"));
      });
  }, [verify]);

  return (
    <AuthFormShell
      title={state === "complete" ? "Email verified" : "Verify your email"}
      description={
        state === "complete"
          ? "Your address is verified. You can sign in now."
          : "We're checking your secure verification link."
      }
    >
      <p
        role={state === "error" ? "alert" : "status"}
        className={
          state === "error"
            ? "rounded-xl bg-[#f8e7e4] px-3 py-2 text-center text-sm break-words text-[#7a2f36]"
            : "text-center text-sm break-words text-[#725f62]"
        }
      >
        {message}
      </p>
      {state === "complete" ? (
        <Link
          href="/sign-in"
          className="mt-6 flex min-h-11 items-center justify-center rounded-full bg-[#71384b] px-5 py-2.5 text-sm font-semibold text-white"
        >
          Continue to sign in
        </Link>
      ) : null}
    </AuthFormShell>
  );
}

function defaultVerify(input: VerifyEmailInput) {
  return createAnonymousApi().verifyEmail(input);
}
