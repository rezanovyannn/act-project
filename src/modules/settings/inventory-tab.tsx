"use client"

import { useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { formatAccounting, formatDate, todayIsoDate } from "@/core/format"
import type { AppServices } from "@/core/services"
import { buildSnapshot, currentCostMethod } from "@/core/services/inventory-service"
import type { CostMethod, JournalEntry, StockValuation, Workspace } from "@/core/types"
import { Amount } from "@/components/ui/amount"
import { AmountInput } from "@/components/ui/amount-input"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LoadingState } from "@/components/ui/page-header"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { errorMessage, useLoader } from "@/lib/utils"

const VALUATION_LABELS: Record<StockValuation, string> = {
  average: "Harga beli rata-rata (stok awal + pembelian periode)",
  last: "Harga beli terakhir",
}

const COST_LABELS: Record<CostMethod, string> = { average: "Rata-rata tertimbang bergerak", fifo: "FIFO (masuk pertama keluar pertama)" }

/** Pengaturan → Persediaan: metode periodik/perpetual & metode biaya (ADR 017). */
export function InventoryTab({
  services,
  workspace,
  itemsHref,
  journalHref,
  onSaved,
}: {
  services: AppServices
  workspace: Workspace
  itemsHref: string
  journalHref: (entryId: string) => string
  onSaved: () => void
}) {
  const raw = useLoader(async () => {
    const [accounts, items, journals] = await Promise.all([
      services.accounts.listByWorkspace(workspace.id),
      services.items.listByWorkspace(workspace.id),
      services.journals.listByWorkspace(workspace.id),
    ])
    return { accounts, items, journals }
  }, [services, workspace.id, workspace.updatedAt])
  const perpetual = workspace.inventoryMethod === "perpetual"
  const costMethod = currentCostMethod(workspace.costMethodHistory)
  const [entryDate, setEntryDate] = useState(todayIsoDate)
  const [newCost, setNewCost] = useState<CostMethod>(costMethod)
  const [counts, setCounts] = useState<Record<string, { qty: string; value: number | null }>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [transition, setTransition] = useState<JournalEntry | null>(null)

  if (raw.loading && !raw.data) return <LoadingState />
  if (raw.error) return <p role="alert" className="text-sm text-destructive">{errorMessage(raw.error)}</p>
  const { accounts, items, journals } = raw.data!
  const snapshot = buildSnapshot(workspace, accounts, items, journals, entryDate)
  const activeItems = items.filter((i) => i.isActive)

  async function run(action: () => Promise<{ transitionEntry: JournalEntry | null }>, success: string) {
    setSaving(true)
    setError(null)
    try {
      const result = await action()
      setTransition(result.transitionEntry)
      toast.success(success)
      onSaved()
      raw.reload()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const entered = activeItems.map((i) => ({
    itemId: i.id,
    quantity: Number(counts[i.id]?.qty || 0),
    value: counts[i.id]?.value ?? 0,
  }))
  const enteredTotal = entered.reduce((t, c) => t + c.value, 0)
  const difference = enteredTotal - snapshot.reconciliation.accountBalance

  return (
    <div className="grid max-w-4xl grid-cols-1 gap-5">
      <p className="text-sm text-muted-foreground">
        Metode saat ini: <strong className="text-ink">{perpetual ? `Perpetual · ${COST_LABELS[costMethod]}` : "Periodik (stok opname sisa bahan & COGS)"}</strong>.
        Perubahan tercatat di Riwayat Audit.
      </p>

      {!perpetual && (
        <section className="grid gap-3 rounded-2xl bg-canvas ring-1 ring-border p-4 sm:p-6">
          <div>
            <h2 className="font-semibold">Nilai sisa bahan di Stok Opname &amp; COGS</h2>
            <p className="text-sm text-muted-foreground">
              Dasar harga untuk menilai qty sisa bahan saat stok opname. Berlaku untuk stok opname berikutnya; stok opname
              yang sudah disimpan tidak dihitung ulang.
            </p>
          </div>
          <div className="grid max-w-md gap-2">
            <Label htmlFor="inv-valuation">Dasar nilai stok</Label>
            <Select
              value={workspace.stockValuation}
              disabled={saving}
              onValueChange={(v) =>
                run(
                  async () => (await services.stockCountService.setValuation(workspace.id, v as StockValuation), { transitionEntry: null }),
                  `Dasar nilai stok: ${VALUATION_LABELS[v as StockValuation].toLowerCase()}`,
                )
              }
            >
              <SelectTrigger id="inv-valuation" className="w-full bg-background"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(VALUATION_LABELS) as StockValuation[]).map((v) => (
                  <SelectItem key={v} value={v}>{VALUATION_LABELS[v]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </section>
      )}

      {!perpetual ? (
        <section className="grid gap-4 rounded-2xl bg-canvas ring-1 ring-border p-4 sm:p-6">
          <div>
            <h2 className="font-semibold">Aktifkan persediaan perpetual</h2>
            <p className="text-sm text-muted-foreground">
              Isi stok awal per barang (qty & nilai) pada tanggal peralihan. Saldo akun Persediaan dinolkan lalu
              diganti rincian per barang; selisihnya dijurnal ke HPP. Barang belum ada?{" "}
              <Link href={itemsHref} className="font-semibold underline underline-offset-4">Tambahkan di Daftar Barang</Link>.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="inv-date">Tanggal peralihan</Label>
              <Input id="inv-date" type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="inv-cost">Metode biaya</Label>
              <Select value={newCost} onValueChange={(v) => setNewCost(v as CostMethod)}>
                <SelectTrigger id="inv-cost" className="w-full bg-background"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(COST_LABELS) as CostMethod[]).map((m) => (
                    <SelectItem key={m} value={m}>{COST_LABELS[m]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {activeItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">Belum ada barang aktif.</p>
          ) : (
            <div className="overflow-x-auto rounded-2xl bg-canvas ring-1 ring-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Barang</TableHead>
                    <TableHead className="w-36">Qty</TableHead>
                    <TableHead className="w-44">Nilai (Rp)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activeItems.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        {item.code} · {item.name}
                        <span className="block text-xs text-muted-foreground">{item.unit}</span>
                      </TableCell>
                      <TableCell>
                        <Input
                          aria-label={`Qty awal ${item.name}`}
                          inputMode="numeric"
                          value={counts[item.id]?.qty ?? ""}
                          onChange={(e) => setCounts({ ...counts, [item.id]: { qty: e.target.value.replace(/\D/g, ""), value: counts[item.id]?.value ?? null } })}
                        />
                      </TableCell>
                      <TableCell>
                        <AmountInput
                          aria-label={`Nilai awal ${item.name}`}
                          value={counts[item.id]?.value ?? null}
                          onValueChange={(value) => setCounts({ ...counts, [item.id]: { qty: counts[item.id]?.qty ?? "", value } })}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <dl className="grid gap-1 rounded-2xl bg-card p-4 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Saldo akun Persediaan per {formatDate(entryDate)}</dt>
              <dd><Amount value={snapshot.reconciliation.accountBalance} /></dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Total nilai stok awal per barang</dt>
              <dd><Amount value={enteredTotal} /></dd>
            </div>
            <div className="flex justify-between gap-4 border-t pt-2 font-semibold text-ink">
              <dt>{difference === 0 ? "Tidak ada selisih" : difference > 0 ? "Selisih lebih (mengurangi HPP)" : "Selisih kurang (menambah HPP)"}</dt>
              <dd><Amount value={Math.abs(difference)} /></dd>
            </div>
          </dl>
          <Button
            className="w-fit"
            disabled={saving}
            onClick={() =>
              run(
                () =>
                  services.inventoryService.changeSettings(workspace.id, {
                    kind: "to_perpetual",
                    entryDate,
                    costMethod: newCost,
                    counts: entered.filter((c) => c.quantity > 0 || c.value > 0),
                  }),
                "Persediaan perpetual diaktifkan",
              )
            }
          >
            {saving ? "Memproses…" : "Aktifkan perpetual"}
          </Button>
        </section>
      ) : (
        <>
          <section className="grid gap-4 rounded-2xl bg-canvas ring-1 ring-border p-4 sm:p-6">
            <h2 className="font-semibold">Metode biaya</h2>
            <ul className="grid gap-1 text-sm text-muted-foreground">
              {workspace.costMethodHistory.map((h) => (
                <li key={`${h.method}-${h.from}`}>{COST_LABELS[h.method]} · berlaku mulai {formatDate(h.from)}</li>
              ))}
            </ul>
            <div className="flex flex-wrap items-end gap-4">
              <div className="grid gap-2">
                <Label htmlFor="inv-cost-change">Ganti ke</Label>
                <Select value={newCost} onValueChange={(v) => setNewCost(v as CostMethod)}>
                  <SelectTrigger id="inv-cost-change" className="w-64 bg-background"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(COST_LABELS) as CostMethod[]).map((m) => (
                      <SelectItem key={m} value={m}>{COST_LABELS[m]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="inv-cost-from">Berlaku mulai</Label>
                <Input id="inv-cost-from" type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
              </div>
              <Button
                variant="secondary"
                disabled={saving || newCost === costMethod}
                onClick={() =>
                  run(
                    () => services.inventoryService.changeSettings(workspace.id, { kind: "cost_method", method: newCost, from: entryDate }),
                    "Metode biaya diubah",
                  )
                }
              >
                Simpan metode biaya
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Tanpa jurnal: stok per barang pada tanggal berlaku menjadi harga/lapisan awal metode baru.
            </p>
          </section>
          <section className="grid gap-3 rounded-2xl bg-canvas ring-1 ring-border p-4 sm:p-6">
            <h2 className="font-semibold">Kembali ke metode periodik</h2>
            <p className="text-sm text-muted-foreground">
              Tanpa jurnal: stok per barang dibekukan, saldo akun Persediaan tetap, dan HPP kembali diakui lewat
              stok opname nilai rupiah.
            </p>
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="secondary" className="w-fit" disabled={saving}>Kembali ke periodik</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Kembali ke metode periodik?</DialogTitle>
                  <DialogDescription>
                    Form pembelian dan stok opname kembali ke versi nilai rupiah. Saldo Persediaan saat ini{" "}
                    {formatAccounting(snapshot.reconciliation.accountBalance)} tetap.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose asChild><Button variant="secondary">Batal</Button></DialogClose>
                  <DialogClose asChild>
                    <Button onClick={() => run(() => services.inventoryService.changeSettings(workspace.id, { kind: "to_periodic" }), "Kembali ke metode periodik")}>
                      Kembali ke periodik
                    </Button>
                  </DialogClose>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </section>
        </>
      )}

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {transition && (
        <p role="status" className="rounded-lg bg-success-pale px-4 py-3 text-sm text-success-deep">
          Jurnal stok awal diposting:{" "}
          <Link href={journalHref(transition.id)} className="font-semibold underline underline-offset-4">{transition.entryNumber}</Link>
        </p>
      )}
    </div>
  )
}
