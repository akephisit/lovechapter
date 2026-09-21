import type { ReactNode } from "react";

import { AuthErrorBoundary } from "../../components/auth-error-boundary";
import { ClerkAppProvider } from "../../components/clerk-app-provider";

export default function AuthenticatedLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <AuthErrorBoundary>
      <ClerkAppProvider>{children}</ClerkAppProvider>
    </AuthErrorBoundary>
  );
}
