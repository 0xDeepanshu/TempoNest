import type { Metadata } from "next";
import { Suspense } from "react";
import { InvitationAcceptView } from "@/components/invitation-accept-view";
import { Spinner } from "@/components/ui";

export const metadata: Metadata = { title: "Accept invitation" };

export default function AcceptInvitationPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[50vh] items-center justify-center text-indigo-600">
          <Spinner className="h-8 w-8" />
        </div>
      }
    >
      <InvitationAcceptView />
    </Suspense>
  );
}
