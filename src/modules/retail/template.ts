import type { AccountSeed, WorkspaceTemplate } from "@/core/types";

/**
 * CoA awal template Retail (ADR 015): persediaan barang dagang metode
 * periodik, pajak penjualan berlabel PPN (default 0%, non-PKP).
 * Akun ditemukan sistem lewat `systemRole`, sehingga kode/nama boleh diubah user.
 */
export const RETAIL_ACCOUNTS: AccountSeed[] = [
  // Aset
  { code: "1-1100", name: "Kas", accountType: "asset", normalBalance: "debit", cashFlowCategory: "none", isCash: true, systemRole: null },
  { code: "1-1200", name: "Bank", accountType: "asset", normalBalance: "debit", cashFlowCategory: "none", isCash: true, systemRole: null },
  { code: "1-1300", name: "Persediaan Barang Dagang", accountType: "asset", normalBalance: "debit", cashFlowCategory: "operating", isCash: false, systemRole: "inventory" },
  { code: "1-1400", name: "Piutang Usaha", accountType: "asset", normalBalance: "debit", cashFlowCategory: "operating", isCash: false, systemRole: "accounts_receivable" },
  { code: "1-2100", name: "Peralatan Toko", accountType: "asset", normalBalance: "debit", cashFlowCategory: "investing", isCash: false, systemRole: null },
  { code: "1-2190", name: "Akumulasi Penyusutan Peralatan", accountType: "asset", normalBalance: "credit", cashFlowCategory: "investing", isCash: false, systemRole: null },
  // Liabilitas
  { code: "2-1100", name: "Utang Usaha", accountType: "liability", normalBalance: "credit", cashFlowCategory: "operating", isCash: false, systemRole: "accounts_payable" },
  { code: "2-1200", name: "Utang PPN", accountType: "liability", normalBalance: "credit", cashFlowCategory: "operating", isCash: false, systemRole: "sales_tax_payable" },
  { code: "2-2100", name: "Utang Bank", accountType: "liability", normalBalance: "credit", cashFlowCategory: "financing", isCash: false, systemRole: null },
  // Ekuitas
  { code: "3-1000", name: "Modal Pemilik", accountType: "equity", normalBalance: "credit", cashFlowCategory: "financing", isCash: false, systemRole: "owner_capital" },
  { code: "3-2000", name: "Prive", accountType: "equity", normalBalance: "debit", cashFlowCategory: "financing", isCash: false, systemRole: "drawings" },
  { code: "3-3000", name: "Laba Ditahan", accountType: "equity", normalBalance: "credit", cashFlowCategory: "none", isCash: false, systemRole: "retained_earnings" },
  { code: "3-8000", name: "Ikhtisar Laba Rugi", accountType: "equity", normalBalance: "credit", cashFlowCategory: "none", isCash: false, systemRole: "income_summary" },
  { code: "3-9000", name: "Ekuitas Saldo Awal", accountType: "equity", normalBalance: "credit", cashFlowCategory: "none", isCash: false, systemRole: "opening_balance_equity" },
  // Pendapatan (Retur & Potongan: akun kontra, saldo normal debit)
  { code: "4-1000", name: "Penjualan Barang Dagang", accountType: "revenue", normalBalance: "credit", cashFlowCategory: "operating", isCash: false, systemRole: null },
  { code: "4-1900", name: "Retur & Potongan Penjualan", accountType: "revenue", normalBalance: "debit", cashFlowCategory: "operating", isCash: false, systemRole: null },
  // HPP
  { code: "5-1000", name: "HPP Barang Dagang", accountType: "cogs", normalBalance: "debit", cashFlowCategory: "operating", isCash: false, systemRole: "cogs" },
  // Beban
  { code: "6-1000", name: "Beban Gaji", accountType: "expense", normalBalance: "debit", cashFlowCategory: "operating", isCash: false, systemRole: null },
  { code: "6-2000", name: "Beban Sewa", accountType: "expense", normalBalance: "debit", cashFlowCategory: "operating", isCash: false, systemRole: null },
  { code: "6-3000", name: "Beban Listrik & Air", accountType: "expense", normalBalance: "debit", cashFlowCategory: "operating", isCash: false, systemRole: null },
  { code: "6-4000", name: "Beban Penyusutan", accountType: "expense", normalBalance: "debit", cashFlowCategory: "operating", isCash: false, systemRole: null },
  { code: "6-5000", name: "Beban Bunga", accountType: "expense", normalBalance: "debit", cashFlowCategory: "operating", isCash: false, systemRole: null },
  { code: "6-6000", name: "Beban Angkut Pembelian", accountType: "expense", normalBalance: "debit", cashFlowCategory: "operating", isCash: false, systemRole: null },
  { code: "6-7000", name: "Beban Kemasan", accountType: "expense", normalBalance: "debit", cashFlowCategory: "operating", isCash: false, systemRole: null },
  { code: "6-9000", name: "Beban Lain-lain", accountType: "expense", normalBalance: "debit", cashFlowCategory: "operating", isCash: false, systemRole: null },
];

export const RETAIL_TEMPLATE: WorkspaceTemplate = {
  type: "retail",
  label: "Retail (Toko)",
  accounts: RETAIL_ACCOUNTS,
  inventoryNoun: "barang dagang",
  salesTaxDefaults: { mode: "simple", label: "PPN", rateBps: 0, inclusive: false, dppNumerator: 1, dppDenominator: 1 },
};
