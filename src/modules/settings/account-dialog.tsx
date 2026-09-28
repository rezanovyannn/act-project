"use client"

import { useState } from "react"
import { toast } from "sonner"
import type { AppServices } from "@/core/services"
import { defaultNormalBalance, type AccountInput } from "@/core/services/account-service"
import type { Account, AccountType, CashFlowCategory, NormalBalance } from "@/core/types"
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

export const CASH_FLOW_LABELS: Record<CashFlowCategory, string> = {
  operating: "Operasi",
  investing: "Investasi",
  financing: "Pendanaan",
  none: "Tidak ada",
}

/** Tambah / ubah akun. Akun ber-jurnal: jenis, saldo normal, dan status kas terkunci (ADR 009). */
export function AccountDialog({
  services,
  workspaceId,
  account,
  inUse = false,
  trigger,
  open: controlledOpen,
  onOpenChange,
  onSaved,
}: {
  services: AppServices
  workspaceId: string
  account?: Account
  inUse?: boolean
  /** Tanpa trigger: dialog dikendalikan lewat `open`/`onOpenChange`. */
  trigger?: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onSaved: () => void
}) {
  const initial = (): AccountInput => ({
    code: account?.code ?? "",
    name: account?.name ?? "",
    accountType: account?.accountType ?? "expense",
    normalBalance: account?.normalBalance ?? "debit",
    cashFlowCategory: account?.cashFlowCategory ?? "operating",
    isCash: account?.isCash ?? false,
  })
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const open = controlledOpen ?? uncontrolledOpen
  const setOpen = (next: boolean) => {
    setUncontrolledOpen(next)
    onOpenChange?.(next)
  }
  const [form, setForm] = useState<AccountInput>(initial)
  const [error, setError] = useState<string | null>(null)
  const locked = inUse || Boolean(account?.systemRole)
  const set = (patch: Partial<AccountInput>) => setForm((f) => ({ ...f, ...patch }))

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    try {
      const saved = account
        ? await services.accountService.updateAccount(account.id, form)
        : await services.accountService.createAccount(workspaceId, form)
      toast.success(`Akun ${saved.code} · ${saved.name} disimpan`)
      setOpen(false)
      onSaved()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setForm(initial())
          setError(null)
        }
        setOpen(next)
      }}
    >
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{account ? "Ubah akun" : "Tambah akun"}</DialogTitle>
            <DialogDescription>
              {locked
                ? account?.systemRole
                  ? "Akun sistem dipakai fitur otomatis: jenis, saldo normal, dan status kas tidak bisa diubah."
                  : "Akun sudah dipakai jurnal: jenis, saldo normal, dan status kas tidak bisa diubah."
                : "Akun kas/bank dipakai sebagai dasar laporan arus kas."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
            <div className="grid gap-2">
              <Label htmlFor="account-code">Kode</Label>
              <Input id="account-code" value={form.code} onChange={(e) => set({ code: e.target.value })} required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="account-name">Nama akun</Label>
              <Input id="account-name" value={form.name} onChange={(e) => set({ name: e.target.value })} required />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="account-type">Jenis akun</Label>
              <Select
                value={form.accountType}
                disabled={locked}
                onValueChange={(v) => {
                  const accountType = v as AccountType
                  set({
                    accountType,
                    normalBalance: defaultNormalBalance(accountType),
                    isCash: accountType === "asset" ? form.isCash : false,
                  })
                }}
              >
                <SelectTrigger id="account-type" className="w-full bg-background"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(ACCOUNT_TYPE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="account-normal">Saldo normal</Label>
              <Select
                value={form.normalBalance}
                disabled={locked}
                onValueChange={(v) => set({ normalBalance: v as NormalBalance })}
              >
                <SelectTrigger id="account-normal" className="w-full bg-background"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="debit">Debit</SelectItem>
                  <SelectItem value="credit">Kredit (akun kontra/pasiva)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="account-cashflow">Kategori arus kas</Label>
              <Select
                value={form.isCash ? "none" : form.cashFlowCategory}
                disabled={form.isCash}
                onValueChange={(v) => set({ cashFlowCategory: v as CashFlowCategory })}
              >
                <SelectTrigger id="account-cashflow" className="w-full bg-background"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(CASH_FLOW_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-3 self-end pb-2 text-sm">
              <Switch
                checked={form.isCash}
                disabled={locked || form.accountType !== "asset"}
                onCheckedChange={(isCash) => set({ isCash })}
              />
              Akun kas/bank
            </label>
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Batal</Button>
            <Button type="submit">Simpan akun</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
