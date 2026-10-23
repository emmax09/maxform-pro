/**
 * All Campaigns tab.
 *
 * Duplicate is the intended way to run "this month's newsletter" from last
 * month's. Deletion is explicit and available from every campaign state; the
 * confirmation explains that a sent campaign's history will be removed too.
 */
import {
  Archive,
  BarChart3,
  Copy,
  CopyPlus,
  Loader2,
  MoreHorizontal,
  PauseCircle,
  Pencil,
  PlayCircle,
  Send,
  Trash2,
  Users,
} from "lucide-react";

import { useState } from "react";

import {
  TableBulkActions,
  TableFilterBar,
  TableFilterSelect,
  TablePagination,
  TableRowSelect,
  TableSelectionBar,
  TableSearchField,
} from "@/components/shared/TableFilters";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTablePagination } from "@/hooks/use-table-pagination";
import { useTableSelection } from "@/hooks/use-table-selection";
import type { CampaignSendProgress, ContactCampaign } from "@/lib/contacts";
import { cn } from "@/lib/utils";
import { VariableText } from "@/components/ui/variable-text";

import {
  campaignStatusClass,
  campaignStatusDot,
  campaignIsDue,
  formatCampaignDate,
  formatRate,
  hasSent,
  isEditable,
  sendStrategyLabels,
} from "./campaign-format";
import { CampaignCountdown } from "./CampaignCountdown";
import { CampaignProgressMeter } from "./CampaignSendProgress";
import { campaignCategoryLabels, campaignCategoryOf } from "./campaign-templates";

export function CampaignsTable({
  campaigns,
  sendProgress,
  categoryFilter,
  onArchive,
  onBulkArchive,
  onBulkDelete,
  onBulkPause,
  onBulkResume,
  onCategoryFilterChange,
  onDelete,
  onDuplicate,
  onDuplicateAndEdit,
  onEdit,
  onOpenAnalytics,
  onPause,
  onResume,
  onSearchChange,
  onSendNow,
  onSendTest,
  onStatusFilterChange,
  search,
  statusFilter,
  sendNowCampaignId,
  workspaceTimezone,
  working,
}: {
  campaigns: ContactCampaign[];
  sendProgress?: CampaignSendProgress;
  categoryFilter: string;
  onArchive: (campaign: ContactCampaign) => void;
  onBulkArchive: (campaigns: ContactCampaign[]) => void;
  onBulkDelete: (campaigns: ContactCampaign[]) => void;
  onBulkPause: (campaigns: ContactCampaign[]) => void;
  onBulkResume: (campaigns: ContactCampaign[]) => void;
  onCategoryFilterChange: (value: string) => void;
  onDelete: (campaign: ContactCampaign) => void;
  onDuplicate: (campaign: ContactCampaign) => void;
  /** Copies the campaign and opens the copy, for reusing a finished send. */
  onDuplicateAndEdit: (campaign: ContactCampaign) => void;
  onEdit: (campaign: ContactCampaign) => void;
  onOpenAnalytics: (campaign: ContactCampaign) => void;
  onPause: (campaign: ContactCampaign) => void;
  onResume: (campaign: ContactCampaign) => void;
  onSearchChange: (value: string) => void;
  onSendNow: (campaign: ContactCampaign) => void;
  onSendTest: (campaign: ContactCampaign) => void;
  onStatusFilterChange: (value: string) => void;
  search: string;
  statusFilter: string;
  sendNowCampaignId?: string | null;
  workspaceTimezone?: string;
  working: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());

  // Countdown components update their own small surfaces. The table clock only
  // advances once when a campaign becomes due, avoiding a full table rerender
  // every second while still locking edits at the exact boundary.

  const pagination = useTablePagination(
    campaigns,
    8,
    `${search}:${statusFilter}:${categoryFilter}`,
  );
  const selection = useTableSelection(campaigns.map((campaign) => campaign.id));
  const selectedCampaigns = campaigns.filter((campaign) =>
    selection.selectedVisibleIds.includes(campaign.id),
  );
  const runBulk = (handler: (items: ContactCampaign[]) => void) => {
    handler(selectedCampaigns);
    selection.clearSelection();
  };
  const canArchive = selectedCampaigns.some(
    (campaign) => campaign.status === "sent" || campaign.status === "cancelled",
  );
  const canDelete = selectedCampaigns.length > 0;
  const canPause = selectedCampaigns.some(
    (campaign) => campaign.status === "scheduled" || campaign.status === "sending",
  );
  const canResume = selectedCampaigns.some(
    (campaign) => campaign.status === "paused",
  );

  return (
    <div className="space-y-4">
      <TableFilterBar>
        <TableSearchField
          value={search}
          onValueChange={onSearchChange}
          placeholder="Search campaigns"
          aria-label="Search campaigns"
        />
        <TableFilterSelect
          value={statusFilter}
          onValueChange={onStatusFilterChange}
          label="Filter campaigns by status"
          options={[
            { value: "all", label: "All statuses" },
            { value: "draft", label: "Draft" },
            { value: "scheduled", label: "Scheduled" },
            { value: "sending", label: "Sending" },
            { value: "sent", label: "Sent" },
            { value: "paused", label: "Paused" },
            { value: "cancelled", label: "Cancelled" },
            { value: "archived", label: "Archived" },
          ]}
        />
        <TableFilterSelect
          value={categoryFilter}
          onValueChange={onCategoryFilterChange}
          label="Filter campaigns by category"
          options={[
            { value: "all", label: "All categories" },
            ...Object.entries(campaignCategoryLabels).map(([value, label]) => ({
              value,
              label,
            })),
          ]}
        />
      </TableFilterBar>

      <TableSelectionBar
        className="mt-3"
        totalCount={campaigns.length}
        selectedCount={selection.selectedVisibleIds.length}
        allSelected={selection.allSelected}
        partiallySelected={selection.partiallySelected}
        onToggleAll={selection.toggleAll}
        onClear={selection.clearSelection}
        itemLabel="campaigns"
      >
        <TableBulkActions
          actions={[
            {
              key: "archive",
              label: "Archive selected",
              icon: <Archive className="h-3.5 w-3.5" />,
              disabled: working || !canArchive,
              onSelect: () => runBulk(onBulkArchive),
            },
            {
              key: "pause",
              label: "Pause selected",
              icon: <PauseCircle className="h-3.5 w-3.5" />,
              disabled: working || !canPause,
              onSelect: () => runBulk(onBulkPause),
            },
            {
              key: "resume",
              label: "Resume selected",
              icon: <PlayCircle className="h-3.5 w-3.5" />,
              disabled: working || !canResume,
              onSelect: () => runBulk(onBulkResume),
            },
            {
              key: "delete",
              label: "Delete selected",
              icon: <Trash2 className="h-3.5 w-3.5" />,
              disabled: working || !canDelete,
              destructive: true,
              separatorBefore: true,
              onSelect: () => runBulk(onBulkDelete),
            },
          ]}
        />
      </TableSelectionBar>

      {pagination.pageItems.length ? (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="divide-y divide-border">
            {pagination.pageItems.map((campaign) => {
              const sent = Number(campaign.stats?.sent || 0);
              const liveProgress =
                sendProgress?.campaignId === campaign.id
                  ? sendProgress
                  : undefined;
              const progressTotal =
                liveProgress?.totalRecipients ||
                Number(campaign.stats?.recipients || 0);
              const progressSent = liveProgress?.sent ?? sent;
              const progressFailed =
                liveProgress?.failed ?? Number(campaign.stats?.failed || 0);
              const showProgress =
                (campaign.status === "sending" || campaign.status === "paused") &&
                progressTotal > 0;
              const due = campaignIsDue(campaign, now);
              const editable = isEditable(campaign);
              return (
                <article
                  key={campaign.id}
                  className="grid gap-4 px-4 py-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(140px,.6fr)_106px_minmax(190px,.7fr)_auto] xl:items-center"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <TableRowSelect
                        checked={selection.isSelected(campaign.id)}
                        onCheckedChange={(checked) =>
                          selection.toggle(campaign.id, checked)
                        }
                        label={`Select ${campaign.name}`}
                      />
                      <span
                        className={cn(
                          "h-2 w-2 shrink-0 rounded-full",
                          campaignStatusDot(campaign.status),
                        )}
                      />
                      <h3 className="truncate text-[12px] font-semibold">
                        {campaign.name}
                      </h3>
                      {campaign.aiGenerated ? (
                        <Badge
                          variant="outline"
                          className="shrink-0 text-[8px] uppercase tracking-wide"
                        >
                          AI draft
                        </Badge>
                      ) : null}
                    </div>
                    <VariableText
                      value={campaign.subject}
                      className="mt-1 block truncate text-[10px] text-muted-foreground"
                    />
                    <p className="mt-1 text-[9px] text-muted-foreground">
                      {campaignCategoryLabels[
                        campaignCategoryOf(campaign.category)
                      ]}{" "}
                      ·{" "}
                      {sendStrategyLabels[campaign.sendStrategy] ||
                        campaign.sendStrategy}
                    </p>
                  </div>

                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 truncate text-[10px] font-medium">
                      <Users className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      {campaign.audienceMode === "custom"
                        ? `Custom emails (${(campaign.customRecipients?.length ?? 0).toLocaleString()})`
                        : campaign.listName}
                    </p>
                    {campaign.excludeListName ? (
                      <p className="mt-1 truncate text-[9px] text-muted-foreground">
                        excluding {campaign.excludeListName}
                      </p>
                    ) : null}
                    <p className="mt-1 text-[9px] text-muted-foreground">
                      {formatCampaignDate(
                        campaign.sentAt || campaign.scheduledAt,
                        workspaceTimezone,
                      )}
                    </p>
                    {campaign.status === "scheduled" && campaign.scheduledAt ? (
                      <CampaignCountdown
                        scheduledAt={campaign.scheduledAt}
                        onDue={() => setNow(Date.now())}
                      />
                    ) : null}
                    {showProgress ? (
                      <div className="mt-2.5">
                        <CampaignProgressMeter
                          total={progressTotal}
                          sent={progressSent}
                          failed={progressFailed}
                          status={liveProgress?.status || campaign.status}
                          compact
                        />
                      </div>
                    ) : null}
                  </div>

                  <Badge
                    variant="outline"
                    className={cn(
                      "w-fit rounded-full capitalize",
                      campaignStatusClass(campaign.status),
                    )}
                  >
                    {campaign.status}
                  </Badge>

                  <div className="grid grid-cols-3 gap-3">
                    {[
                      {
                        label: "Sent",
                        value: sent.toLocaleString(),
                      },
                      {
                        label: "Open rate",
                        value: formatRate(
                          Number(campaign.stats?.opened || 0),
                          sent,
                        ),
                      },
                      {
                        label: "Click rate",
                        value: formatRate(
                          Number(campaign.stats?.clicked || 0),
                          sent,
                        ),
                      },
                    ].map((metric) => (
                      <div key={metric.label}>
                        <p className="text-[11px] font-semibold tabular-nums">
                          {metric.value}
                        </p>
                        <p className="mt-0.5 text-[8px] text-muted-foreground">
                          {metric.label}
                        </p>
                      </div>
                    ))}
                  </div>

                  {/* Safe, high-frequency actions stay on the card; secondary
                      actions remain behind the overflow menu. */}
                  <div className="flex items-center justify-end gap-1.5">
                    {editable || due ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8 text-[11px]"
                        aria-label={`Edit ${campaign.name}`}
                        title={
                          due
                            ? "This campaign is due now and is locked for sending."
                            : undefined
                        }
                        disabled={!editable || working}
                        onClick={() => onEdit(campaign)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Edit
                      </Button>
                    ) : null}
                    {campaign.status === "scheduled" ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="default"
                        className="h-8 shrink-0 text-[11px]"
                        aria-label={
                          sendNowCampaignId === campaign.id && working
                            ? `Sending ${campaign.name}`
                            : `Send ${campaign.name} now`
                        }
                        title="Send this scheduled campaign immediately"
                        disabled={working}
                        onClick={() => onSendNow(campaign)}
                      >
                        {sendNowCampaignId === campaign.id && working ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Send className="h-3.5 w-3.5" />
                        )}
                        {sendNowCampaignId === campaign.id && working
                          ? "Sending..."
                          : "Send now"}
                      </Button>
                    ) : null}
                    {campaign.status === "scheduled" ||
                    campaign.status === "sending" ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8 text-[11px]"
                        disabled={working}
                        onClick={() => onPause(campaign)}
                      >
                        <PauseCircle className="h-3.5 w-3.5" />
                        Pause
                      </Button>
                    ) : null}
                    {campaign.status === "paused" ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8 text-[11px]"
                        disabled={working}
                        onClick={() => onResume(campaign)}
                      >
                        <PlayCircle className="h-3.5 w-3.5" />
                        Resume
                      </Button>
                    ) : null}

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          aria-label={`More actions for ${campaign.name}`}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        {hasSent(campaign) ? (
                          <DropdownMenuItem
                            onSelect={() => onOpenAnalytics(campaign)}
                          >
                            <BarChart3 className="h-3.5 w-3.5" />
                            View analytics
                          </DropdownMenuItem>
                        ) : null}
                        {/* Reusing a sent campaign is the normal way to run
                            "this month's newsletter" — it copies to a fresh
                            draft, so the original's analytics stay intact. */}
                        <DropdownMenuItem
                          disabled={working}
                          onSelect={() => onDuplicate(campaign)}
                        >
                          <Copy className="h-3.5 w-3.5" />
                          Duplicate
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={working}
                          onSelect={() => onDuplicateAndEdit(campaign)}
                        >
                          <CopyPlus className="h-3.5 w-3.5" />
                          Duplicate &amp; edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={working}
                          onSelect={() => onSendTest(campaign)}
                        >
                          <Send className="h-3.5 w-3.5" />
                          Send a test
                        </DropdownMenuItem>
                        {campaign.status === "sent" ||
                        campaign.status === "cancelled" ? (
                          <DropdownMenuItem
                            disabled={working}
                            onSelect={() => onArchive(campaign)}
                          >
                            <Archive className="h-3.5 w-3.5" />
                            Archive
                          </DropdownMenuItem>
                        ) : null}
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onSelect={() => onDelete(campaign)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete
                          </DropdownMenuItem>
                        </>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="flex min-h-[220px] flex-col items-center justify-center rounded-xl border border-dashed border-border text-center">
          <Send className="h-5 w-5 text-muted-foreground" />
          <p className="mt-3 text-[12px] font-medium">
            No campaigns match these filters
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Clear the search or choose a different status.
          </p>
        </div>
      )}

      <TablePagination
        page={pagination.page}
        pageCount={pagination.pageCount}
        pageSize={pagination.pageSize}
        totalCount={pagination.totalCount}
        onPageChange={pagination.setPage}
        itemLabel="campaigns"
      />
    </div>
  );
}
