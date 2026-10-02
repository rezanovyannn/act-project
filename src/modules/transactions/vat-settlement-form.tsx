"use client"

import { useState } from "react"
import { InfoIcon } from "lucide-react"
import { endOfMonth } from "@/core/dates"
import { formatDate, formatMonth, todayIsoDate } from "@/core/format"
import type { AppServices } from "@/core/services"
import type { JournalEntry, JournalEntryInput } from "@/core/types"
import { buildVatSettlement, proposeVatSettlement, vatBalances } from "@/core/vat"
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

/** Masa pajak default: bulan lalu (`YYYY-MM`). */
function previousMonth(today: string): string {
  const [year, month] = today.split("-").map(Number)
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`
}

/**
 * Setoran PPN per masa (ADR 016): saldo PPN Keluaran & Masukan per akhir
 * masa; Masukan dikreditkan sampai sebesar Keluaran, sisanya dikompensasikan.
 */
export function VatSettlementForm({
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
  const [taxPeriod, setTaxPeriod] = useState(() => previousMonth(todayIsoDate()))
  const [entryDate, setEntryDate] = useState(todayIsoDate)
  const [cashAccountId, setCashAccountId] = useState(cashAccounts.at(-1)?.id ?? "")
  const [outputOverride, setOutputOverride] = useState<number | null>(null)
  const [creditedOverride, setCreditedOverride] = useState<number | null>(null)
  const [description, setDescription] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [posted, setPosted] = useState<JournalEntry | null>(null)
  const [saving, setSaving] = useState(false)

  const validPeriod = /^\d{4}-(0[1-9]|1[0-2])$/.test(taxPeriod)
  const periodEnd = validPeriod ? endOfMonth(`${taxPeriod}-01`) : null
  const balances = periodEnd ? vatBalances(journals, accounts, periodEnd) : { output: 0, input: 0 }
  const proposal = proposeVatSettlement(balances)
  const output = outputOverride ?? proposal.output
  const credited = creditedOverride ?? Math.min(proposal.credited, output)
  const payable = Math.max(output - credited, 0)
  const carriedForward = Math.max(balances.input - credited, 0)

  const build = (): JournalEntryInput =>
    buildVatSettlement(
      { workspaceId: workspace.id, taxPeriod, entryDate, output, credited, cashAccountId: cashAccountId || undefined, description },
      accounts,
    )
  let preview: JournalEntryInput | null = null
  let previewError: string | null = null
  try {
    preview = build()
  } catch (e) {
    previewError = errorMessage(e)
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const entry = await services.journalService.postJournal(build())
      setPosted(entry)
      setOutputOverride(null)
      setCreditedOverride(null)
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
      <div className="grid content-start gap-5 rounded-2xl bg-canvas ring-1 ring-border p-4 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="vat-period">Masa pajak</Label>
            <Input
              id="vat-period"
              type="month"
              value={taxPeriod}
              onChange={(e) => {
                setTaxPeriod(e.target.value)
                setOutputOverride(null)
                setCreditedOverride(null)
              }}
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="vat-date">Tanggal setoran</Label>
            <Input id="vat-date" type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} required />
          </div>
        </div>

        <dl className="grid gap-2 rounded-2xl bg-card p-4 text-sm">
          <p className="text-xs font-medium text-muted-foreground">
            Saldo per akhir masa{periodEnd ? ` (${formatDate(periodEnd)})` : ""}
          </p>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">PPN Keluaran</dt>
            <dd><Amount value={balances.output} /></dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">PPN Masukan</dt>
            <dd><Amount value={balances.input} /></dd>
          </div>
        </dl>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="vat-output">PPN Keluaran disetor</Label>
            <AmountInput id="vat-output" value={output} onValueChange={setOutputOverride} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="vat-credited">PPN Masukan dikreditkan</Label>
            <AmountInput id="vat-credited" value={credited} onValueChange={setCreditedOverride} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="vat-cash">Dibayar dari</Label>
            <Select value={cashAccountId} onValueChange={setCashAccountId}>
              <SelectTrigger id="vat-cash" className="w-full bg-background">
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
            <Label htmlFor="vat-description">Keterangan (opsional)</Label>
            <Input
              id="vat-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={validPeriod ? `Setoran PPN masa ${taxPeriod}` : "Setoran PPN"}
            />
          </div>
        </div>
      </div>

      <div className="grid content-start gap-4">
        <dl className="grid gap-2 rounded-2xl bg-canvas p-4 text-sm ring-1 ring-border">
          <div className="flex justify-between border-b pb-2 font-bold text-ink">
            <dt>Kurang bayar (disetor)</dt>
            <dd><Amount value={payable} /></dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Lebih bayar dikompensasikan ke masa berikutnya</dt>
            <dd><Amount value={carriedForward} /></dd>
          </div>
        </dl>
        {credited < Math.min(balances.input, output) && (
          <p className="flex gap-2 text-sm text-ink">
            <InfoIcon className="mt-0.5 size-4 shrink-0" />
            PPN Masukan yang tidak dikreditkan tetap menjadi saldo untuk masa berikutnya.
          </p>
        )}
        <JournalPreview lines={preview?.lines ?? []} accounts={accounts} />
        {previewError && output > 0 && <p className="text-sm text-muted-foreground">{previewError}</p>}
        {output === 0 && validPeriod && (
          <p className="text-sm text-muted-foreground">
            Tidak ada PPN Keluaran per akhir {formatMonth(`${taxPeriod}-01`)}; tidak perlu setoran.
          </p>
        )}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {posted && <PostedNotice entry={posted} href={journalHref(posted.id)} />}
        <Button type="submit" size="lg" disabled={saving || !preview}>
          {saving ? "Memposting…" : "Posting setoran PPN"}
        </Button>
      </div>
    </form>
  )
}
