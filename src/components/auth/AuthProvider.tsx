"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import {
  AUTH_CHANGED_EVENT,
  OPEN_LOGIN_EVENT,
  type ClientAuthSession,
} from "@/domain/auth";
import { eligibleSession, readClientSession } from "./client-session";
import LoginDialog from "./LoginDialog";
import SaintCheckin from "./SaintCheckin";

interface AuthContextValue {
  session: ClientAuthSession | null;
  checked: boolean;
  checking: boolean;
  error: string;
  openLogin: () => void;
  recheck: () => Promise<ClientAuthSession | null>;
  login: (
    email: string,
    password: string,
    remember: boolean,
  ) => Promise<ClientAuthSession | null>;
  logout: () => Promise<ClientAuthSession | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("AuthProvider가 필요합니다.");
  return context;
}

/** One same-origin check-in owner. AUTH_CHANGED_EVENT is output, never a check-in trigger. */
export default function AuthProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const publicMode = pathname === "/share" || pathname.startsWith("/share/");
  const [session, setSession] = useState<ClientAuthSession | null>(null);
  const [checked, setChecked] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [loginOpen, setLoginOpen] = useState(false);
  const [opening, setOpening] = useState(false);
  const active = useRef(false);
  const inFlight = useRef<Promise<ClientAuthSession | null> | null>(null);
  const controller = useRef<AbortController | null>(null);
  const dialogGeneration = useRef(0);

  const request = useCallback(
    (
      url: string,
      options: RequestInit = {},
    ): Promise<ClientAuthSession | null> => {
      const abort = new AbortController();
      controller.current = abort;
      setChecking(true);
      const operation = (async () => {
        try {
          const response = await fetch(url, {
            ...options,
            credentials: "same-origin",
            cache: "no-store",
            signal: abort.signal,
          });
          const data = readClientSession(await response.json());
          if (!active.current || abort.signal.aborted) return null;
          setSession(data);
          setChecked(true);
          setError("");
          // Reload the real application actor and roles even if only a role changed.
          window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
          // Keep older integrations working, without listening back to either event here.
          window.dispatchEvent(new Event("yebom:session-changed"));
          return data;
        } catch {
          if (active.current && !abort.signal.aborted) {
            setSession(null);
            setChecked(true);
            setError(
              "교적부 로그인 상태를 확인하지 못했어요. 입력은 보관되며, 확인 전에는 편집할 수 없어요.",
            );
            window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
            window.dispatchEvent(new Event("yebom:session-changed"));
          }
          return null;
        } finally {
          if (controller.current === abort) {
            controller.current = null;
            inFlight.current = null;
            if (active.current) setChecking(false);
          }
        }
      })();
      inFlight.current = operation;
      return operation;
    },
    [],
  );

  const recheck = useCallback(() => {
    if (publicMode || !active.current) return Promise.resolve(null);
    // First-entry/focus/visibility/open/recheck calls share an in-flight request.
    return inFlight.current ?? request("/api/auth/checkin");
  }, [publicMode, request]);

  const login = useCallback(
    async (email: string, password: string, remember: boolean) => {
      if (publicMode || !active.current) return null;
      // An older check must never overwrite the result of a credential POST.
      if (inFlight.current) await inFlight.current;
      if (!active.current) return null;
      return request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, remember }),
      });
    },
    [publicMode, request],
  );

  const logout = useCallback(async () => {
    if (publicMode || !active.current) return null;
    if (inFlight.current) await inFlight.current;
    if (!active.current) return null;
    return request("/api/auth/logout", { method: "POST" });
  }, [publicMode, request]);

  const closeLogin = useCallback(() => {
    ++dialogGeneration.current;
    setLoginOpen(false);
    setOpening(false);
  }, []);

  const openLogin = useCallback(() => {
    if (publicMode) return;
    const generation = ++dialogGeneration.current;
    // Mount only a checking stage until the fresh shared-session result is known.
    setOpening(true);
    setLoginOpen(true);
    const current = inFlight.current;
    void (current ? current.then(() => recheck()) : recheck()).then((data) => {
      if (!active.current || generation !== dialogGeneration.current) return;
      setOpening(false);
      if (eligibleSession(data)) setLoginOpen(false);
    });
  }, [publicMode, recheck]);

  useEffect(() => {
    active.current = true;
    if (publicMode)
      return () => {
        active.current = false;
      };
    const generation = dialogGeneration;
    let queued: Promise<ClientAuthSession | null> | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const checkReturn = () => {
      const current = inFlight.current;
      if (!current) {
        void recheck();
        return;
      }
      // A return can carry a newer cookie than a check already in flight. Coalesce
      // all return events into just one follow-up, not a self-triggering loop.
      if (queued === current) return;
      queued = current;
      void current.then(() => {
        if (!active.current || queued !== current) return;
        queued = null;
        void recheck();
      });
    };
    const onFocus = () => {
      if (document.visibilityState !== "visible") return;
      clearTimeout(timer);
      timer = setTimeout(checkReturn, 100);
    };
    const onCheck = () => {
      clearTimeout(timer);
      checkReturn();
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) onCheck();
    };
    void recheck();
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("yebom:check-session", onCheck);
    window.addEventListener(OPEN_LOGIN_EVENT, openLogin);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      active.current = false;
      ++generation.current;
      queued = null;
      clearTimeout(timer);
      controller.current?.abort();
      controller.current = null;
      inFlight.current = null;
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("yebom:check-session", onCheck);
      window.removeEventListener(OPEN_LOGIN_EVENT, openLogin);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [publicMode, recheck, openLogin]);

  const value = useMemo(
    () => ({
      session,
      checked,
      checking,
      error,
      openLogin,
      recheck,
      login,
      logout,
    }),
    [session, checked, checking, error, openLogin, recheck, login, logout],
  );
  return (
    <AuthContext.Provider value={value}>
      {!publicMode && <SaintCheckin />}
      {children}
      {!publicMode && loginOpen && (
        <LoginDialog opening={opening} onClose={closeLogin} />
      )}
    </AuthContext.Provider>
  );
}
