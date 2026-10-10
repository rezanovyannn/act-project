import type {
  IAccountRepository,
  IAuditLogRepository,
  ICateringRepository,
  IInvoiceRepository,
  IItemRepository,
  IMenuRepository,
  IStockCountRepository,
  IJournalRepository,
  IPeriodRepository,
  IWorkspaceRepository,
} from "../ports";
import type { AccountService } from "./account-service";
import type { CateringService } from "./catering-service";
import type { ClosingService } from "./closing-service";
import type { InventoryService } from "./inventory-service";
import type { InvoiceService } from "./invoice-service";
import type { ItemService } from "./item-service";
import type { MenuService } from "./menu-service";
import type { JournalService } from "./journal-service";
import type { PeriodService } from "./period-service";
import type { StockCountService } from "./stock-count-service";
import type { TaxService } from "./tax-service";
import type { WorkspaceService } from "./workspace-service";

export { AccountService } from "./account-service";
export { CateringService } from "./catering-service";
export { ClosingService } from "./closing-service";
export { InventoryService } from "./inventory-service";
export { InvoiceService } from "./invoice-service";
export { ItemService } from "./item-service";
export { MenuService } from "./menu-service";
export { JournalService } from "./journal-service";
export { PeriodService } from "./period-service";
export { StockCountService } from "./stock-count-service";
export { TaxService } from "./tax-service";
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
  taxService: TaxService;
  itemService: ItemService;
  inventoryService: InventoryService;
  stockCountService: StockCountService;
  menuService: MenuService;
  invoiceService: InvoiceService;
  cateringService: CateringService;
  auditLogs: IAuditLogRepository;
  workspaces: IWorkspaceRepository;
  accounts: IAccountRepository;
  periods: IPeriodRepository;
  journals: IJournalRepository;
  items: IItemRepository;
  stockCounts: IStockCountRepository;
  menus: IMenuRepository;
  invoices: IInvoiceRepository;
  catering: ICateringRepository;
}
