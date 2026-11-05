"use client";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/** URL-synced tabs (?tab=…) so a specific view can be bookmarked and shared. */
export function AnalysisTabs({ items }: { items: { value: string; label: string; content: React.ReactNode }[] }) {
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const current = search.get("tab") ?? items[0].value;
  return (
    <Tabs
      value={items.some((i) => i.value === current) ? current : items[0].value}
      onValueChange={(v) => {
        const qs = new URLSearchParams(search.toString());
        qs.set("tab", v);
        router.replace(`${pathname}?${qs}`, { scroll: false });
      }}
    >
      <TabsList>
        {items.map((i) => (
          <TabsTrigger key={i.value} value={i.value}>
            {i.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {items.map((i) => (
        <TabsContent key={i.value} value={i.value}>
          {i.content}
        </TabsContent>
      ))}
    </Tabs>
  );
}
