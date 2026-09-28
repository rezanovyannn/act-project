"use client"

import { useState } from "react"
import { toast } from "sonner"
import { formatAccounting, todayIsoDate } from "@/core/format"
import type { AppServices } from "@/core/services"
import type { CreditTransaction } from "@/core/settlement"
import { buildSettlement } from "@/core/transactions"
import type { Account, JournalEntryInput } from "@/core/types"
import { AmountInput } from "@/components/ui/amount-input"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { JournalPreview } from "@/components/ui/journal-preview"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { errorMessage } from "@/lib/utils"

/** Penerimaan piutang / pembayaran utang, sebagian atau penuh (ADR 012). */
export function SettlementDialog({
  services,
  credit,
  accounts,
  onSettled,
}: {
  services: AppServices
  credit: CreditTransaction
  accounts: Account[]
  onSettled: () => void
}) {
  const cashAccounts = accounts.filter((a) => a.isCash && a.isActive)
  const isReceivable = credit.kind === "receivable"
  const today = todayIsoDate()
  const [open, setOpen] = useState(false)
  const [entryDate, setEntryDate] = useState(today > credit.entry.entryDate ? today : credit.entry.entryDate)
  const [cashAccountId, setCashAccountId] = useState(cashAccounts.at(-1)?.id ?? "")
  const [amount, setAmount] = useState<number | null>(credit.outstanding)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  let preview: JournalEntryInput | null = null
  try {
    preview = buildSettlement(
      { target: credit.entry, entryDate, amount: amount ?? 0, cashAccountId },
      accounts,
    )
  } catch {
    preview = null
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!preview) return
    setSaving(true)
    setError(null)
    try {
      const entry = await services.journalService.postJournal(preview)
      toast.success(`${isReceivable ? "Penerimaan" : "Pembayaran"} dicatat: ${entry.entryNumber}`)
      setOpen(false)
      onSettled()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          {isReceivable ? "Terima" : "Bayar"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>
              {isReceivable ? "Terima pembayaran" : "Bayar utang"} · {credit.counterparty ?? "Tanpa nama"}
            </DialogTitle>
            <DialogDescription>
              {credit.entry.entryNumber} · sisa {formatAccounting(credit.outstanding)} dari{" "}
              {formatAccounting(credit.original)}. Boleh dibayar sebagian.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="settle-date">Tanggal</Label>
              <Input id="settle-date" type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="settle-cash">{isReceivable ? "Diterima di" : "Dibayar dari"}</Label>
              <Select value={cashAccountId} onValueChange={setCashAccountId}>
                <SelectTrigger id="settle-cash" className="w-full bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {cashAccounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="settle-amount">Nominal</Label>
              <AmountInput id="settle-amount" value={amount} onValueChange={setAmount} />
              {amount !== null && amount > credit.outstanding && (
                <p className="text-sm text-destructive">Melebihi sisa tagihan.</p>
              )}
            </div>
          </div>
          {preview && <JournalPreview lines={preview.lines} accounts={accounts} />}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Batal
            </Button>
            <Button type="submit" disabled={saving || !preview}>
              {saving ? "Memposting…" : "Posting pelunasan"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
