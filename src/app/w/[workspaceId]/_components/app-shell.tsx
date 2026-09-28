"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  BookOpenIcon,
  FileTextIcon,
  LayoutDashboardIcon,
  MenuIcon,
  ReceiptIcon,
  SettingsIcon,
  type LucideIcon,
} from "lucide-react"
import type { AppServices } from "@/core/services"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import { WorkspaceSwitcher } from "@/modules/workspace/workspace-switcher"
import { routes } from "@/app/_components/routes"

interface NavItem {
  label: string
  href?: string
  icon: LucideIcon
  /** Sub-fase roadmap bila belum tersedia. */
  comingIn?: string
  exact?: boolean
}

function navItems(workspaceId: string): NavItem[] {
  return [
    { label: "Dashboard", href: routes.dashboard(workspaceId), icon: LayoutDashboardIcon, exact: true },
    { label: "Jurnal Umum", href: routes.journals(workspaceId), icon: FileTextIcon },
    { label: "Input Transaksi", icon: ReceiptIcon, comingIn: "1C" },
    { label: "Buku Besar", icon: BookOpenIcon, comingIn: "1C" },
    { label: "Laporan Keuangan", icon: BookOpenIcon, comingIn: "1D" },
    { label: "Pengaturan", icon: SettingsIcon, comingIn: "1E" },
  ]
}

function Navigation({
  services,
  workspaceId,
  onNavigate,
}: {
  services: AppServices
  workspaceId: string
  onNavigate?: () => void
}) {
  const pathname = usePathname()
  return (
    <div className="flex h-full flex-col gap-6">
      <Link href={routes.workspaces()} className="px-2 text-lg font-bold text-ink" onClick={onNavigate}>
        <span className="text-primary">●</span> Pembukuan
      </Link>
      <WorkspaceSwitcher
        services={services}
        currentWorkspaceId={workspaceId}
        workspaceHref={routes.dashboard}
        allWorkspacesHref={routes.workspaces()}
      />
      <nav aria-label="Menu utama">
        <ul className="grid gap-1">
          {navItems(workspaceId).map((item) => {
            const active =
              item.href !== undefined &&
              (item.exact ? pathname === item.href : pathname.startsWith(item.href))
            const Icon = item.icon
            if (!item.href) {
              return (
                <li key={item.label}>
                  <span
                    aria-disabled="true"
                    className="flex h-10 items-center gap-3 rounded-lg px-3 text-sm text-ash"
                  >
                    <Icon className="size-4" />
                    <span className="flex-1">{item.label}</span>
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                      Segera
                    </span>
                  </span>
                </li>
              )
            }
            return (
              <li key={item.label}>
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex h-10 items-center gap-3 rounded-lg px-3 text-sm outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                    active
                      ? "bg-canvas font-bold text-ink before:absolute before:inset-y-2 before:left-0 before:w-1 before:rounded-full before:bg-primary"
                      : "text-foreground hover:bg-secondary",
                  )}
                >
                  <Icon className="size-4" />
                  {item.label}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
      <p className="mt-auto px-2 text-xs text-muted-foreground">
        Fase 1 · data contoh tersimpan di browser ini
      </p>
    </div>
  )
}

export function AppShell({
  services,
  workspaceId,
  children,
}: {
  services: AppServices
  workspaceId: string
  children: React.ReactNode
}) {
  const [mobileOpen, setMobileOpen] = useState(false)
  return (
    <div className="flex min-h-full flex-1">
      <aside className="sticky top-0 hidden h-dvh w-72 shrink-0 overflow-y-auto border-r bg-sidebar p-4 lg:block">
        <Navigation services={services} workspaceId={workspaceId} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-canvas px-4 lg:hidden">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Buka menu">
                <MenuIcon />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 bg-sidebar p-4">
              <SheetTitle className="sr-only">Menu</SheetTitle>
              <Navigation
                services={services}
                workspaceId={workspaceId}
                onNavigate={() => setMobileOpen(false)}
              />
            </SheetContent>
          </Sheet>
          <span className="font-bold text-ink">Pembukuan</span>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  )
}
