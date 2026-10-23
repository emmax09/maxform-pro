import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Braces,
  BellRing,
  CheckCircle2,
  CircleAlert,
  Copy,
  Database,
  ExternalLink,
  FileText,
  Mail,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Plug,
  Plus,
  RefreshCw,
  Send,
  Sheet,
  Trash2,
  Users,
  Webhook,
  Workflow,
  X,
  Zap,
  Tags,
} from "lucide-react";

import type {
  AutomationAction,
  AutomationActionType,
  AutomationCondition,
  AutomationConnection,
  AutomationProvider,
  AutomationRun,
  AutomationTriggerEvent,
  AutomationWorkflowInput,
  FormField,
  FormLogicOperator,
  FormRecord,
  FormWorkflow,
} from "@/components/forms/form-types";
import type { ContactListRecord } from "@/lib/contacts";
import { ProjectPicker } from "@/components/projects/ProjectPicker";
import { SecureConnectionDialog } from "@/components/shared/SecureConnectionDialog";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import {
  beginAutomationProviderConnection,
  createFormWorkflow,
  deleteAutomationConnection,
  deleteFormWorkflow,
  duplicateFormWorkflow,
  listAutomationProviderResources,
  listAutomationConnections,
  listAutomationProviders,
  listAutomationRuns,
  saveAutomationConnection,
  setFormWorkflowEnabled,
  testAutomationConnection,
  updateFormWorkflow,
  type AutomationProviderResource,
} from "@/lib/forms";
import { listContactLists, saveContactList } from "@/lib/contacts";
import { getEmailWorkspace, type EmailTemplate } from "@/lib/email";
import { cn } from "@/lib/utils";

type AutomationSection = "automations" | "activity" | "integrations";

type AutomationWorkspaceProps = {
  form: FormRecord | null;
  forms: FormRecord[];
  onSelectForm: (formId: string) => void;
  onWorkflowsChange: (workflows: FormWorkflow[]) => void;
  userId?: string;
  workflows: FormWorkflow[];
};

const actionOptions: Array<{
  type: AutomationActionType;
  label: string;
  description: string;
  icon: typeof Zap;
  group: "MaxForm" | "Communication" | "Connected apps";
}> = [
  {
    type: "create_contact",
    label: "Create or update contact",
    description: "Sync a response into a contact list",
    icon: Users,
    group: "MaxForm",
  },
  {
    type: "tag_response",
    label: "Tag response",
    description: "Organize matching responses automatically",
    icon: Tags,
    group: "MaxForm",
  },
  {
    type: "send_email",
    label: "Send email",
    description: "Send a personalized response or alert",
    icon: Mail,
    group: "Communication",
  },
  {
    type: "notify_team",
    label: "Notify team",
    description: "Alert teammates when a response arrives",
    icon: BellRing,
    group: "Communication",
  },
  {
    type: "webhook",
    label: "Send custom webhook",
    description: "Deliver response data to a connected endpoint",
    icon: Webhook,
    group: "Connected apps",
  },
  {
    type: "slack",
    label: "Send Slack message",
    description: "Post a response alert to Slack",
    icon: MessageSquare,
    group: "Connected apps",
  },
  {
    type: "google_sheets",
    label: "Update Google Sheets",
    description: "Add or update a spreadsheet row",
    icon: Sheet,
    group: "Connected apps",
  },
  {
    type: "airtable",
    label: "Update Airtable",
    description: "Create or update a record",
    icon: Database,
    group: "Connected apps",
  },
  {
    type: "hubspot",
    label: "Sync HubSpot contact",
    description: "Create or update a CRM contact",
    icon: Users,
    group: "Connected apps",
  },
  {
    type: "mailchimp",
    label: "Sync Mailchimp subscriber",
    description: "Add a subscriber or apply tags",
    icon: Mail,
    group: "Connected apps",
  },
  {
    type: "notion",
    label: "Update Notion",
    description: "Create a page or append response content",
    icon: FileText,
    group: "Connected apps",
  },
];

const connectedIntegrationActionTypes = new Set<AutomationActionType>([
  "webhook",
  "slack",
  "google_sheets",
  "airtable",
  "hubspot",
  "mailchimp",
  "notion",
]);

const providerOperationOptions: Partial<
  Record<AutomationActionType, Array<{ value: string; label: string }>>
> = {
  google_sheets: [
    { value: "append_row", label: "Add a new row" },
    { value: "update_row", label: "Update a row range" },
  ],
  airtable: [
    { value: "create_record", label: "Create a record" },
    { value: "update_record", label: "Update a record" },
  ],
  hubspot: [
    { value: "create_or_update_contact", label: "Create or update contact" },
    { value: "create_contact", label: "Create contact only" },
    { value: "update_contact", label: "Update existing contact" },
  ],
  mailchimp: [
    {
      value: "add_or_update_subscriber",
      label: "Add or update subscriber",
    },
    { value: "add_tags", label: "Add tags to subscriber" },
  ],
  notion: [
    { value: "create_page", label: "Create database page" },
    { value: "append_content", label: "Append content to page" },
  ],
};

const defaultProviderOperation: Partial<
  Record<AutomationActionType, string>
> = {
  google_sheets: "append_row",
  airtable: "create_record",
  hubspot: "create_or_update_contact",
  mailchimp: "add_or_update_subscriber",
  notion: "create_page",
};

const friendlyAutomationError = (
  error: unknown,
  fallback = "Please try again in a moment.",
) => {
  const message = error instanceof Error ? error.message : String(error || "");
  const normalized = message.toLowerCase();
  if (/cancelled|canceled|denied/.test(normalized)) {
    return "Connection was cancelled. No changes were made.";
  }
  if (
    /oauth|credential|environment|database|sql|query|encryption|access token|server|endpoint returned http/.test(
      normalized,
    )
  ) {
    return "This service is temporarily unavailable. Please try again later.";
  }
  if (/expired|unauthori[sz]ed|forbidden|token/.test(normalized)) {
    return "This connection needs to be reconnected before it can be used.";
  }
  if (/network|fetch|failed to connect|timeout|timed out/.test(normalized)) {
    return "We could not reach the service. Check your connection and try again.";
  }
  if (/already exists|duplicate|unique/.test(normalized)) {
    return "That item already exists. Choose a different name and try again.";
  }
  return fallback;
};

const friendlyRunError = (message: string | null) => {
  if (!message) return "";
  if (/email answer/i.test(message)) {
    return "A required email answer was missing.";
  }
  if (/static contact list|choose a contact list/i.test(message)) {
    return "The selected contact list is no longer available.";
  }
  if (/expired|reconnect/i.test(message)) {
    return "A connected app needs to be reconnected.";
  }
  return "One action could not be completed.";
};

const actionIsConfigured = (
  action: AutomationAction,
  contactLists: ContactListRecord[] = [],
) => {
  const operation =
    actionConfigText(action, "operation") ||
    defaultProviderOperation[action.type] ||
    "";
  if (connectedIntegrationActionTypes.has(action.type)) {
    if (!action.connectionId) return false;
  if (
    action.type === "google_sheets" &&
      (!actionConfigText(action, "spreadsheetId").trim() ||
        !actionConfigText(action, "sheetName").trim())
  ) {
    return false;
  }
    if (
      action.type === "google_sheets" &&
      operation === "update_row" &&
      !actionConfigText(action, "range").trim()
    ) {
      return false;
    }
    if (
      action.type === "airtable" &&
      (!actionConfigText(action, "baseId").trim() ||
        !actionConfigText(action, "tableId").trim())
    ) {
      return false;
    }
    if (
      action.type === "airtable" &&
      operation === "update_record" &&
      !actionConfigText(action, "recordId").trim()
    ) {
      return false;
    }
    if (
      action.type === "mailchimp" &&
      !actionConfigText(action, "audienceId").trim()
    ) {
      return false;
    }
    if (
      action.type === "mailchimp" &&
      operation === "add_tags" &&
      !actionConfigText(action, "tags").trim()
    ) {
      return false;
    }
    if (
      action.type === "notion" &&
      operation === "create_page" &&
      !actionConfigText(action, "databaseId").trim()
    ) {
      return false;
    }
    if (
      action.type === "notion" &&
      operation === "append_content" &&
      !actionConfigText(action, "pageId").trim()
    ) {
      return false;
    }
  }
  if (action.type === "send_email" || action.type === "notify_team") {
    const templateKey = actionConfigText(action, "templateKey").trim();
    return Boolean(
      actionConfigText(action, "recipient").trim() &&
      (templateKey ||
        (actionConfigText(action, "subject").trim() &&
          actionConfigText(action, "message").trim())),
    );
  }
  if (
    action.type === "create_contact" ||
    action.type === "update_contact"
  ) {
    const contactListId = actionConfigText(action, "contactListId").trim();
    return contactLists.some((list) => list.id === contactListId);
  }
  if (action.type === "tag_response") {
    return Boolean(actionConfigText(action, "tags").trim());
  }
  return true;
};

const triggerOptions: Array<{
  value: AutomationTriggerEvent;
  label: string;
}> = [
  { value: "form_submitted", label: "Any response submitted" },
  { value: "response_completed", label: "Completed response" },
  { value: "response_partial", label: "Partial response captured" },
  { value: "payment_completed", label: "Payment completed" },
];

const conditionOperators: Array<{
  value: FormLogicOperator;
  label: string;
}> = [
  { value: "equals", label: "Equals" },
  { value: "not_equals", label: "Does not equal" },
  { value: "contains", label: "Contains" },
  { value: "greater_than", label: "Greater than" },
  { value: "less_than", label: "Less than" },
  { value: "is_answered", label: "Is answered" },
];

const uuid = () => crypto.randomUUID();

const actionLabel = (type: AutomationActionType) => {
  if (type === "update_contact") return "Create or update contact";
  return (
    actionOptions.find((option) => option.type === type)?.label ||
    type
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ")
  );
};

const actionIcon = (type: AutomationActionType) =>
  actionOptions.find((option) => option.type === type)?.icon || Zap;

const actionConfigText = (action: AutomationAction, key: string) => {
  const value = action.config[key];
  return typeof value === "string" ? value : "";
};

const defaultAction = (
  type: AutomationActionType = "create_contact",
): AutomationAction => {
  let config: Record<string, unknown> = {};
  if (type === "create_contact") {
    config = { contactListId: "", legacyUpsert: true };
  } else if (type === "send_email") {
    config = {
      subject: "Thanks for your response to {{form.title}}",
      message: "We received your response and will be in touch.",
    };
  } else if (type === "notify_team") {
    config = {
      subject: "New response for {{form.title}}",
      message:
        "A new response was received for {{form.title}} at {{submission.created_at}}.",
    };
  } else if (type === "google_sheets") {
    config = { operation: "append_row", sheetName: "Responses" };
  } else if (type === "airtable") {
    config = { operation: "create_record" };
  } else if (type === "hubspot") {
    config = { operation: "create_or_update_contact" };
  } else if (type === "mailchimp") {
    config = { operation: "add_or_update_subscriber" };
  } else if (type === "notion") {
    config = {
      operation: "create_page",
      pageTitle: "{{form.title}} response",
    };
  } else if (type === "slack") {
    config = {
      message: "New response received for {{form.title}}.",
    };
  }
  return {
    id: uuid(),
    type,
    name: actionLabel(type),
    connectionId: null,
    config,
    enabled: true,
  };
};

const defaultWorkflow = (): AutomationWorkflowInput => ({
  name: "",
  description: "",
  triggerEvent: "form_submitted",
  actions: [defaultAction()],
  conditions: [],
  enabled: true,
  runOncePerSubmission: true,
});

const editableFields = (form: FormRecord | null) =>
  (form?.fields || []).filter(
    (field) =>
      !["section", "pageBreak", "heading", "divider"].includes(field.type),
  );

const responseVariableToken = (field: FormField) =>
  `{{response.${field.id}}}`;

const formatDate = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "Never";

const triggerLabel = (value: string) =>
  triggerOptions.find((trigger) => trigger.value === value)?.label || value;

const runStatusClasses = (status: string | null) => {
  if (status === "succeeded")
    return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
  if (status === "failed")
    return "bg-destructive/10 text-destructive";
  if (status === "running" || status === "queued")
    return "bg-blue-500/10 text-blue-700 dark:text-blue-400";
  return "bg-muted text-muted-foreground";
};

function EmptyAutomationState({
  action,
  description,
  icon: Icon,
  title,
}: {
  action?: React.ReactNode;
  description: string;
  icon: typeof Workflow;
  title: string;
}) {
  return (
    <div className="flex min-h-[330px] flex-col items-center justify-center border-y border-border px-6 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Icon className="h-5 w-5" />
      </span>
      <h3 className="mt-4 text-[15px] font-semibold">{title}</h3>
      <p className="mt-1 max-w-[390px] text-[12px] leading-5 text-muted-foreground">
        {description}
      </p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

function FieldSelect({
  fields,
  onChange,
  placeholder,
  value,
}: {
  fields: FormField[];
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  return (
    <Select value={value || "__auto"} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__auto">Detect automatically</SelectItem>
        {fields.map((field) => (
          <SelectItem key={field.id} value={field.id}>
            {field.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ProviderResourceSelect({
  connectionId,
  disabled,
  label,
  onChange,
  parentId = "",
  placeholder,
  resource,
  value,
}: {
  connectionId?: string | null;
  disabled?: boolean;
  label: string;
  onChange: (value: string) => void;
  parentId?: string;
  placeholder: string;
  resource: string;
  value: string;
}) {
  const [options, setOptions] = useState<AutomationProviderResource[]>([]);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    if (!connectionId || disabled) {
      setOptions([]);
      setUnavailable(false);
      return;
    }
    let active = true;
    setLoading(true);
    setUnavailable(false);
    listAutomationProviderResources(connectionId, resource, parentId)
      .then((resources) => {
        if (active) setOptions(resources);
      })
      .catch(() => {
        if (active) {
          setOptions([]);
          setUnavailable(true);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [connectionId, disabled, parentId, resource]);

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <SearchableSelect
        value={value}
        onChange={onChange}
        disabled={!connectionId || disabled || loading}
        options={options.map((option) => ({
          value: option.value,
          label: option.label,
          description: option.description,
        }))}
        placeholder={loading ? "Loading..." : placeholder}
        searchPlaceholder={`Search ${label.toLowerCase()}...`}
        emptyText={unavailable ? "Destinations are unavailable." : "No destinations found."}
      />
      {unavailable && (
        <p className="text-[11px] text-amber-700 dark:text-amber-400">
          Reconnect this account, then try again.
        </p>
      )}
    </div>
  );
}

function ActionMark({
  className,
  icon: Icon,
  provider,
}: {
  className?: string;
  icon: typeof Zap;
  provider?: AutomationProvider;
}) {
  return (
    <span
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-background",
        className,
      )}
    >
      {provider?.logoUrl ? (
        <img
          src={provider.logoUrl}
          alt=""
          className="h-full w-full object-contain p-1.5"
          loading="lazy"
        />
      ) : (
        <Icon className="h-4 w-4 text-primary" />
      )}
    </span>
  );
}

function ActionEditor({
  action,
  connections,
  contactLists,
  emailTemplates,
  fields,
  index,
  isOnly,
  move,
  onChange,
  onCreateContactList,
  onRemove,
  providers,
}: {
  action: AutomationAction;
  connections: AutomationConnection[];
  contactLists: ContactListRecord[];
  emailTemplates: EmailTemplate[];
  fields: FormField[];
  index: number;
  isOnly: boolean;
  move: (direction: -1 | 1) => void;
  onChange: (action: AutomationAction) => void;
  onCreateContactList: (name: string) => Promise<ContactListRecord | null>;
  onRemove: () => void;
  providers: AutomationProvider[];
}) {
  const Icon = actionIcon(action.type);
  const actionProvider = providers.find(
    (provider) => provider.id === action.type,
  );
  const operation =
    actionConfigText(action, "operation") ||
    defaultProviderOperation[action.type] ||
    "";
  const operations = providerOperationOptions[action.type] || [];
  const [emailVariableTarget, setEmailVariableTarget] = useState<
    "recipient" | "replyTo" | "subject" | "message"
  >("message");
  const [creatingContactList, setCreatingContactList] = useState(false);
  const [contactListWorking, setContactListWorking] = useState(false);
  const [newContactListName, setNewContactListName] = useState("");
  const updateConfig = (key: string, value: unknown) =>
    onChange({
      ...action,
      config: { ...action.config, [key]: value },
    });
  const updateConfigValues = (values: Record<string, unknown>) =>
    onChange({
      ...action,
      config: { ...action.config, ...values },
    });
  const requiresConnectedIntegration = connectedIntegrationActionTypes.has(
    action.type,
  );
  const availableConnections = connections.filter(
    (connection) =>
      connection.provider === action.type &&
      connection.status === "connected",
  );
  const availableActionOptions = actionOptions.filter(
    (option) =>
      !connectedIntegrationActionTypes.has(option.type) ||
      connections.some(
        (connection) =>
          connection.provider === option.type &&
          connection.status === "connected",
      ),
  );
  const actionGroups = ["MaxForm", "Communication", "Connected apps"] as const;
  const selectedEmailTemplate = emailTemplates.find(
    (template) => template.key === actionConfigText(action, "templateKey"),
  );
  const insertEmailVariable = (token: string) => {
    const currentValue = actionConfigText(action, emailVariableTarget);
    const separator =
      currentValue && !currentValue.endsWith(" ") && emailVariableTarget === "message"
        ? " "
        : "";
    updateConfig(
      emailVariableTarget,
      `${currentValue}${separator}${token}`,
    );
  };
  const emailVariables = [
    { label: "Form title", token: "{{form.title}}" },
    { label: "Submission ID", token: "{{submission.id}}" },
    { label: "Submitted at", token: "{{submission.created_at}}" },
    ...fields.map((field) => ({
      label: field.label,
      token: responseVariableToken(field),
    })),
  ];
  const createContactList = async () => {
    const name = newContactListName.trim();
    if (!name) return;
    setContactListWorking(true);
    const created = await onCreateContactList(name);
    if (created) {
      updateConfig("contactListId", created.id);
      setNewContactListName("");
      setCreatingContactList(false);
    }
    setContactListWorking(false);
  };

  return (
    <div className="rounded-md border border-border bg-background">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <ActionMark icon={Icon} provider={actionProvider} />
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold">Action {index + 1}</p>
          <p className="truncate text-[10px] text-muted-foreground">
            {actionLabel(action.type)}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => move(-1)}
          disabled={index === 0}
          aria-label="Move action up"
        >
          <ArrowUp className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => move(1)}
          aria-label="Move action down"
        >
          <ArrowDown className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onRemove}
          disabled={isOnly}
          aria-label="Remove action"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid gap-4 p-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label>Action type</Label>
          <Select
            value={
              action.type === "update_contact"
                ? "create_contact"
                : action.type
            }
            onValueChange={(value: AutomationActionType) =>
              onChange({
                ...action,
                type: value,
                name: actionLabel(value),
                connectionId: null,
                config: defaultAction(value).config,
              })
            }
          >
            <SelectTrigger className="h-12">
              <span className="flex min-w-0 items-center gap-2">
                <ActionMark
                  icon={Icon}
                  provider={actionProvider}
                  className="h-7 w-7"
                />
                <span className="truncate">{actionLabel(action.type)}</span>
              </span>
            </SelectTrigger>
            <SelectContent className="max-h-[360px]">
              {actionGroups.map((group) => {
                const options = availableActionOptions.filter(
                  (option) => option.group === group,
                );
                if (options.length === 0) return null;
                return (
                  <SelectGroup key={group}>
                    <SelectLabel className="px-3 pb-1 pt-2 text-[10px] uppercase text-muted-foreground">
                      {group}
                    </SelectLabel>
                    {options.map((option) => {
                      const OptionIcon = option.icon;
                      const provider = providers.find(
                        (item) => item.id === option.type,
                      );
                      return (
                        <SelectItem
                          key={option.type}
                          value={option.type}
                          className="py-2.5"
                        >
                          <span className="flex items-center gap-2.5">
                            <ActionMark
                              icon={OptionIcon}
                              provider={provider}
                              className="h-7 w-7"
                            />
                            <span className="flex flex-col">
                              <span className="text-[12px] font-medium">
                                {option.label}
                              </span>
                              <span className="text-[10px] text-muted-foreground">
                                {option.description}
                              </span>
                            </span>
                          </span>
                        </SelectItem>
                      );
                    })}
                  </SelectGroup>
                );
              })}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Action name</Label>
          <Input
            value={action.name}
            onChange={(event) =>
              onChange({ ...action, name: event.target.value })
            }
          />
        </div>

        {action.type === "create_contact" ||
        action.type === "update_contact" ? (
          <>
            <div className="space-y-2 md:col-span-2">
              <div className="border-y border-border py-3">
                <p className="text-[12px] font-medium">
                  Create or update by email
                </p>
                <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
                  A new email creates a contact. A matching email updates the
                  existing contact, then adds it to the selected list.
                </p>
              </div>
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Destination list</Label>
              <Select
                value={
                  actionConfigText(action, "contactListId") || undefined
                }
                onValueChange={(value) => {
                  if (value === "__create-list") {
                    setCreatingContactList(true);
                    return;
                  }
                  updateConfig("contactListId", value);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose a contact list" />
                </SelectTrigger>
                <SelectContent>
                  {contactLists.map((list) => (
                    <SelectItem key={list.id} value={list.id}>
                      {list.name}
                    </SelectItem>
                  ))}
                  <SelectItem value="__create-list">
                    <span className="flex items-center gap-2 text-primary">
                      <Plus className="h-3.5 w-3.5" />
                      Create new list
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[10px] leading-4 text-muted-foreground">
                Only static lists can receive contacts from an automation.
              </p>
            </div>
            {(creatingContactList || contactLists.length === 0) && (
              <div className="border border-border bg-muted/20 p-3 md:col-span-2">
                {contactLists.length === 0 && (
                  <p className="mb-3 text-[10px] text-muted-foreground">
                    No static lists yet. Create one for this action.
                  </p>
                )}
                <div className="flex items-center gap-2">
                  <Input
                    value={newContactListName}
                    onChange={(event) =>
                      setNewContactListName(event.target.value)
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void createContactList();
                      }
                    }}
                    placeholder="List name"
                    aria-label="New automation contact list name"
                    autoFocus={creatingContactList}
                  />
                  <Button
                    type="button"
                    onClick={() => void createContactList()}
                    disabled={
                      contactListWorking || !newContactListName.trim()
                    }
                  >
                    {contactListWorking ? (
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : (
                      <Plus className="h-4 w-4" />
                    )}
                    Create
                  </Button>
                  {contactLists.length > 0 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        setCreatingContactList(false);
                        setNewContactListName("");
                      }}
                      aria-label="Cancel new contact list"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            )}
            {[
              ["emailFieldId", "Email"],
              ["fullNameFieldId", "Name"],
              ["phoneFieldId", "Phone"],
              ["companyFieldId", "Company"],
            ].map(([key, label]) => (
              <div key={key} className="space-y-2">
                <Label>{label} response field</Label>
                <FieldSelect
                  fields={fields}
                  value={actionConfigText(action, key)}
                  onChange={(value) =>
                    updateConfig(key, value === "__auto" ? "" : value)
                  }
                  placeholder={`${label} field`}
                />
              </div>
            ))}
            <div className="space-y-2 md:col-span-2">
              <Label>Tags</Label>
              <Input
                value={actionConfigText(action, "tags")}
                onChange={(event) => updateConfig("tags", event.target.value)}
                placeholder="form lead, qualified"
              />
            </div>
          </>
        ) : action.type === "tag_response" ? (
          <div className="space-y-2 md:col-span-2">
            <Label>Response tags</Label>
            <Input
              value={actionConfigText(action, "tags")}
              onChange={(event) => updateConfig("tags", event.target.value)}
              placeholder="qualified, follow up, priority"
            />
            <p className="text-[10px] leading-4 text-muted-foreground">
              Separate tags with commas. Existing response data stays unchanged.
            </p>
          </div>
        ) : action.type === "send_email" ||
          action.type === "notify_team" ? (
          <>
            <div className="space-y-2">
              <Label>
                {action.type === "notify_team"
                  ? "Team recipients"
                  : "Recipient"}
              </Label>
              <Input
                value={actionConfigText(action, "recipient")}
                onFocus={() => setEmailVariableTarget("recipient")}
                onChange={(event) =>
                  updateConfig("recipient", event.target.value)
                }
                placeholder={
                  action.type === "notify_team"
                    ? "ops@example.com, sales@example.com"
                    : "customer@example.com"
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Reply-to</Label>
              <Input
                value={actionConfigText(action, "replyTo")}
                onFocus={() => setEmailVariableTarget("replyTo")}
                onChange={(event) =>
                  updateConfig("replyTo", event.target.value)
                }
                placeholder="Optional email or response variable"
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Email design</Label>
              <Select
                value={selectedEmailTemplate?.key || "custom"}
                onValueChange={(value) =>
                  updateConfig("templateKey", value === "custom" ? "" : value)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose an email design" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="custom">Custom message</SelectItem>
                  {emailTemplates.map((template) => (
                    <SelectItem key={template.id} value={template.key}>
                      {template.name} · {template.module}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedEmailTemplate ? (
                <div className="flex gap-3 rounded-lg border border-primary/20 bg-primary/[0.035] p-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"><FileText className="h-4 w-4" /></span>
                  <div className="min-w-0"><p className="text-[12px] font-semibold">{selectedEmailTemplate.name}</p><p className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-muted-foreground">{selectedEmailTemplate.subject}</p><p className="mt-2 text-[10px] text-primary">This saved responsive design will be used when the automation runs.</p></div>
                </div>
              ) : <p className="text-[10px] text-muted-foreground">Use a polished template from Email settings, or write a one-off message below.</p>}
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>{selectedEmailTemplate ? "Custom subject (not used while a design is selected)" : "Subject"}</Label>
              <Input
                value={actionConfigText(action, "subject")}
                onFocus={() => setEmailVariableTarget("subject")}
                onChange={(event) =>
                  updateConfig("subject", event.target.value)
                }
                placeholder="New response for {{form.title}}"
                disabled={Boolean(selectedEmailTemplate)}
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>{selectedEmailTemplate ? "Custom message (not used while a design is selected)" : "Message"}</Label>
              <Textarea
                value={actionConfigText(action, "message")}
                onFocus={() => setEmailVariableTarget("message")}
                onChange={(event) =>
                  updateConfig("message", event.target.value)
                }
                placeholder="A new response was received."
                className="min-h-[120px]"
                disabled={Boolean(selectedEmailTemplate)}
              />
            </div>
            <div className="border-t border-border pt-4 md:col-span-2">
              <div className="flex items-center gap-2">
                <Braces className="h-4 w-4 text-primary" />
                <div>
                  <p className="text-[12px] font-medium">
                    Available variables
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Insert into the active email field
                  </p>
                </div>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {emailVariables.map((variable) => (
                  <button
                    key={variable.token}
                    type="button"
                    onClick={() => insertEmailVariable(variable.token)}
                    className="flex min-w-0 items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-left hover:border-primary/50 hover:bg-muted/40"
                    title={`Insert ${variable.token}`}
                  >
                    <span className="truncate text-[11px] font-medium">
                      {variable.label}
                    </span>
                    <code className="max-w-[55%] truncate text-[10px] text-muted-foreground">
                      {variable.token}
                    </code>
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="space-y-2 md:col-span-2">
              <Label>Connected account</Label>
              <Select
                value={action.connectionId || undefined}
                onValueChange={(connectionId) =>
                  onChange({
                    ...action,
                    connectionId,
                    config: Object.fromEntries(
                      Object.entries(action.config).filter(
                        ([key]) =>
                          ![
                            "spreadsheetId",
                            "sheetName",
                            "baseId",
                            "tableId",
                            "recordId",
                            "audienceId",
                            "databaseId",
                            "pageId",
                          ].includes(key),
                      ),
                    ),
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={`Select ${actionLabel(action.type)} account`}
                  />
                </SelectTrigger>
                <SelectContent>
                  {availableConnections.map((connection) => (
                    <SelectItem key={connection.id} value={connection.id}>
                      {connection.externalAccountName || connection.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {requiresConnectedIntegration &&
                availableConnections.length === 0 && (
                <p className="flex items-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-400">
                  <CircleAlert className="h-3.5 w-3.5" />
                  Connect and verify {actionLabel(action.type)} in Integrations
                  first.
                </p>
              )}
            </div>
            {operations.length > 1 && (
              <div className="space-y-2 md:col-span-2">
                <Label>What should happen?</Label>
                <Select
                  value={operation}
                  onValueChange={(value) => updateConfig("operation", value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {operations.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {action.type === "google_sheets" && (
              <>
                <ProviderResourceSelect
                  connectionId={action.connectionId}
                  resource="spreadsheets"
                  label="Spreadsheet"
                  value={actionConfigText(action, "spreadsheetId")}
                  onChange={(spreadsheetId) =>
                    updateConfigValues({ spreadsheetId, sheetName: "" })
                  }
                  placeholder="Select a spreadsheet"
                />
                <ProviderResourceSelect
                  connectionId={action.connectionId}
                  resource="sheets"
                  parentId={actionConfigText(action, "spreadsheetId")}
                  disabled={!actionConfigText(action, "spreadsheetId")}
                  label="Worksheet"
                  value={actionConfigText(action, "sheetName")}
                  onChange={(sheetName) => updateConfig("sheetName", sheetName)}
                  placeholder="Select a worksheet"
                />
                {operation === "update_row" && (
                  <div className="space-y-2 md:col-span-2">
                    <Label>Row range</Label>
                    <Input
                      value={actionConfigText(action, "range")}
                      onChange={(event) =>
                        updateConfig("range", event.target.value)
                      }
                      placeholder="Responses!A2:F2"
                    />
                  </div>
                )}
              </>
            )}
            {action.type === "airtable" && (
              <>
                <ProviderResourceSelect
                  connectionId={action.connectionId}
                  resource="bases"
                  label="Base"
                  value={actionConfigText(action, "baseId")}
                  onChange={(baseId) =>
                    updateConfigValues({ baseId, tableId: "" })
                  }
                  placeholder="Select a base"
                />
                <ProviderResourceSelect
                  connectionId={action.connectionId}
                  resource="tables"
                  parentId={actionConfigText(action, "baseId")}
                  disabled={!actionConfigText(action, "baseId")}
                  label="Table"
                  value={actionConfigText(action, "tableId")}
                  onChange={(tableId) => updateConfig("tableId", tableId)}
                  placeholder="Select a table"
                />
                {operation === "update_record" && (
                  <div className="space-y-2 md:col-span-2">
                    <Label>Record ID</Label>
                    <Input
                      value={actionConfigText(action, "recordId")}
                      onChange={(event) =>
                        updateConfig("recordId", event.target.value)
                      }
                      placeholder="rec..."
                    />
                  </div>
                )}
              </>
            )}
            {(action.type === "hubspot" ||
              action.type === "mailchimp") && (
              <>
                <div className="space-y-2">
                  <Label>Email response field</Label>
                  <FieldSelect
                    fields={fields}
                    value={actionConfigText(action, "emailFieldId")}
                    onChange={(value) =>
                      updateConfig(
                        "emailFieldId",
                        value === "__auto" ? "" : value,
                      )
                    }
                    placeholder="Email field"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Name response field</Label>
                  <FieldSelect
                    fields={fields}
                    value={actionConfigText(action, "fullNameFieldId")}
                    onChange={(value) =>
                      updateConfig(
                        "fullNameFieldId",
                        value === "__auto" ? "" : value,
                      )
                    }
                    placeholder="Name field"
                  />
                </div>
              </>
            )}
            {action.type === "hubspot" && (
              <>
                <div className="space-y-2">
                  <Label>Phone response field</Label>
                  <FieldSelect
                    fields={fields}
                    value={actionConfigText(action, "phoneFieldId")}
                    onChange={(value) =>
                      updateConfig(
                        "phoneFieldId",
                        value === "__auto" ? "" : value,
                      )
                    }
                    placeholder="Phone field"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Company response field</Label>
                  <FieldSelect
                    fields={fields}
                    value={actionConfigText(action, "companyFieldId")}
                    onChange={(value) =>
                      updateConfig(
                        "companyFieldId",
                        value === "__auto" ? "" : value,
                      )
                    }
                    placeholder="Company field"
                  />
                </div>
              </>
            )}
            {action.type === "mailchimp" && (
              <>
                <ProviderResourceSelect
                  connectionId={action.connectionId}
                  resource="audiences"
                  label="Audience"
                  value={actionConfigText(action, "audienceId")}
                  onChange={(audienceId) =>
                    updateConfig("audienceId", audienceId)
                  }
                  placeholder="Select an audience"
                />
                {operation === "add_tags" && (
                  <div className="space-y-2">
                    <Label>Subscriber tags</Label>
                    <Input
                      value={actionConfigText(action, "tags")}
                      onChange={(event) =>
                        updateConfig("tags", event.target.value)
                      }
                      placeholder="form lead, qualified"
                    />
                  </div>
                )}
              </>
            )}
            {action.type === "notion" && (
              <>
                {operation === "create_page" ? (
                  <ProviderResourceSelect
                    connectionId={action.connectionId}
                    resource="data_sources"
                    label="Data source"
                    value={actionConfigText(action, "databaseId")}
                    onChange={(databaseId) =>
                      updateConfig("databaseId", databaseId)
                    }
                    placeholder="Select a data source"
                  />
                ) : (
                  <ProviderResourceSelect
                    connectionId={action.connectionId}
                    resource="pages"
                    label="Page"
                    value={actionConfigText(action, "pageId")}
                    onChange={(pageId) => updateConfig("pageId", pageId)}
                    placeholder="Select a page"
                  />
                )}
                <div className="space-y-2">
                  <Label>Page title</Label>
                  <Input
                    value={actionConfigText(action, "pageTitle")}
                    onChange={(event) =>
                      updateConfig("pageTitle", event.target.value)
                    }
                    placeholder="{{form.title}} response"
                  />
                </div>
              </>
            )}
            {action.type === "slack" && (
              <div className="space-y-2 md:col-span-2">
                <Label>Message</Label>
                <Textarea
                  value={actionConfigText(action, "message")}
                  onChange={(event) =>
                    updateConfig("message", event.target.value)
                  }
                  placeholder="A new response was received."
                  className="min-h-[82px]"
                />
              </div>
            )}
          </>
        )}

        <div className="flex items-center justify-between border-t border-border pt-4 md:col-span-2">
          <div>
            <p className="text-[12px] font-medium">Continue after failure</p>
            <p className="text-[10px] text-muted-foreground">
              Run the next action
            </p>
          </div>
          <Switch
            checked={action.config.continueOnError === true}
            onCheckedChange={(checked) =>
              updateConfig("continueOnError", checked)
            }
          />
        </div>
      </div>
    </div>
  );
}

function WorkflowEditorDialog({
  connections,
  contactLists,
  draft,
  emailTemplates,
  editing,
  form,
  forms,
  onChange,
  onCreateContactList,
  onOpenChange,
  onSave,
  onSelectForm,
  open,
  providers,
  working,
}: {
  connections: AutomationConnection[];
  contactLists: ContactListRecord[];
  draft: AutomationWorkflowInput;
  emailTemplates: EmailTemplate[];
  editing: FormWorkflow | null;
  form: FormRecord | null;
  forms: FormRecord[];
  onChange: (draft: AutomationWorkflowInput) => void;
  onCreateContactList: (name: string) => Promise<ContactListRecord | null>;
  onOpenChange: (open: boolean) => void;
  onSave: () => void;
  onSelectForm: (formId: string) => void;
  open: boolean;
  providers: AutomationProvider[];
  working: boolean;
}) {
  const fields = editableFields(form);
  const availableForms = forms.filter((item) => item.status !== "archived");
  const updateAction = (index: number, action: AutomationAction) =>
    onChange({
      ...draft,
      actions: draft.actions.map((item, itemIndex) =>
        itemIndex === index ? action : item,
      ),
    });
  const moveAction = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= draft.actions.length) return;
    const actions = [...draft.actions];
    [actions[index], actions[nextIndex]] = [actions[nextIndex], actions[index]];
    onChange({ ...draft, actions });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="dashboard-scroll max-h-[92vh] max-w-[920px] overflow-y-auto p-0">
        <DialogHeader className="border-b border-border px-6 py-5">
          <DialogTitle>
            {editing ? "Edit automation" : "New automation"}
          </DialogTitle>
          <DialogDescription>
            Choose the form, trigger, and actions for this workflow.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-7 px-6 py-6">
          <section>
            <h3 className="text-[13px] font-semibold">Details</h3>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="space-y-2 md:col-span-2">
                <Label>Form</Label>
                <Select
                  value={form?.id || undefined}
                  onValueChange={(formId) => {
                    onSelectForm(formId);
                    onChange({
                      ...draft,
                      conditions: [],
                      actions: draft.actions.map((action) => ({
                        ...action,
                        config: Object.fromEntries(
                          Object.entries(action.config).filter(
                            ([key]) =>
                              ![
                                "emailFieldId",
                                "fullNameFieldId",
                                "phoneFieldId",
                                "companyFieldId",
                              ].includes(key),
                          ),
                        ),
                      })),
                    });
                  }}
                  disabled={Boolean(editing) || working}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a form" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableForms.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="workflow-name">Name</Label>
                <Input
                  id="workflow-name"
                  value={draft.name}
                  onChange={(event) =>
                    onChange({ ...draft, name: event.target.value })
                  }
                  placeholder="Route qualified leads"
                />
              </div>
              <div className="space-y-2">
                <Label>Trigger</Label>
                <Select
                  value={draft.triggerEvent}
                  onValueChange={(triggerEvent: AutomationTriggerEvent) =>
                    onChange({ ...draft, triggerEvent })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {triggerOptions.map((trigger) => (
                      <SelectItem key={trigger.value} value={trigger.value}>
                        {trigger.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="workflow-description">Description</Label>
                <Textarea
                  id="workflow-description"
                  value={draft.description}
                  onChange={(event) =>
                    onChange({ ...draft, description: event.target.value })
                  }
                  placeholder="Internal notes"
                  className="min-h-[72px]"
                />
              </div>
              <div className="flex items-center justify-between border-y border-border py-4">
                <div>
                  <p className="text-[12px] font-medium">Active</p>
                  <p className="text-[10px] text-muted-foreground">
                    Process matching responses
                  </p>
                </div>
                <Switch
                  checked={draft.enabled}
                  onCheckedChange={(enabled) =>
                    onChange({ ...draft, enabled })
                  }
                />
              </div>
              <div className="flex items-center justify-between border-y border-border py-4">
                <div>
                  <p className="text-[12px] font-medium">Run once</p>
                  <p className="text-[10px] text-muted-foreground">
                    One run per submission
                  </p>
                </div>
                <Switch
                  checked={draft.runOncePerSubmission}
                  onCheckedChange={(runOncePerSubmission) =>
                    onChange({ ...draft, runOncePerSubmission })
                  }
                />
              </div>
            </div>
          </section>

          <section className="border-t border-border pt-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-[13px] font-semibold">Conditions</h3>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  All conditions must match
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  onChange({
                    ...draft,
                    conditions: [
                      ...draft.conditions,
                      {
                        id: uuid(),
                        fieldId: fields[0]?.id || "",
                        operator: "equals",
                        value: "",
                      },
                    ],
                  })
                }
                disabled={fields.length === 0}
              >
                <Plus className="h-4 w-4" />
                Add condition
              </Button>
            </div>
            {draft.conditions.length > 0 && (
              <div className="mt-4 space-y-3">
                {draft.conditions.map((condition, index) => (
                  <div
                    key={condition.id}
                    className="grid gap-3 rounded-md border border-border p-3 md:grid-cols-[1fr_170px_1fr_36px]"
                  >
                    <Select
                      value={condition.fieldId}
                      onValueChange={(fieldId) =>
                        onChange({
                          ...draft,
                          conditions: draft.conditions.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, fieldId } : item,
                          ),
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Field" />
                      </SelectTrigger>
                      <SelectContent>
                        {fields.map((field) => (
                          <SelectItem key={field.id} value={field.id}>
                            {field.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={condition.operator}
                      onValueChange={(operator: FormLogicOperator) =>
                        onChange({
                          ...draft,
                          conditions: draft.conditions.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, operator } : item,
                          ),
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {conditionOperators.map((operator) => (
                          <SelectItem
                            key={operator.value}
                            value={operator.value}
                          >
                            {operator.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      value={condition.value}
                      onChange={(event) =>
                        onChange({
                          ...draft,
                          conditions: draft.conditions.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, value: event.target.value }
                              : item,
                          ),
                        })
                      }
                      disabled={condition.operator === "is_answered"}
                      placeholder="Value"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        onChange({
                          ...draft,
                          conditions: draft.conditions.filter(
                            (item) => item.id !== condition.id,
                          ),
                        })
                      }
                      aria-label="Remove condition"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="border-t border-border pt-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-[13px] font-semibold">Actions</h3>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Runs from top to bottom
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  onChange({
                    ...draft,
                    actions: [...draft.actions, defaultAction()],
                  })
                }
              >
                <Plus className="h-4 w-4" />
                Add action
              </Button>
            </div>
            <div className="mt-4 space-y-4">
              {draft.actions.map((action, index) => (
                <ActionEditor
                  key={action.id}
                  action={action}
                  connections={connections}
                  contactLists={contactLists}
                  emailTemplates={emailTemplates}
                  fields={fields}
                  index={index}
                  isOnly={draft.actions.length === 1}
                  move={(direction) => moveAction(index, direction)}
                  onChange={(nextAction) =>
                    updateAction(index, nextAction)
                  }
                  onCreateContactList={onCreateContactList}
                  onRemove={() =>
                    onChange({
                      ...draft,
                      actions: draft.actions.filter(
                        (item) => item.id !== action.id,
                      ),
                    })
                  }
                  providers={providers}
                />
              ))}
            </div>
          </section>
        </div>

        <DialogFooter className="border-t border-border px-6 py-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={working}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onSave}
            disabled={
              working ||
              !form ||
              !draft.name.trim() ||
              draft.actions.length === 0 ||
              draft.actions.some(
                (action) =>
                  !action.name.trim() ||
                  !actionIsConfigured(action, contactLists),
              )
            }
          >
            {working ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            {editing ? "Update automation" : "Create automation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConnectionEditorDialog({
  connection,
  onOpenChange,
  onSave,
  open,
  working,
}: {
  connection: AutomationConnection | null;
  onOpenChange: (open: boolean) => void;
  onSave: (input: {
    id?: string;
    name: string;
    config: Record<string, unknown>;
  }) => void;
  open: boolean;
  working: boolean;
}) {
  const [name, setName] = useState("");
  const [endpointUrl, setEndpointUrl] = useState("");
  const [authToken, setAuthToken] = useState("");

  useEffect(() => {
    if (!open) return;
    setName(connection?.name || "");
    setEndpointUrl(String(connection?.config.endpointUrl || ""));
    setAuthToken(String(connection?.config.authToken || ""));
  }, [connection, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[560px]">
        <DialogHeader>
          <DialogTitle>
            {connection ? "Edit custom webhook" : "Custom webhook"}
          </DialogTitle>
          <DialogDescription>Reusable HTTP endpoint</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="connection-name">Name</Label>
            <Input
              id="connection-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Lead delivery webhook"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="connection-endpoint">Endpoint URL</Label>
            <Input
              id="connection-endpoint"
              type="url"
              value={endpointUrl}
              onChange={(event) => setEndpointUrl(event.target.value)}
              placeholder="https://"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="connection-token">Bearer token</Label>
            <Input
              id="connection-token"
              type="password"
              value={authToken}
              onChange={(event) => setAuthToken(event.target.value)}
              placeholder="Optional"
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() =>
              onSave({
                id: connection?.id,
                name: name.trim(),
                config: {
                  endpointUrl: endpointUrl.trim(),
                  authToken: authToken.trim(),
                },
              })
            }
            disabled={working || !name.trim() || !endpointUrl.trim()}
          >
            {working && <RefreshCw className="h-4 w-4 animate-spin" />}
            Save webhook
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AutomationWorkspace({
  form,
  forms,
  onSelectForm,
  onWorkflowsChange,
  userId,
  workflows,
}: AutomationWorkspaceProps) {
  const { toast } = useToast();
  const [section, setSection] =
    useState<AutomationSection>("automations");
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [connections, setConnections] = useState<AutomationConnection[]>([]);
  const [contactLists, setContactLists] = useState<ContactListRecord[]>([]);
  const [providers, setProviders] = useState<AutomationProvider[]>([]);
  const [emailTemplates, setEmailTemplates] = useState<EmailTemplate[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<FormWorkflow | null>(null);
  const [draft, setDraft] = useState<AutomationWorkflowInput>(
    defaultWorkflow(),
  );
  const [workflowWorking, setWorkflowWorking] = useState(false);
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [editingConnection, setEditingConnection] =
    useState<AutomationConnection | null>(null);
  const [connectionWorking, setConnectionWorking] = useState(false);
  const [connectionActionId, setConnectionActionId] = useState<string | null>(
    null,
  );
  const [providerToConnect, setProviderToConnect] =
    useState<AutomationProvider | null>(null);

  const loadActivity = useCallback(async () => {
    if (!userId || !form) {
      setRuns([]);
      return;
    }
    setActivityLoading(true);
    try {
      setRuns(await listAutomationRuns(userId, form.id));
    } catch (error) {
      toast({
        title: "Automation activity could not be loaded",
        description: friendlyAutomationError(error),
        variant: "destructive",
      });
    } finally {
      setActivityLoading(false);
    }
  }, [form, toast, userId]);

  const loadWorkspaceData = useCallback(async () => {
    if (!userId) {
      setConnections([]);
      setProviders([]);
      setContactLists([]);
      return;
    }
    setWorkspaceLoading(true);
    try {
      const [nextConnections, nextProviders, nextContactLists] =
        await Promise.all([
          listAutomationConnections(userId),
          listAutomationProviders(),
          listContactLists(userId, "static"),
        ]);
      setConnections(nextConnections);
      setProviders(nextProviders);
      setContactLists(nextContactLists);
    } catch (error) {
      toast({
        title: "Automation workspace could not be loaded",
        description: friendlyAutomationError(error),
        variant: "destructive",
      });
    } finally {
      setWorkspaceLoading(false);
    }
  }, [toast, userId]);

  useEffect(() => {
    void loadWorkspaceData();
  }, [loadWorkspaceData]);

  useEffect(() => {
    if (!userId) {
      setEmailTemplates([]);
      return;
    }
    let current = true;
    void getEmailWorkspace()
      .then((workspace) => {
        if (current) setEmailTemplates(workspace.templates);
      })
      .catch(() => {
        if (current) setEmailTemplates([]);
      });
    return () => {
      current = false;
    };
  }, [userId]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const integrationResult = params.get("integration");
    if (!integrationResult) return;

    setSection("integrations");
    const provider = (params.get("provider") || "Integration").replace(
      /_/g,
      " ",
    );
    if (integrationResult === "connected") {
      toast({
        title: `${provider} connected`,
        description: "The account is ready to use in form automations.",
      });
      void loadWorkspaceData();
    } else {
      toast({
        title: `${provider} was not connected`,
        description: friendlyAutomationError(
          params.get("message") || "Authorization was cancelled.",
        ),
        variant: "destructive",
      });
    }

    params.delete("integration");
    params.delete("provider");
    params.delete("message");
    const queryString = params.toString();
    window.history.replaceState(
      {},
      "",
      `${window.location.pathname}${queryString ? `?${queryString}` : ""}${window.location.hash}`,
    );
  }, [loadWorkspaceData, toast]);

  const metrics = useMemo(() => {
    const totalRuns = workflows.reduce(
      (total, workflow) => total + workflow.runCount,
      0,
    );
    const successes = workflows.reduce(
      (total, workflow) => total + workflow.successCount,
      0,
    );
    return {
      active: workflows.filter((workflow) => workflow.enabled).length,
      totalRuns,
      successRate: totalRuns ? Math.round((successes / totalRuns) * 100) : 0,
    };
  }, [workflows]);

  const openCreate = () => {
    setEditing(null);
    setDraft(defaultWorkflow());
    setEditorOpen(true);
  };

  const openEdit = (workflow: FormWorkflow) => {
    setEditing(workflow);
    setDraft({
      name: workflow.name,
      description: workflow.description,
      triggerEvent: workflow.triggerEvent,
      actions: workflow.actions.map((action) => {
        if (
          action.type !== "create_contact" &&
          action.type !== "update_contact"
        ) {
          return { ...action, config: { ...action.config } };
        }
        const { targetContactId: _targetContactId, ...config } = action.config;
        const hasDefaultName =
          action.name === "Create contact" ||
          action.name === "Update contact";
        return {
          ...action,
          type: "create_contact" as const,
          name: hasDefaultName ? actionLabel("create_contact") : action.name,
          config: {
            ...config,
            contactListId: actionConfigText(action, "contactListId"),
            legacyUpsert: true,
          },
        };
      }),
      conditions: workflow.conditions.map((condition) => ({ ...condition })),
      enabled: workflow.enabled,
      runOncePerSubmission: workflow.runOncePerSubmission,
    });
    setEditorOpen(true);
  };

  const createContactList = async (name: string) => {
    if (!userId) return null;
    try {
      const created = await saveContactList(userId, {
        name,
        description: "",
        listType: "static",
        filterDefinition: [],
      });
      setContactLists((current) => [
        created,
        ...current.filter((list) => list.id !== created.id),
      ]);
      toast({ title: "Contact list created and selected" });
      return created;
    } catch (error) {
      toast({
        title: "Contact list was not created",
        description: friendlyAutomationError(error),
        variant: "destructive",
      });
      return null;
    }
  };

  const saveWorkflow = async () => {
    if (!userId || !form) return;
    setWorkflowWorking(true);
    try {
      const saved = editing
        ? await updateFormWorkflow(userId, form.id, editing.id, draft)
        : await createFormWorkflow(userId, form.id, draft);
      onWorkflowsChange(
        editing
          ? workflows.map((workflow) =>
              workflow.id === saved.id ? saved : workflow,
            )
          : [saved, ...workflows],
      );
      setEditorOpen(false);
      toast({
        title: editing ? "Automation updated" : "Automation created",
      });
    } catch (error) {
      toast({
        title: "Automation was not saved",
        description: friendlyAutomationError(
          error,
          "Check the required action fields and try again.",
        ),
        variant: "destructive",
      });
    } finally {
      setWorkflowWorking(false);
    }
  };

  const toggleWorkflow = async (
    workflow: FormWorkflow,
    enabled: boolean,
  ) => {
    if (!userId) return;
    try {
      await setFormWorkflowEnabled(userId, workflow.id, enabled);
      onWorkflowsChange(
        workflows.map((item) =>
          item.id === workflow.id ? { ...item, enabled } : item,
        ),
      );
      toast({ title: enabled ? "Automation activated" : "Automation paused" });
    } catch (error) {
      toast({
        title: "Automation status was not changed",
        description: friendlyAutomationError(error),
        variant: "destructive",
      });
    }
  };

  const duplicateWorkflow = async (workflow: FormWorkflow) => {
    if (!userId) return;
    try {
      const copy = await duplicateFormWorkflow(userId, workflow);
      onWorkflowsChange([copy, ...workflows]);
      toast({ title: "Automation duplicated" });
    } catch (error) {
      toast({
        title: "Automation was not duplicated",
        description: friendlyAutomationError(error),
        variant: "destructive",
      });
    }
  };

  const removeWorkflow = async (workflow: FormWorkflow) => {
    if (!userId) return;
    try {
      await deleteFormWorkflow(userId, workflow.id);
      onWorkflowsChange(
        workflows.filter((item) => item.id !== workflow.id),
      );
      setRuns((current) =>
        current.filter((run) => run.workflowId !== workflow.id),
      );
      toast({ title: "Automation deleted" });
    } catch (error) {
      toast({
        title: "Automation was not deleted",
        description: friendlyAutomationError(error),
        variant: "destructive",
      });
    }
  };

  const saveConnection = async (input: {
    id?: string;
    name: string;
    config: Record<string, unknown>;
  }) => {
    if (!userId) return;
    setConnectionWorking(true);
    try {
      const saved = await saveAutomationConnection(userId, {
        ...input,
        provider: "webhook",
      });
      setConnections((current) =>
        input.id
          ? current.map((connection) =>
              connection.id === saved.id ? saved : connection,
            )
          : [saved, ...current],
      );
      setConnectionOpen(false);
      toast({ title: "Connection saved" });
    } catch (error) {
      toast({
        title: "Connection was not saved",
        description: friendlyAutomationError(
          error,
          "Check the connection details and try again.",
        ),
        variant: "destructive",
      });
    } finally {
      setConnectionWorking(false);
    }
  };

  const connectProvider = async (provider: AutomationProvider) => {
    if (provider.connectionMode === "webhook") {
      setEditingConnection(null);
      setConnectionOpen(true);
      return;
    }
    if (!userId) return;
    if (!provider.configured) {
      toast({
        title: `${provider.name} is temporarily unavailable`,
        description:
          "This connection cannot be started right now. Please try again later.",
      });
      return;
    }
    const connected = connections.find(
      (connection) =>
        connection.provider === provider.id &&
        connection.status === "connected",
    );
    if (connected) {
      toast({ title: `${provider.name} is already connected` });
      return;
    }
    setProviderToConnect(provider);
  };

  const verifyConnection = async (connection: AutomationConnection) => {
    if (!userId) return;
    setConnectionActionId(connection.id);
    try {
      const tested = await testAutomationConnection(userId, connection);
      setConnections((current) =>
        current.map((item) => (item.id === tested.id ? tested : item)),
      );
      const connected = tested.status === "connected";
      toast({
        title: connected
          ? "Connection verified"
          : "Connection needs attention",
        description: connected
          ? "This account is ready for automations."
          : friendlyAutomationError(
              tested.lastError,
              "Reconnect this account and try again.",
            ),
        variant: connected ? "default" : "destructive",
      });
    } catch (error) {
      toast({
        title: "Connection could not be verified",
        description: friendlyAutomationError(error),
        variant: "destructive",
      });
    } finally {
      setConnectionActionId(null);
    }
  };

  const removeConnection = async (connection: AutomationConnection) => {
    if (!userId) return;
    setConnectionActionId(connection.id);
    try {
      await deleteAutomationConnection(userId, connection.id);
      setConnections((current) =>
        current.filter((item) => item.id !== connection.id),
      );
      toast({ title: "Connection removed" });
    } catch (error) {
      toast({
        title: "Connection was not removed",
        description: friendlyAutomationError(error),
        variant: "destructive",
      });
    } finally {
      setConnectionActionId(null);
    }
  };

  if (forms.length === 0) {
    return (
      <EmptyAutomationState
        icon={Workflow}
        title="Create a form first"
        description="Automations belong to one form and process only that form's responses."
      />
    );
  }

  return (
    <div className="pb-12">
      <div className="flex justify-end">
        {section === "automations" ? (
          <Button type="button" onClick={openCreate}>
            <Plus className="h-4 w-4" />
            New automation
          </Button>
        ) : section === "activity" ? (
          <Button type="button" variant="outline" onClick={loadActivity}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        ) : (
          <Button
            type="button"
            onClick={() => {
              setEditingConnection(null);
              setConnectionOpen(true);
            }}
          >
            <Webhook className="h-4 w-4" />
            Custom webhook
          </Button>
        )}
      </div>

      <div className="mt-6 flex border-b border-border">
        {[
          { key: "automations" as const, label: "Automations", icon: Workflow },
          { key: "activity" as const, label: "Activity", icon: Activity },
          { key: "integrations" as const, label: "Integrations", icon: Plug },
        ].map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => {
              setSection(item.key);
              if (item.key === "activity") void loadActivity();
            }}
            className={cn(
              "relative flex h-11 items-center gap-2 px-4 text-[12px] font-medium text-muted-foreground hover:text-foreground",
              section === item.key && "text-foreground",
            )}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
            {section === item.key && (
              <span className="absolute inset-x-3 bottom-0 h-0.5 bg-primary" />
            )}
          </button>
        ))}
      </div>

      {section === "automations" && (
        <>
          <div className="grid border-b border-border sm:grid-cols-3">
            {[
              {
                label: "Active",
                value: `${metrics.active} / ${workflows.length}`,
              },
              { label: "Total runs", value: metrics.totalRuns.toLocaleString() },
              {
                label: "Success rate",
                value: metrics.totalRuns ? `${metrics.successRate}%` : "-",
              },
            ].map((metric, index) => (
              <div
                key={metric.label}
                className={cn(
                  "px-4 py-5",
                  index > 0 && "sm:border-l sm:border-border",
                )}
              >
                <p className="text-[10px] text-muted-foreground">
                  {metric.label}
                </p>
                <p className="mt-2 text-[22px] font-semibold">{metric.value}</p>
              </div>
            ))}
          </div>

          {workflows.length === 0 ? (
            <div className="mt-7">
              <EmptyAutomationState
                icon={Workflow}
                title="No automations for this form"
                description="Create a trigger, add conditions, and connect the actions this form should run."
                action={
                  <Button type="button" onClick={openCreate}>
                    <Plus className="h-4 w-4" />
                    Create automation
                  </Button>
                }
              />
            </div>
          ) : (
            <div className="mt-7 overflow-x-auto border-y border-border">
              <div className="grid min-w-[960px] grid-cols-[minmax(220px,1.5fr)_180px_minmax(170px,1fr)_100px_135px_92px_44px] border-b border-border px-3 py-3 text-[10px] font-semibold uppercase text-muted-foreground">
                <span>Automation</span>
                <span>Project</span>
                <span>Trigger</span>
                <span>Actions</span>
                <span>Last run</span>
                <span>Status</span>
                <span />
              </div>
              {workflows.map((workflow) => (
                <div
                  key={workflow.id}
                  className="grid min-w-[960px] grid-cols-[minmax(220px,1.5fr)_180px_minmax(170px,1fr)_100px_135px_92px_44px] items-center border-b border-border px-3 py-4 last:border-b-0 hover:bg-muted/20"
                >
                  <button
                    type="button"
                    onClick={() => openEdit(workflow)}
                    className="min-w-0 pr-4 text-left"
                  >
                    <span className="block truncate text-[13px] font-medium">
                      {workflow.name}
                    </span>
                    <span className="mt-1 block truncate text-[10px] text-muted-foreground">
                      {workflow.description || `${workflow.conditions.length} conditions`}
                    </span>
                  </button>
                  {/* Same optional Project field the forms list and event
                      settings carry, so all three item types file the same way. */}
                  <ProjectPicker
                    kind="workflow"
                    itemId={workflow.id}
                    projectId={workflow.projectId}
                    userId={userId}
                    className="mr-4 h-7 max-w-[170px] px-2 text-[10px]"
                  />
                  <span className="pr-4 text-[11px] text-muted-foreground">
                    {triggerLabel(workflow.triggerEvent)}
                  </span>
                  <span className="text-[11px]">
                    {workflow.actions.length}
                  </span>
                  <div>
                    <p className="text-[10px] text-muted-foreground">
                      {formatDate(workflow.lastRunAt)}
                    </p>
                    {workflow.lastRunStatus && (
                      <span
                        className={cn(
                          "mt-1 inline-flex rounded px-1.5 py-0.5 text-[9px] font-medium capitalize",
                          runStatusClasses(workflow.lastRunStatus),
                        )}
                      >
                        {workflow.lastRunStatus}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={workflow.enabled}
                      onCheckedChange={(enabled) =>
                        void toggleWorkflow(workflow, enabled)
                      }
                      aria-label={`Toggle ${workflow.name}`}
                    />
                    <span className="text-[10px] text-muted-foreground">
                      {workflow.enabled ? "On" : "Off"}
                    </span>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Actions for ${workflow.name}`}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      <DropdownMenuItem onClick={() => openEdit(workflow)}>
                        <Pencil className="mr-2 h-4 w-4" />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => void duplicateWorkflow(workflow)}
                      >
                        <Copy className="mr-2 h-4 w-4" />
                        Duplicate
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => void removeWorkflow(workflow)}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {section === "activity" && (
        <div className="mt-7">
          {activityLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-16 w-full rounded-md" />
              ))}
            </div>
          ) : runs.length === 0 ? (
            <EmptyAutomationState
              icon={Activity}
              title="No automation runs"
              description="Run history appears after this form receives a matching response."
            />
          ) : (
            <div className="overflow-x-auto border-y border-border">
              <div className="grid min-w-[720px] grid-cols-[minmax(210px,1.5fr)_150px_100px_120px_minmax(180px,1fr)] border-b border-border px-3 py-3 text-[10px] font-semibold uppercase text-muted-foreground">
                <span>Automation</span>
                <span>Started</span>
                <span>Steps</span>
                <span>Status</span>
                <span>Result</span>
              </div>
              {runs.map((run) => (
                <div
                  key={run.id}
                  className="grid min-w-[720px] grid-cols-[minmax(210px,1.5fr)_150px_100px_120px_minmax(180px,1fr)] items-center border-b border-border px-3 py-4 text-[11px] last:border-b-0"
                >
                  <div className="min-w-0 pr-4">
                    <p className="truncate font-medium">{run.workflowName}</p>
                    <p className="mt-1 truncate text-[10px] text-muted-foreground">
                      {triggerLabel(run.triggerEvent)}
                    </p>
                  </div>
                  <span className="text-[10px] text-muted-foreground">
                    {formatDate(run.startedAt || run.createdAt)}
                  </span>
                  <span>{run.steps.length}</span>
                  <span
                    className={cn(
                      "w-fit rounded px-2 py-1 text-[9px] font-medium capitalize",
                      runStatusClasses(run.status),
                    )}
                  >
                    {run.status}
                  </span>
                  <span className="truncate text-[10px] text-muted-foreground">
                    {friendlyRunError(run.errorMessage) ||
                      `${run.steps.filter((step) => step.status === "succeeded").length} completed`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {section === "integrations" && (
        <div className="mt-7 rounded-xl border border-border bg-card p-5 sm:p-6">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Plug className="h-5 w-5" />
              </span>
              <div>
                <h3 className="text-[15px] font-semibold">Connections are managed centrally</h3>
                <p className="mt-1 max-w-xl text-[12px] leading-5 text-muted-foreground">
                  Use the Workspace Tools integration hub for the single provider directory and connection health. Connected providers appear automatically in compatible automation actions.
                </p>
              </div>
            </div>
            <Button type="button" variant="outline" asChild>
              <a href="/dashboard?tab=integrations&section=directory">
                Open integrations hub
                <ExternalLink className="ml-2 h-4 w-4" />
              </a>
            </Button>
          </div>
          <div className="mt-5 grid gap-3 border-t border-border pt-5 sm:grid-cols-3">
            <div><p className="text-xs font-medium text-foreground">One provider directory</p><p className="mt-1 text-[11px] leading-5 text-muted-foreground">No duplicate forms-only catalog.</p></div>
            <div><p className="text-xs font-medium text-foreground">Automatic availability</p><p className="mt-1 text-[11px] leading-5 text-muted-foreground">Connected providers appear in compatible actions.</p></div>
            <div><p className="text-xs font-medium text-foreground">Safe execution logs</p><p className="mt-1 text-[11px] leading-5 text-muted-foreground">Secrets and payloads stay off the browser.</p></div>
          </div>
        </div>
      )}

      <WorkflowEditorDialog
        connections={connections}
        contactLists={contactLists}
        draft={draft}
        emailTemplates={emailTemplates}
        editing={editing}
        form={form}
        forms={forms}
        onChange={setDraft}
        onCreateContactList={createContactList}
        onOpenChange={(open) => {
          if (!workflowWorking) setEditorOpen(open);
        }}
        onSave={saveWorkflow}
        onSelectForm={onSelectForm}
        open={editorOpen}
        providers={providers}
        working={workflowWorking}
      />

      <ConnectionEditorDialog
        connection={editingConnection}
        onOpenChange={(open) => {
          if (!connectionWorking) setConnectionOpen(open);
        }}
        onSave={saveConnection}
        open={connectionOpen}
        working={connectionWorking}
      />

      {providerToConnect && (
        <SecureConnectionDialog
          open
          name={providerToConnect.name}
          description={providerToConnect.description}
          logoUrl={providerToConnect.logoUrl}
          onOpenChange={(open) => {
            if (!open) setProviderToConnect(null);
          }}
          prepareConnection={() =>
            beginAutomationProviderConnection(
              providerToConnect.id,
              window.location.href,
            )
          }
          onConnected={async () => {
            await loadWorkspaceData();
            toast({
              title: `${providerToConnect.name} connected`,
              description: "The account is ready to use in form automations.",
            });
          }}
        />
      )}
    </div>
  );
}
