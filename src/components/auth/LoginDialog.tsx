import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  CheckCircle2,
  ExternalLink,
  LoaderCircle,
  LogIn,
  X,
} from "lucide-react";
import { PROFILE_FIELD_LABELS } from "../../domain/auth";
import { useAuth } from "./AuthProvider";
import {
  credentialFormAllowed,
  eligibleSession,
  needsPasswordReset,
  needsProfile,
  SAINT_PASSWORD_URL,
  SAINT_PROFILE_URL,
} from "./client-session";

export default function LoginDialog({
  opening,
  onClose,
}: {
  opening: boolean;
  onClose: () => void;
}) {
  const { session, checking, error, login, recheck, logout } = useAuth();
  const dialog = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const errorId = useId();
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const waiting = opening || checking || submitting;
  const profile = needsProfile(session);
  const passwordReset = needsPasswordReset(session);
  const credentials = !opening && !error && credentialFormAllowed(session);

  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement;
    const formElement = form.current;
    // Native top-layer focus must not be pulled back by an underlying Radix editor.
    const protectFocus = (event: Event) => {
      if (event.target instanceof Node && element?.contains(event.target))
        event.stopPropagation();
    };
    const protectEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") protectFocus(event);
    };
    window.addEventListener("focusin", protectFocus, true);
    window.addEventListener("pointerdown", protectFocus, true);
    window.addEventListener("keydown", protectEscape, true);
    if (element && !element.open) element.showModal();
    return () => {
      // Credentials exist only in the form, never persistent state or storage.
      formElement?.reset();
      window.removeEventListener("focusin", protectFocus, true);
      window.removeEventListener("pointerdown", protectFocus, true);
      window.removeEventListener("keydown", protectEscape, true);
      element?.close();
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, []);

  useEffect(() => {
    if (eligibleSession(session) && !opening) onClose();
  }, [session, opening, onClose]);

  useEffect(() => {
    if (!credentials) return;
    form.current
      ?.querySelector<HTMLInputElement>('input[name="email"]')
      ?.focus();
  }, [credentials]);

  const clearPassword = () => {
    if (passwordInput.current) passwordInput.current.value = "";
  };
  const close = () => {
    clearPassword();
    onClose();
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (waiting || !credentials) return;
    setFormError("");
    const element = event.currentTarget;
    const emailInput = element.elements.namedItem("email") as HTMLInputElement;
    const rememberInput = element.elements.namedItem(
      "remember",
    ) as HTMLInputElement;
    const password = passwordInput.current?.value ?? "";
    const email = emailInput.value.trim();
    if (!email || !password) {
      setFormError("이메일 또는 전화번호와 비밀번호를 모두 입력해 주세요.");
      return;
    }
    setSubmitting(true);
    const operation = login(email, password, rememberInput.checked);
    // Clear immediately after handing the password to the same-origin request.
    clearPassword();
    try {
      const data = await operation;
      if (eligibleSession(data)) onClose();
      else if (data && credentialFormAllowed(data))
        setFormError(
          data.message || "계정 정보가 맞는지 확인하고 다시 입력해 주세요.",
        );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <dialog
      ref={dialog}
      className="dialog auth-dialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <header className="dialog-heading">
        <div>
          <h2 id={titleId}>
            {profile || passwordReset
              ? "로그인은 확인됐어요 · 계정 정보 완료 필요"
              : "교회 계정으로 로그인"}
          </h2>
          <p id={descriptionId}>
            현재 화면과 작성 중 입력을 그대로 두고 교적부 계정을 연결해요.
          </p>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="로그인 창 닫기"
          onClick={close}
        >
          <X size={22} />
        </button>
      </header>
      <div className="dialog-body auth-dialog-body">
        {waiting && (
          <p className="auth-status" role="status">
            <LoaderCircle size={21} aria-hidden="true" />
            {submitting
              ? "교적부에서 계정을 확인하고 있어요…"
              : "기존 교회 로그인을 확인하고 있어요…"}
          </p>
        )}
        {!opening && (profile || passwordReset) && (
          <section className="auth-completion" aria-label="계정 완료 단계">
            <p className="auth-status">
              <CheckCircle2 size={21} aria-hidden="true" />
              <strong>
                {session?.identity?.name
                  ? `${session.identity.name} 님의 신원을 확인했어요.`
                  : "계정 신원을 확인했어요."}
              </strong>
            </p>
            <p>
              비밀번호를 다시 입력하지 않아도 됩니다. 아래 필수 단계를 완료하기
              전에는 일정 입력·수정·저장을 사용할 수 없어요.
            </p>
            {passwordReset && (
              <div className="auth-stage">
                <h3>비밀번호 변경이 필요해요</h3>
                <p>교적부에서 필수 비밀번호 변경을 완료해 주세요.</p>
                <a
                  className="button"
                  href={SAINT_PASSWORD_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  교적부 비밀번호 변경 (새 탭)
                  <ExternalLink size={17} aria-hidden="true" />
                </a>
              </div>
            )}
            {profile && (
              <div className="auth-stage">
                <h3>필수 프로필 정보를 완료해 주세요</h3>
                {!!session?.profileMissingFields.length && (
                  <p>
                    필요한 정보:{" "}
                    {session.profileMissingFields
                      .map((field) => PROFILE_FIELD_LABELS[field])
                      .join(" · ")}
                  </p>
                )}
                <p>
                  교적부에서 실제 정보를 확인하고 저장해 주세요. 프로필 완료
                  제한을 건너뛰지 않아요.
                </p>
                <a
                  className="button"
                  href={SAINT_PROFILE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  교적부 프로필 완료 (새 탭)
                  <ExternalLink size={17} aria-hidden="true" />
                </a>
              </div>
            )}
            {session?.message && <p className="muted">{session.message}</p>}
            <button
              type="button"
              className="button primary"
              disabled={waiting}
              onClick={() => void recheck()}
            >
              완료 후 로그인 상태 다시 확인
            </button>
            <button
              type="button"
              className="button"
              disabled={waiting}
              onClick={() => void logout()}
            >
              로그아웃하고 다른 계정 사용
            </button>
          </section>
        )}
        {!opening &&
          !profile &&
          !passwordReset &&
          !credentials &&
          !eligibleSession(session) && (
            <div className="alert" role="status">
              <p>
                {error ||
                  session?.message ||
                  "로그인 연결 상태를 다시 확인해 주세요."}
              </p>
              {session?.state === "not_approved" && (
                <p>
                  교회 계정 승인이 필요해요. 승인 전에는 편집할 수 없습니다.
                </p>
              )}
              <button
                type="button"
                className="button"
                disabled={waiting}
                onClick={() => void recheck()}
              >
                다시 확인
              </button>
            </div>
          )}
        {credentials && (
          <form
            ref={form}
            onSubmit={submit}
            className="auth-login-form"
            aria-busy={waiting}
          >
            <p>
              재정부·교적부와 같은 계정을 사용해요. 기존 로그인이 있으면
              비밀번호 입력 없이 연결됩니다.
            </p>
            <label className="field">
              <span>이메일 또는 전화번호</span>
              <input
                name="email"
                type="text"
                autoComplete="username"
                required
                maxLength={254}
                disabled={waiting}
              />
            </label>
            <label className="field">
              <span>비밀번호</span>
              <input
                ref={passwordInput}
                name="password"
                type="password"
                autoComplete="current-password"
                required
                maxLength={256}
                disabled={waiting}
                aria-invalid={!!formError}
                aria-describedby={formError ? errorId : undefined}
              />
            </label>
            <label className="checkbox-row">
              <input
                name="remember"
                type="checkbox"
                defaultChecked
                disabled={waiting}
              />
              로그인 유지
            </label>
            {formError && (
              <p id={errorId} className="alert error" role="alert">
                {formError}
              </p>
            )}
            <button type="submit" className="button primary" disabled={waiting}>
              <LogIn size={18} aria-hidden="true" />
              {submitting ? "로그인 확인 중…" : "로그인"}
            </button>
            <p className="muted">
              비밀번호는 교적부가 확인하며 예봄일정은 저장하지 않아요.
              공용기기에서는 로그인 유지를 해제하고, 사용 후 로그아웃해 주세요.
            </p>
          </form>
        )}
      </div>
    </dialog>
  );
}
