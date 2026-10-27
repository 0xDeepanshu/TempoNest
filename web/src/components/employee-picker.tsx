"use client";

import { useEffect, useId, useRef, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { findMember } from "@/lib/members";
import type { MemberListItem, Paginated } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { CloseIcon, SearchIcon } from "./icons";
import { Avatar, Spinner, cn } from "./ui";

export function EmployeePicker({
  organizationId,
  value,
  onChange,
  id,
  placeholder = "Search by name or email",
  disabled = false,
}: {
  organizationId: string;
  value: string;
  onChange: (userId: string) => void;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const inputId = useId();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selected, setSelected] = useState<MemberListItem | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const options = useApi<Paginated<MemberListItem>>(
    (signal) =>
      apiRequest(`/organizations/${organizationId}/members`, {
        signal,
        query: { limit: 20, status: "ACTIVE", q: debouncedSearch },
      }),
    [organizationId, debouncedSearch],
    { enabled: Boolean(organizationId) && open },
  );

  const rows = options.data?.data ?? [];
  const listed = value ? rows.find((member) => member.userId === value) : undefined;

  // Deep links may reference an employee outside the current search page, so the
  // selected ID is resolved through the directory when it is not listed.
  const resolved = useApi<MemberListItem | null>(
    (signal) =>
      value ? findMember(organizationId, value, signal) : Promise.resolve(null),
    [organizationId, value],
    {
      enabled:
        Boolean(organizationId && value) && selected?.userId !== value && !listed,
    },
  );

  const selectedMember =
    selected?.userId === value
      ? selected
      : (listed ??
        (resolved.data?.userId === value ? resolved.data : null));

  const active = rows.length === 0 ? -1 : Math.min(activeIndex, rows.length - 1);
  const optionId = (index: number) => `${listId}-option-${index}`;

  function select(member: MemberListItem) {
    setSelected(member);
    setSearch("");
    setOpen(false);
    onChange(member.userId);
  }

  function clear() {
    setSelected(null);
    setSearch("");
    onChange("");
    inputRef.current?.focus();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex(rows.length === 0 ? 0 : Math.min(active + 1, rows.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex(rows.length === 0 ? 0 : Math.max(active - 1, 0));
    } else if (event.key === "Enter") {
      if (open && active >= 0 && rows[active]) {
        event.preventDefault();
        select(rows[active]);
      }
    } else if (event.key === "Escape") {
      setOpen(false);
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
      <input
        ref={inputRef}
        id={id ?? inputId}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
        autoComplete="off"
        disabled={disabled}
        value={open ? search : (selectedMember?.user.name ?? "")}
        placeholder={placeholder}
        onChange={(event) => {
          setSearch(event.target.value);
          setOpen(true);
          setActiveIndex(0);
        }}
        onFocus={() => {
          setOpen(true);
          setSearch("");
          setActiveIndex(0);
        }}
        onKeyDown={handleKeyDown}
        onBlur={(event) => {
          if (!rootRef.current?.contains(event.relatedTarget as Node)) setOpen(false);
        }}
        className={cn(
          "h-9 w-full rounded-lg border border-line-strong bg-surface pl-9 text-[13px] text-ink outline-none transition placeholder:text-muted focus:border-ink focus:ring-2 focus:ring-ink/10 disabled:cursor-not-allowed disabled:text-muted",
          value ? "pr-10" : "pr-3",
        )}
      />
      {value ? (
        <button
          type="button"
          onClick={clear}
          disabled={disabled}
          aria-label="Clear employee"
          title="Clear employee"
          className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted transition hover:bg-surface-hover hover:text-ink disabled:opacity-50"
        >
          <CloseIcon className="h-3.5 w-3.5" />
        </button>
      ) : null}

      {open ? (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-lg border border-line bg-surface shadow-lg">
          {options.error ? (
            <div className="px-3 py-2 text-xs text-danger" role="alert">
              {options.error}{" "}
              <button
                type="button"
                onClick={options.reload}
                className="font-medium underline underline-offset-2"
              >
                Retry
              </button>
            </div>
          ) : options.loading && !options.data ? (
            <p className="flex items-center gap-2 px-3 py-2.5 text-xs text-muted">
              <Spinner className="h-3.5 w-3.5" />
              Searching employees…
            </p>
          ) : rows.length === 0 ? (
            <p className="px-3 py-2.5 text-xs text-muted">
              No active employees match this search.
            </p>
          ) : (
            <ul
              id={listId}
              role="listbox"
              aria-label="Employees"
              className="max-h-64 overflow-y-auto py-1"
            >
              {rows.map((member, index) => (
                <li
                  key={member.userId}
                  id={optionId(index)}
                  role="option"
                  aria-selected={member.userId === value}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    select(member);
                  }}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={cn(
                    "flex cursor-pointer items-center gap-2.5 px-3 py-2",
                    index === active && "bg-surface-muted",
                  )}
                >
                  <Avatar name={member.user.name} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-ink">
                      {member.user.name}
                    </span>
                    <span className="block truncate text-[11px] text-muted">
                      {member.user.email}
                    </span>
                  </span>
                  <span className="shrink-0 text-[11px] text-muted">
                    {member.role.toLowerCase()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
