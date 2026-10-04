import type { InvoiceKind } from "@/core/types"
import type { InvoiceRoutes } from "@/modules/invoices/invoices-view"
import { routes } from "./routes"

/** URL yang dipakai modul faktur (ADR 022). */
export function invoiceRoutes(workspaceId: string, kind: InvoiceKind): InvoiceRoutes {
  const sale = kind === "sale"
  return {
    list: sale ? routes.invoices(workspaceId) : routes.purchaseInvoices(workspaceId),
    create: sale ? routes.newInvoice(workspaceId) : routes.newPurchaseInvoice(workspaceId),
    invoice: (id) => (sale ? routes.invoice(workspaceId, id) : routes.purchaseInvoice(workspaceId, id)),
    journal: (entryId) => routes.journal(workspaceId, entryId),
    credits: routes.credits(workspaceId),
    contacts: routes.contacts(workspaceId),
    profile: routes.settings(workspaceId, "profile"),
  }
}
