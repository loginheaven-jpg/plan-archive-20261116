"use client";

import type { AnchorHTMLAttributes } from "react";
import { useAuth } from "./AuthProvider";

/** Ordinary login never navigates, including callers that used a new-tab anchor. */
export default function LoginLink({
  children,
  className,
  title,
  id,
  style,
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
}: AnchorHTMLAttributes<HTMLAnchorElement> & {
  entry?: string;
  returnTo?: string;
}) {
  const { openLogin } = useAuth();
  return (
    <button
      type="button"
      className={className}
      title={title}
      id={id}
      style={style}
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
      aria-haspopup="dialog"
      onClick={openLogin}
    >
      {children}
    </button>
  );
}
