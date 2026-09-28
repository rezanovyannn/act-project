"use client"

import { PlusIcon, Trash2Icon } from "lucide-react"
import type { AmountItem } from "@/core/transactions"
import type { Account } from "@/core/types"
import { AccountCombobox } from "@/components/ui/account-combobox"
import { AmountInput } from "@/components/ui/amount-input"
import { Button } from "@/components/ui/button"

export interface ItemState {
  key: number
  accountId: string
  amount: number | null
}

let nextKey = 0
export const newItem = (accountId = ""): ItemState => ({ key: nextKey++, accountId, amount: 0 })

export const toAmountItems = (items: readonly ItemState[]): AmountItem[] =>
  items.map((i) => ({ accountId: i.accountId, amount: i.amount ?? 0 }))

/** Rincian akun + nominal (mis. penjualan makanan & minuman). */
export function AmountItemsField({
  label,
  accounts,
  items,
  onChange,
  amountLabel = "Nominal",
}: {
  label: string
  accounts: readonly Account[]
  items: ItemState[]
  onChange: (items: ItemState[]) => void
  amountLabel?: string
}) {
  const update = (key: number, patch: Partial<ItemState>) =>
    onChange(items.map((i) => (i.key === key ? { ...i, ...patch } : i)))

  return (
    <fieldset className="grid gap-3">
      <legend className="mb-2 text-sm font-medium text-ink">{label}</legend>
      {items.map((item, index) => (
        <div key={item.key} className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1 basis-56">
            <AccountCombobox
              accounts={accounts}
              value={item.accountId}
              onChange={(accountId) => update(item.key, { accountId })}
              placeholder="Pilih akun"
            />
          </div>
          <AmountInput
            aria-label={`${amountLabel} rincian ${index + 1}`}
            className="order-3 w-full sm:order-2 sm:w-48"
            value={item.amount}
            onValueChange={(amount) => update(item.key, { amount })}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="order-2 sm:order-3"
            aria-label={`Hapus rincian ${index + 1}`}
            disabled={items.length <= 1}
            onClick={() => onChange(items.filter((i) => i.key !== item.key))}
          >
            <Trash2Icon />
          </Button>
        </div>
      ))}
      <div>
        <Button type="button" variant="secondary" size="sm" onClick={() => onChange([...items, newItem()])}>
          <PlusIcon data-icon="inline-start" />
          Tambah rincian
        </Button>
      </div>
    </fieldset>
  )
}
