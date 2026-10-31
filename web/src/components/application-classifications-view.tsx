"use client";

import { useState } from "react";
import {
  createApplicationClassification,
  listApplicationClassifications,
  updateApplicationClassification,
} from "@/lib/activity-api";
import { errorMessage } from "@/lib/api-error";
import { formatDateTime } from "@/lib/format";
import { hasPermission } from "@/lib/permissions";
import {
  ACTIVITY_CATEGORIES,
  type ActivityCategory,
  type ApplicationClassificationRow,
} from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { ActivityTabs } from "./activity-tabs";
import { ActivityCategoryBadge, activityCategoryLabel } from "./activity-ui";
import { ChartIcon, PlusIcon, SearchIcon } from "./icons";
import { Modal } from "./modal";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  PageHeader,
  Pagination,
  Select,
  StatCard,
  TableShell,
  Td,
  Textarea,
  Th,
} from "./ui";
import { NoOrganization, useWorkspace } from "./workspace";

export function ApplicationClassificationsView() {
  const { organization, membership } = useWorkspace();
  const organizationId = organization?.id ?? "";
  const timezone = organization?.timezone ?? "UTC";
  const canManage = hasPermission(membership, "classification:manage");

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [category, setCategory] = useState<"" | ActivityCategory>("");
  const [includeObserved, setIncludeObserved] = useState(true);
  const [editor, setEditor] = useState<{ row: ApplicationClassificationRow | null } | null>(
    null,
  );
  const [notice, setNotice] = useState<string | null>(null);

  const list = useApi(
    (signal) =>
      listApplicationClassifications(
        organizationId,
        {
          page,
          limit: 20,
          category: category || undefined,
          q: appliedSearch || undefined,
          includeObserved,
        },
        { signal },
      ),
    [organizationId, page, category, appliedSearch, includeObserved],
    { enabled: Boolean(organizationId) },
  );

  if (!organization) return <NoOrganization />;

  const rows = list.data?.data ?? [];
  const summary = list.data?.summary;

  function applySearch(event: React.FormEvent) {
    event.preventDefault();
    setAppliedSearch(search.trim());
    setPage(1);
  }

  function resetFilters() {
    setSearch("");
    setAppliedSearch("");
    setCategory("");
    setIncludeObserved(true);
    setPage(1);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={`${organization.name} · ${organization.timezone}`}
        title="Application classifications"
        description="Choose how foreground applications are grouped in activity reports. Unknown applications stay Unclassified until an administrator classifies them and are never marked Unproductive automatically."
        actions={
          canManage ? (
            <Button onClick={() => setEditor({ row: null })}>
              <PlusIcon className="h-3.5 w-3.5" />
              Add classification
            </Button>
          ) : undefined
        }
      />

      <ActivityTabs current="classifications" />

      <Alert tone="info" title="Classification is retroactive at report time">
        Reports resolve each application against the current catalog. Changing a category
        regroups historical application time immediately, but raw activity rows are not
        rewritten. Every catalog change is recorded in the audit trail.
      </Alert>

      {!canManage ? (
        <Alert tone="warning" title="Read-only catalog">
          You can review how applications are classified. Creating or changing classifications
          requires an administrator.
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Catalog entries"
          value={list.loading ? "…" : (summary?.total ?? 0)}
          hint="Matching the current filters"
          accent="indigo"
          icon={<ChartIcon className="h-4 w-4" />}
        />
        <StatCard
          label="Classified"
          value={list.loading ? "…" : (summary?.classified ?? 0)}
          hint="Assigned a productivity category"
          accent="emerald"
        />
        <StatCard
          label="Unclassified"
          value={list.loading ? "…" : (summary?.unclassified ?? 0)}
          hint="Observed or catalogued without a category"
          accent="amber"
        />
      </div>

      <Card>
        <CardHeader
          title="Catalog filters"
          description="Search by identifier or display name. Observed applications come from activity history and stay Unclassified until a catalog entry exists."
        />
        <form
          onSubmit={applySearch}
          className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_auto_auto] lg:items-end"
        >
          <Field label="Search applications" htmlFor="classification-search">
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <Input
                id="classification-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="code, chrome, slack…"
                className="pl-9"
              />
            </div>
          </Field>
          <Field label="Category" htmlFor="classification-category">
            <Select
              id="classification-category"
              value={category}
              onChange={(event) => {
                setCategory(event.target.value as "" | ActivityCategory);
                setPage(1);
              }}
            >
              <option value="">All categories</option>
              {ACTIVITY_CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {activityCategoryLabel(value)}
                </option>
              ))}
            </Select>
          </Field>
          <label className="flex h-9 cursor-pointer items-center gap-2 text-xs font-medium text-ink-secondary">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-ink"
              checked={includeObserved}
              onChange={(event) => {
                setIncludeObserved(event.target.checked);
                setPage(1);
              }}
            />
            Include observed apps
          </label>
          <div className="flex gap-2">
            <Button type="submit">Search</Button>
            <Button type="button" variant="secondary" onClick={resetFilters}>
              Reset
            </Button>
          </div>
        </form>
      </Card>

      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <Card>
        <CardHeader
          title="Classification catalog"
          description="Categories affect how report application time is grouped. They are descriptive, not a performance score."
        />
        {list.error ? (
          <div className="p-4">
            <ErrorState message={list.error} onRetry={list.reload} />
          </div>
        ) : list.loading && !list.data ? (
          <LoadingBlock label="Loading application classifications" rows={5} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No applications match"
            description={
              appliedSearch || category
                ? "Try a different search term or category, or reset the filters."
                : "No applications have been observed or classified in this organization yet."
            }
            icon={<ChartIcon className="h-5 w-5" />}
          />
        ) : (
          <>
            <TableShell>
              <thead>
                <tr>
                  <Th>Application</Th>
                  <Th>Category</Th>
                  <Th>Catalog state</Th>
                  <Th>Notes</Th>
                  <Th>Last updated</Th>
                  {canManage ? <Th /> : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.applicationIdentifier} className="hover:bg-surface-muted">
                    <Td>
                      <div className="flex items-center gap-2.5">
                        <Avatar name={row.applicationName} size="sm" />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-ink">{row.applicationName}</p>
                          <p className="truncate font-mono text-[10px] text-muted">
                            {row.applicationIdentifier}
                          </p>
                        </div>
                      </div>
                    </Td>
                    <Td>
                      <ActivityCategoryBadge category={row.category} />
                    </Td>
                    <Td>
                      {row.classificationId ? (
                        <Badge tone={row.classified ? "success" : "neutral"}>
                          {row.classified ? "Classified" : "Unclassified entry"}
                        </Badge>
                      ) : (
                        <Badge tone="warning">Observed · not in catalog</Badge>
                      )}
                    </Td>
                    <Td className="max-w-[220px] truncate text-xs text-muted">
                      {row.notes || "—"}
                    </Td>
                    <Td className="whitespace-nowrap text-xs text-muted">
                      {row.updatedAt ? formatDateTime(row.updatedAt, timezone) : "—"}
                    </Td>
                    {canManage ? (
                      <Td>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setEditor({ row })}
                        >
                          {row.classificationId ? "Edit" : "Classify"}
                        </Button>
                      </Td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </TableShell>
            <Pagination
              page={list.data?.meta.page ?? page}
              totalPages={list.data?.meta.totalPages ?? 1}
              onPageChange={setPage}
            />
          </>
        )}
      </Card>

      {editor ? (
        <ClassificationModal
          row={editor.row}
          organizationId={organization.id}
          onClose={() => setEditor(null)}
          onSaved={(message) => {
            setEditor(null);
            setNotice(message);
            list.reload();
          }}
        />
      ) : null}
    </div>
  );
}

function ClassificationModal({
  row,
  organizationId,
  onClose,
  onSaved,
}: {
  row: ApplicationClassificationRow | null;
  organizationId: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [identifier, setIdentifier] = useState(row?.applicationIdentifier ?? "");
  const [name, setName] = useState(row?.applicationName ?? "");
  const [category, setCategory] = useState<ActivityCategory>(row?.category ?? "UNCLASSIFIED");
  const [notes, setNotes] = useState(row?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const editingObserved = Boolean(row && !row.classificationId);

  function validate(): string | null {
    if (!identifier.trim()) return "Application identifier is required.";
    if (identifier.trim().length > 200) {
      return "Application identifier cannot exceed 200 characters.";
    }
    if (name.trim().length > 255) {
      return "Application name cannot exceed 255 characters.";
    }
    if (notes.trim().length > 1000) {
      return "Notes cannot exceed 1000 characters.";
    }
    return null;
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    setError(null);
    const validation = validate();
    if (validation) {
      setError(validation);
      return;
    }

    setSaving(true);
    try {
      const trimmedName = name.trim();
      const trimmedNotes = notes.trim();
      if (row?.classificationId) {
        await updateApplicationClassification(organizationId, row.classificationId, {
          ...(trimmedName ? { applicationName: trimmedName } : {}),
          category,
          notes: trimmedNotes || null,
        });
        onSaved(
          `${trimmedName || row.applicationName} updated. Reports regroup historical activity immediately.`,
        );
      } else if (row) {
        await createApplicationClassification(organizationId, {
          applicationIdentifier: row.applicationIdentifier,
          ...(trimmedName ? { applicationName: trimmedName } : {}),
          category,
          notes: trimmedNotes || null,
        });
        onSaved(
          `${trimmedName || row.applicationName} added to the catalog. Reports regroup historical activity immediately.`,
        );
      } else {
        await createApplicationClassification(organizationId, {
          applicationIdentifier: identifier.trim(),
          ...(trimmedName ? { applicationName: trimmedName } : {}),
          category,
          notes: trimmedNotes || null,
        });
        onSaved(
          `${trimmedName || identifier.trim().toLowerCase()} added to the catalog. Future reports classify it immediately.`,
        );
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={row ? (editingObserved ? "Classify observed application" : "Edit classification") : "Add classification"}
      description={
        row
          ? "Changing a category regroups historical application time at report time. Raw activity rows are not rewritten."
          : "Identifiers are trimmed and lowercased. New entries start Unclassified unless you choose a category."
      }
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="classification-form" disabled={saving}>
            {saving ? "Saving…" : row ? "Save classification" : "Add classification"}
          </Button>
        </>
      }
    >
      <form id="classification-form" onSubmit={save} className="space-y-4">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Field
          label="Application identifier"
          htmlFor="classification-identifier"
          hint="Exact identifier reported by the desktop agent, for example code or chrome."
          required={!row}
        >
          <Input
            id="classification-identifier"
            value={identifier}
            disabled={Boolean(row)}
            maxLength={200}
            onChange={(event) => setIdentifier(event.target.value)}
            placeholder="code"
            data-autofocus={row ? undefined : true}
          />
        </Field>
        <Field
          label="Display name"
          htmlFor="classification-name"
          hint="Optional. Defaults to the identifier when omitted."
        >
          <Input
            id="classification-name"
            value={name}
            maxLength={255}
            onChange={(event) => setName(event.target.value)}
            placeholder="Visual Studio Code"
            data-autofocus={row ? true : undefined}
          />
        </Field>
        <Field
          label="Category"
          htmlFor="classification-category-input"
          hint="Unknown applications remain Unclassified until someone chooses a category."
        >
          <Select
            id="classification-category-input"
            value={category}
            onChange={(event) => setCategory(event.target.value as ActivityCategory)}
          >
            {ACTIVITY_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {activityCategoryLabel(value)}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Notes"
          htmlFor="classification-notes"
          hint="Optional context for administrators. Not shown to employees in reports."
        >
          <Textarea
            id="classification-notes"
            value={notes}
            maxLength={1000}
            rows={3}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Primary editor for the engineering team"
          />
        </Field>
      </form>
    </Modal>
  );
}
