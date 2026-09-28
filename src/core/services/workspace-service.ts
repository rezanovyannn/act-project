import { isValidIsoDate } from "../dates";
import { assertNoIssues, fail } from "../errors";
import { monthlyPeriodsUntilYearEnd } from "../periods";
import { isValidTaxRate, type SalesTaxSettings } from "../sales-tax";
import type { IWorkspaceRepository, NewWorkspace } from "../ports";
import { validateTemplate } from "../templates";
import type { TemplateRegistry, Workspace } from "../types";

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
  async createWorkspace(input: NewWorkspace): Promise<Workspace> {
    const name = input.name.trim();
    if (name === "") fail("EMPTY_NAME", "Nama workspace wajib diisi");
    if (!isValidIsoDate(input.booksStartDate)) {
      fail("INVALID_DATE", "Tanggal mulai pembukuan tidak valid");
    }
    const template = this.deps.templates[input.templateType];
    if (!template) fail("INVALID_TEMPLATE", "Jenis template tidak dikenal");
    assertNoIssues(validateTemplate(template));

    return this.deps.workspaces.createWithSeed(
      { ...input, name },
      template.accounts,
      monthlyPeriodsUntilYearEnd(input.booksStartDate),
    );
  }

  /** Tarif & mode harga PB1 per workspace (ADR 012). */
  async updateSalesTaxSettings(workspaceId: string, settings: SalesTaxSettings): Promise<Workspace> {
    if (!isValidTaxRate(settings.rateBps)) {
      fail("INVALID_AMOUNT", "Tarif PB1 harus antara 0% dan 100%");
    }
    return this.deps.workspaces.updateSalesTaxSettings(workspaceId, settings);
  }
}
