"use client"

import { useState } from "react"
import { MoreHorizontalIcon, PlusIcon, SearchIcon, UsersIcon } from "lucide-react"
import { toast } from "sonner"
import { policyLabel } from "@/core/cancellation-policy"
import type { AppServices } from "@/core/services"
import type { Contact, ContactInput } from "@/core/types"
import { Badge } from "@/components/ui/badge"
import { CancellationPolicyField } from "@/components/ui/cancellation-policy-field"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group"
import { Label } from "@/components/ui/label"
import { LoadingState, PageHeader } from "@/components/ui/page-header"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { errorMessage, useLoader } from "@/lib/utils"

const EMPTY: ContactInput = {
  name: "",
  isCustomer: true,
  isSupplier: false,
  address: null,
  phone: null,
  email: null,
  npwp: null,
  paymentTermDays: 0,
  notes: null,
  cancellationPolicy: null,
}

export function roleLabel(c: Pick<Contact, "isCustomer" | "isSupplier">): string {
  return c.isCustomer && c.isSupplier ? "Pelanggan & pemasok" : c.isCustomer ? "Pelanggan" : "Pemasok"
}

/** Daftar kontak pelanggan & pemasok (ADR 022). */
export function ContactsView({
  services,
  workspaceId,
  withCancellationPolicy = false,
}: {
  services: AppServices
  workspaceId: string
  /** Workspace katering: default kebijakan pembatalan per klien (ADR 024). */
  withCancellationPolicy?: boolean
}) {
  const data = useLoader(() => services.invoices.listContacts(workspaceId), [services, workspaceId])
  const [editing, setEditing] = useState<Contact | "new" | null>(null)
  const [search, setSearch] = useState("")

  if (data.loading && !data.data) return <LoadingState />
  if (data.error) return <p role="alert" className="text-sm text-destructive">{errorMessage(data.error)}</p>
  const term = search.trim().toLowerCase()
  const contacts = data.data!.filter((c) => !term || [c.name, c.address ?? "", c.npwp ?? "", c.phone ?? ""].some((t) => t.toLowerCase().includes(term)))

  async function remove(contact: Contact) {
    try {
      await services.invoiceService.deleteContact(contact.id)
      toast.success(`${contact.name} dihapus`)
      data.reload()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <div className="grid grid-cols-1 gap-5">
      <PageHeader
        title="Kontak"
        description="Pelanggan dan pemasok untuk faktur. Nama kontak menjadi nama pihak di Piutang & Utang."
        actions={
          <Button onClick={() => setEditing("new")}>
            <PlusIcon data-icon="inline-start" /> Tambah kontak
          </Button>
        }
      />
      <InputGroup className="max-w-sm">
        <InputGroupAddon><SearchIcon /></InputGroupAddon>
        <InputGroupInput aria-label="Cari kontak" placeholder="Cari nama, alamat, NPWP…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </InputGroup>
      {data.data!.length === 0 ? (
        <div className="grid justify-items-center gap-2 rounded-2xl bg-card px-4 py-10 text-center">
          <UsersIcon className="size-8 text-muted-foreground" />
          <p className="font-semibold text-ink">Belum ada kontak</p>
          <p className="max-w-md text-sm text-muted-foreground">Tambahkan pelanggan atau pemasok beserta alamat, NPWP, dan termin bayarnya.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl bg-canvas ring-1 ring-border">
          <table className="w-full min-w-[44rem] text-sm">
            <thead className="bg-card text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              <tr>
                <th className="px-4 py-2.5">Nama</th>
                <th className="px-3 py-2.5">Kontak</th>
                <th className="px-3 py-2.5">NPWP</th>
                {withCancellationPolicy && <th className="px-3 py-2.5">Pembatalan</th>}
                <th className="px-3 py-2.5 text-right">Termin</th>
                <th className="w-12" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {contacts.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-2.5">
                    <button type="button" className="font-medium text-ink hover:underline" onClick={() => setEditing(c)}>{c.name}</button>
                    <Badge variant="secondary" className="ml-2">{roleLabel(c)}</Badge>
                    {c.address && <span className="block max-w-md truncate text-xs text-muted-foreground">{c.address}</span>}
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground">{[c.phone, c.email].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="px-3 py-2.5 tabular-nums text-muted-foreground">{c.npwp ?? "—"}</td>
                  {withCancellationPolicy && (
                    <td className="px-3 py-2.5 text-muted-foreground">{c.cancellationPolicy ? policyLabel(c.cancellationPolicy) : "—"}</td>
                  )}
                  <td className="px-3 py-2.5 text-right tabular-nums">{c.paymentTermDays} hari</td>
                  <td className="px-2 py-2.5">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label={`Aksi untuk ${c.name}`}><MoreHorizontalIcon /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setEditing(c)}>Ubah</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onSelect={() => remove(c)}>Hapus</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
              {contacts.length === 0 && (
                <tr><td colSpan={withCancellationPolicy ? 6 : 5} className="px-4 py-6 text-center text-muted-foreground">Tidak ada kontak yang cocok.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <ContactDialog
          services={services}
          workspaceId={workspaceId}
          contact={editing === "new" ? null : editing}
          withCancellationPolicy={withCancellationPolicy}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            data.reload()
          }}
        />
      )}
    </div>
  )
}

/** Dialog tambah/ubah kontak; dipakai juga dari editor faktur & pesanan katering. */
export function ContactDialog({
  services,
  workspaceId,
  contact,
  defaults,
  withCancellationPolicy = false,
  onClose,
  onSaved,
}: {
  services: AppServices
  workspaceId: string
  contact: Contact | null
  defaults?: Partial<ContactInput>
  withCancellationPolicy?: boolean
  onClose: () => void
  onSaved: (contact: Contact) => void
}) {
  const [form, setForm] = useState<ContactInput>(() => (contact ? { ...contact } : { ...EMPTY, ...defaults }))
  const [term, setTerm] = useState(String(contact?.paymentTermDays ?? defaults?.paymentTermDays ?? 0))
  const [policyValid, setPolicyValid] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const set = <K extends keyof ContactInput>(key: K, value: ContactInput[K]) => setForm((f) => ({ ...f, [key]: value }))
  const text = (key: "address" | "phone" | "email" | "npwp" | "notes") => ({
    value: form[key] ?? "",
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(key, e.target.value),
  })

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!policyValid) return setError("Lengkapi persen DP hangus pada kebijakan pembatalan")
    setSaving(true)
    setError(null)
    const input = { ...form, paymentTermDays: /^\d+$/.test(term) ? Number(term) : -1 }
    try {
      const saved = contact ? await services.invoiceService.updateContact(contact, input) : await services.invoiceService.createContact(workspaceId, input)
      toast.success(`${saved.name} disimpan`)
      onSaved(saved)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{contact ? "Ubah kontak" : "Tambah kontak"}</DialogTitle>
            <DialogDescription>Data ini tampil di faktur. Faktur yang sudah terbit menyimpan salinan data saat terbit.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="contact-name">Nama</Label>
            <Input id="contact-name" value={form.name} onChange={(e) => set("name", e.target.value)} required />
          </div>
          <div className="flex flex-wrap gap-6">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={form.isCustomer} onCheckedChange={(v) => set("isCustomer", v)} aria-label="Pelanggan" /> Pelanggan
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={form.isSupplier} onCheckedChange={(v) => set("isSupplier", v)} aria-label="Pemasok" /> Pemasok
            </label>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="contact-address">Alamat</Label>
            <Textarea id="contact-address" rows={2} {...text("address")} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="contact-phone">Telepon</Label>
              <Input id="contact-phone" inputMode="tel" {...text("phone")} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="contact-email">Email</Label>
              <Input id="contact-email" type="email" {...text("email")} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="contact-npwp">NPWP</Label>
              <Input id="contact-npwp" {...text("npwp")} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="contact-term">Termin bayar</Label>
              <InputGroup>
                <InputGroupInput id="contact-term" inputMode="numeric" value={term} onChange={(e) => setTerm(e.target.value.replace(/\D/g, ""))} />
                <InputGroupAddon align="inline-end"><InputGroupText>hari</InputGroupText></InputGroupAddon>
              </InputGroup>
            </div>
          </div>
          {withCancellationPolicy && (
            <CancellationPolicyField
              label="Default kebijakan pembatalan pesanan"
              allowNone
              value={form.cancellationPolicy ?? null}
              onChange={(policy, valid) => {
                setPolicyValid(valid)
                set("cancellationPolicy", policy)
              }}
            />
          )}
          <div className="grid gap-2">
            <Label htmlFor="contact-notes">Catatan</Label>
            <Textarea id="contact-notes" rows={2} {...text("notes")} />
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>Batal</Button>
            <Button type="submit" disabled={saving}>{saving ? "Menyimpan…" : "Simpan kontak"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
