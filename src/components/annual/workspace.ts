import type {
  AnnualDraft,
  AnnualDraftInput,
  AnnualPlanRow,
  OrganizationId,
} from "@/domain/types";

export interface Workspace {
  key: string;
  id: string | null;
  creationId: string | null;
  version: number;
  year: number;
  organizationId: OrganizationId | "";
  rows: AnnualPlanRow[];
  publishedRowIds: string[];
  baseline: string | null;
}

export function blankWorkspace(
  year: number,
  organizationId: OrganizationId | "" = "",
  key = "initial",
): Workspace {
  return {
    key,
    id: null,
    creationId: null,
    version: 0,
    year,
    organizationId,
    rows: [],
    publishedRowIds: [],
    baseline: null,
  };
}
export function workspaceInput(workspace: Workspace): AnnualDraftInput | null {
  if (!workspace.organizationId) return null;
  return {
    year: workspace.year,
    organizationId: workspace.organizationId,
    rows: workspace.rows,
  };
}
export function workspaceDirty(workspace: Workspace): boolean {
  if (workspace.baseline === null) return workspace.rows.length > 0;
  return JSON.stringify(workspaceInput(workspace)) !== workspace.baseline;
}
export function fromDraft(draft: AnnualDraft): Workspace {
  const input: AnnualDraftInput = {
    year: draft.year,
    organizationId: draft.organizationId,
    rows: draft.rows,
  };
  return {
    ...input,
    key: draft.id,
    id: draft.id,
    creationId: draft.id,
    version: draft.version,
    publishedRowIds: draft.publishedRowIds,
    baseline: JSON.stringify(input),
  };
}
