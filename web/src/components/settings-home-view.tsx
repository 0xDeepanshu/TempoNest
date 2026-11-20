"use client";

import Link from "next/link";
import { ArrowRightIcon } from "./icons";
import { visibleSettingsTabs } from "./settings-tabs";
import { Card, CardBody, CardHeader, EmptyState } from "./ui";
import { useWorkspace } from "./workspace";

/**
 * /settings is the hub. Each card opens a section that keeps its own URL, and
 * the shared left-hand navigation mirrors the same structure.
 */
export function SettingsHomeView() {
  const { membership } = useWorkspace();
  const visible = visibleSettingsTabs(membership);

  if (visible.length === 0) {
    return (
      <EmptyState
        title="Settings are not available for your role"
        description="Ask an owner or administrator if you need to change workspace settings."
      />
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {visible.map((tab) => (
        <Card key={tab.value} className="flex flex-col">
          <CardHeader title={tab.label} description={tab.description} />
          <CardBody className="flex-1 space-y-3">
            {tab.children && tab.children.length > 1 ? (
              <div className="flex flex-wrap gap-1.5">
                {tab.children.map((child) => (
                  <Link
                    key={child.value}
                    href={child.href}
                    className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink-secondary transition-colors hover:border-accent-soft hover:bg-surface-muted hover:text-ink"
                  >
                    {child.label}
                  </Link>
                ))}
              </div>
            ) : null}
            <Link
              href={tab.href}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-ink transition-colors hover:text-accent-hover"
            >
              Open {tab.label.toLowerCase()}
              <ArrowRightIcon className="h-3.5 w-3.5" />
            </Link>
          </CardBody>
        </Card>
      ))}
    </div>
  );
}
