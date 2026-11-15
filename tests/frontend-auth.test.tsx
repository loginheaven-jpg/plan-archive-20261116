import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ClientAuthSession } from "../src/domain/auth";
import {
  credentialFormAllowed,
  eligibleSession,
  readClientSession,
} from "../src/components/auth/client-session";

const auth = vi.hoisted(() => ({
  session: null as ClientAuthSession | null,
  checking: false,
  error: "",
  openLogin: vi.fn(),
  recheck: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
}));
vi.mock("../src/components/auth/AuthProvider", () => ({ useAuth: () => auth }));
import LoginDialog from "../src/components/auth/LoginDialog";
import LoginLink from "../src/components/auth/LoginLink";

const anonymous: ClientAuthSession = {
  authenticated: false,
  state: "anonymous",
  identity: null,
  profileCompletionRequired: false,
  passwordResetRequired: false,
  profileMissingFields: [],
  message: "로그인이 필요해요.",
};
const approved: ClientAuthSession = {
  ...anonymous,
  authenticated: true,
  state: "authenticated",
  identity: { id: "verified-person", name: "확인된 성도" },
  message: "세션을 확인했어요.",
};

beforeEach(() => {
  auth.session = { ...anonymous };
  auth.checking = false;
  auth.error = "";
  vi.clearAllMocks();
});

function markup(opening = false) {
  return renderToStaticMarkup(
    <LoginDialog opening={opening} onClose={() => undefined} />,
  );
}

describe("frontend session contract and fail-closed eligibility", () => {
  it("uses only verified identity, never projected provider roles", () => {
    const data = readClientSession({
      ...approved,
      identity: { ...approved.identity, role: "admin", token: "not-retained" },
    });
    expect(data.identity).toEqual(approved.identity);
    expect(eligibleSession(data)).toBe(true);
  });
  it.each(["birth_date", "gender", "phone"] as const)(
    "blocks profile pending for %s",
    (field) => {
      const pending = {
        ...approved,
        state: "profile_incomplete",
        profileCompletionRequired: true,
        profileMissingFields: [field],
      };
      expect(eligibleSession(pending)).toBe(false);
      expect(credentialFormAllowed(pending)).toBe(false);
    },
  );
  it("blocks a password requirement even when the state says authenticated", () => {
    const pending = { ...approved, passwordResetRequired: true };
    expect(eligibleSession(pending)).toBe(false);
    expect(credentialFormAllowed(pending)).toBe(false);
  });
  it("requires both verified identity and explicit approved state", () => {
    expect(eligibleSession({ ...approved, identity: null })).toBe(false);
    expect(eligibleSession({ ...approved, state: "not_approved" })).toBe(false);
    expect(eligibleSession(null)).toBe(false);
  });
  it("accepts logout and invalid-cookie retry without inventing authentication", () => {
    expect(credentialFormAllowed({ ...anonymous, state: "logged_out" })).toBe(
      true,
    );
    expect(
      credentialFormAllowed({ ...anonymous, state: "invalid_cookie" }),
    ).toBe(true);
    expect(credentialFormAllowed({ ...anonymous, state: "unavailable" })).toBe(
      false,
    );
  });
  it("rejects incomplete/invalid API contracts", () => {
    expect(() =>
      readClientSession({ authenticated: true, state: "authenticated" }),
    ).toThrow();
    expect(() =>
      readClientSession({ ...approved, passwordResetRequired: "false" }),
    ).toThrow();
    expect(() =>
      readClientSession({ ...approved, profileMissingFields: ["address"] }),
    ).toThrow();
  });
});

describe("accessible in-page login stages", () => {
  it("renders a native labelled dialog and anonymous credential form", () => {
    const html = markup();
    expect(html).toContain("<dialog");
    expect(html).toContain("aria-labelledby=");
    expect(html).toContain('name="email"');
    expect(html).toContain('type="password"');
    expect(html).toContain('autoComplete="current-password"');
    expect(html).toContain('maxLength="256"');
    expect(html).toContain("공용기기에서는 로그인 유지를 해제");
    expect(html).toMatch(/name="remember"[^>]*checked=""/);
  });
  it("never exposes credentials while checking immediately before opening", () => {
    expect(markup(true)).not.toContain('type="password"');
  });
  it("never exposes credentials for an existing approved session", () => {
    auth.session = approved;
    expect(markup()).not.toContain('type="password"');
  });
  it("shows precise missing fields and a separate-tab profile completion action", () => {
    auth.session = {
      ...approved,
      state: "profile_incomplete",
      profileCompletionRequired: true,
      profileMissingFields: ["birth_date", "gender", "phone"],
    };
    const html = markup();
    expect(html).not.toContain('type="password"');
    expect(html).toContain("생년월일 · 성별 · 연락처");
    expect(html).toContain("교적부 프로필 완료 (새 탭)");
    expect(html).toContain('target="_blank"');
    expect(html).toContain("완료 후 로그인 상태 다시 확인");
  });
  it("shows password completion without asking for credentials again", () => {
    auth.session = {
      ...approved,
      state: "password_reset_required",
      passwordResetRequired: true,
    };
    const html = markup();
    expect(html).not.toContain('type="password"');
    expect(html).toContain('href="https://saint.yebom.org/change-password"');
    expect(html).toContain("일정 입력·수정·저장");
  });
  it("shows both completion requirements if the central response supplies both", () => {
    auth.session = {
      ...approved,
      state: "password_reset_required",
      passwordResetRequired: true,
      profileCompletionRequired: true,
      profileMissingFields: ["phone"],
    };
    const html = markup();
    expect(html).toContain("교적부 프로필 완료 (새 탭)");
    expect(html).toContain("교적부 비밀번호 변경 (새 탭)");
    expect(html).not.toContain('type="password"');
  });
  it("fails closed for a connection error", () => {
    auth.session = null;
    auth.error = "연결을 확인하지 못했어요.";
    expect(markup()).toContain(auth.error);
    expect(markup()).not.toContain('type="password"');
  });
  it("keeps all old LoginLink call sites in page, ignoring navigation/new-tab parameters", () => {
    const html = renderToStaticMarkup(
      <LoginLink
        entry="/api/auth/sso"
        returnTo="/annual?year=2030&org=young"
        target="_blank"
      >
        로그인
      </LoginLink>,
    );
    expect(html).toContain('<button type="button"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).not.toContain("<a");
    expect(html).not.toContain("href=");
    expect(html).not.toContain("target=");
  });
});
