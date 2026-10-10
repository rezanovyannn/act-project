"use client"

import { useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { formatAccounting, todayIsoDate } from "@/core/format"
import {
  FULL_VAT_DEFAULTS,
  formatTaxRate,
  formatTaxSettings,
  parseTaxRatePercent,
  SALES_TAX_LABELS,
  type SalesTaxLabel,
  type SalesTaxMode,
  type WorkspaceTaxSettings,
} from "@/core/sales-tax"
import type { AppServices } from "@/core/services"
import type { Workspace } from "@/core/types"
import { workspaceTaxSettings } from "@/core/vat"
import { Button } from "@/components/ui/button"
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
import { errorMessage, useLoader } from "@/lib/utils"

const MODE_LABELS: Record<SalesTaxMode, string> = {
  simple: "Sederhana (pajak keluaran saja)",
  full_vat: "PPN lengkap (PPN Keluaran & Masukan, untuk PKP)",
}

const LABEL_HINTS: Record<SalesTaxLabel, string> = {
  PB1: "PB1/PBJT restoran; tarif ditetapkan per daerah, umumnya 10%.",
  PPN: "PPN tanpa pengkreditan PPN Masukan; isi 0% bila belum PKP.",
  PBJT: "PBJT makanan & minuman (jasa boga/katering, bukan objek PPN); tarif per daerah, maks. 10%. Isi 0% bila belum memungut.",
}

type TransitionChoice = "forward" | "expense_input_vat"

/** Pengaturan → Pajak: mode, jenis, tarif, DPP, dan transisi mode (ADR 012, 015 & 016). */
export function TaxTab({
  services,
  workspace,
  journalHref,
  onSaved,
}: {
  services: AppServices
  workspace: Workspace
  journalHref: (entryId: string) => string
  onSaved: () => void
}) {
  const current = workspaceTaxSettings(workspace)
  const [mode, setMode] = useState<SalesTaxMode>(current.mode)
  const [label, setLabel] = useState<SalesTaxLabel>(current.label)
  const [rateText, setRateText] = useState(formatTaxRate(current.rateBps).replace("%", ""))
  const [inclusive, setInclusive] = useState(current.inclusive)
  const [dppNumText, setDppNumText] = useState(String(current.dppNumerator))
  const [dppDenText, setDppDenText] = useState(String(current.dppDenominator))
  const [transition, setTransition] = useState<TransitionChoice>("forward")
  const [transitionDate, setTransitionDate] = useState(todayIsoDate)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [transitionLink, setTransitionLink] = useState<{ id: string; number: string | null } | null>(null)

  const leavingFullVat = current.mode === "full_vat" && mode !== "full_vat"
  const balance = useLoader(
    () => (leavingFullVat ? services.taxService.inputVatBalance(workspace.id, transitionDate) : Promise.resolve(0)),
    [services, workspace.id, transitionDate, leavingFullVat],
  )

  function changeMode(next: SalesTaxMode) {
    setMode(next)
    if (next === "full_vat") {
      setLabel("PPN")
      // Nilai awal ADR 016 saat pertama kali memilih PPN lengkap.
      if (current.mode !== "full_vat") {
        setRateText(formatTaxRate(FULL_VAT_DEFAULTS.rateBps).replace("%", ""))
        setDppNumText(String(FULL_VAT_DEFAULTS.dppNumerator))
        setDppDenText(String(FULL_VAT_DEFAULTS.dppDenominator))
      }
    }
  }

  const rateBps = parseTaxRatePercent(rateText)
  const parseWhole = (text: string) => (/^\d{1,4}$/.test(text.trim()) ? Number(text.trim()) : NaN)
  const draft: WorkspaceTaxSettings | null =
    rateBps === null
      ? null
      : {
          mode,
          label: mode === "full_vat" ? "PPN" : label,
          rateBps,
          inclusive,
          dppNumerator: mode === "full_vat" ? parseWhole(dppNumText) : current.dppNumerator,
          dppDenominator: mode === "full_vat" ? parseWhole(dppDenText) : current.dppDenominator,
        }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!draft) {
      setError("Tarif tidak valid. Contoh: 12 atau 10,5 (maksimal 2 desimal, 0–100).")
      return
    }
    setSaving(true)
    setError(null)
    setTransitionLink(null)
    try {
      const result = await services.taxService.updateSettings(
        workspace.id,
        draft,
        leavingFullVat && transition === "expense_input_vat"
          ? { kind: "expense_input_vat", entryDate: transitionDate }
          : { kind: "forward" },
      )
      toast.success(`Pengaturan pajak disimpan: ${formatTaxSettings(workspaceTaxSettings(result.workspace))}`)
      if (result.transitionEntry) {
        setTransitionLink({ id: result.transitionEntry.id, number: result.transitionEntry.entryNumber })
      }
      onSaved()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const effectiveRate =
    draft && mode === "full_vat" && Number.isFinite(draft.dppNumerator) && Number.isFinite(draft.dppDenominator) && draft.dppDenominator > 0
      ? (draft.rateBps * draft.dppNumerator) / draft.dppDenominator / 100
      : null

  return (
    <form onSubmit={submit} className="grid max-w-3xl grid-cols-1 gap-5">
      <p className="text-sm text-muted-foreground">
        Pajak yang dipungut dicatat sebagai utang pajak, bukan pendapatan. Perubahan berlaku untuk
        transaksi baru dan tercatat di Riwayat Audit. Saat ini:{" "}
        <strong className="text-ink">{formatTaxSettings(current)}</strong>
        {current.mode === "full_vat" && " (PPN lengkap)"}.
      </p>

      <section className="grid gap-4 rounded-2xl bg-canvas ring-1 ring-border p-4 sm:p-6">
        <div className="grid gap-2">
          <Label htmlFor="tax-mode">Mode pajak</Label>
          <Select value={mode} onValueChange={(v) => changeMode(v as SalesTaxMode)}>
            <SelectTrigger id="tax-mode" className="w-full max-w-md bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(MODE_LABELS) as SalesTaxMode[]).map((m) => (
                <SelectItem key={m} value={m}>{MODE_LABELS[m]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {mode === "simple" ? (
          <div className="grid gap-2">
            <Label htmlFor="tax-label">Jenis pajak</Label>
            <Select value={label} onValueChange={(v) => setLabel(v as SalesTaxLabel)}>
              <SelectTrigger id="tax-label" className="w-40 bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SALES_TAX_LABELS.map((l) => (
                  <SelectItem key={l} value={l}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{LABEL_HINTS[label]}</p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            PPN Keluaran dicatat di akun utang pajak; PPN Masukan atas beban & pembelian dicatat di akun
            PPN Masukan (dibuat otomatis) dan dikreditkan saat setoran per masa. Lebih bayar
            dikompensasikan ke masa berikutnya.
          </p>
        )}

        <div className="flex flex-wrap items-end gap-4">
          <div className="grid gap-2">
            <Label htmlFor="tax-rate">Tarif (%)</Label>
            <Input id="tax-rate" inputMode="decimal" value={rateText} onChange={(e) => setRateText(e.target.value)} className="w-28" />
          </div>
          {mode === "full_vat" && (
            <div className="grid gap-2">
              <Label htmlFor="tax-dpp-num">DPP (pecahan dari harga)</Label>
              <div className="flex items-center gap-2">
                <Input id="tax-dpp-num" aria-label="Pembilang DPP" inputMode="numeric" value={dppNumText} onChange={(e) => setDppNumText(e.target.value)} className="w-20" />
                <span className="text-muted-foreground">/</span>
                <Input id="tax-dpp-den" aria-label="Penyebut DPP" inputMode="numeric" value={dppDenText} onChange={(e) => setDppDenText(e.target.value)} className="w-20" />
              </div>
            </div>
          )}
        </div>
        {mode === "full_vat" && (
          <p className="text-xs text-muted-foreground">
            PPN = harga × DPP × tarif. Contoh ketentuan 2025 untuk barang/jasa non-mewah: DPP 11/12 × 12%
            {effectiveRate !== null && ` (tarif efektif saat ini ${effectiveRate.toLocaleString("id-ID", { maximumFractionDigits: 4 })}%)`}.
            Gunakan 1/1 bila DPP sama dengan harga.
          </p>
        )}

        <label className="flex items-center gap-3 text-sm">
          <Switch checked={inclusive} onCheckedChange={setInclusive} />
          Harga jual sudah termasuk {mode === "full_vat" ? "PPN" : label}
        </label>
      </section>

      {leavingFullVat && (
        <fieldset className="grid gap-3 rounded-2xl bg-canvas ring-1 ring-border p-4 sm:p-6">
          <legend className="sr-only">Saldo PPN Masukan saat keluar dari PPN lengkap</legend>
          <p className="text-sm font-semibold text-ink">Saldo PPN Masukan saat keluar dari mode PPN lengkap</p>
          <p className="text-sm text-muted-foreground">
            Saldo per {transitionDate}:{" "}
            <strong className="text-ink">{balance.data === undefined ? "…" : formatAccounting(balance.data ?? 0)}</strong>
          </p>
          <label className="flex items-start gap-3 text-sm">
            <input type="radio" name="tax-transition" className="mt-1 accent-primary" checked={transition === "forward"} onChange={() => setTransition("forward")} />
            <span>
              <strong>Berlaku ke depan saja</strong>
              <span className="block text-muted-foreground">Tanpa jurnal; saldo PPN Masukan tetap dan dapat diselesaikan lewat jurnal umum.</span>
            </span>
          </label>
          <label className="flex items-start gap-3 text-sm">
            <input type="radio" name="tax-transition" className="mt-1 accent-primary" checked={transition === "expense_input_vat"} onChange={() => setTransition("expense_input_vat")} />
            <span>
              <strong>Bebankan saldo PPN Masukan (jurnal transisi)</strong>
              <span className="block text-muted-foreground">
                Dr Beban PPN Masukan Tidak Dapat Dikreditkan, Cr PPN Masukan, pada tanggal di periode terbuka.
              </span>
            </span>
          </label>
          {transition === "expense_input_vat" && (
            <div className="grid gap-2 sm:max-w-xs">
              <Label htmlFor="tax-transition-date">Tanggal jurnal transisi</Label>
              <Input id="tax-transition-date" type="date" value={transitionDate} onChange={(e) => setTransitionDate(e.target.value)} required />
            </div>
          )}
        </fieldset>
      )}

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {transitionLink && (
        <p role="status" className="rounded-lg bg-success-pale px-4 py-3 text-sm text-success-deep">
          Jurnal transisi diposting:{" "}
          <Link href={journalHref(transitionLink.id)} className="font-semibold underline underline-offset-4">
            {transitionLink.number}
          </Link>
        </p>
      )}
      <Button type="submit" className="w-fit" disabled={saving}>
        {saving ? "Menyimpan…" : "Simpan pengaturan pajak"}
      </Button>
      {workspace.templateType === "catering" && (
        <section className="grid gap-2 rounded-2xl bg-card p-4 text-sm">
          <label className="flex items-center gap-3">
            <Switch checked={false} disabled aria-label="PPh 23 dipotong pelanggan" />
            <span className="font-medium text-ink">PPh 23 dipotong pelanggan (nonaktif)</span>
          </label>
          <p className="text-xs text-muted-foreground">
            Pelanggan badan dapat memotong PPh 23 sebesar 2% atas jasa katering, kecuali Anda menyerahkan Suket PP 55/2022. Pencatatan potongan saat pelunasan
            (akun PPh 23 Dibayar Dimuka) disiapkan untuk tahap berikutnya (ROADMAP Fase 10B). Katering bukan objek PPN; pajak penjualannya PBJT.
          </p>
        </section>
      )}
    </form>
  )
}
