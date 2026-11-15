import { describe, expect, it } from "vitest";
import { planLoginHref, safeLoginReturn } from "../src/domain/login";

describe("Plan login destinations", () => {
  it.each([
    "/",
    "/annual?year=2027&org=children",
    "/settings",
    "/?year=2027&month=11&view=list&event=123",
    "/share#calendar",
  ])("preserves the requested page %s", (path) => {
    expect(safeLoginReturn(path)).toBe(path);
    expect(
      new URL(
        planLoginHref("https://plan.yebom.org/api/auth/sso", path),
      ).searchParams.get("next"),
    ).toBe(path);
  });
  it.each([
    null,
    "",
    "https://evil.invalid",
    "//evil.invalid",
    "/\\evil.invalid",
    "/%5cevil.invalid",
    "/api/auth/sso",
    "/api/auth/logout",
    "/annual%0a",
    "/annual?x=%00",
    "/%2f%2fevil.invalid",
    "/unknown",
    "/annual?" + "x".repeat(2048),
  ])("rejects external, malformed and looping targets %s", (path) => {
    expect(safeLoginReturn(path)).toBe("/");
  });
  it("also supports a same-origin relative login entry", () => {
    expect(planLoginHref("/api/auth/sso", "/annual?year=2027")).toBe(
      "/api/auth/sso?next=%2Fannual%3Fyear%3D2027",
    );
  });
});
