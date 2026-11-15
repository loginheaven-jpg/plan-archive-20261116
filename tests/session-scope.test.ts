import { describe, expect, it } from "vitest";
import { SessionScope } from "../src/components/auth/session-scope";

describe("account-bound overlay requests and destructive input", () => {
  it("accepts only the opening owner in the current generation", () => {
    const scope = new SessionScope();
    const lease = scope.capture("actor-a/editor/children");
    expect(scope.permits(lease, "actor-a/editor/children")).toBe(true);
    expect(scope.permits(lease, "actor-b/editor/children")).toBe(false);
    expect(scope.permits(lease, "anonymous")).toBe(false);
  });
  it("rejects late detail and history responses after logout", () => {
    const scope = new SessionScope();
    const detail = scope.capture("actor-a");
    scope.invalidate();
    expect(scope.permits(detail, "anonymous")).toBe(false);
    expect(scope.permits(detail, "actor-a")).toBe(false);
  });
  it("does not revive a stale cancellation when the same user returns", () => {
    const scope = new SessionScope();
    const cancel = scope.capture("actor-a");
    scope.invalidate();
    scope.invalidate();
    const reopened = scope.capture("actor-a");
    expect(scope.permits(cancel, "actor-a")).toBe(false);
    expect(scope.permits(reopened, "actor-a")).toBe(true);
  });
  it("rejects a lease after the owner's actual role or departments change", () => {
    const scope = new SessionScope();
    const lease = scope.capture("actor-a/admin");
    expect(scope.permits(lease, "actor-a/viewer")).toBe(false);
    scope.invalidate();
    expect(scope.permits(lease, "actor-a/admin")).toBe(false);
  });
  it("never treats a missing lease as authority", () => {
    expect(new SessionScope().permits(null, "actor-a")).toBe(false);
  });
});
