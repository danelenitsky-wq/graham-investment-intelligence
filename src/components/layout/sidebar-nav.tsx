"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { href } from "@/lib/i18n/paths";
import { useI18n } from "./providers";
import { NAV_ITEMS } from "./nav-items";

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const { locale, dict } = useI18n();
  const pathname = usePathname();
  const rest = pathname.replace(/^\/(he|en)(?=\/|$)/, "") || "/";
  const sections = ["research", "holdings", "system"] as const;
  return (
    <nav className="flex flex-col gap-5 px-3 py-4" aria-label={dict.common.menu}>
      {sections.map((section) => (
        <div key={section} className="flex flex-col gap-0.5">
          <div className="px-2 pb-1 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">{dict.nav.sections[section]}</div>
          {NAV_ITEMS.filter((i) => i.section === section).map((item) => {
            const active = item.path === "/" ? rest === "/" : rest === item.path || rest.startsWith(item.path + "/");
            const Icon = item.icon;
            return (
              <Link
                key={item.key}
                href={href(locale, item.path)}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                  active && "bg-sidebar-accent font-medium text-sidebar-foreground",
                )}
              >
                <Icon className={cn("size-4 text-muted-foreground group-hover:text-foreground", active && "text-primary")} />
                {dict.nav[item.key]}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
