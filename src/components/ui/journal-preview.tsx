import Link from "next/link"
import { CheckCircle2Icon } from "lucide-react"
import type { Account, JournalEntry, JournalLineInput } from "@/core/types"
import { Amount } from "@/components/ui/amount"

/** Pratinjau baris jurnal yang akan dibentuk sebuah form transaksi. */
function JournalPreview({
  lines,
  accounts,
  title = "Jurnal yang akan dibuat",
}: {
  lines: readonly JournalLineInput[]
  accounts: readonly Account[]
  title?: string
}) {
  const byId = new Map(accounts.map((a) => [a.id, a]))
  return (
    <div className="overflow-hidden rounded-2xl bg-canvas ring-1 ring-border">
      <p className="border-b bg-card px-4 py-2 text-sm font-bold text-ink">{title}</p>
      {lines.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">Lengkapi isian untuk melihat jurnal.</p>
      ) : (
        <table className="w-full table-fixed text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="py-1.5 pl-4 text-left font-medium">Akun</th>
              <th className="w-32 px-2 py-1.5 text-right font-medium">Debit</th>
              <th className="w-32 py-1.5 pr-4 pl-2 text-right font-medium">Kredit</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {lines.map((line, index) => {
              const account = byId.get(line.accountId)
              return (
                <tr key={index}>
                  <td className={line.credit > 0 ? "py-2 pr-2 pl-8" : "py-2 pr-2 pl-4"}>
                    <span className="block truncate text-ink">{account?.name ?? "—"}</span>
                    <span className="block text-xs text-muted-foreground tabular-nums">{account?.code}</span>
                  </td>
                  <td className="w-32 px-2 py-2 text-right">
                    <Amount value={line.debit} hideZero />
                  </td>
                  <td className="w-32 py-2 pr-4 pl-2 text-right">
                    <Amount value={line.credit} hideZero />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

/** Konfirmasi setelah posting, dengan tautan ke jurnal yang terbentuk. */
function PostedNotice({ entry, href }: { entry: JournalEntry; href: string }) {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-2 rounded-lg bg-success-pale px-4 py-3 text-sm text-success-deep"
    >
      <CheckCircle2Icon className="size-4" />
      <span>
        Jurnal <strong>{entry.entryNumber}</strong> diposting.
      </span>
      <Link href={href} className="font-semibold underline underline-offset-4">
        Lihat jurnal
      </Link>
    </div>
  )
}

export { JournalPreview, PostedNotice }
