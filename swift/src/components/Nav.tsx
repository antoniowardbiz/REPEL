"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Pipeline" },
  { href: "/review", label: "48h Review" },
  { href: "/conversations", label: "Conversations" },
  { href: "/scoring", label: "Scorer Queue" },
  { href: "/vas", label: "VAs & Models" },
  { href: "/links", label: "Links & Clicks" },
  { href: "/folders", label: "Folders" },
  { href: "/accounts", label: "Accounts" },
  { href: "/reports", label: "Reports" },
  { href: "/templates", label: "Templates" },
  { href: "/roles", label: "Roles" },
];

// Applicant-facing routes render their own standalone skin — no operator nav.
const HIDE_ON = ["/apply", "/training", "/playbook"];

export default function Nav() {
  const pathname = usePathname() || "/";
  if (HIDE_ON.some((p) => pathname === p || pathname.startsWith(p + "/"))) return null;

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-ink/85 backdrop-blur">
      <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-4 px-5 py-3">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-brand font-display text-sm text-white shadow-glow">
            S»
          </span>
          <span className="font-display text-lg tracking-wide">
            SWIFT
            <span className="ml-2 font-mono text-[10px] font-normal uppercase tracking-[0.14em] text-faint">
              VA · pipeline
            </span>
          </span>
        </Link>
        <nav className="flex flex-wrap items-center gap-0.5 font-mono text-[11px] uppercase tracking-[0.1em]">
          {links.map((l) => {
            const active = isActive(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-md px-2.5 py-1.5 transition ${
                  active ? "text-brand" : "text-muted hover:bg-panel2 hover:text-white"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
          <Link
            href="/apply"
            className="ml-1 rounded-md border border-line px-2.5 py-1.5 text-muted transition hover:border-brand/70 hover:text-white"
          >
            Apply ↗
          </Link>
        </nav>
      </div>
    </header>
  );
}
