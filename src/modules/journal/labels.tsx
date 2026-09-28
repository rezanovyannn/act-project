import type { AccountType, JournalEntry, JournalSource } from "@/core/types"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

export const SOURCE_LABELS: Record<JournalSource, string> = {
  manual: "Jurnal umum",
  revenue: "Penjualan",
  expense: "Beban",
  purchase: "Pembelian",
  adjustment: "Penyesuaian",
  opening_balance: "Saldo awal",
  settlement: "Pelunasan",
  tax_payment: "Setoran pajak",
  reversal: "Pembalik",
  closing: "Penutup",
}

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  asset: "Aset",
  liability: "Liabilitas",
  equity: "Ekuitas",
  revenue: "Pendapatan",
  cogs: "Harga Pokok Penjualan",
  expense: "Beban",
}

export const ACCOUNT_TYPE_ORDER: AccountType[] = [
  "asset",
  "liability",
  "equity",
  "revenue",
  "cogs",
  "expense",
]

/** Badge status sesuai docs/DESIGN_SYSTEM.md (tidak hanya mengandalkan warna). */
export function JournalStatusBadges({
  entry,
  voided,
  className,
}: {
  entry: Pick<JournalEntry, "status">
  voided: boolean
  className?: string
}) {
  return (
    <span className={cn("inline-flex flex-wrap gap-1", className)}>
      {entry.status === "draft" ? (
        <Badge className="bg-muted text-muted-foreground">Draft</Badge>
      ) : (
        <Badge className="bg-success-pale text-success-deep">Posted</Badge>
      )}
      {voided && (
        <Badge className="bg-secondary text-muted-foreground line-through">Di-void</Badge>
      )}
    </span>
  )
}

export function journalTotal(entry: Pick<JournalEntry, "lines">): number {
  return entry.lines.reduce((sum, line) => sum + line.debit, 0)
}
