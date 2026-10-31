import type { Metadata } from "next";
import { Suspense } from "react";
import { ForgotPasswordForm } from "@/components/forgot-password-form";
import { PublicAuthShell } from "@/components/public-auth-shell";
import { Card, CardBody, Spinner } from "@/components/ui";

export const metadata: Metadata = {
  title: "Forgot password",
  description: "Request a single-use password reset link for your TempoNest account.",
};

export default function ForgotPasswordPage() {
  return (
    <PublicAuthShell
      title="Reset your password"
      description="Enter your TempoNest email address and we will send a single-use reset link."
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
        <ForgotPasswordForm />
      </Suspense>
    </PublicAuthShell>
  );
}
