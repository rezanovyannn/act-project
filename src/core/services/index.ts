import type {
  IAccountRepository,
  IJournalRepository,
  IPeriodRepository,
  IWorkspaceRepository,
} from "../ports";
import type { JournalService } from "./journal-service";
import type { WorkspaceService } from "./workspace-service";

export { JournalService } from "./journal-service";
export { WorkspaceService } from "./workspace-service";

/**
 * Layanan yang diteruskan dari `src/app/` (composition root) ke komponen
 * modul lewat props. Modul hanya bergantung pada tipe ini, bukan pada
 * implementasi mock/Supabase.
 */
export interface AppServices {
  ownerId: string;
  workspaceService: WorkspaceService;
  journalService: JournalService;
  workspaces: IWorkspaceRepository;
  accounts: IAccountRepository;
  periods: IPeriodRepository;
  journals: IJournalRepository;
}
