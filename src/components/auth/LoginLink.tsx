"use client";

import type { AnchorHTMLAttributes } from "react";
import { usePathname } from "next/navigation";
import { planLoginHref } from "@/domain/login";

/** One common login screen; keep the requested Plan page through authentication. */
export default function LoginLink({
  entry = "/api/auth/sso",
  returnTo,
  onClick,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & {
  entry?: string;
  returnTo?: string;
}) {
  const pathname = usePathname();
  return (
    <a
      {...props}
      href={planLoginHref(entry, returnTo ?? pathname)}
      ref={(anchor) => {
        if (anchor)
          anchor.href = planLoginHref(
            entry,
            returnTo ??
              window.location.pathname +
                window.location.search +
                window.location.hash,
          );
      }}
      onClick={(event) => {
        // Set the real query/hash before existing navigation guards inspect the link.
        event.currentTarget.href = planLoginHref(
          entry,
          returnTo ??
            window.location.pathname +
              window.location.search +
              window.location.hash,
        );
        onClick?.(event);
      }}
    />
  );
}
