import type { Metadata } from "next";

import { SignInForm } from "../../../components/sign-in-form";
import { getServerUiCopy } from "../../../lib/server-ui-copy";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getServerUiCopy()).pageTitles.signIn };
}

export default function SignInPage() {
  return <SignInForm />;
}
