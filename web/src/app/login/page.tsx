import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginPanel } from "@/components/login-form";
import { Spinner } from "@/components/ui";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to the TempoNest work portal.",
};

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center text-indigo-600">
          <Spinner className="h-8 w-8" />
        </div>
      }
    >
      <LoginPanel />
    </Suspense>
  );
}
