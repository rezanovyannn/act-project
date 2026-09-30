"use client"

import { useState } from "react"
import Link from "next/link"
import { CheckCircle2Icon, MoreHorizontalIcon, PlusIcon, TriangleAlertIcon } from "lucide-react"
import { toast } from "sonner"
import { formatDate } from "@/core/format"
import type { AppServices } from "@/core/services"
import { mulDivRound, stockCard } from "@/core/stock"
import type { Account, Item } from "@/core/types"
import { Amount } from "@/components/ui/amount"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
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
import { errorMessage } from "@/lib/utils"
import { methodSummary, snapshotAt, useInventoryData, type InventoryData } from "./use-inventory-data"

const NO_ACCOUNT = "__none__"

/** Daftar Barang: master barang, stok, nilai, dan kartu stok (ADR 017). */
export function ItemsView({
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
  const [editing, setEditing] = useState<Item | "new" | null>(null)
  const [card, setCard] = useState<Item | null>(null)

  if (data.loading && !data.data) return <LoadingState />
  if (data.error) return <p role="alert" className="text-sm text-destructive">{errorMessage(data.error)}</p>
  const current = data.data!
  const snapshot = snapshotAt(current)
  const perpetual = current.workspace.inventoryMethod === "perpetual"
  const usedIds = new Set(current.journals.filter((j) => j.deletedAt === null).flatMap((j) => j.lines.map((l) => l.itemId)))
  const { reconciliation } = snapshot

  async function run(action: () => Promise<unknown>, success: string) {
    try {
      await action()
      toast.success(success)
      data.reload()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader
        title="Daftar Barang"
        description={`Master barang, stok, dan harga pokok per barang. Metode persediaan: ${methodSummary(current.workspace)}.`}
        actions={
          <Button onClick={() => setEditing("new")}>
            <PlusIcon data-icon="inline-start" />
            Tambah barang
          </Button>
        }
      />

      {!perpetual ? (
        <p role="note" className="rounded-lg bg-card px-4 py-3 text-sm text-ink">
          Metode periodik: stok per barang belum dilacak. Siapkan daftar barang di sini, lalu aktifkan metode
          perpetual di{" "}
          <Link href={settingsHref} className="font-semibold underline underline-offset-4">
            Pengaturan → Persediaan
          </Link>{" "}
          dengan stok opname awal per barang.
        </p>
      ) : reconciliation.unitemized === 0 ? (
        <p role="status" className="flex flex-wrap items-center gap-2 rounded-lg bg-success-pale px-4 py-3 text-sm text-success-deep">
          <CheckCircle2Icon className="size-4" />
          <strong>Saldo per barang = saldo akun Persediaan</strong>
          <Amount value={reconciliation.accountBalance} />
        </p>
      ) : (
        <p role="status" className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/40 px-4 py-3 text-sm text-destructive">
          <TriangleAlertIcon className="size-4" />
          <strong>Saldo Persediaan belum dirinci per barang:</strong>
          <Amount value={reconciliation.unitemized} />
          <span>(akun {formatAmount(reconciliation.accountBalance)}, per barang {formatAmount(reconciliation.itemizedValue)})</span>
        </p>
      )}

      {current.items.length === 0 ? (
        <p className="rounded-lg bg-card px-4 py-6 text-center text-sm text-muted-foreground">Belum ada barang.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-canvas">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Kode</TableHead>
                <TableHead>Barang</TableHead>
                <TableHead className="w-28 text-right">Stok</TableHead>
                <TableHead className="w-36 text-right">Nilai</TableHead>
                <TableHead className="w-32 text-right">HPP/satuan</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {current.items.map((item) => {
                const stock = snapshot.context.stocks.get(item.id)
                const qty = stock?.qty ?? 0
                const value = stock?.value ?? 0
                return (
                  <TableRow key={item.id}>
                    <TableCell className="text-muted-foreground tabular-nums">{item.code}</TableCell>
                    <TableCell>
                      <span className="font-medium text-ink">{item.name}</span>
                      {!item.isActive && <Badge variant="secondary" className="ml-2">Nonaktif</Badge>}
                      {qty < 0 && <Badge variant="destructive" className="ml-2">Stok minus</Badge>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {qty.toLocaleString("id-ID")} {item.unit}
                    </TableCell>
                    <TableCell className="text-right"><Amount value={value} /></TableCell>
                    <TableCell className="text-right">
                      {qty > 0 ? <Amount value={mulDivRound(value, 1, qty)} /> : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label={`Aksi untuk ${item.name}`}>
                            <MoreHorizontalIcon />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => setCard(item)}>Kartu stok</DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => setEditing(item)}>Ubah</DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() =>
                              run(
                                () => services.itemService.setActive(item.id, !item.isActive),
                                `${item.name} ${item.isActive ? "dinonaktifkan" : "diaktifkan"}`,
                              )
                            }
                          >
                            {item.isActive ? "Nonaktifkan" : "Aktifkan"}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={usedIds.has(item.id)}
                            onSelect={() => run(() => services.itemService.deleteItem(item.id), `${item.name} dihapus`)}
                          >
                            {usedIds.has(item.id) ? "Hapus (sudah dipakai)" : "Hapus"}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {editing && (
        <ItemDialog
          services={services}
          workspaceId={workspaceId}
          item={editing === "new" ? null : editing}
          revenueAccounts={current.accounts.filter((a) => a.accountType === "revenue" && a.isActive && a.systemRole !== "sales_returns")}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            data.reload()
          }}
        />
      )}
      {card && <StockCardDialog data={current} item={card} journalHref={journalHref} onClose={() => setCard(null)} />}
    </div>
  )
}

const formatAmount = (value: number) => `Rp ${value.toLocaleString("id-ID")}`

function ItemDialog({
  services,
  workspaceId,
  item,
  revenueAccounts,
  onClose,
  onSaved,
}: {
  services: AppServices
  workspaceId: string
  item: Item | null
  revenueAccounts: Account[]
  onClose: () => void
  onSaved: () => void
}) {
  const [code, setCode] = useState(item?.code ?? "")
  const [name, setName] = useState(item?.name ?? "")
  const [unit, setUnit] = useState(item?.unit ?? "pcs")
  const [revenueAccountId, setRevenueAccountId] = useState(item?.revenueAccountId ?? revenueAccounts[0]?.id ?? NO_ACCOUNT)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    const input = { code, name, unit, revenueAccountId: revenueAccountId === NO_ACCOUNT ? null : revenueAccountId }
    try {
      const saved = item ? await services.itemService.updateItem(item.id, input) : await services.itemService.createItem(workspaceId, input)
      toast.success(`${saved.code} · ${saved.name} disimpan`)
      onSaved()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{item ? "Ubah barang" : "Tambah barang"}</DialogTitle>
            <DialogDescription>Kuantitas dicatat dalam bilangan bulat satuan dasar (mis. pcs, gram, ml).</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
            <div className="grid gap-2">
              <Label htmlFor="item-code">Kode</Label>
              <Input id="item-code" value={code} onChange={(e) => setCode(e.target.value)} required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="item-name">Nama barang</Label>
              <Input id="item-name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
            <div className="grid gap-2">
              <Label htmlFor="item-unit">Satuan dasar</Label>
              <Input id="item-unit" value={unit} onChange={(e) => setUnit(e.target.value)} required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="item-revenue">Akun pendapatan default</Label>
              <Select value={revenueAccountId} onValueChange={setRevenueAccountId}>
                <SelectTrigger id="item-revenue" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_ACCOUNT}>Tidak dijual (bahan/perlengkapan)</SelectItem>
                  {revenueAccounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.code} · {a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>Batal</Button>
            <Button type="submit" disabled={saving}>{saving ? "Menyimpan…" : "Simpan barang"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function StockCardDialog({
  data,
  item,
  journalHref,
  onClose,
}: {
  data: InventoryData
  item: Item
  journalHref: (entryId: string) => string
  onClose: () => void
}) {
  const rows = stockCard(data.journals, data.accounts, data.workspace.costMethodHistory, item.id)
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Kartu stok · {item.code} {item.name}</DialogTitle>
          <DialogDescription>Mutasi dari jurnal posted, dengan saldo berjalan (satuan: {item.unit}).</DialogDescription>
        </DialogHeader>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Belum ada mutasi.</p>
        ) : (
          <div className="max-h-[60vh] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tanggal</TableHead>
                  <TableHead>Jurnal</TableHead>
                  <TableHead className="text-right">Masuk</TableHead>
                  <TableHead className="text-right">Keluar</TableHead>
                  <TableHead className="text-right">Nilai</TableHead>
                  <TableHead className="text-right">Saldo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={`${row.entryId}-${row.lineNo}`}>
                    <TableCell className="whitespace-nowrap">{formatDate(row.entryDate)}</TableCell>
                    <TableCell>
                      <Link href={journalHref(row.entryId)} className="underline underline-offset-4">{row.entryNumber}</Link>
                      <span className="block text-xs text-muted-foreground">{row.description}</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{row.quantity > 0 ? row.quantity.toLocaleString("id-ID") : ""}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.quantity < 0 ? (-row.quantity).toLocaleString("id-ID") : ""}</TableCell>
                    <TableCell className="text-right"><Amount value={row.value} /></TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.balanceQty.toLocaleString("id-ID")}
                      <span className="block text-xs text-muted-foreground"><Amount value={row.balanceValue} /></span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
