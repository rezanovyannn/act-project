import { describe, expect, it } from "vitest";
import { buildFnbMockState, FNB_WORKSPACE_ID, MOCK_OWNER_ID } from "@/mocks/fnb/dataset";
import {
  createMockRepositories,
  emptyMockState,
  MemoryStorage,
  MOCK_STORAGE_KEY,
  MockDatabase,
} from "@/repositories/mock";
import { describeRepositoryContract } from "./repository-contract";

let counter = 0;
const newDb = (storage = new MemoryStorage(), seed = emptyMockState) =>
  new MockDatabase({ storage, seed, generateId: () => `id-${++counter}` });

describeRepositoryContract("mock (localStorage)", () => {
  // Dua pemilik berbagi satu penyimpanan, seperti dua user pada satu database.
  const repos = createMockRepositories(newDb());
  return { owner: { repos, ownerId: "owner-a" }, other: { repos, ownerId: "owner-b" } };
});

describe("mock database", () => {
  it("men-seed dataset saat storage kosong", async () => {
    const repos = createMockRepositories(newDb(new MemoryStorage(), buildFnbMockState));
    const workspaces = await repos.workspaces.listByOwner(MOCK_OWNER_ID);
    expect(workspaces.map((w) => w.id)).toEqual([FNB_WORKSPACE_ID]);
  });

  it("data bertahan setelah 'reload' (instance baru, storage sama)", async () => {
    const storage = new MemoryStorage();
    const first = createMockRepositories(newDb(storage, buildFnbMockState));
    const renamed = await first.workspaces.rename(FNB_WORKSPACE_ID, "Kedai Senja Baru");

    const afterReload = createMockRepositories(newDb(storage, buildFnbMockState));
    expect(await afterReload.workspaces.getById(FNB_WORKSPACE_ID)).toEqual(renamed);
  });

  it("mengganti data yang schemaVersion-nya berbeda atau rusak dengan seed", async () => {
    const storage = new MemoryStorage();
    storage.setItem(MOCK_STORAGE_KEY, JSON.stringify({ schemaVersion: 0, workspaces: [] }));
    expect(newDb(storage, buildFnbMockState).read().workspaces).toHaveLength(1);

    storage.setItem(MOCK_STORAGE_KEY, "{bukan json");
    expect(newDb(storage, buildFnbMockState).read().workspaces).toHaveLength(1);
  });

  it("mutasi yang gagal tidak mengubah data tersimpan", () => {
    const storage = new MemoryStorage();
    const db = newDb(storage, buildFnbMockState);
    db.read();
    const before = storage.getItem(MOCK_STORAGE_KEY);
    expect(() =>
      db.write((state) => {
        state.workspaces = [];
        throw new Error("gagal di tengah");
      }),
    ).toThrow("gagal di tengah");
    expect(storage.getItem(MOCK_STORAGE_KEY)).toBe(before);
  });

  it("reset mengembalikan dataset awal", async () => {
    const storage = new MemoryStorage();
    const db = newDb(storage, buildFnbMockState);
    const repos = createMockRepositories(db);
    await repos.workspaces.softDelete(FNB_WORKSPACE_ID);
    db.reset();
    expect(await repos.workspaces.getById(FNB_WORKSPACE_ID)).not.toBeNull();
  });
});
