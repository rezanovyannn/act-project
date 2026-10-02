"use client"

import { useState } from "react"
import { endOfMonth } from "@/core/dates"
import { formatDate, todayIsoDate } from "@/core/format"
import { buildItemStockOpname, type StockCount } from "@/core/perpetual"
import type { AppServices } from "@/core/services"
import { unitCostOf } from "@/core/stock"
import type { JournalEntry, JournalEntryInput } from "@/core/types"
import { Amount } from "@/components/ui/amount"
import { AmountInput } from "@/components/ui/amount-input"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { JournalPreview, PostedNotice } from "@/components/ui/journal-preview"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { errorMessage } from "@/lib/utils"
import { snapshotAt, type InventoryData } from "./use-inventory-data"

/** Stok opname per barang (persediaan perpetual, ADR 017). Baris kosong = tidak dihitung. */
export function ItemStockOpnameForm({
  services,
  data,
  journalHref,
  onPosted,
}: {
  services: AppServices
  data: InventoryData
  journalHref: (entryId: string) => string
  onPosted: () => void
}) {
  const { workspace, accounts, items } = data
  const [entryDate, setEntryDate] = useState(() => endOfMonth(todayIsoDate()))
  const [physical, setPhysical] = useState<Record<string, string>>({})
  const [unitCosts, setUnitCosts] = useState<Record<string, number | null>>({})
  const [error, setError] = useState<string | null>(null)
  const [posted, setPosted] = useState<JournalEntry | null>(null)
  const [saving, setSaving] = useState(false)

  const snapshot = snapshotAt(data, entryDate)
  const activeItems = items.filter((i) => i.isActive || (snapshot.context.stocks.get(i.id)?.qty ?? 0) !== 0)
  const counts: StockCount[] = activeItems
    .filter((i) => /^\d+$/.test(physical[i.id] ?? ""))
    .map((i) => ({ itemId: i.id, physicalQty: Number(physical[i.id]), unitCost: unitCosts[i.id] ?? null }))

  let result: { entry: JournalEntryInput | null; rows: { itemId: string; difference: number; value: number }[] } | null = null
  let previewError: string | null = null
  if (counts.length > 0) {
    try {
      result = buildItemStockOpname({ workspaceId: workspace.id, entryDate, counts }, snapshot.context)
    } catch (e) {
      previewError = errorMessage(e)
    }
  }
  const rowsById = new Map((result?.rows ?? []).map((r) => [r.itemId, r]))

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!result?.entry) return
    setSaving(true)
    setError(null)
    try {
      const entry = await services.journalService.postJournal(result.entry)
      setPosted(entry)
      setPhysical({})
      setUnitCosts({})
      onPosted()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-6">
      <div className="grid gap-4 rounded-2xl bg-canvas ring-1 ring-border p-4 sm:p-6">
        <div className="grid gap-2 sm:max-w-xs">
          <Label htmlFor="item-opname-date">Tanggal stok opname</Label>
          <Input id="item-opname-date" type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} required />
        </div>
        <p className="text-sm text-muted-foreground">
          Isi qty fisik barang yang dihitung (kosongkan yang tidak dihitung). Selisih dinilai dengan harga pokok
          per {formatDate(entryDate)} dan dibukukan ke HPP.
        </p>
        <div className="overflow-x-auto rounded-2xl bg-canvas ring-1 ring-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Barang</TableHead>
                <TableHead className="w-32 text-right">Stok buku</TableHead>
                <TableHead className="w-36">Qty fisik</TableHead>
                <TableHead className="w-28 text-right">Selisih</TableHead>
                <TableHead className="w-36 text-right">Nilai</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activeItems.map((item) => {
                const stock = snapshot.context.stocks.get(item.id)
                const book = stock?.qty ?? 0
                const row = rowsById.get(item.id)
                const needsUnitCost =
                  /^\d+$/.test(physical[item.id] ?? "") && Number(physical[item.id]) > book && !(stock && unitCostOf(stock))
                return (
                  <TableRow key={item.id}>
                    <TableCell>
                      <span className="font-medium text-ink">{item.name}</span>
                      <span className="block text-xs text-muted-foreground">{item.code} · {item.unit}</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{book.toLocaleString("id-ID")}</TableCell>
                    <TableCell>
                      <Input
                        aria-label={`Qty fisik ${item.name}`}
                        inputMode="numeric"
                        value={physical[item.id] ?? ""}
                        onChange={(e) => setPhysical({ ...physical, [item.id]: e.target.value.replace(/\D/g, "") })}
                      />
                      {needsUnitCost && (
                        <AmountInput
                          aria-label={`Harga pokok per ${item.unit} ${item.name}`}
                          placeholder={`HPP per ${item.unit}`}
                          className="mt-2"
                          value={unitCosts[item.id] ?? null}
                          onValueChange={(v) => setUnitCosts({ ...unitCosts, [item.id]: v })}
                        />
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{row ? row.difference.toLocaleString("id-ID") : ""}</TableCell>
                    <TableCell className="text-right">{row ? <Amount value={row.value} /> : ""}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      </div>
      <div className="grid gap-4 xl:max-w-xl">
        <JournalPreview lines={result?.entry?.lines ?? []} accounts={accounts} />
        {result && !result.entry && <p className="text-sm text-muted-foreground">Tidak ada selisih; tidak perlu jurnal.</p>}
        {previewError && <p className="text-sm text-destructive">{previewError}</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {posted && <PostedNotice entry={posted} href={journalHref(posted.id)} />}
        <Button type="submit" size="lg" className="w-fit" disabled={saving || !result?.entry}>
          {saving ? "Memposting…" : "Posting stok opname"}
        </Button>
      </div>
    </form>
  )
}
