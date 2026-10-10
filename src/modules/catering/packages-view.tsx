"use client"

import { useState } from "react"
import Link from "next/link"
import { ChefHatIcon, InfoIcon, MoreHorizontalIcon, PlusIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"
import { materialsEstimate, type ItemPrice } from "@/core/catering"
import { formatNumber, formatPercentBps, todayIsoDate } from "@/core/format"
import type { AppServices } from "@/core/services"
import type { CateringData } from "@/core/services/catering-service"
import type { CateringPackage, CateringPackageInput } from "@/core/types"
import { Amount } from "@/components/ui/amount"
import { AmountInput } from "@/components/ui/amount-input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group"
import { Label } from "@/components/ui/label"
import { LoadingState, PageHeader } from "@/components/ui/page-header"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { errorMessage, useLoader } from "@/lib/utils"

const NO_ACCOUNT = "__default__"

/** Biaya bahan per pax menurut resep & harga bahan (dibulatkan). */
function costPerPax(pkg: Pick<CateringPackage, "id" | "lines" | "yieldPax"> & Partial<CateringPackage>, prices: ReadonlyMap<string, ItemPrice | null>) {
  const estimate = materialsEstimate([{ description: "", quantity: pkg.yieldPax, unit: null, unitPrice: 0, accountId: "", itemId: null, packageId: pkg.id }], [pkg as CateringPackage], prices)
  return { cost: Math.round(estimate.cost / pkg.yieldPax), missing: estimate.missing }
}

/** Paket menu katering: harga per pax & resep bahan per pax (Fase 10C). */
export function PackagesView({ services, workspaceId, itemsHref }: { services: AppServices; workspaceId: string; itemsHref: string }) {
  const data = useLoader(() => services.cateringService.data(workspaceId), [services, workspaceId])
  const [editing, setEditing] = useState<CateringPackage | "new" | null>(null)

  if (data.loading && !data.data) return <LoadingState />
  if (data.error) return <p role="alert" className="text-sm text-destructive">{errorMessage(data.error)}</p>
  const current = data.data!
  const prices = services.cateringService.prices(current, todayIsoDate())

  async function run(action: () => Promise<unknown>, message: string) {
    try {
      await action()
      toast.success(message)
      data.reload()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <div className="grid grid-cols-1 gap-5">
      <PageHeader
        title="Paket Menu"
        description="Paket katering dengan harga per pax dan resep bahan. Dipilih di baris pesanan untuk mengisi harga, estimasi biaya bahan, dan daftar belanja."
        actions={<Button onClick={() => setEditing("new")}><PlusIcon data-icon="inline-start" /> Paket baru</Button>}
      />
      {current.packages.length === 0 ? (
        <div className="grid justify-items-center gap-2 rounded-2xl bg-card px-4 py-10 text-center">
          <ChefHatIcon className="size-8 text-muted-foreground" />
          <p className="font-semibold text-ink">Belum ada paket menu</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Siapkan dulu bahan di <Link href={itemsHref} className="underline underline-offset-4">Daftar Barang</Link> (beserta harga perkiraan), lalu buat paket dan resepnya.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl bg-canvas ring-1 ring-border">
          <table className="w-full min-w-[52rem] text-sm">
            <thead className="bg-card text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              <tr>
                <th className="px-4 py-2.5">Paket</th>
                <th className="px-3 py-2.5 text-right">Harga/pax</th>
                <th className="px-3 py-2.5 text-right">Bahan/pax</th>
                <th className="px-3 py-2.5 text-right">Margin bahan</th>
                <th className="px-3 py-2.5">Resep</th>
                <th className="w-12" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {current.packages.map((pkg) => {
                const { cost, missing } = costPerPax(pkg, prices)
                return (
                  <tr key={pkg.id}>
                    <td className="px-4 py-2.5">
                      <button type="button" className="font-semibold text-ink hover:underline" onClick={() => setEditing(pkg)}>{pkg.code} · {pkg.name}</button>
                      {!pkg.isActive && <Badge variant="secondary" className="ml-2">Nonaktif</Badge>}
                      {pkg.description && <span className="block max-w-md truncate text-xs text-muted-foreground">{pkg.description}</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right"><Amount value={pkg.pricePerPax} /></td>
                    <td className="px-3 py-2.5 text-right">
                      <Amount value={cost} />
                      {missing.length > 0 && <span className="block text-xs text-destructive">{missing.length} bahan tanpa harga</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{pkg.pricePerPax > 0 ? formatPercentBps(Math.round(((pkg.pricePerPax - cost) * 10_000) / pkg.pricePerPax)) : "—"}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{pkg.lines.length} bahan · untuk {formatNumber(pkg.yieldPax)} pax</td>
                    <td className="px-2 py-2.5">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label={`Aksi untuk ${pkg.name}`}><MoreHorizontalIcon /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => setEditing(pkg)}>Ubah</DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => run(() => services.cateringService.setPackageActive(pkg.id, !pkg.isActive), pkg.isActive ? `${pkg.name} dinonaktifkan` : `${pkg.name} diaktifkan`)}>
                            {pkg.isActive ? "Nonaktifkan" : "Aktifkan"}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive" onSelect={() => run(() => services.cateringService.deletePackage(pkg.id), `${pkg.name} dihapus`)}>Hapus</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="flex gap-2 text-xs text-muted-foreground">
        <InfoIcon className="mt-0.5 size-3.5 shrink-0" />
        Harga bahan: pembelian terakhir lewat Pembelian Bahan Baku; bila belum ada, harga perkiraan di Daftar Barang.
      </p>
      {editing && (
        <PackageDialog
          services={services}
          data={current}
          prices={prices}
          pkg={editing === "new" ? null : editing}
          itemsHref={itemsHref}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            data.reload()
          }}
        />
      )}
    </div>
  )
}

interface LineState {
  key: number
  itemId: string
  quantity: string
}
let lineKey = 0

function PackageDialog({
  services,
  data,
  prices,
  pkg,
  itemsHref,
  onClose,
  onSaved,
}: {
  services: AppServices
  data: CateringData
  prices: ReadonlyMap<string, ItemPrice | null>
  pkg: CateringPackage | null
  itemsHref: string
  onClose: () => void
  onSaved: () => void
}) {
  const revenue = data.accounts.filter((a) => a.accountType === "revenue" && a.isActive && a.systemRole !== "sales_returns")
  const items = data.items.filter((i) => i.isActive || pkg?.lines.some((l) => l.itemId === i.id))
  const [code, setCode] = useState(pkg?.code ?? "")
  const [name, setName] = useState(pkg?.name ?? "")
  const [description, setDescription] = useState(pkg?.description ?? "")
  const [price, setPrice] = useState<number | null>(pkg?.pricePerPax ?? null)
  const [accountId, setAccountId] = useState(pkg?.revenueAccountId ?? NO_ACCOUNT)
  const [yieldPax, setYieldPax] = useState(String(pkg?.yieldPax ?? 1))
  const [lines, setLines] = useState<LineState[]>(() =>
    pkg?.lines.length ? pkg.lines.map((l) => ({ key: ++lineKey, itemId: l.itemId, quantity: String(l.quantity) })) : [{ key: ++lineKey, itemId: "", quantity: "" }],
  )
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const yieldNumber = /^\d+$/.test(yieldPax) ? Number(yieldPax) : 0
  const input: CateringPackageInput = {
    code,
    name,
    description: description || null,
    pricePerPax: price ?? 0,
    revenueAccountId: accountId === NO_ACCOUNT ? null : accountId,
    yieldPax: yieldNumber,
    lines: lines.filter((l) => l.itemId).map((l) => ({ itemId: l.itemId, quantity: /^\d+$/.test(l.quantity) ? Number(l.quantity) : 0 })),
  }
  const preview = yieldNumber > 0 ? costPerPax({ ...input, id: "preview" }, prices) : { cost: 0, missing: [] }
  const update = (key: number, patch: Partial<LineState>) => setLines((all) => all.map((l) => (l.key === key ? { ...l, ...patch } : l)))

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const saved = await services.cateringService.savePackage(data.workspace.id, input, pkg?.id)
      toast.success(`Paket ${saved.code} · ${saved.name} disimpan`)
      onSaved()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{pkg ? "Ubah paket" : "Paket baru"}</DialogTitle>
            <DialogDescription>Resep diisi dalam satuan dasar bahan untuk sejumlah pax (mis. 10 pax), agar takaran kecil tetap bulat.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-[9rem_minmax(0,1fr)]">
            <div className="grid gap-2">
              <Label htmlFor="package-code">Kode</Label>
              <Input id="package-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="mis. PA" required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="package-name">Nama paket</Label>
              <Input id="package-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="mis. Prasmanan A" required />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="package-description">Isi paket (tampil di quotation, opsional)</Label>
            <Textarea id="package-description" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="mis. Nasi putih, ayam bakar, sayur asem, kerupuk, buah" />
          </div>
          <div className="grid gap-4 sm:grid-cols-[11rem_minmax(0,1fr)]">
            <div className="grid gap-2">
              <Label htmlFor="package-price">Harga per pax</Label>
              <AmountInput id="package-price" value={price} onValueChange={setPrice} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="package-account">Akun pendapatan</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger id="package-account" className="w-full bg-background"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_ACCOUNT}>Default baris pesanan</SelectItem>
                  {revenue.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.code} · {a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <fieldset className="grid gap-2">
            <legend className="mb-1 flex flex-wrap items-center gap-2 text-sm font-medium">
              Resep bahan untuk
              <InputGroup className="w-28">
                <InputGroupInput aria-label="Resep untuk berapa pax" inputMode="numeric" value={yieldPax} onChange={(e) => setYieldPax(e.target.value.replace(/\D/g, ""))} className="text-right tabular-nums" />
                <InputGroupAddon align="inline-end"><InputGroupText>pax</InputGroupText></InputGroupAddon>
              </InputGroup>
            </legend>
            {lines.map((line, index) => {
              const item = data.items.find((i) => i.id === line.itemId)
              return (
                <div key={line.key} className="grid grid-cols-[minmax(0,1fr)_8rem_2.5rem] items-center gap-2">
                  <Select value={line.itemId} onValueChange={(itemId) => update(line.key, { itemId })}>
                    <SelectTrigger aria-label={`Bahan ${index + 1}`} className="w-full bg-background"><SelectValue placeholder="Pilih bahan" /></SelectTrigger>
                    <SelectContent>
                      {items.map((i) => (
                        <SelectItem key={i.id} value={i.id}>{i.name} <span className="text-muted-foreground">· {i.unit}</span></SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <InputGroup>
                    <InputGroupInput aria-label={`Qty bahan ${index + 1}`} inputMode="numeric" value={line.quantity} onChange={(e) => update(line.key, { quantity: e.target.value.replace(/\D/g, "") })} className="text-right tabular-nums" />
                    <InputGroupAddon align="inline-end"><InputGroupText>{item?.unit ?? "—"}</InputGroupText></InputGroupAddon>
                  </InputGroup>
                  <Button type="button" variant="ghost" size="icon" aria-label={`Hapus bahan ${index + 1}`} disabled={lines.length === 1} onClick={() => setLines(lines.filter((l) => l.key !== line.key))}>
                    <Trash2Icon />
                  </Button>
                </div>
              )
            })}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={() => setLines([...lines, { key: ++lineKey, itemId: "", quantity: "" }])}>
                <PlusIcon data-icon="inline-start" /> Tambah bahan
              </Button>
              <Link href={itemsHref} className="text-xs text-muted-foreground underline underline-offset-4">Bahan belum ada? Tambah di Daftar Barang</Link>
            </div>
          </fieldset>
          <p className="rounded-2xl bg-card px-4 py-3 text-sm">
            Biaya bahan ≈ <strong><Amount value={preview.cost} /></strong> per pax
            {price ? <> · margin bahan <strong>{formatPercentBps(Math.round((((price ?? 0) - preview.cost) * 10_000) / price))}</strong></> : null}
            {preview.missing.length > 0 && (
              <span className="block text-xs text-destructive">
                Belum ada harga: {preview.missing.map((id) => data.items.find((i) => i.id === id)?.name).join(", ")}. Isi harga perkiraan di Daftar Barang.
              </span>
            )}
          </p>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>Batal</Button>
            <Button type="submit" disabled={saving}>{saving ? "Menyimpan…" : "Simpan paket"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

