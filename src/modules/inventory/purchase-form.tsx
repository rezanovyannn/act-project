"use client"

import { useState } from "react"
import { capitalizeWords, todayIsoDate } from "@/core/format"
import { formatTaxSettings, type WorkspaceTaxSettings } from "@/core/sales-tax"
import type { AppServices } from "@/core/services"
import { computeInputVat, workspaceTaxSettings } from "@/core/vat"
import type { Account, JournalEntry, JournalEntryInput } from "@/core/types"
import { AmountInput } from "@/components/ui/amount-input"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { InputVatField } from "@/components/ui/input-vat-field"
import { JournalPreview, PostedNotice } from "@/components/ui/journal-preview"
import { Label } from "@/components/ui/label"
import { LoadingState, PageHeader } from "@/components/ui/page-header"
import { PaymentField, initialPayment, toPayment, type PaymentState } from "@/components/ui/payment-field"
import { errorMessage, useLoader } from "@/lib/utils"
import { buildInventoryPurchase } from "@/core/inventory"


/** Pembelian persediaan (tunai/kredit) ke akun persediaan, semua template (ADR 007 & 015). */
export function PurchaseView({
  services,
  workspaceId,
  journalHref,
}: {
  services: AppServices
  workspaceId: string
  journalHref: (entryId: string) => string
}) {
  const data = useLoader(async () => {
    const [workspace, accounts, journals] = await Promise.all([
      services.workspaces.getById(workspaceId),
      services.accounts.listByWorkspace(workspaceId),
      services.journals.listByWorkspace(workspaceId),
    ])
    if (!workspace) throw new Error("Workspace tidak ditemukan")
    return {
      noun: services.workspaceService.templateOf(workspace.templateType).inventoryNoun,
      taxSettings: workspaceTaxSettings(workspace),
      accounts,
      journals,
    }
  }, [services, workspaceId])

  if (data.loading && !data.data) return <LoadingState />
  if (data.error) return <p role="alert" className="text-sm text-destructive">{errorMessage(data.error)}</p>
  const { noun, taxSettings, accounts, journals } = data.data!
  const inventoryName = accounts.find((a) => a.systemRole === "inventory")?.name ?? "Persediaan"
  const suppliers = [...new Set(journals.filter((j) => j.source === "purchase").map((j) => j.counterparty).filter(Boolean) as string[])]

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader
        title={`Pembelian ${capitalizeWords(noun)}`}
        description={`Dicatat sebagai ${inventoryName} (aset). HPP diakui saat stok opname akhir periode.`}
      />
      <PurchaseForm
        services={services}
        workspaceId={workspaceId}
        accounts={accounts}
        noun={noun}
        taxSettings={taxSettings}
        suppliers={suppliers}
        journalHref={journalHref}
        onPosted={data.reload}
      />
    </div>
  )
}

function PurchaseForm({
  services,
  workspaceId,
  accounts,
  noun,
  taxSettings,
  suppliers,
  journalHref,
  onPosted,
}: {
  services: AppServices
  workspaceId: string
  accounts: Account[]
  noun: string
  taxSettings: WorkspaceTaxSettings
  suppliers: string[]
  journalHref: (entryId: string) => string
  onPosted: () => void
}) {
  const cashAccounts = accounts.filter((a) => a.isCash && a.isActive)
  const [entryDate, setEntryDate] = useState(todayIsoDate)
  const [description, setDescription] = useState(`Pembelian ${noun}`)
  const [payment, setPayment] = useState<PaymentState>(() => initialPayment(cashAccounts))
  const [amount, setAmount] = useState<number | null>(0)
  const [vatEnabled, setVatEnabled] = useState(false)
  const [vatOverride, setVatOverride] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [posted, setPosted] = useState<JournalEntry | null>(null)
  const [saving, setSaving] = useState(false)

  const fullVat = taxSettings.mode === "full_vat"
  const suggestedVat = fullVat ? computeInputVat(amount ?? 0, taxSettings) : 0
  const inputVat = fullVat && vatEnabled ? (vatOverride ?? suggestedVat) : 0

  const build = (): JournalEntryInput =>
    buildInventoryPurchase(
      { workspaceId, entryDate, description, payment: toPayment(payment), amount: amount ?? 0, inputVat },
      accounts,
    )
  let preview: JournalEntryInput | null = null
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
      const entry = await services.journalService.postJournal(build())
      setPosted(entry)
      setAmount(0)
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
      <div className="grid content-start gap-5 rounded-lg bg-card p-4 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
          <div className="grid gap-2">
            <Label htmlFor="purchase-date">Tanggal</Label>
            <Input id="purchase-date" type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="purchase-description">Keterangan</Label>
            <Input id="purchase-description" value={description} onChange={(e) => setDescription(e.target.value)} required />
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
        <div className="grid gap-2 sm:max-w-xs">
          <Label htmlFor="purchase-amount">{fullVat ? "Total pembelian (sebelum PPN)" : "Total pembelian"}</Label>
          <AmountInput id="purchase-amount" value={amount} onValueChange={setAmount} />
        </div>
        {fullVat && (
          <InputVatField
            id="purchase-vat"
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
        <JournalPreview lines={preview?.lines ?? []} accounts={accounts} />
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {posted && <PostedNotice entry={posted} href={journalHref(posted.id)} />}
        <Button type="submit" size="lg" disabled={saving || !preview}>
          {saving ? "Memposting…" : "Posting pembelian"}
        </Button>
      </div>
    </form>
  )
}
