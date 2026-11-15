import type {
  AnnualDraft,
  AnnualDraftInput,
  AnnualDraftSummary,
  AnnualPublishResult,
} from "@/domain/types";

export class AnnualApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "AnnualApiError";
  }
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      cache: "no-store",
      credentials: "same-origin",
      ...options,
      headers: {
        ...(options?.body ? { "Content-Type": "application/json" } : {}),
        ...options?.headers,
      },
    });
  } catch {
    throw new AnnualApiError(
      "서버에 연결하지 못했어요. 입력은 유지됩니다. 연결을 확인하고 다시 저장해 주세요.",
      0,
    );
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new AnnualApiError(
      typeof data.error === "string"
        ? data.error
        : typeof data.message === "string"
          ? data.message
          : "요청을 처리하지 못했어요. 입력을 유지한 채 다시 시도해 주세요.",
      response.status,
    );
  return data as T;
}

export const listDrafts = (year: number) =>
  request<{ drafts: AnnualDraftSummary[] }>(`/api/annual?year=${year}`);
export const getDraft = (id: string) =>
  request<{ draft: AnnualDraft }>(`/api/annual/${encodeURIComponent(id)}`);
export const createDraft = (id: string, input: AnnualDraftInput) =>
  request<{ draft: AnnualDraft }>("/api/annual", {
    method: "POST",
    body: JSON.stringify({ id, input }),
  });
export const saveDraft = (
  id: string,
  version: number,
  input: AnnualDraftInput,
) =>
  request<{ draft: AnnualDraft }>(`/api/annual/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify({ version, input }),
  });
export const publishDraft = (id: string, version: number, rowIds: string[]) =>
  request<AnnualPublishResult>(
    `/api/annual/${encodeURIComponent(id)}/publish`,
    {
      method: "POST",
      body: JSON.stringify({ version, rowIds }),
    },
  );
