"use client"

import { policyLabel, SERVICE_TYPE_LABELS, type OrderTotals } from "@/core/catering"
import { formatDate, formatNumber } from "@/core/format"
import { formatPercentBps, lineAmount, terbilang } from "@/core/invoice"
import type { BusinessProfile, CateringOrder, Contact, OrderBill } from "@/core/types"

const rupiah = (n: number) => `Rp ${formatNumber(n)}`

/** Kertas A4 untuk pratinjau & cetak/PDF, sama dengan faktur (ADR 022). */
function Paper({ label, stamp, children }: { label: string; stamp?: string | null; children: React.ReactNode }) {
  return (
    <article
      aria-label={label}
      className="relative mx-auto w-full max-w-[210mm] overflow-hidden bg-white p-[12mm] text-[13px] leading-relaxed text-neutral-900 shadow-sm ring-1 ring-border print:max-w-none print:p-0 print:shadow-none print:ring-0"
      style={{ colorScheme: "light" }}
    >
      {stamp && (
        <div aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center">
          <span className="-rotate-12 rounded-xl border-[6px] border-red-500/25 px-10 py-2 text-7xl font-black tracking-widest text-red-500/20">{stamp}</span>
        </div>
      )}
      {children}
    </article>
  )
}

function Letterhead({ profile, workspaceName, title, number, meta }: {
  profile: BusinessProfile
  workspaceName: string
  title: string
  number: string
  meta: [string, string][]
}) {
  const name = profile.displayName || workspaceName
  return (
    <header className="flex flex-wrap items-start justify-between gap-6 border-b-2 border-neutral-900 pb-5">
      <div className="flex items-start gap-4">
        {profile.logoDataUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={profile.logoDataUrl} alt={`Logo ${name}`} className="max-h-20 max-w-32 object-contain" />
        )}
        <div className="grid gap-0.5">
          <p className="text-lg font-bold">{name}</p>
          {profile.address && <p className="whitespace-pre-line text-neutral-600">{profile.address}</p>}
          {(profile.phone || profile.email) && <p className="text-neutral-600">{[profile.phone, profile.email].filter(Boolean).join(" · ")}</p>}
          {profile.npwp && <p className="text-neutral-600">NPWP {profile.npwp}</p>}
        </div>
      </div>
      <div className="grid gap-1 text-right">
        <p className="text-xl font-black tracking-wide">{title}</p>
        <p className="font-semibold">{number}</p>
        <dl className="mt-1 grid grid-cols-[auto_auto] justify-end gap-x-3 text-neutral-600">
          {meta.map(([dt, dd]) => (
            <div key={dt} className="contents">
              <dt>{dt}</dt>
              <dd className="text-neutral-900">{dd}</dd>
            </div>
          ))}
        </dl>
      </div>
    </header>
  )
}

function Client({ contact }: { contact: Contact | null }) {
  return (
    <div className="grid content-start gap-0.5">
      <p className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">Kepada</p>
      {contact ? (
        <>
          <p className="font-semibold">{contact.name}</p>
          {contact.address && <p className="whitespace-pre-line text-neutral-600">{contact.address}</p>}
          {contact.phone && <p className="text-neutral-600">{contact.phone}</p>}
          {contact.npwp && <p className="text-neutral-600">NPWP {contact.npwp}</p>}
        </>
      ) : (
        <p className="text-neutral-500">—</p>
      )}
    </div>
  )
}

function EventInfo({ order }: { order: CateringOrder }) {
  return (
    <div className="grid content-start gap-0.5">
      <p className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">Detail pesanan</p>
      <p className="font-semibold">{SERVICE_TYPE_LABELS[order.serviceType]} · {formatNumber(order.pax)} pax</p>
      <p className="text-neutral-600">{formatDate(order.eventDate)}{order.eventTime ? `, pukul ${order.eventTime}` : ""}</p>
      {order.location && <p className="whitespace-pre-line text-neutral-600">{order.location}</p>}
    </div>
  )
}

function Signature({ name, notes }: { name: string; notes?: string | null }) {
  return (
    <footer className="mt-10 flex flex-wrap items-end justify-between gap-6">
      <p className="max-w-md whitespace-pre-line text-xs text-neutral-500">{notes ?? ""}</p>
      <div className="grid w-52 justify-items-center gap-16 text-center">
        <p>Hormat kami,</p>
        <p className="w-full border-t border-neutral-400 pt-1 font-semibold">{name}</p>
      </div>
    </footer>
  )
}

/** Quotation / Surat Penawaran Harga pesanan katering (ADR 024). */
export function QuotationDocument({
  order,
  totals,
  profile,
  workspaceName,
  contact,
  taxLabel,
  taxInclusive,
  stamp,
}: {
  order: CateringOrder
  totals: OrderTotals
  profile: BusinessProfile
  workspaceName: string
  contact: Contact | null
  taxLabel: string
  taxInclusive: boolean
  stamp?: string | null
}) {
  const title = order.number.startsWith("SPH") ? "SURAT PENAWARAN HARGA" : "QUOTATION"
  return (
    <Paper label={`${title} ${order.number}`} stamp={stamp}>
      <Letterhead
        profile={profile}
        workspaceName={workspaceName}
        title={title}
        number={order.number}
        meta={[["Tanggal", formatDate(order.quoteDate)], ["Berlaku sampai", formatDate(order.validUntil)]]}
      />
      <section className="grid gap-6 py-5 sm:grid-cols-2 print:grid-cols-2">
        <Client contact={contact} />
        <EventInfo order={order} />
      </section>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-y border-neutral-900 text-left text-xs tracking-wide uppercase">
            <th className="w-8 py-2 pr-2">No</th>
            <th className="py-2 pr-2">Keterangan</th>
            <th className="py-2 pr-2 text-right">Qty</th>
            <th className="py-2 pr-2">Satuan</th>
            <th className="py-2 pr-2 text-right">Harga</th>
            <th className="py-2 text-right">Jumlah</th>
          </tr>
        </thead>
        <tbody>
          {order.lines.map((line, i) => (
            <tr key={i} className="border-b border-neutral-200 align-top">
              <td className="py-2 pr-2 text-neutral-500">{i + 1}</td>
              <td className="py-2 pr-2">{line.description || "—"}</td>
              <td className="py-2 pr-2 text-right tabular-nums">{formatNumber(line.quantity)}</td>
              <td className="py-2 pr-2">{line.unit ?? ""}</td>
              <td className="py-2 pr-2 text-right tabular-nums whitespace-nowrap">{rupiah(line.unitPrice)}</td>
              <td className="py-2 text-right tabular-nums whitespace-nowrap">{rupiah(Number.isSafeInteger(line.quantity * line.unitPrice) ? lineAmount(line) : 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <section className="mt-4 grid gap-6 sm:grid-cols-[1fr_17rem] print:grid-cols-[1fr_17rem]">
        <div className="grid content-start gap-3">
          <p className="text-neutral-600">
            <span className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">Terbilang</span>
            <br />
            <em>{terbilang(totals.total)}</em>
          </p>
          <div>
            <p className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">Ketentuan pembatalan</p>
            <p>{policyLabel(order.cancellationPolicy)} bila pesanan dibatalkan.</p>
          </div>
          {profile.bankInfo && (
            <div>
              <p className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">Pembayaran ke</p>
              <p className="whitespace-pre-line">{profile.bankInfo}</p>
            </div>
          )}
          {order.notes && (
            <div>
              <p className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">Catatan</p>
              <p className="whitespace-pre-line">{order.notes}</p>
            </div>
          )}
        </div>
        <dl className="grid content-start gap-1.5">
          <div className="flex justify-between gap-4">
            <dt className="text-neutral-600">Subtotal</dt>
            <dd className="tabular-nums">{rupiah(totals.subtotal)}</dd>
          </div>
          {totals.discount > 0 && (
            <div className="flex justify-between gap-4">
              <dt className="text-neutral-600">Diskon{order.discount?.kind === "percent" ? ` ${formatPercentBps(order.discount.value)}` : ""}</dt>
              <dd className="tabular-nums">−{rupiah(totals.discount)}</dd>
            </div>
          )}
          {totals.tax > 0 && (
            <div className="flex justify-between gap-4">
              <dt className="text-neutral-600">{taxLabel}{taxInclusive ? " (termasuk)" : ""}</dt>
              <dd className="tabular-nums">{rupiah(totals.tax)}</dd>
            </div>
          )}
          <div className="flex justify-between gap-4 border-t-2 border-neutral-900 pt-2 text-base font-bold">
            <dt>Total</dt>
            <dd className="tabular-nums">{rupiah(totals.total)}</dd>
          </div>
          {totals.total > 0 && (
            <p className="text-right text-xs text-neutral-500">≈ {rupiah(Math.round(totals.total / order.pax))} / pax</p>
          )}
        </dl>
      </section>
      <Signature name={profile.displayName || workspaceName} />
    </Paper>
  )
}

/** Invoice uang muka (DP) pesanan: dokumen tagihan tanpa jurnal (ADR 024). */
export function BillDocument({
  bill,
  order,
  orderTotal,
  profile,
  workspaceName,
  contact,
  stamp,
}: {
  bill: OrderBill
  order: CateringOrder
  orderTotal: number
  profile: BusinessProfile
  workspaceName: string
  contact: Contact | null
  stamp?: string | null
}) {
  return (
    <Paper label={`Invoice DP ${bill.number}`} stamp={stamp}>
      <Letterhead
        profile={profile}
        workspaceName={workspaceName}
        title="INVOICE UANG MUKA"
        number={bill.number}
        meta={[["Tanggal", formatDate(bill.billDate)], ["Jatuh tempo", formatDate(bill.dueDate)], ["Pesanan", order.number]]}
      />
      <section className="grid gap-6 py-5 sm:grid-cols-2 print:grid-cols-2">
        <Client contact={contact} />
        <EventInfo order={order} />
      </section>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-y border-neutral-900 text-left text-xs tracking-wide uppercase">
            <th className="w-8 py-2 pr-2">No</th>
            <th className="py-2 pr-2">Keterangan</th>
            <th className="py-2 text-right">Jumlah</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-neutral-200 align-top">
            <td className="py-2 pr-2 text-neutral-500">1</td>
            <td className="py-2 pr-2">
              Uang muka (DP) pesanan {order.number} — {SERVICE_TYPE_LABELS[order.serviceType].toLowerCase()} {formatDate(order.eventDate)}
              {bill.note && <span className="block text-neutral-600">{bill.note}</span>}
            </td>
            <td className="py-2 text-right tabular-nums whitespace-nowrap">{rupiah(bill.amount)}</td>
          </tr>
        </tbody>
      </table>
      <section className="mt-4 grid gap-6 sm:grid-cols-[1fr_17rem] print:grid-cols-[1fr_17rem]">
        <div className="grid content-start gap-3">
          <p className="text-neutral-600">
            <span className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">Terbilang</span>
            <br />
            <em>{terbilang(bill.amount)}</em>
          </p>
          {profile.bankInfo && (
            <div>
              <p className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">Pembayaran ke</p>
              <p className="whitespace-pre-line">{profile.bankInfo}</p>
            </div>
          )}
          <p className="text-xs text-neutral-500">
            Uang muka mengurangi tagihan pelunasan yang diterbitkan setelah acara. {policyLabel(order.cancellationPolicy)} bila pesanan dibatalkan.
          </p>
        </div>
        <dl className="grid content-start gap-1.5">
          <div className="flex justify-between gap-4">
            <dt className="text-neutral-600">Total pesanan</dt>
            <dd className="tabular-nums">{rupiah(orderTotal)}</dd>
          </div>
          <div className="flex justify-between gap-4 border-t-2 border-neutral-900 pt-2 text-base font-bold">
            <dt>Uang muka</dt>
            <dd className="tabular-nums">{rupiah(bill.amount)}</dd>
          </div>
        </dl>
      </section>
      <Signature name={profile.displayName || workspaceName} notes={profile.invoiceNotes} />
    </Paper>
  )
}
