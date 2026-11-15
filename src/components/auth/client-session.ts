import type { ClientAuthSession, ProfileField } from "@/domain/auth";

const PROFILE_FIELDS: ProfileField[] = ["birth_date", "gender", "phone"];

/** Fail closed on an incomplete response; identity never supplies application roles. */
export function readClientSession(value: unknown): ClientAuthSession {
  if (!value || typeof value !== "object")
    throw new Error("로그인 응답을 확인하지 못했어요. 다시 확인해 주세요.");
  const data = value as Record<string, unknown>;
  const identity = data.identity;
  if (
    typeof data.authenticated !== "boolean" ||
    typeof data.state !== "string" ||
    typeof data.message !== "string" ||
    typeof data.profileCompletionRequired !== "boolean" ||
    typeof data.passwordResetRequired !== "boolean" ||
    !Array.isArray(data.profileMissingFields) ||
    !data.profileMissingFields.every((field) =>
      PROFILE_FIELDS.includes(field),
    ) ||
    !(
      identity === null ||
      (typeof identity === "object" &&
        identity !== null &&
        "id" in identity &&
        typeof identity.id === "string" &&
        "name" in identity &&
        typeof identity.name === "string")
    )
  )
    throw new Error("로그인 응답을 확인하지 못했어요. 다시 확인해 주세요.");
  return {
    authenticated: data.authenticated,
    state: data.state,
    identity:
      identity === null
        ? null
        : {
            id: (identity as { id: string; name: string }).id,
            name: (identity as { id: string; name: string }).name,
          },
    profileCompletionRequired: data.profileCompletionRequired,
    passwordResetRequired: data.passwordResetRequired,
    profileMissingFields: [...data.profileMissingFields],
    message: data.message,
  };
}

export function needsProfile(session: ClientAuthSession | null): boolean {
  return (
    !!session &&
    (session.profileCompletionRequired ||
      session.state === "profile_incomplete")
  );
}

export function needsPasswordReset(session: ClientAuthSession | null): boolean {
  return (
    !!session &&
    (session.passwordResetRequired ||
      session.state === "password_reset_required")
  );
}

export function eligibleSession(session: ClientAuthSession | null): boolean {
  return (
    !!session?.authenticated &&
    !!session.identity &&
    session.state === "authenticated" &&
    !needsProfile(session) &&
    !needsPasswordReset(session)
  );
}

export function credentialFormAllowed(
  session: ClientAuthSession | null,
): boolean {
  return (
    !!session &&
    !session.authenticated &&
    !session.identity &&
    !needsProfile(session) &&
    !needsPasswordReset(session) &&
    [
      "anonymous",
      "logged_out",
      "unauthenticated",
      "invalid",
      "invalid_cookie",
      "expired",
      "revoked",
      "invalid_credentials",
      "login_failed",
    ].includes(session.state)
  );
}

export const SAINT_PROFILE_URL = "https://saint.yebom.org/";
export const SAINT_PASSWORD_URL = "https://saint.yebom.org/change-password";
