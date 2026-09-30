"use client"

import { useState } from "react"
import { TriangleAlertIcon } from "lucide-react"
import { todayIsoDate } from "@/core/format"
import { buildItemUsage } from "@/core/perpetual"
import type { AppServices } from "@/core/services"
import type { JournalEntry, JournalEntryInput } from "@/core/types"
import { Amount } from "@/components/ui/amount"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { filledItemLines, ItemLinesField, newItemLine, type ItemLineState } from "@/components/ui/item-lines-field"
import { JournalPreview, PostedNotice } from "@/components/ui/journal-preview"
import { Label } from "@/components/ui/label"
import { LoadingState, PageHeader } from "@/components/ui/page-header"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { errorMessage } from "@/lib/utils"
import { backdateWarnings } from "./backdate"
import { PerpetualNotice } from "./perpetual-notice"
import { snapshotAt, useInventoryData } from "./use-inventory-data"

/**
 * Pemakaian Barang (ADR 017): bahan terpakai, rusak, atau sampel. Jurnal
 * otomatis Dr HPP (atau beban pilihan), Cr Persediaan per barang dengan harga pokok berjalan.
 */
export function UsageView({
  services,
  workspaceId,
  journalHref,
  settingsHref,
}: {
  services: AppServices
  workspaceId: string
  journalHref: (entryId: string) => string
  settingsHref: string
}) {
  const data = useInventoryData(services, workspaceId)
  const [entryDate, setEntryDate] = useState(todayIsoDate)
  const [description, setDescription] = useState("Pemakaian barang")
  const [debitAccountId, setDebitAccountId] = useState("")
  const [lines, setLines] = useState<ItemLineState[]>(() => [newItemLine()])
  const [error, setError] = useState<string | null>(null)
  const [posted, setPosted] = useState<JournalEntry | null>(null)
  const [saving, setSaving] = useState(false)

  if (data.loading && !data.data) return <LoadingState />
  if (data.error) return <p role="alert" className="text-sm text-destructive">{errorMessage(data.error)}</p>
  const current = data.data!
  const header = (
    <PageHeader title="Pemakaian Barang" description="Bahan terpakai, barang rusak, atau sampel. Jurnal dan harga pokok dibuat otomatis." />
  )
  if (current.workspace.inventoryMethod !== "perpetual") {
    return (
      <div className="grid grid-cols-1 gap-6">
        {header}
        <PerpetualNotice settingsHref={settingsHref} feature="Pemakaian barang" />
      </div>
    )
  }

  const snapshot = snapshotAt(current, entryDate)
  const debitAccounts = current.accounts.filter((a) => a.isActive && (a.accountType === "cogs" || a.accountType === "expense"))
  const cogsId = current.accounts.find((a) => a.systemRole === "cogs")?.id ?? ""
  const filled = filledItemLines(lines, false)
  let preview: { entry: JournalEntryInput; warnings: string[]; totalCost: number } | null = null
  let previewError: string | null = null
  if (filled.length > 0) {
    try {
      preview = buildItemUsage(
        { workspaceId, entryDate, description, lines: filled, debitAccountId: debitAccountId || cogsId },
        snapshot.context,
      )
    } catch (e) {
      previewError = errorMessage(e)
    }
  }
  const warnings = [
    ...(preview?.warnings ?? []),
    ...backdateWarnings(current.journals, current.accounts, current.items, filled.map((l) => l.itemId), entryDate),
  ]

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!preview) return
    setSaving(true)
    setError(null)
    try {
      setPosted(await services.journalService.postJournal(preview.entry))
      setLines([newItemLine()])
      data.reload()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6">
      {header}
      <form onSubmit={submit} className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="grid content-start gap-5 rounded-lg bg-card p-4 sm:p-6">
          <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
            <div className="grid gap-2">
              <Label htmlFor="usage-date">Tanggal</Label>
              <Input id="usage-date" type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="usage-description">Keterangan</Label>
              <Input id="usage-description" value={description} onChange={(e) => setDescription(e.target.value)} required />
            </div>
          </div>
          <div className="grid gap-2 sm:max-w-md">
            <Label htmlFor="usage-account">Dibebankan ke</Label>
            <Select value={debitAccountId || cogsId} onValueChange={setDebitAccountId}>
              <SelectTrigger id="usage-account" className="w-full bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {debitAccounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.code} · {a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <ItemLinesField
            idPrefix="usage"
            label="Barang dipakai"
            items={current.items}
            lines={lines}
            onChange={setLines}
            stockQty={(id) => snapshot.context.stocks.get(id)?.qty ?? 0}
          />
        </div>
        <div className="grid content-start gap-4">
          <div className="flex justify-between rounded-lg bg-canvas p-4 text-sm font-bold text-ink ring-1 ring-border">
            <span>Harga pokok dibebankan</span>
            <Amount value={preview?.totalCost ?? 0} />
          </div>
          {warnings.length > 0 && (
            <ul className="grid gap-1 text-sm text-ink">
              {warnings.map((w) => (
                <li key={w} className="flex gap-2"><TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />{w}</li>
              ))}
            </ul>
          )}
          <JournalPreview lines={preview?.entry.lines ?? []} accounts={current.accounts} />
          {previewError && <p className="text-sm text-destructive">{previewError}</p>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {posted && <PostedNotice entry={posted} href={journalHref(posted.id)} />}
          <Button type="submit" size="lg" disabled={saving || !preview}>
            {saving ? "Memposting…" : "Posting pemakaian"}
          </Button>
        </div>
      </form>
    </div>
  )
}
