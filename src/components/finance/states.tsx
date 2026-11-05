import { AlertOctagon, DatabaseZap, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

/** Explicit "no data" state: says what is missing and how to get it, never shows placeholder numbers. */
export function EmptyState({
  icon: Icon = DatabaseZap,
  title,
  body,
  action,
  className,
  compact,
}: {
  icon?: LucideIcon;
  title: string;
  body?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-center", compact ? "px-4 py-6" : "px-6 py-12", className)}>
      <Icon className={cn("text-muted-foreground", compact ? "size-5" : "size-8")} />
      <div className="text-sm font-medium">{title}</div>
      {body && <div className="max-w-md text-sm text-muted-foreground">{body}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ title, body, action }: { title: string; body?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center gap-2 rounded-lg border border-negative/40 bg-negative/5 px-6 py-12 text-center">
      <AlertOctagon className="size-8 text-negative" />
      <div className="text-sm font-semibold">{title}</div>
      {body && <div className="max-w-lg text-sm text-muted-foreground">{body}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function CardsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-24 rounded-xl" />
      ))}
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-4 w-96 max-w-full" />
      <CardsSkeleton />
      <Skeleton className="h-72 rounded-xl" />
      <Skeleton className="h-48 rounded-xl" />
    </div>
  );
}
