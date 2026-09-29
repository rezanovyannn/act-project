/**
 * Kontrak data (ADR 003). Semua method wajib asynchronous.
 * Implementasi: src/repositories/{mock,supabase}.
 */
import type {
  Account,
  AccountSeed,
  AuditEntity,
  AuditLog,
  IsoDate,
  JournalEntry,
  JournalEntryInput,
  Period,
  PeriodStatus,
  TemplateType,
  Workspace,
} from "../types";
import type { PeriodRange } from "../periods";
import type { SalesTaxSettings } from "../sales-tax";

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
  updateSalesTaxSettings(id: string, settings: SalesTaxSettings): Promise<Workspace>;
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
  /** Perubahan status tercatat di audit log beserta alasan (wajib saat membuka kembali). */
  setStatus(id: string, status: PeriodStatus, reason?: string): Promise<Period>;
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
  /** Jurnal pelunasan posted atas `id` yang belum di-void (ADR 012). */
  listActiveSettlementsOf(id: string): Promise<JournalEntry[]>;
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
  /**
   * Tutup buku atomik (ADR 014): posting semua jurnal penutup, validasi hasil
   * (akun nominal & Prive tahun itu serta Ikhtisar Laba Rugi bersaldo nol),
   * lalu mengunci seluruh periode tahun tersebut.
   */
  closeFiscalYear(workspaceId: string, year: number, entries: JournalEntryInput[]): Promise<JournalEntry[]>;
  /** Membalik seluruh jurnal penutup tahun itu secara atomik, bertanggal 31 Desember. */
  cancelFiscalYearClosing(workspaceId: string, year: number): Promise<JournalEntry[]>;
}

export interface AuditLogFilter {
  entityType?: AuditEntity;
  entityId?: string;
}

export interface IAuditLogRepository {
  /** Terbaru lebih dulu. Hanya baca: log ditulis oleh repository lain / trigger DB. */
  listByWorkspace(workspaceId: string, filter?: AuditLogFilter): Promise<AuditLog[]>;
}

export interface AuthUser {
  id: string;
  email: string | null;
}

export interface SignUpResult {
  user: AuthUser | null;
  /** `true` bila proyek mewajibkan konfirmasi email sebelum bisa login. */
  needsEmailConfirmation: boolean;
}

/** Autentikasi pengguna (ADR 013: email + kata sandi). */
export interface IAuthService {
  currentUser(): Promise<AuthUser | null>;
  signIn(email: string, password: string): Promise<AuthUser>;
  signUp(email: string, password: string): Promise<SignUpResult>;
  signOut(): Promise<void>;
}
