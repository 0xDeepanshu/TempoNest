"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { visibleSettingsTabs } from "./settings-tabs";
import { EmptyState, LoadingBlock } from "./ui";
import { useWorkspace } from "./workspace";

/**
 * /settings has no content of its own. It opens the first settings tab the
 * current role is allowed to read so old bookmarks never land on a dead page.
 */
export function SettingsHomeView() {
  const router = useRouter();
  const { membership } = useWorkspace();
  const first = visibleSettingsTabs(membership)[0];

  useEffect(() => {
    if (first) router.replace(first.href);
  }, [first, router]);

  if (!first) {
    return (
      <EmptyState
        title="Settings are not available for your role"
        description="Ask an owner or administrator if you need to change workspace settings."
      />
    );
  }

  return <LoadingBlock label="Opening settings" rows={2} />;
}
