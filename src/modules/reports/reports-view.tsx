"use client"

import { useState } from "react"
import { flushSync } from "react-dom"
import { InfoIcon, PrinterIcon } from "lucide-react"
import { computeDashboardSummary } from "@/core/dashboard"
import { endOfMonth, toIsoDate } from "@/core/dates"
import { formatAccounting, formatDate, formatMonth, todayIsoDate } from "@/core/format"
import {
  balanceSheet,
  cashFlowStatement,
  equityChanges,
  incomeStatement,
  trialBalance,
  type DateRange,
} from "@/core/reports"
import type { AppServices } from "@/core/services"
import type { Account, JournalEntry, Period } from "@/core/types"
import { Amount } from "@/components/ui/amount"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LoadingState, PageHeader } from "@/components/ui/page-header"
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { errorMessage, useLoader } from "@/lib/utils"
import { InvariantCheck, StatementTable, sectionRows, type StatementRow } from "./statement-table"

interface ReportData {
  workspaceName: string
  accounts: Account[]
  journals: JournalEntry[]
  periods: Period[]
}

function presets(today: string): { label: string; range: DateRange }[] {
  const year = Number(today.slice(0, 4))
  const month = Number(today.slice(5, 7))
  const prevMonthStart = month === 1 ? toIsoDate(year - 1, 12, 1) : toIsoDate(year, month - 1, 1)
  return [
    { label: "Tahun ini", range: { fromDate: toIsoDate(year, 1, 1), toDate: today } },
    { label: "Bulan ini", range: { fromDate: toIsoDate(year, month, 1), toDate: today } },
    { label: "Bulan lalu", range: { fromDate: prevMonthStart, toDate: endOfMonth(prevMonthStart) } },
    { label: "Tahun lalu", range: { fromDate: toIsoDate(year - 1, 1, 1), toDate: toIsoDate(year - 1, 12, 31) } },
  ]
}

export function ReportsView({ services, workspaceId }: { services: AppServices; workspaceId: string }) {
  const data = useLoader<ReportData>(async () => {
    const [workspace, accounts, journals, periods] = await Promise.all([
      services.workspaces.getById(workspaceId),
      services.accounts.listByWorkspace(workspaceId),
      services.journals.listByWorkspace(workspaceId, { status: "posted" }),
      services.periods.listByWorkspace(workspaceId),
    ])
    return { workspaceName: workspace?.name ?? "", accounts, journals, periods }
  }, [services, workspaceId])

  const today = todayIsoDate()
  const [range, setRange] = useState<DateRange>(() => presets(today)[0].range)
  const [printAll, setPrintAll] = useState(false)

  // Cetak lewat dialog browser (bisa "Simpan sebagai PDF"); mode "semua" merender kelima laporan.
  function print(all: boolean) {
    flushSync(() => setPrintAll(all))
    window.addEventListener("afterprint", () => setPrintAll(false), { once: true })
    window.print()
  }

  if (data.loading) return <LoadingState />
  if (data.error) return <p role="alert" className="text-sm text-destructive">{errorMessage(data.error)}</p>
  const { workspaceName, accounts, journals, periods } = data.data!
  const validRange = range.fromDate !== "" && range.toDate !== "" && range.fromDate <= range.toDate

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader
        className="print:hidden"
        title="Laporan Keuangan"
        description="Dihitung langsung dari jurnal posted. Laporan posisi (Neraca Saldo, Neraca) memakai tanggal akhir."
      />

      <div className="grid gap-4 rounded-lg bg-card p-4 sm:p-6 print:hidden">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Pilihan cepat periode">
          {presets(today).map((preset) => (
            <Button
              key={preset.label}
              type="button"
              size="sm"
              variant={preset.range.fromDate === range.fromDate && preset.range.toDate === range.toDate ? "default" : "secondary"}
              onClick={() => setRange(preset.range)}
            >
              {preset.label}
            </Button>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 sm:max-w-md">
          <div className="grid gap-2">
            <Label htmlFor="report-from">Dari tanggal</Label>
            <Input id="report-from" type="date" value={range.fromDate} onChange={(e) => setRange({ ...range, fromDate: e.target.value })} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="report-to">Sampai tanggal</Label>
            <Input id="report-to" type="date" value={range.toDate} onChange={(e) => setRange({ ...range, toDate: e.target.value })} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2 border-t pt-4">
          <Button type="button" variant="secondary" disabled={!validRange} onClick={() => print(false)}>
            <PrinterIcon data-icon="inline-start" />
            Cetak / Simpan PDF
          </Button>
          <Button type="button" variant="secondary" disabled={!validRange} onClick={() => print(true)}>
            <PrinterIcon data-icon="inline-start" />
            Cetak semua laporan
          </Button>
        </div>
      </div>

      {!validRange ? (
        <p role="alert" className="text-sm text-destructive">Tanggal awal harus sebelum atau sama dengan tanggal akhir.</p>
      ) : (
        <Reports workspaceName={workspaceName} accounts={accounts} journals={journals} periods={periods} range={range} printAll={printAll} />
      )}
    </div>
  )
}

function Reports({
  workspaceName,
  accounts,
  journals,
  periods,
  range,
  printAll,
}: {
  workspaceName: string
  accounts: Account[]
  journals: JournalEntry[]
  periods: Period[]
  range: DateRange
  printAll: boolean
}) {
  const [tab, setTab] = useState("income")
  const tb = trialBalance(accounts, journals, range.toDate)
  const is = incomeStatement(accounts, journals, range)
  const bs = balanceSheet(accounts, journals, range.toDate)
  const ec = equityChanges(accounts, journals, range)
  const cf = cashFlowStatement(accounts, journals, range)

  const periodLabel = `${workspaceName} · ${formatDate(range.fromDate)} – ${formatDate(range.toDate)}`
  const asOfLabel = `${workspaceName} · per ${formatDate(range.toDate)}`

  // Bulan dalam rentang yang ada penjualan/pembelian persediaan tetapi belum stok opname (ADR 007).
  const pendingMonths = periods
    .filter((p) => p.endDate >= range.fromDate && p.startDate <= range.toDate)
    .filter((p) => computeDashboardSummary(accounts, journals, p).cogsPending)
    .map((p) => formatMonth(p.startDate))

  const incomeRows: StatementRow[] = [
    { kind: "heading", label: "Pendapatan" },
    ...sectionRows(is.revenue),
    { kind: "subtotal", label: "Total pendapatan", amount: is.revenue.total },
    { kind: "heading", label: "Harga Pokok Penjualan" },
    ...sectionRows(is.cogs),
    { kind: "subtotal", label: "Total HPP", amount: is.cogs.total },
    { kind: "subtotal", label: "Laba kotor", amount: is.grossProfit },
    { kind: "heading", label: "Beban operasional" },
    ...sectionRows(is.expenses),
    { kind: "subtotal", label: "Total beban", amount: is.expenses.total },
    { kind: "total", label: is.netIncome >= 0 ? "Laba bersih" : "Rugi bersih", amount: is.netIncome },
  ]

  const balanceRows: StatementRow[] = [
    { kind: "heading", label: "Aset" },
    ...sectionRows(bs.assets),
    { kind: "total", label: "Total aset", amount: bs.assets.total },
    { kind: "heading", label: "Liabilitas" },
    ...sectionRows(bs.liabilities),
    { kind: "subtotal", label: "Total liabilitas", amount: bs.liabilities.total },
    { kind: "heading", label: "Ekuitas" },
    ...sectionRows(bs.equity),
    { kind: "line", label: "Laba ditahan (tahun-tahun sebelumnya)", amount: bs.retainedEarnings, indent: true },
    { kind: "line", label: `Laba tahun berjalan (${bs.fiscalYearStart.slice(0, 4)})`, amount: bs.currentYearEarnings, indent: true },
    { kind: "subtotal", label: "Total ekuitas", amount: bs.totalEquity },
    { kind: "total", label: "Total liabilitas dan ekuitas", amount: bs.totalLiabilitiesAndEquity },
  ]

  const equityRows: StatementRow[] = [
    { kind: "line", label: "Saldo awal ekuitas", amount: ec.opening },
    { kind: "line", label: "Setoran modal", amount: ec.contributions },
    { kind: "line", label: is.netIncome >= 0 ? "Laba bersih periode" : "Rugi bersih periode", amount: ec.netIncome },
    { kind: "line", label: "Prive", amount: -ec.drawings },
    ...(ec.other !== 0 ? [{ kind: "line" as const, label: "Perubahan ekuitas lain", amount: ec.other }] : []),
    { kind: "total", label: "Saldo akhir ekuitas", amount: ec.closing },
  ]

  const activityLabels = {
    operating: "Arus kas dari aktivitas operasi",
    investing: "Arus kas dari aktivitas investasi",
    financing: "Arus kas dari aktivitas pendanaan",
  } as const
  const cashRows: StatementRow[] = [
    ...(Object.keys(activityLabels) as (keyof typeof activityLabels)[]).flatMap((key): StatementRow[] => [
      { kind: "heading", label: activityLabels[key] },
      ...sectionRows(cf.activities[key], "Tidak ada arus kas"),
      { kind: "subtotal", label: "Arus kas bersih", amount: cf.activities[key].total },
    ]),
    ...(cf.unclassified.lines.length > 0
      ? [
          { kind: "heading" as const, label: "Tidak terklasifikasi (periksa kategori arus kas akun)" },
          ...sectionRows(cf.unclassified),
          { kind: "subtotal" as const, label: "Total tidak terklasifikasi", amount: cf.unclassified.total },
        ]
      : []),
    { kind: "subtotal", label: "Kenaikan (penurunan) kas bersih", amount: cf.netChange },
    { kind: "line", label: "Saldo kas awal", amount: cf.opening },
    { kind: "total", label: "Saldo kas akhir", amount: cf.closing },
  ]

  const cashInBalanceSheet = bs.assets.lines
    .filter((l) => accounts.find((a) => a.id === l.accountId)?.isCash)
    .reduce((sum, l) => sum + l.amount, 0)

  const trialTable = (
  <section className="overflow-hidden rounded-lg border bg-canvas" aria-label="Neraca Saldo">
    <header className="border-b bg-card px-4 py-3 text-center">
      <h2 className="text-lg font-bold">Neraca Saldo</h2>
      <p className="text-sm text-muted-foreground">{asOfLabel}</p>
    </header>
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-24">Kode</TableHead>
          <TableHead>Akun</TableHead>
          <TableHead className="w-40 text-right">Debit</TableHead>
          <TableHead className="w-40 text-right">Kredit</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tb.rows.map((row) => (
          <TableRow key={row.accountId}>
            <TableCell className="text-muted-foreground tabular-nums">{row.code}</TableCell>
            <TableCell>{row.name}</TableCell>
            <TableCell className="text-right"><Amount value={row.debit} hideZero /></TableCell>
            <TableCell className="text-right"><Amount value={row.credit} hideZero /></TableCell>
          </TableRow>
        ))}
      </TableBody>
      <TableFooter className="border-t-2 border-ink bg-canvas font-bold text-ink">
        <TableRow>
          <TableCell colSpan={2}>Total</TableCell>
          <TableCell className="text-right"><Amount value={tb.totalDebit} /></TableCell>
          <TableCell className="text-right"><Amount value={tb.totalCredit} /></TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  </section>
  )
  const incomeTable = <StatementTable title="Laporan Laba Rugi" subtitle={periodLabel} rows={incomeRows} />
  const balanceTable = <StatementTable title="Laporan Posisi Keuangan (Neraca)" subtitle={asOfLabel} rows={balanceRows} />
  const equityTable = <StatementTable title="Laporan Perubahan Modal" subtitle={periodLabel} rows={equityRows} />
  const cashTable = <StatementTable title="Laporan Arus Kas (metode langsung)" subtitle={periodLabel} rows={cashRows} />

  return (
    <>
    <Tabs value={tab} onValueChange={setTab} className={printAll ? "grid grid-cols-1 gap-4 print:hidden" : "grid grid-cols-1 gap-4"}>
      <TabsList className="h-auto w-fit max-w-full flex-wrap print:hidden">
        <TabsTrigger value="trial">Neraca Saldo</TabsTrigger>
        <TabsTrigger value="income">Laba Rugi</TabsTrigger>
        <TabsTrigger value="balance">Neraca</TabsTrigger>
        <TabsTrigger value="equity">Perubahan Modal</TabsTrigger>
        <TabsTrigger value="cash">Arus Kas</TabsTrigger>
      </TabsList>

      <TabsContent value="trial" className="grid gap-4">
        <InvariantCheck
          ok={tb.balanced}
          label={tb.balanced ? "Debit = Kredit" : "Neraca saldo tidak seimbang"}
          detail={`${formatAccounting(tb.totalDebit)} / ${formatAccounting(tb.totalCredit)}`}
        />
        {trialTable}
      </TabsContent>

      <TabsContent value="income" className="grid gap-4">
        {pendingMonths.length > 0 && (
          <p role="note" className="flex gap-2 rounded-lg bg-card px-4 py-3 text-sm text-ink print:hidden">
            <InfoIcon className="mt-0.5 size-4 shrink-0" />
            <span>
              <strong>HPP belum disesuaikan</strong> untuk {pendingMonths.join(", ")}. Lakukan stok
              opname agar HPP dan laba mencerminkan persediaan yang terpakai atau terjual.
            </span>
          </p>
        )}
        {incomeTable}
      </TabsContent>

      <TabsContent value="balance" className="grid gap-4">
        <InvariantCheck
          ok={bs.balanced}
          label={bs.balanced ? "Aset = Liabilitas + Ekuitas" : "Neraca tidak seimbang"}
          detail={`${formatAccounting(bs.assets.total)} = ${formatAccounting(bs.totalLiabilitiesAndEquity)}`}
        />
        {balanceTable}
      </TabsContent>

      <TabsContent value="equity" className="grid gap-4">
        <InvariantCheck
          ok={ec.netIncome === is.netIncome && ec.closing === bs.totalEquity}
          label="Sinkron dengan Laba Rugi dan Neraca"
          detail={`laba ${formatAccounting(is.netIncome)}, ekuitas akhir ${formatAccounting(bs.totalEquity)}`}
        />
        {equityTable}
      </TabsContent>

      <TabsContent value="cash" className="grid gap-4">
        <InvariantCheck
          ok={cf.reconciled && cf.closing === cashInBalanceSheet}
          label={cf.reconciled ? "Kas akhir = saldo kas & bank di Neraca" : "Arus kas tidak rekonsiliasi"}
          detail={formatAccounting(cf.closing)}
        />
        {cashTable}
        <p className="text-xs text-muted-foreground print:hidden">
          Setiap baris menunjukkan kas bersih yang berkaitan dengan akun lawan tersebut. Transfer antar
          akun kas/bank tidak dihitung sebagai aktivitas; jurnal saldo awal menjadi bagian saldo kas awal.
        </p>
      </TabsContent>
    </Tabs>
    {printAll && (
      <div className="hidden print:grid print:gap-6" data-testid="print-all">
        {[trialTable, incomeTable, balanceTable, equityTable, cashTable].map((table, index) => (
          <div key={index} className={index > 0 ? "break-before-page" : undefined}>
            {table}
          </div>
        ))}
      </div>
    )}
    </>
  )
}
