import { useCallback, useEffect, useRef, useState } from "react";

export function useUnsavedGuard(dirty: boolean, busy: boolean) {
  const [destination, setDestination] = useState<string | null>(null);
  const accepted = useRef(false);
  const currentURL = useRef("");
  useEffect(() => {
    currentURL.current = window.location.href;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if ((dirty || busy) && !accepted.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const click = (event: MouseEvent) => {
      if (
        (!dirty && !busy) ||
        accepted.current ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const anchor = (
        event.target as Element | null
      )?.closest<HTMLAnchorElement>("a[href]");
      if (
        !anchor ||
        anchor.hasAttribute("download") ||
        anchor.target === "_blank"
      )
        return;
      const url = new URL(anchor.href, window.location.href);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        (url.pathname === window.location.pathname &&
          url.search === window.location.search &&
          url.hash)
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      if (!busy) setDestination(url.href);
    };
    const pop = () => {
      if ((!dirty && !busy) || accepted.current) return;
      const attempted = window.location.href;
      window.history.pushState(null, "", currentURL.current);
      if (!busy) setDestination(attempted);
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", click, true);
    window.addEventListener("popstate", pop);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", click, true);
      window.removeEventListener("popstate", pop);
    };
  }, [dirty, busy]);
  const leave = useCallback(() => {
    if (!destination) return;
    accepted.current = true;
    window.location.assign(destination);
  }, [destination]);
  return { destination, cancel: () => setDestination(null), leave };
}
