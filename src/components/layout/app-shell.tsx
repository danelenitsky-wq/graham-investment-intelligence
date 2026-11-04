import { Suspense } from "react";
import { Brand } from "./brand";
import { LocaleSwitcher } from "./locale-switcher";
import { MobileNav } from "./mobile-nav";
import { SecuritySearch } from "./security-search";
import { SidebarNav } from "./sidebar-nav";
import { ThemeToggle } from "./theme-toggle";

/** Application frame: fixed sidebar on the inline-start side (right in RTL), sticky top bar. */
export function AppShell({ children, footer }: { children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-e border-sidebar-border bg-sidebar lg:flex">
        <div className="flex h-14 items-center border-b border-sidebar-border px-4">
          <Brand />
        </div>
        <div className="flex-1 overflow-y-auto">
          <Suspense>
            <SidebarNav />
          </Suspense>
        </div>
        <div className="border-t border-sidebar-border px-4 py-3 text-[11px] leading-snug text-muted-foreground">{footer}</div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/70 sm:px-5">
          <Suspense>
            <MobileNav />
          </Suspense>
          <div className="flex flex-1 justify-start">
            <SecuritySearch />
          </div>
          <Suspense>
            <LocaleSwitcher />
          </Suspense>
          <ThemeToggle />
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-3 py-5 sm:px-6 sm:py-6">{children}</main>
      </div>
    </div>
  );
}
