"use client"

import type { AppServices } from "@/core/services"
import { LoadingState, PageHeader } from "@/components/ui/page-header"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { errorMessage, useLoader } from "@/lib/utils"
import { AccountsTab } from "./accounts-tab"
import { OpeningBalanceTab } from "./opening-balance-tab"
import { PeriodsTab } from "./periods-tab"

export function SettingsView({
  services,
  workspaceId,
  journalHref,
}: {
  services: AppServices
  workspaceId: string
  journalHref: (entryId: string) => string
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
      <PageHeader title="Pengaturan" description="Daftar akun (CoA), periode akuntansi, dan saldo awal." />
      <Tabs defaultValue="accounts" className="grid grid-cols-1 gap-4">
        <TabsList className="h-auto w-fit max-w-full flex-wrap">
          <TabsTrigger value="accounts">Daftar Akun</TabsTrigger>
          <TabsTrigger value="periods">Periode</TabsTrigger>
          <TabsTrigger value="opening">Saldo Awal</TabsTrigger>
        </TabsList>
        <TabsContent value="accounts">
          <AccountsTab services={services} workspaceId={workspaceId} accounts={accounts} journals={journals} onChanged={data.reload} />
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
      </Tabs>
    </div>
  )
}
