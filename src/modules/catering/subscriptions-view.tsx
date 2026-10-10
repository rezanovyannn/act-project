"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { BellRingIcon, ChevronLeftIcon, ChevronRightIcon, FileTextIcon, PencilIcon, PlusIcon, RepeatIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"
import { addDays, endOfMonth } from "@/core/dates"
import { formatDate, formatMonth, formatNumber, todayIsoDate } from "@/core/format"
import type { AppServices } from "@/core/services"
import type { CateringData } from "@/core/services/catering-service"
import { monthDays, WEEKDAY_LABELS, weekdaysLabel } from "@/core/subscription"
import type { IsoDate, Subscription, SubscriptionInput } from "@/core/types"
import { Amount } from "@/components/ui/amount"
import { AmountInput } from "@/components/ui/amount-input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group"
import { Label } from "@/components/ui/label"
import { LoadingState, PageHeader } from "@/components/ui/page-header"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { cn, errorMessage, useLoader } from "@/lib/utils"
import type { OrderRoutes } from "./orders-view"

const clientOf = (data: CateringData, sub: Subscription) => data.contacts.find((c) => c.id === sub.contactId)?.name ?? "—"
const running = (sub: Subscription, today: IsoDate) => sub.endDate === null || sub.endDate >= today

/** Tagihan langganan yang siap dibuat (bulan sudah berakhir), 1 klik draft faktur (Catatan Keputusan 96). */
export function DueBillingsBanner({ services, data, routes, onChanged }: { services: AppServices; data: CateringData; routes: OrderRoutes; onChanged: () => void }) {
  const router = useRouter()
  const today = todayIsoDate()
  const due = services.cateringService.dueBillings(data, today)
  const [busy, setBusy] = useState<string | null>(null)
  if (due.length === 0) return null

  async function create(sub: Subscription, month: string, open: boolean) {
    setBusy(`${sub.id}:${month}`)
    try {
      const invoice = await services.cateringService.createSubscriptionInvoice(sub, month, today)
      toast.success(`Draft tagihan ${sub.name} ${formatMonth(`${month}-01`)} dibuat`)
      if (open) router.push(routes.invoice(invoice.id))
      else onChanged()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <section aria-label="Tagihan langganan siap dibuat" className="grid gap-2 rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200 print:hidden">
      <p className="flex items-center gap-2 text-sm font-semibold text-amber-900">
        <BellRingIcon className="size-4" /> {due.length} tagihan langganan siap dibuat
      </p>
      <ul className="grid gap-1.5">
        {due.map((b) => (
          <li key={`${b.subscription.id}:${b.month}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/70 px-3 py-2 text-sm">
            <span>
              <Link href={routes.subscription(b.subscription.id)} className="font-medium text-ink hover:underline">{b.subscription.name}</Link>
              <span className="text-muted-foreground"> · {clientOf(data, b.subscription)} · {formatMonth(`${b.month}-01`)} · {formatNumber(b.portions)} porsi · </span>
              <Amount value={b.amount} />
            </span>
            <span className="flex gap-1.5">
              <Button size="sm" disabled={busy !== null} onClick={() => create(b.subscription, b.month, true)}>Buat draft tagihan</Button>
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-amber-900/80">Draft faktur penjualan berisi total porsi bulan itu; tinjau lalu terbitkan di halaman faktur. Pendapatan diakui pada tanggal akhir bulan.</p>
    </section>
  )
}

/** Daftar katering langganan (Fase 10D). */
export function SubscriptionsTab({ services, data, routes, onChanged }: { services: AppServices; data: CateringData; routes: OrderRoutes; onChanged: () => void }) {
  const today = todayIsoDate()
  const month = today.slice(0, 7)
  const [editing, setEditing] = useState(false)
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Katering langganan pascabayar: porsi harian dicatat di kalender, ditagih per bulan.</p>
        <Button onClick={() => setEditing(true)}><PlusIcon data-icon="inline-start" /> Langganan baru</Button>
      </div>
      {data.subscriptions.length === 0 ? (
        <div className="grid justify-items-center gap-2 rounded-2xl bg-card px-4 py-10 text-center">
          <RepeatIcon className="size-8 text-muted-foreground" />
          <p className="font-semibold text-ink">Belum ada langganan</p>
          <p className="max-w-md text-sm text-muted-foreground">Untuk rantangan atau makan siang kantor harian: isi klien, harga per porsi, porsi per hari, dan hari kirim.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl bg-canvas ring-1 ring-border">
          <table className="w-full min-w-[52rem] text-sm">
            <thead className="bg-card text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              <tr>
                <th className="px-4 py-2.5">Langganan</th>
                <th className="px-3 py-2.5">Klien</th>
                <th className="px-3 py-2.5">Hari kirim</th>
                <th className="px-3 py-2.5 text-right">Harga/porsi</th>
                <th className="px-3 py-2.5 text-right">Porsi {formatMonth(`${month}-01`)}</th>
                <th className="px-3 py-2.5 text-right">Nilai bulan ini</th>
                <th className="px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.subscriptions.map((sub) => {
                const total = monthDays(sub, month).total
                return (
                  <tr key={sub.id}>
                    <td className="px-4 py-2.5">
                      <Link href={routes.subscription(sub.id)} className="font-semibold text-ink hover:underline">{sub.name}</Link>
                      <span className="block text-xs text-muted-foreground">mulai {formatDate(sub.startDate)}{sub.endDate ? ` s.d. ${formatDate(sub.endDate)}` : ""}</span>
                    </td>
                    <td className="px-3 py-2.5 text-ink">{clientOf(data, sub)}</td>
                    <td className="px-3 py-2.5">{weekdaysLabel(sub.weekdays)} · {formatNumber(sub.defaultPortions)} porsi</td>
                    <td className="px-3 py-2.5 text-right"><Amount value={sub.pricePerPortion} /></td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{formatNumber(total)}</td>
                    <td className="px-3 py-2.5 text-right"><Amount value={total * sub.pricePerPortion} /></td>
                    <td className="px-4 py-2.5">
                      {running(sub, today) ? <Badge className="border-0 bg-success-pale text-success-deep">Berjalan</Badge> : <Badge variant="secondary">Berakhir</Badge>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <SubscriptionDialog
          services={services}
          data={data}
          subscription={null}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false)
            onChanged()
          }}
        />
      )}
    </div>
  )
}

function SubscriptionDialog({
  services,
  data,
  subscription,
  onClose,
  onSaved,
}: {
  services: AppServices
  data: CateringData
  subscription: Subscription | null
  onClose: () => void
  onSaved: (sub: Subscription) => void
}) {
  const revenue = data.accounts.filter((a) => a.accountType === "revenue" && a.isActive && a.systemRole !== "sales_returns")
  const customers = data.contacts.filter((c) => c.isCustomer)
  const taxAvailable = data.workspace.salesTaxRateBps > 0
  const [contactId, setContactId] = useState(subscription?.contactId ?? "")
  const [name, setName] = useState(subscription?.name ?? "Makan siang harian")
  const [startDate, setStartDate] = useState(subscription?.startDate ?? todayIsoDate())
  const [endDate, setEndDate] = useState(subscription?.endDate ?? "")
  const [price, setPrice] = useState<number | null>(subscription?.pricePerPortion ?? null)
  const [portions, setPortions] = useState(String(subscription?.defaultPortions ?? ""))
  const [weekdays, setWeekdays] = useState<number[]>(subscription?.weekdays ?? [1, 2, 3, 4, 5])
  const [accountId, setAccountId] = useState(subscription?.revenueAccountId ?? (revenue.find((a) => a.code === "4-1000") ?? revenue[0])?.id ?? "")
  const [applyTax, setApplyTax] = useState(subscription?.applyTax ?? taxAvailable)
  const [notes, setNotes] = useState(subscription?.notes ?? "")
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const toggleDay = (d: number) => setWeekdays((all) => (all.includes(d) ? all.filter((x) => x !== d) : [...all, d].sort()))

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    const input: SubscriptionInput = {
      contactId,
      name,
      startDate,
      endDate: endDate || null,
      pricePerPortion: price ?? 0,
      revenueAccountId: accountId,
      defaultPortions: /^\d+$/.test(portions) ? Number(portions) : -1,
      weekdays,
      applyTax: applyTax && taxAvailable,
      notes: notes || null,
    }
    try {
      const saved = await services.cateringService.saveSubscription(data.workspace.id, input, subscription?.id)
      toast.success(`Langganan ${saved.name} disimpan`)
      onSaved(saved)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{subscription ? "Ubah langganan" : "Langganan baru"}</DialogTitle>
            <DialogDescription>Porsi harian terisi otomatis pada hari kirim; ubah per tanggal di kalender langganan (libur, tambahan).</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="sub-contact">Klien</Label>
              <Select value={contactId} onValueChange={setContactId}>
                <SelectTrigger id="sub-contact" className="w-full bg-background"><SelectValue placeholder="Pilih klien" /></SelectTrigger>
                <SelectContent>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="sub-name">Nama langganan</Label>
              <Input id="sub-name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="sub-start">Mulai</Label>
              <Input id="sub-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="sub-end">Berakhir (opsional)</Label>
              <Input id="sub-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="sub-price">Harga per porsi</Label>
              <AmountInput id="sub-price" value={price} onValueChange={setPrice} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="sub-portions">Porsi per hari kirim</Label>
              <InputGroup>
                <InputGroupInput id="sub-portions" inputMode="numeric" value={portions} onChange={(e) => setPortions(e.target.value.replace(/\D/g, ""))} className="text-right tabular-nums" />
                <InputGroupAddon align="inline-end"><InputGroupText>porsi</InputGroupText></InputGroupAddon>
              </InputGroup>
            </div>
          </div>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Hari kirim</legend>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAY_LABELS.map((label, i) => (
                <Button key={label} type="button" size="sm" variant={weekdays.includes(i + 1) ? "default" : "secondary"} aria-pressed={weekdays.includes(i + 1)} onClick={() => toggleDay(i + 1)}>
                  {label}
                </Button>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="sub-account">Akun pendapatan</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger id="sub-account" className="w-full bg-background"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {revenue.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.code} · {a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-3 self-end pb-2 text-sm">
              <Switch checked={applyTax && taxAvailable} onCheckedChange={setApplyTax} disabled={!taxAvailable} />
              <span>{taxAvailable ? `Kenakan ${data.workspace.salesTaxLabel}` : `${data.workspace.salesTaxLabel} belum dipungut`}</span>
            </label>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="sub-notes">Catatan di faktur (opsional)</Label>
            <Textarea id="sub-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>Batal</Button>
            <Button type="submit" disabled={saving}>{saving ? "Menyimpan…" : "Simpan langganan"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Detail langganan: kalender porsi harian per bulan & status tagihan (Fase 10D). */
export function SubscriptionDetailView({ services, workspaceId, subscriptionId, routes }: { services: AppServices; workspaceId: string; subscriptionId: string; routes: OrderRoutes }) {
  const router = useRouter()
  const data = useLoader(() => services.cateringService.data(workspaceId), [services, workspaceId])
  const today = todayIsoDate()
  const [month, setMonth] = useState(today.slice(0, 7))
  // Isian dikaitkan ke versi langganan: setelah tersimpan & dimuat ulang, isian lama otomatis tidak dipakai.
  const [draftState, setDraftState] = useState<{ base: string; values: Record<IsoDate, string> }>({ base: "", values: {} })
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)

  if (data.loading && !data.data) return <LoadingState />
  if (data.error) return <p role="alert" className="text-sm text-destructive">{errorMessage(data.error)}</p>
  const current = data.data!
  const sub = current.subscriptions.find((s) => s.id === subscriptionId)
  if (!sub) return <p role="alert" className="text-sm text-destructive">Langganan tidak ditemukan.</p>
  const drafts = draftState.base === `${sub.updatedAt}:${month}` ? draftState.values : {}
  const setDrafts = (update: (all: Record<IsoDate, string>) => Record<IsoDate, string>) =>
    setDraftState({ base: `${sub.updatedAt}:${month}`, values: update(drafts) })
  const { days, total } = monthDays(sub, month)
  const billing = services.cateringService.billing(current, sub, month, today)
  const locked = billing.state !== "none"
  const monthEnded = endOfMonth(`${month}-01`) < today
  const first = `${month}-01`
  const offset = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7
  const changes = Object.fromEntries(
    Object.entries(drafts).flatMap(([date, text]): [IsoDate, number | null][] => {
      const day = days.find((d) => d.date === date)
      if (!day) return []
      if (text.trim() === "") return day.changed ? [[date, null]] : []
      const n = Number(text)
      return Number.isInteger(n) && n !== day.portions ? [[date, n]] : []
    }),
  ) as Record<IsoDate, number | null>
  const pendingTotal = days.reduce((t, d) => t + (d.date in drafts ? (drafts[d.date].trim() === "" ? 0 : Number(drafts[d.date]) || 0) : d.portions), 0)
  const shift = (delta: number) => {
    setMonth(addDays(delta < 0 ? first : endOfMonth(first), delta).slice(0, 7))
  }

  async function saveDays() {
    setBusy(true)
    try {
      await services.cateringService.setSubscriptionDays(sub!, changes, today)
      toast.success("Porsi harian disimpan")
      data.reload()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function bill() {
    setBusy(true)
    try {
      const invoice = await services.cateringService.createSubscriptionInvoice(sub!, month, today)
      toast.success(`Draft tagihan ${formatMonth(first)} dibuat`)
      router.push(routes.invoice(invoice.id))
    } catch (e) {
      toast.error(errorMessage(e))
      setBusy(false)
    }
  }

  async function remove() {
    try {
      await services.cateringService.deleteSubscription(sub!.id)
      toast.success(`Langganan ${sub!.name} dihapus`)
      router.replace(routes.list)
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <div className="grid grid-cols-1 gap-5">
      <PageHeader
        title={sub.name}
        description={`${clientOf(current, sub)} · ${weekdaysLabel(sub.weekdays)} · ${formatNumber(sub.defaultPortions)} porsi/hari · Rp ${formatNumber(sub.pricePerPortion)}/porsi · mulai ${formatDate(sub.startDate)}${sub.endDate ? ` s.d. ${formatDate(sub.endDate)}` : ""}`}
        actions={
          <>
            <Button variant="secondary" onClick={() => setEditing(true)}><PencilIcon data-icon="inline-start" /> Ubah</Button>
            {Object.keys(sub.billedMonths).length === 0 && (
              <Button variant="ghost" className="text-destructive" onClick={remove}><Trash2Icon data-icon="inline-start" /> Hapus</Button>
            )}
            <Button variant="secondary" asChild><Link href={routes.list}>Daftar pesanan</Link></Button>
          </>
        }
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="icon" aria-label="Bulan sebelumnya" onClick={() => shift(-1)}><ChevronLeftIcon /></Button>
          <p className="min-w-40 text-center font-semibold text-ink">{formatMonth(first)}</p>
          <Button variant="secondary" size="icon" aria-label="Bulan berikutnya" onClick={() => shift(1)}><ChevronRightIcon /></Button>
        </div>
        <p className="text-sm">
          Total <strong>{formatNumber(Object.keys(changes).length ? pendingTotal : total)}</strong> porsi · <strong><Amount value={(Object.keys(changes).length ? pendingTotal : total) * sub.pricePerPortion} /></strong>
          {sub.applyTax && ` + ${current.workspace.salesTaxLabel}`}
        </p>
      </div>

      {locked ? (
        <p className="flex flex-wrap items-center gap-2 rounded-2xl bg-card px-4 py-3 text-sm">
          <FileTextIcon className="size-4" />
          Bulan ini sudah ditagih ({billing.state === "draft" ? "draft" : "terbit"}); porsi dikunci.
          {billing.invoice && <Link href={routes.invoice(billing.invoice.id)} className="font-semibold text-ink underline underline-offset-4">Lihat faktur {billing.invoice.number ?? "draft"}</Link>}
        </p>
      ) : monthEnded && total > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-amber-50 px-4 py-3 text-sm ring-1 ring-amber-200">
          <span>Bulan ini sudah berakhir dan belum ditagih.</span>
          <Button size="sm" disabled={busy || Object.keys(changes).length > 0} onClick={bill}>Buat draft tagihan</Button>
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <div className="grid min-w-[40rem] grid-cols-7 overflow-hidden rounded-2xl bg-border ring-1 ring-border" style={{ gap: 1 }}>
          {WEEKDAY_LABELS.map((d) => (
            <div key={d} className="bg-card px-2 py-1.5 text-center text-xs font-semibold text-muted-foreground">{d}</div>
          ))}
          {Array.from({ length: offset }, (_, i) => <div key={`x${i}`} className="bg-card/40" />)}
          {days.map((day) => {
            const value = drafts[day.date] ?? String(day.portions)
            const edited = day.date in drafts && day.date in changes
            return (
              <div key={day.date} className={cn("grid gap-1 bg-canvas p-1.5", !day.active && "bg-card/40")}>
                <span className={cn("text-xs tabular-nums", day.date === today ? "font-bold text-primary" : "text-muted-foreground")}>{Number(day.date.slice(8))}</span>
                {day.active ? (
                  <Input
                    aria-label={`Porsi ${day.date}`}
                    inputMode="numeric"
                    value={value}
                    disabled={locked}
                    onChange={(e) => setDrafts((all) => ({ ...all, [day.date]: e.target.value.replace(/\D/g, "") }))}
                    className={cn("h-8 px-2 text-right tabular-nums", day.changed && "ring-2 ring-amber-300", edited && "ring-2 ring-primary/50", value === "0" && "text-muted-foreground")}
                  />
                ) : (
                  <span className="h-8" />
                )}
              </div>
            )
          })}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">Kotak bergaris kuning = porsi diubah dari default. Kosongkan kotak lalu simpan untuk kembali ke default.</p>
        <div className="flex gap-2">
          {Object.keys(drafts).length > 0 && <Button variant="secondary" onClick={() => setDrafts(() => ({}))}>Batalkan perubahan</Button>}
          <Button disabled={busy || locked || Object.keys(changes).length === 0} onClick={saveDays}>{busy ? "Menyimpan…" : "Simpan porsi"}</Button>
        </div>
      </div>
      {editing && (
        <SubscriptionDialog
          services={services}
          data={current}
          subscription={sub}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false)
            data.reload()
          }}
        />
      )}
    </div>
  )
}
