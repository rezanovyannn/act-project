"use client"

import type { AppServices } from "@/core/services"
import { LoadingState, PageHeader } from "@/components/ui/page-header"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { errorMessage } from "@/lib/utils"
import { ExpenseForm } from "./expense-form"
import { SaleForm } from "./sale-form"
import { TaxPaymentForm } from "./tax-payment-form"
import { TaxSettingsDialog } from "./tax-settings-dialog"
import { useWorkspaceData } from "./use-workspace-data"

export type TransactionTab = "sale" | "expense" | "tax"

/** Input Cepat: form transaksi yang otomatis membentuk jurnal. */
export function TransactionsView({
  services,
  workspaceId,
  journalHref,
  initialTab = "sale",
}: {
  services: AppServices
  workspaceId: string
  journalHref: (entryId: string) => string
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
        actions={<TaxSettingsDialog services={services} workspace={current.workspace} onSaved={data.reload} />}
      />
      <Tabs defaultValue={initialTab} className="grid grid-cols-1 gap-4">
        <TabsList className="w-fit max-w-full flex-wrap">
          <TabsTrigger value="sale">Penjualan</TabsTrigger>
          <TabsTrigger value="expense">Beban operasional</TabsTrigger>
          <TabsTrigger value="tax">Setoran {current.workspace.salesTaxLabel}</TabsTrigger>
        </TabsList>
        {/* key: form di-reset saat pengaturan pajak berubah */}
        <TabsContent value="sale">
          <SaleForm
            key={`${current.workspace.salesTaxLabel}-${current.workspace.salesTaxRateBps}-${current.workspace.salesTaxInclusive}`}
            {...formProps}
          />
        </TabsContent>
        <TabsContent value="expense">
          <ExpenseForm {...formProps} />
        </TabsContent>
        <TabsContent value="tax">
          <TaxPaymentForm {...formProps} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
