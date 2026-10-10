/** Elemen top bar tempat halaman menaruh aksi khususnya (mis. pilih bulan & Ekspor di Dashboard). */
export const TOPBAR_SLOT_ID = "app-topbar-actions"

/** Semua URL aplikasi di satu tempat. */
export const routes = {
  workspaces: () => "/",
  dashboard: (workspaceId: string) => `/w/${workspaceId}`,
  journals: (workspaceId: string) => `/w/${workspaceId}/journals`,
  newJournal: (workspaceId: string) => `/w/${workspaceId}/journals/new`,
  journal: (workspaceId: string, entryId: string) => `/w/${workspaceId}/journals/${entryId}`,
  editJournal: (workspaceId: string, entryId: string) =>
    `/w/${workspaceId}/journals/${entryId}/edit`,
  ledger: (workspaceId: string) => `/w/${workspaceId}/ledger`,
  reports: (workspaceId: string) => `/w/${workspaceId}/reports`,
  audit: (workspaceId: string) => `/w/${workspaceId}/audit`,
  settings: (workspaceId: string, tab?: string) => `/w/${workspaceId}/settings${tab ? `?tab=${tab}` : ""}`,
  transactions: (workspaceId: string, tab?: string) => `/w/${workspaceId}/transactions${tab ? `?tab=${tab}` : ""}`,
  credits: (workspaceId: string) => `/w/${workspaceId}/credits`,
  invoices: (workspaceId: string) => `/w/${workspaceId}/invoices`,
  newInvoice: (workspaceId: string) => `/w/${workspaceId}/invoices/new`,
  invoice: (workspaceId: string, invoiceId: string) => `/w/${workspaceId}/invoices/${invoiceId}`,
  contacts: (workspaceId: string) => `/w/${workspaceId}/contacts`,
  orders: (workspaceId: string, tab?: string) => `/w/${workspaceId}/orders${tab ? `?tab=${tab}` : ""}`,
  newOrder: (workspaceId: string) => `/w/${workspaceId}/orders/new`,
  order: (workspaceId: string, orderId: string) => `/w/${workspaceId}/orders/${orderId}`,
  packages: (workspaceId: string) => `/w/${workspaceId}/packages`,
  purchaseInvoices: (workspaceId: string) => `/w/${workspaceId}/purchase-invoices`,
  newPurchaseInvoice: (workspaceId: string) => `/w/${workspaceId}/purchase-invoices/new`,
  purchaseInvoice: (workspaceId: string, invoiceId: string) => `/w/${workspaceId}/purchase-invoices/${invoiceId}`,
  inventoryItems: (workspaceId: string) => `/w/${workspaceId}/inventory/items`,
  inventoryUsage: (workspaceId: string) => `/w/${workspaceId}/inventory/usage`,
  inventoryReturns: (workspaceId: string) => `/w/${workspaceId}/inventory/returns`,
  inventoryPurchases: (workspaceId: string) => `/w/${workspaceId}/inventory/purchases`,
  inventoryStockOpname: (workspaceId: string, tab?: string) => `/w/${workspaceId}/inventory/stock-opname${tab ? `?tab=${tab}` : ""}`,
  inventoryMenus: (workspaceId: string, tab?: string) => `/w/${workspaceId}/inventory/menus${tab ? `?tab=${tab}` : ""}`,
}
