import { afterEach, describe, expect, it, vi } from "vitest";
import { actorFor, assertCSRF } from "../src/server/auth";
import { readActor, writeActor } from "../src/server/http";
import { APIError } from "../src/server/validation";
import { newAnnualRow } from "../src/domain/annual";
import {
  canCreate,
  canEditEvent,
  canReadEvent,
} from "../src/domain/permissions";

vi.mock("../src/server/auth", () => ({
  actorFor: vi.fn(),
  assertCSRF: vi.fn(),
}));
afterEach(() => vi.resetAllMocks());

describe("read without login, authenticate edits only", () => {
  it("new ordinary annual rows are readable anonymously but never anonymously editable", () => {
    const row = newAnnualRow("children", 2027);
    expect(row.input.visibility).toBe("public");
    expect(canReadEvent(row.input, null)).toBe(true);
    expect(canEditEvent(row.input, null)).toBe(false);
    expect(canCreate(null)).toBe(false);
    expect(canReadEvent({ ...row.input, visibility: "members" }, null)).toBe(
      false,
    );
    expect(canReadEvent({ ...row.input, visibility: "department" }, null)).toBe(
      false,
    );
  });
  it("provider unavailable falls back only to anonymous reading, not edit authorization", async () => {
    const error = new APIError(
      503,
      "SSO_PROVIDER_UNAVAILABLE",
      "교적부 연결을 확인해 주세요.",
    );
    vi.mocked(actorFor).mockRejectedValue(error);
    const request = new Request("https://plan.yebom.org/api/bootstrap");
    await expect(readActor(request)).resolves.toBeNull();
    await expect(writeActor(request)).rejects.toBe(error);
    expect(assertCSRF).toHaveBeenCalledOnce();
  });
  it("pending approval and incomplete profiles may read public schedules but cannot edit", async () => {
    for (const code of [
      "SAINT_APPROVAL_REQUIRED",
      "PROFILE_COMPLETION_REQUIRED",
    ]) {
      const error = new APIError(403, code, "교적부 계정을 확인해 주세요.");
      vi.mocked(actorFor).mockRejectedValue(error);
      const request = new Request("https://plan.yebom.org/api/bootstrap");
      await expect(readActor(request)).resolves.toBeNull();
      await expect(writeActor(request)).rejects.toBe(error);
    }
  });
  it("explicit public reads never invoke identity or database writes", async () => {
    await expect(
      readActor(new Request("https://plan.yebom.org/api/bootstrap?public=1")),
    ).resolves.toBeNull();
    expect(actorFor).not.toHaveBeenCalled();
  });
  it("unexpected database and programming errors are not hidden as SSO outages", async () => {
    const error = new Error("isolated unexpected error");
    vi.mocked(actorFor).mockRejectedValue(error);
    await expect(
      readActor(new Request("https://plan.yebom.org/api/bootstrap")),
    ).rejects.toBe(error);
  });
});
