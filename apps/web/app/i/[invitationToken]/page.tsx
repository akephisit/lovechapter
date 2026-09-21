import type { Metadata } from "next";

import { PublicRsvp } from "../../../components/public-rsvp";

export const metadata: Metadata = {
  title: "Private invitation",
  robots: { index: false, follow: false, nocache: true },
};

export default async function InvitationPage({
  params,
}: {
  params: Promise<{ invitationToken: string }>;
}) {
  const { invitationToken } = await params;
  return <PublicRsvp token={invitationToken} />;
}
