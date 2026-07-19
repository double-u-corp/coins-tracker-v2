import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/features/auth/useAuth";

const PUBLIC_NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/calendar", label: "Calendar" },
  { href: "/chart", label: "Chart" },
];

const PROTECTED_NAV_LINKS = [
  { href: "/trade", label: "Buy / Sell" },
  { href: "/manage", label: "Manage Coins" },
];

export default function Layout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { authenticated, loading, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  const navLinks = authenticated ? [...PUBLIC_NAV_LINKS, ...PROTECTED_NAV_LINKS] : PUBLIC_NAV_LINKS;

  // Close the mobile menu automatically whenever the route changes.
  useEffect(() => {
    const handleRouteChange = () => setMenuOpen(false);
    router.events.on("routeChangeStart", handleRouteChange);
    return () => router.events.off("routeChangeStart", handleRouteChange);
  }, [router.events]);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <span className="text-lg font-bold text-gray-900">Coins Tracker</span>

          {/* Desktop nav */}
          <div className="hidden items-center gap-2 md:flex">
            <ul className="flex flex-wrap gap-1">
              {navLinks.map((link) => {
                const isActive = router.pathname === link.href;
                return (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                        isActive ? "bg-brand-600 text-white" : "text-gray-600 hover:bg-gray-100"
                      }`}
                    >
                      {link.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
            {!loading && (
              <button
                type="button"
                onClick={() => (authenticated ? logout() : router.push("/login"))}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
              >
                {authenticated ? "Log out" : "Log in"}
              </button>
            )}
          </div>

          {/* Mobile hamburger button */}
          <button
            type="button"
            onClick={() => setMenuOpen((prev) => !prev)}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            className="flex h-10 w-10 items-center justify-center rounded-md border border-gray-300 text-gray-600 md:hidden"
          >
            {menuOpen ? (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" />
              </svg>
            )}
          </button>
        </nav>

        {/* Mobile nav panel */}
        {menuOpen && (
          <div className="border-t border-gray-200 bg-white px-4 pb-4 md:hidden">
            <ul className="flex flex-col gap-1 pt-2">
              {navLinks.map((link) => {
                const isActive = router.pathname === link.href;
                return (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className={`block rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                        isActive ? "bg-brand-600 text-white" : "text-gray-600 hover:bg-gray-100"
                      }`}
                    >
                      {link.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
            {!loading && (
              <button
                type="button"
                onClick={() => (authenticated ? logout() : router.push("/login"))}
                className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-left text-sm font-medium text-gray-600 hover:bg-gray-100"
              >
                {authenticated ? "Log out" : "Log in"}
              </button>
            )}
          </div>
        )}
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
