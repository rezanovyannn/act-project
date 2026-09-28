"use client"

import Link from "next/link"
import { PlusIcon } from "lucide-react"
import type { AppServices } from "@/core/services"
import { formatDate } from "@/core/format"
import type { Workspace } from "@/core/types"
import { Button } from "@/components/ui/button"
import { EmptyState, LoadingState, PageHeader } from "@/components/ui/page-header"
import { errorMessage, useLoader } from "@/lib/utils"
import { CreateWorkspaceDialog } from "./create-workspace-dialog"
import { TEMPLATE_LABELS } from "./labels"

export function WorkspaceList({
  services,
  workspaceHref,
  onCreated,
}: {
  services: AppServices
  workspaceHref: (workspace: Workspace) => string
  onCreated: (workspace: Workspace) => void
}) {
  const workspaces = useLoader(
    () => services.workspaceService.listWorkspaces(services.ownerId),
    [services],
  )

  const createButton = (
    <Button>
      <PlusIcon data-icon="inline-start" />
      Buat workspace
    </Button>
  )

  return (
    <div className="grid grid-cols-1 gap-8">
      <PageHeader
        title="Workspace Saya"
        description="Pilih proyek yang ingin dibukukan, atau buat workspace baru."
        actions={
          <CreateWorkspaceDialog services={services} onCreated={onCreated} trigger={createButton} />
        }
      />

      {workspaces.loading ? (
        <LoadingState />
      ) : workspaces.error ? (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(workspaces.error)}
        </p>
      ) : workspaces.data?.length === 0 ? (
        <EmptyState title="Belum ada workspace">
          Buat workspace pertama untuk mulai mencatat.
        </EmptyState>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {workspaces.data?.map((workspace) => (
            <li key={workspace.id}>
              <Link
                href={workspaceHref(workspace)}
                className="block rounded-lg bg-card p-6 transition-colors outline-none hover:bg-secondary focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <p className="text-lg font-semibold text-ink">{workspace.name}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {TEMPLATE_LABELS[workspace.templateType]}
                </p>
                <p className="mt-4 text-xs text-muted-foreground">
                  Mulai pembukuan {formatDate(workspace.booksStartDate)} · {workspace.currency}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
