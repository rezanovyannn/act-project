"use client"

import { useEffect, useMemo, useSyncExternalStore } from "react"
import { useRouter } from "next/navigation"
import { LoadingState } from "@/components/ui/page-header"
import { getAuthService, resetContainer } from "@/lib/container"
import { dataSource } from "@/lib/supabase/config"
import { AuthForm, type AuthMode } from "@/modules/auth/auth-form"

/** Halaman login/daftar; di mode mock tidak diperlukan dan langsung ke beranda. */
export function AuthPage({ mode }: { mode: AuthMode }) {
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

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <AuthForm
        mode={mode}
        auth={auth}
        switchHref={mode === "login" ? "/register" : "/login"}
        onSuccess={() => {
          resetContainer()
          // Muat ulang penuh agar proxy membaca cookie sesi yang baru.
          window.location.assign(next())
        }}
      />
    </main>
  )
}
