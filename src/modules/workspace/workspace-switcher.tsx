"use client"

import Link from "next/link"
import { CheckIcon, ChevronsUpDownIcon, LayoutGridIcon } from "lucide-react"
import type { AppServices } from "@/core/services"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useLoader } from "@/lib/utils"
import { TEMPLATE_LABELS } from "./labels"

/** "Kedai Senja" → "KS". */
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  return (words.length > 1 ? words[0][0] + words[1][0] : name.slice(0, 2)).toUpperCase() || "·"
}

export function WorkspaceSwitcher({
  services,
  currentWorkspaceId,
  workspaceHref,
  allWorkspacesHref,
}: {
  services: AppServices
  currentWorkspaceId: string
  workspaceHref: (workspaceId: string) => string
  allWorkspacesHref: string
}) {
  const workspaces = useLoader(
    () => services.workspaceService.listWorkspaces(services.ownerId),
    [services, currentWorkspaceId],
  )
  const current = workspaces.data?.find((w) => w.id === currentWorkspaceId)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex w-full items-center gap-3 rounded-lg bg-canvas px-3 py-2.5 text-left ring-1 ring-border outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-xs font-bold text-primary">
          {initialsOf(current?.name ?? "")}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-ink">
            {current?.name ?? "Memuat…"}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {current ? TEMPLATE_LABELS[current.templateType] : " "}
          </span>
        </span>
        <ChevronsUpDownIcon className="size-4 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Ganti workspace</DropdownMenuLabel>
        {workspaces.data?.map((workspace) => (
          <DropdownMenuItem key={workspace.id} asChild>
            <Link href={workspaceHref(workspace.id)}>
              <span className="flex-1 truncate">{workspace.name}</span>
              {workspace.id === currentWorkspaceId && <CheckIcon className="size-4" />}
            </Link>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={allWorkspacesHref}>
            <LayoutGridIcon />
            Semua workspace
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
