import { randomUUID } from "node:crypto";
import { APIError } from "./validation";
import { actorFor, assertCSRF } from "./auth";
import type { Actor } from "../domain/types";

export function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
export function api(handler: () => Promise<Response>): Promise<Response> {
  return handler().catch((error) => {
    if (error instanceof APIError)
      return json(
        { error: error.message, code: error.code, message: error.message },
        error.status,
      );
    const requestId = randomUUID();
    // Never log SQL, payloads, cookie values, DSNs, secret values, or driver error messages.
    console.error("Calendar API unavailable", { requestId });
    const message =
      "데이터베이스 연결 또는 마이그레이션 상태를 확인해야 합니다. 잠시 후 다시 시도하세요.";
    return json(
      { error: message, code: "DATABASE_UNAVAILABLE", message, requestId },
      503,
    );
  });
}
export async function readActor(request: Request): Promise<Actor | null> {
  // Explicit public mode must not upsert a user, expose an actor, or inherit cookie privileges.
  if (new URL(request.url).searchParams.get("public") === "1") return null;
  try {
    return await actorFor(request);
  } catch (error) {
    // Provider outages must not become a login wall for ordinary public reading.
    // Mutations use writeActor and still fail closed; no authenticated role is kept.
    if (
      error instanceof APIError &&
      (error.status === 503 ||
        ["SAINT_APPROVAL_REQUIRED", "PROFILE_COMPLETION_REQUIRED"].includes(
          error.code,
        ))
    )
      return null;
    throw error;
  }
}
export async function writeActor(request: Request): Promise<Actor | null> {
  assertCSRF(request);
  return actorFor(request);
}
export function assertUniqueJSONKeys(source: string) {
  const stack: { kind: "object" | "array"; keys: Set<string> }[] = [];
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (c === '"') {
      const begin = i++;
      while (i < source.length) {
        if (source[i] === "\\") i += 2;
        else if (source[i++] === '"') break;
      }
      let after = i;
      while (/\s/.test(source[after] ?? "") && after < source.length) after++;
      const frame = stack.at(-1);
      if (source[after] === ":" && frame?.kind === "object") {
        const key = JSON.parse(source.slice(begin, i)) as string;
        if (frame.keys.has(key))
          throw new APIError(
            400,
            "DUPLICATE_KEY",
            "같은 JSON 입력 항목이 중복되었습니다.",
          );
        frame.keys.add(key);
      }
    } else {
      if (c === "{" || c === "[") {
        stack.push({ kind: c === "{" ? "object" : "array", keys: new Set() });
        if (stack.length > 25)
          throw new APIError(400, "INPUT_DEPTH", "입력 구조가 너무 깊습니다.");
      } else if (c === "}" || c === "]") stack.pop();
      i++;
    }
  }
}
export async function readJSON(
  request: Request,
  maxBytes = 65536,
): Promise<unknown> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 524288)
    throw new APIError(
      400,
      "INVALID_BODY_LIMIT",
      "허용된 요청 크기 한도를 확인하세요.",
    );
  if (
    !(request.headers.get("content-type") ?? "")
      .toLowerCase()
      .startsWith("application/json")
  )
    throw new APIError(415, "JSON_REQUIRED", "JSON 형식으로 요청하세요.");
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes))
    throw new APIError(413, "INPUT_TOO_LARGE", "입력 크기가 너무 큽니다.");
  if (!request.body)
    throw new APIError(400, "EMPTY_BODY", "입력이 필요합니다.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new APIError(413, "INPUT_TOO_LARGE", "입력 크기가 너무 큽니다.");
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const data = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.length;
  }
  let source: string;
  let result: unknown;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(data);
    result = JSON.parse(source);
  } catch {
    throw new APIError(400, "INVALID_JSON", "올바른 JSON 입력이 아닙니다.");
  }
  assertUniqueJSONKeys(source);
  return result;
}
export function eventId(value: string): string {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw new APIError(400, "INVALID_ID", "올바른 일정 ID가 아닙니다.");
  return value.toLowerCase();
}
