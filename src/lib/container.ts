/**
 * Satu-satunya titik Dependency Injection (AGENTS.md, ADR 003).
 * Fase 1: repository mock berbasis localStorage. Hanya boleh di-import oleh src/app/.
 */
import type { AppServices } from "@/core/services";
import { JournalService } from "@/core/services/journal-service";
import { WorkspaceService } from "@/core/services/workspace-service";
import type { TemplateRegistry } from "@/core/types";
import { buildFnbMockState, MOCK_OWNER_ID } from "@/mocks/fnb/dataset";
import { FNB_TEMPLATE } from "@/modules/fnb/template";
import { createMockRepositories, MockDatabase } from "@/repositories/mock";

const TEMPLATES: TemplateRegistry = { fnb: FNB_TEMPLATE };

export interface Container extends AppServices {
  /** Mengembalikan data mock ke dataset awal (khusus Fase 1). */
  resetMockData: () => void;
}

function createContainer(): Container {
  const db = new MockDatabase({
    storage: window.localStorage,
    seed: buildFnbMockState,
  });
  const repositories = createMockRepositories(db);
  return {
    ...repositories,
    // Fase 1: satu pengguna simulasi. Fase 2: diambil dari sesi Supabase Auth.
    ownerId: MOCK_OWNER_ID,
    workspaceService: new WorkspaceService({
      workspaces: repositories.workspaces,
      templates: TEMPLATES,
    }),
    journalService: new JournalService(repositories),
    resetMockData: () => db.reset(),
  };
}

let instance: Container | null = null;

/** Hanya dipanggil dari client component (butuh `window.localStorage`). */
export function getContainer(): Container {
  if (typeof window === "undefined") {
    throw new Error("getContainer() hanya dapat dipanggil di browser (client component)");
  }
  instance ??= createContainer();
  return instance;
}
