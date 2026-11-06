import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { fmt, type Dictionary } from "@/lib/i18n";
import type { RowIssue } from "@/lib/portfolio/import/validate";

/** Validation results of one import row, in the user's language. */
export function IssueList({ issues, dict }: { issues: RowIssue[]; dict: Dictionary }) {
  const h = dict.holdings;
  if (!issues.length)
    return (
      <span className="inline-flex items-center gap-1 text-xs text-positive">
        <CheckCircle2 className="size-3.5" /> {h.import.ok}
      </span>
    );
  return (
    <ul className="flex flex-col gap-0.5 text-xs whitespace-normal">
      {issues.map((i, k) => {
        const params: Record<string, string | number> = { ...(i.params ?? {}), field: i.field ? h.fields[i.field] : "" };
        const text = fmt(h.issues[i.code] ?? i.code, params);
        return (
          <li key={k} className={i.severity === "ERROR" ? "flex gap-1 text-negative" : "flex gap-1 text-warning"} data-issue={i.code}>
            {i.severity === "ERROR" ? <XCircle className="mt-0.5 size-3.5 shrink-0" /> : <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />}
            <span>{text}</span>
          </li>
        );
      })}
    </ul>
  );
}
