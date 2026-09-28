"use client"

import { useId } from "react"
import type { Payment } from "@/core/transactions"
import type { Account } from "@/core/types"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export interface PaymentState {
  /** Id akun kas/bank, atau `"credit"`. */
  method: string
  counterparty: string
}

export function toPayment(state: PaymentState): Payment {
  return state.method === "credit"
    ? { kind: "credit", counterparty: state.counterparty }
    : { kind: "cash", accountId: state.method }
}

export function initialPayment(cashAccounts: readonly Account[]): PaymentState {
  return { method: cashAccounts[0]?.id ?? "credit", counterparty: "" }
}

/** Cara bayar: akun kas/bank atau kredit (dengan nama pelanggan/pemasok). */
function PaymentField({
  cashAccounts,
  value,
  onChange,
  creditLabel,
  counterpartyLabel,
  counterpartySuggestions = [],
  allowCredit = true,
}: {
  cashAccounts: readonly Account[]
  value: PaymentState
  onChange: (value: PaymentState) => void
  creditLabel: string
  counterpartyLabel: string
  counterpartySuggestions?: readonly string[]
  allowCredit?: boolean
}) {
  const id = useId()
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="grid gap-2">
        <Label htmlFor={`${id}-method`}>Cara bayar</Label>
        <Select value={value.method} onValueChange={(method) => onChange({ ...value, method })}>
          <SelectTrigger id={`${id}-method`} className="w-full bg-background">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {cashAccounts.map((account) => (
              <SelectItem key={account.id} value={account.id}>
                Tunai · {account.name}
              </SelectItem>
            ))}
            {allowCredit && <SelectItem value="credit">{creditLabel}</SelectItem>}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`${id}-counterparty`}>
          {counterpartyLabel}
          {value.method === "credit" ? "" : " (opsional)"}
        </Label>
        <Input
          id={`${id}-counterparty`}
          list={`${id}-suggestions`}
          value={value.counterparty}
          onChange={(e) => onChange({ ...value, counterparty: e.target.value })}
          required={value.method === "credit"}
          disabled={value.method !== "credit"}
          placeholder={value.method === "credit" ? "Wajib untuk transaksi kredit" : "Hanya untuk kredit"}
        />
        <datalist id={`${id}-suggestions`}>
          {counterpartySuggestions.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      </div>
    </div>
  )
}

export { PaymentField }
