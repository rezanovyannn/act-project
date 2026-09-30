/**
 * Satu-satunya titik Dependency Injection (AGENTS.md, ADR 003 & 013).
 * Memilih repository mock (localStorage) atau Supabase. Hanya boleh
 * di-import oleh src/app/.
 */
import type { AuthUser, IAuthService } from "@/core/ports";
import type { AppServices } from "@/core/services";
import { AccountService } from "@/core/services/account-service";
import { ClosingService } from "@/core/services/closing-service";
import { JournalService } from "@/core/services/journal-service";
import { PeriodService } from "@/core/services/period-service";
import { WorkspaceService } from "@/core/services/workspace-service";
import type { TemplateRegistry } from "@/core/types";
import { buildFnbMockState, MOCK_OWNER_ID } from "@/mocks/fnb/dataset";
import { FNB_TEMPLATE } from "@/modules/fnb/template";
import { RETAIL_TEMPLATE } from "@/modules/retail/template";
import { createMockRepositories, MockDatabase } from "@/repositories/mock";
import { createSupabaseRepositories } from "@/repositories/supabase/repositories";
import { SupabaseAuthService } from "./supabase/auth";
import { getSupabaseBrowserClient } from "./supabase/browser";
import { dataSource, type DataSource } from "./supabase/config";

const TEMPLATES: TemplateRegistry = { fnb: FNB_TEMPLATE, retail: RETAIL_TEMPLATE };

export interface Container extends AppServices {
  dataSource: DataSource;
  auth: IAuthService;
  user: AuthUser;
  /** Mengembalikan data contoh (hanya mode mock). */
  resetMockData?: () => void;
}

type Repositories = Omit<AppServices, "ownerId" | "workspaceService" | "journalService" | "accountService" | "periodService" | "closingService">;

function buildServices(repositories: Repositories, ownerId: string): AppServices {
  return {
    ...repositories,
    ownerId,
    workspaceService: new WorkspaceService({ workspaces: repositories.workspaces, templates: TEMPLATES }),
    journalService: new JournalService(repositories),
    accountService: new AccountService(repositories),
    periodService: new PeriodService(repositories),
    closingService: new ClosingService(repositories),
  };
}

/** Mode mock: satu pengguna simulasi, tanpa login. */
class MockAuthService implements IAuthService {
  private readonly user: AuthUser = { id: MOCK_OWNER_ID, email: null };
  async currentUser() {
    return this.user;
  }
  async signIn() {
    return this.user;
  }
  async signUp() {
    return { user: this.user, needsEmailConfirmation: false };
  }
  async signOut() {}
}

/** Layanan autentikasi sesuai sumber data (dipakai halaman login/daftar). */
export function getAuthService(): IAuthService {
  return dataSource() === "supabase"
    ? new SupabaseAuthService(getSupabaseBrowserClient())
    : new MockAuthService();
}

async function createContainer(): Promise<Container | null> {
  if (dataSource() === "mock") {
    const db = new MockDatabase({
      storage: window.localStorage,
      seed: buildFnbMockState,
      actorId: MOCK_OWNER_ID,
    });
    const auth = new MockAuthService();
    return {
      ...buildServices(createMockRepositories(db), MOCK_OWNER_ID),
      dataSource: "mock",
      auth,
      user: (await auth.currentUser())!,
      resetMockData: () => db.reset(),
    };
  }

  const client = getSupabaseBrowserClient();
  const auth = new SupabaseAuthService(client);
  const user = await auth.currentUser();
  if (!user) return null;
  return {
    ...buildServices(createSupabaseRepositories(client), user.id),
    dataSource: "supabase",
    auth,
    user,
  };
}

let instance: Promise<Container | null> | null = null;

/**
 * Container untuk pengguna yang sedang login; `null` bila belum login
 * (mode Supabase). Hanya dipanggil dari client component.
 */
export function getContainer(): Promise<Container | null> {
  if (typeof window === "undefined") {
    throw new Error("getContainer() hanya dapat dipanggil di browser (client component)");
  }
  instance ??= createContainer();
  return instance;
}

/** Dipanggil setelah login/logout agar container dibuat ulang untuk user baru. */
export function resetContainer(): void {
  instance = null;
}
