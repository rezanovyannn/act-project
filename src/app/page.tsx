"use client"

import { useRouter } from "next/navigation"
import { RotateCcwIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { LoadingState } from "@/components/ui/page-header"
import { WorkspaceList } from "@/modules/workspace/workspace-list"
import { routes } from "@/app/_components/routes"
import { useServices } from "@/app/_components/use-services"
import { AccountBar } from "@/app/_components/account-bar"
import { InstallAppButton } from "@/app/_components/pwa"
import { AppLogo } from "@/components/ui/app-logo"

export default function WorkspacesPage() {
  const services = useServices()
  const router = useRouter()

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b bg-canvas">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-4">
            <AppLogo />
            {services && (
              <span className="hidden items-center gap-1.5 rounded-full bg-success-pale px-3 py-1 text-xs font-semibold text-success-deep sm:inline-flex">
                <span aria-hidden className="size-1.5 rounded-full bg-success-deep" />
                {services.dataSource === "supabase" ? "Tersimpan di cloud" : "Data contoh di browser"}
              </span>
            )}
          </div>
          {services && (
            <div className="flex w-full max-w-md flex-wrap items-center justify-end gap-2 sm:w-auto">
              <InstallAppButton className="w-auto" />
              <AccountBar services={services} className="w-full max-w-xs" />
            </div>
          )}
        </div>
      </header>
    <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-10 sm:px-6 lg:px-8 lg:py-12">
      {services ? (
        <>
          <WorkspaceList
            services={services}
            workspaceHref={(w) => routes.dashboard(w.id)}
            openingBalanceHref={(w) => routes.settings(w.id, "opening")}
            onCreated={(w) => router.push(routes.dashboard(w.id))}
          />
          {services.resetMockData && (
          <footer className="mt-16 flex flex-wrap items-center justify-between gap-3 border-t pt-6 text-xs text-muted-foreground">
            <span>Fase 1: data contoh disimpan di browser ini (localStorage).</span>
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="ghost" size="sm">
                  <RotateCcwIcon data-icon="inline-start" />
                  Reset data contoh
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Reset data contoh?</DialogTitle>
                  <DialogDescription>
                    Semua workspace dan jurnal di browser ini diganti dengan dataset awal Kedai
                    Senja. Perubahan yang sudah dibuat akan hilang.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="secondary">Batal</Button>
                  </DialogClose>
                  <Button
                    variant="destructive"
                    onClick={() => {
                      services.resetMockData?.()
                      toast.success("Data contoh dikembalikan")
                      window.location.reload()
                    }}
                  >
                    Reset data
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </footer>
          )}
        </>
      ) : (
        <LoadingState />
      )}
    </main>
      <footer className="border-t py-5 text-xs text-muted-foreground">
        <div className="mx-auto flex max-w-7xl flex-wrap gap-x-6 gap-y-1 px-4 sm:px-6 lg:px-8">
          <span>Pembukuan v{process.env.NEXT_PUBLIC_APP_VERSION ?? "0.1.0"}</span>
          <span>Basis akrual · dirancang mengacu SAK EMKM</span>
        </div>
      </footer>
    </div>
  )
}
