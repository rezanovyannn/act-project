"use client"

import Link from "next/link"
import { SettingsIcon } from "lucide-react"
import { formatTaxSettings } from "@/core/sales-tax"
import type { AppServices } from "@/core/services"
import { workspaceTaxSettings } from "@/core/vat"
import { Button } from "@/components/ui/button"
import { LoadingState, PageHeader } from "@/components/ui/page-header"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { errorMessage } from "@/lib/utils"
import { ExpenseForm } from "./expense-form"
import { ItemSaleForm } from "./item-sale-form"
import { SaleForm } from "./sale-form"
import { TaxPaymentForm } from "./tax-payment-form"
import { useWorkspaceData } from "./use-workspace-data"
import { VatSettlementForm } from "./vat-settlement-form"

export type TransactionTab = "sale" | "item_sale" | "expense" | "tax"

/** Input Cepat: form transaksi yang otomatis membentuk jurnal. */
export function TransactionsView({
  services,
  workspaceId,
  journalHref,
  taxSettingsHref,
  initialTab = "sale",
}: {
  services: AppServices
  workspaceId: string
  journalHref: (entryId: string) => string
  /** Pengaturan → Pajak. */
  taxSettingsHref: string
  initialTab?: TransactionTab
}) {
  const data = useWorkspaceData(services, workspaceId)

  if (data.loading && !data.data) return <LoadingState />
  if (data.error) {
    return <p role="alert" className="text-sm text-destructive">{errorMessage(data.error)}</p>
  }
  const current = data.data!
  const formProps = { services, data: current, journalHref, onPosted: data.reload }

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader
        title="Input Transaksi"
        description="Isi form sederhana; jurnal debit/kredit dibuat otomatis dan langsung diposting."
        actions={
          <Button variant="secondary" asChild>
            <Link href={taxSettingsHref}>
              <SettingsIcon data-icon="inline-start" />
              {formatTaxSettings(workspaceTaxSettings(current.workspace))}
            </Link>
          </Button>
        }
      />
      <Tabs defaultValue={initialTab} className="grid grid-cols-1 gap-4">
        <TabsList className="w-fit max-w-full flex-wrap">
          <TabsTrigger value="sale">Penjualan</TabsTrigger>
          {current.workspace.inventoryMethod === "perpetual" && <TabsTrigger value="item_sale">Penjualan barang</TabsTrigger>}
          <TabsTrigger value="expense">Beban operasional</TabsTrigger>
          <TabsTrigger value="tax">Setoran {current.workspace.salesTaxLabel}</TabsTrigger>
        </TabsList>
        {/* key: form di-reset saat pengaturan pajak berubah */}
        <TabsContent value="sale">
          <SaleForm
            key={`${current.workspace.salesTaxMode}-${current.workspace.salesTaxLabel}-${current.workspace.salesTaxRateBps}-${current.workspace.salesTaxInclusive}-${current.workspace.vatDppNumerator}/${current.workspace.vatDppDenominator}`}
            {...formProps}
          />
        </TabsContent>
        {current.workspace.inventoryMethod === "perpetual" && (
          <TabsContent value="item_sale">
            <ItemSaleForm key={current.workspace.salesTaxMode + current.workspace.salesTaxRateBps} {...formProps} />
          </TabsContent>
        )}
        <TabsContent value="expense">
          <ExpenseForm {...formProps} />
        </TabsContent>
        <TabsContent value="tax">
          {current.workspace.salesTaxMode === "full_vat" ? (
            <VatSettlementForm {...formProps} />
          ) : (
            <TaxPaymentForm {...formProps} />
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
