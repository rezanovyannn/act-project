"use client"

import { formatDate, formatNumber } from "@/core/format"
import { lineAmount, terbilang } from "@/core/invoice"
import type { BusinessProfile, ContactSnapshot, Invoice } from "@/core/types"
import { cn } from "@/lib/utils"

const rupiah = (n: number) => `Rp ${formatNumber(n)}`

export interface DocumentTotals {
  base: number
  tax: number
  total: number
}

/** Faktur berbentuk kertas A4 untuk pratinjau & cetak/PDF (ADR 022). */
export function InvoiceDocument({
  invoice,
  profile,
  workspaceName,
  contact,
  totals,
  taxLabel,
  taxInclusive,
  stamp,
}: {
  invoice: Invoice
  profile: BusinessProfile
  workspaceName: string
  contact: ContactSnapshot | null
  totals: DocumentTotals
  taxLabel: string
  taxInclusive: boolean
  /** Cap besar di latar, mis. DRAFT atau DIBATALKAN. */
  stamp?: string | null
}) {
  const name = profile.displayName || workspaceName
  const subtotal = invoice.lines.reduce((t, l) => t + lineAmount(l), 0)
  const title = invoice.kind === "sale" ? "FAKTUR PENJUALAN" : "FAKTUR PEMBELIAN"

  return (
    <article
      aria-label={`${title} ${invoice.number ?? "draft"}`}
      className="relative mx-auto w-full max-w-[210mm] overflow-hidden bg-white p-[12mm] text-[13px] leading-relaxed text-neutral-900 shadow-sm ring-1 ring-border print:max-w-none print:p-0 print:shadow-none print:ring-0"
      style={{ colorScheme: "light" }}
    >
      {stamp && (
        <div aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center">
          <span className="-rotate-12 rounded-xl border-[6px] border-red-500/25 px-10 py-2 text-7xl font-black tracking-widest text-red-500/20">{stamp}</span>
        </div>
      )}

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
          <p className="font-semibold">{invoice.number ?? "DRAFT"}</p>
          <dl className="mt-1 grid grid-cols-[auto_auto] justify-end gap-x-3 text-neutral-600">
            <dt>Tanggal</dt>
            <dd className="text-neutral-900">{formatDate(invoice.invoiceDate)}</dd>
            <dt>Jatuh tempo</dt>
            <dd className="font-semibold text-neutral-900">{formatDate(invoice.dueDate)}</dd>
            {invoice.reference && (
              <>
                <dt>{invoice.kind === "sale" ? "Referensi" : "No. faktur pemasok"}</dt>
                <dd className="text-neutral-900">{invoice.reference}</dd>
              </>
            )}
          </dl>
        </div>
      </header>

      <section className="grid gap-0.5 py-5">
        <p className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">{invoice.kind === "sale" ? "Kepada" : "Dari"}</p>
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
          {invoice.lines.map((line, i) => (
            <tr key={i} className="border-b border-neutral-200 align-top">
              <td className="py-2 pr-2 text-neutral-500">{i + 1}</td>
              <td className="py-2 pr-2">{line.description || "—"}</td>
              <td className="py-2 pr-2 text-right tabular-nums">{formatNumber(line.quantity)}</td>
              <td className="py-2 pr-2">{line.unit ?? ""}</td>
              <td className="py-2 pr-2 text-right tabular-nums whitespace-nowrap">{rupiah(line.unitPrice)}</td>
              <td className="py-2 text-right tabular-nums whitespace-nowrap">{rupiah(lineAmount(line))}</td>
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
          {invoice.kind === "sale" && profile.bankInfo && (
            <div>
              <p className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">Pembayaran ke</p>
              <p className="whitespace-pre-line">{profile.bankInfo}</p>
            </div>
          )}
          {invoice.notes && (
            <div>
              <p className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">Catatan</p>
              <p className="whitespace-pre-line">{invoice.notes}</p>
            </div>
          )}
        </div>
        <dl className="grid content-start gap-1.5">
          <div className="flex justify-between gap-4">
            <dt className="text-neutral-600">Subtotal</dt>
            <dd className="tabular-nums">{rupiah(subtotal)}</dd>
          </div>
          {totals.tax > 0 && (
            <div className="flex justify-between gap-4">
              <dt className="text-neutral-600">{taxLabel}{taxInclusive ? " (termasuk)" : ""}</dt>
              <dd className="tabular-nums">{rupiah(totals.tax)}</dd>
            </div>
          )}
          <div className={cn("flex justify-between gap-4 border-t-2 border-neutral-900 pt-2 text-base font-bold")}>
            <dt>Total</dt>
            <dd className="tabular-nums">{rupiah(totals.total)}</dd>
          </div>
        </dl>
      </section>

      <footer className="mt-10 flex flex-wrap items-end justify-between gap-6">
        <p className="max-w-md whitespace-pre-line text-xs text-neutral-500">{invoice.kind === "sale" ? profile.invoiceNotes : ""}</p>
        <div className="grid w-52 justify-items-center gap-16 text-center">
          <p>Hormat kami,</p>
          <p className="w-full border-t border-neutral-400 pt-1 font-semibold">{name}</p>
        </div>
      </footer>
    </article>
  )
}
