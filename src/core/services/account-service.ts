import { fail } from "../errors";
import type { AccountPatch, IAccountRepository } from "../ports";
import { missingTemplateAccounts } from "../templates";
import type { Account, AccountType, CashFlowCategory, NormalBalance, WorkspaceTemplate } from "../types";

export interface AccountInput {
  code: string;
  name: string;
  accountType: AccountType;
  /** Kosong = saldo normal default jenis akun. */
  normalBalance?: NormalBalance;
  cashFlowCategory: CashFlowCategory;
  isCash: boolean;
}

export function defaultNormalBalance(type: AccountType): NormalBalance {
  return type === "asset" || type === "cogs" || type === "expense" ? "debit" : "credit";
}

/**
 * Aturan Chart of Accounts (ADR 009 & 011):
 * - akun ber-jurnal tidak bisa dihapus, hanya dinonaktifkan;
 * - akun ber-jurnal tidak bisa diubah jenis, saldo normal, atau status kas-nya
 *   (mengubah arti angka historis); kode, nama, dan kategori arus kas boleh;
 * - akun sistem (`system_role`) tidak bisa dihapus/dinonaktifkan/diubah jenisnya.
 */
export class AccountService {
  constructor(private readonly deps: { accounts: IAccountRepository }) {}

  async createAccount(workspaceId: string, input: AccountInput): Promise<Account> {
    const clean = this.validate(input);
    return this.deps.accounts.create(workspaceId, { ...clean, systemRole: null });
  }

  /** Akun template yang belum ada di workspace (untuk ditambahkan dari Pengaturan). */
  async missingTemplateAccounts(workspaceId: string, template: WorkspaceTemplate) {
    return missingTemplateAccounts(template, await this.deps.accounts.listByWorkspace(workspaceId));
  }

  /** Menambahkan akun template (berdasarkan kode) yang belum ada, termasuk perannya (ADR 015). */
  async addTemplateAccounts(workspaceId: string, template: WorkspaceTemplate, codes: readonly string[]): Promise<Account[]> {
    const missing = await this.missingTemplateAccounts(workspaceId, template);
    const seeds = codes.map((code) => {
      const seed = missing.find((s) => s.code === code);
      if (!seed) fail("INVALID_ACCOUNT", `Akun template ${code} sudah ada atau tidak dikenal`);
      return seed;
    });
    const created: Account[] = [];
    for (const seed of seeds) created.push(await this.deps.accounts.create(workspaceId, seed));
    return created;
  }

  async updateAccount(id: string, input: AccountInput): Promise<Account> {
    const account = await this.require(id);
    const clean = this.validate(input);
    const structural =
      clean.accountType !== account.accountType ||
      clean.normalBalance !== account.normalBalance ||
      clean.isCash !== account.isCash;
    if (structural) {
      if (account.systemRole) {
        fail("SYSTEM_ACCOUNT", "Jenis, saldo normal, dan status kas akun sistem tidak dapat diubah");
      }
      if (await this.deps.accounts.hasJournalLines(id)) {
        fail(
          "ACCOUNT_IN_USE",
          "Akun sudah dipakai jurnal: jenis, saldo normal, dan status kas tidak dapat diubah. Buat akun baru bila perlu.",
        );
      }
    }
    const patch: AccountPatch = {
      code: clean.code,
      name: clean.name,
      accountType: clean.accountType,
      normalBalance: clean.normalBalance,
      cashFlowCategory: clean.cashFlowCategory,
      isCash: clean.isCash,
    };
    return this.deps.accounts.update(id, patch);
  }

  async setActive(id: string, isActive: boolean): Promise<Account> {
    const account = await this.require(id);
    if (!isActive && account.systemRole) {
      fail("SYSTEM_ACCOUNT", `${account.name} adalah akun sistem dan tidak dapat dinonaktifkan`);
    }
    return this.deps.accounts.update(id, { isActive });
  }

  async deleteAccount(id: string): Promise<void> {
    const account = await this.require(id);
    if (account.systemRole) {
      fail("SYSTEM_ACCOUNT", `${account.name} adalah akun sistem dan tidak dapat dihapus`);
    }
    await this.deps.accounts.softDelete(id);
  }

  private validate(input: AccountInput): Required<AccountInput> {
    const code = input.code.trim();
    const name = input.name.trim();
    if (code === "" || name === "") fail("EMPTY_NAME", "Kode dan nama akun wajib diisi");
    if (input.isCash && input.accountType !== "asset") {
      fail("INVALID_ACCOUNT", "Akun kas/bank harus berjenis aset");
    }
    return {
      ...input,
      code,
      name,
      normalBalance: input.normalBalance ?? defaultNormalBalance(input.accountType),
      // Akun kas sendiri bukan aktivitas arus kas (ADR 010).
      cashFlowCategory: input.isCash ? "none" : input.cashFlowCategory,
    };
  }

  private async require(id: string): Promise<Account> {
    const account = await this.deps.accounts.getById(id);
    if (!account) fail("NOT_FOUND", "Akun tidak ditemukan");
    return account;
  }
}
