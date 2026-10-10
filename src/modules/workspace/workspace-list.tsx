"use client"

import { useState } from "react"
import Link from "next/link"
import { ArrowRightIcon, CalendarIcon, PlusIcon, SearchIcon } from "lucide-react"
import { formatAccounting, formatDate, formatMonth, todayIsoDate } from "@/core/format"
import type { AppServices } from "@/core/services"
import type { TemplateType, Workspace } from "@/core/types"
import { workspaceOverview, type WorkspaceOverview } from "@/core/workspace-overview"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { LoadingState } from "@/components/ui/page-header"
import { cn, errorMessage, useLoader } from "@/lib/utils"
import { CreateWorkspaceDialog } from "./create-workspace-dialog"
import { RestoreBackupDialog } from "./restore-backup-dialog"
import { TEMPLATE_LABELS } from "./labels"

interface WorkspaceCardData {
  workspace: Workspace
  overview: WorkspaceOverview
}

const TEMPLATE_STYLES: Record<TemplateType, string> = {
  fnb: "bg-primary/10 text-primary",
  retail: "bg-ring/10 text-ring",
  catering: "bg-success-pale text-success-deep",
}

const FILTER_LABELS: Record<TemplateType, string> = { fnb: "F&B", retail: "Retail", catering: "Katering" }

/** "Kedai Kopi Rasa" → "KK". */
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  return (words.length > 1 ? words[0][0] + words[1][0] : name.slice(0, 2)).toUpperCase() || "·"
}

/** Halaman "Workspace Saya" (redesign Okt 2026): kartu berisi ringkasan dari jurnal. */
export function WorkspaceList({
  services,
  workspaceHref,
  openingBalanceHref,
  onCreated,
}: {
  services: AppServices
  workspaceHref: (workspace: Workspace) => string
  /** Pengaturan → Saldo Awal untuk workspace yang belum mulai. */
  openingBalanceHref: (workspace: Workspace) => string
  onCreated: (workspace: Workspace) => void
}) {
  const today = todayIsoDate()
  const data = useLoader<WorkspaceCardData[]>(async () => {
    const workspaces = await services.workspaceService.listWorkspaces(services.ownerId)
    return Promise.all(
      workspaces.map(async (workspace) => {
        const [accounts, journals] = await Promise.all([
          services.accounts.listByWorkspace(workspace.id),
          services.journals.listByWorkspace(workspace.id),
        ])
        return { workspace, overview: workspaceOverview(accounts, journals, today) }
      }),
    )
  }, [services, today])
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<TemplateType | "all">("all")

  const all = data.data ?? []
  const templates = (Object.keys(FILTER_LABELS) as TemplateType[]).filter((t) => all.some((c) => c.workspace.templateType === t))
  const shown = all.filter(
    (c) =>
      (filter === "all" || c.workspace.templateType === filter) &&
      c.workspace.name.toLowerCase().includes(query.trim().toLowerCase()),
  )

  return (
    <div className="grid grid-cols-1 gap-8">
      <div className="flex flex-wrap items-end justify-between gap-6 border-b pb-8">
        <div className="grid max-w-2xl gap-2">
          <span className="w-fit rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">Pusat kendali usaha</span>
          <h1 className="text-4xl font-bold tracking-tight text-ink">Workspace Saya</h1>
          <p className="text-muted-foreground">
            Pilih usaha atau cabang yang ingin dibukukan hari ini, atau buat workspace baru. Setiap workspace punya
            daftar akun, periode, dan laporan sendiri.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <RestoreBackupDialog services={services} onRestored={onCreated} />
          <CreateWorkspaceDialog
            services={services}
            onCreated={onCreated}
            trigger={
              <Button size="lg">
                <PlusIcon data-icon="inline-start" />
                Buat workspace baru
              </Button>
            }
          />
        </div>
      </div>

      {data.loading ? (
        <LoadingState />
      ) : data.error ? (
        <p role="alert" className="text-sm text-destructive">{errorMessage(data.error)}</p>
      ) : (
        <>
          {all.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="relative w-full sm:max-w-md">
                <SearchIcon className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  aria-label="Cari workspace"
                  placeholder="Cari nama workspace…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="h-11 bg-canvas pl-11"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter jenis usaha">
                <span className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Filter:</span>
                <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>Semua ({all.length})</FilterChip>
                {templates.map((t) => (
                  <FilterChip key={t} active={filter === t} onClick={() => setFilter(t)}>
                    {FILTER_LABELS[t]}
                  </FilterChip>
                ))}
              </div>
            </div>
          )}

          <ul className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {shown.map((card) => (
              <li key={card.workspace.id}>
                <WorkspaceCard card={card} today={today} href={workspaceHref(card.workspace)} setupHref={openingBalanceHref(card.workspace)} />
              </li>
            ))}
            <li>
              <CreateWorkspaceDialog
                services={services}
                onCreated={onCreated}
                trigger={
                  <button
                    type="button"
                    className="grid h-full min-h-72 w-full place-items-center rounded-[32px] border-2 border-dashed border-border p-8 text-center outline-none transition-colors hover:border-primary/40 hover:bg-canvas focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <span className="grid justify-items-center gap-3">
                      <span className="grid size-14 place-items-center rounded-2xl bg-card text-muted-foreground">
                        <PlusIcon className="size-6" />
                      </span>
                      <span className="text-lg font-semibold text-ink">Tambah usaha baru</span>
                      <span className="max-w-xs text-sm text-muted-foreground">
                        Buka buku baru untuk cabang, badan usaha baru, atau proyek musiman.
                      </span>
                    </span>
                  </button>
                }
              />
            </li>
          </ul>
          {all.length > 0 && shown.length === 0 && (
            <p className="text-center text-sm text-muted-foreground">Tidak ada workspace yang cocok dengan pencarian.</p>
          )}
        </>
      )}
    </div>
  )
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-lg px-4 py-2 text-sm font-medium outline-none ring-1 transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
        active ? "bg-ink text-white ring-ink" : "bg-canvas text-ink ring-border hover:bg-secondary",
      )}
    >
      {children}
    </button>
  )
}

function StatusChip({ tone, children }: { tone: "success" | "warning" | "neutral"; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium",
        tone === "success" && "bg-success-pale text-success-deep",
        tone === "warning" && "bg-amber-50 text-amber-800 ring-1 ring-amber-200",
        tone === "neutral" && "bg-card text-ink",
      )}
    >
      {tone !== "neutral" && <span aria-hidden className={cn("size-1.5 rounded-full", tone === "success" ? "bg-success-deep" : "bg-amber-500")} />}
      {children}
    </span>
  )
}

function WorkspaceCard({ card, today, href, setupHref }: { card: WorkspaceCardData; today: string; href: string; setupHref: string }) {
  const { workspace, overview } = card
  const isNew = overview.postedTotal === 0
  const status = isNew
    ? <StatusChip tone="warning">Belum ada jurnal</StatusChip>
    : overview.postedThisMonth > 0
      ? <StatusChip tone="success">Aktif bulan ini</StatusChip>
      : <StatusChip tone="neutral">Terakhir {formatDate(overview.lastEntryDate!)}</StatusChip>

  return (
    <article className="flex h-full flex-col overflow-hidden rounded-[32px] bg-canvas ring-1 ring-border transition-shadow hover:shadow-sm">
      <div className="grid gap-5 p-6 sm:p-7">
        <div className="flex items-start gap-4">
          <span aria-hidden className={cn("grid size-14 shrink-0 place-items-center rounded-2xl text-lg font-bold", TEMPLATE_STYLES[workspace.templateType])}>
            {initialsOf(workspace.name)}
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-xl font-semibold text-ink" title={workspace.name}>{workspace.name}</h2>
            <p className="text-sm text-muted-foreground">{TEMPLATE_LABELS[workspace.templateType]}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {status}
          {!isNew && !overview.hasOpeningBalance && <StatusChip tone="warning">Saldo awal belum diisi</StatusChip>}
          <StatusChip tone="neutral">{workspace.inventoryMethod === "perpetual" ? "Persediaan perpetual" : "Persediaan periodik"}</StatusChip>
          {overview.draftCount > 0 && <StatusChip tone="neutral">{overview.draftCount} draft</StatusChip>}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4 text-sm">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <CalendarIcon className="size-4" /> Mulai {formatDate(workspace.booksStartDate)}
          </span>
          <span className="text-ink">Mata uang: {workspace.currency} (Rp)</span>
        </div>

        <dl className="grid grid-cols-2 gap-4 rounded-2xl bg-card p-4">
          <div className="min-w-0">
            <dt className="text-xs font-medium tracking-wider text-muted-foreground uppercase">Pendapatan {formatMonth(today).split(" ")[0]}</dt>
            <dd className="mt-1 truncate text-lg font-semibold text-ink tabular-nums">{formatAccounting(overview.revenueThisMonth)}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs font-medium tracking-wider text-muted-foreground uppercase">Jurnal bulan ini</dt>
            <dd className="mt-1 text-lg font-semibold text-ink tabular-nums">{overview.postedThisMonth} posted</dd>
          </div>
        </dl>
      </div>

      <div className="mt-auto flex items-center justify-between gap-3 border-t bg-card/50 px-6 py-4 sm:px-7">
        <span className="text-xs text-muted-foreground">{overview.postedTotal.toLocaleString("id-ID")} jurnal posted total</span>
        <Link
          href={isNew ? setupHref : href}
          className="flex items-center gap-1.5 text-sm font-semibold text-primary outline-none underline-offset-4 hover:underline focus-visible:underline"
          aria-label={`${isNew ? "Mulai setup" : "Buka"} ${workspace.name}`}
        >
          {isNew ? "Mulai setup" : "Buka workspace"} <ArrowRightIcon className="size-4" />
        </Link>
      </div>
    </article>
  )
}
