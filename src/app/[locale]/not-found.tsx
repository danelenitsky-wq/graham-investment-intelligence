"use client";
import Link from "next/link";
import { SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/finance/states";
import { useI18n } from "@/components/layout/providers";
import { href } from "@/lib/i18n/paths";

export default function NotFound() {
  const { dict, locale } = useI18n();
  return (
    <EmptyState
      icon={SearchX}
      title={dict.common.notFoundTitle}
      body={dict.common.notFoundBody}
      action={
        <Button asChild variant="outline">
          <Link href={href(locale, "/")}>{dict.common.backHome}</Link>
        </Button>
      }
    />
  );
}
