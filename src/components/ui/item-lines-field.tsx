"use client"

import { PlusIcon, Trash2Icon } from "lucide-react"
import type { Item } from "@/core/types"
import { AmountInput } from "@/components/ui/amount-input"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export interface ItemLineState {
  key: number
  itemId: string
  quantity: number | null
  amount: number | null
}

let nextKey = 0
export const newItemLine = (): ItemLineState => ({ key: nextKey++, itemId: "", quantity: null, amount: null })

/** Baris terisi (barang & qty > 0; nominal > 0 bila dipakai). */
export function filledItemLines(lines: readonly ItemLineState[], withAmount: boolean) {
  return lines
    .filter((l) => l.itemId !== "" && (l.quantity ?? 0) > 0 && (!withAmount || (l.amount ?? 0) > 0))
    .map((l) => ({ itemId: l.itemId, quantity: l.quantity!, amount: l.amount ?? 0 }))
}

/**
 * Isian baris barang (ADR 017): barang, kuantitas bilangan bulat satuan
 * dasar, dan (opsional) nominal. Menampilkan stok tercatat bila diberikan.
 */
export function ItemLinesField({
  idPrefix,
  label,
  items,
  lines,
  onChange,
  amountLabel,
  stockQty,
}: {
  idPrefix: string
  label: string
  items: readonly Item[]
  lines: ItemLineState[]
  onChange: (lines: ItemLineState[]) => void
  /** Kosong = tanpa kolom nominal (mis. pemakaian barang). */
  amountLabel?: string
  stockQty?: (itemId: string) => number | null
}) {
  const active = items.filter((i) => i.isActive)
  const update = (key: number, patch: Partial<ItemLineState>) =>
    onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)))

  return (
    <fieldset className="grid gap-3">
      <legend className="mb-2 text-sm font-medium">{label}</legend>
      {active.length === 0 && (
        <p className="text-sm text-muted-foreground">Belum ada barang aktif. Tambahkan di menu Daftar Barang.</p>
      )}
      {lines.map((line, index) => {
        const item = items.find((i) => i.id === line.itemId)
        const stock = line.itemId && stockQty ? stockQty(line.itemId) : null
        return (
          <div key={line.key} className="grid gap-2 rounded-lg bg-canvas p-3">
            <div className={amountLabel ? "grid gap-2 sm:grid-cols-[minmax(0,1fr)_8rem_10rem_2.5rem]" : "grid gap-2 sm:grid-cols-[minmax(0,1fr)_8rem_2.5rem]"}>
              <Select value={line.itemId} onValueChange={(itemId) => update(line.key, { itemId })}>
                <SelectTrigger id={`${idPrefix}-item-${index + 1}`} aria-label={`Barang baris ${index + 1}`} className="w-full bg-background">
                  <SelectValue placeholder="Pilih barang" />
                </SelectTrigger>
                <SelectContent>
                  {active.map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.code} · {i.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                aria-label={`Qty baris ${index + 1}`}
                inputMode="numeric"
                placeholder={item ? `Qty (${item.unit})` : "Qty"}
                value={line.quantity ?? ""}
                onChange={(e) => {
                  const text = e.target.value.replace(/\D/g, "")
                  update(line.key, { quantity: text === "" ? null : Number(text) })
                }}
              />
              {amountLabel && (
                <AmountInput
                  aria-label={`${amountLabel} baris ${index + 1}`}
                  value={line.amount}
                  onValueChange={(amount) => update(line.key, { amount })}
                />
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Hapus baris ${index + 1}`}
                disabled={lines.length <= 1}
                onClick={() => onChange(lines.filter((l) => l.key !== line.key))}
              >
                <Trash2Icon />
              </Button>
            </div>
            {item && stock !== null && (
              <p className="text-xs text-muted-foreground">
                Stok tercatat: {stock.toLocaleString("id-ID")} {item.unit}
              </p>
            )}
          </div>
        )
      })}
      <Button type="button" variant="secondary" size="sm" className="w-fit" onClick={() => onChange([...lines, newItemLine()])}>
        <PlusIcon data-icon="inline-start" />
        Tambah barang
      </Button>
    </fieldset>
  )
}
