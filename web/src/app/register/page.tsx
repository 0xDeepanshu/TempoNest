import type { Metadata } from "next";
import { Suspense } from "react";
import { RegisterPanel } from "@/components/register-form";
import { Spinner } from "@/components/ui";

export const metadata: Metadata = {
  title: "Create account",
  description: "Create a TempoNest account to accept an organization invitation.",
};

export default function RegisterPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center text-muted">
          <Spinner className="h-8 w-8" />
        </div>
      }
    >
      <RegisterPanel />
    </Suspense>
  );
}
