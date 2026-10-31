import type { Metadata } from "next";
import { Suspense } from "react";
import { PublicAuthShell } from "@/components/public-auth-shell";
import { InvitationAcceptView } from "@/components/invitation-accept-view";
import { Card, CardBody, Spinner } from "@/components/ui";

export const metadata: Metadata = {
  title: "Accept invitation",
  description: "Activate your TempoNest account from an organization invitation.",
};

export default function AcceptInvitationPage() {
  return (
    <Suspense
      fallback={
        <PublicAuthShell title="Checking your invitation" description="This only takes a moment.">
          <Card>
            <CardBody className="flex items-center gap-2 py-10 text-sm text-muted">
              <Spinner className="h-5 w-5" />
              Verifying invitation…
            </CardBody>
          </Card>
        </PublicAuthShell>
      }
    >
      <InvitationAcceptView />
    </Suspense>
  );
}
