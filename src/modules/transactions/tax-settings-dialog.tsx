"use client"

import { useState } from "react"
import { SettingsIcon } from "lucide-react"
import { toast } from "sonner"
import { formatTaxRate, parseTaxRatePercent, SALES_TAX_LABELS, type SalesTaxLabel } from "@/core/sales-tax"
import type { AppServices } from "@/core/services"
import type { Workspace } from "@/core/types"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { errorMessage } from "@/lib/utils"

const LABEL_HINTS: Record<SalesTaxLabel, string> = {
  PB1: "PB1/PBJT restoran; tarif ditetapkan per daerah, umumnya 10%.",
  PPN: "PPN untuk pengusaha kena pajak (PKP); isi 0% bila belum PKP. PPN Masukan belum dicatat terpisah.",
}

/** Jenis, tarif & mode harga pajak penjualan workspace (ADR 012 & 015). */
export function TaxSettingsDialog({
  services,
  workspace,
  onSaved,
}: {
  services: AppServices
  workspace: Workspace
  onSaved: () => void
}) {
  const [open, setOpen] = useState(false)
  const [rateText, setRateText] = useState("")
  const [inclusive, setInclusive] = useState(workspace.salesTaxInclusive)
  const [label, setLabel] = useState<SalesTaxLabel>(workspace.salesTaxLabel)
  const [error, setError] = useState<string | null>(null)

  function openChange(next: boolean) {
    if (next) {
      setRateText(formatTaxRate(workspace.salesTaxRateBps).replace("%", ""))
      setInclusive(workspace.salesTaxInclusive)
      setLabel(workspace.salesTaxLabel)
      setError(null)
    }
    setOpen(next)
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const rateBps = parseTaxRatePercent(rateText)
    if (rateBps === null) {
      setError("Tarif tidak valid. Contoh: 10 atau 10,5 (maksimal 2 desimal, 0–100).")
      return
    }
    try {
      await services.workspaceService.updateSalesTaxSettings(workspace.id, { label, rateBps, inclusive })
      toast.success(`Pengaturan ${label} disimpan: ${formatTaxRate(rateBps)}`)
      setOpen(false)
      onSaved()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <Dialog open={open} onOpenChange={openChange}>
      <DialogTrigger asChild>
        <Button variant="secondary">
          <SettingsIcon data-icon="inline-start" />
          {workspace.salesTaxLabel} {formatTaxRate(workspace.salesTaxRateBps)}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>Pengaturan pajak penjualan</DialogTitle>
            <DialogDescription>
              Pajak yang dipungut dicatat sebagai utang pajak, bukan pendapatan. Perubahan hanya berlaku
              untuk transaksi baru.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="tax-label">Jenis pajak</Label>
            <Select value={label} onValueChange={(value) => setLabel(value as SalesTaxLabel)}>
              <SelectTrigger id="tax-label" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SALES_TAX_LABELS.map((l) => (
                  <SelectItem key={l} value={l}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="tax-rate">Tarif (%)</Label>
            <Input
              id="tax-rate"
              inputMode="decimal"
              value={rateText}
              onChange={(e) => setRateText(e.target.value)}
              className="w-32"
            />
            <p className="text-xs text-muted-foreground">{LABEL_HINTS[label]}</p>
          </div>
          <label className="flex items-center gap-3 text-sm">
            <Switch checked={inclusive} onCheckedChange={setInclusive} />
            Harga jual sudah termasuk {label}
          </label>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Batal
            </Button>
            <Button type="submit">Simpan</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
