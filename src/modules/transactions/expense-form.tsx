"use client"

import { useState } from "react"
import { todayIsoDate } from "@/core/format"
import type { AppServices } from "@/core/services"
import { formatTaxSettings } from "@/core/sales-tax"
import { buildExpense } from "@/core/transactions"
import { computeInputVat, workspaceTaxSettings } from "@/core/vat"
import type { JournalEntry, JournalEntryInput } from "@/core/types"
import { Amount } from "@/components/ui/amount"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { InputVatField } from "@/components/ui/input-vat-field"
import { JournalPreview, PostedNotice } from "@/components/ui/journal-preview"
import { Label } from "@/components/ui/label"
import { PaymentField, initialPayment, toPayment, type PaymentState } from "@/components/ui/payment-field"
import { errorMessage } from "@/lib/utils"
import { AmountItemsField, newItem, toAmountItems, type ItemState } from "./amount-items-field"
import { activeAccounts, counterpartyNames, type WorkspaceData } from "./use-workspace-data"

export function ExpenseForm({
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
  const expenseAccounts = activeAccounts(accounts, (a) => a.accountType === "expense")

  const [entryDate, setEntryDate] = useState(todayIsoDate)
  const [description, setDescription] = useState("")
  const [payment, setPayment] = useState<PaymentState>(() => initialPayment(cashAccounts))
  const [items, setItems] = useState<ItemState[]>(() => [newItem()])
  const [vatEnabled, setVatEnabled] = useState(false)
  const [vatOverride, setVatOverride] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [posted, setPosted] = useState<JournalEntry | null>(null)
  const [saving, setSaving] = useState(false)

  const taxSettings = workspaceTaxSettings(workspace)
  const fullVat = taxSettings.mode === "full_vat"
  const subtotal = items.reduce((sum, i) => sum + (i.amount ?? 0), 0)
  const suggestedVat = fullVat ? computeInputVat(subtotal, taxSettings) : 0
  const inputVat = fullVat && vatEnabled ? (vatOverride ?? suggestedVat) : 0

  const build = (): JournalEntryInput =>
    buildExpense(
      { workspaceId: workspace.id, entryDate, description, payment: toPayment(payment), items: toAmountItems(items), inputVat },
      accounts,
    )

  let preview: JournalEntryInput | null = null
  try {
    preview = build()
  } catch {
    preview = null
  }
  const total = subtotal + inputVat

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const entry = await services.journalService.postJournal(build())
      setPosted(entry)
      setItems([newItem()])
      setVatOverride(null)
      setDescription("")
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
            <Label htmlFor="expense-date">Tanggal</Label>
            <Input id="expense-date" type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="expense-description">Keterangan</Label>
            <Input
              id="expense-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="mis. Bayar listrik September"
              required
            />
          </div>
        </div>
        <PaymentField
          cashAccounts={cashAccounts}
          value={payment}
          onChange={setPayment}
          creditLabel="Kredit (utang ke pemasok)"
          counterpartyLabel="Pemasok"
          counterpartySuggestions={counterpartyNames(journals)}
        />
        <AmountItemsField
          label={fullVat ? "Rincian beban (harga sebelum PPN)" : "Rincian beban"}
          accounts={expenseAccounts}
          items={items}
          onChange={setItems}
        />
        {fullVat && (
          <InputVatField
            id="expense-vat"
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
          <Amount value={total} />
        </div>
        <JournalPreview lines={preview?.lines ?? []} accounts={accounts} />
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {posted && <PostedNotice entry={posted} href={journalHref(posted.id)} />}
        <Button type="submit" size="lg" disabled={saving || !preview || description.trim() === ""}>
          {saving ? "Memposting…" : "Posting beban"}
        </Button>
      </div>
    </form>
  )
}
