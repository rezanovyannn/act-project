"use client"

import type { AppServices } from "@/core/services"
import { LoadingState, PageHeader } from "@/components/ui/page-header"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { errorMessage, useLoader } from "@/lib/utils"
import { AccountsTab } from "./accounts-tab"
import { BackupTab } from "./backup-tab"
import { ClosingTab } from "./closing-tab"
import { OpeningBalanceTab } from "./opening-balance-tab"
import { PeriodsTab } from "./periods-tab"
import { ProfileTab } from "./profile-tab"
import { InventoryTab } from "./inventory-tab"
import { TaxTab } from "./tax-tab"

export type SettingsTab = "accounts" | "periods" | "opening" | "tax" | "inventory" | "profile" | "closing" | "backup"
const SETTINGS_TABS: readonly SettingsTab[] = ["accounts", "periods", "opening", "tax", "inventory", "profile", "closing", "backup"]

export function SettingsView({
  services,
  workspaceId,
  journalHref,
  itemsHref,
  initialTab,
}: {
  services: AppServices
  workspaceId: string
  journalHref: (entryId: string) => string
  itemsHref: string
  /** Tab awal, mis. dari `?tab=tax`. */
  initialTab?: string | null
}) {
  const data = useLoader(async () => {
    const [workspace, accounts, journals, periods, auditLogs] = await Promise.all([
      services.workspaces.getById(workspaceId),
      services.accounts.listByWorkspace(workspaceId),
      services.journals.listByWorkspace(workspaceId),
      services.periods.listByWorkspace(workspaceId),
      services.auditLogs.listByWorkspace(workspaceId, { entityType: "period" }),
    ])
    if (!workspace) throw new Error("Workspace tidak ditemukan")
    return { workspace, accounts, journals, periods, auditLogs }
  }, [services, workspaceId])

  if (data.loading && !data.data) return <LoadingState />
  if (data.error) return <p role="alert" className="text-sm text-destructive">{errorMessage(data.error)}</p>
  const { workspace, accounts, journals, periods, auditLogs } = data.data!

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader title="Pengaturan" description="Daftar akun (CoA), periode akuntansi, saldo awal, pajak, persediaan, profil usaha, tutup buku, dan backup data." />
      <Tabs defaultValue={SETTINGS_TABS.includes(initialTab as SettingsTab) ? (initialTab as SettingsTab) : "accounts"} className="grid grid-cols-1 gap-4">
        <TabsList className="h-auto w-fit max-w-full flex-wrap">
          <TabsTrigger value="accounts">Daftar Akun</TabsTrigger>
          <TabsTrigger value="periods">Periode</TabsTrigger>
          <TabsTrigger value="opening">Saldo Awal</TabsTrigger>
          <TabsTrigger value="tax">Pajak</TabsTrigger>
          <TabsTrigger value="inventory">Persediaan</TabsTrigger>
          <TabsTrigger value="profile">Profil Usaha</TabsTrigger>
          <TabsTrigger value="closing">Tutup Buku</TabsTrigger>
          <TabsTrigger value="backup">Backup</TabsTrigger>
        </TabsList>
        <TabsContent value="accounts">
          <AccountsTab services={services} workspaceId={workspaceId} template={services.workspaceService.templateOf(workspace.templateType)} accounts={accounts} journals={journals} onChanged={data.reload} />
        </TabsContent>
        <TabsContent value="periods">
          <PeriodsTab services={services} workspaceId={workspaceId} periods={periods} auditLogs={auditLogs} onChanged={data.reload} />
        </TabsContent>
        <TabsContent value="opening">
          <OpeningBalanceTab
            services={services}
            workspace={workspace}
            accounts={accounts}
            journals={journals}
            journalHref={journalHref}
            onPosted={data.reload}
          />
        </TabsContent>
        <TabsContent value="tax">
          <TaxTab services={services} workspace={workspace} journalHref={journalHref} onSaved={data.reload} />
        </TabsContent>
        <TabsContent value="inventory">
          <InventoryTab services={services} workspace={workspace} itemsHref={itemsHref} journalHref={journalHref} onSaved={data.reload} />
        </TabsContent>
        <TabsContent value="profile">
          <ProfileTab services={services} workspace={workspace} />
        </TabsContent>
        <TabsContent value="closing">
          <ClosingTab
            services={services}
            workspaceId={workspaceId}
            accounts={accounts}
            periods={periods}
            journalHref={journalHref}
            onChanged={data.reload}
          />
        </TabsContent>
        <TabsContent value="backup">
          <BackupTab services={services} workspace={workspace} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
