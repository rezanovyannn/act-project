"use client"

import { useState, useSyncExternalStore } from "react"
import { createPortal } from "react-dom"
import Link from "next/link"
import {
  ArrowDownRightIcon,
  ArrowRightIcon,
  ArrowUpRightIcon,
  CalendarIcon,
  CheckCircle2Icon,
  DownloadIcon,
  EyeIcon,
  InfoIcon,
  LockIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { computeDashboardSummary, defaultDashboardPeriod } from "@/core/dashboard"
import {
  growthBps,
  ledgerCheck,
  openClaimCounts,
  previousMonth,
  ratioBps,
  salesTransactionCount,
  weeklyCashFlow,
  type WeeklyCash,
} from "@/core/dashboard-insights"
import { formatAccounting, formatDate, formatMonth, formatPercentBps, todayIsoDate } from "@/core/format"
import { isLedgerEntry } from "@/core/ledger"
import { reversedEntryIds } from "@/core/reversal"
import type { AppServices } from "@/core/services"
import type { Account, JournalEntry, Period } from "@/core/types"
import { Amount } from "@/components/ui/amount"
import { Button } from "@/components/ui/button"
import { EmptyState, LoadingState } from "@/components/ui/page-header"
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
  perpetual: boolean
}

type JournalTab = "all" | "revenue" | "purchase" | "expense"
const JOURNAL_TABS: { value: JournalTab; label: string }[] = [
  { value: "all", label: "Semua" },
  { value: "revenue", label: "Penjualan" },
  { value: "purchase", label: "Pembelian" },
  { value: "expense", label: "Beban" },
]
const PAGE_SIZE = 5

/** Dashboard bulanan (redesign Okt 2026): semua angka dari jurnal posted. */
export function DashboardView({
  services,
  workspaceId,
  journalsHref,
  journalHref,
  creditsHref,
  cashFlowHref,
  topBarSlotId,
}: {
  services: AppServices
  workspaceId: string
  journalsHref: string
  journalHref: (entryId: string) => string
  creditsHref: string
  cashFlowHref: string
  /** Elemen top bar untuk pilih bulan & Ekspor (opsional). */
  topBarSlotId?: string
}) {
  const data = useLoader<DashboardData>(async () => {
    const [accounts, journals, periods, workspace] = await Promise.all([
      services.accounts.listByWorkspace(workspaceId),
      services.journals.listByWorkspace(workspaceId),
      services.periods.listByWorkspace(workspaceId),
      services.workspaces.getById(workspaceId),
    ])
    return { accounts, journals, periods, perpetual: workspace?.inventoryMethod === "perpetual" }
  }, [services, workspaceId])
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null)
  const [tab, setTab] = useState<JournalTab>("all")
  const [page, setPage] = useState(0)
  // Elemen slot di top bar (dirender kerangka aplikasi lebih dulu); null saat render server.
  const slot = useSyncExternalStore(
    () => () => {},
    () => (topBarSlotId ? document.getElementById(topBarSlotId) : null),
    () => null,
  )

  if (data.loading) return <LoadingState />
  if (data.error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {errorMessage(data.error)}
      </p>
    )
  }
  const { accounts, journals, periods, perpetual } = data.data!
  const period =
    periods.find((p) => p.id === selectedPeriodId) ??
    defaultDashboardPeriod(periods, journals, todayIsoDate())

  const controls = period && (
    <>
      <Select
        value={period.id}
        onValueChange={(id) => {
          setSelectedPeriodId(id)
          setPage(0)
        }}
      >
        <SelectTrigger aria-label="Pilih periode" className="w-44 bg-canvas">
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
      <Button variant="secondary" onClick={() => window.print()}>
        <DownloadIcon data-icon="inline-start" />
        Ekspor
      </Button>
    </>
  )

  if (!period) {
    return (
      <div className="grid grid-cols-1 gap-6">
        <Title />
        <EmptyState title="Belum ada periode akuntansi" />
      </div>
    )
  }

  const summary = computeDashboardSummary(accounts, journals, period, { perpetual })
  const previous = computeDashboardSummary(accounts, journals, previousMonth(period), { perpetual })
  const weeks = weeklyCashFlow(accounts, journals, period)
  const netCash = weeks.reduce((t, w) => t + w.inflow - w.outflow, 0)
  const sales = salesTransactionCount(journals, period)
  const check = ledgerCheck(journals, period.endDate)
  const claims = openClaimCounts(accounts, journals, period.endDate)
  const reversed = reversedEntryIds(journals)
  const inPeriod = journals.filter(
    (e) => isLedgerEntry(e) && e.entryDate >= period.startDate && e.entryDate <= period.endDate,
  )
  const expenseCount = inPeriod.filter((e) => e.source === "expense" && !reversed.has(e.id)).length

  const revenueGrowth = growthBps(summary.revenue, previous.revenue)
  const incomeGrowth = growthBps(summary.netIncome, previous.netIncome)
  const cogsRatio = ratioBps(summary.cogs, summary.revenue)
  const expenseRatio = ratioBps(summary.expenses, summary.revenue)
  const margin = ratioBps(summary.netIncome, summary.revenue)
  const taxAccount = accounts.find((a) => a.systemRole === "sales_tax_payable")
  const inputVatAccount = accounts.find((a) => a.systemRole === "input_vat")

  return (
    <div className="grid grid-cols-1 gap-6">
      {slot ? createPortal(controls, slot) : null}

      <div className="flex flex-wrap items-end justify-between gap-4">
        <Title />
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Chip>
            <CalendarIcon className="size-3.5" />
            Periode: {formatDate(period.startDate)} – {formatDate(period.endDate)}
          </Chip>
          {period.status === "closed" && (
            <Chip>
              <LockIcon className="size-3.5" /> Dikunci
            </Chip>
          )}
          <Chip>{summary.postedCount} Jurnal Posted</Chip>
          {check.balanced ? (
            <Chip tone="success">
              <CheckCircle2Icon className="size-3.5" /> Buku besar seimbang · Selisih Rp 0
            </Chip>
          ) : (
            <Chip tone="error">
              <TriangleAlertIcon className="size-3.5" /> Selisih {formatAccounting(check.difference)}
            </Chip>
          )}
        </div>
      </div>

      {/* Pilih bulan & Ekspor di layar kecil (slot top bar disembunyikan). */}
      <div className="flex flex-wrap gap-2 md:hidden print:hidden">{controls}</div>

      {summary.cogsPending && (
        <div role="note" className="flex gap-3 rounded-lg bg-card px-4 py-3 text-sm text-ink">
          <InfoIcon className="mt-0.5 size-4 shrink-0" />
          <p>
            <strong>HPP belum disesuaikan.</strong> Belum ada stok opname di periode ini, sehingga HPP dan laba belum
            mencerminkan persediaan yang terpakai atau terjual. Laba di bawah kemungkinan terlalu tinggi.
          </p>
        </div>
      )}

      <section aria-label="Laba rugi periode" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Pendapatan"
          value={summary.revenue}
          badge={<Growth bps={revenueGrowth} />}
          footer={[
            ["Transaksi penjualan", sales.toLocaleString("id-ID")],
            ["Bulan lalu", formatAccounting(previous.revenue)],
          ]}
        />
        <KpiCard
          label="HPP"
          value={summary.cogs}
          badge={cogsRatio !== null && <Chip>{formatPercentBps(cogsRatio)} dari pendapatan</Chip>}
          footer={[
            ["Bulan lalu", formatAccounting(previous.cogs)],
            ["Metode", perpetual ? "Perpetual" : "Periodik"],
          ]}
        />
        <KpiCard
          label="Beban operasional"
          value={summary.expenses}
          badge={expenseRatio !== null && <Chip>{formatPercentBps(expenseRatio)} dari pendapatan</Chip>}
          footer={[
            ["Transaksi beban", expenseCount.toLocaleString("id-ID")],
            ["Bulan lalu", formatAccounting(previous.expenses)],
          ]}
        />
        <KpiCard
          label={summary.netIncome >= 0 ? "Laba bersih" : "Rugi bersih"}
          value={summary.netIncome}
          emphasis
          badge={margin !== null && <Chip tone="primary">Margin {formatPercentBps(margin)}</Chip>}
          footer={[["Dibanding bulan lalu", incomeGrowth === null ? "—" : formatPercentBps(incomeGrowth, true)]]}
        />
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="grid content-between gap-6 rounded-lg bg-canvas p-6 ring-1 ring-border">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold text-ink">Kas masuk vs kas keluar mingguan</h2>
              <p className="text-sm text-muted-foreground">Mutasi bersih akun kas & bank per pekan (transfer antar kas tidak dihitung).</p>
            </div>
            <div className="flex gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-ink" />Kas masuk</span>
              <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-primary" />Kas keluar</span>
            </div>
          </div>
          <WeeklyChart weeks={weeks} />
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-card px-4 py-3 text-sm">
            <span className="flex items-center gap-2 text-ink">
              <CheckCircle2Icon className="size-4 text-success-deep" />
              {netCash >= 0 ? "Kenaikan" : "Penurunan"} kas bersih bulan ini:
              <strong className="tabular-nums">{netCash >= 0 ? "+" : ""}{formatAccounting(netCash)}</strong>
            </span>
            <Link href={cashFlowHref} className="flex items-center gap-1 font-semibold text-primary underline-offset-4 hover:underline">
              Buka analisis arus kas <ArrowRightIcon className="size-4" />
            </Link>
          </div>
        </div>

        <div className="grid content-start gap-4">
          <div className="rounded-lg bg-canvas p-6 ring-1 ring-border">
            <p className="text-sm text-muted-foreground">Total likuiditas (kas & bank)</p>
            <Amount value={summary.cashTotal} className="mt-1 block text-2xl font-bold text-ink" />
            <ul className="mt-4 grid gap-2 text-sm">
              {summary.cashAccounts.map((a, i) => (
                <li key={a.accountId} className="flex items-center justify-between gap-4">
                  <span className="flex min-w-0 items-center gap-2 text-ink">
                    <span aria-hidden className={cn("size-2 shrink-0 rounded-full", DOT_COLORS[i % DOT_COLORS.length])} />
                    <span className="truncate">{a.name}</span>
                  </span>
                  <Amount value={a.balance} className="font-semibold text-ink" />
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-lg bg-canvas p-6 ring-1 ring-border">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Kewajiban & tagihan</p>
              <Link href={creditsHref} className="flex items-center gap-1 text-sm font-semibold text-primary underline-offset-4 hover:underline">
                Rincian <ArrowRightIcon className="size-4" />
              </Link>
            </div>
            <ul className="mt-3 divide-y text-sm">
              <ClaimRow label="Piutang usaha" note={claims.receivables ? `${claims.receivables} transaksi belum lunas` : null} value={summary.receivables} />
              <ClaimRow label="Utang usaha" note={claims.payables ? `${claims.payables} transaksi belum lunas` : null} value={summary.payables} />
              <ClaimRow label={`${taxAccount?.name ?? "Utang pajak"} (belum disetor)`} value={summary.salesTaxPayable} />
              {inputVatAccount && <ClaimRow label={`${inputVatAccount.name} (belum dikreditkan)`} value={summary.inputVat} />}
            </ul>
          </div>
        </div>
      </section>

      <RecentJournals
        accounts={accounts}
        entries={inPeriod}
        reversed={reversed}
        period={period}
        tab={tab}
        onTab={(next) => {
          setTab(next)
          setPage(0)
        }}
        page={page}
        onPage={setPage}
        journalsHref={journalsHref}
        journalHref={journalHref}
      />
    </div>
  )
}

const DOT_COLORS = ["bg-ink", "bg-ring", "bg-chart-2", "bg-success-deep", "bg-chart-4"]

function Title() {
  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tight text-ink">Dashboard</h1>
      <p className="text-sm text-muted-foreground">Ringkasan keuangan per bulan, dihitung langsung dari jurnal posted.</p>
    </div>
  )
}

function Chip({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "success" | "error" | "primary" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap",
        tone === "neutral" && "bg-card text-ink ring-1 ring-border",
        tone === "success" && "bg-success-pale text-success-deep",
        tone === "error" && "border border-destructive/40 text-destructive",
        tone === "primary" && "bg-primary/10 text-primary",
      )}
    >
      {children}
    </span>
  )
}

function Growth({ bps }: { bps: number | null }) {
  if (bps === null) return <Chip>Bulan lalu Rp 0</Chip>
  const Icon = bps >= 0 ? ArrowUpRightIcon : ArrowDownRightIcon
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-semibold", bps >= 0 ? "text-success-deep" : "text-ink")}>
      <Icon className="size-3.5" />
      {formatPercentBps(bps, true)}
    </span>
  )
}

function KpiCard({
  label,
  value,
  badge,
  footer,
  emphasis,
}: {
  label: string
  value: number
  badge?: React.ReactNode
  footer: [string, string][]
  emphasis?: boolean
}) {
  return (
    <div className={cn("grid content-between gap-4 rounded-lg p-6 ring-1", emphasis ? "bg-primary/5 ring-primary/20" : "bg-canvas ring-border")}>
      <div className="grid gap-2">
        <div className="flex items-start justify-between gap-2">
          <p className={cn("text-sm font-medium", emphasis ? "text-primary" : "text-muted-foreground")}>{label}</p>
          {badge}
        </div>
        <Amount value={value} className="block text-2xl font-bold text-ink" />
      </div>
      <dl className="grid gap-1 border-t pt-3 text-xs">
        {footer.map(([term, detail]) => (
          <div key={term} className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{term}</dt>
            <dd className="font-medium text-ink tabular-nums">{detail}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function WeeklyChart({ weeks }: { weeks: WeeklyCash[] }) {
  const max = Math.max(1, ...weeks.flatMap((w) => [w.inflow, w.outflow]))
  const height = (value: number) => `${Math.max(value > 0 ? 3 : 0, Math.round((value / max) * 100))}%`
  return (
    <figure className="grid gap-2">
      <div className="flex h-48 items-end justify-around gap-2 border-b px-2" aria-hidden>
        {weeks.map((w) => (
          <div key={w.label} className="flex h-full items-end gap-1.5" title={`${w.label}: masuk ${formatAccounting(w.inflow)}, keluar ${formatAccounting(w.outflow)}`}>
            <div className="w-6 rounded-t-md bg-ink sm:w-8" style={{ height: height(w.inflow) }} />
            <div className="w-6 rounded-t-md bg-primary sm:w-8" style={{ height: height(w.outflow) }} />
          </div>
        ))}
      </div>
      <div className="flex justify-around gap-2 px-2 text-xs text-muted-foreground" aria-hidden>
        {weeks.map((w) => (
          <span key={w.label} className="w-14 text-center sm:w-20">{w.label}</span>
        ))}
      </div>
      {/* Pembungkus sr-only: elemen tabel mengabaikan lebar 1px sehingga bisa melebarkan halaman. */}
      <div className="sr-only">
      <table>
        <caption>Kas masuk dan keluar per pekan</caption>
        <tbody>
          {weeks.map((w) => (
            <tr key={w.label}>
              <th scope="row">{w.label} ({formatDate(w.fromDate)} – {formatDate(w.toDate)})</th>
              <td>Masuk {formatAccounting(w.inflow)}</td>
              <td>Keluar {formatAccounting(w.outflow)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </figure>
  )
}

function ClaimRow({ label, note, value }: { label: string; note?: string | null; value: number }) {
  return (
    <li className="flex items-start justify-between gap-4 py-2.5">
      <span className="min-w-0">
        <span className="block text-ink">{label}</span>
        {note && <span className="block text-xs text-muted-foreground">{note}</span>}
      </span>
      <Amount value={value} className="font-semibold text-ink" />
    </li>
  )
}

function RecentJournals({
  accounts,
  entries,
  reversed,
  period,
  tab,
  onTab,
  page,
  onPage,
  journalsHref,
  journalHref,
}: {
  accounts: Account[]
  entries: JournalEntry[]
  reversed: Set<string>
  period: Period
  tab: JournalTab
  onTab: (tab: JournalTab) => void
  page: number
  onPage: (page: number) => void
  journalsHref: string
  journalHref: (entryId: string) => string
}) {
  const accountsById = new Map(accounts.map((a) => [a.id, a]))
  const filtered = [...entries]
    .filter((e) => tab === "all" || e.source === tab)
    .sort((a, b) => b.entryDate.localeCompare(a.entryDate) || (b.entryNumber ?? "").localeCompare(a.entryNumber ?? ""))
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const current = Math.min(page, pages - 1)
  const shown = filtered.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE)
  const total = (e: JournalEntry, side: "debit" | "credit") => e.lines.reduce((t, l) => t + l[side], 0)
  const shownDebit = shown.reduce((t, e) => t + total(e, "debit"), 0)
  const shownCredit = shown.reduce((t, e) => t + total(e, "credit"), 0)

  return (
    <section aria-labelledby="recent-title" className="overflow-hidden rounded-lg bg-canvas ring-1 ring-border">
      <div className="flex flex-wrap items-end justify-between gap-4 p-6">
        <div>
          <h2 id="recent-title" className="text-lg font-semibold text-ink">
            Jurnal periode {formatMonth(period.startDate)}
          </h2>
          <p className="text-sm text-muted-foreground">Entri jurnal posted dengan debit dan kredit seimbang.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <div role="tablist" aria-label="Jenis jurnal" className="flex rounded-lg bg-card p-1">
            {JOURNAL_TABS.map((t) => (
              <button
                key={t.value}
                type="button"
                role="tab"
                aria-selected={tab === t.value}
                onClick={() => onTab(t.value)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  tab === t.value ? "bg-canvas font-semibold text-ink shadow-xs" : "text-muted-foreground hover:text-ink",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
          <Link href={journalsHref} className="flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-semibold text-primary ring-1 ring-primary/30 hover:bg-primary/5">
            Buka jurnal umum <ArrowRightIcon className="size-4" />
          </Link>
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="border-t px-6 py-10 text-center text-sm text-muted-foreground">Belum ada jurnal posted untuk pilihan ini.</p>
      ) : (
        <div className="overflow-x-auto border-t">
          <table className="w-full min-w-[56rem] text-sm">
            <thead className="bg-card text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              <tr>
                <th className="px-6 py-3">Tanggal & no. jurnal</th>
                <th className="px-3 py-3">Keterangan & pihak</th>
                <th className="px-3 py-3">Akun terkait</th>
                <th className="px-3 py-3 text-right">Debit</th>
                <th className="px-3 py-3 text-right">Kredit</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-6 py-3 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {shown.map((entry) => (
                <tr key={entry.id} className="align-top">
                  <td className="px-6 py-4">
                    <span className="block text-ink">{formatDate(entry.entryDate)}</span>
                    <span className="mt-1 inline-block rounded-md bg-card px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">{entry.entryNumber}</span>
                  </td>
                  <td className="px-3 py-4">
                    <span className="block text-ink">{entry.description}</span>
                    {entry.counterparty && <span className="block text-xs text-muted-foreground">{entry.counterparty}</span>}
                  </td>
                  <td className="px-3 py-4">
                    <ul className="grid gap-0.5 text-xs">
                      {entry.lines.map((line) => {
                        const account = accountsById.get(line.accountId)
                        return (
                          <li key={line.id} className={cn(line.credit > 0 && "pl-3")}>
                            <span className="font-mono text-muted-foreground">{account?.code}</span> {account?.name}{" "}
                            <span className="text-muted-foreground">({line.debit > 0 ? "Dr" : "Cr"})</span>
                          </li>
                        )
                      })}
                    </ul>
                  </td>
                  <td className="px-3 py-4 text-right"><Amount value={total(entry, "debit")} /></td>
                  <td className="px-3 py-4 text-right"><Amount value={total(entry, "credit")} /></td>
                  <td className="px-3 py-4"><StatusBadge entry={entry} voided={reversed.has(entry.id)} /></td>
                  <td className="px-6 py-4 text-right">
                    <Link href={journalHref(entry.id)} aria-label={`Lihat ${entry.entryNumber}`} className="inline-grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-card hover:text-ink">
                      <EyeIcon className="size-4" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-ink bg-card font-semibold text-ink">
              <tr>
                <td colSpan={3} className="px-6 py-3 text-right">Total ({shown.length} entri ditampilkan)</td>
                <td className="px-3 py-3 text-right"><Amount value={shownDebit} /></td>
                <td className="px-3 py-3 text-right"><Amount value={shownCredit} /></td>
                <td colSpan={2} className="px-3 py-3">
                  {shownDebit === shownCredit ? <Chip tone="success">Seimbang</Chip> : <Chip tone="error">Selisih {formatAccounting(shownDebit - shownCredit)}</Chip>}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t px-6 py-4 text-sm text-muted-foreground print:hidden">
        <span>
          Menampilkan {shown.length} dari {filtered.length} entri jurnal di {formatMonth(period.startDate)}
        </span>
        <div className="flex items-center gap-1">
          <Button variant="secondary" size="sm" disabled={current === 0} onClick={() => onPage(current - 1)}>Sebelumnya</Button>
          <span className="px-2 tabular-nums">{current + 1} / {pages}</span>
          <Button variant="secondary" size="sm" disabled={current >= pages - 1} onClick={() => onPage(current + 1)}>Berikutnya</Button>
        </div>
      </div>
    </section>
  )
}

function StatusBadge({ entry, voided }: { entry: JournalEntry; voided: boolean }) {
  if (voided) return <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold text-muted-foreground line-through">Di-void</span>
  if (entry.source === "reversal") return <span className="rounded-full bg-card px-2 py-0.5 text-xs font-semibold text-muted-foreground">Pembalik</span>
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-success-pale px-2 py-0.5 text-xs font-semibold text-success-deep">
      <span aria-hidden className="size-1.5 rounded-full bg-success-deep" />
      Posted
    </span>
  )
}
