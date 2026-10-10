"use client"

import { useState } from "react"
import { toast } from "sonner"
import { parsePercentBps } from "@/core/invoice"
import type { AppServices } from "@/core/services"
import type { CateringCostMode, Workspace } from "@/core/types"
import { Button } from "@/components/ui/button"
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { errorMessage } from "@/lib/utils"

const COST_MODE_LABELS: Record<CateringCostMode, string> = {
  detail: "Rinci: bahan, tenaga lepas, sewa alat, transport, kemasan, lain-lain",
  materials: "Bahan baku saja",
}

/**
 * Pengaturan pesanan katering (ADR 024, Fase 10B): `pph23` di tab Pajak,
 * `cost` (mode biaya pesanan) di tab Persediaan.
 */
export function CateringSettingsCard({
  services,
  workspace,
  part,
  onSaved,
}: {
  services: AppServices
  workspace: Workspace
  part: "pph23" | "cost"
  onSaved: () => void
}) {
  const current = workspace.cateringSettings
  const [costMode, setCostMode] = useState<CateringCostMode>(current.costMode)
  const [enabled, setEnabled] = useState(current.pph23Enabled)
  const [rate, setRate] = useState(String(current.pph23RateBps / 100).replace(".", ","))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const rateBps = parsePercentBps(rate || "0")
  const changed = costMode !== current.costMode || enabled !== current.pph23Enabled || rateBps !== current.pph23RateBps

  async function save() {
    setError(null)
    if (rateBps === null || rateBps < 1) return setError("Tarif PPh 23 harus lebih dari 0%")
    setSaving(true)
    try {
      await services.cateringService.updateSettings(workspace.id, { costMode, pph23Enabled: enabled, pph23RateBps: rateBps })
      toast.success("Pengaturan pesanan disimpan")
      onSaved()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="grid max-w-3xl gap-3 rounded-2xl bg-canvas p-4 text-sm ring-1 ring-border sm:p-6">
      {part === "pph23" ? (
        <>
          <h2 className="font-bold text-ink">PPh 23 dipotong pelanggan (pesanan katering)</h2>
          <label className="flex items-center gap-3">
            <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="PPh 23 dipotong pelanggan" />
            <span>{enabled ? "Aktif: dialog terima pelunasan menampilkan potongan PPh 23" : "Nonaktif"}</span>
          </label>
          <div className="grid gap-1.5 sm:max-w-40">
            <Label htmlFor="pph23-rate">Tarif PPh 23</Label>
            <InputGroup>
              <InputGroupInput id="pph23-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value.replace(/[^\d.,]/g, ""))} className="text-right tabular-nums" />
              <InputGroupAddon align="inline-end"><InputGroupText>%</InputGroupText></InputGroupAddon>
            </InputGroup>
          </div>
          <p className="text-xs text-muted-foreground">
            Pelanggan badan dapat memotong PPh 23 (umumnya 2%) atas jasa katering, kecuali Anda menyerahkan Suket PP 55/2022. Potongan dicatat saat pelunasan:
            kas yang diterima + PPh 23 Dibayar Dimuka (aset) melunasi piutang. Nilainya dihitung dari tagihan tanpa {workspace.salesTaxLabel} dan bisa disesuaikan
            dengan bukti potong. Katering bukan objek PPN; pajak penjualannya PBJT.
          </p>
        </>
      ) : (
        <>
          <h2 className="font-bold text-ink">Biaya per pesanan katering</h2>
          <div className="grid gap-1.5 sm:max-w-md">
            <Label htmlFor="cost-mode">Biaya yang dicatat & dihitung di laba per pesanan</Label>
            <Select value={costMode} onValueChange={(v) => setCostMode(v as CateringCostMode)}>
              <SelectTrigger id="cost-mode" className="w-full bg-background"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(COST_MODE_LABELS) as CateringCostMode[]).map((m) => (
                  <SelectItem key={m} value={m}>{COST_MODE_LABELS[m]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">
            Bahan untuk pesanan dicatat langsung ke HPP Bahan Baku (bukan Persediaan); sisa bahan di akhir bulan dikoreksi lewat Stok Opname & COGS.
            Mode bisa diubah kapan saja; laporan laba per pesanan menyesuaikan.
          </p>
        </>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button className="w-fit" disabled={saving || !changed} onClick={save}>{saving ? "Menyimpan…" : "Simpan pengaturan pesanan"}</Button>
    </section>
  )
}
