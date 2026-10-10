"use client"

import { useId, useState } from "react"
import { policyLabel } from "@/core/cancellation-policy"
import { formatPercentBps, parsePercentBps } from "@/core/invoice"
import type { CancellationPolicy } from "@/core/types"
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

const KIND_LABELS: Record<CancellationPolicy["kind"] | "none", string> = {
  none: "Belum diatur",
  refund: "DP dikembalikan penuh",
  forfeit_percent: "DP hangus sebagian (%)",
  forfeit_all: "DP hangus seluruhnya",
}

/**
 * Kebijakan DP saat pesanan katering dibatalkan (ADR 024). `allowNone` untuk
 * default kontak yang boleh kosong. Persen yang belum valid dilaporkan sebagai null.
 */
function CancellationPolicyField({
  value,
  onChange,
  allowNone = false,
  label = "Kebijakan pembatalan",
}: {
  value: CancellationPolicy | null
  /** `valid = false` bila persen belum benar (value null). */
  onChange: (value: CancellationPolicy | null, valid: boolean) => void
  allowNone?: boolean
  label?: string
}) {
  const id = useId()
  const [kind, setKind] = useState<CancellationPolicy["kind"] | "none">(value?.kind ?? (allowNone ? "none" : "refund"))
  const [percent, setPercent] = useState(value?.kind === "forfeit_percent" ? formatPercentBps(value.forfeitBps).replace("%", "") : "")
  const bps = parsePercentBps(percent || "0")
  const percentValid = bps !== null && bps > 0 && bps < 10_000

  function emit(nextKind: typeof kind, nextPercent: string) {
    if (nextKind === "none") return onChange(null, true)
    if (nextKind !== "forfeit_percent") return onChange({ kind: nextKind, forfeitBps: 0 }, true)
    const next = parsePercentBps(nextPercent || "0")
    const ok = next !== null && next > 0 && next < 10_000
    onChange(ok ? { kind: "forfeit_percent", forfeitBps: next } : null, ok)
  }

  return (
    <div className="grid gap-2">
      <Label htmlFor={`${id}-kind`}>{label}</Label>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_8rem]">
        <Select
          value={kind}
          onValueChange={(v) => {
            const next = v as typeof kind
            setKind(next)
            emit(next, percent)
          }}
        >
          <SelectTrigger id={`${id}-kind`} className="w-full bg-background"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(allowNone ? (["none", "refund", "forfeit_percent", "forfeit_all"] as const) : (["refund", "forfeit_percent", "forfeit_all"] as const)).map((k) => (
              <SelectItem key={k} value={k}>{KIND_LABELS[k]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {kind === "forfeit_percent" && (
          <InputGroup>
            <InputGroupInput
              aria-label="Persen DP hangus"
              inputMode="decimal"
              placeholder="mis. 50"
              value={percent}
              onChange={(e) => {
                const next = e.target.value.replace(/[^\d.,]/g, "")
                setPercent(next)
                emit(kind, next)
              }}
              className="text-right tabular-nums"
            />
            <InputGroupAddon align="inline-end"><InputGroupText>%</InputGroupText></InputGroupAddon>
          </InputGroup>
        )}
      </div>
      <p className={kind === "forfeit_percent" && percent && !percentValid ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
        {kind === "forfeit_percent" && !percentValid
          ? "Isi persen DP yang hangus, lebih dari 0 dan kurang dari 100."
          : kind === "none"
            ? "Pesanan baru untuk kontak ini memakai “DP dikembalikan penuh” sampai diubah."
            : `${policyLabel(kind === "forfeit_percent" ? { kind, forfeitBps: bps ?? 0 } : { kind, forfeitBps: 0 })} bila pesanan dibatalkan.`}
      </p>
    </div>
  )
}

export { CancellationPolicyField }
