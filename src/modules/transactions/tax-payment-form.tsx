"use client"

import { useState } from "react"
import { todayIsoDate } from "@/core/format"
import { generalLedger } from "@/core/general-ledger"
import type { AppServices } from "@/core/services"
import { accountByRole, buildTaxPayment } from "@/core/transactions"
import type { JournalEntry, JournalEntryInput } from "@/core/types"
import { Amount } from "@/components/ui/amount"
import { AmountInput } from "@/components/ui/amount-input"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { JournalPreview, PostedNotice } from "@/components/ui/journal-preview"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { errorMessage } from "@/lib/utils"
import { activeAccounts, type WorkspaceData } from "./use-workspace-data"

export function TaxPaymentForm({
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
  const [entryDate, setEntryDate] = useState(todayIsoDate)
  const [cashAccountId, setCashAccountId] = useState(cashAccounts.at(-1)?.id ?? "")
  const [amount, setAmount] = useState<number | null>(null)
  const [description, setDescription] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [posted, setPosted] = useState<JournalEntry | null>(null)
  const [saving, setSaving] = useState(false)

  const taxAccount = accountByRole(accounts, "sales_tax_payable")
  const payable = generalLedger(
    journals.filter((j) => j.status === "posted"),
    taxAccount,
    { toDate: entryDate },
  ).closingBalance
  // Kosong = ikut saldo utang pajak per tanggal setoran.
  const effectiveAmount = amount ?? payable

  const build = (): JournalEntryInput =>
    buildTaxPayment(
      { workspaceId: workspace.id, entryDate, amount: effectiveAmount, cashAccountId, description, taxLabel: workspace.salesTaxLabel },
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
      setAmount(null)
      setDescription("")
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
        <p className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-card px-4 py-3 text-sm">
          <span className="text-muted-foreground">{taxAccount.name} belum disetor per tanggal setoran</span>
          <Amount value={payable} className="font-bold text-ink" />
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="tax-date">Tanggal setoran</Label>
            <Input id="tax-date" type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="tax-cash">Dibayar dari</Label>
            <Select value={cashAccountId} onValueChange={setCashAccountId}>
              <SelectTrigger id="tax-cash" className="w-full bg-background">
                <SelectValue placeholder="Pilih akun kas/bank" />
              </SelectTrigger>
              <SelectContent>
                {cashAccounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="tax-amount">Nominal setoran</Label>
            <AmountInput id="tax-amount" value={effectiveAmount} onValueChange={setAmount} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="tax-description">Keterangan (opsional)</Label>
            <Input
              id="tax-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={`mis. Setoran ${workspace.salesTaxLabel} Agustus`}
            />
          </div>
        </div>
      </div>
      <div className="grid content-start gap-4">
        <JournalPreview lines={preview?.lines ?? []} accounts={accounts} />
        {effectiveAmount > payable && (
          <p className="text-sm text-ink">
            Nominal melebihi saldo {taxAccount.name}. Pastikan penjualan sudah dicatat semua.
          </p>
        )}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {posted && <PostedNotice entry={posted} href={journalHref(posted.id)} />}
        <Button type="submit" size="lg" disabled={saving || !preview}>
          {saving ? "Memposting…" : `Posting setoran ${workspace.salesTaxLabel}`}
        </Button>
      </div>
    </form>
  )
}
