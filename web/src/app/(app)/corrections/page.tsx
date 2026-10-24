import type { Metadata } from "next";
import { CorrectionsView } from "@/components/corrections-view";

export const metadata: Metadata = { title: "Corrections" };

export default function CorrectionsPage() {
  return <CorrectionsView />;
}
