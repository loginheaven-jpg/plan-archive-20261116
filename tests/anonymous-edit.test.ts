import { afterEach, describe, expect, it, vi } from "vitest";
import { actorFor, assertCSRF } from "../src/server/auth";
import { createEvent } from "../src/server/services";
import { POST } from "../src/app/api/events/route";

vi.mock("../src/server/auth", () => ({
  actorFor: vi.fn(),
  assertCSRF: vi.fn(),
}));
vi.mock("../src/server/services", () => ({ createEvent: vi.fn() }));
afterEach(() => vi.resetAllMocks());

describe("anonymous edits fail before parsing or writing", () => {
  it("rejects a missing identity even when the input is empty or malformed", async () => {
    vi.mocked(actorFor).mockResolvedValue(null);
    for (const body of ["{}", "not-json"]) {
      const request = new Request("https://plan.yebom.org/api/events", {
        method: "POST",
        headers: {
          Origin: "https://plan.yebom.org",
          "Content-Type": "application/json",
        },
        body,
      });
      const response = await POST(request);
      expect(response.status).toBe(401);
      expect((await response.json()).code).toBe("LOGIN_REQUIRED");
      expect(request.bodyUsed).toBe(false);
    }
    expect(createEvent).not.toHaveBeenCalled();
    expect(assertCSRF).toHaveBeenCalledTimes(2);
  });
});
