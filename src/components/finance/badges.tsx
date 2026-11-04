import { AlertTriangle, CheckCircle2, CircleDashed, Clock, FlaskConical, MinusCircle, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Dictionary } from "@/lib/i18n";
import type { RuleStatus } from "@/lib/graham/types";
import type { FreshnessLevel } from "@/lib/freshness";
import type { EstimateStatus } from "@/lib/valuation/graham";

export function StatusBadge({ status, dict }: { status: RuleStatus | EstimateStatus; dict: Dictionary }) {
  const label = dict.common.status[status];
  switch (status) {
    case "PASS":
    case "OK":
      return (
        <Badge variant="positive">
          <CheckCircle2 /> {label}
        </Badge>
      );
    case "FAIL":
      return (
        <Badge variant="negative">
          <XCircle /> {label}
        </Badge>
      );
    case "INSUFFICIENT_DATA":
      return (
        <Badge variant="warning">
          <CircleDashed /> {label}
        </Badge>
      );
    default:
      return (
        <Badge variant="muted">
          <MinusCircle /> {label}
        </Badge>
      );
  }
}

export function MethodologyBadge({ methodology, dict }: { methodology: "GRAHAM_1973" | "GRAHAM_DERIVED" | "MODERN_EXTENSION"; dict: Dictionary }) {
  return (
    <Badge variant={methodology === "MODERN_EXTENSION" ? "info" : "outline"} className="font-normal">
      {dict.common.methodology[methodology]}
    </Badge>
  );
}

export function FreshnessBadge({ level, dict, label }: { level: FreshnessLevel; dict: Dictionary; label?: string }) {
  const variant = level === "FRESH" ? "positive" : level === "AGING" ? "warning" : level === "STALE" ? "negative" : "muted";
  return (
    <Badge variant={variant}>
      <Clock /> {label ? `${label}: ` : ""}
      {dict.common.freshness[level]}
    </Badge>
  );
}

export function DevFixtureBadge({ dict }: { dict: Dictionary }) {
  return (
    <Badge variant="warning">
      <FlaskConical /> {dict.common.devFixtureShort}
    </Badge>
  );
}

export function DevFixtureBanner({ dict }: { dict: Dictionary }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg border border-warning/50 bg-warning/12 px-4 py-3 text-sm font-medium text-warning">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <span>{dict.common.devFixtureBanner}</span>
    </div>
  );
}
