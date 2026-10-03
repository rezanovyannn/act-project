"use client"

import { useState } from "react"
import { TriangleAlertIcon } from "lucide-react"
import { todayIsoDate } from "@/core/format"
import { buildItemPurchase } from "@/core/perpetual"
import { formatTaxSettings } from "@/core/sales-tax"
import type { AppServices } from "@/core/services"
import type { JournalEntry, JournalEntryInput } from "@/core/types"
import { computeInputVat, workspaceTaxSettings } from "@/core/vat"
import { Amount } from "@/components/ui/amount"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { InputVatField } from "@/components/ui/input-vat-field"
import { filledItemLines, ItemLinesField, newItemLine, type ItemLineState } from "@/components/ui/item-lines-field"
import { JournalPreview, PostedNotice } from "@/components/ui/journal-preview"
import { Label } from "@/components/ui/label"
import { PaymentField, initialPayment, toPayment, type PaymentState } from "@/components/ui/payment-field"
import { errorMessage } from "@/lib/utils"
import { backdateWarnings } from "./backdate"
import { snapshotAt, type InventoryData } from "./use-inventory-data"

/** Pembelian barang per item: perpetual (ADR 017) atau per bahan untuk COGS periodik (ADR 020). */
export function ItemPurchaseForm({
  services,
  data,
  noun,
  journalHref,
  onPosted,
}: {
  services: AppServices
  data: InventoryData
  noun: string
  journalHref: (entryId: string) => string
  onPosted: () => void
}) {
  const { workspace, accounts, items, journals } = data
  const cashAccounts = accounts.filter((a) => a.isCash && a.isActive)
  const suppliers = [...new Set(journals.filter((j) => j.source === "purchase").map((j) => j.counterparty).filter(Boolean) as string[])]
  const taxSettings = workspaceTaxSettings(workspace)
  const fullVat = taxSettings.mode === "full_vat"

  const [entryDate, setEntryDate] = useState(todayIsoDate)
  const [description, setDescription] = useState(`Pembelian ${noun}`)
  const [payment, setPayment] = useState<PaymentState>(() => initialPayment(cashAccounts))
  const [lines, setLines] = useState<ItemLineState[]>(() => [newItemLine()])
  const [vatEnabled, setVatEnabled] = useState(false)
  const [vatOverride, setVatOverride] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [posted, setPosted] = useState<JournalEntry | null>(null)
  const [saving, setSaving] = useState(false)

  const periodic = workspace.inventoryMethod === "periodic"
  const snapshot = snapshotAt(data, entryDate)
  // Periodik: stok per bahan tidak berjalan, jadi tanpa koreksi stok minus & sisa stok.
  const context = periodic ? { ...snapshot.context, stocks: new Map() } : snapshot.context
  const filled = filledItemLines(lines, true)
  const subtotal = filled.reduce((t, l) => t + l.amount, 0)
  const suggestedVat = fullVat ? computeInputVat(subtotal, taxSettings) : 0
  const inputVat = fullVat && vatEnabled ? (vatOverride ?? suggestedVat) : 0

  let preview: { entry: JournalEntryInput; warnings: string[] } | null = null
  let previewError: string | null = null
  if (filled.length > 0) {
    try {
      preview = buildItemPurchase(
        { workspaceId: workspace.id, entryDate, description, payment: toPayment(payment), lines: filled, inputVat },
        context,
      )
    } catch (e) {
      previewError = errorMessage(e)
    }
  }
  const warnings = [
    ...(preview?.warnings ?? []),
    ...(periodic ? [] : backdateWarnings(journals, accounts, items, filled.map((l) => l.itemId), entryDate)),
  ]

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!preview) return
    setSaving(true)
    setError(null)
    try {
      const entry = await services.journalService.postJournal(preview.entry)
      setPosted(entry)
      setLines([newItemLine()])
      setVatOverride(null)
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
      <div className="grid content-start gap-5 rounded-2xl bg-canvas ring-1 ring-border p-4 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
          <div className="grid gap-2">
            <Label htmlFor="item-purchase-date">Tanggal</Label>
            <Input id="item-purchase-date" type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="item-purchase-description">Keterangan</Label>
            <Input id="item-purchase-description" value={description} onChange={(e) => setDescription(e.target.value)} required />
          </div>
        </div>
        <PaymentField
          cashAccounts={cashAccounts}
          value={payment}
          onChange={setPayment}
          creditLabel="Kredit (utang ke pemasok)"
          counterpartyLabel="Pemasok"
          counterpartySuggestions={suppliers}
        />
        <ItemLinesField
          idPrefix="purchase"
          label="Barang dibeli"
          items={items}
          lines={lines}
          onChange={setLines}
          amountLabel={fullVat ? "Harga beli sebelum PPN" : "Harga beli"}
          stockQty={periodic ? undefined : (id) => snapshot.context.stocks.get(id)?.qty ?? 0}
        />
        {fullVat && (
          <InputVatField
            id="item-purchase-vat"
            enabled={vatEnabled}
            onEnabledChange={setVatEnabled}
            suggested={suggestedVat}
            override={vatOverride}
            onOverrideChange={setVatOverride}
            rateLabel={formatTaxSettings(taxSettings)}
          />
        )}
      </div>
      <div className="grid content-start gap-4">
        <div className="flex justify-between rounded-2xl bg-canvas p-4 text-sm font-bold text-ink ring-1 ring-border">
          <span>Total {payment.method === "credit" ? "utang" : "dibayar"}</span>
          <Amount value={subtotal + inputVat} />
        </div>
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
          {saving ? "Memposting…" : "Posting pembelian"}
        </Button>
      </div>
    </form>
  )
}
