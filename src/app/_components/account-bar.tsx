"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { LogOutIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { resetContainer, type Container } from "@/lib/container"
import { cn, errorMessage } from "@/lib/utils"

/** Info akun + tombol keluar (mode Supabase) atau label data contoh (mode mock). */
export function AccountBar({ services, className }: { services: Container; className?: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  if (services.dataSource === "mock") {
    return (
      <div className={cn("flex items-center gap-3 rounded-lg bg-canvas p-3 ring-1 ring-border", className)}>
        <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-secondary text-xs font-bold text-ink">DC</span>
        <span className="min-w-0 text-xs">
          <span className="block font-semibold text-ink">Data contoh</span>
          <span className="block text-muted-foreground">Tersimpan di browser ini</span>
        </span>
      </div>
    )
  }

  async function signOut() {
    setBusy(true)
    try {
      await services.auth.signOut()
      resetContainer()
      router.replace("/login")
    } catch (e) {
      toast.error(errorMessage(e))
      setBusy(false)
    }
  }

  const email = services.user.email ?? ""
  const initials = email.slice(0, 2).toUpperCase() || "?"
  return (
    <div className={cn("flex min-w-0 items-center gap-3 rounded-lg bg-canvas p-3 ring-1 ring-border", className)}>
      <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-secondary text-xs font-bold text-ink">
        {initials}
      </span>
      <span className="min-w-0 flex-1 text-xs">
        <span className="block truncate font-semibold text-ink" title={email}>{email}</span>
        <span className="block text-muted-foreground">Pemilik</span>
      </span>
      <Button variant="ghost" size="icon" onClick={signOut} disabled={busy} aria-label="Keluar" title="Keluar">
        <LogOutIcon />
      </Button>
    </div>
  )
}
