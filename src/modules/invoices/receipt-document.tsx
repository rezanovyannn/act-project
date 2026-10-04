"use client"

import { formatDate, formatNumber } from "@/core/format"
import { terbilang } from "@/core/invoice"
import type { BusinessProfile, Invoice } from "@/core/types"

const rupiah = (n: number) => `Rp ${formatNumber(n)}`

/**
 * Tanda Terima Faktur (ADR 022): diberikan ke pemasok saat tukar faktur sebagai
 * bukti fakturnya sudah kita terima; memuat nomor faktur pemasok, nominal, dan jatuh tempo.
 */
export function ReceiptDocument({
  invoice,
  profile,
  workspaceName,
  total,
  stamp,
}: {
  invoice: Invoice
  profile: BusinessProfile
  workspaceName: string
  total: number
  stamp?: string | null
}) {
  const name = profile.displayName || workspaceName
  const supplier = invoice.contactSnapshot

  return (
    <article
      aria-label={`Tanda terima faktur ${invoice.number ?? "draft"}`}
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
          </div>
        </div>
        <div className="grid gap-1 text-right">
          <p className="text-xl font-black tracking-wide">TANDA TERIMA FAKTUR</p>
          <p className="font-semibold">{invoice.number ?? "DRAFT"}</p>
        </div>
      </header>

      <section className="grid gap-1 py-5">
        <p>Telah diterima dari:</p>
        <p className="text-base font-semibold">{supplier?.name ?? "—"}</p>
        {supplier?.address && <p className="whitespace-pre-line text-neutral-600">{supplier.address}</p>}
        {supplier?.npwp && <p className="text-neutral-600">NPWP {supplier.npwp}</p>}
      </section>

      <table className="w-full border-collapse">
        <thead>
          <tr className="border-y border-neutral-900 text-left text-xs tracking-wide uppercase">
            <th className="py-2 pr-2">No. faktur pemasok</th>
            <th className="py-2 pr-2">Tanggal faktur</th>
            <th className="py-2 pr-2">Jatuh tempo</th>
            <th className="py-2 text-right">Jumlah</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-neutral-200">
            <td className="py-2 pr-2 font-semibold">{invoice.reference ?? "—"}</td>
            <td className="py-2 pr-2">{formatDate(invoice.invoiceDate)}</td>
            <td className="py-2 pr-2">{formatDate(invoice.dueDate)}</td>
            <td className="py-2 text-right font-semibold tabular-nums">{rupiah(total)}</td>
          </tr>
        </tbody>
      </table>
      <p className="mt-3 text-neutral-600">
        Terbilang: <em>{terbilang(total)}</em>
      </p>
      <p className="mt-3 text-neutral-600">
        Faktur akan dibayar pada atau sebelum tanggal jatuh tempo <strong className="text-neutral-900">{formatDate(invoice.dueDate)}</strong>.
      </p>
      {invoice.notes && <p className="mt-2 whitespace-pre-line">Catatan: {invoice.notes}</p>}

      <footer className="mt-12 grid grid-cols-2 gap-10 text-center">
        <div className="grid justify-items-center gap-16">
          <p>Yang menyerahkan,</p>
          <p className="w-48 border-t border-neutral-400 pt-1 font-semibold">{supplier?.name ?? ""}</p>
        </div>
        <div className="grid justify-items-center gap-16">
          <p>Yang menerima, {formatDate(invoice.issuedAt ? invoice.issuedAt.slice(0, 10) : invoice.invoiceDate)}</p>
          <p className="w-48 border-t border-neutral-400 pt-1 font-semibold">{name}</p>
        </div>
      </footer>
    </article>
  )
}
