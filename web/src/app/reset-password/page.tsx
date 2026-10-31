import type { Metadata } from "next";
import { Suspense } from "react";
import { PublicAuthShell } from "@/components/public-auth-shell";
import { ResetPasswordForm } from "@/components/reset-password-form";
import { Card, CardBody, Spinner } from "@/components/ui";

export const metadata: Metadata = {
  title: "Choose a new password",
  description: "Set a new password for your TempoNest account.",
};

export default function ResetPasswordPage() {
  return (
    <PublicAuthShell
      title="Choose a new password"
      description="Your reset link is single-use. After updating your password, sign in with the new one."
    >
      <Suspense
        fallback={
          <Card>
            <CardBody className="flex items-center gap-2 py-10 text-sm text-muted">
              <Spinner className="h-5 w-5" />
              Loading…
            </CardBody>
          </Card>
        }
      >
        <ResetPasswordForm />
      </Suspense>
    </PublicAuthShell>
  );
}
