"use client";

import { useAuth } from "./AuthProvider";
import { needsPasswordReset, needsProfile } from "./client-session";

/** Passive notice; all session requests and lifecycle listeners live in AuthProvider. */
export default function SaintCheckin() {
  const { session, checking, error, openLogin, recheck } = useAuth();
  const accountRequired =
    needsProfile(session) ||
    needsPasswordReset(session) ||
    session?.state === "not_approved";
  const message =
    error ||
    (accountRequired ||
    ["unavailable", "not_configured", "wrong_origin"].includes(
      session?.state ?? "",
    )
      ? session?.message || "교회 계정 정보를 확인해 주세요."
      : "");
  if (!message) return null;
  return (
    <div role="status" className="alert auth-checkin-notice">
      <span>{message}</span>
      {accountRequired && (
        <button type="button" className="button" onClick={openLogin}>
          계정 완료 안내
        </button>
      )}
      <button
        type="button"
        className="button"
        disabled={checking}
        onClick={() => void recheck()}
      >
        다시 확인
      </button>
    </div>
  );
}
