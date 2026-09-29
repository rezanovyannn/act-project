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

export default function WorkspacesPage() {
  const services = useServices()
  const router = useRouter()

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <p className="text-lg font-bold text-ink">
          <span className="text-primary">●</span> Pembukuan
        </p>
        {services && <AccountBar services={services} />}
      </div>
      {services ? (
        <>
          <WorkspaceList
            services={services}
            workspaceHref={(w) => routes.dashboard(w.id)}
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
  )
}
