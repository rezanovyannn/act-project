import { cn } from "cn"
import { formatAccounting } from "@/core/format"

/** Nominal Rupiah rata kanan; negatif dalam kurung (docs/DESIGN_SYSTEM.md). */
function Amount({
  value,
  className,
  hideZero = false,
}: {
  value: number
  className?: string
  hideZero?: boolean
}) {
  return (
    <span data-slot="amount" className={cn("tabular-nums whitespace-nowrap", className)}>
      {hideZero && value === 0 ? "" : formatAccounting(value)}
    </span>
  )
}

export { Amount }
