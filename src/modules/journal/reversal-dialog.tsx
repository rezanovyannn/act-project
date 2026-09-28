"use client"

import { useState } from "react"
import { toast } from "sonner"
import { todayIsoDate } from "@/core/format"
import type { AppServices } from "@/core/services"
import type { JournalEntry } from "@/core/types"
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
import { errorMessage } from "@/lib/utils"

export type ReversalMode = "void" | "correct"

/**
 * Void = satu jurnal pembalik. Koreksi = jurnal pembalik + draft salinan.
 * Tanggal pembalik harus di periode open (ADR 009).
 */
export function ReversalDialog({
  services,
  entry,
  mode,
  trigger,
  onVoided,
  onCorrected,
}: {
  services: AppServices
  entry: JournalEntry
  mode: ReversalMode
  trigger: React.ReactNode
  onVoided?: (reversal: JournalEntry) => void
  onCorrected?: (draft: JournalEntry) => void
}) {
  const today = todayIsoDate()
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState(today > entry.entryDate ? today : entry.entryDate)
  const [description, setDescription] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      if (mode === "void") {
        const reversal = await services.journalService.voidJournal(entry.id, date, description)
        toast.success(`Jurnal di-void oleh ${reversal.entryNumber}`)
        setOpen(false)
        onVoided?.(reversal)
      } else {
        const { reversal, draft } = await services.journalService.correctJournal(entry.id, date)
        toast.success(`Jurnal dibalik oleh ${reversal.entryNumber}; silakan perbaiki draft koreksi`)
        setOpen(false)
        onCorrected?.(draft)
      }
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const isVoid = mode === "void"
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{isVoid ? "Void jurnal" : "Koreksi jurnal"} {entry.entryNumber}</DialogTitle>
            <DialogDescription>
              {isVoid
                ? "Sistem membuat jurnal pembalik (debit dan kredit ditukar) sehingga pengaruh jurnal ini menjadi nol. Jurnal asal tetap tersimpan."
                : "Sistem membuat jurnal pembalik, lalu membuka draft baru berisi salinan jurnal ini untuk diperbaiki dan diposting ulang."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-2">
            <Label htmlFor="reversal-date">Tanggal jurnal pembalik</Label>
            <Input
              id="reversal-date"
              type="date"
              value={date}
              min={entry.entryDate}
              onChange={(e) => setDate(e.target.value)}
              required
            />
            <p className="text-xs text-muted-foreground">
              Harus di periode yang masih terbuka dan tidak sebelum tanggal jurnal asal.
            </p>
          </div>

          {isVoid && (
            <div className="grid gap-2">
              <Label htmlFor="reversal-description">Alasan / keterangan (opsional)</Label>
              <Input
                id="reversal-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="mis. Salah input akun"
              />
            </div>
          )}

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Batal
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Memproses…" : isVoid ? "Void jurnal" : "Balik & buat draft koreksi"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
