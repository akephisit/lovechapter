import type { Metadata } from "next";

import { PublicRsvp } from "../../../components/public-rsvp";
import { getServerUiCopy } from "../../../lib/server-ui-copy";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: (await getServerUiCopy()).pageTitles.invitation,
    robots: { index: false, follow: false, nocache: true },
  };
}

export default async function InvitationPage({
  params,
}: {
  params: Promise<{ invitationToken: string }>;
}) {
  const { invitationToken } = await params;
  return <PublicRsvp token={invitationToken} />;
}
