"use client"

import { useState } from "react"
import { TriangleAlertIcon } from "lucide-react"
import { todayIsoDate } from "@/core/format"
import { buildItemSale, type ItemSaleResult } from "@/core/perpetual"
import { effectiveTaxSettings, formatTaxSettings } from "@/core/sales-tax"
import type { AppServices } from "@/core/services"
import { buildSnapshot } from "@/core/services/inventory-service"
import { stockMovements } from "@/core/stock"
import type { JournalEntry } from "@/core/types"
import { workspaceTaxSettings } from "@/core/vat"
import { Amount } from "@/components/ui/amount"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { filledItemLines, ItemLinesField, newItemLine, type ItemLineState } from "@/components/ui/item-lines-field"
import { JournalPreview, PostedNotice } from "@/components/ui/journal-preview"
import { Label } from "@/components/ui/label"
import { PaymentField, initialPayment, toPayment, type PaymentState } from "@/components/ui/payment-field"
import { Switch } from "@/components/ui/switch"
import { errorMessage } from "@/lib/utils"
import { activeAccounts, counterpartyNames, type WorkspaceData } from "./use-workspace-data"

/**
 * Penjualan barang (persediaan perpetual, ADR 017): pendapatan ke akun default
 * barang, HPP & pengurangan stok per barang dibuat otomatis.
 */
export function ItemSaleForm({
  services,
  data,
  journalHref,
  onPosted,
}: {
  services: AppServices
  data: WorkspaceData
  journalHref: (entryId: string) => string
  onPosted: () => void
}) {
  const { workspace, accounts, journals, items } = data
  const cashAccounts = activeAccounts(accounts, (a) => a.isCash)
  const workspaceTax = workspaceTaxSettings(workspace)
  const sellable = items.filter((i) => i.revenueAccountId)

  const [entryDate, setEntryDate] = useState(todayIsoDate)
  const [description, setDescription] = useState("Penjualan barang")
  const [payment, setPayment] = useState<PaymentState>(() => initialPayment(cashAccounts))
  const [lines, setLines] = useState<ItemLineState[]>(() => [newItemLine()])
  const [applyTax, setApplyTax] = useState(workspace.salesTaxRateBps > 0)
  const [error, setError] = useState<string | null>(null)
  const [posted, setPosted] = useState<JournalEntry | null>(null)
  const [saving, setSaving] = useState(false)

  const snapshot = buildSnapshot(workspace, accounts, items, journals, entryDate)
  const filled = filledItemLines(lines, true)
  let preview: ItemSaleResult | null = null
  let previewError: string | null = null
  if (filled.length > 0) {
    try {
      preview = buildItemSale(
        {
          workspaceId: workspace.id,
          entryDate,
          description,
          payment: toPayment(payment),
          lines: filled,
          applyTax,
          tax: effectiveTaxSettings(workspaceTax),
          taxLabel: workspace.salesTaxLabel,
        },
        snapshot.context,
      )
    } catch (e) {
      previewError = errorMessage(e)
    }
  }
  const later = new Set(
    stockMovements(journals, accounts)
      .filter((m) => m.entryDate > entryDate)
      .map((m) => m.itemId),
  )
  const warnings = [
    ...(preview?.warnings ?? []),
    ...filled
      .filter((l) => later.has(l.itemId))
      .map((l) => `${items.find((i) => i.id === l.itemId)?.name}: sudah ada transaksi sesudah tanggal ini; HPP transaksi tersebut tidak dihitung ulang`),
  ]

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!preview) return
    setSaving(true)
    setError(null)
    try {
      setPosted(await services.journalService.postJournal(preview.entry))
      setLines([newItemLine()])
      setPayment((p) => ({ ...p, counterparty: "" }))
      onPosted()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_26rem]">
      <div className="grid content-start gap-5 rounded-[24px] bg-canvas ring-1 ring-border p-4 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
          <div className="grid gap-2">
            <Label htmlFor="item-sale-date">Tanggal</Label>
            <Input id="item-sale-date" type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="item-sale-description">Keterangan</Label>
            <Input id="item-sale-description" value={description} onChange={(e) => setDescription(e.target.value)} required />
          </div>
        </div>
        <PaymentField
          cashAccounts={cashAccounts}
          value={payment}
          onChange={setPayment}
          creditLabel="Kredit (piutang pelanggan)"
          counterpartyLabel="Pelanggan"
          counterpartySuggestions={counterpartyNames(journals)}
        />
        <ItemLinesField
          idPrefix="sale"
          label="Barang dijual"
          items={sellable}
          lines={lines}
          onChange={setLines}
          amountLabel={workspace.salesTaxInclusive && applyTax ? `Harga jual (termasuk ${workspace.salesTaxLabel})` : "Harga jual"}
          stockQty={(id) => snapshot.context.stocks.get(id)?.qty ?? 0}
        />
        <label className="flex items-center gap-3 text-sm">
          <Switch checked={applyTax} onCheckedChange={setApplyTax} disabled={workspace.salesTaxRateBps === 0} />
          <span>Kenakan {formatTaxSettings(workspaceTax)}</span>
        </label>
      </div>
      <div className="grid content-start gap-4">
        <dl className="grid gap-2 rounded-2xl bg-canvas p-4 text-sm ring-1 ring-border">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Pendapatan</dt>
            <dd><Amount value={preview?.sale.base ?? 0} /></dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{workspace.salesTaxLabel}</dt>
            <dd><Amount value={preview?.sale.tax ?? 0} /></dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">HPP barang</dt>
            <dd><Amount value={preview?.totalCost ?? 0} /></dd>
          </div>
          <div className="flex justify-between border-t pt-2 font-bold text-ink">
            <dt>Total {payment.method === "credit" ? "piutang" : "diterima"}</dt>
            <dd><Amount value={preview?.sale.total ?? 0} /></dd>
          </div>
        </dl>
        {warnings.length > 0 && (
          <ul className="grid gap-1 text-sm text-ink">
            {warnings.map((w) => (
              <li key={w} className="flex gap-2"><TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />{w}</li>
            ))}
          </ul>
        )}
        <JournalPreview lines={preview?.entry.lines ?? []} accounts={accounts} />
        {previewError && <p className="text-sm text-destructive">{previewError}</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {posted && <PostedNotice entry={posted} href={journalHref(posted.id)} />}
        <Button type="submit" size="lg" disabled={saving || !preview}>
          {saving ? "Memposting…" : "Posting penjualan barang"}
        </Button>
      </div>
    </form>
  )
}
