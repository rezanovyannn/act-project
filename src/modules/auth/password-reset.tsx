"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import type { IAuthService } from "@/core/ports"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LoadingState } from "@/components/ui/page-header"
import { errorMessage } from "@/lib/utils"
import { AuthCard } from "./auth-card"
import { PasswordField } from "./auth-form"

/** Minta tautan atur ulang kata sandi lewat email (ADR 019). */
export function ForgotPasswordForm({
  auth,
  redirectTo,
  loginHref,
}: {
  auth: IAuthService
  /** Alamat halaman atur kata sandi baru, mis. https://…/reset-password. */
  redirectTo: string
  loginHref: string
}) {
  const [email, setEmail] = useState("")
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await auth.requestPasswordReset(email, redirectTo)
      setSent(true)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthCard
      title="Lupa kata sandi"
      description="Masukkan email akun Anda. Kami kirim tautan untuk mengatur kata sandi baru."
      aside={<Link href={loginHref} className="font-semibold text-primary underline-offset-4 hover:underline">Kembali ke halaman masuk</Link>}
    >
      {sent ? (
        <p role="status" className="rounded-lg bg-success-pale px-4 py-3 text-sm text-success-deep">
          Bila email tersebut terdaftar, tautan atur ulang sudah dikirim. Buka tautan itu <strong>di browser ini</strong>{" "}
          (tautan berlaku sekali dan untuk waktu terbatas).
        </p>
      ) : (
        <form onSubmit={submit} className="grid gap-4">
          <div>
            <Label htmlFor="reset-email" className="sr-only">Email</Label>
            <Input
              id="reset-email"
              type="email"
              autoComplete="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-12 bg-card"
              required
              autoFocus
            />
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="submit" size="lg" className="h-12 w-full text-base" disabled={busy}>
            {busy ? "Mengirim…" : "Kirim tautan atur ulang"}
          </Button>
        </form>
      )}
    </AuthCard>
  )
}

/**
 * Atur kata sandi baru dari tautan email. Klien Supabase menukar kode di URL
 * menjadi sesi pemulihan; bila gagal (tautan kedaluwarsa/beda browser) diminta tautan baru.
 */
export function ResetPasswordForm({
  auth,
  forgotHref,
  onDone,
}: {
  auth: IAuthService
  forgotHref: string
  onDone: () => void
}) {
  const [state, setState] = useState<"checking" | "ready" | "invalid">("checking")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    auth.currentUser().then(
      (user) => !cancelled && setState(user ? "ready" : "invalid"),
      () => !cancelled && setState("invalid"),
    )
    return () => {
      cancelled = true
    }
  }, [auth])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    if (password !== confirm) {
      setError("Konfirmasi kata sandi tidak sama")
      return
    }
    setBusy(true)
    try {
      await auth.updatePassword(password)
      onDone()
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  if (state === "checking") return <LoadingState />

  return (
    <AuthCard title="Atur kata sandi baru" description="Buat kata sandi baru untuk akun Anda (minimal 8 karakter).">
      {state === "invalid" ? (
        <div className="grid gap-4">
          <p role="alert" className="text-sm text-destructive">
            Tautan tidak valid atau sudah kedaluwarsa. Minta tautan baru dan buka di browser yang sama.
          </p>
          <Button asChild size="lg" className="h-12 w-full text-base">
            <Link href={forgotHref}>Minta tautan baru</Link>
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="grid gap-4">
          <PasswordField id="new-password" label="Kata sandi baru" value={password} onChange={setPassword} autoComplete="new-password" minLength={8} />
          <PasswordField id="new-password-confirm" label="Ulangi kata sandi baru" value={confirm} onChange={setConfirm} autoComplete="new-password" />
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="submit" size="lg" className="h-12 w-full text-base" disabled={busy}>
            {busy ? "Menyimpan…" : "Simpan kata sandi"}
          </Button>
        </form>
      )}
    </AuthCard>
  )
}
