"use client"

import { useState } from "react"
import { DownloadIcon, InfoIcon, TriangleAlertIcon } from "lucide-react"
import { toCsv } from "@/core/backup"
import { formatDate, formatNumber } from "@/core/format"
import { menuReport, type MenuReportRow } from "@/core/menu"
import { effectiveTaxSettings } from "@/core/sales-tax"
import type { AppServices } from "@/core/services"
import { workspaceTaxSettings } from "@/core/vat"
import { Amount } from "@/components/ui/amount"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { LoadingState } from "@/components/ui/page-header"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn, errorMessage, useLoader } from "@/lib/utils"

type Sort = "portions" | "margin" | "foodCost"
const SORTS: Record<Sort, { label: string; compare: (a: MenuReportRow, b: MenuReportRow) => number }> = {
  portions: { label: "Paling laku", compare: (a, b) => b.portions - a.portions },
  margin: { label: "Paling untung", compare: (a, b) => b.margin - a.margin },
  foodCost: { label: "Food cost tertinggi", compare: (a, b) => ratio(b.cost, b.revenue) - ratio(a.cost, a.revenue) },
}
const ratio = (part: number, whole: number) => (whole > 0 ? part / whole : 0)
const percent = new Intl.NumberFormat("id-ID", { style: "percent", maximumFractionDigits: 1 })

/** Laporan per menu (ROADMAP 8C): porsi, pendapatan, biaya bahan, margin. */
export function MenuReportTab({
  services,
  workspaceId,
  workspaceName,
  range,
}: {
  services: AppServices
  workspaceId: string
  workspaceName: string
  range: { fromDate: string; toDate: string }
}) {
  const data = useLoader(() => services.menuService.context(workspaceId), [services, workspaceId])
  const [sort, setSort] = useState<Sort>("portions")
  if (data.loading && !data.data) return <LoadingState />
  if (data.error) return <p role="alert" className="text-sm text-destructive">{errorMessage(data.error)}</p>
  const ctx = data.data!
  const tax = workspaceTaxSettings(ctx.workspace)
  const report = menuReport(ctx, range.fromDate, range.toDate, {
    valuation: ctx.workspace.stockValuation,
    tax: tax.rateBps > 0 ? effectiveTaxSettings(tax) : null,
  })
  const rows = [...report.rows].sort(SORTS[sort].compare)
  const best = [...report.rows].sort(SORTS.portions.compare)[0]
  const top = [...report.rows].sort(SORTS.margin.compare)[0]
  const { totals } = report

  function exportCsv() {
    const csv = toCsv([
      ["Menu", "Kode", "Porsi", "Porsi penjualan", "Porsi rekap", "Pendapatan", "Pendapatan estimasi", "Biaya bahan", "Margin", "Margin %", "Food cost %"],
      ...rows.map((r) => [
        r.menu?.name ?? "Menu terhapus",
        r.menu?.code ?? "",
        r.portions,
        r.salePortions,
        r.summaryPortions,
        r.revenue,
        r.estimatedRevenue,
        r.cost,
        r.margin,
        r.revenue > 0 ? (Math.round((r.margin / r.revenue) * 1000) / 10).toString().replace(".", ",") : "",
        r.revenue > 0 ? (Math.round((r.cost / r.revenue) * 1000) / 10).toString().replace(".", ",") : "",
      ]),
    ])
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }))
    const link = document.createElement("a")
    link.href = url
    link.download = `laporan-menu-${workspaceName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${range.fromDate}-${range.toDate}.csv`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  if (report.rows.length === 0) {
    return (
      <p className="flex gap-2 rounded-2xl bg-card px-4 py-6 text-sm text-muted-foreground">
        <InfoIcon className="mt-0.5 size-4 shrink-0" /> Belum ada porsi terjual pada periode ini. Isi Penjualan menu atau Rekap Porsi di Menu &amp; Resep.
      </p>
    )
  }

  return (
    <section className="grid gap-4 rounded-2xl bg-canvas p-5 ring-1 ring-border">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-semibold text-ink">Laporan per menu</h2>
          <p className="text-sm text-muted-foreground">
            {workspaceName} · {formatDate(range.fromDate)} – {formatDate(range.toDate)} · biaya bahan = resep berlaku × harga bahan per {formatDate(range.toDate)}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2 print:hidden">
          <div className="grid gap-1.5">
            <Label htmlFor="menu-report-sort">Urutkan</Label>
            <Select value={sort} onValueChange={(v) => setSort(v as Sort)}>
              <SelectTrigger id="menu-report-sort" className="w-48 bg-background"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(SORTS) as Sort[]).map((s) => <SelectItem key={s} value={s}>{SORTS[s].label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button variant="secondary" onClick={exportCsv}>
            <DownloadIcon data-icon="inline-start" /> Ekspor CSV
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Porsi terjual" value={formatNumber(totals.portions)} note={`${report.rows.length} menu`} />
        <Stat label="Pendapatan" value={<Amount value={totals.revenue} />} note={totals.estimatedRevenue > 0 ? "termasuk estimasi rekap" : "tanpa pajak"} />
        <Stat label="Biaya bahan" value={<Amount value={totals.cost} />} note={`food cost ${percent.format(ratio(totals.cost, totals.revenue))}`} />
        <Stat label="Margin kotor" value={<Amount value={totals.margin} />} note={percent.format(ratio(totals.margin, totals.revenue))} strong />
      </div>
      <p className="text-sm text-muted-foreground">
        Paling laku: <strong className="text-ink">{best.menu?.name ?? "—"}</strong> ({formatNumber(best.portions)} porsi) · Paling untung:{" "}
        <strong className="text-ink">{top.menu?.name ?? "—"}</strong> (<Amount value={top.margin} />)
      </p>
      {report.warnings.length > 0 && (
        <ul className="grid gap-1 text-sm text-ink">
          {report.warnings.map((w) => (
            <li key={w} className="flex gap-2"><TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-amber-700" />{w}</li>
          ))}
        </ul>
      )}

      <div className="overflow-x-auto rounded-2xl ring-1 ring-border">
        <table className="w-full min-w-[52rem] text-sm">
          <thead className="bg-card text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            <tr>
              <th className="px-4 py-2.5">Menu</th>
              <th className="px-3 py-2.5 text-right">Porsi</th>
              <th className="px-3 py-2.5 text-right">Pendapatan</th>
              <th className="px-3 py-2.5 text-right">Biaya bahan</th>
              <th className="px-3 py-2.5 text-right">Margin</th>
              <th className="px-3 py-2.5 text-right">Margin %</th>
              <th className="px-4 py-2.5 text-right">Food cost</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r) => {
              const foodCost = ratio(r.cost, r.revenue)
              return (
                <tr key={r.menuId}>
                  <td className="px-4 py-2">
                    <span className="font-medium text-ink">{r.menu?.name ?? "Menu terhapus"}</span>
                    <span className="block text-xs text-muted-foreground">
                      {[r.salePortions ? `${formatNumber(r.salePortions)} penjualan` : "", r.summaryPortions ? `${formatNumber(r.summaryPortions)} rekap` : ""].filter(Boolean).join(" · ")}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatNumber(r.portions)}</td>
                  <td className="px-3 py-2 text-right">
                    <Amount value={r.revenue} />
                    {r.estimatedRevenue > 0 && (
                      <span className="block text-xs text-muted-foreground">
                        * estimasi <Amount value={r.estimatedRevenue} />
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right"><Amount value={r.cost} /></td>
                  <td className={cn("px-3 py-2 text-right font-semibold", r.margin < 0 ? "text-destructive" : "text-ink")}><Amount value={r.margin} /></td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.revenue > 0 ? percent.format(r.margin / r.revenue) : "—"}</td>
                  <td className={cn("px-4 py-2 text-right tabular-nums", foodCost > 0.4 && "font-semibold text-amber-700")}>
                    {r.revenue > 0 ? percent.format(foodCost) : "—"}
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot className="border-t-2 border-ink bg-card font-bold text-ink">
            <tr>
              <td className="px-4 py-2.5">Total</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{formatNumber(totals.portions)}</td>
              <td className="px-3 py-2.5 text-right"><Amount value={totals.revenue} /></td>
              <td className="px-3 py-2.5 text-right"><Amount value={totals.cost} /></td>
              <td className="px-3 py-2.5 text-right"><Amount value={totals.margin} /></td>
              <td className="px-3 py-2.5 text-right tabular-nums">{percent.format(ratio(totals.margin, totals.revenue))}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{percent.format(ratio(totals.cost, totals.revenue))}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Pendapatan penjualan menu diambil dari jurnal (tanpa pajak). * Porsi dari Rekap Porsi dinilai porsi × harga jual menu saat ini
        (estimasi). Margin kotor = pendapatan − biaya bahan teoritis; food cost di atas 40% ditandai. Biaya aktual per bahan ada di Stok Opname &amp; COGS → Variance.
      </p>
    </section>
  )
}

function Stat({ label, value, note, strong }: { label: string; value: React.ReactNode; note?: string; strong?: boolean }) {
  return (
    <div className={cn("grid gap-1 rounded-2xl p-4 ring-1 ring-border", strong ? "bg-ink text-canvas ring-ink" : "bg-canvas")}>
      <span className={cn("text-xs", strong ? "text-canvas/70" : "text-muted-foreground")}>{label}</span>
      <span className="text-lg font-bold tabular-nums">{value}</span>
      {note && <span className={cn("text-xs", strong ? "text-canvas/70" : "text-muted-foreground")}>{note}</span>}
    </div>
  )
}
