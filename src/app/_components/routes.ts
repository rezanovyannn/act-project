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
  settings: (workspaceId: string) => `/w/${workspaceId}/settings`,
  transactions: (workspaceId: string) => `/w/${workspaceId}/transactions`,
  credits: (workspaceId: string) => `/w/${workspaceId}/credits`,
  fnbPurchases: (workspaceId: string) => `/w/${workspaceId}/fnb/purchases`,
  fnbStockOpname: (workspaceId: string) => `/w/${workspaceId}/fnb/stock-opname`,
}
