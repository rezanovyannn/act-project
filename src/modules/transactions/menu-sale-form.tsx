"use client"

import { useState } from "react"
import Link from "next/link"
import { InfoIcon, PlusIcon, Trash2Icon } from "lucide-react"
import { formatNumber, todayIsoDate } from "@/core/format"
import { buildMenuSale, type MenuSaleInput, type MenuSalePlan } from "@/core/menu"
import { effectiveTaxSettings, formatTaxSettings } from "@/core/sales-tax"
import type { AppServices } from "@/core/services"
import type { JournalEntry, Menu } from "@/core/types"
import { workspaceTaxSettings } from "@/core/vat"
import { Amount } from "@/components/ui/amount"
import { AmountInput } from "@/components/ui/amount-input"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group"
import { JournalPreview, PostedNotice } from "@/components/ui/journal-preview"
import { Label } from "@/components/ui/label"
import { LoadingState } from "@/components/ui/page-header"
import { PaymentField, initialPayment, toPayment, type PaymentState } from "@/components/ui/payment-field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { errorMessage, useLoader } from "@/lib/utils"
import { activeAccounts, counterpartyNames, type WorkspaceData } from "./use-workspace-data"

interface LineState {
  key: number
  menuId: string
  portions: string
  price: number | null
}

let lineKey = 0
const newLine = (): LineState => ({ key: ++lineKey, menuId: "", portions: "1", price: null })

/** Penjualan per menu (ADR 021): jurnal penjualan + PB1 dan porsi untuk theoretical cost. */
export function MenuSaleForm({
  services,
  data,
  journalHref,
  menusHref,
  onPosted,
}: {
  services: AppServices
  data: WorkspaceData
  journalHref: (entryId: string) => string
  menusHref: string
  onPosted: () => void
}) {
  const menus = useLoader(() => services.menus.listMenus(data.workspace.id), [services, data.workspace.id])
  if (menus.loading && !menus.data) return <LoadingState />
  if (menus.error) return <p role="alert" className="text-sm text-destructive">{errorMessage(menus.error)}</p>
  const active = menus.data!.filter((m) => m.isActive)
  if (active.length === 0) {
    return (
      <p role="note" className="flex gap-2 rounded-2xl bg-card px-4 py-4 text-sm text-ink">
        <InfoIcon className="mt-0.5 size-4 shrink-0" />
        <span>
          Belum ada menu aktif. Tambahkan menu beserta resepnya di{" "}
          <Link href={menusHref} className="font-semibold underline underline-offset-4">Menu &amp; Resep</Link>.
        </span>
      </p>
    )
  }
  return <MenuSaleFormInner services={services} data={data} menus={active} journalHref={journalHref} onPosted={onPosted} />
}

function MenuSaleFormInner({
  services,
  data,
  menus,
  journalHref,
  onPosted,
}: {
  services: AppServices
  data: WorkspaceData
  menus: Menu[]
  journalHref: (entryId: string) => string
  onPosted: () => void
}) {
  const { workspace, accounts, journals } = data
  const cashAccounts = activeAccounts(accounts, (a) => a.isCash)
  const workspaceTax = workspaceTaxSettings(workspace)
  const taxSettings = effectiveTaxSettings(workspaceTax)

  const [entryDate, setEntryDate] = useState(todayIsoDate)
  const [description, setDescription] = useState("Penjualan menu")
  const [payment, setPayment] = useState<PaymentState>(() => initialPayment(cashAccounts))
  const [lines, setLines] = useState<LineState[]>(() => [newLine()])
  const [applyTax, setApplyTax] = useState(workspace.salesTaxRateBps > 0)
  const [error, setError] = useState<string | null>(null)
  const [posted, setPosted] = useState<JournalEntry | null>(null)
  const [saving, setSaving] = useState(false)

  const menuOf = (id: string) => menus.find((m) => m.id === id)
  const priceOf = (line: LineState) => line.price ?? menuOf(line.menuId)?.price ?? 0
  const portionsOf = (line: LineState) => (/^\d+$/.test(line.portions) ? Number(line.portions) : 0)
  const filled = lines.filter((l) => l.menuId && portionsOf(l) > 0)
  const input: MenuSaleInput = {
    workspaceId: workspace.id,
    entryDate,
    description,
    payment: toPayment(payment),
    lines: filled.map((l) => ({ menuId: l.menuId, portions: portionsOf(l), amount: portionsOf(l) * priceOf(l) })),
    applyTax,
    tax: taxSettings,
    taxLabel: workspace.salesTaxLabel,
  }
  let preview: MenuSalePlan | null = null
  let previewError: string | null = null
  if (filled.length > 0) {
    try {
      preview = buildMenuSale(input, menus, accounts)
    } catch (e) {
      previewError = errorMessage(e)
    }
  }
  const update = (key: number, patch: Partial<LineState>) => setLines(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const totalPortions = filled.reduce((t, l) => t + portionsOf(l), 0)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const entry = await services.menuService.postSale(input)
      setPosted(entry)
      setLines([newLine()])
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
      <div className="grid content-start gap-5 rounded-2xl bg-canvas p-4 ring-1 ring-border sm:p-6">
        <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
          <div className="grid gap-2">
            <Label htmlFor="menu-sale-date">Tanggal</Label>
            <Input id="menu-sale-date" type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="menu-sale-description">Keterangan</Label>
            <Input id="menu-sale-description" value={description} onChange={(e) => setDescription(e.target.value)} required />
          </div>
        </div>
        <PaymentField
          cashAccounts={cashAccounts}
          value={payment}
          onChange={setPayment}
          creditLabel="Kredit (piutang pelanggan)"
          counterpartyLabel="Pelanggan"
          counterpartySuggestions={counterpartyNames(journals)}
        />
        <fieldset className="grid gap-3">
          <legend className="mb-2 text-sm font-medium">
            Menu terjual{workspace.salesTaxInclusive && applyTax ? ` (harga termasuk ${workspace.salesTaxLabel})` : ""}
          </legend>
          {lines.map((line, index) => {
            const portions = portionsOf(line)
            return (
              <div key={line.key} className="grid gap-2 rounded-xl bg-card p-3 sm:grid-cols-[minmax(0,1fr)_7.5rem_9rem_2.5rem] sm:items-center sm:bg-transparent sm:p-0">
                <Select value={line.menuId} onValueChange={(menuId) => update(line.key, { menuId, price: null })}>
                  <SelectTrigger aria-label={`Menu baris ${index + 1}`} className="w-full bg-background"><SelectValue placeholder="Pilih menu" /></SelectTrigger>
                  <SelectContent>
                    {menus.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name} <span className="text-muted-foreground">· Rp {formatNumber(m.price)}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <InputGroup>
                  <InputGroupInput
                    aria-label={`Porsi baris ${index + 1}`}
                    inputMode="numeric"
                    value={line.portions}
                    onChange={(e) => update(line.key, { portions: e.target.value.replace(/\D/g, "") })}
                    className="text-right tabular-nums"
                  />
                  <InputGroupAddon align="inline-end"><InputGroupText>porsi</InputGroupText></InputGroupAddon>
                </InputGroup>
                <AmountInput
                  aria-label={`Harga per porsi baris ${index + 1}`}
                  value={priceOf(line)}
                  onValueChange={(price) => update(line.key, { price: price ?? 0 })}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Hapus baris ${index + 1}`}
                  disabled={lines.length === 1}
                  onClick={() => setLines(lines.filter((l) => l.key !== line.key))}
                >
                  <Trash2Icon />
                </Button>
                {line.menuId && portions > 0 && (
                  <p className="text-xs text-muted-foreground sm:col-span-4 sm:-mt-1">
                    Subtotal <Amount value={portions * priceOf(line)} />
                  </p>
                )}
              </div>
            )
          })}
          <Button type="button" variant="secondary" size="sm" className="w-fit" onClick={() => setLines([...lines, newLine()])}>
            <PlusIcon data-icon="inline-start" /> Tambah menu
          </Button>
        </fieldset>
        <label className="flex items-center gap-3 text-sm">
          <Switch checked={applyTax} onCheckedChange={setApplyTax} disabled={workspace.salesTaxRateBps === 0} />
          <span>
            Kenakan {formatTaxSettings(workspaceTax)} ·{" "}
            <span className="text-muted-foreground">harga {workspace.salesTaxInclusive ? "sudah" : "belum"} termasuk {workspace.salesTaxLabel}</span>
          </span>
        </label>
      </div>

      <div className="grid content-start gap-4">
        <dl className="grid gap-2 rounded-2xl bg-canvas p-4 text-sm ring-1 ring-border">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Porsi</dt>
            <dd className="tabular-nums">{formatNumber(totalPortions)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Dasar pengenaan</dt>
            <dd><Amount value={preview?.sale.base ?? 0} /></dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{workspace.salesTaxLabel}</dt>
            <dd><Amount value={preview?.sale.tax ?? 0} /></dd>
          </div>
          <div className="flex justify-between border-t pt-2 font-bold text-ink">
            <dt>Total {payment.method === "credit" ? "piutang" : "diterima"}</dt>
            <dd><Amount value={preview?.sale.total ?? 0} /></dd>
          </div>
        </dl>
        <JournalPreview lines={preview?.entry.lines ?? []} accounts={accounts} />
        <p className="text-xs text-muted-foreground">Porsi tercatat untuk theoretical cost (variance) di Stok Opname &amp; COGS.</p>
        {previewError && <p className="text-sm text-destructive">{previewError}</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {posted && <PostedNotice entry={posted} href={journalHref(posted.id)} />}
        <Button type="submit" size="lg" disabled={saving || !preview}>
          {saving ? "Memposting…" : "Posting penjualan menu"}
        </Button>
      </div>
    </form>
  )
}
