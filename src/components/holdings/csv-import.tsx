"use client";
import { useState, useTransition } from "react";
import { Check, Download, FileUp, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Num } from "@/components/finance/num";
import { useI18n } from "@/components/layout/providers";
import { fmt } from "@/lib/i18n";
import { formatCurrency, formatNumber } from "@/lib/format";
import { IMPORT_TEMPLATE_CSV } from "@/lib/portfolio/import/sources";
import { commitCsvImportAction, previewCsvImportAction, type ImportPreviewResult } from "@/app/actions";
import { IssueList } from "./issue-list";

type PreviewData = Extract<ImportPreviewResult, { ok: true }>["data"];

/** CSV import: choose or paste → validated preview → explicit confirmation. Nothing is saved before the confirmation. */
export function CsvImport() {
  const { dict, locale } = useI18n();
  const t = dict.holdings.import;
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [data, setData] = useState<PreviewData | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();

  const preview = () =>
    start(async () => {
      setMessage(null);
      const r = await previewCsvImportAction(text, fileName);
      if (r.ok) setData(r.data!);
      else setMessage({ tone: "error", text: r.error });
    });
  const confirm = () =>
    start(async () => {
      if (!data) return;
      const r = await commitCsvImportAction(text, fileName, data.preview.contentHash);
      if (r.ok) {
        setMessage({ tone: "ok", text: fmt(t.imported, { n: r.data!.positions }) });
        setData(null);
        setText("");
        setFileName(null);
      } else setMessage({ tone: "error", text: r.code === "PREVIEW_OUTDATED" ? t.outdated : r.code === "HAS_ERRORS" ? t.blocked : r.error });
    });
  const template = `data:text/csv;charset=utf-8,${encodeURIComponent(IMPORT_TEMPLATE_CSV)}`;
  const p = data?.preview;

  return (
    <div className="flex flex-col gap-3" data-testid="csv-import">
      <p className="text-xs text-muted-foreground">{t.subtitle}</p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-muted">
          <FileUp className="size-4" /> {t.choose}
          <input
            type="file"
            accept=".csv,text/csv,text/plain"
            className="sr-only"
            data-testid="csv-file"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setFileName(file.name);
              setText(await file.text());
              setData(null);
            }}
          />
        </label>
        {fileName && <span className="font-mono text-xs">{fileName}</span>}
        <a href={template} download="holdings-template.csv" className="inline-flex items-center gap-1 text-xs underline underline-offset-2">
          <Download className="size-3.5" /> {t.template}
        </a>
      </div>
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setData(null);
        }}
        placeholder={t.orPaste}
        dir="ltr"
        rows={4}
        className="w-full rounded-md border bg-transparent p-2 font-mono text-xs"
        data-testid="csv-text"
      />
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={preview} disabled={pending || !text.trim()} data-testid="csv-preview">
          {pending ? <Loader2 className="animate-spin" /> : <FileUp />} {t.preview}
        </Button>
        {p && (
          <>
            <Button type="button" onClick={confirm} disabled={pending || !p.canCommit} data-testid="csv-confirm">
              <Check /> {fmt(t.confirm, { n: p.holdings.length })}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setData(null)} disabled={pending}>
              <X /> {t.cancel}
            </Button>
          </>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{t.pdfNote}</p>
      {message && <p className={message.tone === "ok" ? "text-sm text-positive" : "text-sm text-negative"}>{message.text}</p>}
      {data && p && (
        <div className="flex flex-col gap-2" data-testid="csv-preview-table">
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="outline">{fmt(t.rows, { rows: p.counts.rows, valid: p.counts.valid, errors: p.counts.errors, warnings: p.counts.warnings })}</Badge>
            <Badge variant="outline">{fmt(t.plan, { newPositions: p.counts.newPositions, merged: p.counts.mergedPositions, newSecurities: p.counts.newSecurities })}</Badge>
          </div>
          {data.sourceErrors.map((e, i) => (
            <p key={i} className="text-xs text-negative">
              {e.line ? `${e.line}: ` : ""}
              {e.message}
            </p>
          ))}
          {data.missingColumns.length > 0 && <p className="text-xs text-negative">{fmt(t.missingColumns, { columns: data.missingColumns.map((c) => dict.holdings.fields[c as keyof typeof dict.holdings.fields] ?? c).join(", ") })}</p>}
          {data.unmappedColumns.length > 0 && <p className="text-xs text-muted-foreground">{fmt(t.unmappedColumns, { columns: data.unmappedColumns.join(", ") })}</p>}
          {!p.canCommit && <p className="text-xs font-medium text-negative">{t.blocked}</p>}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.columns.line}</TableHead>
                <TableHead>{t.columns.security}</TableHead>
                <TableHead>{t.columns.type}</TableHead>
                <TableHead className="text-end">{t.columns.quantity}</TableHead>
                <TableHead className="text-end">{t.columns.price}</TableHead>
                <TableHead className="text-end">{t.columns.inMajor}</TableHead>
                <TableHead>{t.columns.date}</TableHead>
                <TableHead>{t.columns.issues}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {p.rows.map((r) => (
                <TableRow key={r.line} data-line={r.line}>
                  <TableCell className="font-mono text-xs">{r.line}</TableCell>
                  <TableCell className="font-mono text-xs" dir="ltr">
                    {(r.draft?.ticker ?? r.raw.ticker ?? "").toUpperCase()} · {r.draft?.exchange ?? r.raw.exchange}
                  </TableCell>
                  <TableCell className="text-xs">{r.draft ? dict.holdings.form.types[r.draft.securityType] : r.raw.securityType}</TableCell>
                  <TableCell className="text-end">
                    <Num>{r.draft ? formatNumber(locale, r.draft.quantity, r.draft.quantity % 1 ? 4 : 0) : (r.raw.quantity ?? "")}</Num>
                  </TableCell>
                  <TableCell className="text-end text-xs">
                    <Num>{r.draft ? `${formatNumber(locale, r.draft.enteredPrice, 2)} ${r.draft.priceUnit}` : `${r.raw.averagePrice ?? ""} ${r.raw.priceUnit ?? r.raw.currency ?? ""}`}</Num>
                  </TableCell>
                  <TableCell className="text-end">
                    <Num>{r.draft ? formatCurrency(locale, r.draft.averagePrice, r.draft.currency, 4) : "—"}</Num>
                  </TableCell>
                  <TableCell className="text-xs">
                    <Num>{r.draft?.purchaseDate ?? (r.raw.purchaseDate || "—")}</Num>
                  </TableCell>
                  <TableCell className="min-w-72">
                    <IssueList issues={r.issues} dict={dict} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
