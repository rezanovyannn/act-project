"use client"

import { useState } from "react"
import { todayIsoDate } from "@/core/format"
import { effectiveTaxSettings, formatTaxSettings } from "@/core/sales-tax"
import type { AppServices } from "@/core/services"
import { buildSale, type SalePreview } from "@/core/transactions"
import type { JournalEntry } from "@/core/types"
import { workspaceTaxSettings } from "@/core/vat"
import { Amount } from "@/components/ui/amount"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { JournalPreview, PostedNotice } from "@/components/ui/journal-preview"
import { Label } from "@/components/ui/label"
import { PaymentField, initialPayment, toPayment, type PaymentState } from "@/components/ui/payment-field"
import { Switch } from "@/components/ui/switch"
import { errorMessage } from "@/lib/utils"
import { AmountItemsField, newItem, toAmountItems, type ItemState } from "./amount-items-field"
import { activeAccounts, counterpartyNames, type WorkspaceData } from "./use-workspace-data"

export function SaleForm({
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
  const { workspace, accounts, journals } = data
  const cashAccounts = activeAccounts(accounts, (a) => a.isCash)
  const revenueAccounts = activeAccounts(accounts, (a) => a.accountType === "revenue")
  const workspaceTax = workspaceTaxSettings(workspace)
  const taxSettings = effectiveTaxSettings(workspaceTax)

  const [entryDate, setEntryDate] = useState(todayIsoDate)
  const [description, setDescription] = useState("Penjualan")
  const [payment, setPayment] = useState<PaymentState>(() => initialPayment(cashAccounts))
  const [items, setItems] = useState<ItemState[]>(() => [newItem(revenueAccounts[0]?.id)])
  const [applyTax, setApplyTax] = useState(workspace.salesTaxRateBps > 0)
  const [error, setError] = useState<string | null>(null)
  const [posted, setPosted] = useState<JournalEntry | null>(null)
  const [saving, setSaving] = useState(false)

  const build = (): SalePreview =>
    buildSale(
      {
        workspaceId: workspace.id,
        entryDate,
        description,
        payment: toPayment(payment),
        items: toAmountItems(items),
        applyTax,
        tax: taxSettings,
        taxLabel: workspace.salesTaxLabel,
      },
      accounts,
    )

  let preview: SalePreview | null = null
  try {
    preview = build()
  } catch {
    preview = null
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const entry = await services.journalService.postJournal(build().entry)
      setPosted(entry)
      setItems([newItem(revenueAccounts[0]?.id)])
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
      <div className="grid gap-5 rounded-2xl bg-canvas ring-1 ring-border p-4 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
          <div className="grid gap-2">
            <Label htmlFor="sale-date">Tanggal</Label>
            <Input id="sale-date" type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="sale-description">Keterangan</Label>
            <Input id="sale-description" value={description} onChange={(e) => setDescription(e.target.value)} required />
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
        <AmountItemsField
          label={workspace.salesTaxInclusive && applyTax ? `Rincian penjualan (harga termasuk ${workspace.salesTaxLabel})` : "Rincian penjualan"}
          accounts={revenueAccounts}
          items={items}
          onChange={setItems}
        />
        <label className="flex items-center gap-3 text-sm">
          <Switch checked={applyTax} onCheckedChange={setApplyTax} disabled={workspace.salesTaxRateBps === 0} />
          <span>
            Kenakan {formatTaxSettings(workspaceTax)} ·{" "}
            <span className="text-muted-foreground">
              harga {workspace.salesTaxInclusive ? "sudah" : "belum"} termasuk {workspace.salesTaxLabel}
            </span>
          </span>
        </label>
      </div>

      <div className="grid content-start gap-4">
        <dl className="grid gap-2 rounded-2xl bg-canvas p-4 text-sm ring-1 ring-border">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Dasar pengenaan</dt>
            <dd><Amount value={preview?.base ?? 0} /></dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{workspace.salesTaxLabel}</dt>
            <dd><Amount value={preview?.tax ?? 0} /></dd>
          </div>
          <div className="flex justify-between border-t pt-2 font-bold text-ink">
            <dt>Total {payment.method === "credit" ? "piutang" : "diterima"}</dt>
            <dd><Amount value={preview?.total ?? 0} /></dd>
          </div>
        </dl>
        <JournalPreview lines={preview?.entry.lines ?? []} accounts={accounts} />
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {posted && <PostedNotice entry={posted} href={journalHref(posted.id)} />}
        <Button type="submit" size="lg" disabled={saving || !preview}>
          {saving ? "Memposting…" : "Posting penjualan"}
        </Button>
      </div>
    </form>
  )
}
