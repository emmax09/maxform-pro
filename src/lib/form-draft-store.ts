import type { FormRecord } from "@/components/forms/form-types";

type FormDraftBackup = {
  form: FormRecord;
  storedAt: number;
};

export type RestoredFormDraft = {
  form: FormRecord;
  restored: boolean;
};

export const activeFormEditorKey = (userId: string) =>
  `maxform:active-form-editor:${userId}`;

export const formDraftKey = (userId: string, formId: string) =>
  `maxform:form-draft:${userId}:${formId}`;

function readBackup(
  storage: Storage,
  userId: string,
  formId: string,
): FormDraftBackup | null {
  try {
    const parsed = JSON.parse(
      storage.getItem(formDraftKey(userId, formId)) || "null",
    ) as FormDraftBackup | null;
    if (
      !parsed ||
      !Number.isFinite(parsed.storedAt) ||
      parsed.form?.id !== formId
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function storeFormDraft(
  storage: Storage,
  userId: string,
  form: FormRecord,
) {
  try {
    storage.setItem(
      formDraftKey(userId, form.id),
      JSON.stringify({ form, storedAt: Date.now() } satisfies FormDraftBackup),
    );
    return true;
  } catch {
    return false;
  }
}

export function clearFormDraft(
  storage: Storage,
  userId: string,
  formId: string,
) {
  try {
    storage.removeItem(formDraftKey(userId, formId));
  } catch {
    // A successful database save is sufficient when storage is unavailable.
  }
}

export function restoreFormDraft(
  storage: Storage,
  userId: string,
  databaseForm: FormRecord,
): RestoredFormDraft {
  const backup = readBackup(storage, userId, databaseForm.id);
  if (!backup) return { form: databaseForm, restored: false };

  return {
    form: {
      ...backup.form,
      id: databaseForm.id,
      createdBy: databaseForm.createdBy,
      createdAt: databaseForm.createdAt,
      responseCount: databaseForm.responseCount,
      updatedAt: databaseForm.updatedAt,
    },
    restored: true,
  };
}
