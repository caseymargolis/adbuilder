import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Adwise — Meta Ads, minus the guessing",
  description:
    "Plug in a website. Get data-backed ads, launch them, and keep them tuned. With a chat companion that doesn't talk like a LinkedIn post.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="border-b border-[color:var(--line)] bg-[color:var(--bg)]/80 backdrop-blur sticky top-0 z-30">
          <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
            <Link href="/" className="font-display text-xl font-semibold">
              Adwise<span className="text-[color:var(--terracotta)]">.</span>
            </Link>
            <nav className="flex items-center gap-5 text-sm">
              <Link href="/clients" className="hover:underline">Clients</Link>
              <Link href="/clients/new" className="btn btn-primary">+ New client</Link>
            </nav>
          </div>
        </header>
        <main className="max-w-6xl mx-auto px-6 py-8">{children}</main>
        <footer className="max-w-6xl mx-auto px-6 pb-10 pt-4 text-xs text-[color:var(--muted)]">
          Adwise · For humans who'd rather not read a Meta docs page tonight.
        </footer>
      </body>
    </html>
  );
}
