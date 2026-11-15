/** Login may resume only an application page on the configured Plan origin. */
export function safeLoginReturn(value: string | null | undefined): string {
  if (
    !value ||
    value.length > 2048 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\u0000-\u0020\u007f]/.test(value)
  )
    return "/";
  try {
    if (/[\\\u0000-\u001f\u007f]/.test(decodeURIComponent(value))) return "/";
    const url = new URL(value, "https://plan.yebom.org");
    if (
      url.origin !== "https://plan.yebom.org" ||
      !["/", "/annual", "/settings", "/share"].includes(url.pathname)
    )
      return "/";
    return url.pathname + url.search + url.hash;
  } catch {
    return "/";
  }
}

export function planLoginHref(entry: string, returnTo: string): string {
  const url = new URL(entry, "https://plan.yebom.org");
  url.searchParams.set("next", safeLoginReturn(returnTo));
  return entry.startsWith("/") ? url.pathname + url.search : url.href;
}
