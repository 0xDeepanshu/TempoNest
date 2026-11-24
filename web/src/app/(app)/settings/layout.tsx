import type { ReactNode } from "react";
import { SettingsLayout } from "@/components/settings-layout";

export default function SettingsSectionLayout({ children }: { children: ReactNode }) {
  return <SettingsLayout>{children}</SettingsLayout>;
}
