"use client"

import { useState } from "react"
import { toast } from "sonner"
import type { AppServices } from "@/core/services"
import { todayIsoDate } from "@/core/format"
import type { TemplateType, Workspace } from "@/core/types"
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
import { errorMessage } from "@/lib/utils"
import { TEMPLATE_LABELS } from "./labels"

function defaultStartDate(): string {
  return `${todayIsoDate().slice(0, 4)}-01-01`
}

export function CreateWorkspaceDialog({
  services,
  onCreated,
  trigger,
}: {
  services: AppServices
  onCreated: (workspace: Workspace) => void
  trigger: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [templateType, setTemplateType] = useState<TemplateType>("fnb")
  const [startDate, setStartDate] = useState(defaultStartDate)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const workspace = await services.workspaceService.createWorkspace({
        ownerId: services.ownerId,
        name,
        templateType,
        booksStartDate: startDate,
      })
      toast.success(`Workspace "${workspace.name}" dibuat`)
      setOpen(false)
      setName("")
      onCreated(workspace)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>Buat workspace</DialogTitle>
            <DialogDescription>
              Satu workspace untuk satu proyek. Jenis template tidak bisa diubah setelah
              workspace dibuat.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-2">
            <Label htmlFor="ws-name">Nama workspace</Label>
            <Input
              id="ws-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="mis. Kedai Kopi Pagi"
              required
              autoFocus
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="ws-template">Jenis bisnis (template)</Label>
            <Select value={templateType} onValueChange={(v) => setTemplateType(v as TemplateType)}>
              <SelectTrigger id="ws-template" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(TEMPLATE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Menentukan daftar akun (CoA) awal dan modul yang aktif.
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="ws-start">Tanggal mulai pembukuan</Label>
            <Input
              id="ws-start"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              required
            />
            <p className="text-xs text-muted-foreground">
              Periode bulanan dibuat otomatis dari bulan ini sampai Desember.
            </p>
          </div>

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
              {saving ? "Menyimpan…" : "Buat workspace"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
