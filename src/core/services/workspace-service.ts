import { isValidIsoDate } from "../dates";
import { assertNoIssues, fail } from "../errors";
import { monthlyPeriodsUntilYearEnd } from "../periods";
import { isValidTaxRate, SALES_TAX_LABELS, type WorkspaceTaxSettings } from "../sales-tax";
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

  /** Nama, tarif & mode harga pajak penjualan per workspace (ADR 012 & 015). */
  async updateSalesTaxSettings(workspaceId: string, settings: WorkspaceTaxSettings): Promise<Workspace> {
    if (!isValidTaxRate(settings.rateBps)) {
      fail("INVALID_AMOUNT", "Tarif pajak harus antara 0% dan 100%");
    }
    if (!SALES_TAX_LABELS.includes(settings.label)) {
      fail("INVALID_TAX_LABEL", "Jenis pajak penjualan harus PB1 atau PPN");
    }
    return this.deps.workspaces.updateSalesTaxSettings(workspaceId, settings);
  }
}
