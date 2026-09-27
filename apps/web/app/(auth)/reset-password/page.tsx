import type { Metadata } from "next";

import { ResetPasswordForm } from "../../../components/reset-password-form";
import { getServerUiCopy } from "../../../lib/server-ui-copy";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getServerUiCopy()).pageTitles.resetPassword };
}

export default function ResetPasswordPage() {
  return <ResetPasswordForm />;
}
