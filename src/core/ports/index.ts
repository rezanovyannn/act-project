/**
 * Kontrak data (ADR 003). Semua method wajib asynchronous.
 * Implementasi: src/repositories/{mock,supabase}.
 */
import type {
  Account,
  AccountSeed,
  AuditEntity,
  AuditLog,
  BusinessProfile,
  BusinessProfileInput,
  CateringSettings,
  CateringOrder,
  CateringOrderInput,
  CateringPackage,
  CateringPackageInput,
  OrderBill,
  OrderBillInput,
  Contact,
  ContactInput,
  ContactSnapshot,
  Invoice,
  InvoiceInput,
  InvoiceKind,
  CostMethodPeriod,
  InventoryMethod,
  IsoDate,
  Item,
  ItemInput,
  JournalEntry,
  JournalEntryInput,
  Menu,
  MenuInput,
  MenuSale,
  MenuSaleLine,
  Period,
  PeriodStatus,
  PortionSummary,
  PortionSummaryInput,
  Recipe,
  RecipeInput,
  StockCount,
  StockCountInput,
  StockValuation,
  TemplateType,
  Workspace,
} from "../types";
import type { WorkspaceBackup } from "../backup";
import type { PeriodRange } from "../periods";
import type { WorkspaceTaxSettings } from "../sales-tax";

export interface NewWorkspace {
  ownerId: string;
  name: string;
  templateType: TemplateType;
  booksStartDate: IsoDate;
  salesTax: WorkspaceTaxSettings;
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
  updateSalesTaxSettings(id: string, settings: WorkspaceTaxSettings): Promise<Workspace>;
  /** Metode persediaan & riwayat metode biaya (ADR 017). */
  updateInventorySettings(id: string, settings: InventorySettings): Promise<Workspace>;
  /** Mode biaya pesanan & PPh 23 (ADR 024, Fase 10B). */
  updateCateringSettings(id: string, settings: CateringSettings): Promise<Workspace>;
  softDelete(id: string): Promise<void>;
  /**
   * Pulihkan backup sebagai workspace baru milik `ownerId` (ADR 023), atomik:
   * ID baru, isi persis (nomor jurnal, status periode, faktur, dll.).
   */
  restoreFromBackup(ownerId: string, name: string, backup: WorkspaceBackup): Promise<Workspace>;
}

export interface InventorySettings {
  inventoryMethod: InventoryMethod;
  costMethodHistory: CostMethodPeriod[];
  /** Kosong = tidak diubah (ADR 020). */
  stockValuation?: StockValuation;
}

/** Stok opname sisa bahan (ADR 020). */
export interface IStockCountRepository {
  /** Stok opname aktif (belum dibatalkan), urut tanggal. */
  listByWorkspace(workspaceId: string): Promise<StockCount[]>;
  /**
   * Atomik: posting jurnal penyesuaian (bila ada) lalu menyimpan stok opname.
   * Ditolak bila tanggalnya tidak setelah stok opname aktif terakhir.
   */
  post(input: StockCountInput, journal: JournalEntryInput | null): Promise<StockCount>;
  /** Membatalkan stok opname aktif terakhir: jurnalnya dibalik pada `reversalDate`. */
  cancel(id: string, reversalDate: IsoDate): Promise<void>;
}

/** Profil usaha, kontak, dan faktur (ADR 022). */
export interface IInvoiceRepository {
  /** Profil usaha; nilai default bila belum pernah disimpan. */
  getProfile(workspaceId: string): Promise<BusinessProfile>;
  saveProfile(workspaceId: string, input: BusinessProfileInput): Promise<BusinessProfile>;
  listContacts(workspaceId: string): Promise<Contact[]>;
  createContact(workspaceId: string, input: ContactInput): Promise<Contact>;
  updateContact(id: string, input: ContactInput): Promise<Contact>;
  /** Ditolak (CONTACT_IN_USE) bila kontak sudah dipakai faktur. */
  deleteContact(id: string): Promise<void>;
  listInvoices(workspaceId: string, kind?: InvoiceKind): Promise<Invoice[]>;
  getInvoice(id: string): Promise<Invoice | null>;
  /** Buat (tanpa id) atau ubah draft. */
  saveDraft(input: InvoiceInput, id?: string): Promise<Invoice>;
  deleteDraft(id: string): Promise<void>;
  /**
   * Atomik: memberi nomor (prefix/tahun/bulan/urut per tahun), posting jurnal,
   * dan menandai faktur terbit beserta salinan kontaknya.
   */
  issue(id: string, journal: JournalEntryInput, contact: ContactSnapshot, prefix: string): Promise<Invoice>;
}

/** Pesanan katering & invoice DP (ADR 024). */
export interface ICateringRepository {
  /** Pesanan yang belum dihapus, terbaru dulu. */
  listOrders(workspaceId: string): Promise<CateringOrder[]>;
  getOrder(id: string): Promise<CateringOrder | null>;
  /**
   * Buat pesanan baru (penawaran; nomor `prefix/yyyy/mm/urut` diberikan di sini)
   * atau ubah pesanan penawaran/dikonfirmasi.
   */
  saveOrder(input: CateringOrderInput, prefix: string, id?: string): Promise<CateringOrder>;
  /** Penawaran → dikonfirmasi. */
  confirmOrder(id: string): Promise<CateringOrder>;
  /** Hapus penawaran tanpa DP & invoice DP (ORDER_IN_USE bila ada). */
  deleteOrder(id: string): Promise<void>;
  listBills(workspaceId: string): Promise<OrderBill[]>;
  /** Invoice DP bernomor `prefix/yyyy/mm/urut` (urut per tahun), tanpa jurnal. */
  createBill(input: OrderBillInput, prefix: string): Promise<OrderBill>;
  deleteBill(id: string): Promise<void>;
  /**
   * Atomik: terbitkan faktur penjualan dari pesanan (nomor faktur `invoicePrefix`),
   * pakai saldo DP untuk melunasinya (min(saldo, total)), tandai pesanan selesai.
   */
  completeOrder(id: string, invoice: InvoiceInput, journal: JournalEntryInput, contact: ContactSnapshot, invoicePrefix: string): Promise<CateringOrder>;
  /** Atomik: posting jurnal pembatalan (bila ada saldo DP; harus menolkan saldo) lalu tandai dibatalkan. */
  cancelOrder(id: string, journal: JournalEntryInput | null, reason: string): Promise<CateringOrder>;
  /** Paket menu yang belum dihapus (aktif & nonaktif), urut kode (Fase 10C). */
  listPackages(workspaceId: string): Promise<CateringPackage[]>;
  /** Buat (tanpa id) atau ubah paket; kode unik per workspace (DUPLICATE_MENU_CODE). */
  savePackage(workspaceId: string, input: CateringPackageInput, id?: string): Promise<CateringPackage>;
  setPackageActive(id: string, isActive: boolean): Promise<CateringPackage>;
  /** Ditolak (ORDER_IN_USE) bila paket dipakai baris pesanan. */
  deletePackage(id: string): Promise<void>;
}

export type MenuPatch = Partial<MenuInput & { isActive: boolean }>;

/** Menu, resep, rekap porsi, dan penjualan menu (ADR 021). */
export interface IMenuRepository {
  listMenus(workspaceId: string): Promise<Menu[]>;
  getMenu(id: string): Promise<Menu | null>;
  createMenu(workspaceId: string, input: MenuInput): Promise<Menu>;
  updateMenu(id: string, patch: MenuPatch): Promise<Menu>;
  /** Ditolak (MENU_IN_USE) bila menu sudah punya penjualan/rekap aktif. */
  deleteMenu(id: string): Promise<void>;
  /** Versi resep aktif, urut menu lalu tanggal berlaku. */
  listRecipes(workspaceId: string): Promise<Recipe[]>;
  /** Simpan versi resep; versi lain menu ini dengan tanggal berlaku sama diganti. */
  saveRecipe(input: RecipeInput): Promise<Recipe>;
  deleteRecipe(id: string): Promise<void>;
  listPortionSummaries(workspaceId: string): Promise<PortionSummary[]>;
  /** Ditolak bila rentangnya bertumpuk dengan rekap aktif lain. */
  createPortionSummary(input: PortionSummaryInput): Promise<PortionSummary>;
  deletePortionSummary(id: string): Promise<void>;
  /** Penjualan menu yang jurnalnya belum di-void. */
  listMenuSales(workspaceId: string): Promise<MenuSale[]>;
  /** Atomik: posting jurnal penjualan lalu menyimpan rincian porsi per menu. */
  postMenuSale(journal: JournalEntryInput, lines: MenuSaleLine[]): Promise<JournalEntry>;
}

export type ItemPatch = Partial<ItemInput & { isActive: boolean }>;

/** Master barang (ADR 017). */
export interface IItemRepository {
  /** Barang yang belum dihapus (aktif maupun nonaktif), urut kode. */
  listByWorkspace(workspaceId: string): Promise<Item[]>;
  getById(id: string): Promise<Item | null>;
  /** Ditolak bila kode sudah dipakai barang lain di workspace (DUPLICATE_ITEM_CODE). */
  create(workspaceId: string, input: ItemInput): Promise<Item>;
  update(id: string, patch: ItemPatch): Promise<Item>;
  /** Ditolak bila barang sudah dipakai baris jurnal (ITEM_IN_USE). */
  softDelete(id: string): Promise<void>;
  hasJournalLines(id: string): Promise<boolean>;
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
  /** Jurnal retur posted atas `id` yang belum di-void (ADR 017). */
  listActiveReturnsOf(id: string): Promise<JournalEntry[]>;
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
  /** `remember = false`: sesi berakhir saat browser ditutup (ADR 019). */
  signIn(email: string, password: string, options?: { remember?: boolean }): Promise<AuthUser>;
  signUp(email: string, password: string): Promise<SignUpResult>;
  signOut(): Promise<void>;
  /** Mengirim email berisi tautan atur ulang kata sandi ke `redirectTo` (ADR 019). */
  requestPasswordReset(email: string, redirectTo: string): Promise<void>;
  /** Mengganti kata sandi pengguna yang sedang login (termasuk sesi pemulihan). */
  updatePassword(password: string): Promise<void>;
}
