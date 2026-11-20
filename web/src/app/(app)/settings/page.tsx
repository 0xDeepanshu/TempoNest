import type { Metadata } from "next";
import { SettingsHomeView } from "@/components/settings-home-view";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsIndexPage() {
  return <SettingsHomeView />;
}
