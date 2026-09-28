/**
 * Satu-satunya titik Dependency Injection (AGENTS.md, ADR 003).
 * Fase 1: repository mock berbasis localStorage. Hanya boleh di-import oleh src/app/.
 */
import { JournalService } from "@/core/services/journal-service";
import { WorkspaceService } from "@/core/services/workspace-service";
import type { TemplateRegistry } from "@/core/types";
import { buildFnbMockState } from "@/mocks/fnb/dataset";
import { FNB_TEMPLATE } from "@/modules/fnb/template";
import { createMockRepositories, MockDatabase } from "@/repositories/mock";

const TEMPLATES: TemplateRegistry = { fnb: FNB_TEMPLATE };

function createContainer() {
  const db = new MockDatabase({
    storage: window.localStorage,
    seed: buildFnbMockState,
  });
  const repositories = createMockRepositories(db);
  return {
    repositories,
    workspaceService: new WorkspaceService({
      workspaces: repositories.workspaces,
      templates: TEMPLATES,
    }),
    journalService: new JournalService(repositories),
    /** Mengembalikan data mock ke dataset awal. */
    resetMockData: () => db.reset(),
  };
}

export type Container = ReturnType<typeof createContainer>;

let instance: Container | null = null;

/** Hanya dipanggil dari client component (butuh `window.localStorage`). */
export function getContainer(): Container {
  if (typeof window === "undefined") {
    throw new Error("getContainer() hanya dapat dipanggil di browser (client component)");
  }
  instance ??= createContainer();
  return instance;
}
