"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { BoxIcon, FileTextIcon, LayersIcon, NavigationIcon, SearchIcon } from "lucide-react"
import { formatDate } from "@/core/format"
import { isLedgerEntry } from "@/core/ledger"
import type { AppServices } from "@/core/services"
import type { Account, Item, JournalEntry } from "@/core/types"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { cn } from "@/lib/utils"

export interface SearchPage {
  label: string
  href: string
}

interface SearchData {
  journals: JournalEntry[]
  accounts: Account[]
  items: Item[]
}

/**
 * Pencarian global (⌘K / Ctrl+K): halaman, jurnal (nomor, keterangan, pihak),
 * akun CoA, dan barang. Data dimuat saat dialog dibuka.
 */
export function GlobalSearch({
  services,
  workspaceId,
  pages,
  journalHref,
  ledgerHref,
  itemsHref,
  className,
}: {
  services: AppServices
  workspaceId: string
  pages: SearchPage[]
  journalHref: (entryId: string) => string
  ledgerHref: string
  itemsHref: string
  className?: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<SearchData | null>(null)

  // Satu jalur untuk klik maupun Ctrl/⌘+K: setiap kali dibuka, data dimuat ulang.
  const openChange = useCallback(
    (next: boolean) => {
      setOpen(next)
      if (!next) return
      Promise.all([
        services.journals.listByWorkspace(workspaceId),
        services.accounts.listByWorkspace(workspaceId),
        services.items.listByWorkspace(workspaceId),
      ]).then(([journals, accounts, items]) => setData({ journals, accounts, items }))
    },
    [services, workspaceId],
  )

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        openChange(!open)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, openChange])

  function go(href: string) {
    setOpen(false)
    router.push(href)
  }

  const journals = [...(data?.journals ?? [])].filter((j) => j.deletedAt === null).reverse()

  return (
    <>
      <button
        type="button"
        onClick={() => openChange(true)}
        className={cn(
          "flex h-10 w-full items-center gap-2 rounded-full bg-card px-4 text-left text-sm text-muted-foreground outline-none transition-colors hover:bg-secondary focus-visible:ring-3 focus-visible:ring-ring/50",
          className,
        )}
      >
        <SearchIcon className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">Cari transaksi, jurnal, akun, atau barang…</span>
        <kbd className="hidden rounded-md border bg-canvas px-1.5 py-0.5 font-mono text-[11px] sm:inline">Ctrl K</kbd>
      </button>
      <CommandDialog open={open} onOpenChange={openChange} title="Pencarian" description="Cari halaman, jurnal, akun, atau barang">
        <Command>
          <CommandInput placeholder="Ketik nomor jurnal, keterangan, nama akun, atau barang…" />
          <CommandList>
            <CommandEmpty>{data ? "Tidak ada hasil." : "Memuat…"}</CommandEmpty>
            <CommandGroup heading="Halaman">
              {pages.map((page) => (
                <CommandItem key={page.href} value={`halaman ${page.label}`} onSelect={() => go(page.href)}>
                  <NavigationIcon />
                  {page.label}
                </CommandItem>
              ))}
            </CommandGroup>
            {journals.length > 0 && (
              <CommandGroup heading="Jurnal">
                {journals.slice(0, 200).map((j) => (
                  <CommandItem
                    key={j.id}
                    value={`${j.entryNumber ?? "draft"} ${j.description} ${j.counterparty ?? ""} ${j.id}`}
                    onSelect={() => go(journalHref(j.id))}
                  >
                    <FileTextIcon />
                    <span className="w-28 shrink-0 tabular-nums text-muted-foreground">{j.entryNumber ?? "Draft"}</span>
                    <span className="min-w-0 flex-1 truncate">{j.description}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatDate(j.entryDate)}
                      {!isLedgerEntry(j) ? " · draft" : ""}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {(data?.accounts.length ?? 0) > 0 && (
              <CommandGroup heading="Akun (buka Buku Besar)">
                {data!.accounts.map((a) => (
                  <CommandItem key={a.id} value={`akun ${a.code} ${a.name}`} onSelect={() => go(ledgerHref)}>
                    <LayersIcon />
                    <span className="w-16 shrink-0 tabular-nums text-muted-foreground">{a.code}</span>
                    {a.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {(data?.items.length ?? 0) > 0 && (
              <CommandGroup heading="Barang">
                {data!.items.map((i) => (
                  <CommandItem key={i.id} value={`barang ${i.code} ${i.name}`} onSelect={() => go(itemsHref)}>
                    <BoxIcon />
                    <span className="w-16 shrink-0 tabular-nums text-muted-foreground">{i.code}</span>
                    {i.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  )
}
