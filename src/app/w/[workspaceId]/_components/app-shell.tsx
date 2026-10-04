"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  BookOpenIcon,
  BoxesIcon,
  ChefHatIcon,
  ClipboardCheckIcon,
  ContactIcon,
  FileTextIcon,
  HistoryIcon,
  HandCoinsIcon,
  LandmarkIcon,
  LayoutDashboardIcon,
  MenuIcon,
  PackageIcon,
  PackageMinusIcon,
  PlusIcon,
  ReceiptIcon,
  ReceiptTextIcon,
  SettingsIcon,
  Undo2Icon,
  type LucideIcon,
} from "lucide-react"
import type { Container } from "@/lib/container"
import { AccountBar } from "@/app/_components/account-bar"
import { openClaimCounts } from "@/core/dashboard-insights"
import { capitalizeWords, todayIsoDate } from "@/core/format"
import type { TemplateType, WorkspaceTemplate } from "@/core/types"
import { AppLogo } from "@/components/ui/app-logo"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { cn, useLoader } from "@/lib/utils"
import { GlobalSearch } from "@/modules/search/global-search"
import { WorkspaceSwitcher } from "@/modules/workspace/workspace-switcher"
import { routes, TOPBAR_SLOT_ID } from "@/app/_components/routes"

interface NavItem {
  label: string
  href: string
  icon: LucideIcon
  exact?: boolean
  /** Badge berisi data nyata, mis. jumlah tagihan belum lunas. */
  badge?: string | null
  badgeLabel?: string
}

interface NavGroup {
  label: string
  items: NavItem[]
}

function navGroups(workspaceId: string, template: WorkspaceTemplate, openClaims: number | null): NavGroup[] {
  return [
    {
      label: "Menu utama",
      items: [
        { label: "Dashboard", href: routes.dashboard(workspaceId), icon: LayoutDashboardIcon, exact: true },
        { label: "Input Transaksi", href: routes.transactions(workspaceId), icon: ReceiptIcon },
        {
          label: "Piutang & Utang",
          href: routes.credits(workspaceId),
          icon: HandCoinsIcon,
          badge: openClaims ? String(openClaims) : null,
          badgeLabel: openClaims ? `${openClaims} tagihan belum lunas` : undefined,
        },
        { label: "Faktur Penjualan", href: routes.invoices(workspaceId), icon: ReceiptTextIcon },
        { label: "Kontak", href: routes.contacts(workspaceId), icon: ContactIcon },
        { label: "Jurnal Umum", href: routes.journals(workspaceId), icon: FileTextIcon },
        { label: "Buku Besar", href: routes.ledger(workspaceId), icon: LandmarkIcon },
        { label: "Laporan Keuangan", href: routes.reports(workspaceId), icon: BookOpenIcon },
      ],
    },
    {
      // Istilah modul persediaan mengikuti template_type (ADR 002 & 015).
      label: "Persediaan",
      items: [
        { label: "Daftar Barang", href: routes.inventoryItems(workspaceId), icon: BoxesIcon },
        { label: `Pembelian ${capitalizeWords(template.inventoryNoun)}`, href: routes.inventoryPurchases(workspaceId), icon: PackageIcon },
        // Resep & variance theoretical vs actual khusus F&B (ADR 021).
        ...(template.type === "fnb" ? [{ label: "Menu & Resep", href: routes.inventoryMenus(workspaceId), icon: ChefHatIcon }] : []),
        { label: "Stok Opname & COGS", href: routes.inventoryStockOpname(workspaceId), icon: ClipboardCheckIcon },
        { label: "Pemakaian Barang", href: routes.inventoryUsage(workspaceId), icon: PackageMinusIcon },
        { label: "Retur Barang", href: routes.inventoryReturns(workspaceId), icon: Undo2Icon },
      ],
    },
    {
      label: "Sistem & pengaturan",
      items: [
        { label: "Riwayat Audit", href: routes.audit(workspaceId), icon: HistoryIcon },
        { label: "Pengaturan & Akun", href: routes.settings(workspaceId), icon: SettingsIcon },
      ],
    },
  ]
}

function Logo({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Link href={routes.workspaces()} className="px-2" onClick={onNavigate}>
      <AppLogo />
    </Link>
  )
}

function Navigation({
  services,
  workspaceId,
  templateType,
  openClaims,
  onNavigate,
}: {
  services: Container
  workspaceId: string
  templateType: TemplateType
  openClaims: number | null
  onNavigate?: () => void
}) {
  const pathname = usePathname()
  return (
    <div className="flex h-full flex-col gap-5">
      <Logo onNavigate={onNavigate} />
      <WorkspaceSwitcher
        services={services}
        currentWorkspaceId={workspaceId}
        workspaceHref={routes.dashboard}
        allWorkspacesHref={routes.workspaces()}
      />
      <nav aria-label="Menu utama" className="grid gap-4">
        {navGroups(workspaceId, services.workspaceService.templateOf(templateType), openClaims).map((group) => (
          <div key={group.label} className="grid gap-1">
            <p className="px-3 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{group.label}</p>
            <ul className="grid gap-0.5">
              {group.items.map((item) => {
                const active = item.exact ? pathname === item.href : pathname.startsWith(item.href.split("?")[0])
                const Icon = item.icon
                return (
                  <li key={item.label}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex h-9 items-center gap-3 rounded-lg px-3 text-sm outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                        active ? "bg-primary/10 font-semibold text-primary" : "text-foreground hover:bg-secondary",
                      )}
                    >
                      <Icon className="size-4 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      {item.badge && (
                        <span
                          title={item.badgeLabel}
                          aria-label={item.badgeLabel}
                          className="grid min-w-5 shrink-0 place-items-center rounded-full bg-primary px-1.5 py-0.5 text-[11px] font-semibold text-primary-foreground"
                        >
                          {item.badge}
                        </span>
                      )}
                      {active && !item.badge && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-primary" />}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>
      <AccountBar services={services} className="mt-auto" />
    </div>
  )
}

/** Footer: hanya informasi yang benar tentang aplikasi ini (ROADMAP Catatan Keputusan 34). */
function Footer({ services }: { services: Container }) {
  return (
    <footer className="flex flex-wrap items-center gap-x-6 gap-y-1 border-t px-4 py-4 text-xs text-muted-foreground sm:px-6 lg:px-8 print:hidden">
      <span>Pembukuan v{process.env.NEXT_PUBLIC_APP_VERSION ?? "0.1.0"}</span>
      <span>Basis akrual · dirancang mengacu SAK EMKM</span>
      <span>{services.dataSource === "supabase" ? "Data tersimpan di Supabase (cloud)" : "Mode data contoh · tersimpan di browser ini"}</span>
    </footer>
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
  const pathname = usePathname()
  // Badge "belum lunas" dimuat ulang tiap pindah halaman agar mengikuti posting terbaru.
  const claims = useLoader(async () => {
    const [accounts, journals] = await Promise.all([
      services.accounts.listByWorkspace(workspaceId),
      services.journals.listByWorkspace(workspaceId, { status: "posted" }),
    ])
    const counts = openClaimCounts(accounts, journals, todayIsoDate())
    return counts.receivables + counts.payables
  }, [services, workspaceId, pathname])
  const openClaims = claims.data ?? null

  const searchPages = navGroups(workspaceId, services.workspaceService.templateOf(templateType), null)
    .flatMap((g) => g.items)
    .map((i) => ({ label: i.label, href: i.href }))
  const search = (
    <GlobalSearch
      services={services}
      workspaceId={workspaceId}
      pages={searchPages}
      journalHref={(id) => routes.journal(workspaceId, id)}
      ledgerHref={routes.ledger(workspaceId)}
      itemsHref={routes.inventoryItems(workspaceId)}
    />
  )

  return (
    <div data-density="compact" className="flex min-h-full flex-1">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 overflow-y-auto border-r bg-sidebar p-4 lg:block print:hidden">
        <Navigation services={services} workspaceId={workspaceId} templateType={templateType} openClaims={openClaims} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b bg-canvas/95 backdrop-blur print:hidden">
          <div className="flex h-14 items-center gap-3 px-4 sm:px-6">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Buka menu" className="lg:hidden">
                  <MenuIcon />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-72 overflow-y-auto bg-sidebar p-4">
                <SheetTitle className="sr-only">Menu</SheetTitle>
                <Navigation
                  services={services}
                  workspaceId={workspaceId}
                  templateType={templateType}
                  openClaims={openClaims}
                  onNavigate={() => setMobileOpen(false)}
                />
              </SheetContent>
            </Sheet>
            <div className="min-w-0 flex-1 md:max-w-md">{search}</div>
            <div id={TOPBAR_SLOT_ID} className="hidden items-center gap-2 md:flex md:flex-1 md:justify-end" />
            <Button asChild className="shrink-0">
              <Link href={routes.newJournal(workspaceId)} aria-label="Jurnal baru">
                <PlusIcon data-icon="inline-start" />
                <span className="hidden sm:inline">Jurnal baru</span>
              </Link>
            </Button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[90rem] flex-1 px-4 py-5 sm:px-6 lg:py-6 print:max-w-none print:p-0">
          {children}
        </main>
        <Footer services={services} />
      </div>
    </div>
  )
}
