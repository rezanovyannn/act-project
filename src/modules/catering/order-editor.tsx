"use client"

import { useState } from "react"
import Link from "next/link"
import { EyeIcon, InfoIcon, PencilIcon, PlusIcon, Trash2Icon, UserPlusIcon } from "lucide-react"
import { toast } from "sonner"
import { COST_CATEGORY_LABELS, costCategoriesFor, DEFAULT_CANCELLATION_POLICY, lineFromPackage, orderTotals, SERVICE_TYPE_LABELS } from "@/core/catering"
import { addDays } from "@/core/dates"
import { todayIsoDate } from "@/core/format"
import { formatPercentBps, parsePercentBps, safeLineAmount } from "@/core/invoice"
import { formatTaxSettings } from "@/core/sales-tax"
import type { AppServices } from "@/core/services"
import type { CateringData } from "@/core/services/catering-service"
import type { CancellationPolicy, CateringOrder, CateringOrderInput, CateringServiceType, Contact, CostCategory, CostEstimates, InvoiceDiscount } from "@/core/types"
import { workspaceTaxSettings } from "@/core/vat"
import { Amount } from "@/components/ui/amount"
import { AmountInput } from "@/components/ui/amount-input"
import { Button } from "@/components/ui/button"
import { CancellationPolicyField } from "@/components/ui/cancellation-policy-field"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { errorMessage } from "@/lib/utils"
import { QuotationDocument } from "./order-documents"

/** Dialog kontak dari composition root (modul tidak saling import). */
export type ContactDialogRenderer = (props: { onClose: () => void; onSaved: (contact: Contact) => void }) => React.ReactNode

interface LineState {
  key: number
  description: string
  quantity: string
  unit: string
  unitPrice: number | null
  accountId: string
  /** Paket menu (Fase 10C); null = baris bebas. */
  packageId: string | null
}

const NO_PACKAGE = "__none__"

let lineKey = 0

/** Form penawaran/pesanan katering (ADR 024). */
export function OrderEditor({
  services,
  data,
  order,
  contactsHref,
  profileHref,
  taxHref,
  renderContactDialog,
  onSaved,
  onCancel,
}: {
  services: AppServices
  data: CateringData
  /** null = pesanan baru (penawaran). */
  order: CateringOrder | null
  contactsHref: string
  profileHref: string
  taxHref: string
  renderContactDialog: ContactDialogRenderer
  onSaved: (order: CateringOrder) => void
  onCancel?: () => void
}) {
  const { workspace, accounts } = data
  const today = todayIsoDate()
  const revenueAccounts = accounts.filter((a) => a.accountType === "revenue" && a.isActive && a.systemRole !== "sales_returns" && a.deletedAt === null)
  const mainRevenue = revenueAccounts.find((a) => a.code === "4-1000") ?? revenueAccounts[0]
  const taxSettings = workspaceTaxSettings(workspace)
  const taxAvailable = taxSettings.rateBps > 0

  const [contacts, setContacts] = useState<Contact[]>(data.contacts)
  const customers = contacts.filter((c) => c.isCustomer)
  const [contactId, setContactId] = useState(order?.contactId ?? "")
  const [serviceType, setServiceType] = useState<CateringServiceType>(order?.serviceType ?? "event")
  const [eventDate, setEventDate] = useState(order?.eventDate ?? addDays(today, 14))
  const [eventTime, setEventTime] = useState(order?.eventTime ?? "")
  const [location, setLocation] = useState(order?.location ?? "")
  const [pax, setPax] = useState(String(order?.pax ?? ""))
  const [quoteDate, setQuoteDate] = useState(order?.quoteDate ?? today)
  const [validUntil, setValidUntil] = useState(order?.validUntil ?? addDays(today, 7))
  const [applyTax, setApplyTax] = useState(order?.applyTax ?? taxAvailable)
  const [notes, setNotes] = useState(order?.notes ?? "")
  const [policy, setPolicy] = useState<CancellationPolicy | null>(order?.cancellationPolicy ?? { ...DEFAULT_CANCELLATION_POLICY })
  const [policyKey, setPolicyKey] = useState(0)
  const [discountKind, setDiscountKind] = useState<"none" | InvoiceDiscount["kind"]>(order?.discount?.kind ?? "none")
  const [discountPercent, setDiscountPercent] = useState(order?.discount?.kind === "percent" ? formatPercentBps(order.discount.value).replace("%", "") : "")
  const [discountRupiah, setDiscountRupiah] = useState<number | null>(order?.discount?.kind === "amount" ? order.discount.value : null)
  const [lines, setLines] = useState<LineState[]>(() =>
    order?.lines.length
      ? order.lines.map((l) => ({ key: ++lineKey, description: l.description, quantity: String(l.quantity), unit: l.unit ?? "", unitPrice: l.unitPrice, accountId: l.accountId, packageId: l.packageId ?? null }))
      : [{ key: ++lineKey, description: "", quantity: "", unit: "pax", unitPrice: null, accountId: mainRevenue?.id ?? "", packageId: null }],
  )
  const costCategories = costCategoriesFor(workspace.cateringSettings.costMode)
  const [estimates, setEstimates] = useState<Partial<Record<CostCategory, number | null>>>(() => ({ ...(order?.costEstimates ?? {}) }))
  // Estimasi bahan otomatis dari resep paket sampai diubah manual (Catatan Keputusan 92).
  const [materialsTouched, setMaterialsTouched] = useState(Boolean(order?.costEstimates.materials))
  const packages = data.packages.filter((p) => p.isActive || order?.lines.some((l) => l.packageId === p.id))
  const [addingContact, setAddingContact] = useState(false)
  const [preview, setPreview] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const contact = contacts.find((c) => c.id === contactId) ?? null
  const paxNumber = /^\d+$/.test(pax) ? Number(pax) : 0
  const qtyOf = (l: LineState) => (/^\d+$/.test(l.quantity) ? Number(l.quantity) : 0)
  const update = (key: number, patch: Partial<LineState>) => setLines((all) => all.map((l) => (l.key === key ? { ...l, ...patch } : l)))

  function changeContact(id: string) {
    setContactId(id)
    // Pesanan baru menyalin default kebijakan pembatalan klien (Catatan Keputusan 76).
    if (!order) {
      const picked = contacts.find((c) => c.id === id)
      setPolicy(picked?.cancellationPolicy ?? { ...DEFAULT_CANCELLATION_POLICY })
      setPolicyKey((k) => k + 1)
    }
  }
  function changePax(value: string) {
    const digits = value.replace(/\D/g, "")
    // Baris ber-satuan pax yang qty-nya mengikuti pax ikut diperbarui.
    setLines((all) => all.map((l) => (l.unit.trim().toLowerCase() === "pax" && (l.quantity === "" || l.quantity === pax) ? { ...l, quantity: digits } : l)))
    setPax(digits)
  }

  const percentBps = discountKind === "percent" ? parsePercentBps(discountPercent || "0") : null
  const discount: InvoiceDiscount | null =
    discountKind === "percent" && percentBps ? { kind: "percent", value: percentBps } : discountKind === "amount" && discountRupiah ? { kind: "amount", value: discountRupiah } : null
  const input: CateringOrderInput = {
    workspaceId: workspace.id,
    contactId,
    serviceType,
    eventDate,
    eventTime: eventTime || null,
    location: location || null,
    pax: paxNumber,
    quoteDate,
    validUntil,
    applyTax: applyTax && taxAvailable,
    discount,
    notes: notes || null,
    cancellationPolicy: policy ?? DEFAULT_CANCELLATION_POLICY,
    costEstimates: {},
    lines: lines
      .filter((l) => l.description.trim() || l.unitPrice || l.packageId)
      .map((l) => ({ description: l.description, quantity: qtyOf(l), unit: l.unit || null, unitPrice: l.unitPrice ?? 0, accountId: l.accountId, itemId: null, packageId: l.packageId })),
  }
  const recipe = input.lines.some((l) => l.packageId) ? services.cateringService.materials(data, input.lines, eventDate || today) : null
  const effective: Partial<Record<CostCategory, number | null>> = { ...estimates, ...(recipe && !materialsTouched ? { materials: recipe.cost } : {}) }
  input.costEstimates = Object.fromEntries(costCategories.flatMap((c) => (effective[c] ? [[c, effective[c]]] : []))) as CostEstimates
  const totals = orderTotals(input, workspace)
  const estimateTotal = costCategories.reduce((t, c) => t + (effective[c] ?? 0), 0)

  async function save() {
    setError(null)
    if (!policy) return setError("Lengkapi persen DP hangus pada kebijakan pembatalan")
    setBusy(true)
    try {
      const saved = await services.cateringService.saveOrder(input, order?.id)
      toast.success(order ? `Pesanan ${saved.number} disimpan` : `Penawaran ${saved.number} dibuat`)
      onSaved(saved)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  if (preview) {
    const draft: CateringOrder = order
      ? { ...order, ...input }
      : { ...input, id: "", number: `${data.profile.quotationPrefix}/…`, state: "quotation", invoiceId: null, cancelledAt: null, cancelReason: null, createdAt: "", updatedAt: "" }
    return (
      <div className="grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
          <Button variant="secondary" onClick={() => setPreview(false)}>
            <PencilIcon data-icon="inline-start" /> Kembali mengubah
          </Button>
          <p className="text-sm text-muted-foreground">Pratinjau — {order ? "simpan untuk memperbarui dokumen" : "nomor diberikan saat disimpan"}.</p>
        </div>
        <QuotationDocument order={draft} totals={totals} profile={data.profile} workspaceName={workspace.name} contact={contact} taxLabel={workspace.salesTaxLabel} taxInclusive={workspace.salesTaxInclusive} stamp={order ? null : "DRAFT"} />
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="grid content-start gap-5 rounded-2xl bg-canvas p-4 ring-1 ring-border sm:p-6">
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_14rem]">
          <div className="grid gap-2">
            <Label htmlFor="order-contact">Klien</Label>
            <div className="flex gap-2">
              <Select value={contactId} onValueChange={changeContact}>
                <SelectTrigger id="order-contact" className="w-full bg-background"><SelectValue placeholder="Pilih klien" /></SelectTrigger>
                <SelectContent>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button type="button" variant="secondary" size="icon" aria-label="Klien baru" onClick={() => setAddingContact(true)}>
                <UserPlusIcon />
              </Button>
            </div>
            {contact && <p className="text-xs text-muted-foreground">{[contact.phone, contact.address, `termin ${contact.paymentTermDays} hari`].filter(Boolean).join(" · ")}</p>}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="order-type">Jenis pesanan</Label>
            <Select value={serviceType} onValueChange={(v) => setServiceType(v as CateringServiceType)}>
              <SelectTrigger id="order-type" className="w-full bg-background"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(SERVICE_TYPE_LABELS) as CateringServiceType[]).map((t) => (
                  <SelectItem key={t} value={t}>{SERVICE_TYPE_LABELS[t]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-[11rem_8rem_8rem]">
          <div className="grid gap-2">
            <Label htmlFor="order-event-date">Tanggal acara/kirim</Label>
            <Input id="order-event-date" type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="order-event-time">Jam (opsional)</Label>
            <Input id="order-event-time" type="time" value={eventTime} onChange={(e) => setEventTime(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="order-pax">Jumlah pax</Label>
            <InputGroup>
              <InputGroupInput id="order-pax" inputMode="numeric" value={pax} onChange={(e) => changePax(e.target.value)} className="text-right tabular-nums" />
              <InputGroupAddon align="inline-end"><InputGroupText>pax</InputGroupText></InputGroupAddon>
            </InputGroup>
          </div>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="order-location">Lokasi (opsional)</Label>
          <Input id="order-location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="mis. Gedung Serbaguna, Jl. Merdeka 1" />
        </div>

        <fieldset className="grid gap-3">
          <legend className="mb-2 text-sm font-medium">Rincian{workspace.salesTaxInclusive && applyTax && taxAvailable ? ` (harga termasuk ${workspace.salesTaxLabel})` : ""}</legend>
          {lines.map((line, index) => {
            const n = index + 1
            return (
              <div key={line.key} className="grid gap-2 rounded-xl bg-card/60 p-3 ring-1 ring-border">
                <div className="grid gap-2 sm:grid-cols-[14rem_minmax(0,1fr)]">
                  <Select
                    value={line.packageId ?? NO_PACKAGE}
                    onValueChange={(v) => {
                      const pkg = packages.find((p) => p.id === v)
                      if (!pkg) return update(line.key, { packageId: null })
                      const filled = lineFromPackage(pkg, paxNumber || 1, mainRevenue?.id ?? "")
                      update(line.key, { packageId: pkg.id, description: filled.description, quantity: String(filled.quantity), unit: "pax", unitPrice: filled.unitPrice, accountId: filled.accountId })
                    }}
                  >
                    <SelectTrigger aria-label={`Paket baris ${n}`} className="w-full bg-background"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_PACKAGE}>Tanpa paket</SelectItem>
                      {packages.map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.code} · {p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input aria-label={`Keterangan baris ${n}`} placeholder="mis. Paket prasmanan A, Ongkir, Sewa alat" value={line.description} onChange={(e) => update(line.key, { description: e.target.value })} className="bg-background" />
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-[6rem_6rem_9rem_minmax(0,1fr)_8rem_2.5rem] sm:items-center">
                  <Input aria-label={`Qty baris ${n}`} inputMode="numeric" placeholder="Qty" value={line.quantity} onChange={(e) => update(line.key, { quantity: e.target.value.replace(/\D/g, "") })} className="bg-background text-right tabular-nums" />
                  <Input aria-label={`Satuan baris ${n}`} placeholder="Satuan" value={line.unit} onChange={(e) => update(line.key, { unit: e.target.value })} className="bg-background" />
                  <AmountInput aria-label={`Harga baris ${n}`} value={line.unitPrice} onValueChange={(v) => update(line.key, { unitPrice: v })} />
                  <Select value={line.accountId} onValueChange={(accountId) => update(line.key, { accountId })}>
                    <SelectTrigger aria-label={`Akun baris ${n}`} className="w-full bg-background"><SelectValue placeholder="Akun pendapatan" /></SelectTrigger>
                    <SelectContent>
                      {revenueAccounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>{a.code} · {a.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-right font-semibold text-ink"><Amount value={safeLineAmount({ quantity: qtyOf(line), unitPrice: line.unitPrice ?? 0 })} /></p>
                  <Button type="button" variant="ghost" size="icon" aria-label={`Hapus baris ${n}`} disabled={lines.length === 1} onClick={() => setLines(lines.filter((l) => l.key !== line.key))}>
                    <Trash2Icon />
                  </Button>
                </div>
              </div>
            )
          })}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="w-fit"
            onClick={() => setLines([...lines, { key: ++lineKey, description: "", quantity: "1", unit: "", unitPrice: null, accountId: mainRevenue?.id ?? "", packageId: null }])}
          >
            <PlusIcon data-icon="inline-start" /> Tambah baris
          </Button>
        </fieldset>

        <div className="grid gap-2 sm:grid-cols-[12rem_10rem] sm:items-end">
          <div className="grid gap-1.5">
            <Label htmlFor="order-discount-kind">Diskon</Label>
            <Select value={discountKind} onValueChange={(v) => setDiscountKind(v as typeof discountKind)}>
              <SelectTrigger id="order-discount-kind" className="w-full bg-background"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Tanpa diskon</SelectItem>
                <SelectItem value="percent">Persen (%)</SelectItem>
                <SelectItem value="amount">Rupiah</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {discountKind === "percent" && (
            <InputGroup>
              <InputGroupInput aria-label="Diskon persen" inputMode="decimal" placeholder="0" value={discountPercent} onChange={(e) => setDiscountPercent(e.target.value.replace(/[^\d.,]/g, ""))} className="text-right tabular-nums" />
              <InputGroupAddon align="inline-end"><InputGroupText>%</InputGroupText></InputGroupAddon>
            </InputGroup>
          )}
          {discountKind === "amount" && <AmountInput aria-label="Diskon rupiah" value={discountRupiah} onValueChange={setDiscountRupiah} />}
        </div>

        <label className="flex items-center gap-3 text-sm">
          <Switch checked={applyTax && taxAvailable} onCheckedChange={setApplyTax} disabled={!taxAvailable} />
          {taxAvailable ? (
            <span>Kenakan {formatTaxSettings(taxSettings)} · <span className="text-muted-foreground">harga {workspace.salesTaxInclusive ? "sudah" : "belum"} termasuk {workspace.salesTaxLabel}</span></span>
          ) : (
            <span className="text-muted-foreground">
              {workspace.salesTaxLabel} belum dipungut (tarif 0%). Atur di <Link href={taxHref} className="underline underline-offset-4">Pengaturan → Pajak</Link>.
            </span>
          )}
        </label>

        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">Estimasi biaya (opsional, untuk dibandingkan dengan realisasi)</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {costCategories.map((c) => (
              <div key={c} className="grid gap-1">
                <Label htmlFor={`order-estimate-${c}`} className="text-xs text-muted-foreground">{COST_CATEGORY_LABELS[c]}</Label>
                <AmountInput
                  id={`order-estimate-${c}`}
                  value={effective[c] ?? null}
                  onValueChange={(v) => {
                    if (c === "materials") setMaterialsTouched(true)
                    setEstimates((e) => ({ ...e, [c]: v }))
                  }}
                />
              </div>
            ))}
          </div>
          {recipe && (
            <p className="text-xs text-muted-foreground">
              Dari resep paket: bahan ≈ <Amount value={recipe.cost} />
              {recipe.missing.length > 0 && <span className="text-destructive"> (belum ada harga: {recipe.missing.map((id) => data.items.find((i) => i.id === id)?.name).join(", ")})</span>}
              {materialsTouched && recipe.cost !== (estimates.materials ?? 0) && (
                <>
                  {" · "}
                  <button type="button" className="underline underline-offset-4" onClick={() => { setMaterialsTouched(false); setEstimates((e) => ({ ...e, materials: null })) }}>pakai hitungan resep</button>
                </>
              )}
            </p>
          )}
        </fieldset>

        <CancellationPolicyField key={policyKey} value={policy} onChange={(p) => setPolicy(p)} />

        <div className="grid gap-4 sm:grid-cols-[11rem_11rem]">
          <div className="grid gap-2">
            <Label htmlFor="order-quote-date">Tanggal penawaran</Label>
            <Input id="order-quote-date" type="date" value={quoteDate} onChange={(e) => setQuoteDate(e.target.value)} disabled={Boolean(order)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="order-valid-until">Berlaku sampai</Label>
            <Input id="order-valid-until" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          </div>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="order-notes">Catatan di penawaran & faktur (opsional)</Label>
          <Textarea id="order-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="mis. menu tanpa MSG, termasuk alat prasmanan" />
        </div>
      </div>

      <aside className="grid content-start gap-4">
        <dl className="grid gap-2 rounded-2xl bg-canvas p-4 text-sm ring-1 ring-border">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Subtotal</dt>
            <dd><Amount value={totals.subtotal} /></dd>
          </div>
          {totals.discount > 0 && (
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Diskon</dt>
              <dd><Amount value={-totals.discount} /></dd>
            </div>
          )}
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{workspace.salesTaxLabel}</dt>
            <dd><Amount value={totals.tax} /></dd>
          </div>
          <div className="flex justify-between border-t pt-2 font-bold text-ink">
            <dt>Total pesanan</dt>
            <dd><Amount value={totals.total} /></dd>
          </div>
          {paxNumber > 0 && totals.total > 0 && (
            <p className="text-xs text-muted-foreground">≈ <Amount value={Math.round(totals.total / paxNumber)} /> per pax</p>
          )}
          {estimateTotal > 0 && (
            <>
              <div className="mt-1 flex justify-between border-t pt-2">
                <dt className="text-muted-foreground">Estimasi biaya</dt>
                <dd><Amount value={-estimateTotal} /></dd>
              </div>
              <div className="flex justify-between font-semibold text-ink">
                <dt>Estimasi laba kotor</dt>
                <dd><Amount value={totals.base - estimateTotal} /></dd>
              </div>
            </>
          )}
        </dl>
        <p className="flex gap-2 rounded-2xl bg-card px-4 py-3 text-xs text-muted-foreground">
          <InfoIcon className="mt-0.5 size-3.5 shrink-0" />
          <span>Penawaran belum membuat jurnal. DP yang diterima dicatat sebagai Uang Muka Pelanggan; pendapatan diakui saat pesanan diselesaikan.</span>
        </p>
        {!data.profile.updatedAt && (
          <p className="flex gap-2 text-xs text-muted-foreground">
            <InfoIcon className="mt-0.5 size-3.5 shrink-0" />
            <span>Kop penawaran belum diisi. Lengkapi alamat, rekening & logo di <Link href={profileHref} className="underline underline-offset-4">Pengaturan → Profil Usaha</Link>.</span>
          </p>
        )}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="grid gap-2">
          <Button size="lg" disabled={busy} onClick={save}>{busy ? "Menyimpan…" : order ? "Simpan perubahan" : "Simpan penawaran"}</Button>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => setPreview(true)}>
              <EyeIcon data-icon="inline-start" /> Pratinjau
            </Button>
            {onCancel ? <Button variant="ghost" onClick={onCancel}>Batal ubah</Button> : <span />}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Klien diambil dari <Link href={contactsHref} className="underline underline-offset-4">Kontak</Link>.</p>
      </aside>

      {addingContact &&
        renderContactDialog({
          onClose: () => setAddingContact(false),
          onSaved: (saved) => {
            setAddingContact(false)
            setContacts((all) => [...all, saved].sort((a, b) => a.name.localeCompare(b.name, "id")))
            changeContact(saved.id)
            if (!order) {
              setPolicy(saved.cancellationPolicy ?? { ...DEFAULT_CANCELLATION_POLICY })
              setPolicyKey((k) => k + 1)
            }
          },
        })}
    </div>
  )
}
