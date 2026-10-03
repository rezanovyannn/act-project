"use client"

import { useState } from "react"
import Link from "next/link"
import { InfoIcon } from "lucide-react"
import { endOfMonth } from "@/core/dates"
import { formatAccounting, formatDate, todayIsoDate } from "@/core/format"
import { isLedgerEntry } from "@/core/ledger"
import type { AppServices } from "@/core/services"
import type { JournalEntry } from "@/core/types"
import { Amount } from "@/components/ui/amount"
import { AmountInput } from "@/components/ui/amount-input"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { JournalPreview, PostedNotice } from "@/components/ui/journal-preview"
import { Label } from "@/components/ui/label"
import { LoadingState, PageHeader } from "@/components/ui/page-header"
import { errorMessage, useLoader } from "@/lib/utils"
import { buildStockOpname, inventoryBookBalance } from "@/core/inventory"
import { ItemStockOpnameForm } from "./item-stock-opname-form"
import { StockCountView } from "./stock-count-view"
import { useInventoryData } from "./use-inventory-data"

/** Stok opname: sisa bahan & COGS (periodik, ADR 020), nilai rupiah (periodik tanpa daftar bahan), atau per barang (perpetual, ADR 017). */
export function StockOpnameView({
  services,
  workspaceId,
  journalHref,
  itemsHref,
  settingsHref,
}: {
  services: AppServices
  workspaceId: string
  journalHref: (entryId: string) => string
  itemsHref: string
  settingsHref: string
}) {
  const data = useInventoryData(services, workspaceId)
  if (data.loading && !data.data) return <LoadingState />
  if (data.error) return <p role="alert" className="text-sm text-destructive">{errorMessage(data.error)}</p>
  if (data.data!.workspace.inventoryMethod !== "perpetual") {
    // Belum ada daftar bahan: tetap stok opname nilai rupiah (ADR 007).
    if (!data.data!.items.some((i) => i.isActive)) {
      return <PeriodicStockOpname services={services} workspaceId={workspaceId} journalHref={journalHref} itemsHref={itemsHref} />
    }
    return (
      <StockCountView
        services={services}
        workspaceId={workspaceId}
        journalHref={journalHref}
        itemsHref={itemsHref}
        settingsHref={settingsHref}
      />
    )
  }
  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader title="Stok Opname" description="Hitung fisik per barang; selisih qty dinilai dengan harga pokok berjalan dan dibukukan ke HPP." />
      <ItemStockOpnameForm services={services} data={data.data!} journalHref={journalHref} onPosted={data.reload} />
    </div>
  )
}

/** Stok opname periodik: selisih saldo buku vs fisik diposting ke HPP (ADR 007 & 015). */
function PeriodicStockOpname({
  services,
  workspaceId,
  journalHref,
  itemsHref,
}: {
  services: AppServices
  workspaceId: string
  journalHref: (entryId: string) => string
  itemsHref: string
}) {
  const data = useLoader(async () => {
    const [workspace, accounts, journals] = await Promise.all([
      services.workspaces.getById(workspaceId),
      services.accounts.listByWorkspace(workspaceId),
      services.journals.listByWorkspace(workspaceId, { status: "posted" }),
    ])
    if (!workspace) throw new Error("Workspace tidak ditemukan")
    return { noun: services.workspaceService.templateOf(workspace.templateType).inventoryNoun, accounts, journals }
  }, [services, workspaceId])

  const [entryDate, setEntryDate] = useState(() => endOfMonth(todayIsoDate()))
  const [physicalValue, setPhysicalValue] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [posted, setPosted] = useState<JournalEntry | null>(null)
  const [saving, setSaving] = useState(false)

  if (data.loading && !data.data) return <LoadingState />
  if (data.error) return <p role="alert" className="text-sm text-destructive">{errorMessage(data.error)}</p>
  const { noun, accounts, journals } = data.data!

  let bookBalance: number | null = null
  try {
    bookBalance = inventoryBookBalance(journals, accounts, entryDate)
  } catch (e) {
    return <p role="alert" className="text-sm text-destructive">{errorMessage(e)}</p>
  }
  const month = entryDate.slice(0, 7)
  const inventoryId = accounts.find((a) => a.systemRole === "inventory")?.id
  const earlierOpname = journals
    .filter(isLedgerEntry)
    .filter((e) => e.source === "adjustment" && e.entryDate.startsWith(month) && e.lines.some((l) => l.accountId === inventoryId))

  const result =
    physicalValue === null
      ? null
      : buildStockOpname({ workspaceId, entryDate, bookBalance, physicalValue }, accounts)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!result?.entry) return
    setSaving(true)
    setError(null)
    try {
      const entry = await services.journalService.postJournal(result.entry)
      setPosted(entry)
      setPhysicalValue(null)
      data.reload()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader
        title="Stok Opname"
        description={`Hitung fisik persediaan ${noun}, lalu sistem membukukan selisihnya ke HPP.`}
      />
      <p role="note" className="flex gap-2 rounded-2xl bg-card px-4 py-3 text-sm text-ink">
        <InfoIcon className="mt-0.5 size-4 shrink-0" />
        <span>
          Ingin input sisa per bahan dan tabel COGS? Tambahkan bahan (dengan Section) di{" "}
          <Link href={itemsHref} className="font-semibold underline underline-offset-4">Daftar Barang</Link>; halaman ini lalu
          berganti menjadi Stok Opname &amp; COGS.
        </span>
      </p>
      <form onSubmit={submit} className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="grid content-start gap-5 rounded-2xl bg-canvas ring-1 ring-border p-4 sm:p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="opname-date">Tanggal stok opname</Label>
              <Input id="opname-date" type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="opname-physical">Nilai persediaan fisik</Label>
              <AmountInput id="opname-physical" value={physicalValue} onValueChange={setPhysicalValue} />
            </div>
          </div>
          <dl className="grid gap-2 rounded-2xl bg-card p-4 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Saldo buku per {formatDate(entryDate)}</dt>
              <dd><Amount value={bookBalance} /></dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Nilai fisik</dt>
              <dd><Amount value={physicalValue ?? 0} /></dd>
            </div>
            <div className="flex justify-between gap-4 border-t pt-2 font-bold text-ink">
              <dt>
                {result === null
                  ? "Selisih"
                  : result.difference > 0
                    ? "Persediaan terpakai/terjual (tambah HPP)"
                    : result.difference < 0
                      ? "Kelebihan fisik (kurangi HPP)"
                      : "Tidak ada selisih"}
              </dt>
              <dd><Amount value={Math.abs(result?.difference ?? 0)} /></dd>
            </div>
          </dl>
          {earlierOpname.length > 0 && (
            <p className="flex gap-2 text-sm text-ink">
              <InfoIcon className="mt-0.5 size-4 shrink-0" />
              Sudah ada {earlierOpname.length} jurnal stok opname di bulan ini. Saldo buku di atas
              sudah memperhitungkannya, jadi opname ulang hanya membukukan selisih tambahan.
            </p>
          )}
        </div>
        <div className="grid content-start gap-4">
          <JournalPreview lines={result?.entry?.lines ?? []} accounts={accounts} />
          {result && !result.entry && (
            <p className="text-sm text-muted-foreground">
              Nilai fisik sama dengan saldo buku ({formatAccounting(bookBalance)}); tidak perlu jurnal.
            </p>
          )}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {posted && <PostedNotice entry={posted} href={journalHref(posted.id)} />}
          <Button type="submit" size="lg" disabled={saving || !result?.entry}>
            {saving ? "Memposting…" : "Posting penyesuaian HPP"}
          </Button>
        </div>
      </form>
    </div>
  )
}
