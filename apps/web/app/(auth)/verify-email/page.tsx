import type { Metadata } from "next";

import { VerifyEmailForm } from "../../../components/verify-email-form";
import { getServerUiCopy } from "../../../lib/server-ui-copy";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getServerUiCopy()).pageTitles.verifyEmail };
}

export default function VerifyEmailPage() {
  return <VerifyEmailForm />;
}
