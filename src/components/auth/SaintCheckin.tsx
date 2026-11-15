"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

/** Uses our same-origin proxy; never reads a sealed cookie or calls Saint CORS from JS. */
export default function SaintCheckin() {
  const pathname = usePathname();
  const [message, setMessage] = useState("");
  const [accountRequired, setAccountRequired] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (pathname === "/share") return;
    let active = true;
    let running = false;
    let queued = false;
    let focusTimer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();

    const check = async () => {
      if (!active) return;
      // A return during an in-flight check must be checked again afterwards.
      if (running) {
        queued = true;
        return;
      }
      running = true;
      try {
        const response = await fetch("/api/auth/checkin", {
          credentials: "include",
          cache: "no-store",
          signal: controller.signal,
        });
        const data: {
          authenticated?: boolean;
          state?: string;
          message?: string;
        } = await response.json();
        if (!active) return;
        if (response.status >= 500 || response.status === 409) {
          setAccountRequired(false);
          setMessage(
            data.message ||
              "교적부 로그인 확인에 연결하지 못했어요. 잠시 후 다시 확인해 주세요.",
          );
          return;
        }
        if (response.ok || response.status === 401 || response.status === 403) {
          const needsAccount =
            data.state === "not_approved" ||
            data.state === "profile_incomplete";
          setAccountRequired(needsAccount);
          // The same-origin route supplies sanitized text; React renders it as text.
          setMessage(
            needsAccount
              ? data.message || "교적부 계정 정보를 확인해 주세요."
              : "",
          );
          // A focus refresh never navigates or clears an editor/annual workspace.
          window.dispatchEvent(new Event("yebom:session-changed"));
        }
      } catch {
        if (active)
          setMessage(
            "교적부 로그인 확인에 연결하지 못했어요. 입력은 그대로 보관됩니다.",
          );
      } finally {
        running = false;
        if (active && queued) {
          queued = false;
          void check();
        }
      }
    };
    const onFocus = () => {
      if (document.visibilityState !== "visible") return;
      // Coalesce focus + visibility events, without suppressing a fast SSO return.
      clearTimeout(focusTimer);
      focusTimer = setTimeout(() => void check(), 100);
    };
    const onCheckSession = () => {
      clearTimeout(focusTimer);
      void check();
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) onCheckSession();
    };
    void check();
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("yebom:check-session", onCheckSession);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      active = false;
      clearTimeout(focusTimer);
      controller.abort();
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("yebom:check-session", onCheckSession);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [pathname, retry]);

  if (pathname === "/share" || !message) return null;
  return (
    <div
      role="status"
      className="alert"
      style={{
        margin: 0,
        borderRadius: 0,
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 12,
      }}
    >
      <span>{message}</span>
      {accountRequired && (
        <a className="button" href="https://saint.yebom.org/">
          교적부 계정 확인
        </a>
      )}
      <button className="button" onClick={() => setRetry((value) => value + 1)}>
        다시 확인
      </button>
      <button className="button" onClick={() => setMessage("")}>
        안내 닫기
      </button>
    </div>
  );
}
