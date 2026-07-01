import Link from "next/link";

const links = [
  { href: "/", label: "Pipeline" },
  { href: "/scoring", label: "Scorer Queue" },
  { href: "/vas", label: "VAs & Models" },
  { href: "/folders", label: "Folders" },
  { href: "/accounts", label: "Accounts" },
  { href: "/reports", label: "Reports" },
  { href: "/templates", label: "Templates" },
  { href: "/roles", label: "Roles" },
  { href: "/apply", label: "Apply ↗" },
];

export default function Nav() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-ink/80 backdrop-blur">
      <div className="mx-auto flex max-w-[1400px] items-center justify-between px-5 py-3">
        <Link href="/" className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-brand font-display text-sm font-bold text-white">
            S
          </span>
          <span className="font-display text-lg font-bold tracking-tight">
            SWIFT
            <span className="ml-2 text-xs font-normal text-muted">VA pipeline</span>
          </span>
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="rounded-lg px-3 py-1.5 text-gray-300 hover:bg-panel2 hover:text-white"
            >
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
