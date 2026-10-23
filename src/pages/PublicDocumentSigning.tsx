import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  CheckCircle2,
  FileCheck2,
  Loader2,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";
import { useParams } from "react-router-dom";

import { BrandLogo } from "@/components/BrandLogo";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  completePublicSignature,
  getPublicSigningSession,
} from "@/lib/files-documents";

const blockContent = (value: unknown) =>
  typeof value === "string" ? value : "";

export default function PublicDocumentSigning() {
  const { signingToken = "" } = useParams<{ signingToken: string }>();
  const [signature, setSignature] = useState("");
  const [consent, setConsent] = useState(false);
  const [completed, setCompleted] = useState(false);
  const sessionQuery = useQuery({
    enabled: Boolean(signingToken),
    queryKey: ["public-document-signing", signingToken],
    queryFn: () => getPublicSigningSession(signingToken),
    retry: false,
  });
  const signMutation = useMutation({
    mutationFn: () =>
      completePublicSignature(signingToken, { consent, signature }),
    onSuccess: () => setCompleted(true),
  });
  const session = sessionQuery.data;

  if (sessionQuery.isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background">
        <Loader2
          className="h-6 w-6 animate-spin text-primary"
          aria-label="Loading document"
        />
      </div>
    );
  }

  if (sessionQuery.isError || !session) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background px-5">
        <div className="w-full max-w-[460px] rounded-2xl border border-border bg-card p-7 text-center shadow-xl dark:shadow-none">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
            <LockKeyhole className="h-5 w-5" />
          </span>
          <h1 className="mt-5 text-[20px] font-semibold text-foreground">
            Signing link unavailable
          </h1>
          <p className="mt-2 text-[12px] leading-6 text-muted-foreground">
            {sessionQuery.error instanceof Error
              ? sessionQuery.error.message
              : "This link is invalid, expired, or no longer active."}
          </p>
        </div>
      </div>
    );
  }

  if (session.completed || completed) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background px-5">
        <div className="w-full max-w-[500px] rounded-2xl border border-border bg-card p-7 text-center shadow-xl dark:shadow-none sm:p-10">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-7 w-7" />
          </span>
          <h1 className="mt-6 text-[23px] font-semibold text-foreground">
            Your action is complete
          </h1>
          <p className="mt-2 text-[12px] leading-6 text-muted-foreground">
            Your action for <strong>{session.document.title}</strong> has been
            recorded. The final copy will be issued when every required
            recipient has completed their step.
          </p>
          <BrandLogo
            className="mt-8 justify-center"
            markSize={18}
            wordmarkClassName="text-[13px]"
          />
        </div>
      </div>
    );
  }

  const activeSession = session as Extract<
    typeof session,
    { completed: false }
  >;
  const approving = activeSession.signer.role === "approver";
  return (
    <div className="min-h-dvh bg-muted/25 text-foreground">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex h-16 max-w-[1180px] items-center justify-between px-4 sm:px-7">
          <BrandLogo markSize={18} wordmarkClassName="text-[14px]" />
          <span className="inline-flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
            <LockKeyhole className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            Secure signing session
          </span>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1180px] gap-5 px-4 py-5 sm:px-7 sm:py-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="min-w-0 overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
          <div className="border-b border-border px-5 py-5 sm:px-7">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-primary">
              {activeSession.document.templateName || "Document"}
            </p>
            <h1 className="mt-2 text-[22px] font-semibold tracking-tight text-foreground sm:text-[28px]">
              {activeSession.document.title}
            </h1>
            {activeSession.document.description && (
              <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
                {activeSession.document.description}
              </p>
            )}
          </div>

          {activeSession.document.sourceType === "uploaded_pdf" &&
          activeSession.document.baseFile ? (
            <iframe
              src={activeSession.document.baseFile.url}
              title={activeSession.document.baseFile.name}
              className="h-[68dvh] min-h-[520px] w-full bg-white"
            />
          ) : (
            <article className="min-h-[540px] px-5 py-8 sm:px-10 sm:py-12">
              <div className="mx-auto max-w-[720px]">
                {activeSession.document.blocks.map((block, index) => {
                  const type = blockContent(block.type);
                  const content = blockContent(block.content);
                  if (type === "heading") {
                    return (
                      <h2
                        key={index}
                        className="mb-7 text-[24px] font-semibold leading-tight tracking-tight"
                      >
                        {content}
                      </h2>
                    );
                  }
                  if (type === "signature") {
                    return (
                      <div
                        key={index}
                        className="mt-12 border-t border-border pt-3 text-[10px] uppercase tracking-[0.12em] text-muted-foreground"
                      >
                        Electronic signature required
                      </div>
                    );
                  }
                  return (
                    <p
                      key={index}
                      className="mb-5 whitespace-pre-wrap text-[13px] leading-7 text-foreground/85"
                    >
                      {content}
                    </p>
                  );
                })}
              </div>
            </article>
          )}
        </section>

        <aside className="h-fit rounded-2xl border border-border bg-card p-5 shadow-xs sm:p-6 lg:sticky lg:top-6">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            {approving ? (
              <ShieldCheck className="h-4 w-4" />
            ) : (
              <FileCheck2 className="h-4 w-4" />
            )}
          </span>
          <h2 className="mt-5 text-[16px] font-semibold text-foreground">
            {approving ? "Approve this document" : "Sign this document"}
          </h2>
          <p className="mt-1.5 text-[11px] leading-5 text-muted-foreground">
            Acting as {activeSession.signer.name} ({activeSession.signer.email})
          </p>

          <label className="mt-6 block space-y-1.5">
            <span className="text-[11px] font-medium text-foreground">
              {approving ? "Typed approval" : "Type your full signature"}
            </span>
            <Input
              value={signature}
              onChange={(event) => setSignature(event.target.value)}
              placeholder={activeSession.signer.name}
              autoComplete="name"
              className="h-12 font-serif text-[17px] italic"
            />
          </label>

          <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-muted/30 p-3.5">
            <Checkbox
              checked={consent}
              onCheckedChange={(checked) => setConsent(checked === true)}
              className="mt-0.5"
            />
            <span className="text-[10.5px] leading-5 text-muted-foreground">
              {activeSession.disclosure}
            </span>
          </label>

          {signMutation.isError && (
            <p className="mt-4 rounded-lg bg-destructive/10 px-3 py-2.5 text-[10.5px] leading-5 text-destructive">
              {signMutation.error instanceof Error
                ? signMutation.error.message
                : "Your action could not be recorded."}
            </p>
          )}

          <Button
            type="button"
            className="mt-5 h-11 w-full"
            onClick={() => signMutation.mutate()}
            disabled={
              signature.trim().length < 2 ||
              !consent ||
              signMutation.isPending
            }
          >
            {signMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            {approving ? "Approve document" : "Complete signature"}
          </Button>

          <div className="mt-5 flex items-start gap-2 border-t border-border pt-4 text-[9px] leading-4 text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            Your consent, timestamp, and network address are recorded in the
            document audit trail.
          </div>
        </aside>
      </main>
    </div>
  );
}
