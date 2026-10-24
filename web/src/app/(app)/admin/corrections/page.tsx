import type { Metadata } from "next";
import { PermissionGate } from "@/components/workspace";
import { CorrectionReviewView } from "@/components/correction-review-view";

export const metadata: Metadata = { title: "Correction review" };

export default function CorrectionReviewPage() {
  return (
    <PermissionGate permission="correction:review">
      <CorrectionReviewView />
    </PermissionGate>
  );
}
