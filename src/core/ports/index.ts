/**
 * Kontrak data (ADR 003). Semua method wajib asynchronous.
 * Implementasi: src/repositories/{mock,supabase}.
 */
import type {
  Account,
  AccountSeed,
  IsoDate,
  JournalEntry,
  JournalEntryInput,
  Period,
  PeriodStatus,
  TemplateType,
  Workspace,
} from "../types";
import type { PeriodRange } from "../periods";

export interface NewWorkspace {
  ownerId: string;
  name: string;
  templateType: TemplateType;
  booksStartDate: IsoDate;
}

export interface IWorkspaceRepository {
  listByOwner(ownerId: string): Promise<Workspace[]>;
  getById(id: string): Promise<Workspace | null>;
  /** Membuat workspace beserta seed CoA dan periode dalam satu operasi atomik. */
  createWithSeed(
    workspace: NewWorkspace,
    accounts: AccountSeed[],
    periods: PeriodRange[],
  ): Promise<Workspace>;
  rename(id: string, name: string): Promise<Workspace>;
  softDelete(id: string): Promise<void>;
}

export type AccountPatch = Partial<
  Pick<
    Account,
    | "code"
    | "name"
    | "accountType"
    | "normalBalance"
    | "cashFlowCategory"
    | "isCash"
    | "isActive"
  >
>;

export interface IAccountRepository {
  /** Akun yang belum dihapus (aktif maupun nonaktif), urut kode. */
  listByWorkspace(workspaceId: string): Promise<Account[]>;
  getById(id: string): Promise<Account | null>;
  create(workspaceId: string, seed: AccountSeed): Promise<Account>;
  update(id: string, patch: AccountPatch): Promise<Account>;
  /** Ditolak bila akun sudah dipakai baris jurnal (draft maupun posted). */
  softDelete(id: string): Promise<void>;
  hasJournalLines(id: string): Promise<boolean>;
}

export interface IPeriodRepository {
  listByWorkspace(workspaceId: string): Promise<Period[]>;
  /** Ditolak bila ada periode yang tumpang tindih. */
  createMany(workspaceId: string, periods: PeriodRange[]): Promise<Period[]>;
  setStatus(id: string, status: PeriodStatus): Promise<Period>;
}

export interface JournalFilter {
  status?: JournalEntry["status"];
  fromDate?: IsoDate;
  toDate?: IsoDate;
}

export interface IJournalRepository {
  /** Jurnal yang belum dihapus, urut tanggal lalu waktu dibuat. */
  listByWorkspace(
    workspaceId: string,
    filter?: JournalFilter,
  ): Promise<JournalEntry[]>;
  getById(id: string): Promise<JournalEntry | null>;
  /** Jurnal pembalik yang merujuk `id`, atau null. */
  findReversalOf(id: string): Promise<JournalEntry | null>;
  /**
   * Membuat draft baru (tanpa `draftId`) atau mengganti draft yang ada,
   * header + baris sekaligus. Tidak memvalidasi balance maupun periode.
   */
  saveDraft(entry: JournalEntryInput, draftId?: string): Promise<JournalEntry>;
  deleteDraft(id: string): Promise<void>;
  /**
   * Operasi atomik (ADR 008): validasi ulang (lapisan pertahanan terakhir),
   * memberi nomor jurnal, dan menyimpan jurnal berstatus posted.
   * Dengan `draftId`, draft tersebut yang diposting.
   */
  postJournal(entry: JournalEntryInput, draftId?: string): Promise<JournalEntry>;
}
