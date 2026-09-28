/** Semua URL aplikasi di satu tempat. */
export const routes = {
  workspaces: () => "/",
  dashboard: (workspaceId: string) => `/w/${workspaceId}`,
  journals: (workspaceId: string) => `/w/${workspaceId}/journals`,
  newJournal: (workspaceId: string) => `/w/${workspaceId}/journals/new`,
  journal: (workspaceId: string, entryId: string) => `/w/${workspaceId}/journals/${entryId}`,
  editJournal: (workspaceId: string, entryId: string) =>
    `/w/${workspaceId}/journals/${entryId}/edit`,
}
