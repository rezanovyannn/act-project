"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  BookOpenIcon,
  ClipboardCheckIcon,
  FileTextIcon,
  HistoryIcon,
  HandCoinsIcon,
  LandmarkIcon,
  LayoutDashboardIcon,
  MenuIcon,
  PackageIcon,
  ReceiptIcon,
  SettingsIcon,
  type LucideIcon,
} from "lucide-react"
import type { Container } from "@/lib/container"
import { AccountBar } from "@/app/_components/account-bar"
import type { TemplateType } from "@/core/types"
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

interface NavGroup {
  label?: string
  items: NavItem[]
}

function navGroups(workspaceId: string, templateType: TemplateType): NavGroup[] {
  const groups: NavGroup[] = [
    {
      items: [
        { label: "Dashboard", href: routes.dashboard(workspaceId), icon: LayoutDashboardIcon, exact: true },
        { label: "Input Transaksi", href: routes.transactions(workspaceId), icon: ReceiptIcon },
        { label: "Piutang & Utang", href: routes.credits(workspaceId), icon: HandCoinsIcon },
        { label: "Jurnal Umum", href: routes.journals(workspaceId), icon: FileTextIcon },
        { label: "Buku Besar", href: routes.ledger(workspaceId), icon: LandmarkIcon },
        { label: "Laporan Keuangan", href: routes.reports(workspaceId), icon: BookOpenIcon },
      ],
    },
  ]
  // Modul aktif ditentukan template_type (ADR 002).
  if (templateType === "fnb") {
    groups.push({
      label: "F&B",
      items: [
        { label: "Pembelian Bahan Baku", href: routes.fnbPurchases(workspaceId), icon: PackageIcon },
        { label: "Stok Opname", href: routes.fnbStockOpname(workspaceId), icon: ClipboardCheckIcon },
      ],
    })
  }
  groups.push({
    items: [
      { label: "Riwayat Audit", href: routes.audit(workspaceId), icon: HistoryIcon },
      { label: "Pengaturan", href: routes.settings(workspaceId), icon: SettingsIcon },
    ],
  })
  return groups
}

function Navigation({
  services,
  workspaceId,
  templateType,
  onNavigate,
}: {
  services: Container
  workspaceId: string
  templateType: TemplateType
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
      <nav aria-label="Menu utama" className="grid gap-4">
        {navGroups(workspaceId, templateType).map((group, groupIndex) => (
        <div key={groupIndex} className="grid gap-1">
        {group.label && (
          <p className="px-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{group.label}</p>
        )}
        <ul className="grid gap-1">
          {group.items.map((item) => {
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
        </div>
        ))}
      </nav>
      <AccountBar services={services} className="mt-auto px-2" />
    </div>
  )
}

export function AppShell({
  services,
  workspaceId,
  templateType,
  children,
}: {
  services: Container
  workspaceId: string
  templateType: TemplateType
  children: React.ReactNode
}) {
  const [mobileOpen, setMobileOpen] = useState(false)
  return (
    <div className="flex min-h-full flex-1">
      <aside className="sticky top-0 hidden h-dvh w-72 shrink-0 overflow-y-auto border-r bg-sidebar p-4 lg:block print:hidden">
        <Navigation services={services} workspaceId={workspaceId} templateType={templateType} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-canvas px-4 lg:hidden print:hidden">
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
                templateType={templateType}
                onNavigate={() => setMobileOpen(false)}
              />
            </SheetContent>
          </Sheet>
          <span className="font-bold text-ink">Pembukuan</span>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8 print:max-w-none print:p-0">
          {children}
        </main>
      </div>
    </div>
  )
}
