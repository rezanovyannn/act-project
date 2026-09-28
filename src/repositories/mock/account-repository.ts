import { fail } from "@/core/errors";
import type { AccountPatch, IAccountRepository } from "@/core/ports";
import type { Account, AccountSeed } from "@/core/types";
import type { MockDatabase, MockState } from "./mock-database";

function isUsedByJournal(state: MockState, accountId: string): boolean {
  return state.journals.some(
    (entry) =>
      entry.deletedAt === null &&
      entry.lines.some((line) => line.accountId === accountId),
  );
}

function assertUniqueCode(
  state: MockState,
  workspaceId: string,
  code: string,
  exceptId?: string,
): void {
  const taken = state.accounts.some(
    (a) =>
      a.workspaceId === workspaceId &&
      a.deletedAt === null &&
      a.code === code &&
      a.id !== exceptId,
  );
  if (taken) fail("DUPLICATE_ACCOUNT_CODE", `Kode akun ${code} sudah dipakai`);
}

export class MockAccountRepository implements IAccountRepository {
  constructor(private readonly db: MockDatabase) {}

  async listByWorkspace(workspaceId: string): Promise<Account[]> {
    return this.db
      .read()
      .accounts.filter((a) => a.workspaceId === workspaceId && a.deletedAt === null)
      .sort((a, b) => a.code.localeCompare(b.code));
  }

  async getById(id: string): Promise<Account | null> {
    return this.db.read().accounts.find((a) => a.id === id && a.deletedAt === null) ?? null;
  }

  async create(workspaceId: string, seed: AccountSeed): Promise<Account> {
    return this.db.write((state) => {
      assertUniqueCode(state, workspaceId, seed.code);
      const now = this.db.now();
      const account: Account = {
        ...seed,
        id: this.db.generateId(),
        workspaceId,
        isActive: true,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      state.accounts.push(account);
      return account;
    });
  }

  async update(id: string, patch: AccountPatch): Promise<Account> {
    return this.db.write((state) => {
      const account = state.accounts.find((a) => a.id === id && a.deletedAt === null);
      if (!account) fail("NOT_FOUND", "Akun tidak ditemukan");
      if (patch.code !== undefined) {
        assertUniqueCode(state, account.workspaceId, patch.code, id);
      }
      Object.assign(account, patch, { updatedAt: this.db.now() });
      return account;
    });
  }

  async softDelete(id: string): Promise<void> {
    this.db.write((state) => {
      const account = state.accounts.find((a) => a.id === id && a.deletedAt === null);
      if (!account) fail("NOT_FOUND", "Akun tidak ditemukan");
      if (isUsedByJournal(state, id)) {
        fail("ACCOUNT_INACTIVE", "Akun sudah dipakai jurnal; nonaktifkan saja, tidak bisa dihapus");
      }
      account.deletedAt = this.db.now();
    });
  }

  async hasJournalLines(id: string): Promise<boolean> {
    return isUsedByJournal(this.db.read(), id);
  }
}
