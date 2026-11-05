import { AlertTriangle, CheckCircle2, CircleDashed, Clock, FlaskConical, MinusCircle, Radio, ShieldAlert, ShieldCheck, ShieldQuestionMark, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Dictionary } from "@/lib/i18n";
import type { RuleStatus } from "@/lib/graham/types";
import type { FreshnessLevel } from "@/lib/freshness";
import type { QuoteStatus } from "@/lib/freshness/quote";
import type { VerificationStatus } from "@/lib/verification";
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

export function QuoteStatusBadge({ status, dict }: { status: QuoteStatus; dict: Dictionary }) {
  const variant = status === "LIVE" ? "positive" : status === "DELAYED" || status === "LAST_CLOSE" ? "info" : status === "CACHED" ? "warning" : status === "STALE" ? "negative" : "muted";
  return (
    <Badge variant={variant} title={dict.market.statusHelp[status]} data-quote-status={status}>
      {status === "LIVE" ? <Radio /> : <Clock />} {dict.market.status[status]}
    </Badge>
  );
}

export function VerificationBadge({ status, dict }: { status: VerificationStatus; dict: Dictionary }) {
  const variant = status === "VERIFIED" ? "positive" : status === "CONFLICT" ? "negative" : "muted";
  return (
    <Badge variant={variant} className="font-normal">
      {status === "VERIFIED" ? <ShieldCheck /> : status === "CONFLICT" ? <AlertTriangle /> : <ShieldQuestionMark />} {dict.market.verification[status]}
    </Badge>
  );
}

export function InsufficientDataBanner({ dict }: { dict: Dictionary }) {
  return (
    <div role="alert" data-testid="insufficient-verified-data" className="flex items-start gap-2 rounded-lg border border-negative/40 bg-negative/10 px-4 py-3 text-sm">
      <ShieldAlert className="mt-0.5 size-4 shrink-0 text-negative" />
      <div>
        <div className="font-semibold tracking-wide text-negative">{dict.health.insufficient}</div>
        <div className="text-foreground/80">{dict.health.insufficientBody}</div>
      </div>
    </div>
  );
}
