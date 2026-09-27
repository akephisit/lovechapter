import type { Metadata } from "next";

import { SignUpForm } from "../../../components/sign-up-form";
import { getServerUiCopy } from "../../../lib/server-ui-copy";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getServerUiCopy()).pageTitles.signUp };
}

export default function SignUpPage() {
  return <SignUpForm />;
}
