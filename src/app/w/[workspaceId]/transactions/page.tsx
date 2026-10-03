"use client"

import { useParams, useSearchParams } from "next/navigation"
import { LoadingState } from "@/components/ui/page-header"
import { TransactionsView, type TransactionTab } from "@/modules/transactions/transactions-view"
import { routes } from "@/app/_components/routes"
import { useServices } from "@/app/_components/use-services"

export default function TransactionsPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const services = useServices()
  const tab = useSearchParams().get("tab")
  if (!services) return <LoadingState />
  return (
    <TransactionsView
      services={services}
      workspaceId={workspaceId}
      journalHref={(entryId) => routes.journal(workspaceId, entryId)}
      taxSettingsHref={routes.settings(workspaceId, "tax")}
      menusHref={routes.inventoryMenus(workspaceId)}
      initialTab={(tab ?? undefined) as TransactionTab | undefined}
    />
  )
}
