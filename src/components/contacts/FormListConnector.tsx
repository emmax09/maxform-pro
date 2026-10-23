import {
  CheckCircle2,
  ContactRound,
  Link2,
  Loader2,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { FormField, FormRecord } from "@/components/forms/form-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import {
  deleteFormListMapping,
  listContactCustomFields,
  listContactLists,
  listFormListMappings,
  saveFormListMapping,
  saveContactList,
  type ContactCustomField,
  type ContactListRecord,
  type FormListMapping,
} from "@/lib/contacts";

const responseFields = (form: FormRecord) =>
  form.fields.filter(
    (field) =>
      !["section", "pageBreak", "heading", "divider"].includes(field.type),
  );

const inferredFieldId = (
  fields: FormField[],
  predicate: (field: FormField) => boolean,
) => fields.find(predicate)?.id || "";

function FieldMappingSelect({
  fields,
  label,
  onChange,
  required,
  value,
}: {
  fields: FormField[];
  label: string;
  onChange: (value: string) => void;
  required?: boolean;
  value: string;
}) {
  return (
    <div className="space-y-2">
      <Label>
        {label}
        {required ? " *" : ""}
      </Label>
      <Select value={value || "__none"} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {!required && <SelectItem value="__none">Do not map</SelectItem>}
          {fields.map((field) => (
            <SelectItem key={field.id} value={field.id}>
              {field.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function FormListConnector({
  form,
  userId,
  variant = "form",
}: {
  form: FormRecord;
  userId?: string;
  variant?: "form" | "event-leads";
}) {
  const { toast } = useToast();
  const fields = useMemo(() => responseFields(form), [form]);
  const [lists, setLists] = useState<ContactListRecord[]>([]);
  const [customFields, setCustomFields] = useState<ContactCustomField[]>([]);
  const [mappings, setMappings] = useState<FormListMapping[]>([]);
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const [listId, setListId] = useState("");
  const [newListName, setNewListName] = useState("");
  const [matchMode, setMatchMode] =
    useState<"email" | "email_phone">("email");
  const [fieldMapping, setFieldMapping] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const [nextLists, nextFields, nextMappings] = await Promise.all([
        listContactLists(userId),
        listContactCustomFields(userId),
        listFormListMappings(userId, form.id),
      ]);
      setLists(nextLists);
      setCustomFields(nextFields.filter((field) => field.formMappable));
      setMappings(nextMappings);
    } catch (error) {
      toast({
        title: "Contact connections could not be loaded",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      });
    }
  }, [form.id, toast, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const openConnector = () => {
    const available = lists.find(
      (list) =>
        list.listType === "static" &&
        !mappings.some((mapping) => mapping.listId === list.id),
    );
    setListId(available?.id || "__create");
    setNewListName("");
    setMatchMode("email");
    setFieldMapping({
      email: inferredFieldId(fields, (field) => field.type === "email"),
      fullName: inferredFieldId(fields, (field) => /name/i.test(field.label)),
      phone: inferredFieldId(fields, (field) => field.type === "phone"),
      company: inferredFieldId(fields, (field) =>
        /company|organization|organisation/i.test(field.label),
      ),
    });
    setOpen(true);
  };

  const save = async () => {
    if (
      !userId ||
      !listId ||
      !fieldMapping.email ||
      (listId === "__create" && !newListName.trim())
    )
      return;
    setWorking(true);
    try {
      const targetListId =
        listId === "__create"
          ? (
              await saveContactList(userId, {
                name: newListName,
                description: `Contacts collected by ${form.title}`,
                listType: "static",
              })
            ).id
          : listId;
      await saveFormListMapping(userId, {
        formId: form.id,
        listId: targetListId,
        matchMode,
        fieldMapping: Object.fromEntries(
          Object.entries(fieldMapping).filter(
            ([, fieldId]) => fieldId && fieldId !== "__none",
          ),
        ),
      });
      setOpen(false);
      toast({
        title:
          variant === "event-leads"
            ? "Event lead collection enabled"
            : "Contact list connected",
      });
      await load();
    } catch (error) {
      toast({
        title: "Contact list was not connected",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setWorking(false);
    }
  };

  const setLeadCollection = async (enabled: boolean) => {
    if (!userId || working) return;
    if (enabled) {
      openConnector();
      return;
    }
    setOpen(false);
    if (mappings.length === 0) return;
    setWorking(true);
    try {
      await Promise.all(
        mappings.map((mapping) =>
          deleteFormListMapping(userId, mapping.id),
        ),
      );
      toast({ title: "Event lead collection disabled" });
      await load();
    } catch {
      toast({
        title: "Lead collection could not be updated",
        description: "Please try again.",
        variant: "destructive",
      });
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="min-w-0">
      {variant === "event-leads" && (
        <div className="flex items-start justify-between gap-5 border-y border-border py-5">
          <div className="flex min-w-0 gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <ContactRound className="h-4 w-4" />
            </span>
            <div>
              <Label htmlFor={`event-leads-${form.id}`} className="text-[13px]">
                Collect event leads
              </Label>
              <p className="mt-1 max-w-[560px] text-[11px] leading-5 text-muted-foreground">
                Create or update CRM contacts from completed registrations and
                route them into one contact list.
              </p>
            </div>
          </div>
          <Switch
            id={`event-leads-${form.id}`}
            checked={mappings.length > 0 || open}
            onCheckedChange={(checked) => void setLeadCollection(checked)}
            disabled={working}
            aria-label="Collect event leads"
          />
        </div>
      )}

      <div className="space-y-3">
        {mappings.map((mapping) => (
          <div
            key={mapping.id}
            className="flex items-center justify-between gap-4 border-b border-border py-3 first:border-t"
          >
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-[12px] font-medium">
                  {mapping.listName}
                </p>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {Object.keys(mapping.fieldMapping).length} mapped fields ·{" "}
                  {mapping.matchMode === "email_phone"
                    ? "email and phone matching"
                    : "email matching"}
                  {" · "}
                  {mapping.addedCount} added from this form
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={async () => {
                if (!userId) return;
                await deleteFormListMapping(userId, mapping.id);
                toast({ title: "Contact list disconnected" });
                await load();
              }}
              aria-label={`Disconnect ${mapping.listName}`}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        {variant === "form" && (
          <Button
            type="button"
            variant="outline"
            onClick={openConnector}
            disabled={!userId || fields.length === 0}
          >
            <Plus className="h-4 w-4" />
            Connect contact list
          </Button>
        )}
      </div>

      {open && (
        <div className="mt-5 border-y border-border py-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h4 className="text-[13px] font-semibold">
                {variant === "event-leads"
                  ? "Choose where event leads go"
                  : "Connect a contact list"}
              </h4>
              <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
                Name, email, and phone fields are detected from the registration
                form. You can review the mapping before enabling the connection.
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setOpen(false)}
              disabled={working}
              aria-label="Close contact list connector"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="grid gap-5 py-2 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Destination list</Label>
              <Select value={listId} onValueChange={setListId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a list" />
                </SelectTrigger>
                <SelectContent>
                  {lists
                    .filter(
                      (list) =>
                        list.listType === "static" &&
                        !mappings.some(
                          (mapping) => mapping.listId === list.id,
                        ),
                    )
                    .map((list) => (
                      <SelectItem key={list.id} value={list.id}>
                        {list.name} · {list.listType}
                      </SelectItem>
                    ))}
                  <SelectItem value="__create">+ Create new list</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Match existing contacts</Label>
              <Select
                value={matchMode}
                onValueChange={(value: "email" | "email_phone") =>
                  setMatchMode(value)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">By email</SelectItem>
                  <SelectItem value="email_phone">By email and phone</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {listId === "__create" && (
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="form-contact-new-list">New list name</Label>
                <Input
                  id="form-contact-new-list"
                  value={newListName}
                  onChange={(event) => setNewListName(event.target.value)}
                  placeholder={`${form.title} contacts`}
                />
              </div>
            )}

            <div className="border-t border-border pt-5 sm:col-span-2">
              <div className="mb-4 flex items-center gap-2">
                <Link2 className="h-4 w-4 text-primary" />
                <p className="text-[12px] font-medium">Field mapping</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <FieldMappingSelect
                  fields={fields}
                  label="Email"
                  required
                  value={fieldMapping.email || ""}
                  onChange={(value) =>
                    setFieldMapping({ ...fieldMapping, email: value })
                  }
                />
                <FieldMappingSelect
                  fields={fields}
                  label="Full name"
                  value={fieldMapping.fullName || ""}
                  onChange={(value) =>
                    setFieldMapping({ ...fieldMapping, fullName: value })
                  }
                />
                <FieldMappingSelect
                  fields={fields}
                  label="Phone"
                  value={fieldMapping.phone || ""}
                  onChange={(value) =>
                    setFieldMapping({ ...fieldMapping, phone: value })
                  }
                />
                <FieldMappingSelect
                  fields={fields}
                  label="Company"
                  value={fieldMapping.company || ""}
                  onChange={(value) =>
                    setFieldMapping({ ...fieldMapping, company: value })
                  }
                />
                {customFields.map((field) => (
                  <FieldMappingSelect
                    key={field.id}
                    fields={fields}
                    label={field.label}
                    value={fieldMapping[field.fieldKey] || ""}
                    onChange={(value) =>
                      setFieldMapping({
                        ...fieldMapping,
                        [field.fieldKey]: value,
                      })
                    }
                  />
                ))}
              </div>
            </div>
          </div>
          <div className="mt-5 flex justify-end gap-2 border-t border-border pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={working}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void save()}
              disabled={
                working ||
                !listId ||
                !fieldMapping.email ||
                (listId === "__create" && !newListName.trim())
              }
            >
              {working ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Link2 className="h-4 w-4" />
              )}
              Connect list
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
