"use client"

import { useState } from "react"
import Link from "next/link"
import { CalendarDaysIcon, ChevronLeftIcon, ChevronRightIcon, ClipboardListIcon, FilePlus2Icon, InfoIcon, SearchIcon } from "lucide-react"
import {
  ORDER_STATUS_LABELS,
  ordersByDate,
  PAYMENT_STATUS_LABELS,
  SERVICE_TYPE_LABELS,
  type OrderStatus,
  type OrderSummary,
  type PaymentStatus,
} from "@/core/catering"
import { addDays, daysInMonth } from "@/core/dates"
import { formatDate, formatMonth, formatNumber, todayIsoDate } from "@/core/format"
import type { AppServices } from "@/core/services"
import type { CateringData } from "@/core/services/catering-service"
import { Amount } from "@/components/ui/amount"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { LoadingState, PageHeader } from "@/components/ui/page-header"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn, errorMessage, useLoader } from "@/lib/utils"
import { PaymentDialog } from "./order-dialogs"
import { ProfitList } from "./order-profit"

export interface OrderRoutes {
  list: string
  create: string
  order: (id: string) => string
  invoice: (id: string) => string
  journal: (entryId: string) => string
  contacts: string
  profile: string
  tax: string
}

const STATUS_STYLES: Record<OrderStatus, string> = {
  quotation: "bg-card text-ink ring-1 ring-border",
  expired: "bg-secondary text-muted-foreground",
  confirmed: "bg-ring/10 text-ring",
  completed: "bg-success-pale text-success-deep",
  cancelled: "bg-secondary text-muted-foreground line-through",
}

const PAYMENT_STYLES: Record<PaymentStatus, string> = {
  none: "bg-secondary text-muted-foreground",
  unpaid: "bg-card text-ink ring-1 ring-border",
  partial: "bg-amber-100 text-amber-800",
  paid: "bg-success-pale text-success-deep",
  overdue: "bg-destructive/10 text-destructive",
}

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <Badge className={cn("border-0", STATUS_STYLES[status])}>{ORDER_STATUS_LABELS[status]}</Badge>
}

export function PaymentBadge({ status }: { status: PaymentStatus }) {
  if (status === "none") return null
  return <Badge className={cn("border-0", PAYMENT_STYLES[status])}>{PAYMENT_STATUS_LABELS[status]}</Badge>
}

type Tab = "orders" | "calendar" | "bills" | "clients" | "profit"

/** Pesanan katering: daftar, kalender, tagihan, dan DP & sisa per klien (ADR 024). */
export function OrdersView({ services, workspaceId, routes, initialTab }: { services: AppServices; workspaceId: string; routes: OrderRoutes; initialTab?: string }) {
  const data = useLoader(() => services.cateringService.data(workspaceId), [services, workspaceId])
  const [tab, setTab] = useState<Tab>((["orders", "calendar", "bills", "clients", "profit"] as const).find((t) => t === initialTab) ?? "orders")

  if (data.loading && !data.data) return <LoadingState />
  if (data.error) return <p role="alert" className="text-sm text-destructive">{errorMessage(data.error)}</p>
  const current = data.data!
  const today = todayIsoDate()
  const summaries = services.cateringService.summaries(current, today)
  const active = summaries.filter((s) => s.order.state === "confirmed")
  const upcoming = active.filter((s) => s.order.eventDate >= today)
  const depositHeld = summaries.reduce((t, s) => t + s.deposit.balance, 0)
  const outstanding = summaries.reduce((t, s) => t + s.outstanding, 0)

  return (
    <div className="grid grid-cols-1 gap-5">
      <PageHeader
        title="Pesanan"
        description="Penawaran, pesanan acara/nasi box/langganan, DP, dan pelunasan klien. Jurnal dibuat otomatis dari setiap pembayaran."
        actions={
          <Button asChild>
            <Link href={routes.create}><FilePlus2Icon data-icon="inline-start" /> Penawaran baru</Link>
          </Button>
        }
      />
      <section aria-label="Ringkasan pesanan" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Penawaran aktif" value={String(summaries.filter((s) => s.status === "quotation").length)} note="menunggu konfirmasi" />
        <Stat label="Pesanan mendatang" value={String(upcoming.length)} note={upcoming[0] ? `terdekat ${formatDate(upcoming[upcoming.length - 1].order.eventDate)}` : "belum ada"} />
        <Stat label="DP dipegang" value={<Amount value={depositHeld} />} note="Uang Muka Pelanggan" />
        <Stat label="Sisa belum dibayar" value={<Amount value={outstanding} />} note="pesanan aktif & faktur" />
      </section>
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="grid grid-cols-1 gap-4">
        <TabsList>
          <TabsTrigger value="orders">Pesanan</TabsTrigger>
          <TabsTrigger value="calendar">Kalender</TabsTrigger>
          <TabsTrigger value="bills">Tagihan</TabsTrigger>
          <TabsTrigger value="clients">Per Klien</TabsTrigger>
          <TabsTrigger value="profit">Laba</TabsTrigger>
        </TabsList>
        <TabsContent value="orders"><OrderList data={current} summaries={summaries} routes={routes} /></TabsContent>
        <TabsContent value="calendar"><OrderCalendar data={current} summaries={summaries} routes={routes} /></TabsContent>
        <TabsContent value="bills"><BillsList services={services} data={current} summaries={summaries} routes={routes} onChanged={data.reload} /></TabsContent>
        <TabsContent value="clients"><ClientsList services={services} data={current} routes={routes} /></TabsContent>
        <TabsContent value="profit"><ProfitList data={current} summaries={summaries} profits={services.cateringService.profits(current)} routes={routes} /></TabsContent>
      </Tabs>
    </div>
  )
}

function Stat({ label, value, note }: { label: string; value: React.ReactNode; note: string }) {
  return (
    <div className="grid gap-1 rounded-2xl bg-canvas p-4 ring-1 ring-border">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-lg font-bold tabular-nums text-ink">{value}</span>
      <span className="text-xs text-muted-foreground">{note}</span>
    </div>
  )
}

const clientOf = (data: CateringData, s: OrderSummary) => data.contacts.find((c) => c.id === s.order.contactId)?.name ?? "—"

type Filter = "all" | "quotation" | "confirmed" | "completed" | "cancelled"
const FILTERS: { value: Filter; label: string; match: (s: OrderSummary) => boolean }[] = [
  { value: "all", label: "Semua", match: () => true },
  { value: "quotation", label: "Penawaran", match: (s) => s.order.state === "quotation" },
  { value: "confirmed", label: "Dikonfirmasi", match: (s) => s.order.state === "confirmed" },
  { value: "completed", label: "Selesai", match: (s) => s.order.state === "completed" },
  { value: "cancelled", label: "Dibatalkan", match: (s) => s.order.state === "cancelled" },
]

function OrderList({ data, summaries, routes }: { data: CateringData; summaries: OrderSummary[]; routes: OrderRoutes }) {
  const [filter, setFilter] = useState<Filter>("all")
  const [search, setSearch] = useState("")
  const term = search.trim().toLowerCase()
  const rows = summaries
    .filter(FILTERS.find((f) => f.value === filter)!.match)
    .filter((s) => !term || [s.order.number, clientOf(data, s), s.order.location ?? ""].some((t) => t.toLowerCase().includes(term)))

  if (summaries.length === 0) {
    return (
      <div className="grid justify-items-center gap-2 rounded-2xl bg-card px-4 py-10 text-center">
        <ClipboardListIcon className="size-8 text-muted-foreground" />
        <p className="font-semibold text-ink">Belum ada pesanan</p>
        <p className="max-w-md text-sm text-muted-foreground">
          Mulai dari penawaran (quotation) untuk klien. Isi dulu <Link href={routes.profile} className="underline underline-offset-4">profil usaha</Link> untuk kop dokumen.
        </p>
        <Button asChild className="mt-2"><Link href={routes.create}>Buat penawaran</Link></Button>
      </div>
    )
  }
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter status pesanan">
          {FILTERS.map((f) => (
            <Button key={f.value} size="sm" variant={filter === f.value ? "default" : "secondary"} onClick={() => setFilter(f.value)}>{f.label}</Button>
          ))}
        </div>
        <InputGroup className="max-w-xs">
          <InputGroupAddon><SearchIcon /></InputGroupAddon>
          <InputGroupInput aria-label="Cari pesanan" placeholder="Nomor, klien, lokasi" value={search} onChange={(e) => setSearch(e.target.value)} />
        </InputGroup>
      </div>
      <div className="overflow-x-auto rounded-2xl bg-canvas ring-1 ring-border">
        <table className="w-full min-w-[58rem] text-sm">
          <thead className="bg-card text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            <tr>
              <th className="px-4 py-2.5">Nomor</th>
              <th className="px-3 py-2.5">Acara</th>
              <th className="px-3 py-2.5">Klien</th>
              <th className="px-3 py-2.5 text-right">Pax</th>
              <th className="px-3 py-2.5 text-right">Total</th>
              <th className="px-3 py-2.5 text-right">DP</th>
              <th className="px-3 py-2.5 text-right">Sisa</th>
              <th className="px-4 py-2.5">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((s) => (
              <tr key={s.order.id} className="hover:bg-card/60">
                <td className="px-4 py-2.5">
                  <Link href={routes.order(s.order.id)} className="font-semibold text-ink hover:underline">{s.order.number}</Link>
                  <span className="block text-xs text-muted-foreground">{SERVICE_TYPE_LABELS[s.order.serviceType]}</span>
                </td>
                <td className="px-3 py-2.5 tabular-nums">
                  {formatDate(s.order.eventDate)}{s.order.eventTime && <span className="text-muted-foreground"> · {s.order.eventTime}</span>}
                  {s.order.location && <span className="block max-w-56 truncate text-xs text-muted-foreground">{s.order.location}</span>}
                </td>
                <td className="px-3 py-2.5 text-ink">{clientOf(data, s)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{formatNumber(s.order.pax)}</td>
                <td className="px-3 py-2.5 text-right"><Amount value={s.invoice?.total ?? s.totals.total} /></td>
                <td className="px-3 py-2.5 text-right">{s.deposit.received > 0 ? <Amount value={s.deposit.received} /> : "—"}</td>
                <td className="px-3 py-2.5 text-right">{s.order.state === "confirmed" || s.order.state === "completed" ? <Amount value={s.outstanding} /> : "—"}</td>
                <td className="px-4 py-2.5">
                  <span className="flex flex-wrap gap-1"><OrderStatusBadge status={s.status} /><PaymentBadge status={s.paymentStatus} /></span>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-6 text-center text-muted-foreground">Tidak ada pesanan yang cocok.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const WEEKDAYS = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"]

/** Kalender pesanan per tanggal acara; pesanan dibatalkan tidak tampil. */
function OrderCalendar({ data, summaries, routes }: { data: CateringData; summaries: OrderSummary[]; routes: OrderRoutes }) {
  const today = todayIsoDate()
  const [month, setMonth] = useState(today.slice(0, 7))
  const [year, mon] = month.split("-").map(Number)
  const byDate = ordersByDate(summaries.map((s) => s.order), month)
  const byId = new Map(summaries.map((s) => [s.order.id, s]))
  const first = `${month}-01`
  const offset = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7
  const days = daysInMonth(year, mon)
  const cells: (string | null)[] = [...Array(offset).fill(null), ...Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`)]
  while (cells.length % 7 !== 0) cells.push(null)
  const shift = (delta: number) => setMonth(addDays(delta < 0 ? first : `${month}-${String(days).padStart(2, "0")}`, delta).slice(0, 7))
  const monthOrders = [...byDate.values()].flat()

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="icon" aria-label="Bulan sebelumnya" onClick={() => shift(-1)}><ChevronLeftIcon /></Button>
          <p className="min-w-40 text-center font-semibold text-ink">{formatMonth(first)}</p>
          <Button variant="secondary" size="icon" aria-label="Bulan berikutnya" onClick={() => shift(1)}><ChevronRightIcon /></Button>
          {month !== today.slice(0, 7) && <Button variant="ghost" size="sm" onClick={() => setMonth(today.slice(0, 7))}>Bulan ini</Button>}
        </div>
        <p className="text-sm text-muted-foreground">{monthOrders.length} pesanan · {formatNumber(monthOrders.reduce((t, o) => t + o.pax, 0))} pax</p>
      </div>
      <div className="overflow-x-auto">
        <div className="grid min-w-[44rem] grid-cols-7 overflow-hidden rounded-2xl bg-border ring-1 ring-border" style={{ gap: 1 }}>
          {WEEKDAYS.map((d) => (
            <div key={d} className="bg-card px-2 py-1.5 text-center text-xs font-semibold text-muted-foreground">{d}</div>
          ))}
          {cells.map((date, i) => (
            <div key={date ?? `x${i}`} className={cn("min-h-24 bg-canvas p-1.5", !date && "bg-card/40")}>
              {date && (
                <>
                  <p className={cn("mb-1 text-xs tabular-nums", date === today ? "inline-grid size-6 place-items-center rounded-full bg-primary font-bold text-primary-foreground" : "text-muted-foreground")}>
                    {Number(date.slice(8))}
                  </p>
                  <ul className="grid gap-1">
                    {(byDate.get(date) ?? []).map((o) => {
                      const s = byId.get(o.id)!
                      return (
                        <li key={o.id}>
                          <Link
                            href={routes.order(o.id)}
                            className={cn("block rounded-md px-1.5 py-1 text-xs leading-tight hover:opacity-80", STATUS_STYLES[s.status])}
                            title={`${o.number} · ${clientOf(data, s)}`}
                          >
                            <span className="font-semibold">{o.eventTime ?? "—"}</span> {clientOf(data, s)}
                            <span className="block opacity-75">{formatNumber(o.pax)} pax · {SERVICE_TYPE_LABELS[o.serviceType]}</span>
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
      {monthOrders.length === 0 && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground"><CalendarDaysIcon className="size-4" /> Tidak ada pesanan di bulan ini.</p>
      )}
    </div>
  )
}

interface BillRow {
  key: string
  number: string
  kind: "dp" | "final"
  summary: OrderSummary
  date: string
  due: string
  amount: number
  paid: number
  outstanding: number
  status: PaymentStatus
  href: string
}

/** Daftar tagihan: invoice DP & faktur pelunasan, dengan aksi terima pembayaran (Catatan Keputusan 83). */
function BillsList({ services, data, summaries, routes, onChanged }: { services: AppServices; data: CateringData; summaries: OrderSummary[]; routes: OrderRoutes; onChanged: () => void }) {
  const today = todayIsoDate()
  const [openOnly, setOpenOnly] = useState(true)
  const [paying, setPaying] = useState<OrderSummary | null>(null)
  const byOrder = new Map(summaries.map((s) => [s.order.id, s]))
  const rows: BillRow[] = [
    ...services.cateringService.billSummaries(data, today).flatMap((b): BillRow[] => {
      const s = byOrder.get(b.bill.orderId)
      if (!s) return []
      // Invoice DP pesanan selesai/dibatalkan tidak lagi ditagih.
      const closed = s.order.state === "completed" || s.order.state === "cancelled"
      return [{
        key: b.bill.id, number: b.bill.number, kind: "dp", summary: s, date: b.bill.billDate, due: b.bill.dueDate, amount: b.bill.amount,
        paid: b.paid, outstanding: closed ? 0 : b.outstanding, status: closed && b.status !== "paid" ? "none" : b.status, href: routes.order(s.order.id),
      }]
    }),
    ...summaries.flatMap((s): BillRow[] =>
      s.invoice && s.invoice.status !== "cancelled"
        ? [{
            key: s.invoice.invoice.id, number: s.invoice.invoice.number ?? "—", kind: "final", summary: s, date: s.invoice.invoice.invoiceDate,
            due: s.invoice.invoice.dueDate, amount: s.invoice.total, paid: s.invoice.paid, outstanding: s.invoice.outstanding, status: s.paymentStatus,
            href: routes.invoice(s.invoice.invoice.id),
          }]
        : [],
    ),
  ].sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number))
  const shown = openOnly ? rows.filter((r) => r.outstanding > 0) : rows

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1.5" role="group" aria-label="Filter tagihan">
          <Button size="sm" variant={openOnly ? "default" : "secondary"} onClick={() => setOpenOnly(true)}>Belum lunas</Button>
          <Button size="sm" variant={!openOnly ? "default" : "secondary"} onClick={() => setOpenOnly(false)}>Semua</Button>
        </div>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><InfoIcon className="size-3.5" /> Pembayaran DP mengurangi invoice DP berurutan dari yang terlama.</p>
      </div>
      <div className="overflow-x-auto rounded-2xl bg-canvas ring-1 ring-border">
        <table className="w-full min-w-[60rem] text-sm">
          <thead className="bg-card text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            <tr>
              <th className="px-4 py-2.5">Nomor</th>
              <th className="px-3 py-2.5">Klien · pesanan</th>
              <th className="px-3 py-2.5">Jatuh tempo</th>
              <th className="px-3 py-2.5 text-right">Nominal</th>
              <th className="px-3 py-2.5 text-right">Dibayar</th>
              <th className="px-3 py-2.5 text-right">Sisa</th>
              <th className="px-3 py-2.5">Status</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {shown.map((r) => (
              <tr key={r.key}>
                <td className="px-4 py-2.5">
                  <Link href={r.href} className="font-semibold text-ink hover:underline">{r.number}</Link>
                  <span className="block text-xs text-muted-foreground">{r.kind === "dp" ? "Invoice DP" : "Faktur pelunasan"} · {formatDate(r.date)}</span>
                </td>
                <td className="px-3 py-2.5">
                  <span className="text-ink">{clientOf(data, r.summary)}</span>
                  <Link href={routes.order(r.summary.order.id)} className="block text-xs text-muted-foreground hover:underline">{r.summary.order.number} · {formatDate(r.summary.order.eventDate)}</Link>
                </td>
                <td className={cn("px-3 py-2.5 tabular-nums", r.status === "overdue" && "font-semibold text-destructive")}>{formatDate(r.due)}</td>
                <td className="px-3 py-2.5 text-right"><Amount value={r.amount} /></td>
                <td className="px-3 py-2.5 text-right"><Amount value={r.paid} /></td>
                <td className="px-3 py-2.5 text-right"><Amount value={r.outstanding} /></td>
                <td className="px-3 py-2.5">{r.status === "none" ? <span className="text-xs text-muted-foreground">Tidak ditagih lagi</span> : <PaymentBadge status={r.status} />}</td>
                <td className="px-4 py-2.5 text-right">
                  {r.outstanding > 0 && r.summary.order.state !== "cancelled" && (
                    <Button size="sm" variant="secondary" onClick={() => setPaying(r.summary)}>Terima pembayaran</Button>
                  )}
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-6 text-center text-muted-foreground">{openOnly ? "Tidak ada tagihan yang belum lunas." : "Belum ada tagihan."}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {paying && (
        <PaymentDialog services={services} data={data} summary={paying} mode="receive" onClose={() => setPaying(null)} onDone={() => { setPaying(null); onChanged() }} />
      )}
    </div>
  )
}

/** DP & sisa tagihan per klien (Catatan Keputusan 75). */
function ClientsList({ services, data, routes }: { services: AppServices; data: CateringData; routes: OrderRoutes }) {
  const today = todayIsoDate()
  const clients = services.cateringService.clients(data, today)
  const sum = (pick: (c: (typeof clients)[number]) => number) => clients.reduce((t, c) => t + pick(c), 0)
  if (clients.length === 0) {
    return <p className="rounded-2xl bg-card px-4 py-6 text-center text-sm text-muted-foreground">Belum ada pesanan aktif dengan DP atau tagihan.</p>
  }
  return (
    <div className="grid gap-3">
      <div className="overflow-x-auto rounded-2xl bg-canvas ring-1 ring-border">
        <table className="w-full min-w-[52rem] text-sm">
          <thead className="bg-card text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            <tr>
              <th className="px-4 py-2.5">Klien</th>
              <th className="px-3 py-2.5 text-right">Pesanan</th>
              <th className="px-3 py-2.5 text-right">Total pesanan</th>
              <th className="px-3 py-2.5 text-right">DP dipegang</th>
              <th className="px-3 py-2.5 text-right">Sisa belum dibayar</th>
              <th className="px-3 py-2.5 text-right">Sudah difakturkan</th>
              <th className="px-4 py-2.5">Acara berikutnya</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {clients.map((c) => (
              <tr key={c.contactId}>
                <td className="px-4 py-2.5 font-medium text-ink">{c.name}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{c.orders}</td>
                <td className="px-3 py-2.5 text-right"><Amount value={c.total} /></td>
                <td className="px-3 py-2.5 text-right"><Amount value={c.depositHeld} /></td>
                <td className="px-3 py-2.5 text-right font-semibold"><Amount value={c.outstanding} /></td>
                <td className="px-3 py-2.5 text-right"><Amount value={c.receivable} /></td>
                <td className="px-4 py-2.5 tabular-nums">{c.nextEventDate ? formatDate(c.nextEventDate) : "—"}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 bg-card font-semibold text-ink">
            <tr>
              <td className="px-4 py-2.5">Total</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{sum((c) => c.orders)}</td>
              <td className="px-3 py-2.5 text-right"><Amount value={sum((c) => c.total)} /></td>
              <td className="px-3 py-2.5 text-right"><Amount value={sum((c) => c.depositHeld)} /></td>
              <td className="px-3 py-2.5 text-right"><Amount value={sum((c) => c.outstanding)} /></td>
              <td className="px-3 py-2.5 text-right"><Amount value={sum((c) => c.receivable)} /></td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        DP dipegang = saldo akun Uang Muka Pelanggan; sisa yang sudah difakturkan = Piutang Usaha di Neraca. Pembayaran diterima dari tab Tagihan atau halaman pesanan; lihat juga{" "}
        <Link href={routes.contacts} className="underline underline-offset-4">Kontak</Link>.
      </p>
    </div>
  )
}
