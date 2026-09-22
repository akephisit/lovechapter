"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { AuthenticatedHome } from "../../components/authenticated-home";
import { useAuthSession } from "../../components/auth-session-provider";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";

export default function WorkspacePage() {
  const session = useAuthSession();
  const router = useRouter();

  useEffect(() => {
    if (session.status === "anonymous") router.replace("/sign-in");
  }, [router, session.status]);

  if (session.status === "loading" || session.status === "anonymous") {
    return <SessionMessage>Checking your session…</SessionMessage>;
  }
  if (session.status === "error") {
    return (
      <main className="grid min-h-screen place-items-center px-4 py-10">
        <Card className="w-full max-w-lg p-8 text-center">
          <h1 className="font-serif text-3xl font-semibold text-[#432f35]">
            We couldn't restore your session.
          </h1>
          <p className="mt-3 leading-7 text-[#725f62]">
            The service may be temporarily unavailable. Your account state has
            not been changed.
          </p>
          <Button className="mt-6" onClick={() => void session.refresh()}>
            Try again
          </Button>
        </Card>
      </main>
    );
  }
  return <AuthenticatedHome />;
}

function SessionMessage({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <p className="text-sm font-semibold text-[#725f62]" aria-live="polite">
        {children}
      </p>
    </main>
  );
}
