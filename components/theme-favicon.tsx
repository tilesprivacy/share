"use client";

import { useEffect } from "react";

const BUST = "v=20260413";

function upsertIconLink(
  marker: string,
  attrs: { rel: string; type?: string; sizes?: string; href: string },
) {
  let el = document.querySelector<HTMLLinkElement>(
    `link[data-tiles-theme-icon="${marker}"]`,
  );
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("data-tiles-theme-icon", marker);
    document.head.prepend(el);
  }
  el.rel = attrs.rel;
  if (attrs.type) el.type = attrs.type;
  if (attrs.sizes) el.setAttribute("sizes", attrs.sizes);
  el.href = attrs.href;
}

function applyThemeIcons(isDark: boolean) {
  const svg = isDark ? `/icon-mark-light.svg?${BUST}` : `/icon-mark-dark.svg?${BUST}`;
  const png96 = isDark ? `/icon-light-96x96.png?${BUST}` : `/icon-dark-96x96.png?${BUST}`;
  const png32 = isDark ? `/icon-light-32x32.png?${BUST}` : `/icon-dark-32x32.png?${BUST}`;

  // Prepend order (last created ends up first): shortcut -> 32 -> 96 -> svg.
  upsertIconLink("shortcut", { rel: "shortcut icon", type: "image/png", href: png32 });
  upsertIconLink("32", { rel: "icon", type: "image/png", sizes: "32x32", href: png32 });
  upsertIconLink("96", { rel: "icon", type: "image/png", sizes: "96x96", href: png96 });
  upsertIconLink("svg", { rel: "icon", type: "image/svg+xml", href: svg });
}

export function ThemeFavicon() {
  useEffect(() => {
    const root = document.documentElement;
    applyThemeIcons(root.classList.contains("dark"));

    const observer = new MutationObserver(() => {
      applyThemeIcons(root.classList.contains("dark"));
    });
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return null;
}
