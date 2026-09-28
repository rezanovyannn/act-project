"use client"

import * as React from "react"
import { cn } from "cn"
import { formatNumber, parseRupiahInput } from "@/core/format"

/**
 * Input nominal Rupiah (integer). Menampilkan pemisah ribuan saat tidak
 * fokus; nilai tidak valid dilaporkan sebagai `null`.
 */
function AmountInput({
  value,
  onValueChange,
  className,
  ...props
}: Omit<React.ComponentProps<"input">, "value" | "onChange" | "type"> & {
  value: number | null
  onValueChange: (value: number | null) => void
}) {
  // Teks ketikan hanya disimpan selama diedit (atau bila tidak valid);
  // selain itu tampilan diturunkan dari `value` sehingga perubahan dari luar langsung terlihat.
  const [editingText, setEditingText] = React.useState<string | null>(null)
  const text = editingText ?? (value ? formatNumber(value) : "")

  return (
    <div
      className={cn(
        "flex h-10 w-full items-center gap-1 rounded-lg border border-input bg-background px-3 text-sm focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 has-aria-invalid:border-destructive",
        className,
      )}
    >
      <span className="text-muted-foreground">Rp</span>
      <input
        inputMode="numeric"
        autoComplete="off"
        className="w-full min-w-0 bg-transparent text-right tabular-nums outline-none"
        value={text}
        aria-invalid={value === null || undefined}
        onFocus={() => setEditingText(text)}
        onBlur={() => setEditingText(value === null ? text : null)}
        onChange={(event) => {
          setEditingText(event.target.value)
          onValueChange(parseRupiahInput(event.target.value))
        }}
        {...props}
      />
    </div>
  )
}

export { AmountInput }
