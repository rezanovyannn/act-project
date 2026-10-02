"use client"

import { useState } from "react"
import { DownloadIcon, FileJsonIcon, FileSpreadsheetIcon } from "lucide-react"
import { toast } from "sonner"
import { backupFileName, buildBackup, journalLinesCsv } from "@/core/backup"
import { todayIsoDate } from "@/core/format"
import type { AppServices } from "@/core/services"
import type { Workspace } from "@/core/types"
import { Button } from "@/components/ui/button"
import { errorMessage } from "@/lib/utils"

function download(fileName: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement("a")
  link.href = url
  link.download = fileName
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Backup data workspace: JSON lengkap & CSV baris jurnal (ROADMAP Fase 3). */
export function BackupTab({ services, workspace }: { services: AppServices; workspace: Workspace }) {
  const [busy, setBusy] = useState<"json" | "csv" | null>(null)

  async function exportJson() {
    setBusy("json")
    try {
      const [accounts, periods, journals, items, auditLogs] = await Promise.all([
        services.accounts.listByWorkspace(workspace.id),
        services.periods.listByWorkspace(workspace.id),
        services.journals.listByWorkspace(workspace.id),
        services.items.listByWorkspace(workspace.id),
        services.auditLogs.listByWorkspace(workspace.id),
      ])
      const backup = buildBackup({ workspace, accounts, periods, journals, items, auditLogs }, new Date().toISOString())
      download(backupFileName(workspace.name, todayIsoDate(), "json"), JSON.stringify(backup, null, 2), "application/json")
      toast.success(`Backup diunduh: ${backup.summary.journals} jurnal, ${backup.summary.accounts} akun`)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  async function exportCsv() {
    setBusy("csv")
    try {
      const [accounts, journals, items] = await Promise.all([
        services.accounts.listByWorkspace(workspace.id),
        services.journals.listByWorkspace(workspace.id),
        services.items.listByWorkspace(workspace.id),
      ])
      download(
        backupFileName(workspace.name, todayIsoDate(), "csv", "jurnal"),
        journalLinesCsv(accounts, journals, items),
        "text/csv;charset=utf-8",
      )
      toast.success("CSV jurnal diunduh")
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="grid max-w-3xl grid-cols-1 gap-4">
      <p className="text-sm text-muted-foreground">
        Unduh salinan data workspace ini. File berisi seluruh data keuangan, jadi simpan di tempat aman
        dan jangan dibagikan sembarangan.
      </p>
      <section className="grid gap-3 rounded-2xl bg-canvas ring-1 ring-border p-4 sm:p-6">
        <div className="flex items-start gap-3">
          <FileJsonIcon className="mt-0.5 size-5 shrink-0" />
          <div>
            <h2 className="font-semibold">Backup lengkap (JSON)</h2>
            <p className="text-sm text-muted-foreground">
              Workspace, daftar akun, periode, semua jurnal beserta barisnya, dan riwayat audit.
              Nominal dalam Rupiah utuh (integer).
            </p>
          </div>
        </div>
        <Button onClick={exportJson} disabled={busy !== null} className="w-fit">
          <DownloadIcon data-icon="inline-start" />
          {busy === "json" ? "Menyiapkan…" : "Unduh backup JSON"}
        </Button>
      </section>
      <section className="grid gap-3 rounded-2xl bg-canvas ring-1 ring-border p-4 sm:p-6">
        <div className="flex items-start gap-3">
          <FileSpreadsheetIcon className="mt-0.5 size-5 shrink-0" />
          <div>
            <h2 className="font-semibold">Jurnal untuk spreadsheet (CSV)</h2>
            <p className="text-sm text-muted-foreground">
              Satu baris per baris jurnal (tanggal, nomor, akun, debit, kredit, status void) untuk diolah
              di Excel atau Google Sheets. Pemisah kolom: koma.
            </p>
          </div>
        </div>
        <Button variant="secondary" onClick={exportCsv} disabled={busy !== null} className="w-fit">
          <DownloadIcon data-icon="inline-start" />
          {busy === "csv" ? "Menyiapkan…" : "Unduh CSV jurnal"}
        </Button>
      </section>
    </div>
  )
}
