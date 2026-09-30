"use client"

import { useState } from "react"
import Link from "next/link"
import { InfoIcon, LockIcon, PlusIcon } from "lucide-react"
import { computeDashboardSummary, defaultDashboardPeriod } from "@/core/dashboard"
import { formatDate, formatMonth, todayIsoDate } from "@/core/format"
import { isLedgerEntry } from "@/core/ledger"
import type { AppServices } from "@/core/services"
import type { Account, JournalEntry, Period } from "@/core/types"
import { Amount } from "@/components/ui/amount"
import { Button } from "@/components/ui/button"
import { EmptyState, LoadingState, PageHeader } from "@/components/ui/page-header"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn, errorMessage, useLoader } from "@/lib/utils"

interface DashboardData {
  accounts: Account[]
  journals: JournalEntry[]
  periods: Period[]
}

export function DashboardView({
  services,
  workspaceId,
  journalsHref,
  newJournalHref,
  journalHref,
}: {
  services: AppServices
  workspaceId: string
  journalsHref: string
  newJournalHref: string
  journalHref: (entryId: string) => string
}) {
  const data = useLoader<DashboardData>(async () => {
    const [accounts, journals, periods] = await Promise.all([
      services.accounts.listByWorkspace(workspaceId),
      services.journals.listByWorkspace(workspaceId),
      services.periods.listByWorkspace(workspaceId),
    ])
    return { accounts, journals, periods }
  }, [services, workspaceId])
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null)

  if (data.loading) return <LoadingState />
  if (data.error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {errorMessage(data.error)}
      </p>
    )
  }
  const { accounts, journals, periods } = data.data!
  const period =
    periods.find((p) => p.id === selectedPeriodId) ??
    defaultDashboardPeriod(periods, journals, todayIsoDate())

  const header = (
    <PageHeader
      title="Dashboard"
      description="Ringkasan keuangan per bulan, dihitung langsung dari jurnal posted."
      actions={
        <>
          {period && (
            <Select value={period.id} onValueChange={setSelectedPeriodId}>
              <SelectTrigger aria-label="Pilih periode" className="w-48 bg-canvas">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[...periods].reverse().map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {formatMonth(p.startDate)}
                    {p.status === "closed" ? " · dikunci" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button asChild>
            <Link href={newJournalHref}>
              <PlusIcon data-icon="inline-start" />
              Jurnal baru
            </Link>
          </Button>
        </>
      }
    />
  )

  if (!period) {
    return (
      <div className="grid grid-cols-1 gap-6">
        {header}
        <EmptyState title="Belum ada periode akuntansi" />
      </div>
    )
  }

  const summary = computeDashboardSummary(accounts, journals, period)
  const recent = journals
    .filter(isLedgerEntry)
    .filter((e) => e.entryDate <= period.endDate)
    .slice(-6)
    .reverse()

  return (
    <div className="grid grid-cols-1 gap-6">
      {header}

      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span>
          Periode {formatDate(period.startDate)} – {formatDate(period.endDate)}
        </span>
        {period.status === "closed" && (
          <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-0.5 text-xs font-semibold text-ink">
            <LockIcon className="size-3" /> Dikunci
          </span>
        )}
      </div>

      {summary.cogsPending && (
        <div role="note" className="flex gap-3 rounded-lg bg-card px-4 py-3 text-sm text-ink">
          <InfoIcon className="mt-0.5 size-4 shrink-0" />
          <p>
            <strong>HPP belum disesuaikan.</strong> Belum ada stok opname di periode ini, sehingga
            HPP dan laba belum mencerminkan persediaan yang terpakai atau terjual. Laba di bawah kemungkinan terlalu
            tinggi.
          </p>
        </div>
      )}

      <section aria-label="Laba rugi periode" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Pendapatan" value={summary.revenue} />
        <Metric label="HPP" value={summary.cogs} />
        <Metric label="Beban operasional" value={summary.expenses} />
        <Metric label="Laba bersih" value={summary.netIncome} emphasis />
      </section>

      <section aria-label="Posisi per akhir periode" className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-lg bg-card p-6">
          <p className="text-xs font-medium text-muted-foreground">Kas & bank</p>
          <Amount value={summary.cashTotal} className="mt-1 block text-lg font-semibold text-ink" />
          <ul className="mt-3 grid gap-1 text-sm">
            {summary.cashAccounts.map((a) => (
              <li key={a.accountId} className="flex justify-between gap-4">
                <span className="text-muted-foreground">{a.name}</span>
                <Amount value={a.balance} />
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-lg bg-card p-6">
          <p className="text-xs font-medium text-muted-foreground">Piutang & utang</p>
          <ul className="mt-2 grid gap-2 text-sm">
            <Row label="Piutang usaha" value={summary.receivables} />
            <Row label="Utang usaha" value={summary.payables} />
            <Row label={`${accounts.find((a) => a.systemRole === "sales_tax_payable")?.name ?? "Utang pajak"} (belum disetor)`} value={summary.salesTaxPayable} />
            {accounts.some((a) => a.systemRole === "input_vat") && (
              <Row label={`${accounts.find((a) => a.systemRole === "input_vat")!.name} (belum dikreditkan)`} value={summary.inputVat} />
            )}
          </ul>
        </div>
        <div className="rounded-lg bg-card p-6">
          <p className="text-xs font-medium text-muted-foreground">Aktivitas jurnal</p>
          <ul className="mt-2 grid gap-2 text-sm">
            <li className="flex justify-between gap-4">
              <span className="text-muted-foreground">Jurnal posted periode ini</span>
              <span className="font-semibold text-ink tabular-nums">{summary.postedCount}</span>
            </li>
            <li className="flex justify-between gap-4">
              <span className="text-muted-foreground">Draft belum diposting</span>
              <span className="font-semibold text-ink tabular-nums">{summary.draftCount}</span>
            </li>
          </ul>
          <Link href={journalsHref} className="mt-3 inline-block text-sm font-semibold text-ink underline-offset-4 hover:underline">
            Buka jurnal umum →
          </Link>
        </div>
      </section>

      <section aria-labelledby="recent-title" className="grid grid-cols-1 gap-3">
        <h2 id="recent-title" className="text-lg font-semibold">
          Jurnal terakhir s.d. {formatDate(period.endDate)}
        </h2>
        {recent.length === 0 ? (
          <EmptyState title="Belum ada jurnal posted" />
        ) : (
          <ul className="divide-y rounded-lg border bg-canvas">
            {recent.map((entry) => (
              <li key={entry.id}>
                <Link
                  href={journalHref(entry.id)}
                  className="flex items-center gap-4 px-4 py-3 text-sm outline-none hover:bg-card focus-visible:bg-card"
                >
                  <span className="w-24 shrink-0 tabular-nums text-muted-foreground">
                    {formatDate(entry.entryDate)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-ink">{entry.description}</span>
                  <Amount value={entry.lines.reduce((sum, l) => sum + l.debit, 0)} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function Metric({ label, value, emphasis }: { label: string; value: number; emphasis?: boolean }) {
  return (
    <div className={cn("rounded-lg p-6", emphasis ? "bg-canvas ring-1 ring-border" : "bg-card")}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <Amount value={value} className="mt-1 block text-lg font-semibold text-ink" />
    </div>
  )
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <li className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <Amount value={value} className="text-ink" />
    </li>
  )
}
