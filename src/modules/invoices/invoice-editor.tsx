"use client"

import { useState } from "react"
import Link from "next/link"
import { EyeIcon, InfoIcon, PencilIcon, PlusIcon, Trash2Icon, TriangleAlertIcon, UserPlusIcon } from "lucide-react"
import { toast } from "sonner"
import { formatDate, todayIsoDate } from "@/core/format"
import {
  defaultDueDate,
  discountAmount,
  formatPercentBps,
  isPurchaseAccount,
  parsePercentBps,
  PENDING_DISCOUNT_ACCOUNT_ID,
  safeLineAmount,
  withDiscountAccount,
  type InvoicePlan,
} from "@/core/invoice"
import { formatTaxSettings } from "@/core/sales-tax"
import type { AppServices } from "@/core/services"
import type { InvoiceData } from "@/core/services/invoice-service"
import type { Contact, Invoice, InvoiceDiscount, InvoiceInput, InvoiceKind } from "@/core/types"
import { computeInputVat, workspaceTaxSettings } from "@/core/vat"
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
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group"
import { JournalPreview } from "@/components/ui/journal-preview"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { errorMessage } from "@/lib/utils"
import { ContactDialog } from "./contacts-view"
import { InvoiceDocument } from "./invoice-document"

const NO_ITEM = "__none__"

interface LineState {
  key: number
  description: string
  quantity: string
  unit: string
  unitPrice: number | null
  accountId: string
  itemId: string | null
}

let lineKey = 0
const toState = (l: Invoice["lines"][number]): LineState => ({
  key: ++lineKey,
  description: l.description,
  quantity: String(l.quantity),
  unit: l.unit ?? "",
  unitPrice: l.unitPrice,
  accountId: l.accountId,
  itemId: l.itemId,
})

/** Editor faktur penjualan/pembelian (draft) dengan pratinjau jurnal & dokumen (ADR 022). */
export function InvoiceEditor({
  services,
  kind,
  data,
  invoice,
  contactsHref,
  profileHref,
  onSaved,
  onIssued,
  onDeleted,
}: {
  services: AppServices
  kind: InvoiceKind
  data: InvoiceData
  /** Draft yang diubah; null = faktur baru. */
  invoice: Invoice | null
  contactsHref: string
  profileHref: string
  onSaved: (invoice: Invoice) => void
  onIssued: (invoice: Invoice) => void
  onDeleted: () => void
}) {
  const { workspace, accounts, items } = data
  const today = todayIsoDate()
  const isSale = kind === "sale"
  const inventoryAccount = accounts.find((a) => a.systemRole === "inventory" && a.deletedAt === null) ?? null
  const lineAccounts = isSale
    ? accounts.filter((a) => a.accountType === "revenue" && a.isActive && a.systemRole !== "sales_returns")
    : accounts.filter((a) => a.isActive && isPurchaseAccount(a))
  const defaultAccount = isSale ? lineAccounts[0]?.id : (lineAccounts.find((a) => a.accountType === "expense") ?? lineAccounts[0])?.id
  const activeItems = items.filter((i) => i.isActive)
  const taxSettings = workspaceTaxSettings(workspace)
  // Pembelian: PPN Masukan hanya pada mode PPN lengkap (ADR 016).
  const taxAvailable = isSale ? taxSettings.rateBps > 0 : taxSettings.mode === "full_vat" && taxSettings.rateBps > 0
  const partyLabel = isSale ? "Pelanggan" : "Pemasok"
  const newLine = (): LineState => ({ key: ++lineKey, description: "", quantity: "1", unit: "", unitPrice: null, accountId: defaultAccount ?? "", itemId: null })

  const [contacts, setContacts] = useState<Contact[]>(data.contacts)
  const customers = contacts.filter((c) => (isSale ? c.isCustomer : c.isSupplier))
  const [contactId, setContactId] = useState(invoice?.contactId ?? "")
  const [invoiceDate, setInvoiceDate] = useState(invoice?.invoiceDate ?? today)
  const [dueDate, setDueDate] = useState(invoice?.dueDate ?? today)
  const [dueTouched, setDueTouched] = useState(Boolean(invoice))
  const [reference, setReference] = useState(invoice?.reference ?? "")
  const [notes, setNotes] = useState(invoice?.notes ?? "")
  const [applyTax, setApplyTax] = useState(invoice?.applyTax ?? taxAvailable)
  const [taxOverride, setTaxOverride] = useState<number | null>(invoice?.taxOverride ?? null)
  const [discountKind, setDiscountKind] = useState<"none" | InvoiceDiscount["kind"]>(invoice?.discount?.kind ?? "none")
  const [discountPercent, setDiscountPercent] = useState(
    invoice?.discount?.kind === "percent" ? formatPercentBps(invoice.discount.value).replace("%", "") : "",
  )
  const [discountRupiah, setDiscountRupiah] = useState<number | null>(invoice?.discount?.kind === "amount" ? invoice.discount.value : null)
  const [lines, setLines] = useState<LineState[]>(() => (invoice?.lines.length ? invoice.lines.map(toState) : [newLine()]))
  const [addingContact, setAddingContact] = useState(false)
  const [preview, setPreview] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<"save" | "issue" | null>(null)

  const contact = contacts.find((c) => c.id === contactId) ?? null
  const changeContact = (id: string) => {
    setContactId(id)
    if (!dueTouched) setDueDate(defaultDueDate(invoiceDate, contacts.find((c) => c.id === id)))
  }
  const changeDate = (date: string) => {
    setInvoiceDate(date)
    if (!dueTouched && date) setDueDate(defaultDueDate(date, contact))
  }
  const update = (key: number, patch: Partial<LineState>) => setLines((all) => all.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const pickItem = (line: LineState, itemId: string) => {
    if (itemId === NO_ITEM) return update(line.key, { itemId: null })
    const item = items.find((i) => i.id === itemId)
    if (!item) return
    update(line.key, {
      itemId,
      description: line.description || item.name,
      unit: line.unit || item.unit,
      accountId: isSale
        ? item.revenueAccountId && lineAccounts.some((a) => a.id === item.revenueAccountId) ? item.revenueAccountId : line.accountId
        : inventoryAccount?.id ?? line.accountId,
    })
  }

  const qtyOf = (l: LineState) => (/^\d+$/.test(l.quantity) ? Number(l.quantity) : 0)
  const percentBps = discountKind === "percent" ? parsePercentBps(discountPercent || "0") : null
  const discount: InvoiceDiscount | null =
    discountKind === "percent" && percentBps ? { kind: "percent", value: percentBps } : discountKind === "amount" && discountRupiah ? { kind: "amount", value: discountRupiah } : null
  const input: InvoiceInput = {
    workspaceId: workspace.id,
    kind,
    contactId: contactId || null,
    invoiceDate,
    dueDate,
    reference,
    notes,
    applyTax: applyTax && taxAvailable,
    taxOverride: isSale ? null : taxOverride,
    discount,
    lines: lines
      .filter((l) => l.description.trim() || l.unitPrice || l.itemId)
      .map((l) => ({ description: l.description, quantity: qtyOf(l), unit: l.unit, unitPrice: l.unitPrice ?? 0, accountId: l.accountId, itemId: l.itemId })),
  }
  let plan: InvoicePlan | null = null
  let planError: string | null = null
  try {
    plan = services.invoiceService.plan(input, { ...data, contacts })
  } catch (e) {
    planError = errorMessage(e)
  }
  const subtotal = input.lines.reduce((t, l) => t + safeLineAmount(l), 0)
  const discountRp = discountAmount(subtotal, discount)
  const suggestedVat = !isSale && taxAvailable ? computeInputVat(Math.max(subtotal - discountRp, 0), taxSettings) : 0
  const previewAccounts = isSale ? withDiscountAccount(accounts) : accounts
  const pendingDiscountAccount = plan?.entry.lines.some((l) => l.accountId === PENDING_DISCOUNT_ACCOUNT_ID) ?? false

  async function save() {
    setBusy("save")
    setError(null)
    try {
      const saved = await services.invoiceService.saveDraft(input, invoice?.id)
      toast.success("Draft faktur disimpan")
      onSaved(saved)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  async function issue() {
    setBusy("issue")
    setError(null)
    try {
      const issued = await services.invoiceService.issue(input, invoice?.id)
      toast.success(`Faktur ${issued.number} diterbitkan`)
      onIssued(issued)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  async function remove() {
    if (!invoice) return
    try {
      await services.invoiceService.deleteDraft(invoice.id)
      toast.success("Draft faktur dihapus")
      onDeleted()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  if (preview) {
    return (
      <div className="grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
          <Button variant="secondary" onClick={() => setPreview(false)}>
            <PencilIcon data-icon="inline-start" /> Kembali mengubah
          </Button>
          <p className="text-sm text-muted-foreground">Pratinjau draft — nomor diberikan saat diterbitkan.</p>
        </div>
        <InvoiceDocument
          invoice={{ ...input, id: invoice?.id ?? "", status: "draft", number: null, journalEntryId: null, contactSnapshot: null, issuedAt: null, createdAt: "", updatedAt: "", lines: input.lines }}
          profile={data.profile}
          workspaceName={workspace.name}
          contact={contact}
          totals={plan?.totals ?? { base: subtotal, tax: 0, total: subtotal }}
          taxLabel={isSale ? workspace.salesTaxLabel : "PPN Masukan"}
          taxInclusive={workspace.salesTaxInclusive}
          stamp="DRAFT"
        />
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="grid content-start gap-5 rounded-2xl bg-canvas p-4 ring-1 ring-border sm:p-6">
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_11rem_11rem]">
          <div className="grid gap-2">
            <Label htmlFor="invoice-contact">{partyLabel}</Label>
            <div className="flex gap-2">
              <Select value={contactId} onValueChange={changeContact}>
                <SelectTrigger id="invoice-contact" className="w-full bg-background"><SelectValue placeholder={`Pilih ${partyLabel.toLowerCase()}`} /></SelectTrigger>
                <SelectContent>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button type="button" variant="secondary" size="icon" aria-label="Kontak baru" onClick={() => setAddingContact(true)}>
                <UserPlusIcon />
              </Button>
            </div>
            {contact && (
              <p className="text-xs text-muted-foreground">
                {[contact.address, contact.npwp && `NPWP ${contact.npwp}`, `termin ${contact.paymentTermDays} hari`].filter(Boolean).join(" · ")}
              </p>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="invoice-date">Tanggal faktur</Label>
            <Input id="invoice-date" type="date" value={invoiceDate} onChange={(e) => changeDate(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="invoice-due">Jatuh tempo</Label>
            <Input
              id="invoice-due"
              type="date"
              value={dueDate}
              onChange={(e) => {
                setDueTouched(true)
                setDueDate(e.target.value)
              }}
            />
          </div>
        </div>
        <div className="grid gap-2 md:max-w-sm">
          <Label htmlFor="invoice-reference">{isSale ? "Referensi (opsional)" : "No. faktur pemasok"}</Label>
          <Input
            id="invoice-reference"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder={isSale ? "mis. No. PO pelanggan" : "Nomor yang tertera di faktur pemasok"}
          />
        </div>

        <fieldset className="grid gap-3">
          <legend className="mb-2 text-sm font-medium">
            Rincian{isSale && workspace.salesTaxInclusive && applyTax ? ` (harga termasuk ${workspace.salesTaxLabel})` : !isSale && taxAvailable ? " (harga sebelum PPN)" : ""}
          </legend>
          {lines.map((line, index) => {
            const n = index + 1
            const amount = safeLineAmount({ quantity: qtyOf(line), unitPrice: line.unitPrice ?? 0 })
            return (
              <div key={line.key} className="grid gap-2 rounded-xl bg-card/60 p-3 ring-1 ring-border">
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_14rem]">
                  <Input aria-label={`Keterangan baris ${n}`} placeholder="Keterangan" value={line.description} onChange={(e) => update(line.key, { description: e.target.value })} className="bg-background" />
                  <Select value={line.itemId ?? NO_ITEM} onValueChange={(v) => pickItem(line, v)}>
                    <SelectTrigger aria-label={`Barang baris ${n}`} className="w-full bg-background"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_ITEM}>Tanpa barang</SelectItem>
                      {activeItems.map((i) => (
                        <SelectItem key={i.id} value={i.id}>{i.name} <span className="text-muted-foreground">· {i.code}</span></SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-[6rem_6rem_9rem_minmax(0,1fr)_8rem_2.5rem] sm:items-center">
                  <Input aria-label={`Qty baris ${n}`} inputMode="numeric" value={line.quantity} onChange={(e) => update(line.key, { quantity: e.target.value.replace(/\D/g, "") })} className="bg-background text-right tabular-nums" />
                  <Input aria-label={`Satuan baris ${n}`} placeholder="Satuan" value={line.unit} onChange={(e) => update(line.key, { unit: e.target.value })} className="bg-background" />
                  <AmountInput aria-label={`Harga baris ${n}`} value={line.unitPrice} onValueChange={(v) => update(line.key, { unitPrice: v })} />
                  <Select value={line.accountId} onValueChange={(accountId) => update(line.key, { accountId })} disabled={!isSale && Boolean(line.itemId)}>
                    <SelectTrigger aria-label={`Akun baris ${n}`} className="w-full bg-background"><SelectValue placeholder={isSale ? "Akun pendapatan" : "Akun persediaan/beban"} /></SelectTrigger>
                    <SelectContent>
                      {lineAccounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>{a.code} · {a.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-right font-semibold text-ink"><Amount value={amount} /></p>
                  <Button type="button" variant="ghost" size="icon" aria-label={`Hapus baris ${n}`} disabled={lines.length === 1} onClick={() => setLines(lines.filter((l) => l.key !== line.key))}>
                    <Trash2Icon />
                  </Button>
                </div>
              </div>
            )
          })}
          <Button type="button" variant="secondary" size="sm" className="w-fit" onClick={() => setLines([...lines, newLine()])}>
            <PlusIcon data-icon="inline-start" /> Tambah baris
          </Button>
        </fieldset>

        <div className="grid gap-2 sm:grid-cols-[12rem_10rem] sm:items-end">
          <div className="grid gap-1.5">
            <Label htmlFor="invoice-discount-kind">Diskon faktur</Label>
            <Select value={discountKind} onValueChange={(v) => setDiscountKind(v as typeof discountKind)}>
              <SelectTrigger id="invoice-discount-kind" className="w-full bg-background"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Tanpa diskon</SelectItem>
                <SelectItem value="percent">Persen (%)</SelectItem>
                <SelectItem value="amount">Rupiah</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {discountKind === "percent" && (
            <InputGroup>
              <InputGroupInput
                aria-label="Diskon persen"
                inputMode="decimal"
                placeholder="0"
                value={discountPercent}
                onChange={(e) => setDiscountPercent(e.target.value.replace(/[^\d.,]/g, ""))}
                className="text-right tabular-nums"
              />
              <InputGroupAddon align="inline-end"><InputGroupText>%</InputGroupText></InputGroupAddon>
            </InputGroup>
          )}
          {discountKind === "amount" && <AmountInput aria-label="Diskon rupiah" value={discountRupiah} onValueChange={setDiscountRupiah} />}
          {discountKind === "percent" && discountPercent && percentBps === null && (
            <p className="text-xs text-destructive sm:col-span-2">Persen 0–100 dengan maks. 2 desimal, mis. 12,5</p>
          )}
          {discountRp > 0 && (
            <p className="text-xs text-muted-foreground sm:col-span-2">
              {isSale
                ? `Pajak dihitung dari harga setelah diskon; diskon dicatat ke akun Retur & Potongan Penjualan.`
                : `Diskon mengurangi harga pokok/beban tiap baris secara proporsional.`}
            </p>
          )}
        </div>

        {isSale ? (
          <label className="flex items-center gap-3 text-sm">
            <Switch checked={applyTax} onCheckedChange={setApplyTax} disabled={!taxAvailable} />
            <span>
              Kenakan {formatTaxSettings(taxSettings)} ·{" "}
              <span className="text-muted-foreground">harga {workspace.salesTaxInclusive ? "sudah" : "belum"} termasuk {workspace.salesTaxLabel}</span>
            </span>
          </label>
        ) : (
          taxAvailable && (
            <div className="grid gap-3 sm:grid-cols-[auto_14rem] sm:items-center">
              <label className="flex items-center gap-3 text-sm">
                <Switch checked={applyTax} onCheckedChange={setApplyTax} />
                <span>PPN Masukan {formatTaxSettings(taxSettings)} (dapat dikreditkan)</span>
              </label>
              {applyTax && (
                <div className="grid gap-1">
                  <Label htmlFor="invoice-vat" className="text-xs">PPN sesuai faktur pemasok</Label>
                  <AmountInput id="invoice-vat" value={taxOverride ?? suggestedVat} onValueChange={(v) => setTaxOverride(v === suggestedVat ? null : v)} />
                </div>
              )}
            </div>
          )
        )}
        <div className="grid gap-2">
          <Label htmlFor="invoice-notes">Catatan di faktur (opsional)</Label>
          <Textarea id="invoice-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>

      <aside className="grid content-start gap-4">
        <dl className="grid gap-2 rounded-2xl bg-canvas p-4 text-sm ring-1 ring-border">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Subtotal</dt>
            <dd><Amount value={subtotal} /></dd>
          </div>
          {discountRp > 0 && (
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Diskon{discount?.kind === "percent" ? ` ${formatPercentBps(discount.value)}` : ""}</dt>
              <dd><Amount value={-discountRp} /></dd>
            </div>
          )}
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{isSale ? workspace.salesTaxLabel : "PPN Masukan"}</dt>
            <dd><Amount value={plan?.totals.tax ?? 0} /></dd>
          </div>
          <div className="flex justify-between border-t pt-2 font-bold text-ink">
            <dt>Total {isSale ? "piutang" : "utang"}</dt>
            <dd><Amount value={plan?.totals.total ?? subtotal - discountRp} /></dd>
          </div>
          <p className="text-xs text-muted-foreground">Jatuh tempo {dueDate ? formatDate(dueDate) : "—"}</p>
        </dl>
        {plan ? (
          <JournalPreview lines={plan.entry.lines} accounts={previewAccounts} title="Jurnal saat diterbitkan" />
        ) : (
          planError && (
            <p className="flex gap-2 rounded-2xl bg-card px-4 py-3 text-sm text-ink">
              <InfoIcon className="mt-0.5 size-4 shrink-0" /> Sebelum terbit: {planError}
            </p>
          )
        )}
        {pendingDiscountAccount && (
          <p className="flex gap-2 text-xs text-muted-foreground">
            <InfoIcon className="mt-0.5 size-3.5 shrink-0" /> Akun 4-1900 Retur & Potongan Penjualan dibuat otomatis saat faktur diterbitkan.
          </p>
        )}
        {plan?.warnings.map((w) => (
          <p key={w} className="flex gap-2 text-sm text-ink"><TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />{w}</p>
        ))}
        {!data.profile.updatedAt && (
          <p className="flex gap-2 text-xs text-muted-foreground">
            <InfoIcon className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Kop faktur belum diisi. Lengkapi alamat, NPWP, rekening & logo di{" "}
              <Link href={profileHref} className="underline underline-offset-4">Pengaturan → Profil Usaha</Link>.
            </span>
          </p>
        )}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="grid gap-2">
          <Dialog>
            <DialogTrigger asChild>
              <Button size="lg" disabled={!plan || busy !== null}>{busy === "issue" ? "Menerbitkan…" : "Terbitkan faktur"}</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Terbitkan faktur?</DialogTitle>
                <DialogDescription>
                  Faktur diberi nomor dan jurnal {isSale ? "piutang" : "utang"} diposting tanggal {formatDate(invoiceDate)}. Setelah terbit, faktur tidak bisa diubah;
                  koreksi dilakukan dengan membatalkan lalu menyalin ke draft baru.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose asChild><Button variant="secondary">Batal</Button></DialogClose>
                <DialogClose asChild><Button onClick={issue}>Terbitkan</Button></DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" disabled={busy !== null} onClick={save}>{busy === "save" ? "Menyimpan…" : "Simpan draft"}</Button>
            <Button variant="secondary" onClick={() => setPreview(true)}>
              <EyeIcon data-icon="inline-start" /> Pratinjau
            </Button>
          </div>
          {invoice && (
            <Button variant="ghost" className="text-destructive" onClick={remove}>
              <Trash2Icon data-icon="inline-start" /> Hapus draft
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {partyLabel} diambil dari <Link href={contactsHref} className="underline underline-offset-4">Kontak</Link>.
        </p>
      </aside>

      {addingContact && (
        <ContactDialog
          services={services}
          workspaceId={workspace.id}
          contact={null}
          defaults={isSale ? { isCustomer: true } : { isCustomer: false, isSupplier: true }}
          onClose={() => setAddingContact(false)}
          onSaved={(saved) => {
            setAddingContact(false)
            setContacts((all) => [...all, saved].sort((a, b) => a.name.localeCompare(b.name, "id")))
            setContactId(saved.id)
            if (!dueTouched) setDueDate(defaultDueDate(invoiceDate, saved))
          }}
        />
      )}
    </div>
  )
}
