import type { Metadata } from "next";

import { ForgotPasswordForm } from "../../../components/forgot-password-form";
import { getServerUiCopy } from "../../../lib/server-ui-copy";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getServerUiCopy()).pageTitles.forgotPassword };
}

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
