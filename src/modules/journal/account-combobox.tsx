"use client"

import { useState } from "react"
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react"
import type { Account } from "@/core/types"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { ACCOUNT_TYPE_LABELS, ACCOUNT_TYPE_ORDER } from "./labels"

/** Pilih akun dengan pencarian kode/nama, dikelompokkan per jenis akun. */
export function AccountCombobox({
  accounts,
  value,
  onChange,
  invalid,
  id,
}: {
  accounts: readonly Account[]
  value: string
  onChange: (accountId: string) => void
  invalid?: boolean
  id?: string
}) {
  const [open, setOpen] = useState(false)
  const selected = accounts.find((a) => a.id === value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-invalid={invalid || undefined}
          className="w-full justify-between bg-background font-normal"
        >
          <span className={cn("truncate", !selected && "text-muted-foreground")}>
            {selected ? `${selected.code} · ${selected.name}` : "Pilih akun"}
          </span>
          <ChevronsUpDownIcon className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <Command>
          <CommandInput placeholder="Cari kode atau nama akun…" />
          <CommandList>
            <CommandEmpty>Akun tidak ditemukan.</CommandEmpty>
            {ACCOUNT_TYPE_ORDER.map((type) => {
              const group = accounts.filter((a) => a.accountType === type)
              if (group.length === 0) return null
              return (
                <CommandGroup key={type} heading={ACCOUNT_TYPE_LABELS[type]}>
                  {group.map((account) => (
                    <CommandItem
                      key={account.id}
                      value={`${account.code} ${account.name}`}
                      onSelect={() => {
                        onChange(account.id)
                        setOpen(false)
                      }}
                    >
                      <span className="w-14 shrink-0 text-muted-foreground tabular-nums">
                        {account.code}
                      </span>
                      <span className="flex-1 truncate">{account.name}</span>
                      {!account.isActive && (
                        <span className="text-xs text-muted-foreground">nonaktif</span>
                      )}
                      {account.id === value && <CheckIcon className="size-4" />}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
