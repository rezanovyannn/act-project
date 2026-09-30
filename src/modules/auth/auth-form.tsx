"use client"

import { useState } from "react"
import Link from "next/link"
import type { IAuthService } from "@/core/ports"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { errorMessage } from "@/lib/utils"

export type AuthMode = "login" | "register"

const COPY: Record<AuthMode, { title: string; description: string; submit: string; busy: string }> = {
  login: {
    title: "Masuk",
    description: "Masuk untuk membuka workspace pembukuan Anda.",
    submit: "Masuk",
    busy: "Memproses…",
  },
  register: {
    title: "Daftar akun",
    description: "Buat akun untuk mulai mencatat pembukuan. Data setiap akun terpisah dan hanya bisa dilihat pemiliknya.",
    submit: "Daftar",
    busy: "Mendaftarkan…",
  },
}

/** Form email + kata sandi (ADR 013). */
export function AuthForm({
  mode,
  auth,
  switchHref,
  onSuccess,
}: {
  mode: AuthMode
  auth: IAuthService
  /** Tautan ke halaman lawan (daftar/masuk); null = disembunyikan (pendaftaran ditutup). */
  switchHref: string | null
  onSuccess: () => void
}) {
  const copy = COPY[mode]
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setNotice(null)
    if (mode === "register" && password !== confirm) {
      setError("Konfirmasi kata sandi tidak sama")
      return
    }
    setBusy(true)
    try {
      if (mode === "login") {
        await auth.signIn(email, password)
        onSuccess()
      } else {
        const result = await auth.signUp(email, password)
        if (result.needsEmailConfirmation) {
          setNotice("Pendaftaran berhasil. Buka email Anda dan klik tautan konfirmasi, lalu masuk.")
        } else {
          onSuccess()
        }
      }
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="w-full max-w-sm">
      <p className="mb-8 text-lg font-bold text-ink">
        <span className="text-primary">●</span> Pembukuan
      </p>
      <h1 className="text-[28px] leading-tight font-bold tracking-[-0.03em]">{copy.title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{copy.description}</p>

      <form onSubmit={submit} className="mt-8 grid gap-5">
        <div className="grid gap-2">
          <Label htmlFor="auth-email">Email</Label>
          <Input
            id="auth-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="auth-password">Kata sandi</Label>
          <Input
            id="auth-password"
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            minLength={mode === "register" ? 8 : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {mode === "register" && (
            <p className="text-xs text-muted-foreground">Minimal 8 karakter.</p>
          )}
        </div>
        {mode === "register" && (
          <div className="grid gap-2">
            <Label htmlFor="auth-confirm">Ulangi kata sandi</Label>
            <Input
              id="auth-confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="rounded-lg bg-success-pale px-4 py-3 text-sm text-success-deep">
            {notice}
          </p>
        )}

        <Button type="submit" size="lg" disabled={busy}>
          {busy ? copy.busy : copy.submit}
        </Button>
      </form>

      {switchHref && (
        <p className="mt-6 text-sm text-muted-foreground">
          {mode === "login" ? "Belum punya akun? " : "Sudah punya akun? "}
          <Link href={switchHref} className="font-semibold text-ink underline underline-offset-4">
            {mode === "login" ? "Daftar" : "Masuk"}
          </Link>
        </p>
      )}
    </div>
  )
}
