export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      cache: "no-store",
      ...options,
      headers: {
        ...(options?.body ? { "Content-Type": "application/json" } : {}),
        ...options?.headers,
      },
    });
  } catch {
    throw new Error(
      "서버 응답을 확인하지 못했어요. 입력을 유지한 채 같은 내용으로 다시 시도해 주세요.",
    );
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      typeof result.error === "string"
        ? result.error
        : typeof result.message === "string"
          ? result.message
          : "요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.",
    );
  return result as T;
}
