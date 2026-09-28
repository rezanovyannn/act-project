"use client"

import { useState } from "react"
import { SettingsIcon } from "lucide-react"
import { toast } from "sonner"
import { formatTaxRate, parseTaxRatePercent } from "@/core/sales-tax"
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
import { Switch } from "@/components/ui/switch"
import { errorMessage } from "@/lib/utils"

/** Tarif & mode harga PB1 workspace (ADR 012). */
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
  const [error, setError] = useState<string | null>(null)

  function openChange(next: boolean) {
    if (next) {
      setRateText(formatTaxRate(workspace.salesTaxRateBps).replace("%", ""))
      setInclusive(workspace.salesTaxInclusive)
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
      await services.workspaceService.updateSalesTaxSettings(workspace.id, { rateBps, inclusive })
      toast.success(`Pengaturan PB1 disimpan: ${formatTaxRate(rateBps)}`)
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
          PB1 {formatTaxRate(workspace.salesTaxRateBps)}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>Pengaturan PB1</DialogTitle>
            <DialogDescription>
              PB1 yang dipungut dicatat sebagai Utang PB1, bukan pendapatan. Perubahan hanya berlaku
              untuk transaksi baru.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="tax-rate">Tarif (%)</Label>
            <Input
              id="tax-rate"
              inputMode="decimal"
              value={rateText}
              onChange={(e) => setRateText(e.target.value)}
              className="w-32"
            />
            <p className="text-xs text-muted-foreground">Tarif PBJT ditetapkan per daerah; umumnya 10%.</p>
          </div>
          <label className="flex items-center gap-3 text-sm">
            <Switch checked={inclusive} onCheckedChange={setInclusive} />
            Harga menu sudah termasuk PB1
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
