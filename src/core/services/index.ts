import type {
  IAccountRepository,
  IAuditLogRepository,
  IJournalRepository,
  IPeriodRepository,
  IWorkspaceRepository,
} from "../ports";
import type { AccountService } from "./account-service";
import type { ClosingService } from "./closing-service";
import type { JournalService } from "./journal-service";
import type { PeriodService } from "./period-service";
import type { WorkspaceService } from "./workspace-service";

export { AccountService } from "./account-service";
export { ClosingService } from "./closing-service";
export { JournalService } from "./journal-service";
export { PeriodService } from "./period-service";
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
  accountService: AccountService;
  periodService: PeriodService;
  closingService: ClosingService;
  auditLogs: IAuditLogRepository;
  workspaces: IWorkspaceRepository;
  accounts: IAccountRepository;
  periods: IPeriodRepository;
  journals: IJournalRepository;
}
