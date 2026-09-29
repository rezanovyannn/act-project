import { CheckCircle2Icon, TriangleAlertIcon } from "lucide-react"
import type { ReportSection } from "@/core/reports"
import { Amount } from "@/components/ui/amount"
import { cn } from "@/lib/utils"

export type StatementRow =
  | { kind: "heading"; label: string }
  | { kind: "line"; label: string; code?: string; amount: number; indent?: boolean }
  | { kind: "subtotal" | "total"; label: string; amount: number }
  | { kind: "note"; label: string }

/** Baris akun dari satu seksi laporan. */
export function sectionRows(section: ReportSection, emptyLabel = "Tidak ada saldo"): StatementRow[] {
  if (section.lines.length === 0) return [{ kind: "note", label: emptyLabel }]
  return section.lines.map((l) => ({ kind: "line", label: l.name, code: l.code, amount: l.amount, indent: true }))
}

/** Tabel laporan keuangan: judul seksi, baris akun, subtotal, total. */
export function StatementTable({ title, subtitle, rows }: { title: string; subtitle: string; rows: StatementRow[] }) {
  return (
    <section className="overflow-hidden rounded-lg border bg-canvas" aria-label={title}>
      <header className="border-b bg-card px-4 py-3 text-center sm:px-6">
        <h2 className="text-lg font-bold">{title}</h2>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </header>
      <table className="w-full text-sm">
        <tbody>
          {rows.map((row, index) => {
            if (row.kind === "heading") {
              return (
                <tr key={index}>
                  <th colSpan={2} scope="rowgroup" className="px-4 pt-5 pb-1 text-left font-bold text-ink sm:px-6">
                    {row.label}
                  </th>
                </tr>
              )
            }
            if (row.kind === "note") {
              return (
                <tr key={index}>
                  <td colSpan={2} className="px-4 py-1.5 pl-8 text-muted-foreground italic sm:pl-10">
                    {row.label}
                  </td>
                </tr>
              )
            }
            const emphasis = row.kind === "subtotal" || row.kind === "total"
            return (
              <tr
                key={index}
                className={cn(
                  row.kind === "subtotal" && "border-t font-semibold text-ink",
                  row.kind === "total" && "border-t-2 border-ink font-bold text-ink",
                )}
              >
                <td className={cn("py-1.5 pr-2", row.kind === "line" && row.indent ? "pl-8 sm:pl-10" : "pl-4 sm:pl-6", emphasis && "py-2.5")}>
                  {row.kind === "line" && row.code && (
                    <span className="mr-2 text-xs text-muted-foreground tabular-nums">{row.code}</span>
                  )}
                  {row.label}
                </td>
                <td className={cn("w-44 py-1.5 pr-4 pl-2 text-right sm:pr-6", emphasis && "py-2.5")}>
                  <Amount value={row.amount} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}

/** Hasil pengecekan invarian, ditampilkan dengan ikon + teks (bukan warna saja). */
export function InvariantCheck({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) {
  return (
    <p
      role="status"
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-lg px-4 py-3 text-sm print:hidden",
        ok ? "bg-success-pale text-success-deep" : "border border-destructive/40 text-destructive",
      )}
    >
      {ok ? <CheckCircle2Icon className="size-4" /> : <TriangleAlertIcon className="size-4" />}
      <strong>{label}</strong>
      {detail && <span>{detail}</span>}
    </p>
  )
}
