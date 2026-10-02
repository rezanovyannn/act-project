"use client"

import { useEffect, useMemo, useSyncExternalStore } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { LoadingState } from "@/components/ui/page-header"
import { getAuthService, resetContainer } from "@/lib/container"
import { dataSource, signupAllowed } from "@/lib/supabase/config"
import { AuthCard } from "@/modules/auth/auth-card"
import { AuthForm } from "@/modules/auth/auth-form"
import { ForgotPasswordForm, ResetPasswordForm } from "@/modules/auth/password-reset"

export type AuthPageMode = "login" | "register" | "forgot" | "reset"

/** Halaman autentikasi; di mode mock tidak diperlukan dan langsung ke beranda. */
export function AuthPage({ mode }: { mode: AuthPageMode }) {
  const router = useRouter()
  // true hanya di browser (layanan auth memerlukan cookie/localStorage).
  const inBrowser = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  )
  const auth = useMemo(() => (inBrowser && dataSource() === "supabase" ? getAuthService() : null), [inBrowser])

  useEffect(() => {
    if (dataSource() === "mock") router.replace("/")
  }, [router])

  if (!auth) return <LoadingState />

  const next = () => {
    const target = new URLSearchParams(window.location.search).get("next")
    return target && target.startsWith("/") && !target.startsWith("//") ? target : "/"
  }
  // Muat ulang penuh agar proxy membaca cookie sesi yang baru.
  const enter = (target: string) => {
    resetContainer()
    window.location.assign(target)
  }

  if (mode === "forgot") {
    return <ForgotPasswordForm auth={auth} redirectTo={`${window.location.origin}/reset-password`} loginHref="/login" />
  }
  if (mode === "reset") {
    return <ResetPasswordForm auth={auth} forgotHref="/forgot-password" onDone={() => enter("/")} />
  }
  if (mode === "register" && !signupAllowed) {
    return (
      <AuthCard
        title="Pendaftaran ditutup"
        description="Aplikasi ini hanya untuk pemilik yang sudah terdaftar."
        aside={<Link href="/login" className="font-semibold text-primary underline-offset-4 hover:underline">Masuk</Link>}
      >
        <p className="text-center text-sm font-semibold text-ink">Pendaftaran ditutup</p>
      </AuthCard>
    )
  }
  return (
    <AuthForm
      mode={mode}
      auth={auth}
      switchHref={mode === "login" ? (signupAllowed ? "/register" : null) : "/login"}
      forgotHref="/forgot-password"
      onSuccess={() => enter(next())}
    />
  )
}
