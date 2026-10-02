"use client"

import { useState } from "react"
import Link from "next/link"
import type { IAuthService } from "@/core/ports"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { errorMessage } from "@/lib/utils"
import { AuthCard } from "./auth-card"

export type AuthMode = "login" | "register"

const COPY: Record<AuthMode, { title: string; description: string; submit: string; busy: string }> = {
  login: {
    title: "Masuk",
    description: "Masuk untuk membuka workspace keuangan & persediaan usaha Anda.",
    submit: "Masuk",
    busy: "Memproses…",
  },
  register: {
    title: "Daftar akun",
    description: "Buat akun untuk mulai mencatat. Data setiap akun terpisah dan hanya bisa dilihat pemiliknya.",
    submit: "Daftar",
    busy: "Mendaftarkan…",
  },
}

/** Kolom kata sandi dengan tombol Perlihatkan/Sembunyikan. */
export function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  minLength,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  autoComplete: string
  minLength?: number
}) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="relative">
      <Label htmlFor={id} className="sr-only">{label}</Label>
      <Input
        id={id}
        type={visible ? "text" : "password"}
        autoComplete={autoComplete}
        minLength={minLength}
        placeholder={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-12 bg-card pr-28"
        required
      />
      <button
        type="button"
        aria-pressed={visible}
        aria-controls={id}
        onClick={() => setVisible((v) => !v)}
        className="absolute inset-y-0 right-0 px-4 text-sm font-medium text-ink outline-none hover:underline focus-visible:underline"
      >
        {visible ? "Sembunyikan" : "Perlihatkan"}
      </button>
    </div>
  )
}

/** Form masuk / daftar dengan email + kata sandi (ADR 013 & 019). */
export function AuthForm({
  mode,
  auth,
  switchHref,
  forgotHref,
  onSuccess,
}: {
  mode: AuthMode
  auth: IAuthService
  /** Tautan ke halaman lawan (daftar/masuk); null = disembunyikan (pendaftaran ditutup). */
  switchHref: string | null
  /** Tautan "Lupa kata sandi?" (hanya mode masuk). */
  forgotHref?: string
  onSuccess: () => void
}) {
  const copy = COPY[mode]
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [remember, setRemember] = useState(true)
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
        await auth.signIn(email, password, { remember })
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

  const aside = switchHref && (
    <>
      {mode === "login" ? "Belum punya akun? " : "Sudah punya akun? "}
      <Link href={switchHref} className="font-semibold text-primary underline-offset-4 hover:underline">
        {mode === "login" ? "Daftar sekarang" : "Masuk"}
      </Link>
    </>
  )

  return (
    <AuthCard title={copy.title} description={copy.description} aside={aside}>
      <form onSubmit={submit} className="grid gap-4">
        <div>
          <Label htmlFor="auth-email" className="sr-only">Email</Label>
          <Input
            id="auth-email"
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
        <PasswordField
          id="auth-password"
          label="Kata sandi"
          value={password}
          onChange={setPassword}
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          minLength={mode === "register" ? 8 : undefined}
        />
        {mode === "register" && (
          <>
            <PasswordField id="auth-confirm" label="Ulangi kata sandi" value={confirm} onChange={setConfirm} autoComplete="new-password" />
            <p className="-mt-2 text-xs text-muted-foreground">Kata sandi minimal 8 karakter.</p>
          </>
        )}
        {mode === "login" && (
          <label className="flex items-center gap-2.5 text-sm text-ink">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="size-4 rounded accent-primary"
            />
            Ingat perangkat ini
          </label>
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

        <Button type="submit" size="lg" className="h-12 w-full text-base" disabled={busy}>
          {busy ? copy.busy : copy.submit}
        </Button>
        {mode === "login" && forgotHref && (
          <Link href={forgotHref} className="justify-self-center text-sm text-muted-foreground underline-offset-4 hover:text-ink hover:underline">
            Lupa kata sandi?
          </Link>
        )}
      </form>
    </AuthCard>
  )
}
