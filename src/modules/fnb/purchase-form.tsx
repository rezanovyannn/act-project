"use client"

import { useState } from "react"
import { todayIsoDate } from "@/core/format"
import type { AppServices } from "@/core/services"
import type { Account, JournalEntry, JournalEntryInput } from "@/core/types"
import { AmountInput } from "@/components/ui/amount-input"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { JournalPreview, PostedNotice } from "@/components/ui/journal-preview"
import { Label } from "@/components/ui/label"
import { LoadingState, PageHeader } from "@/components/ui/page-header"
import { PaymentField, initialPayment, toPayment, type PaymentState } from "@/components/ui/payment-field"
import { errorMessage, useLoader } from "@/lib/utils"
import { buildRawMaterialPurchase } from "./transactions"

/** Pembelian bahan baku (tunai/kredit) ke Persediaan Bahan Baku (ADR 007). */
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
    const [accounts, journals] = await Promise.all([
      services.accounts.listByWorkspace(workspaceId),
      services.journals.listByWorkspace(workspaceId),
    ])
    return { accounts, journals }
  }, [services, workspaceId])

  if (data.loading && !data.data) return <LoadingState />
  if (data.error) return <p role="alert" className="text-sm text-destructive">{errorMessage(data.error)}</p>
  const { accounts, journals } = data.data!
  const suppliers = [...new Set(journals.filter((j) => j.source === "purchase").map((j) => j.counterparty).filter(Boolean) as string[])]

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader
        title="Pembelian Bahan Baku"
        description="Dicatat sebagai Persediaan Bahan Baku (aset). HPP diakui saat stok opname akhir periode."
      />
      <PurchaseForm
        services={services}
        workspaceId={workspaceId}
        accounts={accounts}
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
  suppliers,
  journalHref,
  onPosted,
}: {
  services: AppServices
  workspaceId: string
  accounts: Account[]
  suppliers: string[]
  journalHref: (entryId: string) => string
  onPosted: () => void
}) {
  const cashAccounts = accounts.filter((a) => a.isCash && a.isActive)
  const [entryDate, setEntryDate] = useState(todayIsoDate)
  const [description, setDescription] = useState("Pembelian bahan baku")
  const [payment, setPayment] = useState<PaymentState>(() => initialPayment(cashAccounts))
  const [amount, setAmount] = useState<number | null>(0)
  const [error, setError] = useState<string | null>(null)
  const [posted, setPosted] = useState<JournalEntry | null>(null)
  const [saving, setSaving] = useState(false)

  const build = (): JournalEntryInput =>
    buildRawMaterialPurchase(
      { workspaceId, entryDate, description, payment: toPayment(payment), amount: amount ?? 0 },
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
          <Label htmlFor="purchase-amount">Total pembelian</Label>
          <AmountInput id="purchase-amount" value={amount} onValueChange={setAmount} />
        </div>
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
