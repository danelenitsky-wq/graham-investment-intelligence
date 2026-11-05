"use client";
import { Menu } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useI18n } from "./providers";
import { SidebarNav } from "./sidebar-nav";
import { Brand } from "./brand";

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const { dict } = useI18n();
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label={dict.common.menu}>
          <Menu className="size-5" />
        </Button>
      </SheetTrigger>
      <SheetContent className="bg-sidebar">
        <SheetTitle className="sr-only">{dict.common.menu}</SheetTitle>
        <div className="border-b border-sidebar-border px-4 py-4">
          <Brand />
        </div>
        <SidebarNav onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
