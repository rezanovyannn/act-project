import type { WorkspaceBackup } from "../backup";
import { parseBackup, type RestoreSummary } from "../backup-restore";
import { isValidIsoDate } from "../dates";
import { assertNoIssues, fail } from "../errors";
import { monthlyPeriodsUntilYearEnd } from "../periods";
import type { IWorkspaceRepository, NewWorkspace } from "../ports";
import { validateTemplate } from "../templates";
import type { TemplateRegistry, TemplateType, Workspace, WorkspaceTemplate } from "../types";

export interface WorkspaceServiceDeps {
  workspaces: IWorkspaceRepository;
  templates: TemplateRegistry;
}

export class WorkspaceService {
  constructor(private readonly deps: WorkspaceServiceDeps) {}

  listWorkspaces(ownerId: string): Promise<Workspace[]> {
    return this.deps.workspaces.listByOwner(ownerId);
  }

  /**
   * Membuat workspace, menyemai CoA dari template, dan membuat periode
   * bulanan `open` dari bulan mulai pembukuan sampai Desember (ADR 002 & 006).
   */
  /** Template terdaftar (CoA awal, istilah persediaan, pajak awal). */
  templateOf(type: TemplateType): WorkspaceTemplate {
    const template = this.deps.templates[type];
    if (!template) fail("INVALID_TEMPLATE", "Jenis template tidak dikenal");
    return template;
  }

  listTemplates(): WorkspaceTemplate[] {
    return Object.values(this.deps.templates);
  }

  /** Baca & validasi file backup (ADR 023); dilempar INVALID_BACKUP bila rusak. */
  inspectBackup(raw: unknown): { backup: WorkspaceBackup; summary: RestoreSummary } {
    return parseBackup(raw, Object.keys(this.deps.templates) as TemplateType[]);
  }

  /** Pulihkan backup sebagai workspace baru milik `ownerId`. */
  async restoreBackup(ownerId: string, raw: unknown, name: string): Promise<Workspace> {
    const { backup } = this.inspectBackup(raw);
    if (name.trim() === "") fail("EMPTY_NAME", "Nama workspace wajib diisi");
    return this.deps.workspaces.restoreFromBackup(ownerId, name.trim(), backup);
  }

  async createWorkspace(input: Omit<NewWorkspace, "salesTax">): Promise<Workspace> {
    const name = input.name.trim();
    if (name === "") fail("EMPTY_NAME", "Nama workspace wajib diisi");
    if (!isValidIsoDate(input.booksStartDate)) {
      fail("INVALID_DATE", "Tanggal mulai pembukuan tidak valid");
    }
    const template = this.templateOf(input.templateType);
    assertNoIssues(validateTemplate(template));

    return this.deps.workspaces.createWithSeed(
      { ...input, name, salesTax: template.salesTaxDefaults },
      template.accounts,
      monthlyPeriodsUntilYearEnd(input.booksStartDate),
    );
  }
}
