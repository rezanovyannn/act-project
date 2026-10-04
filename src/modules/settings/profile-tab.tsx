"use client"

import { useRef, useState } from "react"
import { ImageIcon, Trash2Icon, UploadIcon } from "lucide-react"
import { toast } from "sonner"
import { formatInvoiceNumber, LOGO_MAX_LENGTH } from "@/core/invoice"
import { todayIsoDate } from "@/core/format"
import type { AppServices } from "@/core/services"
import type { BusinessProfileInput, Workspace } from "@/core/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LoadingState } from "@/components/ui/page-header"
import { Textarea } from "@/components/ui/textarea"
import { errorMessage, useLoader } from "@/lib/utils"

const LOGO_MAX_SIDE = 400

/** Kecilkan gambar di browser (sisi terpanjang ≤ 400 px) → data URL PNG/JPEG yang muat di database. */
async function shrinkLogo(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error("Pilih gambar PNG, JPG, atau WebP")
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, LOGO_MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  // PNG mempertahankan latar transparan; bila terlalu besar pakai JPEG berlatar putih.
  let url = canvas.toDataURL("image/png")
  if (url.length > LOGO_MAX_LENGTH) {
    const ctx = canvas.getContext("2d")!
    ctx.globalCompositeOperation = "destination-over"
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    url = canvas.toDataURL("image/jpeg", 0.85)
  }
  if (url.length > LOGO_MAX_LENGTH) throw new Error("Logo masih terlalu besar setelah dikecilkan; pakai gambar yang lebih sederhana")
  return url
}

/** Pengaturan → Profil Usaha: identitas di kop faktur (ADR 022). */
export function ProfileTab({ services, workspace }: { services: AppServices; workspace: Workspace }) {
  const data = useLoader(() => services.invoiceService.getProfile(workspace.id), [services, workspace.id])
  if (data.loading && !data.data) return <LoadingState />
  if (data.error) return <p role="alert" className="text-sm text-destructive">{errorMessage(data.error)}</p>
  const { workspaceId: _ws, updatedAt: _at, ...initial } = data.data! // eslint-disable-line @typescript-eslint/no-unused-vars
  return <ProfileForm key={data.data!.updatedAt ?? "baru"} services={services} workspace={workspace} initial={initial} onSaved={data.reload} />
}

function ProfileForm({
  services,
  workspace,
  initial,
  onSaved,
}: {
  services: AppServices
  workspace: Workspace
  initial: BusinessProfileInput
  onSaved: () => void
}) {
  const [form, setForm] = useState<BusinessProfileInput>(initial)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const set = <K extends keyof BusinessProfileInput>(key: K, value: BusinessProfileInput[K]) => setForm((f) => ({ ...f, [key]: value }))
  const text = (key: Exclude<keyof BusinessProfileInput, "logoDataUrl" | "invoicePrefix">) => ({
    value: form[key] ?? "",
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(key, e.target.value),
  })

  async function pickLogo(file: File) {
    try {
      set("logoDataUrl", await shrinkLogo(file))
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await services.invoiceService.saveProfile(workspace.id, form)
      toast.success("Profil usaha disimpan")
      onSaved()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={save} className="grid max-w-4xl grid-cols-1 gap-5">
      <p className="text-sm text-muted-foreground">Identitas ini tampil di kop faktur yang dicetak. Kosongkan yang tidak ingin ditampilkan.</p>
      <section className="grid gap-5 rounded-2xl bg-canvas p-4 ring-1 ring-border sm:p-6 md:grid-cols-[11rem_1fr]">
        <div className="grid content-start justify-items-start gap-2">
          <Label>Logo</Label>
          <div className="grid size-40 place-items-center overflow-hidden rounded-2xl bg-card ring-1 ring-border">
            {form.logoDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={form.logoDataUrl} alt="Logo usaha" className="max-h-full max-w-full object-contain p-2" />
            ) : (
              <ImageIcon className="size-8 text-muted-foreground" />
            )}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
              <UploadIcon data-icon="inline-start" /> {form.logoDataUrl ? "Ganti" : "Unggah"}
            </Button>
            {form.logoDataUrl && (
              <Button type="button" variant="ghost" size="sm" aria-label="Hapus logo" onClick={() => set("logoDataUrl", null)}>
                <Trash2Icon />
              </Button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            aria-label="Unggah logo"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) pickLogo(file)
              e.target.value = ""
            }}
          />
          <p className="text-xs text-muted-foreground">PNG/JPG/WebP; otomatis dikecilkan maks. 400 px.</p>
        </div>
        <div className="grid content-start gap-4">
          <div className="grid gap-2">
            <Label htmlFor="profile-name">Nama usaha di faktur</Label>
            <Input id="profile-name" placeholder={workspace.name} {...text("displayName")} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="profile-address">Alamat</Label>
            <Textarea id="profile-address" rows={2} {...text("address")} />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label htmlFor="profile-phone">Telepon</Label>
              <Input id="profile-phone" inputMode="tel" {...text("phone")} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="profile-email">Email</Label>
              <Input id="profile-email" type="email" {...text("email")} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="profile-npwp">NPWP</Label>
              <Input id="profile-npwp" {...text("npwp")} />
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 rounded-2xl bg-canvas p-4 ring-1 ring-border sm:p-6 md:grid-cols-2">
        <div className="grid content-start gap-2">
          <Label htmlFor="profile-bank">Rekening pembayaran</Label>
          <Textarea id="profile-bank" rows={3} placeholder={"BCA 1234567890 a.n. Nama Usaha\nMandiri 1230004567890 a.n. Nama Usaha"} {...text("bankInfo")} />
        </div>
        <div className="grid content-start gap-2">
          <Label htmlFor="profile-notes">Catatan kaki faktur</Label>
          <Textarea id="profile-notes" rows={3} placeholder="mis. Pembayaran ditransfer paling lambat tanggal jatuh tempo." {...text("invoiceNotes")} />
        </div>
        <div className="grid content-start gap-2">
          <Label htmlFor="profile-prefix">Prefix nomor faktur penjualan</Label>
          <Input
            id="profile-prefix"
            value={form.invoicePrefix}
            maxLength={12}
            onChange={(e) => set("invoicePrefix", e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ""))}
            className="w-40"
          />
          <p className="text-xs text-muted-foreground">
            Contoh nomor: <strong>{formatInvoiceNumber(form.invoicePrefix || "INV", todayIsoDate(), 1)}</strong> (urut per tahun).
          </p>
        </div>
      </section>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button type="submit" className="w-fit" disabled={saving}>{saving ? "Menyimpan…" : "Simpan profil"}</Button>
    </form>
  )
}
