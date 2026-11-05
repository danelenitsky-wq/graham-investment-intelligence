import { cn } from "@/lib/utils";
import { MISSING } from "@/lib/format";

/**
 * Numeric text isolated as LTR so signs, currency symbols and separators keep
 * their order inside Hebrew (RTL) sentences.
 */
export function Num({ children, className, tone }: { children: string; className?: string; tone?: "auto" | "positive" | "negative" | "muted"; }) {
  const missing = children === MISSING;
  return (
    <bdi dir="ltr" className={cn("num font-mono", missing && "text-muted-foreground", tone === "positive" && "text-positive", tone === "negative" && "text-negative", tone === "muted" && "text-muted-foreground", className)}>
      {children}
    </bdi>
  );
}

export function signTone(v: number | null | undefined): "positive" | "negative" | "muted" {
  if (v === null || v === undefined || v === 0) return "muted";
  return v > 0 ? "positive" : "negative";
}
