"use client"

import Link from "next/link"
import { InfoIcon, TriangleAlertIcon } from "lucide-react"
import { formatDate, formatNumber } from "@/core/format"
import { fractionToNumber, type VarianceRow } from "@/core/menu"
import type { AppServices } from "@/core/services"
import { mulDivRound } from "@/core/stock"
import { sectionOf, type CountContext } from "@/core/stock-count"
import type { Workspace } from "@/core/types"
import { Amount } from "@/components/ui/amount"
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

const qtyFormat = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 })
const percent = new Intl.NumberFormat("id-ID", { style: "percent", maximumFractionDigits: 1, signDisplay: "exceptZero" })
const signed = (n: number) => (n > 0 ? `+${qtyFormat.format(n)}` : qtyFormat.format(n))

function groupBySection(rows: VarianceRow[]): [string, VarianceRow[]][] {
  const groups = new Map<string, VarianceRow[]>()
  for (const row of rows) {
    const key = sectionOf(row.item)
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  return [...groups]
}

/** Variance Theoretical (porsi × resep) vs Actual (COGS stok opname) per bahan, ADR 021. */
export function VarianceView({
  services,
  context,
  selectedId,
  onSelect,
  menusHref,
}: {
  services: AppServices
  context: CountContext & { workspace: Workspace }
  selectedId: string | null
  onSelect: (id: string) => void
  menusHref: string
}) {
  const counts = [...context.counts].sort((a, b) => b.countDate.localeCompare(a.countDate))
  const count = counts.find((c) => c.id === selectedId) ?? counts[0]
  const analysis = useLoader(
    () => (count ? services.menuService.variance(context.workspace.id, count.id) : Promise.resolve(null)),
    [services, context, count?.id],
  )

  if (!count) {
    return <p className="rounded-2xl bg-card px-4 py-6 text-center text-sm text-muted-foreground">Belum ada stok opname. Variance dihitung per periode stok opname.</p>
  }
  if (analysis.loading && !analysis.data) return <LoadingState />
  if (analysis.error) return <p role="alert" className="text-sm text-destructive">{errorMessage(analysis.error)}</p>
  const result = analysis.data!
  if (result.count.id !== count.id) return <LoadingState />
  const { totals } = result
  const portions = result.menus.reduce((t, m) => t + m.portions, 0)
  const summaryPortions = result.menus.reduce((t, m) => t + m.summaryPortions, 0)
  const ratio = totals.theoretical === 0 ? null : totals.variance / totals.theoretical

  return (
    <section className="grid gap-4 rounded-2xl bg-canvas p-5 ring-1 ring-border">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-semibold text-ink">Variance theoretical vs actual</h2>
          <p className="text-sm text-muted-foreground">
            Periode {result.previous ? `setelah ${formatDate(result.previous.countDate)}` : "awal"} s.d. {formatDate(count.countDate)} ·
            Theoretical = porsi terjual × resep berlaku × harga stok opname · Actual = COGS stok opname · Variance = Actual − Theoretical
          </p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="variance-count">Stok opname</Label>
          <Select value={count.id} onValueChange={onSelect}>
            <SelectTrigger id="variance-count" className="w-48 bg-background"><SelectValue /></SelectTrigger>
            <SelectContent>
              {counts.map((c) => <SelectItem key={c.id} value={c.id}>{formatDate(c.countDate)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Theoretical cost" value={<Amount value={totals.theoretical} />} />
        <Stat label="Actual cost (COGS)" value={<Amount value={totals.actual} />} />
        <Stat
          label="Variance"
          strong
          value={<Amount value={totals.variance} />}
          note={ratio === null ? "—" : `${percent.format(ratio)} dari theoretical`}
        />
      </div>

      <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
        <InfoIcon className="size-4" />
        {portions === 0 ? (
          <>Belum ada porsi terjual pada periode ini.</>
        ) : (
          <>
            {formatNumber(portions)} porsi: {formatNumber(summaryPortions)} dari rekap, {formatNumber(portions - summaryPortions)} dari penjualan menu.
          </>
        )}
        <Link href={menusHref} className="underline underline-offset-4">Menu &amp; Resep</Link>
      </p>
      {result.warnings.length > 0 && (
        <ul className="grid gap-1 text-sm text-ink">
          {result.warnings.map((w) => (
            <li key={w} className="flex gap-2"><TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-amber-700" />{w}</li>
          ))}
        </ul>
      )}

      <div className="overflow-x-auto rounded-2xl ring-1 ring-border">
        <table className="w-full min-w-[48rem] text-sm">
          <thead className="bg-card text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            <tr>
              <th className="px-4 py-2.5">Bahan</th>
              <th className="px-3 py-2.5 text-right">Theoretical</th>
              <th className="px-3 py-2.5 text-right">Actual</th>
              <th className="px-4 py-2.5 text-right">Variance</th>
            </tr>
          </thead>
          {groupBySection(result.rows).map(([section, group]) => (
            <tbody key={section} className="divide-y border-t">
              <tr className="bg-card/60">
                <th colSpan={4} scope="rowgroup" className="px-4 py-2 text-left text-xs font-bold tracking-wide text-ink uppercase">{section}</th>
              </tr>
              {group.map((r) => {
                const over = r.variance.value > 0
                const under = r.variance.value < 0
                return (
                  <tr key={r.item.id}>
                    <td className="px-4 py-2">
                      <span className="font-medium text-ink">{r.item.name}</span>
                      <span className="block text-xs text-muted-foreground">{r.item.code}</span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Amount value={r.theoretical.value} />
                      <span className="block text-xs text-muted-foreground tabular-nums">{qtyFormat.format(fractionToNumber(r.theoretical.qty))} {r.item.unit}</span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Amount value={r.actual.value} />
                      <span className="block text-xs text-muted-foreground tabular-nums">{formatNumber(r.actual.qty)} {r.item.unit}</span>
                    </td>
                    <td className={cn("px-4 py-2 text-right", over && "text-destructive", under && "text-success-deep")}>
                      <span className="font-semibold"><Amount value={r.variance.value} /></span>
                      <span className="block text-xs tabular-nums">
                        {signed(r.variance.qty)} {r.item.unit}
                        {r.ratio !== null && ` · ${percent.format(r.ratio)}`}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          ))}
          <tfoot className="border-t-2 border-ink bg-card font-bold text-ink">
            <tr>
              <td className="px-4 py-2.5">Total</td>
              <td className="px-3 py-2.5 text-right"><Amount value={totals.theoretical} /></td>
              <td className="px-3 py-2.5 text-right"><Amount value={totals.actual} /></td>
              <td className="px-4 py-2.5 text-right"><Amount value={totals.variance} /></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Variance positif (merah) = pemakaian melebihi resep (boros, susut, rusak, porsi berlebih, atau penjualan belum tercatat);
        negatif (hijau) = pemakaian di bawah resep (resep terlalu besar atau sisa terhitung lebih).
      </p>

      {result.menus.length > 0 && (
        <div className="grid gap-2">
          <h3 className="text-sm font-semibold text-ink">Theoretical cost per menu</h3>
          <div className="overflow-x-auto rounded-2xl ring-1 ring-border">
            <table className="w-full min-w-[36rem] text-sm">
              <thead className="bg-card text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                <tr>
                  <th className="px-4 py-2.5">Menu</th>
                  <th className="px-3 py-2.5 text-right">Porsi</th>
                  <th className="px-3 py-2.5 text-right">Biaya/porsi</th>
                  <th className="px-4 py-2.5 text-right">Theoretical cost</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {result.menus.map((m) => {
                  const costed = m.portions - m.noRecipePortions
                  return (
                    <tr key={m.menuId}>
                      <td className="px-4 py-2">
                        <span className="font-medium text-ink">{m.menu?.name ?? "Menu terhapus"}</span>
                        <span className="block text-xs text-muted-foreground">
                          {[m.summaryPortions ? `${formatNumber(m.summaryPortions)} rekap` : "", m.salePortions ? `${formatNumber(m.salePortions)} penjualan` : ""].filter(Boolean).join(" · ")}
                          {m.noRecipePortions > 0 && <span className="text-amber-700"> · {formatNumber(m.noRecipePortions)} tanpa resep</span>}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatNumber(m.portions)}</td>
                      <td className="px-3 py-2 text-right">{costed > 0 ? <Amount value={mulDivRound(m.cost, 1, costed)} /> : "—"}</td>
                      <td className="px-4 py-2 text-right font-semibold"><Amount value={m.cost} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
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
