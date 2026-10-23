import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Download,
  Loader2,
  MoreHorizontal,
  ShieldOff,
  Trash2,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";

import {
  TableBulkActions,
  TableFilterBar,
  TableFilterSelect,
  TablePagination,
  TableRowSelect,
  TableSearchField,
  TableSelectionBar,
} from "@/components/shared/TableFilters";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import {
  deleteCampaignSuppressionsFromSystem,
  listCampaignSuppressions,
  removeCampaignSuppressions,
  type CampaignSuppressionReason,
  type CampaignSuppressionRecord,
} from "@/lib/contacts";
import { cn } from "@/lib/utils";
import { useTableSelection } from "@/hooks/use-table-selection";

const PAGE_SIZE = 8;

const reasonLabels: Record<CampaignSuppressionReason, string> = {
  unsubscribe: "Unsubscribed",
  bounce: "Bounce",
  complaint: "Complaint",
  manual: "Manual",
};

const reasonClasses: Record<CampaignSuppressionReason, string> = {
  unsubscribe: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300",
  bounce: "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-900/50 dark:bg-orange-950/30 dark:text-orange-300",
  complaint: "border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300",
  manual: "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-300",
};

const formatDate = (value: string) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
};

export function CampaignSuppressionsPanel({ userId }: { userId: string }) {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [reason, setReason] = useState<CampaignSuppressionReason | "all">(
    "all",
  );
  const [removeTargets, setRemoveTargets] = useState<
    CampaignSuppressionRecord[] | null
  >(null);
  const [systemDeleteTargets, setSystemDeleteTargets] = useState<
    CampaignSuppressionRecord[] | null
  >(null);
  const [removing, setRemoving] = useState(false);
  const [deletingFromSystem, setDeletingFromSystem] = useState(false);
  const [exporting, setExporting] = useState(false);

  const query = useQuery({
    queryKey: ["campaign-suppressions", userId, page, search, reason],
    queryFn: () =>
      listCampaignSuppressions(userId, {
        page,
        pageSize: PAGE_SIZE,
        search,
        reason,
      }),
    staleTime: 10_000,
    refetchOnWindowFocus: "always",
  });

  const data = query.data;
  const rows = data?.rows || [];
  const selection = useTableSelection(rows.map((row) => row.id));
  const selectedRows = rows.filter((row) =>
    selection.selectedVisibleIds.includes(row.id),
  );

  useEffect(() => {
    setPage(1);
  }, [reason, search]);

  useEffect(() => {
    if (data && page > data.pageCount) setPage(data.pageCount);
  }, [data, page]);

  const requestRemoval = (targets: CampaignSuppressionRecord[]) => {
    if (!targets.length) return;
    setRemoveTargets(targets);
  };

  const requestSystemDeletion = (targets: CampaignSuppressionRecord[]) => {
    if (!targets.length) return;
    setSystemDeleteTargets(targets);
  };

  const confirmRemoval = async () => {
    if (!removeTargets?.length) return;
    setRemoving(true);
    try {
      const result = await removeCampaignSuppressions(
        userId,
        removeTargets.map((target) => target.id),
      );
      toast.success(
        `${result.removed} suppression${result.removed === 1 ? "" : "s"} removed${result.resubscribed ? ` · ${result.resubscribed} contact${result.resubscribed === 1 ? "" : "s"} eligible again` : ""}.`,
      );
      setRemoveTargets(null);
      selection.clearSelection();
      await queryClient.invalidateQueries({
        queryKey: ["campaign-suppressions", userId],
      });
      await queryClient.invalidateQueries({
        queryKey: ["campaigns", userId],
      });
      await queryClient.invalidateQueries({
        queryKey: ["campaign-overview", userId],
      });
      await queryClient.invalidateQueries({
        queryKey: ["campaign-email-workspace", userId],
      });
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "The suppression could not be removed.",
      );
    } finally {
      setRemoving(false);
    }
  };

  const confirmSystemDeletion = async () => {
    if (!systemDeleteTargets?.length) return;
    setDeletingFromSystem(true);
    try {
      const result = await deleteCampaignSuppressionsFromSystem(
        userId,
        systemDeleteTargets.map((target) => target.id),
      );
      toast.success(
        `${result.contactsDeleted} contact${result.contactsDeleted === 1 ? "" : "s"} deleted from the system${result.removed ? ` Â· ${result.removed} suppression${result.removed === 1 ? "" : "s"} removed` : ""}.`,
      );
      setSystemDeleteTargets(null);
      selection.clearSelection();
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["campaign-suppressions", userId],
        }),
        queryClient.invalidateQueries({ queryKey: ["campaigns", userId] }),
        queryClient.invalidateQueries({
          queryKey: ["campaign-overview", userId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["campaign-email-workspace", userId],
        }),
        queryClient.invalidateQueries({ queryKey: ["contacts"] }),
        queryClient.invalidateQueries({ queryKey: ["contact-lists"] }),
      ]);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "The contact could not be deleted from the system.",
      );
    } finally {
      setDeletingFromSystem(false);
    }
  };

  const exportCurrentList = async () => {
    setExporting(true);
    try {
      const exportSearch = search;
      const exportReason = reason;
      const exportedRows: CampaignSuppressionRecord[] = [];
      let exportPage = 1;
      let pageCount = 1;

      do {
        const result = await listCampaignSuppressions(userId, {
          page: exportPage,
          pageSize: 50,
          search: exportSearch,
          reason: exportReason,
        });
        exportedRows.push(...result.rows);
        pageCount = result.pageCount;
        exportPage += 1;
        if (exportPage > 10_000) {
          throw new Error("The export is too large to generate in the browser.");
        }
      } while (exportPage <= pageCount);

      const csvCell = (value: unknown) =>
        `"${String(value ?? "").replace(/"/g, '""')}"`;
      const lines = [
        [
          "Recipient",
          "Contact",
          "Reason",
          "Details",
          "Source campaign",
          "Added",
        ].map(csvCell),
        ...exportedRows.map((row) =>
          [
            row.recipient,
            row.contactName,
            reasonLabels[row.reason],
            row.reasonDetail,
            row.sourceCampaignName,
            row.createdAt,
          ].map(csvCell),
        ),
      ];
      const blob = new Blob([`\uFEFF${lines.map((line) => line.join(",")).join("\r\n")}`], {
        type: "text/csv;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `suppressed-contacts-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      toast.success(
        `${exportedRows.length.toLocaleString()} suppression record${exportedRows.length === 1 ? "" : "s"} exported.`,
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "The suppression list could not be exported.",
      );
    } finally {
      setExporting(false);
    }
  };

  const counts = data?.counts || {
    all: 0,
    unsubscribe: 0,
    bounce: 0,
    complaint: 0,
    manual: 0,
  };

  return (
    <section className="space-y-5">
      <header className="flex flex-col gap-4 rounded-2xl border border-border bg-card px-5 py-5 shadow-sm sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-primary">
            <ShieldOff className="h-4 w-4" />
            <span className="text-[10px] font-semibold uppercase tracking-[.12em]">
              Delivery protection
            </span>
          </div>
          <h2 className="mt-2 text-[20px] font-semibold tracking-tight">
            Unsubscribed &amp; suppressed
          </h2>
          <p className="mt-1 max-w-2xl text-[12px] leading-5 text-muted-foreground">
            Review every address blocked from workspace email. Removing a
            record restores eligibility only after you have permission or
            confirmed consent to contact that person again.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 rounded-lg text-[11px]"
            onClick={() => void exportCurrentList()}
            disabled={exporting || query.isLoading}
          >
            {exporting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            {exporting ? "Preparing…" : "Export CSV"}
          </Button>
          <div className="flex items-center gap-2 rounded-xl border border-primary/15 bg-primary/[.05] px-3 py-2 text-[11px] text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-primary" />
            <span>Sending checks this list automatically</span>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
        {(
          [
            ["All blocked", counts.all, "all"],
            ["Unsubscribed", counts.unsubscribe, "unsubscribe"],
            ["Bounces", counts.bounce, "bounce"],
            ["Complaints", counts.complaint, "complaint"],
            ["Manual", counts.manual, "manual"],
          ] as const
        ).map(([label, value, key]) => (
          <button
            key={key}
            type="button"
            onClick={() => setReason(key)}
            className={cn(
              "rounded-xl border bg-card px-4 py-3 text-left transition-colors hover:border-primary/35 hover:bg-primary/[.03]",
              reason === key && "border-primary/45 bg-primary/[.06]",
            )}
          >
            <p className="text-[10px] font-medium text-muted-foreground">
              {label}
            </p>
            <p className="mt-1 text-[20px] font-semibold tracking-tight">
              {value.toLocaleString()}
            </p>
          </button>
        ))}
      </div>

      <TableFilterBar label="Suppression filters">
        <TableSearchField
          value={search}
          onValueChange={setSearch}
          placeholder="Search email, contact, or campaign"
          aria-label="Search suppressions"
          disabled={query.isFetching && !data}
        />
        <TableFilterSelect
          value={reason}
          onValueChange={(value) =>
            setReason(value as CampaignSuppressionReason | "all")
          }
          label="Filter suppressions by reason"
          options={[
            { value: "all", label: "All reasons" },
            { value: "unsubscribe", label: "Unsubscribed" },
            { value: "bounce", label: "Bounces" },
            { value: "complaint", label: "Complaints" },
            { value: "manual", label: "Manual" },
          ]}
        />
      </TableFilterBar>

      <TableSelectionBar
        totalCount={rows.length}
        selectedCount={selection.selectedVisibleIds.length}
        allSelected={selection.allSelected}
        partiallySelected={selection.partiallySelected}
        onToggleAll={selection.toggleAll}
        onClear={selection.clearSelection}
        itemLabel="suppression records"
      >
        <TableBulkActions
          actions={[
            {
              key: "remove",
              label: "Remove from suppression list",
              icon: <Trash2 className="h-3.5 w-3.5" />,
              destructive: true,
              disabled: removing,
              onSelect: () => requestRemoval(selectedRows),
            },
            {
              key: "delete-from-system",
              label: "Delete from system",
              icon: <Trash2 className="h-3.5 w-3.5" />,
              destructive: true,
              separatorBefore: true,
              disabled: deletingFromSystem,
              onSelect: () => requestSystemDeletion(selectedRows),
            },
          ]}
        />
      </TableSelectionBar>

      {query.isError ? (
        <div className="flex items-start gap-3 rounded-xl border border-destructive/25 bg-destructive/[.04] px-4 py-4 text-[12px] text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">Suppression records could not load</p>
            <p className="mt-1 leading-5 opacity-85">
              {query.error instanceof Error
                ? query.error.message
                : "Refresh the page and try again."}
            </p>
          </div>
        </div>
      ) : query.isLoading ? (
        <div className="space-y-2 rounded-xl border border-border p-4">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-12 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="flex min-h-[280px] flex-col items-center justify-center rounded-2xl border border-dashed border-border px-6 py-12 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600">
            <CheckCircle2 className="h-5 w-5" />
          </span>
          <h3 className="mt-4 text-[14px] font-semibold">
            {search || reason !== "all"
              ? "No matching suppression records"
              : "Your suppression list is clear"}
          </h3>
          <p className="mt-2 max-w-md text-[11px] leading-5 text-muted-foreground">
            {search || reason !== "all"
              ? "Try a different search or reason filter."
              : "Addresses that unsubscribe, bounce, or complain will appear here automatically."}
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
            <table className="min-w-[900px] w-full text-left">
              <thead className="border-b border-border bg-muted/25">
                <tr className="text-[10px] font-semibold uppercase tracking-[.08em] text-muted-foreground">
                  <th className="w-12 px-3 py-3" aria-label="Select" />
                  <th className="px-3 py-3">Recipient</th>
                  <th className="px-3 py-3">Reason</th>
                  <th className="px-3 py-3">Details</th>
                  <th className="px-3 py-3">Source campaign</th>
                  <th className="px-3 py-3">Added</th>
                  <th className="w-16 px-3 py-3" aria-label="Actions" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row) => (
                  <tr key={row.id} className="group align-top transition-colors hover:bg-muted/20">
                    <td className="px-3 py-3">
                      <TableRowSelect
                        checked={selection.isSelected(row.id)}
                        onCheckedChange={(checked) =>
                          selection.toggle(row.id, checked)
                        }
                        label={`Select ${row.recipient}`}
                      />
                    </td>
                    <td className="max-w-[250px] px-3 py-3">
                      <div className="flex min-w-0 items-start gap-2.5">
                        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                          <UserRound className="h-3.5 w-3.5" />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-[12px] font-semibold">
                            {row.contactName || row.recipient}
                          </p>
                          <p className="truncate text-[11px] text-muted-foreground">
                            {row.recipient}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <Badge
                        variant="outline"
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                          reasonClasses[row.reason],
                        )}
                      >
                        {reasonLabels[row.reason]}
                      </Badge>
                    </td>
                    <td className="max-w-[250px] px-3 py-3 text-[11px] leading-5 text-muted-foreground">
                      <span className="line-clamp-2">
                        {row.reasonDetail || "No additional details"}
                      </span>
                    </td>
                    <td className="max-w-[190px] px-3 py-3 text-[11px] text-muted-foreground">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate">
                          {row.sourceCampaignName || "Workspace email"}
                        </span>
                        {row.sourceCampaignName ? (
                          <ChevronRight className="h-3 w-3 shrink-0 opacity-50" />
                        ) : null}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-[11px] text-muted-foreground">
                      {formatDate(row.createdAt)}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            disabled={removing || deletingFromSystem}
                            aria-label={`Actions for ${row.recipient}`}
                            title="Suppression actions"
                          >
                            <MoreHorizontal className="h-3.5 w-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="end"
                      className="min-w-56 rounded-xl border-border/80 bg-popover/95 p-1.5 shadow-xl"
                    >
                      <DropdownMenuItem
                        onClick={() => requestRemoval([row])}
                        className="gap-2 rounded-lg px-2.5 py-2 text-[11px] font-medium"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Remove from suppression list
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => requestSystemDeletion([row])}
                        className="gap-2 rounded-lg px-2.5 py-2 text-[11px] font-medium text-destructive focus:bg-destructive/10 focus:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete from system
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <TablePagination
            page={data?.page || page}
            pageCount={data?.pageCount || 1}
            pageSize={PAGE_SIZE}
            totalCount={data?.total || 0}
            onPageChange={setPage}
            itemLabel="suppression records"
          />
        </>
      )}

      <Dialog
        open={Boolean(removeTargets)}
        onOpenChange={(open) => {
          if (!open && !removing) setRemoveTargets(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Remove from suppression list?</DialogTitle>
            <DialogDescription>
              This removes {removeTargets?.length || 0} suppression record
              {removeTargets?.length === 1 ? "" : "s"}. The address can become
              eligible for future email again if no other suppression remains.
              The CRM contact and its email remain in the system.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-[11px] leading-5 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
            Removing an unsubscribe, bounce, or complaint is an intentional
            compliance decision. It does not send an email by itself.
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={removing}
              onClick={() => setRemoveTargets(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={removing}
              onClick={() => void confirmRemoval()}
            >
              {removing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Remove from list
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(systemDeleteTargets)}
        onOpenChange={(open) => {
          if (!open && !deletingFromSystem) setSystemDeleteTargets(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete from system?</DialogTitle>
            <DialogDescription>
              This permanently deletes {systemDeleteTargets?.length || 0} CRM
              contact{systemDeleteTargets?.length === 1 ? "" : "s"}, their list
              memberships and suppression record. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-xl border border-destructive/25 bg-destructive/[.05] px-3 py-3 text-[11px] leading-5 text-destructive">
            Campaign delivery history and analytics are kept for reporting, but
            the contact profile itself will no longer exist in the CRM.
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={deletingFromSystem}
              onClick={() => setSystemDeleteTargets(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deletingFromSystem}
              onClick={() => void confirmSystemDeletion()}
            >
              {deletingFromSystem ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Delete from system
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
