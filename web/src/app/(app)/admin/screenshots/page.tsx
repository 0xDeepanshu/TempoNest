import type { Metadata } from "next";
import { PermissionGate } from "@/components/workspace";
import { ScreenshotReviewView } from "@/components/screenshot-review-view";

export const metadata: Metadata = { title: "Screenshot review" };

export default async function ScreenshotReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ employeeId?: string | string[] }>;
}) {
  const params = await searchParams;
  const employeeId = Array.isArray(params.employeeId)
    ? (params.employeeId[0] ?? "")
    : (params.employeeId ?? "");

  return (
    <PermissionGate permission="screenshot:read">
      <ScreenshotReviewView initialEmployeeId={employeeId} />
    </PermissionGate>
  );
}
