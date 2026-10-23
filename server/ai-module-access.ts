/**
 * Workspace-level controls for MaxAI.
 *
 * The dashboard permission is checked first. These settings are a second,
 * explicit AI boundary: a workspace owner can let someone use Forms while
 * keeping AI away from Payments, even when that person can open Payments in
 * the normal product. Missing rows intentionally mean enabled so the feature
 * is backwards-compatible while migration 111 is rolling out.
 */
import { neon } from "@neondatabase/serverless";

import {
  WORKSPACE_MODULE_DESCRIPTIONS,
  WORKSPACE_MODULE_KEYS,
  WORKSPACE_MODULE_LABELS,
  isWorkspaceModuleKey,
  type WorkspaceModuleKey,
} from "../src/lib/workspace-modules";
import {
  canManageWorkspace,
  canOpenModule,
  type WorkspaceContext,
} from "./workspace-access";

export type AiModuleAccessSetting = {
  module: WorkspaceModuleKey;
  label: string;
  description: string;
  accessEnabled: boolean;
  dashboardAllowed: boolean;
  requiresConfirmationFor: string[];
  updatedAt: string | null;
};

const DEFAULT_CONFIRMATIONS: Partial<Record<WorkspaceModuleKey, string[]>> = {
  campaigns: ["send_campaign"],
  documents: ["send_reminder"],
  emails: ["send_email"],
  events: ["publish_event"],
  forms: ["publish_form"],
  payments: ["issue_refund"],
};

const database = () => {
  const url = String(process.env.DATABASE_URL || "").trim();
  return url ? neon(url) : null;
};

const defaultsFor = (context: WorkspaceContext) =>
  WORKSPACE_MODULE_KEYS.map((module) => ({
    module,
    label: WORKSPACE_MODULE_LABELS[module],
    description: WORKSPACE_MODULE_DESCRIPTIONS[module],
    accessEnabled: true,
    dashboardAllowed:
      !context.suspended &&
      !context.blocked &&
      (context.allowedModules === null ||
        module === "home" ||
        module === "settings" ||
        context.allowedModules.includes(module)),
    requiresConfirmationFor: [ ...(DEFAULT_CONFIRMATIONS[module] || []) ],
    updatedAt: null,
  } satisfies AiModuleAccessSetting));

/** Reads settings with a safe default for deployments before migration 111. */
export const aiModuleAccessFor = async (
  context: WorkspaceContext,
): Promise<AiModuleAccessSetting[]> => {
  const settings = defaultsFor(context);
  const sql = database();
  if (!sql || process.env.NODE_ENV === "test") return settings;

  try {
    const rows = (await sql.query(
      `SELECT module, access_enabled, requires_confirmation_for, updated_at
       FROM ai_module_access_settings
       WHERE workspace_id = $1`,
      [context.workspaceId],
    )) as Array<Record<string, unknown>>;
    const byModule = new Map(
      rows
        .filter((row) => isWorkspaceModuleKey(row.module))
        .map((row) => [String(row.module), row]),
    );
    return settings.map((setting) => {
      const row = byModule.get(setting.module);
      return row
        ? {
            ...setting,
            accessEnabled: row.access_enabled !== false,
            requiresConfirmationFor: Array.isArray(
              row.requires_confirmation_for,
            )
              ? row.requires_confirmation_for.filter(
                  (value): value is string => typeof value === "string",
                )
              : setting.requiresConfirmationFor,
            updatedAt: row.updated_at ? String(row.updated_at) : null,
          }
        : setting;
    });
  } catch {
    // An older deployment should keep the assistant useful until the migration
    // has been applied. The setting screen still makes the missing rows clear.
    return settings;
  }
};

export const aiModuleAccessEnabled = async (
  context: WorkspaceContext,
  module: WorkspaceModuleKey,
  settings?: AiModuleAccessSetting[],
) => {
  if (!(await canOpenModule(context.userId, module))) return false;
  const list = settings || (await aiModuleAccessFor(context));
  return list.find((entry) => entry.module === module)?.accessEnabled !== false;
};

export const saveAiModuleAccess = async (
  context: WorkspaceContext,
  module: WorkspaceModuleKey,
  accessEnabled: boolean,
  requiresConfirmationFor: string[],
) => {
  if (!canManageWorkspace(context)) {
    throw new Error("Only a workspace owner or admin can change AI settings.");
  }
  const sql = database();
  if (!sql) throw new Error("AI settings are temporarily unavailable.");
  const rows = (await sql.query(
    `INSERT INTO ai_module_access_settings
       (workspace_id, module, access_enabled, requires_confirmation_for, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (workspace_id, module) DO UPDATE SET
       access_enabled = EXCLUDED.access_enabled,
       requires_confirmation_for = EXCLUDED.requires_confirmation_for,
       updated_by = EXCLUDED.updated_by,
       updated_at = NOW()
     RETURNING module, access_enabled, requires_confirmation_for, updated_at`,
    [
      context.workspaceId,
      module,
      accessEnabled,
      [...new Set(requiresConfirmationFor)].slice(0, 20),
      context.userId,
    ],
  )) as Array<Record<string, unknown>>;
  const row = rows[0];
  return {
    module,
    accessEnabled: row?.access_enabled !== false,
    requiresConfirmationFor: Array.isArray(row?.requires_confirmation_for)
      ? row.requires_confirmation_for.filter(
          (value): value is string => typeof value === "string",
        )
      : [],
    updatedAt: row?.updated_at ? String(row.updated_at) : null,
  };
};

export const isAiModuleKey = (value: unknown): value is WorkspaceModuleKey =>
  isWorkspaceModuleKey(value);

