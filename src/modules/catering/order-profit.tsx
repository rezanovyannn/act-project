"use client"

import Link from "next/link"
import { InfoIcon } from "lucide-react"
import { COST_CATEGORY_LABELS, costCategoriesFor, type OrderProfit, type OrderSummary } from "@/core/catering"
import { formatDate, formatPercentBps } from "@/core/format"
import type { CateringData } from "@/core/services/catering-service"
import { Amount } from "@/components/ui/amount"
import { cn } from "@/lib/utils"
import { OrderStatusBadge, type OrderRoutes } from "./orders-view"

const margin = (p: OrderProfit) => (p.marginBps === null ? "—" : formatPercentBps(p.marginBps))

/** Biaya & laba kotor satu pesanan: estimasi vs realisasi per kategori (Fase 10B). */
export function OrderProfitPanel({ data, profit, pax }: { data: CateringData; profit: OrderProfit; pax: number }) {
  const categories = costCategoriesFor(data.workspace.cateringSettings.costMode)
  const hasEstimate = profit.estimateTotal > 0
  return (
    <section className="grid content-start gap-2 rounded-2xl bg-canvas p-4 text-sm ring-1 ring-border">
      <h2 className="font-bold text-ink">Biaya & laba kotor</h2>
      <table className="w-full">
        <thead className="text-xs text-muted-foreground">
          <tr className="border-b">
            <th className="py-1.5 text-left font-medium">Kategori</th>
            {hasEstimate && <th className="py-1.5 text-right font-medium">Estimasi</th>}
            <th className="py-1.5 text-right font-medium">Realisasi</th>
            {hasEstimate && <th className="py-1.5 text-right font-medium">Selisih</th>}
          </tr>
        </thead>
        <tbody className="divide-y">
          {categories.map((c) => {
            const diff = profit.costs[c] - profit.estimates[c]
            return (
              <tr key={c}>
                <td className="py-1.5">{COST_CATEGORY_LABELS[c]}</td>
                {hasEstimate && <td className="py-1.5 text-right"><Amount value={profit.estimates[c]} /></td>}
                <td className="py-1.5 text-right"><Amount value={profit.costs[c]} /></td>
                {hasEstimate && (
                  <td className={cn("py-1.5 text-right", diff > 0 && "text-destructive")}>
                    {profit.estimates[c] === 0 && profit.costs[c] === 0 ? "—" : <Amount value={diff} />}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
        <tfoot className="font-semibold text-ink">
          <tr className="border-t-2">
            <td className="py-1.5">Total biaya</td>
            {hasEstimate && <td className="py-1.5 text-right"><Amount value={profit.estimateTotal} /></td>}
            <td className="py-1.5 text-right"><Amount value={profit.totalCost} /></td>
            {hasEstimate && <td className={cn("py-1.5 text-right", profit.totalCost > profit.estimateTotal && "text-destructive")}><Amount value={profit.totalCost - profit.estimateTotal} /></td>}
          </tr>
        </tfoot>
      </table>
      <dl className="mt-1 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 border-t pt-2">
        <dt className="text-muted-foreground">Pendapatan diakui (tanpa pajak)</dt><dd className="text-right"><Amount value={profit.revenue} /></dd>
        <dt className="font-semibold text-ink">Laba kotor</dt><dd className="text-right font-bold text-ink"><Amount value={profit.profit} /></dd>
        <dt className="text-muted-foreground">Margin · per pax</dt>
        <dd className="text-right">{margin(profit)} · <Amount value={profit.profitPerPax} /> ({pax} pax)</dd>
      </dl>
      {profit.revenue === 0 && (
        <p className="flex gap-2 text-xs text-muted-foreground"><InfoIcon className="mt-0.5 size-3.5 shrink-0" /> Pendapatan diakui saat pesanan diselesaikan; sebelum itu laba kotor masih negatif sebesar biaya yang sudah dikeluarkan.</p>
      )}
    </section>
  )
}

/** Daftar laba kotor per pesanan (Fase 10B). */
export function ProfitList({ data, summaries, profits, routes }: { data: CateringData; summaries: OrderSummary[]; profits: Map<string, OrderProfit>; routes: OrderRoutes }) {
  const rows = summaries
    .filter((s) => s.order.state !== "quotation")
    .map((s) => ({ s, p: profits.get(s.order.id)! }))
    .filter(({ s, p }) => s.order.state !== "cancelled" || p.revenue !== 0 || p.totalCost !== 0)
  const sum = (pick: (p: OrderProfit) => number) => rows.reduce((t, r) => t + pick(r.p), 0)
  const revenue = sum((p) => p.revenue)
  const profit = sum((p) => p.profit)
  const materialsOnly = data.workspace.cateringSettings.costMode === "materials"
  if (rows.length === 0) {
    return <p className="rounded-2xl bg-card px-4 py-6 text-center text-sm text-muted-foreground">Belum ada pesanan dikonfirmasi atau selesai.</p>
  }
  return (
    <div className="grid gap-3">
      <div className="overflow-x-auto rounded-2xl bg-canvas ring-1 ring-border">
        <table className="w-full min-w-[58rem] text-sm">
          <thead className="bg-card text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            <tr>
              <th className="px-4 py-2.5">Pesanan</th>
              <th className="px-3 py-2.5">Klien</th>
              <th className="px-3 py-2.5 text-right">Pendapatan</th>
              <th className="px-3 py-2.5 text-right">Estimasi biaya</th>
              <th className="px-3 py-2.5 text-right">{materialsOnly ? "Biaya bahan" : "Biaya"}</th>
              <th className="px-3 py-2.5 text-right">Laba kotor</th>
              <th className="px-3 py-2.5 text-right">Margin</th>
              <th className="px-3 py-2.5 text-right">Per pax</th>
              <th className="px-4 py-2.5">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map(({ s, p }) => (
              <tr key={s.order.id}>
                <td className="px-4 py-2.5">
                  <Link href={routes.order(s.order.id)} className="font-semibold text-ink hover:underline">{s.order.number}</Link>
                  <span className="block text-xs text-muted-foreground">{formatDate(s.order.eventDate)} · {s.order.pax} pax</span>
                </td>
                <td className="px-3 py-2.5 text-ink">{data.contacts.find((c) => c.id === s.order.contactId)?.name ?? "—"}</td>
                <td className="px-3 py-2.5 text-right"><Amount value={p.revenue} /></td>
                <td className="px-3 py-2.5 text-right">{p.estimateTotal > 0 ? <Amount value={p.estimateTotal} /> : "—"}</td>
                <td className={cn("px-3 py-2.5 text-right", p.estimateTotal > 0 && p.totalCost > p.estimateTotal && "text-destructive")}><Amount value={p.totalCost} /></td>
                <td className="px-3 py-2.5 text-right font-semibold"><Amount value={p.profit} /></td>
                <td className="px-3 py-2.5 text-right tabular-nums">{margin(p)}</td>
                <td className="px-3 py-2.5 text-right"><Amount value={p.profitPerPax} /></td>
                <td className="px-4 py-2.5"><OrderStatusBadge status={s.status} /></td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 bg-card font-semibold text-ink">
            <tr>
              <td className="px-4 py-2.5" colSpan={2}>Total</td>
              <td className="px-3 py-2.5 text-right"><Amount value={revenue} /></td>
              <td className="px-3 py-2.5 text-right"><Amount value={sum((p) => p.estimateTotal)} /></td>
              <td className="px-3 py-2.5 text-right"><Amount value={sum((p) => p.totalCost)} /></td>
              <td className="px-3 py-2.5 text-right"><Amount value={profit} /></td>
              <td className="px-3 py-2.5 text-right tabular-nums">{revenue > 0 ? formatPercentBps(Math.round((profit * 10_000) / revenue)) : "—"}</td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Dihitung dari jurnal bertag pesanan: pendapatan (setelah diskon, tanpa pajak, termasuk DP hangus) dikurangi biaya yang dicatat ke pesanan.
        {materialsOnly ? " Mode biaya bahan baku saja: hanya HPP bahan yang dihitung." : " Bahan baku langsung HPP; biaya lain menurut akun bebannya."}
      </p>
    </div>
  )
}
