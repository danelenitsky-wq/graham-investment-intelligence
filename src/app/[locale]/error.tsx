"use client";
import { useEffect } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/finance/states";
import { useI18n } from "@/components/layout/providers";

export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  const { dict } = useI18n();
  useEffect(() => {
    console.error(error);
  }, [error]);
  const message = error instanceof Error ? error.message : "";
  const isDb = /database|ECONNREFUSED|prisma|connect/i.test(message);
  return (
    <ErrorState
      title={dict.common.errorTitle}
      body={
        <>
          <p>{isDb ? dict.common.dbErrorBody : dict.common.errorBody}</p>
          {process.env.NODE_ENV !== "production" && message && <p className="mt-2 font-mono text-xs break-all" dir="ltr">{message}</p>}
        </>
      }
      action={
        <Button variant="outline" onClick={() => retry()}>
          <RotateCcw /> {dict.common.retry}
        </Button>
      }
    />
  );
}
