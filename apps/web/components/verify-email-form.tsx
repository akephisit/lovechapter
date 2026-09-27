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
import { useUiCopy } from "./ui-language-provider";
import { localizeStoredUiMessage } from "../lib/ui-copy";

type Verify = (input: VerifyEmailInput) => Promise<{ verified: true }>;

export function VerifyEmailForm({
  verify = defaultVerify,
}: {
  verify?: Verify;
}) {
  const copy = useUiCopy();
  const [state, setState] = useState<"working" | "complete" | "error">(
    "working",
  );
  const [message, setMessage] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = readAndScrubFragmentToken();
    if (!token) {
      setState("error");
      setMessage(copy.errors.invalidToken);
      return;
    }
    void verify({ token })
      .then(() => {
        setState("complete");
        setMessage(copy.auth.verified);
      })
      .catch((error: unknown) => {
        setState("error");
        setMessage(authErrorMessage(error, copy, "invalidToken"));
      });
  }, [verify, copy]);

  return (
    <AuthFormShell
      title={
        state === "complete" ? copy.auth.verifiedTitle : copy.auth.verifyTitle
      }
      description={
        state === "complete"
          ? copy.auth.verifiedDescription
          : copy.auth.verifyDescription
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
        {localizeStoredUiMessage(message, copy) ?? copy.auth.verifying}
      </p>
      {state === "complete" ? (
        <Link
          href="/sign-in"
          className="mt-6 flex min-h-11 items-center justify-center rounded-full bg-[#71384b] px-5 py-2.5 text-sm font-semibold text-white"
        >
          {copy.auth.continueSignIn}
        </Link>
      ) : null}
    </AuthFormShell>
  );
}

function defaultVerify(input: VerifyEmailInput) {
  return createAnonymousApi().verifyEmail(input);
}
