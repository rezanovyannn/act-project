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
      <p className={cn("text-xs text-muted-foreground", className)}>
        Mode data contoh · tersimpan di browser ini
      </p>
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

  return (
    <div className={cn("flex min-w-0 items-center gap-2 text-xs text-muted-foreground", className)}>
      <span className="min-w-0 truncate" title={services.user.email ?? undefined}>
        {services.user.email}
      </span>
      <Button variant="ghost" size="sm" onClick={signOut} disabled={busy} aria-label="Keluar">
        <LogOutIcon data-icon="inline-start" />
        Keluar
      </Button>
    </div>
  )
}
