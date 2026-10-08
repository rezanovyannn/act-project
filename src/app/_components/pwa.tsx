"use client"

import { useEffect, useState, useSyncExternalStore } from "react"
import { DownloadIcon, ShareIcon, SquarePlusIcon, WifiOffIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

/** Event `beforeinstallprompt` (Chrome/Edge/Android); belum ada di tipe DOM standar. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

// ---- Status install & koneksi sebagai store kecil (dibaca lewat useSyncExternalStore) ----
let deferredPrompt: BeforeInstallPromptEvent | null = null
let installed = false
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    // Simpan prompt bawaan untuk tombol "Pasang aplikasi".
    event.preventDefault()
    deferredPrompt = event as BeforeInstallPromptEvent
    notify()
  })
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null
    installed = true
    notify()
  })
}

function isStandalone(): boolean {
  return (
    installed ||
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)

type InstallMode = "none" | "prompt" | "ios"
const installMode = (): InstallMode => (isStandalone() ? "none" : deferredPrompt ? "prompt" : isIos() ? "ios" : "none")

/**
 * Daftarkan service worker (hanya build production, agar tidak mengganggu
 * pengembangan) dan tampilkan banner saat koneksi terputus (Catatan Keputusan 70).
 */
export function PwaRuntime() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {})
  }, [])

  const online = useSyncExternalStore(
    (listener) => {
      window.addEventListener("online", listener)
      window.addEventListener("offline", listener)
      return () => {
        window.removeEventListener("online", listener)
        window.removeEventListener("offline", listener)
      }
    },
    () => navigator.onLine,
    () => true,
  )
  if (online) return null
  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-0 z-50 flex items-center justify-center gap-2 bg-ink px-4 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] text-sm text-canvas print:hidden"
    >
      <WifiOffIcon className="size-4 shrink-0" />
      <span>Anda sedang offline. Data tidak dapat dimuat atau disimpan sampai koneksi kembali.</span>
    </div>
  )
}

/** Tombol "Pasang aplikasi": prompt bawaan (Android/desktop) atau petunjuk manual (iPhone/iPad). */
export function InstallAppButton({ className }: { className?: string }) {
  const mode = useSyncExternalStore(subscribe, installMode, () => "none" as InstallMode)
  const [iosHelp, setIosHelp] = useState(false)
  if (mode === "none") return null

  async function install() {
    if (mode === "ios") {
      setIosHelp(true)
      return
    }
    const prompt = deferredPrompt
    if (!prompt) return
    await prompt.prompt()
    await prompt.userChoice.catch(() => null)
    deferredPrompt = null
    notify()
  }

  return (
    <>
      <Button type="button" variant="secondary" className={cn("w-full justify-start", className)} onClick={install}>
        <DownloadIcon data-icon="inline-start" /> Pasang aplikasi
      </Button>
      <Dialog open={iosHelp} onOpenChange={setIosHelp}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Pasang di iPhone/iPad</DialogTitle>
            <DialogDescription>Buka halaman ini di Safari, lalu:</DialogDescription>
          </DialogHeader>
          <ol className="grid gap-3 text-sm text-ink">
            <li className="flex items-center gap-3">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-card"><ShareIcon className="size-4" /></span>
              <span>Ketuk tombol <strong>Bagikan</strong> di bilah Safari.</span>
            </li>
            <li className="flex items-center gap-3">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-card"><SquarePlusIcon className="size-4" /></span>
              <span>Pilih <strong>Tambahkan ke Layar Utama</strong>, lalu <strong>Tambah</strong>.</span>
            </li>
          </ol>
          <DialogFooter>
            <Button type="button" onClick={() => setIosHelp(false)}>Mengerti</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
