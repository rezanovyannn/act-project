"use client"

import { formatAccounting } from "@/core/format"
import { AmountInput } from "@/components/ui/amount-input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"

/**
 * Isian PPN Masukan (mode PPN lengkap, ADR 016): sakelar "ada faktur PPN" dan
 * nominal yang dihitung dari DPP × tarif namun boleh dikoreksi sesuai faktur.
 * `override = null` berarti mengikuti hitungan otomatis.
 */
export function InputVatField({
  id,
  enabled,
  onEnabledChange,
  suggested,
  override,
  onOverrideChange,
  rateLabel,
}: {
  id: string
  enabled: boolean
  onEnabledChange: (enabled: boolean) => void
  suggested: number
  override: number | null
  onOverrideChange: (value: number | null) => void
  /** Mis. "12% × DPP 11/12". */
  rateLabel: string
}) {
  return (
    <div className="grid gap-3 rounded-lg bg-canvas p-4">
      <label className="flex items-center gap-3 text-sm">
        <Switch checked={enabled} onCheckedChange={onEnabledChange} />
        Ada faktur PPN (PPN Masukan dapat dikreditkan)
      </label>
      {enabled && (
        <div className="grid gap-2 sm:max-w-xs">
          <Label htmlFor={id}>PPN Masukan sesuai faktur</Label>
          <AmountInput id={id} value={override ?? suggested} onValueChange={onOverrideChange} />
          <p className="text-xs text-muted-foreground">
            Hitungan otomatis {rateLabel}: {formatAccounting(suggested)}.
            {override !== null && override !== suggested && (
              <>
                {" "}
                <button type="button" className="underline underline-offset-4" onClick={() => onOverrideChange(null)}>
                  Pakai hitungan otomatis
                </button>
              </>
            )}
          </p>
        </div>
      )}
    </div>
  )
}
