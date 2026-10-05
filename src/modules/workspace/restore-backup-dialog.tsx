"use client"

import { useRef, useState } from "react"
import { ArchiveRestoreIcon, FileJsonIcon } from "lucide-react"
import { toast } from "sonner"
import type { WorkspaceBackup } from "@/core/backup"
import { restoredName, type RestoreSummary } from "@/core/backup-restore"
import { formatDate, formatNumber, todayIsoDate } from "@/core/format"
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
import { errorMessage } from "@/lib/utils"
import { TEMPLATE_LABELS } from "./labels"

/** Pulihkan file backup JSON sebagai workspace baru (ADR 023). */
export function RestoreBackupDialog({
  services,
  onRestored,
}: {
  services: AppServices
  onRestored: (workspace: Workspace) => void
}) {
  const [open, setOpen] = useState(false)
  const [loaded, setLoaded] = useState<{ fileName: string; backup: WorkspaceBackup; summary: RestoreSummary } | null>(null)
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  function reset(next: boolean) {
    setOpen(next)
    if (!next) {
      setLoaded(null)
      setError(null)
      setName("")
    }
  }

  async function readFile(file: File) {
    setError(null)
    setLoaded(null)
    try {
      const raw = JSON.parse(await file.text()) as unknown
      const { backup, summary } = services.workspaceService.inspectBackup(raw)
      setLoaded({ fileName: file.name, backup, summary })
      setName(restoredName(summary.workspaceName, todayIsoDate()))
    } catch (e) {
      setError(e instanceof SyntaxError ? "File bukan JSON yang valid" : errorMessage(e))
    }
  }

  async function restore() {
    if (!loaded) return
    setBusy(true)
    setError(null)
    try {
      const workspace = await services.workspaceService.restoreBackup(services.ownerId, loaded.backup, name)
      toast.success(`Backup dipulihkan sebagai "${workspace.name}"`)
      reset(false)
      onRestored(workspace)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const c = loaded?.summary.counts
  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger asChild>
        <Button size="lg" variant="secondary">
          <ArchiveRestoreIcon data-icon="inline-start" /> Pulihkan backup
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Pulihkan dari backup</DialogTitle>
          <DialogDescription>
            Pilih file backup JSON (Pengaturan → Backup). Isinya dipulihkan persis sebagai <strong>workspace baru</strong>;
            workspace yang ada tidak diubah.
          </DialogDescription>
        </DialogHeader>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          aria-label="File backup JSON"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) readFile(file)
            e.target.value = ""
          }}
        />
        <Button type="button" variant="secondary" className="w-full" onClick={() => fileRef.current?.click()}>
          <FileJsonIcon data-icon="inline-start" /> {loaded ? `Ganti file (${loaded.fileName})` : "Pilih file backup"}
        </Button>
        {loaded && c && (
          <div className="grid gap-3">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-2xl bg-card p-4 text-sm" aria-label="Isi backup">
              <dt className="text-muted-foreground">Workspace</dt>
              <dd className="font-semibold text-ink">{loaded.summary.workspaceName}</dd>
              <dt className="text-muted-foreground">Jenis usaha</dt>
              <dd>{TEMPLATE_LABELS[loaded.summary.templateType]}</dd>
              <dt className="text-muted-foreground">Dibuat backup</dt>
              <dd>{formatDate(loaded.summary.exportedAt.slice(0, 10))}</dd>
              <dt className="text-muted-foreground">Rentang jurnal</dt>
              <dd>{loaded.summary.dateRange ? `${formatDate(loaded.summary.dateRange.from)} – ${formatDate(loaded.summary.dateRange.to)}` : "—"}</dd>
              <dt className="text-muted-foreground">Jurnal</dt>
              <dd>{formatNumber(c.journals)} ({formatNumber(c.postedJournals)} posted)</dd>
              <dt className="text-muted-foreground">Akun · periode</dt>
              <dd>{c.accounts} · {c.periods}</dd>
              <dt className="text-muted-foreground">Barang · menu</dt>
              <dd>{c.items} · {c.menus}</dd>
              <dt className="text-muted-foreground">Faktur · kontak</dt>
              <dd>{c.invoices} · {c.contacts}</dd>
              <dt className="text-muted-foreground">Stok opname · audit</dt>
              <dd>{c.stockCounts} · {formatNumber(c.auditLogs)}</dd>
            </dl>
            <div className="grid gap-2">
              <Label htmlFor="restore-name">Nama workspace baru</Label>
              <Input id="restore-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
          </div>
        )}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => reset(false)}>Batal</Button>
          <Button type="button" disabled={!loaded || busy || name.trim() === ""} onClick={restore}>
            {busy ? "Memulihkan…" : "Pulihkan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
