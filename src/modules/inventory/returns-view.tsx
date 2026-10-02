"use client"

import { useState } from "react"
import { formatDate, todayIsoDate } from "@/core/format"
import { reversedEntryIds } from "@/core/reversal"
import { activeReturnsOf, buildReturn, returnableItems, returnKindOf, type ReturnKind } from "@/core/returns"
import type { AppServices } from "@/core/services"
import { outstandingAmount } from "@/core/settlement"
import { isLedgerEntry } from "@/core/ledger"
import type { JournalEntry, JournalEntryInput } from "@/core/types"
import { Amount } from "@/components/ui/amount"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { errorMessage } from "@/lib/utils"
import { PerpetualNotice } from "./perpetual-notice"
import { useInventoryData } from "./use-inventory-data"

const REDUCE_CLAIM = "__reduce_claim__"

/** Retur penjualan & pembelian barang dengan nilai pokok transaksi asal (ADR 017). */
export function ReturnsView({
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
  const [kind, setKind] = useState<ReturnKind>("sales")
  const [targetId, setTargetId] = useState("")
  const [quantities, setQuantities] = useState<Record<string, string>>({})
  const [refund, setRefund] = useState("")
  const [entryDate, setEntryDate] = useState(todayIsoDate)
  const [error, setError] = useState<string | null>(null)
  const [posted, setPosted] = useState<JournalEntry | null>(null)
  const [saving, setSaving] = useState(false)

  if (data.loading && !data.data) return <LoadingState />
  if (data.error) return <p role="alert" className="text-sm text-destructive">{errorMessage(data.error)}</p>
  const { workspace, accounts, items, journals } = data.data!
  const header = <PageHeader title="Retur Barang" description="Retur penjualan atau pembelian dengan harga & HPP transaksi asal." />
  if (workspace.inventoryMethod !== "perpetual") {
    return (
      <div className="grid grid-cols-1 gap-6">
        {header}
        <PerpetualNotice settingsHref={settingsHref} feature="Retur barang" />
      </div>
    )
  }

  const reversed = reversedEntryIds(journals)
  const candidates = journals
    .filter((e) => isLedgerEntry(e) && !reversed.has(e.id) && returnKindOf(e, accounts) === kind)
    .filter((e) => returnableItems(e, activeReturnsOf(journals, e.id), accounts).some((r) => r.remainingQty > 0))
    .reverse()
  const target = candidates.find((e) => e.id === targetId) ?? null
  const activeReturns = target ? activeReturnsOf(journals, target.id) : []
  const returnable = target ? returnableItems(target, activeReturns, accounts) : []
  const cashAccounts = accounts.filter((a) => a.isCash && a.isActive)
  const accountsById = new Map(accounts.map((a) => [a.id, a]))
  const claimRole = kind === "sales" ? "accounts_receivable" : "accounts_payable"
  const settlements = target ? journals.filter((e) => isLedgerEntry(e) && e.settlementOf === target.id && !reversed.has(e.id)) : []
  const outstanding = target && target.lines.some((l) => accountsById.get(l.accountId)?.systemRole === claimRole)
    ? outstandingAmount(target, settlements, accountsById)
    : null
  const refundValue = refund || (outstanding && outstanding > 0 ? REDUCE_CLAIM : cashAccounts.at(-1)?.id ?? "")

  const lines = returnable
    .map((r) => ({ itemId: r.itemId, quantity: Number(quantities[r.itemId] || 0) }))
    .filter((l) => l.quantity > 0)
  let preview: JournalEntryInput | null = null
  let previewError: string | null = null
  if (target && lines.length > 0) {
    try {
      preview = buildReturn(
        {
          workspaceId,
          entryDate,
          target,
          activeReturns,
          lines,
          refund: refundValue === REDUCE_CLAIM ? { kind: "reduce_claim" } : { kind: "cash", accountId: refundValue },
        },
        accounts,
      )
    } catch (e) {
      previewError = errorMessage(e)
    }
  }
  const total = preview ? preview.lines.filter((l) => accountsById.get(l.accountId)?.isCash || accountsById.get(l.accountId)?.systemRole === claimRole).reduce((t, l) => t + l.debit + l.credit, 0) : 0

  function reset(nextKind?: ReturnKind) {
    if (nextKind) setKind(nextKind)
    setTargetId("")
    setQuantities({})
    setRefund("")
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!preview) return
    setSaving(true)
    setError(null)
    try {
      setPosted(await services.journalService.postJournal(preview))
      reset()
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
      <Tabs value={kind} onValueChange={(v) => reset(v as ReturnKind)}>
        <TabsList>
          <TabsTrigger value="sales">Retur penjualan</TabsTrigger>
          <TabsTrigger value="purchase">Retur pembelian</TabsTrigger>
        </TabsList>
      </Tabs>
      <form onSubmit={submit} className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="grid content-start gap-5 rounded-[24px] bg-canvas ring-1 ring-border p-4 sm:p-6">
          <div className="grid gap-2">
            <Label htmlFor="return-target">{kind === "sales" ? "Penjualan asal" : "Pembelian asal"}</Label>
            <Select value={targetId} onValueChange={(v) => { setTargetId(v); setQuantities({}); setRefund("") }}>
              <SelectTrigger id="return-target" className="w-full bg-background">
                <SelectValue placeholder={candidates.length === 0 ? "Belum ada transaksi barang yang dapat diretur" : "Pilih transaksi"} />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.entryNumber} · {formatDate(e.entryDate)} · {e.description}{e.counterparty ? ` · ${e.counterparty}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {target && (
            <>
              <div className="overflow-x-auto rounded-[24px] bg-canvas ring-1 ring-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Barang</TableHead>
                      <TableHead className="w-28 text-right">Qty asal</TableHead>
                      <TableHead className="w-28 text-right">Sisa</TableHead>
                      <TableHead className="w-32">Qty retur</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {returnable.map((r) => {
                      const item = items.find((i) => i.id === r.itemId)
                      return (
                        <TableRow key={r.itemId}>
                          <TableCell>{item ? `${item.code} · ${item.name}` : r.itemId}</TableCell>
                          <TableCell className="text-right tabular-nums">{r.quantity.toLocaleString("id-ID")}</TableCell>
                          <TableCell className="text-right tabular-nums">{r.remainingQty.toLocaleString("id-ID")}</TableCell>
                          <TableCell>
                            <Input
                              aria-label={`Qty retur ${item?.name ?? ""}`}
                              inputMode="numeric"
                              disabled={r.remainingQty === 0}
                              value={quantities[r.itemId] ?? ""}
                              onChange={(e) => setQuantities({ ...quantities, [r.itemId]: e.target.value.replace(/\D/g, "") })}
                            />
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="return-date">Tanggal retur</Label>
                  <Input id="return-date" type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} required />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="return-refund">Penyelesaian</Label>
                  <Select value={refundValue} onValueChange={setRefund}>
                    <SelectTrigger id="return-refund" className="w-full bg-background">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {outstanding !== null && outstanding > 0 && (
                        <SelectItem value={REDUCE_CLAIM}>
                          Kurangi {kind === "sales" ? "piutang" : "utang"} (sisa Rp {outstanding.toLocaleString("id-ID")})
                        </SelectItem>
                      )}
                      {cashAccounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>Tunai lewat {a.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </>
          )}
        </div>
        <div className="grid content-start gap-4">
          <div className="flex justify-between rounded-2xl bg-canvas p-4 text-sm font-bold text-ink ring-1 ring-border">
            <span>{refundValue === REDUCE_CLAIM ? (kind === "sales" ? "Piutang berkurang" : "Utang berkurang") : "Dana dikembalikan"}</span>
            <Amount value={total} />
          </div>
          <JournalPreview lines={preview?.lines ?? []} accounts={accounts} />
          {previewError && <p className="text-sm text-destructive">{previewError}</p>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {posted && <PostedNotice entry={posted} href={journalHref(posted.id)} />}
          <Button type="submit" size="lg" disabled={saving || !preview}>
            {saving ? "Memposting…" : "Posting retur"}
          </Button>
        </div>
      </form>
    </div>
  )
}
