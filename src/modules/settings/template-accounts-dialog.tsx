"use client"

import { useState } from "react"
import { LibraryIcon } from "lucide-react"
import { toast } from "sonner"
import type { AppServices } from "@/core/services"
import { missingTemplateAccounts } from "@/core/templates"
import type { Account, WorkspaceTemplate } from "@/core/types"
import { ACCOUNT_TYPE_LABELS } from "@/components/ui/account-combobox"
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
import { errorMessage } from "@/lib/utils"

/** Menambahkan akun CoA template yang belum ada / pernah dihapus (ADR 015). */
export function TemplateAccountsDialog({
  services,
  workspaceId,
  template,
  accounts,
  onSaved,
}: {
  services: AppServices
  workspaceId: string
  template: WorkspaceTemplate
  accounts: Account[]
  onSaved: () => void
}) {
  const missing = missingTemplateAccounts(template, accounts)
  const [open, setOpen] = useState(false)
  // Disimpan yang TIDAK dipilih, agar akun yang baru muncul setelah reload otomatis terpilih.
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const selected = missing.filter((s) => !excluded.has(s.code)).map((s) => s.code)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  function openChange(next: boolean) {
    if (next) {
      setExcluded(new Set())
      setError(null)
    }
    setOpen(next)
  }

  function toggle(code: string, checked: boolean) {
    const next = new Set(excluded)
    if (checked) next.delete(code)
    else next.add(code)
    setExcluded(next)
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const created = await services.accountService.addTemplateAccounts(workspaceId, template, selected)
      toast.success(`${created.length} akun template ditambahkan`)
      setOpen(false)
      onSaved()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={openChange}>
      <DialogTrigger asChild>
        <Button variant="secondary">
          <LibraryIcon data-icon="inline-start" />
          Tambah dari template
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>Akun dari template {template.label}</DialogTitle>
            <DialogDescription>
              Akun bawaan template yang belum ada di workspace ini (belum dibuat atau sudah dihapus).
              Kode yang sudah dipakai akun lain tidak ditampilkan.
            </DialogDescription>
          </DialogHeader>
          {missing.length === 0 ? (
            <p className="rounded-lg bg-card px-4 py-3 text-sm text-muted-foreground">
              Semua akun template sudah ada.
            </p>
          ) : (
            <ul className="grid max-h-80 gap-1 overflow-y-auto" aria-label="Akun template">
              {missing.map((seed) => (
                <li key={seed.code}>
                  <label className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-secondary">
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={!excluded.has(seed.code)}
                      onChange={(e) => toggle(seed.code, e.target.checked)}
                    />
                    <span className="w-16 text-muted-foreground tabular-nums">{seed.code}</span>
                    <span className="flex-1 text-ink">{seed.name}</span>
                    <span className="text-xs text-muted-foreground">{ACCOUNT_TYPE_LABELS[seed.accountType]}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Batal
            </Button>
            <Button type="submit" disabled={saving || selected.length === 0}>
              {saving ? "Menambahkan…" : `Tambahkan ${selected.length} akun`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
