import {
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useTheme } from "next-themes";
import {
  Ban,
  Banknote,
  Bell,
  Bot,
  Building2,
  CalendarDays,
  Camera,
  Check,
  ChevronRight,
  CircleDollarSign,
  CirclePause,
  CirclePlay,
  Copy,
  Database,
  Download,
  Eye,
  EyeOff,
  FileText,
  Hash,
  KeyRound,
  Laptop,
  Loader2,
  LockKeyhole,
  LogOut,
  Mail,
  Monitor,
  Moon,
  MoreHorizontal,
  Paintbrush,
  Pipette,
  ReceiptText,
  ScrollText,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  Sun,
  Trash2,
  UserMinus,
  UserPlus,
  UsersRound,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { parsePhoneNumber, type Country } from "react-phone-number-input";

import {
  AI_CREDIT_COSTS,
  AI_CREDIT_PACKS,
  CREDIT_ROLLOVER_DAYS,
  EMAIL_ALLOWANCE_RULE,
  EMAIL_PACKS,
  STORAGE_PACKS,
  UNCAPPED,
  formatAllowance,
  formatBytes,
  formatPlanPrice,
  planById,
  remainingAllowance,
  usagePercent,
  type AddOnPack,
  type Allowance,
} from "@/lib/pricing";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  CountryFlagIcon,
  CountrySelect,
  countryCodeFromValue,
  countryNameForCode,
} from "@/components/ui/country-select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PhoneInput } from "@/components/ui/phone-input";
import { Progress } from "@/components/ui/progress";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { useWorkspaceRegion } from "@/contexts/WorkspaceRegionContext";
import { storeWorkspaceIdentity } from "@/hooks/use-workspace-logo";
import { toast } from "@/hooks/use-toast";
import {
  BRAND_COLOR_PRESETS,
  brandColorToHsl,
  DEFAULT_BRAND_COLOR,
  normalizeBrandColor,
} from "@/lib/brand-color";
import {
  countryCurrencyOption,
  countryCurrencyOptions,
  formatCurrency,
  timezoneOptions,
} from "@/lib/regional-options";
import { getCountryCities, getCountryStates } from "@/lib/geo-address";
import { uploadFileToStorage } from "@/lib/storage";
import {
  addWorkspaceMember,
  deleteMemberAccount,
  deleteUserAccount,
  getNotificationSettings,
  getPendingInvitations,
  getUsageStats,
  getMemberActivity,
  getWorkspaceMembers,
  getWorkspaceSettings,
  removeWorkspaceMember,
  resetMemberCredentials,
  revokeInvitation,
  setMemberBlocked,
  setMemberPassword,
  saveNotificationSettings,
  saveWorkspaceSettings,
  updateProfileSettings,
  updateWorkspaceMember,
  type MemberCredentials,
  type MemberMutationResult,
  type NotificationSettings,
  type MemberActivityEvent,
  type PendingInvitation,
  type ProfileSettings,
  type UsageStats,
  type WorkspaceMember,
  type WorkspaceRole,
  type WorkspaceSettings,
} from "@/lib/settings";
import { cn } from "@/lib/utils";
import {
  ASSIGNABLE_MODULE_KEYS,
  describeModuleAccess,
  WORKSPACE_STANDARD_MODULE_KEYS,
  WORKSPACE_TOOL_MODULE_KEYS,
  WORKSPACE_MODULE_DESCRIPTIONS,
  WORKSPACE_MODULE_LABELS,
} from "@/lib/workspace-modules";
import type { SearchableSelectOption } from "@/components/ui/searchable-select";

type SettingsSection =
  | "workspace"
  | "currency"
  | "team"
  | "notifications"
  | "appearance"
  | "security"
  | "billing"
  | "data";

interface LocalUserSettings {
  brandColor: string;
  dateFormat: string;
  inAppNotifications: boolean;
  language: string;
  productUpdates: boolean;
  reduceMotion: boolean;
  securityAlerts: boolean;
  startPage: string;
  timezone: string;
  weekStart: string;
}

interface SettingsNavItem {
  icon: LucideIcon;
  key: SettingsSection;
  label: string;
}

const navGroups: Array<{ label: string; items: SettingsNavItem[] }> = [
  {
    label: "Account",
    items: [
      { key: "workspace", label: "General", icon: Building2 },
      { key: "notifications", label: "Notifications", icon: Bell },
      { key: "appearance", label: "Appearance", icon: Paintbrush },
      { key: "security", label: "Security", icon: ShieldCheck },
    ],
  },
  {
    label: "Workspace",
    items: [
      { key: "currency", label: "Currency", icon: Banknote },
      { key: "team", label: "Members", icon: UsersRound },
      { key: "billing", label: "Billing & usage", icon: CircleDollarSign },
    ],
  },
  {
    label: "Advanced",
    items: [{ key: "data", label: "Data & privacy", icon: Database }],
  },
];

const allSections = navGroups.flatMap((group) => group.items);

/**
 * Sections that change the workspace rather than the person looking at it.
 * A member can read their own profile, theme and notifications; renaming the
 * company, moving its currency, or provisioning another member is the owner's
 * and admins' to do, and the server refuses these writes for anyone else.
 */
const workspaceAdminSections: SettingsSection[] = [
  "currency",
  "team",
  "billing",
];

const sectionsForRole = (canManageWorkspace: boolean) =>
  canManageWorkspace
    ? navGroups
    : navGroups
        .map((group) => ({
          ...group,
          items: group.items.filter(
            (item) => !workspaceAdminSections.includes(item.key),
          ),
        }))
        .filter((group) => group.items.length > 0);

const sectionMeta: Record<
  SettingsSection,
  { description: string; title: string }
> = {
  workspace: {
    title: "General",
    description: "Workspace identity and branding",
  },
  currency: {
    title: "Currency",
    description: "The default currency used across this workspace",
  },
  team: {
    title: "Members",
    description: "Workspace access and pending invitations",
  },
  notifications: {
    title: "Notifications",
    description: "Submission, workflow and account alerts",
  },
  appearance: {
    title: "Appearance",
    description: "Theme, region and dashboard defaults",
  },
  security: {
    title: "Security",
    description: "Password and active session",
  },
  billing: {
    title: "Billing & usage",
    description: "Credit allocation and workspace activity",
  },
  data: {
    title: "Data & privacy",
    description: "Account export and deletion",
  },
};

const defaultLocalSettings = (): LocalUserSettings => ({
  brandColor: DEFAULT_BRAND_COLOR,
  dateFormat: "MMM d, yyyy",
  inAppNotifications: true,
  language: "en",
  productUpdates: false,
  reduceMotion: false,
  securityAlerts: true,
  startPage: "overview",
  timezone:
    typeof Intl !== "undefined"
      ? Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
      : "UTC",
  weekStart: "monday",
});

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong.";

const inputClassName = "h-10 text-[14px]";

const workspaceTimezoneOptions: SearchableSelectOption[] = timezoneOptions.map(
  (option) => ({
    value: option.value,
    label: option.label,
    description: [option.offset, option.countries.slice(0, 2).join(", ")]
      .filter(Boolean)
      .join(" · "),
    keywords: `${option.value} ${option.countries.join(" ")} ${option.offset}`,
  }),
);

const composeBusinessAddress = (settings: WorkspaceSettings) =>
  [
    settings.addressLine1,
    settings.addressLine2,
    [settings.city, settings.stateRegion].filter(Boolean).join(", "),
    settings.postalCode,
    settings.country,
  ]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(", ");

const normalizeWorkspaceSettings = (
  settings: WorkspaceSettings,
): WorkspaceSettings => {
  const normalized = {
    ...settings,
    addressLine1: settings.addressLine1 || settings.address || "",
    addressLine2: settings.addressLine2 || "",
    city: settings.city || "",
    country: settings.country || "",
    postalCode: settings.postalCode || "",
    stateRegion: settings.stateRegion || "",
  };
  return {
    ...normalized,
    address: composeBusinessAddress(normalized) || settings.address || "",
  };
};

function prepareImageFile(file: File) {
  return new Promise<Blob>((resolve, reject) => {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      reject(new Error("Choose a JPG, PNG or WebP image."));
      return;
    }

    if (file.size > 1.5 * 1024 * 1024) {
      reject(new Error("Choose an image smaller than 1.5 MB."));
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      const maxDimension = 512;
      const scale = Math.min(
        1,
        maxDimension / Math.max(image.naturalWidth, image.naturalHeight),
      );
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d");

      if (!context) {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("The image could not be processed."));
        return;
      }

      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(objectUrl);
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(blob)
            : reject(new Error("The image could not be processed.")),
        "image/webp",
        0.88,
      );
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("The image could not be read."));
    };
    image.src = objectUrl;
  });
}

function SettingsBlock({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <section className="border-b border-border py-7 first:pt-0 last:border-b-0">
      <h2 className="mb-5 text-[16px] font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

function SavingButton({
  children,
  loading,
  ...props
}: React.ComponentProps<typeof Button> & { loading?: boolean }) {
  return (
    <Button {...props} loading={loading}>
      {children}
    </Button>
  );
}

function WorkspaceSection({
  localSettings,
  setLocalSettings,
  saveLocalSettings,
}: {
  localSettings: LocalUserSettings;
  saveLocalSettings: (settings?: LocalUserSettings) => void;
  setLocalSettings: React.Dispatch<React.SetStateAction<LocalUserSettings>>;
}) {
  const { profile, refreshProfile, user } = useAuth();
  const {
    currency,
    currencyCountryCode,
    saveRegion,
    timezone: workspaceTimezone,
  } = useWorkspaceRegion();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [timezoneDraft, setTimezoneDraft] = useState(workspaceTimezone || "UTC");
  const [brandHexInput, setBrandHexInput] = useState(
    normalizeBrandColor(localSettings.brandColor),
  );
  const [form, setForm] = useState<WorkspaceSettings>({
    address: "",
    addressLine1: "",
    addressLine2: "",
    brandColor: DEFAULT_BRAND_COLOR,
    city: "",
    companyLogoUrl: null,
    companyName: "",
    companySize: "",
    companyWebsite: "",
    country: "",
    industry: "",
    phone: "",
    postalCode: "",
    stateRegion: "",
  });
  const [profileForm, setProfileForm] = useState<ProfileSettings>({
    avatarUrl: null,
    bio: "",
    company: "",
    country: "",
    fullName: "",
    jobTitle: "",
    phone: "",
  });
  const [stateOptions, setStateOptions] = useState<SearchableSelectOption[]>(
    [],
  );
  const [cityOptions, setCityOptions] = useState<SearchableSelectOption[]>([]);
  const [addressOptionsLoading, setAddressOptionsLoading] = useState({
    cities: false,
    states: false,
  });

  useEffect(() => {
    if (workspaceTimezone) setTimezoneDraft(workspaceTimezone);
  }, [workspaceTimezone]);

  useEffect(() => {
    setProfileForm({
      avatarUrl: profile?.avatar_url || null,
      bio: profile?.bio || "",
      company: profile?.company || "",
      country: profile?.country || "",
      fullName: profile?.full_name || user?.full_name || "",
      jobTitle: profile?.job_title || "",
      phone: profile?.phone || user?.phone || "",
    });
  }, [profile, user]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    const logoStorageKey = `maxform-workspace-logo:${user.id}`;
    const localLogo = localStorage.getItem(logoStorageKey);
    if (localLogo !== null) {
      setForm((current) => ({
        ...current,
        companyLogoUrl: localLogo || null,
      }));
    }

      getWorkspaceSettings(user.id)
      .then((settings) => {
        if (active) {
          setForm({
            ...normalizeWorkspaceSettings(settings),
            companyLogoUrl:
              localLogo !== null ? localLogo || null : settings.companyLogoUrl,
          });
          setLocalSettings((current) => ({
            ...current,
            brandColor: normalizeBrandColor(settings.brandColor),
          }));
        }
      })
      .catch((error) => {
        toast({
          title: "Workspace could not be loaded",
          description: getErrorMessage(error),
          variant: "destructive",
        });
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [setLocalSettings, user]);

  useEffect(() => {
    setBrandHexInput(normalizeBrandColor(localSettings.brandColor));
  }, [localSettings.brandColor]);

  const update = (key: keyof WorkspaceSettings, value: string | null) => {
    setForm((current) => ({ ...current, [key]: value }));
  };
  const updateProfile = (key: keyof ProfileSettings, value: string | null) => {
    setProfileForm((current) => ({ ...current, [key]: value }));
  };
  const selectedBusinessCountry = countryCodeFromValue(form.country) as
    | Country
    | undefined;
  const selectedProfileCountry = countryCodeFromValue(profileForm.country) as
    | Country
    | undefined;
  const selectedPhoneCountry =
    selectedProfileCountry ||
    selectedBusinessCountry ||
    (profileForm.phone
      ? parsePhoneNumber(profileForm.phone)?.country
      : undefined);

  useEffect(() => {
    if (!selectedBusinessCountry) {
      setStateOptions([]);
      setCityOptions([]);
      setAddressOptionsLoading({ cities: false, states: false });
      return;
    }
    let cancelled = false;
    setAddressOptionsLoading((current) => ({ ...current, states: true }));
    void getCountryStates(selectedBusinessCountry)
      .then((options) => {
        if (!cancelled) setStateOptions(options);
      })
      .catch(() => {
        if (!cancelled) setStateOptions([]);
      })
      .finally(() => {
        if (!cancelled) {
          setAddressOptionsLoading((current) => ({
            ...current,
            states: false,
          }));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedBusinessCountry]);

  const selectedStateOption = stateOptions.find(
    (state) =>
      state.value.toLowerCase() === form.stateRegion.trim().toLowerCase() ||
      state.label.toLowerCase() === form.stateRegion.trim().toLowerCase(),
  );
  const selectedStateCode = selectedStateOption?.value || "";

  useEffect(() => {
    if (
      !selectedBusinessCountry ||
      (!selectedStateCode && stateOptions.length > 0)
    ) {
      setCityOptions([]);
      setAddressOptionsLoading((current) => ({ ...current, cities: false }));
      return;
    }
    let cancelled = false;
    setAddressOptionsLoading((current) => ({ ...current, cities: true }));
    void getCountryCities(selectedBusinessCountry, selectedStateCode)
      .then((options) => {
        if (!cancelled) setCityOptions(options);
      })
      .catch(() => {
        if (!cancelled) setCityOptions([]);
      })
      .finally(() => {
        if (!cancelled) {
          setAddressOptionsLoading((current) => ({
            ...current,
            cities: false,
          }));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedBusinessCountry, selectedStateCode, stateOptions.length]);

  const selectedCityValue =
    cityOptions.find(
      (city) => city.value.toLowerCase() === form.city.trim().toLowerCase(),
    )?.value || "";

  const selectBrandColor = (color: string) => {
    const normalized = normalizeBrandColor(color);
    const nextSettings = {
      ...localSettings,
      brandColor: normalized,
    };
    setForm((current) => ({ ...current, brandColor: normalized }));
    setLocalSettings(nextSettings);
    saveLocalSettings(nextSettings);
  };

  const handleLogo = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !user) return;

    try {
      const image = await prepareImageFile(file);
      const stored = await uploadFileToStorage(image, {
        purpose: "profile_avatar",
        visibility: "public",
        fileName: `${file.name.replace(/\.[^.]+$/, "") || "logo"}.webp`,
      });
      if (!stored.url) throw new Error("The public logo URL is unavailable.");
      const logo = stored.url;
      const nextForm = {
        ...form,
        companyLogoUrl: logo,
        companyName:
          form.companyName.trim() ||
          `${user.full_name?.trim() || "My"} workspace`,
      };
      const nextProfile = {
        ...profileForm,
        avatarUrl: logo,
        fullName:
          profileForm.fullName.trim() || user.full_name?.trim() || "User",
      };
      setForm(nextForm);
      setProfileForm(nextProfile);
      await Promise.all([
        saveWorkspaceSettings(user.id, nextForm),
        updateProfileSettings(user.id, nextProfile),
      ]);
      storeWorkspaceIdentity(user.id, {
        logoUrl: nextForm.companyLogoUrl,
        workspaceName: nextForm.companyName,
      });
      await refreshProfile();
      toast({ title: "Workspace logo saved" });
    } catch (error) {
      toast({
        title: "Logo was not saved",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      event.target.value = "";
    }
  };

  const handleRemoveLogo = async () => {
    if (!user) return;
    const nextForm = { ...form, companyLogoUrl: null };
    const nextProfile = {
      ...profileForm,
      avatarUrl: null,
      fullName:
        profileForm.fullName.trim() || user.full_name?.trim() || "User",
    };
    setForm(nextForm);
    setProfileForm(nextProfile);

    try {
      await Promise.all([
        saveWorkspaceSettings(user.id, nextForm),
        updateProfileSettings(user.id, nextProfile),
      ]);
      storeWorkspaceIdentity(user.id, {
        logoUrl: nextForm.companyLogoUrl,
        workspaceName: nextForm.companyName,
      });
      await refreshProfile();
      toast({ title: "Workspace logo removed" });
    } catch (error) {
      toast({
        title: "Logo was removed from this device",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    }
  };

  const handleSave = async () => {
    if (!user) return;
    const fullName =
      profileForm.fullName.trim() || user.full_name?.trim() || "User";
    const nextProfile = { ...profileForm, fullName };
    const nextForm = {
      ...form,
      brandColor: normalizeBrandColor(localSettings.brandColor),
      address: composeBusinessAddress(form),
      companyName:
        form.companyName.trim() || `${fullName.split(" ")[0]}'s workspace`,
      phone: nextProfile.phone,
    };
    setSaving(true);

    try {
      const [, savedWorkspace] = await Promise.all([
        updateProfileSettings(user.id, nextProfile),
        saveWorkspaceSettings(user.id, nextForm),
        saveRegion({
          currency,
          currencyCountryCode,
          timezone: timezoneDraft,
        }),
      ]);
      storeWorkspaceIdentity(user.id, {
        logoUrl: nextForm.companyLogoUrl,
        workspaceName: nextForm.companyName,
      });
      setProfileForm(nextProfile);
      setForm(normalizeWorkspaceSettings(savedWorkspace));
      const nextLocalSettings = {
        ...localSettings,
        timezone: timezoneDraft,
      };
      setLocalSettings(nextLocalSettings);
      saveLocalSettings(nextLocalSettings);
      await refreshProfile();
      toast({
        title: "General settings saved",
        description: "Your account and workspace are up to date.",
      });
    } catch (error) {
      toast({
        title: "Workspace was not saved",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div>
      <SettingsBlock title="Workspace identity">
        <div className="mb-6 flex flex-wrap items-center gap-5">
          <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-md border border-border bg-muted">
            {form.companyLogoUrl ? (
              <img
                src={form.companyLogoUrl}
                alt=""
                data-workspace-logo
                className="h-full w-full object-cover"
              />
            ) : (
              <Building2 className="h-7 w-7 text-primary" />
            )}
          </div>
          <div className="flex items-center gap-2">
            <label
              htmlFor="workspace-logo"
              className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-foreground/40 px-4 text-[14px] font-medium text-foreground transition-colors hover:bg-foreground hover:text-background"
            >
              <Camera className="h-4 w-4" />
              Upload logo
            </label>
            {form.companyLogoUrl && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={handleRemoveLogo}
                aria-label="Remove workspace logo"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
            <input
              id="workspace-logo"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={handleLogo}
            />
          </div>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="workspace-name">Workspace name</Label>
            <Input
              id="workspace-name"
              value={form.companyName}
              onChange={(event) => update("companyName", event.target.value)}
              className={inputClassName}
              placeholder="MaxForm Studio"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="general-email">Email address</Label>
            <div className="relative">
              <Input
                id="general-email"
                value={user?.email || ""}
                className={cn(inputClassName, "pr-24")}
                disabled
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] font-medium text-emerald-600 dark:text-emerald-400">
                Verified
              </span>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="general-phone">Phone</Label>
            <PhoneInput
              id="general-phone"
              value={profileForm.phone}
              onChange={(value) => updateProfile("phone", value || "")}
              country={selectedPhoneCountry}
              defaultCountry={selectedPhoneCountry || "US"}
              onCountryChange={(country) =>
                updateProfile("country", countryNameForCode(country))
              }
              className={inputClassName}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="general-country">Country</Label>
            <CountrySelect
              id="general-country"
              value={selectedProfileCountry || selectedPhoneCountry || ""}
              onChange={(country) =>
                updateProfile("country", countryNameForCode(country as Country))
              }
              className={inputClassName}
              placeholder="Select country"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="general-timezone">Workspace time zone</Label>
            <SearchableSelect
              id="general-timezone"
              value={timezoneDraft}
              onChange={(value) => {
                setTimezoneDraft(value);
                setLocalSettings((current) => ({ ...current, timezone: value }));
              }}
              options={workspaceTimezoneOptions}
              className={inputClassName}
              placeholder="Select a time zone"
              searchPlaceholder="Search city, region, GMT offset or country..."
            />
            <p className="text-[11px] leading-4 text-muted-foreground">
              Used for campaign schedules and workspace dates.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="workspace-url">Company website</Label>
            <Input
              id="workspace-url"
              type="url"
              value={form.companyWebsite}
              onChange={(event) => update("companyWebsite", event.target.value)}
              className={inputClassName}
              placeholder="https://example.com"
            />
          </div>
          <div className="space-y-2">
            <Label>Industry</Label>
            <Select
              value={form.industry}
              onValueChange={(value) => update("industry", value)}
            >
              <SelectTrigger className={inputClassName}>
                <SelectValue placeholder="Select industry" />
              </SelectTrigger>
              <SelectContent>
                {[
                  "Technology",
                  "Professional services",
                  "Healthcare",
                  "Education",
                  "Finance",
                  "Retail",
                  "Nonprofit",
                  "Other",
                ].map((industry) => (
                  <SelectItem key={industry} value={industry.toLowerCase()}>
                    {industry}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Company size</Label>
            <Select
              value={form.companySize}
              onValueChange={(value) => update("companySize", value)}
            >
              <SelectTrigger className={inputClassName}>
                <SelectValue placeholder="Select size" />
              </SelectTrigger>
              <SelectContent>
                {["1-10", "11-50", "51-200", "201-500", "501-1000", "1000+"].map(
                  (size) => (
                    <SelectItem key={size} value={size}>
                      {size}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-full mt-1 space-y-4 rounded-xl border border-border bg-muted/10 p-4 sm:p-5">
            <div>
              <h3 className="text-[14px] font-semibold">Business address</h3>
              <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                Used across workspace documents, checkout details, and campaign
                compliance footers.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="workspace-address-line1">Address line 1</Label>
                <Input
                  id="workspace-address-line1"
                  value={form.addressLine1}
                  onChange={(event) =>
                    update("addressLine1", event.target.value)
                  }
                  className={inputClassName}
                  autoComplete="address-line1"
                  placeholder="Street address"
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="workspace-address-line2">
                  Address line 2 <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  id="workspace-address-line2"
                  value={form.addressLine2}
                  onChange={(event) =>
                    update("addressLine2", event.target.value)
                  }
                  className={inputClassName}
                  autoComplete="address-line2"
                  placeholder="Suite, floor, or building"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="workspace-address-country">Country</Label>
                <CountrySelect
                  id="workspace-address-country"
                  value={selectedBusinessCountry || ""}
                  onChange={(country) => {
                    setStateOptions([]);
                    setCityOptions([]);
                    setAddressOptionsLoading({ cities: false, states: true });
                    setForm((current) => ({
                      ...current,
                      city: "",
                      country: countryNameForCode(country as Country),
                      stateRegion: "",
                    }));
                  }}
                  className={inputClassName}
                  placeholder="Select country"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="workspace-address-state">State / region</Label>
                {selectedBusinessCountry &&
                !addressOptionsLoading.states &&
                stateOptions.length === 0 ? (
                  <Input
                    id="workspace-address-state"
                    value={form.stateRegion}
                    onChange={(event) =>
                      update("stateRegion", event.target.value)
                    }
                    autoComplete="address-level1"
                    className={inputClassName}
                    placeholder="State / region"
                  />
                ) : (
                  <SearchableSelect
                    id="workspace-address-state"
                    value={selectedStateCode}
                    onChange={(stateCode) => {
                      const state = stateOptions.find(
                        (option) => option.value === stateCode,
                      );
                      setForm((current) => ({
                        ...current,
                        city: "",
                        stateRegion: state?.label || "",
                      }));
                    }}
                    options={stateOptions}
                    disabled={
                      !selectedBusinessCountry || addressOptionsLoading.states
                    }
                    className={inputClassName}
                    placeholder={
                      addressOptionsLoading.states
                        ? "Loading states..."
                        : selectedBusinessCountry
                          ? "Select state / region"
                          : "Select country first"
                    }
                    searchPlaceholder="Search states..."
                    emptyText="No states found."
                  />
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="workspace-address-city">City</Label>
                {selectedBusinessCountry &&
                (selectedStateCode || stateOptions.length === 0) &&
                !addressOptionsLoading.cities &&
                cityOptions.length === 0 ? (
                  <Input
                    id="workspace-address-city"
                    value={form.city}
                    onChange={(event) => update("city", event.target.value)}
                    autoComplete="address-level2"
                    className={inputClassName}
                    placeholder="City"
                  />
                ) : (
                  <SearchableSelect
                    id="workspace-address-city"
                    value={selectedCityValue}
                    onChange={(city) => update("city", city)}
                    options={cityOptions}
                    disabled={
                      !selectedBusinessCountry ||
                      addressOptionsLoading.cities ||
                      (!selectedStateCode && stateOptions.length > 0) ||
                      cityOptions.length === 0
                    }
                    className={inputClassName}
                    placeholder={
                      addressOptionsLoading.cities
                        ? "Loading cities..."
                        : selectedStateCode || stateOptions.length === 0
                          ? "Select city"
                          : "Select state first"
                    }
                    searchPlaceholder="Search cities..."
                    emptyText="No cities found."
                  />
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="workspace-address-postal-code">
                  Postal code
                </Label>
                <Input
                  id="workspace-address-postal-code"
                  value={form.postalCode}
                  onChange={(event) =>
                    update("postalCode", event.target.value)
                  }
                  autoComplete="postal-code"
                  className={inputClassName}
                  placeholder="Postal code"
                />
              </div>
            </div>
          </div>
        </div>
      </SettingsBlock>

      <SettingsBlock title="Brand color">
        <div className="max-w-[620px] rounded-md border border-border p-4 sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <div>
              <Label htmlFor="brand-color-picker">Color</Label>
              <label
                htmlFor="brand-color-picker"
                className="relative mt-2 flex h-12 w-16 cursor-pointer items-center justify-center overflow-hidden rounded-md border border-border shadow-sm"
                style={{ backgroundColor: normalizeBrandColor(localSettings.brandColor) }}
              >
                <Pipette className="h-4 w-4 text-white drop-shadow" />
                <input
                  id="brand-color-picker"
                  type="color"
                  value={normalizeBrandColor(localSettings.brandColor)}
                  onChange={(event) => {
                    const color = normalizeBrandColor(event.target.value);
                    setBrandHexInput(color);
                    selectBrandColor(color);
                  }}
                  className="absolute inset-0 cursor-pointer opacity-0"
                  aria-label="Choose brand color"
                />
              </label>
            </div>
            <div className="min-w-0 flex-1">
              <Label htmlFor="brand-color-hex">Hex value</Label>
              <div className="relative mt-2">
                <Hash className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="brand-color-hex"
                  value={brandHexInput.replace(/^#/, "")}
                  onChange={(event) => {
                    const value = `#${event.target.value
                      .replace(/[^0-9a-f]/gi, "")
                      .slice(0, 6)
                      .toUpperCase()}`;
                    setBrandHexInput(value);
                    if (/^#[0-9A-F]{6}$/.test(value)) {
                      selectBrandColor(value);
                    }
                  }}
                  onBlur={() =>
                    setBrandHexInput(
                      normalizeBrandColor(localSettings.brandColor),
                    )
                  }
                  className={cn(inputClassName, "pl-10 font-mono uppercase")}
                  maxLength={6}
                  spellCheck={false}
                />
              </div>
            </div>
            <div className="flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-[13px] font-medium text-primary-foreground">
              <Check className="h-4 w-4" />
              Live preview
            </div>
          </div>

          <div className="mt-5 border-t border-border pt-4">
            <p className="mb-3 text-[12px] font-medium text-muted-foreground">
              Presets
            </p>
            <div className="flex flex-wrap gap-2">
              {BRAND_COLOR_PRESETS.map((color) => {
                const selected =
                  normalizeBrandColor(localSettings.brandColor) === color;
                return (
              <button
                key={color}
                type="button"
                onClick={() =>
                  {
                    setBrandHexInput(color);
                    selectBrandColor(color);
                  }
                }
                className={cn(
                  "relative h-9 w-9 rounded-md border-2 transition-transform hover:scale-105",
                  selected
                    ? "border-foreground"
                    : "border-transparent",
                )}
                style={{ backgroundColor: color }}
                aria-pressed={selected}
                aria-label={`Use brand color ${color}`}
                title={color}
              >
                {selected && (
                  <Check className="absolute inset-0 m-auto h-4 w-4 text-white drop-shadow" />
                )}
              </button>
                );
              })}
            </div>
          </div>
        </div>
      </SettingsBlock>

      <div className="flex justify-end pt-6">
        <SavingButton
          type="button"
          loading={saving}
          onClick={handleSave}
        >
          Save workspace
        </SavingButton>
      </div>
    </div>
  );
}

const roleLabels: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  moderator: "Manager",
  user: "Member",
};

const roleDescriptions: Record<WorkspaceRole, string> = {
  admin:
    "Runs the workspace: every module, plus billing and member management.",
  moderator: "Works across the modules you tick, and can invite collaborators.",
  user: "Works only in the modules you tick.",
};

/** Copies to the clipboard and says whether it worked, without throwing. */
const copyToClipboard = async (value: string) => {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
};

function ModulePicker({
  disabled,
  selected,
  onChange,
}: {
  disabled?: boolean;
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const selectedCount = ASSIGNABLE_MODULE_KEYS.filter((key) =>
    selected.includes(key),
  ).length;

  const toggle = (key: string, checked: boolean) => {
    onChange(
      checked
        ? [...selected.filter((value) => value !== key), key]
        : selected.filter((value) => value !== key),
    );
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] font-medium">
          Tabs this member can open
          <span className="ml-2 font-normal text-muted-foreground">
            {disabled
              ? "Admins always see everything"
              : `${selectedCount} of ${ASSIGNABLE_MODULE_KEYS.length} selected`}
          </span>
        </p>
        {!disabled && (
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[12px]"
              onClick={() => onChange([...ASSIGNABLE_MODULE_KEYS])}
            >
              Select all
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[12px]"
              onClick={() => onChange([])}
            >
              Clear
            </Button>
          </div>
        )}
      </div>
      <div
        className={cn(
          "grid max-h-[260px] gap-1 overflow-y-auto rounded-md border border-border p-2 sm:grid-cols-2",
          disabled && "pointer-events-none opacity-50",
        )}
      >
        {WORKSPACE_STANDARD_MODULE_KEYS.map((key) => {
          const checked = disabled || selected.includes(key);
          return (
            <label
              key={key}
              htmlFor={`module-${key}`}
              className="flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-2 hover:bg-accent"
            >
              <Checkbox
                id={`module-${key}`}
                checked={checked}
                disabled={disabled}
                onCheckedChange={(value) => toggle(key, value === true)}
                className="mt-0.5"
              />
              <span className="min-w-0">
                <span className="block text-[13px] font-medium leading-tight">
                  {WORKSPACE_MODULE_LABELS[key]}
                </span>
                <span className="block text-[11px] leading-tight text-muted-foreground">
                  {WORKSPACE_MODULE_DESCRIPTIONS[key]}
                </span>
              </span>
            </label>
          );
        })}
      </div>
      <div className="rounded-md border border-border bg-muted/20 p-2">
        <div className="mb-2 flex items-start justify-between gap-3 px-2">
          <div>
            <p className="text-[13px] font-medium">Workspace tools</p>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Off for members by default. Grant an exception only when this
              person needs the tool.
            </p>
          </div>
          <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Exceptions
          </span>
        </div>
        <div className="space-y-1">
          {WORKSPACE_TOOL_MODULE_KEYS.map((key) => {
            const checked = disabled || selected.includes(key);
            return (
              <div
                key={key}
                className={cn(
                  "flex items-center justify-between gap-3 rounded-md border border-transparent px-2 py-2 transition-colors",
                  checked
                    ? "bg-background text-foreground"
                    : "text-muted-foreground opacity-70",
                )}
              >
                <div className="min-w-0">
                  <p className="text-[13px] font-medium leading-tight">
                    {WORKSPACE_MODULE_LABELS[key]}
                  </p>
                  <p className="text-[11px] leading-tight text-muted-foreground">
                    {WORKSPACE_MODULE_DESCRIPTIONS[key]}
                  </p>
                </div>
                <Switch
                  checked={checked}
                  disabled={disabled}
                  onCheckedChange={(value) => toggle(key, value === true)}
                  aria-label={`${checked ? "Remove" : "Grant"} ${WORKSPACE_MODULE_LABELS[key]} access`}
                />
              </div>
            );
          })}
        </div>
      </div>
      <p className="text-[12px] text-muted-foreground">
        Home and personal account settings are always available. Admins see
        every module automatically.
      </p>
    </div>
  );
}

/**
 * Shown once, on the response that generated them. The password is stored only
 * as a hash, so if this is dismissed the only way back is a fresh reset.
 */
function CredentialsCard({
  credentials,
  emailDelivered,
  emailError,
}: {
  credentials: MemberCredentials;
  emailDelivered: boolean;
  emailError?: string;
}) {
  const [copied, setCopied] = useState(false);
  const summary = `Username: ${credentials.username}\nEmail: ${credentials.email}\nTemporary password: ${credentials.password}`;

  return (
    <div className="rounded-md border border-primary/30 bg-primary/5 p-4">
      <div className="flex items-start gap-2.5">
        <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold">
            {emailDelivered
              ? "Credentials sent"
              : "Credentials created — email not sent"}
          </p>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            {emailDelivered
              ? "These are shown once. Copy them if you also want to pass them on directly."
              : emailError ||
                "Send these to the member yourself. They are not recoverable later."}
          </p>
          <dl className="mt-3 space-y-1.5 text-[13px]">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Username</dt>
              <dd className="truncate font-medium">{credentials.username}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Email</dt>
              <dd className="truncate font-medium">{credentials.email}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Temporary password</dt>
              <dd className="truncate font-mono font-medium">
                {credentials.password}
              </dd>
            </div>
          </dl>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3 h-8 text-[12px]"
            onClick={async () => {
              if (await copyToClipboard(summary)) {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 2_000);
              } else {
                toast({
                  title: "Copy the details manually",
                  description: "This browser blocked clipboard access.",
                  variant: "destructive",
                });
              }
            }}
          >
            {copied ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            {copied ? "Copied" : "Copy details"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * The credentials half of the add/edit dialogs. Generating is the default
 * because a machine-chosen password is a better one; setting them by hand is
 * there for the owner who has already agreed a handle with the person.
 */
function CredentialFields({
  manual,
  onManualChange,
  username,
  onUsernameChange,
  password,
  onPasswordChange,
}: {
  manual: boolean;
  onManualChange: (manual: boolean) => void;
  username: string;
  onUsernameChange: (value: string) => void;
  password: string;
  onPasswordChange: (value: string) => void;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[13px] font-medium">Set sign-in details myself</p>
          <p className="text-[12px] text-muted-foreground">
            Off: a unique username and a strong password are generated and
            emailed, and the member is asked to replace the password.
          </p>
        </div>
        <Switch checked={manual} onCheckedChange={onManualChange} />
      </div>

      {manual && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="member-username">Username</Label>
            <Input
              id="member-username"
              value={username}
              onChange={(event) =>
                onUsernameChange(event.target.value.toLowerCase())
              }
              className={inputClassName}
              placeholder="ada.lovelace"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
            />
            <p className="text-[11px] text-muted-foreground">
              Letters, numbers, dots, dashes, underscores. Leave blank to
              generate.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="member-password">Password</Label>
            <div className="relative">
              <Input
                id="member-password"
                type={visible ? "text" : "password"}
                value={password}
                onChange={(event) => onPasswordChange(event.target.value)}
                className={cn(inputClassName, "pr-10")}
                placeholder="At least 10 characters"
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setVisible((current) => !current)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                aria-label={visible ? "Hide password" : "Show password"}
              >
                {visible ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              At least three of: lowercase, uppercase, numbers, symbols. Leave
              blank to generate.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * One member's history, newest first.
 *
 * Loaded when the dialog opens rather than with the members list: it is a
 * per-member read that most visits to this screen never make, and the list
 * query is already the slowest thing here.
 */
function MemberActivityDialog({
  member,
  onOpenChange,
}: {
  member: WorkspaceMember | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [events, setEvents] = useState<MemberActivityEvent[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!member) return;
    let active = true;
    setLoading(true);
    setError("");
    getMemberActivity(member.id)
      .then((result) => {
        if (active) setEvents(result.events);
      })
      .catch((cause) => {
        if (active) setError(getErrorMessage(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    // Prevents a slow response for one member landing in another's dialog.
    return () => {
      active = false;
    };
  }, [member]);

  return (
    <Dialog open={Boolean(member)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Activity — {member?.fullName}</DialogTitle>
          <DialogDescription>
            Sign-ins and every administrative change made to this member, newest
            first.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center gap-2 py-8 text-[14px] text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            Loading activity
          </div>
        ) : error ? (
          <p className="py-8 text-[14px] text-destructive">{error}</p>
        ) : events.length === 0 ? (
          <div className="flex items-center gap-3 border-y border-border py-8 text-[14px] text-muted-foreground">
            <ScrollText className="h-4 w-4" />
            Nothing recorded yet. Sign-ins and changes will appear here.
          </div>
        ) : (
          <ol className="divide-y divide-border border-y border-border">
            {events.map((event) => (
              <li key={event.id} className="flex gap-3 py-3">
                <span
                  className={cn(
                    "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                    event.bySelf ? "bg-primary" : "bg-muted-foreground/50",
                  )}
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-medium">{event.label}</p>
                  <p className="text-[12px] text-muted-foreground">
                    {event.createdAt
                      ? new Date(event.createdAt).toLocaleString()
                      : ""}
                    {event.actorLabel ? ` · by ${event.actorLabel}` : ""}
                  </p>
                  {Object.keys(event.detail).length > 0 && (
                    <p className="mt-0.5 break-words text-[12px] text-muted-foreground">
                      {describeEventDetail(event.detail)}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Renders an event's payload as a short sentence rather than raw JSON. */
const describeEventDetail = (detail: Record<string, unknown>) =>
  Object.entries(detail)
    .map(([key, value]) => {
      const label = key
        .replace(/([A-Z])/g, " $1")
        .replace(/^./, (first) => first.toUpperCase());
      if (Array.isArray(value)) {
        const names = value
          .map((entry) => WORKSPACE_MODULE_LABELS[String(entry)] || String(entry))
          .filter(Boolean);
        return `${label}: ${names.join(", ") || "none"}`;
      }
      if (typeof value === "boolean") return `${label}: ${value ? "yes" : "no"}`;
      return `${label}: ${String(value)}`;
    })
    .join(" · ");

function AddMemberDialog({
  onAdded,
  open,
  onOpenChange,
}: {
  onAdded: (result: MemberMutationResult) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [role, setRole] = useState<WorkspaceRole>("user");
  const [modules, setModules] = useState<string[]>(["home", "forms"]);
  const [manualCredentials, setManualCredentials] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setFullName("");
    setEmail("");
    setJobTitle("");
    setRole("user");
    setModules(["home", "forms"]);
    setManualCredentials(false);
    setUsername("");
    setPassword("");
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const cleanEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      toast({ title: "Enter a valid email address", variant: "destructive" });
      return;
    }
    if (fullName.trim().length < 2) {
      toast({ title: "Enter the member's full name", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const result = await addWorkspaceMember({
        email: cleanEmail,
        fullName: fullName.trim(),
        jobTitle: jobTitle.trim(),
        role,
        modules,
        username: manualCredentials ? username.trim() : "",
        password: manualCredentials ? password : "",
      });
      onAdded(result);
      reset();
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Member was not added",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Add a member</DialogTitle>
          <DialogDescription>
            An account is created straight away and the sign-in details are
            emailed to them. Pick the tabs they should see.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="member-name">Full name</Label>
              <Input
                id="member-name"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                className={inputClassName}
                placeholder="Ada Lovelace"
                autoComplete="off"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="member-email">Work email</Label>
              <Input
                id="member-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className={inputClassName}
                placeholder="name@company.com"
                autoComplete="off"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="member-title">Job title (optional)</Label>
              <Input
                id="member-title"
                value={jobTitle}
                onChange={(event) => setJobTitle(event.target.value)}
                className={inputClassName}
                placeholder="Operations lead"
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="member-role">Role</Label>
              <Select
                value={role}
                onValueChange={(value: WorkspaceRole) => setRole(value)}
              >
                <SelectTrigger id="member-role" className={inputClassName}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">Member</SelectItem>
                  <SelectItem value="moderator">Manager</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-[12px] text-muted-foreground">
            {roleDescriptions[role]}
          </p>

          <CredentialFields
            manual={manualCredentials}
            onManualChange={setManualCredentials}
            username={username}
            onUsernameChange={setUsername}
            password={password}
            onPasswordChange={setPassword}
          />

          <ModulePicker
            disabled={role === "admin"}
            selected={modules}
            onChange={setModules}
          />

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <SavingButton type="submit" loading={saving}>
              Create account and send details
            </SavingButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditMemberDialog({
  member,
  onSaved,
  onCredentialsIssued,
  onOpenChange,
}: {
  member: WorkspaceMember | null;
  onSaved: (result: MemberMutationResult) => void;
  onCredentialsIssued: (result: MemberMutationResult) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const [fullName, setFullName] = useState("");
  const [emailAddress, setEmailAddress] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<WorkspaceRole>("user");
  const [modules, setModules] = useState<string[]>([]);
  const [suspended, setSuspended] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [notifyPassword, setNotifyPassword] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settingPassword, setSettingPassword] = useState(false);

  useEffect(() => {
    if (!member) return;
    setFullName(member.fullName);
    setEmailAddress(member.email);
    setJobTitle(member.jobTitle);
    setUsername(member.username);
    setRole((member.role === "owner" ? "admin" : member.role) as WorkspaceRole);
    setModules(member.allowedModules || [...ASSIGNABLE_MODULE_KEYS]);
    setSuspended(member.status === "suspended");
    setNewPassword("");
    setNotifyPassword(true);
  }, [member]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!member) return;
    setSaving(true);
    try {
      onSaved(
        await updateWorkspaceMember({
          memberId: member.id,
          role,
          modules,
          status: suspended ? "suspended" : "active",
          fullName: fullName.trim(),
          jobTitle: jobTitle.trim(),
          email: emailAddress.trim().toLowerCase(),
          username: username.trim().toLowerCase(),
        }),
      );
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Access was not updated",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const applyPassword = async () => {
    if (!member || !newPassword) return;
    setSettingPassword(true);
    try {
      onCredentialsIssued(
        await setMemberPassword({
          memberId: member.id,
          password: newPassword,
          notify: notifyPassword,
        }),
      );
      setNewPassword("");
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Password was not changed",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setSettingPassword(false);
    }
  };

  return (
    <Dialog open={Boolean(member)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{member?.fullName || "Member access"}</DialogTitle>
          <DialogDescription>
            {member?.email}
            {member?.username ? ` · @${member.username}` : ""}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="edit-name">Full name</Label>
              <Input
                id="edit-name"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                className={inputClassName}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-email">Email</Label>
              <Input
                id="edit-email"
                type="email"
                value={emailAddress}
                onChange={(event) => setEmailAddress(event.target.value)}
                className={inputClassName}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-username">Username</Label>
              <Input
                id="edit-username"
                value={username}
                onChange={(event) =>
                  setUsername(event.target.value.toLowerCase())
                }
                className={inputClassName}
                autoCapitalize="none"
                spellCheck={false}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-title">Job title</Label>
              <Input
                id="edit-title"
                value={jobTitle}
                onChange={(event) => setJobTitle(event.target.value)}
                className={inputClassName}
                placeholder="Operations lead"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-role">Role</Label>
            <Select
              value={role}
              onValueChange={(value: WorkspaceRole) => setRole(value)}
            >
              <SelectTrigger id="edit-role" className={inputClassName}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="user">Member</SelectItem>
                <SelectItem value="moderator">Manager</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[12px] text-muted-foreground">
              {roleDescriptions[role]}
            </p>
          </div>

          <ModulePicker
            disabled={role === "admin"}
            selected={modules}
            onChange={setModules}
          />

          <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
            <div className="min-w-0">
              <p className="text-[13px] font-medium">Suspend access</p>
              <p className="text-[12px] text-muted-foreground">
                Keeps the account but closes this workspace to them until you
                switch it back.
              </p>
            </div>
            <Switch checked={suspended} onCheckedChange={setSuspended} />
          </div>

          {/* Applied on its own, not with the form: changing someone's
              password is a distinct act from adjusting their access. */}
          <div className="space-y-2 rounded-md border border-border p-3">
            <p className="text-[13px] font-medium">Set a new password</p>
            <p className="text-[12px] text-muted-foreground">
              Members can change their own password from Settings, or reset it
              from the sign-in page. Use this when you need to do it for them.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                type="text"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                className={cn(inputClassName, "min-w-[200px] flex-1")}
                placeholder="At least 10 characters"
                autoComplete="off"
              />
              <Button
                type="button"
                variant="outline"
                onClick={applyPassword}
                disabled={!newPassword || settingPassword}
              >
                {settingPassword ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <KeyRound className="h-4 w-4" />
                )}
                Apply
              </Button>
            </div>
            <label className="flex items-center gap-2 text-[12px] text-muted-foreground">
              <Checkbox
                checked={notifyPassword}
                onCheckedChange={(value) => setNotifyPassword(value === true)}
              />
              Email the new details to them
            </label>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <SavingButton type="submit" loading={saving}>
              Save changes
            </SavingButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TeamSection() {
  const { user, workspace } = useAuth();
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [invitations, setInvitations] = useState<PendingInvitation[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<WorkspaceMember | null>(null);
  const [viewingActivity, setViewingActivity] =
    useState<WorkspaceMember | null>(null);
  const [removing, setRemoving] = useState<{
    member: WorkspaceMember;
    mode: "remove" | "delete";
  } | null>(null);
  const [busyMemberId, setBusyMemberId] = useState("");
  const [issued, setIssued] = useState<{
    credentials: MemberCredentials;
    emailDelivered: boolean;
    emailError?: string;
  } | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [memberList, invitationList] = await Promise.all([
        getWorkspaceMembers(),
        getPendingInvitations(user.id).catch(() => [] as PendingInvitation[]),
      ]);
      setMembers(memberList);
      setInvitations(invitationList);
    } catch (error) {
      toast({
        title: "Members could not be loaded",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const applyResult = (result: MemberMutationResult, title: string) => {
    setMembers(result.members);
    if (result.credentials) {
      setIssued({
        credentials: result.credentials,
        emailDelivered: result.emailDelivered !== false,
        emailError: result.emailError,
      });
    }
    toast({
      title,
      description:
        result.emailDelivered === false
          ? "The email could not be sent — pass the details on directly."
          : undefined,
    });
  };

  const handleRemove = async () => {
    if (!removing) return;
    setBusyMemberId(removing.member.id);
    try {
      const result =
        removing.mode === "delete"
          ? await deleteMemberAccount(removing.member.id)
          : await removeWorkspaceMember(removing.member.id);
      setMembers(result.members);
      toast({
        title:
          removing.mode === "delete"
            ? `${removing.member.fullName}'s account was deleted`
            : `${removing.member.fullName} was removed from the workspace`,
      });
      setRemoving(null);
    } catch (error) {
      toast({
        title:
          removing.mode === "delete"
            ? "Account was not deleted"
            : "Member was not removed",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setBusyMemberId("");
    }
  };

  /** Suspension is per-workspace; blocking stops the account signing in at all. */
  const handleSuspend = async (member: WorkspaceMember, suspend: boolean) => {
    setBusyMemberId(member.id);
    try {
      const result = await updateWorkspaceMember({
        memberId: member.id,
        role: (member.role === "owner" ? "admin" : member.role) as WorkspaceRole,
        modules: member.allowedModules || [...ASSIGNABLE_MODULE_KEYS],
        status: suspend ? "suspended" : "active",
      });
      setMembers(result.members);
      toast({
        title: suspend
          ? `${member.fullName}'s access is suspended`
          : `${member.fullName}'s access is active again`,
      });
    } catch (error) {
      toast({
        title: "Access was not changed",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setBusyMemberId("");
    }
  };

  const handleBlock = async (member: WorkspaceMember, blocked: boolean) => {
    setBusyMemberId(member.id);
    try {
      const result = await setMemberBlocked(member.id, blocked);
      setMembers(result.members);
      toast({
        title: blocked
          ? `${member.fullName} is blocked from signing in`
          : `${member.fullName} can sign in again`,
      });
    } catch (error) {
      toast({
        title: blocked ? "Member was not blocked" : "Member was not unblocked",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setBusyMemberId("");
    }
  };

  const handleResetCredentials = async (member: WorkspaceMember) => {
    setBusyMemberId(member.id);
    try {
      applyResult(
        await resetMemberCredentials(member.id),
        `New sign-in details issued for ${member.fullName}`,
      );
    } catch (error) {
      toast({
        title: "Credentials were not reset",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setBusyMemberId("");
    }
  };

  const handleRevokeInvitation = async (invitationId: string) => {
    if (!user) return;
    try {
      await revokeInvitation(user.id, invitationId);
      setInvitations((current) =>
        current.filter((invitation) => invitation.id !== invitationId),
      );
      toast({ title: "Invitation revoked" });
    } catch (error) {
      toast({
        title: "Invitation was not revoked",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    }
  };

  if (!workspace.canManageWorkspace) {
    return (
      <SettingsBlock title="Members">
        <div className="flex max-w-[680px] items-start gap-3 rounded-md border border-border p-4 text-[14px] text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Only the workspace owner and admins can manage members. Ask them if
            you need access to another part of the workspace.
          </p>
        </div>
      </SettingsBlock>
    );
  }

  return (
    <div>
      <SettingsBlock title={`Members (${members.length})`}>
        <div className="max-w-[680px] space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[13px] text-muted-foreground">
              Everyone here signs in to {workspace.name} with their own
              credentials and sees only the tabs you grant.
            </p>
            <Button type="button" onClick={() => setAddOpen(true)}>
              <UserPlus className="h-4 w-4" />
              Add member
            </Button>
          </div>

          {issued && (
            <CredentialsCard
              credentials={issued.credentials}
              emailDelivered={issued.emailDelivered}
              emailError={issued.emailError}
            />
          )}

          {loading ? (
            <div className="flex items-center gap-2 py-6 text-[14px] text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              Loading members
            </div>
          ) : (
            /* A table, because this screen exists to be compared down a
               column -- who is here, what they are, and what they can reach.
               It scrolls inside its own container so a narrow window never
               drags the whole page sideways. */
            <div className="overflow-x-auto rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[220px]">Member</TableHead>
                    <TableHead className="min-w-[110px]">Role</TableHead>
                    <TableHead className="min-w-[150px]">Tab access</TableHead>
                    <TableHead className="min-w-[120px]">Status</TableHead>
                    <TableHead className="min-w-[130px]">Last active</TableHead>
                    <TableHead className="w-[56px] text-right">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {members.map((member) => {
                    const initials =
                      member.fullName
                        .split(" ")
                        .map((part) => part[0])
                        .join("")
                        .toUpperCase()
                        .slice(0, 2) || "MF";
                    const isSelf = member.userId === user?.id;
                    const busy = busyMemberId === member.id;
                    return (
                      <TableRow key={member.id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Avatar className="h-9 w-9 shrink-0">
                              <AvatarImage
                                src={member.avatarUrl || ""}
                                className="object-cover"
                              />
                              <AvatarFallback className="text-[12px]">
                                {initials}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <p className="flex items-center gap-2 text-[13.5px] font-medium">
                                <span className="truncate">
                                  {member.fullName}
                                </span>
                                {isSelf && (
                                  <Badge variant="secondary">You</Badge>
                                )}
                              </p>
                              <p className="truncate text-[12px] text-muted-foreground">
                                {member.email}
                                {member.username ? ` · @${member.username}` : ""}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={member.isOwner ? "default" : "outline"}>
                            {roleLabels[member.role] || member.role}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-[12.5px] text-muted-foreground">
                          {describeModuleAccess(member.allowedModules)}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1.5">
                            {member.blocked ? (
                              <Badge variant="destructive">Blocked</Badge>
                            ) : member.status === "suspended" ? (
                              <Badge variant="destructive">Suspended</Badge>
                            ) : (
                              <Badge variant="secondary">Active</Badge>
                            )}
                            {member.pendingCredentials && (
                              <Badge variant="outline">Temp password</Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-[12.5px] text-muted-foreground">
                          {member.isOwner
                            ? "—"
                            : member.lastActiveAt
                              ? new Date(member.lastActiveAt).toLocaleDateString()
                              : "Not signed in yet"}
                        </TableCell>
                        <TableCell className="text-right">
                          {member.isOwner ? null : (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  disabled={busy || isSelf}
                                  aria-label={`Manage ${member.fullName}`}
                                >
                                  {busy ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <MoreHorizontal className="h-4 w-4" />
                                  )}
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-[248px]">
                                <DropdownMenuItem onSelect={() => setEditing(member)}>
                                  <SlidersHorizontal className="h-4 w-4" />
                                  Edit details, role and tabs
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onSelect={() => setViewingActivity(member)}
                                >
                                  <ScrollText className="h-4 w-4" />
                                  View activity log
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onSelect={() => handleResetCredentials(member)}
                                >
                                  <KeyRound className="h-4 w-4" />
                                  Generate and send password
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onSelect={() =>
                                    handleSuspend(
                                      member,
                                      member.status !== "suspended",
                                    )
                                  }
                                >
                                  {member.status === "suspended" ? (
                                    <CirclePlay className="h-4 w-4" />
                                  ) : (
                                    <CirclePause className="h-4 w-4" />
                                  )}
                                  {member.status === "suspended"
                                    ? "Restore workspace access"
                                    : "Suspend workspace access"}
                                </DropdownMenuItem>
                                {member.provisioned && (
                                  <DropdownMenuItem
                                    onSelect={() =>
                                      handleBlock(member, !member.blocked)
                                    }
                                  >
                                    {member.blocked ? (
                                      <ShieldCheck className="h-4 w-4" />
                                    ) : (
                                      <Ban className="h-4 w-4" />
                                    )}
                                    {member.blocked
                                      ? "Unblock sign-in"
                                      : "Block sign-in everywhere"}
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-destructive focus:text-destructive"
                                  onSelect={() =>
                                    setRemoving({ member, mode: "remove" })
                                  }
                                >
                                  <UserMinus className="h-4 w-4" />
                                  Remove from workspace
                                </DropdownMenuItem>
                                {member.provisioned && (
                                  <DropdownMenuItem
                                    className="text-destructive focus:text-destructive"
                                    onSelect={() =>
                                      setRemoving({ member, mode: "delete" })
                                    }
                                  >
                                    <Trash2 className="h-4 w-4" />
                                    Delete account permanently
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </SettingsBlock>

      {invitations.length > 0 && (
        <SettingsBlock title={`Pending invitations (${invitations.length})`}>
          <div className="max-w-[680px] divide-y divide-border border-y border-border">
            {invitations.map((invitation) => (
              <div
                key={invitation.id}
                className="flex flex-wrap items-center gap-3 py-4"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-muted">
                  <Mail className="h-4 w-4 text-primary" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-medium">
                    {invitation.email}
                  </p>
                  <p className="text-[12px] text-muted-foreground">
                    {invitation.expiresAt
                      ? `Expires ${new Date(invitation.expiresAt).toLocaleDateString()}`
                      : "Pending"}
                  </p>
                </div>
                <Badge variant="outline" className="capitalize">
                  {roleLabels[invitation.role] || invitation.role}
                </Badge>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => handleRevokeInvitation(invitation.id)}
                  aria-label={`Revoke invitation for ${invitation.email}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </SettingsBlock>
      )}

      <AddMemberDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onAdded={(result) =>
          applyResult(
            result,
            result.reusedAccount
              ? "Existing account added to this workspace"
              : "Member created and sign-in details sent",
          )
        }
      />

      <MemberActivityDialog
        member={viewingActivity}
        onOpenChange={(open) => {
          if (!open) setViewingActivity(null);
        }}
      />

      <EditMemberDialog
        member={editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        onSaved={(result) => {
          setMembers(result.members);
          toast({ title: "Member updated" });
        }}
        onCredentialsIssued={(result) =>
          applyResult(result, "Password changed")
        }
      />

      <AlertDialog
        open={Boolean(removing)}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {removing?.mode === "delete"
                ? `Permanently delete ${removing?.member.fullName}'s account?`
                : `Remove ${removing?.member.fullName} from ${workspace.name}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {removing?.mode === "delete"
                ? "The account and its sign-in details are destroyed and cannot be restored. Everything they created stays in this workspace, because it belongs to the workspace rather than to them."
                : "They lose access to every tab in this workspace immediately. Their account and anything they created stay intact."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                handleRemove();
              }}
            >
              {removing?.mode === "delete"
                ? "Delete account"
                : "Remove member"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ToggleRow({
  checked,
  channel,
  label,
  onCheckedChange,
}: {
  channel: string;
  checked: boolean;
  label: string;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex min-h-16 items-center gap-4 border-b border-border py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-medium text-foreground">{label}</p>
        <p className="mt-0.5 text-[12px] text-muted-foreground">{channel}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

function NotificationsSection({
  localSettings,
  saveLocalSettings,
  setLocalSettings,
}: {
  localSettings: LocalUserSettings;
  saveLocalSettings: () => void;
  setLocalSettings: React.Dispatch<React.SetStateAction<LocalUserSettings>>;
}) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notifications, setNotifications] = useState<NotificationSettings>({
    dailyDigest: false,
    emailOnNewSubmission: true,
    emailOnPaymentReceived: true,
    emailOnWorkflowTrigger: true,
  });

  useEffect(() => {
    if (!user) return;
    let active = true;

    getNotificationSettings(user.id)
      .then((settings) => {
        if (active) setNotifications(settings);
      })
      .catch((error) => {
        toast({
          title: "Notifications could not be loaded",
          description: getErrorMessage(error),
          variant: "destructive",
        });
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [user]);

  const updateNotification = (
    key: keyof NotificationSettings,
    value: boolean,
  ) => {
    setNotifications((current) => ({ ...current, [key]: value }));
  };

  const updateLocal = (key: keyof LocalUserSettings, value: boolean) => {
    setLocalSettings((current) => ({ ...current, [key]: value }));
  };

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    try {
      await saveNotificationSettings(user.id, notifications);
      saveLocalSettings();
      toast({ title: "Notification preferences saved" });
    } catch (error) {
      toast({
        title: "Preferences were not saved",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div>
      <SettingsBlock title="Workspace email">
        <div className="max-w-[680px]">
          <ToggleRow
            label="New form submission"
            channel="Email"
            checked={notifications.emailOnNewSubmission}
            onCheckedChange={(checked) =>
              updateNotification("emailOnNewSubmission", checked)
            }
          />
          <ToggleRow
            label="Workflow activity"
            channel="Email"
            checked={notifications.emailOnWorkflowTrigger}
            onCheckedChange={(checked) =>
              updateNotification("emailOnWorkflowTrigger", checked)
            }
          />
          <ToggleRow
            label="Payment received"
            channel="Email"
            checked={notifications.emailOnPaymentReceived}
            onCheckedChange={(checked) =>
              updateNotification("emailOnPaymentReceived", checked)
            }
          />
          <ToggleRow
            label="Daily workspace digest"
            channel="Email · once per day"
            checked={notifications.dailyDigest}
            onCheckedChange={(checked) =>
              updateNotification("dailyDigest", checked)
            }
          />
        </div>
      </SettingsBlock>

      <SettingsBlock title="Account alerts">
        <div className="max-w-[680px]">
          <ToggleRow
            label="In-app activity"
            channel="Dashboard"
            checked={localSettings.inAppNotifications}
            onCheckedChange={(checked) =>
              updateLocal("inAppNotifications", checked)
            }
          />
          <ToggleRow
            label="Security alerts"
            channel="Email and dashboard"
            checked={localSettings.securityAlerts}
            onCheckedChange={(checked) =>
              updateLocal("securityAlerts", checked)
            }
          />
          <ToggleRow
            label="Product updates"
            channel="Email"
            checked={localSettings.productUpdates}
            onCheckedChange={(checked) =>
              updateLocal("productUpdates", checked)
            }
          />
        </div>
      </SettingsBlock>

      <div className="flex justify-end pt-6">
        <SavingButton type="button" loading={saving} onClick={handleSave}>
          Save preferences
        </SavingButton>
      </div>
    </div>
  );
}

function AppearanceSection({
  localSettings,
  saveLocalSettings,
  setLocalSettings,
}: {
  localSettings: LocalUserSettings;
  saveLocalSettings: () => void;
  setLocalSettings: React.Dispatch<React.SetStateAction<LocalUserSettings>>;
}) {
  const { theme, setTheme } = useTheme();
  const { currency, currencyCountryCode, saveRegion, timezone } =
    useWorkspaceRegion();
  const [saving, setSaving] = useState(false);
  const update = (key: keyof LocalUserSettings, value: string | boolean) => {
    setLocalSettings((current) => ({ ...current, [key]: value }));
  };

  const themeOptions = [
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark", icon: Moon },
    { value: "system", label: "System", icon: Laptop },
  ];

  return (
    <div>
      <SettingsBlock title="Theme">
        <div className="grid max-w-[620px] gap-3 sm:grid-cols-3">
          {themeOptions.map((option) => {
            const Icon = option.icon;
            const selected = theme === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setTheme(option.value)}
                className={cn(
                  "relative h-28 overflow-hidden rounded-md border p-3 text-left transition-colors",
                  selected
                    ? "border-primary bg-primary/10"
                    : "border-border hover:border-primary/60",
                )}
                aria-pressed={selected}
              >
                <span className="flex h-14 rounded-sm border border-border bg-background p-2">
                  <span className="w-4 border-r border-border bg-muted" />
                  <span className="flex-1 space-y-1.5 pl-2 pt-1">
                    <span className="block h-1.5 w-3/4 rounded-full bg-foreground" />
                    <span className="block h-1.5 w-full rounded-full bg-muted" />
                    <span className="block h-1.5 w-2/3 rounded-full bg-muted" />
                  </span>
                </span>
                <span className="mt-2 flex items-center gap-2 text-[13px] font-medium">
                  <Icon className="h-4 w-4 text-primary" />
                  {option.label}
                  {selected && <Check className="ml-auto h-4 w-4 text-primary" />}
                </span>
              </button>
            );
          })}
        </div>
      </SettingsBlock>

      <SettingsBlock title="Region">
        <div className="grid max-w-[620px] gap-5 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Language</Label>
            <Select
              value={localSettings.language}
              onValueChange={(value) => update("language", value)}
            >
              <SelectTrigger className={inputClassName}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="fr">French</SelectItem>
                <SelectItem value="es">Spanish</SelectItem>
                <SelectItem value="pt">Portuguese</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Date format</Label>
            <Select
              value={localSettings.dateFormat}
              onValueChange={(value) => update("dateFormat", value)}
            >
              <SelectTrigger className={inputClassName}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="MMM d, yyyy">Jul 24, 2026</SelectItem>
                <SelectItem value="dd/MM/yyyy">24/07/2026</SelectItem>
                <SelectItem value="MM/dd/yyyy">07/24/2026</SelectItem>
                <SelectItem value="yyyy-MM-dd">2026-07-24</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Week starts on</Label>
            <Select
              value={localSettings.weekStart}
              onValueChange={(value) => update("weekStart", value)}
            >
              <SelectTrigger className={inputClassName}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="monday">Monday</SelectItem>
                <SelectItem value="sunday">Sunday</SelectItem>
                <SelectItem value="saturday">Saturday</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </SettingsBlock>

      <SettingsBlock title="Dashboard">
        <div className="max-w-[620px] space-y-6">
          <div className="space-y-2">
            <Label>Default page</Label>
            <Select
              value={localSettings.startPage}
              onValueChange={(value) => update("startPage", value)}
            >
              <SelectTrigger className={cn(inputClassName, "max-w-[300px]")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="overview">Overview</SelectItem>
                <SelectItem value="forms">Forms</SelectItem>
                <SelectItem value="analytics">Analytics</SelectItem>
                <SelectItem value="workflows">Workflows</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between gap-4 border-y border-border py-4">
            <div>
              <p className="text-[14px] font-medium">Reduce motion</p>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                Interface animations
              </p>
            </div>
            <Switch
              checked={localSettings.reduceMotion}
              onCheckedChange={(checked) => update("reduceMotion", checked)}
            />
          </div>
        </div>
      </SettingsBlock>

      <div className="flex justify-end pt-6">
        <SavingButton
          type="button"
          loading={saving}
          onClick={async () => {
            setSaving(true);
            try {
              await saveRegion({
                currency,
                currencyCountryCode,
                timezone,
              });
              saveLocalSettings();
              toast({ title: "Appearance saved" });
            } catch {
              toast({
                title: "Appearance was not saved",
                description: "Please try again in a moment.",
                variant: "destructive",
              });
            } finally {
              setSaving(false);
            }
          }}
        >
          Save appearance
        </SavingButton>
      </div>
    </div>
  );
}

function CurrencySection() {
  const {
    currency,
    currencyCountryCode,
    saveRegion,
    timezone,
  } = useWorkspaceRegion();
  const initialOption =
    countryCurrencyOption(currencyCountryCode, currency) ||
    countryCurrencyOptions.find(
      (option) => option.currencyCode === currency,
    ) ||
    countryCurrencyOptions[0]!;
  const [selectedValue, setSelectedValue] = useState(initialOption.value);
  const [saving, setSaving] = useState(false);
  const currencySelectOptions = useMemo(
    () =>
      countryCurrencyOptions.map((option) => ({
        value: option.value,
        label: `${option.countryName} - ${option.currencyCode}`,
        description: `${option.currencyName} - ${option.symbol}`,
        keywords: option.keywords,
        leading: (
          <span className="flex h-7 w-10 shrink-0 items-center justify-center rounded border border-border bg-background">
            <CountryFlagIcon country={option.countryCode as Country} />
          </span>
        ),
      })),
    [],
  );
  const selected =
    countryCurrencyOptions.find((option) => option.value === selectedValue) ||
    initialOption;

  useEffect(() => {
    const next =
      countryCurrencyOption(currencyCountryCode, currency) ||
      countryCurrencyOptions.find(
        (option) => option.currencyCode === currency,
      );
    if (next) setSelectedValue(next.value);
  }, [currency, currencyCountryCode]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveRegion({
        currency: selected.currencyCode,
        currencyCountryCode: selected.countryCode,
        timezone,
      });
      toast({
        title: "Workspace currency saved",
        description: `${selected.countryName} - ${selected.currencyCode} is now the workspace default.`,
      });
    } catch {
      toast({
        title: "Currency was not saved",
        description: "Please try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <SettingsBlock title="Workspace currency">
        <div className="max-w-[620px] space-y-6">
          <div className="space-y-2">
            <Label htmlFor="workspace-currency">Default currency</Label>
            <SearchableSelect
              id="workspace-currency"
              value={selectedValue}
              onChange={setSelectedValue}
              options={currencySelectOptions}
              placeholder="Select a country and currency"
              searchPlaceholder="Search country, currency, code or symbol..."
              className="max-w-[440px]"
            />
            <p className="text-[12px] leading-5 text-muted-foreground">
              Used for new forms, payment defaults and workspace totals. Existing
              transactions keep the currency they were recorded in.
            </p>
          </div>

          <div className="flex max-w-[440px] items-center gap-4 border-y border-border py-5">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Banknote className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] text-muted-foreground">Example total</p>
              <p className="mt-1 text-[20px] font-semibold">
                {formatCurrency(12450.75, selected.currencyCode)}
              </p>
            </div>
            <Badge variant="outline">
              <CountryFlagIcon country={selected.countryCode as Country} />
              {selected.currencyCode}
            </Badge>
          </div>
        </div>
      </SettingsBlock>

      <div className="flex justify-end pt-6">
        <SavingButton
          type="button"
          loading={saving}
          disabled={
            selected.currencyCode === currency &&
            selected.countryCode === currencyCountryCode
          }
          onClick={handleSave}
        >
          Save currency
        </SavingButton>
      </div>
    </div>
  );
}

function PasswordInput({
  id,
  label,
  onChange,
  value,
}: {
  id: string;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={cn(inputClassName, "pr-11")}
          autoComplete={id === "current-password" ? "current-password" : "new-password"}
          required
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          className="absolute right-0 top-0 flex h-10 w-10 items-center justify-center text-muted-foreground hover:text-foreground"
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
        >
          {visible ? (
            <EyeOff className="h-4 w-4" />
          ) : (
            <Eye className="h-4 w-4" />
          )}
        </button>
      </div>
    </div>
  );
}

function getBrowserName() {
  if (typeof navigator === "undefined") return "Current browser";
  const agent = navigator.userAgent;
  if (agent.includes("Edg/")) return "Microsoft Edge";
  if (agent.includes("Firefox/")) return "Mozilla Firefox";
  if (agent.includes("Chrome/")) return "Google Chrome";
  if (agent.includes("Safari/")) return "Safari";
  return "Current browser";
}

function SecuritySection() {
  const { signOut, updatePassword, user } = useAuth();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const passwordStrength = useMemo(() => {
    let score = 0;
    if (newPassword.length >= 8) score += 1;
    if (/[A-Z]/.test(newPassword) && /[a-z]/.test(newPassword)) score += 1;
    if (/\d/.test(newPassword)) score += 1;
    if (/[^A-Za-z0-9]/.test(newPassword)) score += 1;
    return score;
  }, [newPassword]);

  const handlePassword = async (event: FormEvent) => {
    event.preventDefault();
    if (newPassword.length < 8) {
      toast({
        title: "Use at least 8 characters",
        variant: "destructive",
      });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({
        title: "Passwords do not match",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      await updatePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast({ title: "Password updated" });
    } catch (error) {
      toast({
        title: "Password was not updated",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    navigate("/auth", { replace: true });
  };

  return (
    <div>
      <SettingsBlock title="Account email">
        <div className="flex max-w-[680px] flex-wrap items-center gap-4 rounded-md border border-border p-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <Mail className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-medium">{user?.email}</p>
            <p className="text-[12px] text-muted-foreground">Verified account</p>
          </div>
          <Badge variant="outline" className="text-emerald-600 dark:text-emerald-400">
            <Check className="mr-1 h-3 w-3" />
            Verified
          </Badge>
        </div>
      </SettingsBlock>

      <SettingsBlock title="Change password">
        <form onSubmit={handlePassword} className="max-w-[480px] space-y-5">
          <PasswordInput
            id="current-password"
            label="Current password"
            value={currentPassword}
            onChange={setCurrentPassword}
          />
          <PasswordInput
            id="new-password"
            label="New password"
            value={newPassword}
            onChange={setNewPassword}
          />
          {newPassword && (
            <div>
              <div className="grid grid-cols-4 gap-1.5">
                {[1, 2, 3, 4].map((step) => (
                  <span
                    key={step}
                    className={cn(
                      "h-1.5 rounded-full",
                      passwordStrength >= step ? "bg-primary" : "bg-muted",
                    )}
                  />
                ))}
              </div>
              <p className="mt-2 text-[12px] text-muted-foreground">
                {passwordStrength <= 1
                  ? "Weak"
                  : passwordStrength <= 3
                    ? "Good"
                    : "Strong"}
              </p>
            </div>
          )}
          <PasswordInput
            id="confirm-password"
            label="Confirm new password"
            value={confirmPassword}
            onChange={setConfirmPassword}
          />
          <SavingButton type="submit" loading={saving}>
            <KeyRound className="h-4 w-4" />
            Update password
          </SavingButton>
        </form>
      </SettingsBlock>

      <SettingsBlock title="Active session">
        <div className="flex max-w-[680px] flex-wrap items-center gap-4 border-y border-border py-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-md bg-muted text-primary">
            <Monitor className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-medium">{getBrowserName()}</p>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              This device · Active now
            </p>
          </div>
          <Button type="button" variant="outline" onClick={handleSignOut}>
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
        </div>
      </SettingsBlock>
    </div>
  );
}

function UsageMeter({
  allowance,
  caption,
  icon: Icon,
  kind,
  label,
  used,
}: {
  allowance: Allowance;
  caption?: string;
  icon: LucideIcon;
  kind: "bytes" | "count";
  label: string;
  used: number;
}) {
  const percent = usagePercent(used, allowance);
  const left = remainingAllowance(used, allowance);
  const nearLimit = allowance !== null && percent >= 80;
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="flex items-center gap-2 text-[12px] font-medium">
          <Icon className="h-4 w-4 text-primary" />
          {label}
        </span>
        <span className="text-[11px] text-muted-foreground">
          {formatAllowance(allowance, kind)}
          {allowance === null ? "" : " included"}
        </span>
      </div>
      <div className="mt-4 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-[22px] font-semibold leading-none">
          {kind === "bytes" ? formatBytes(used) : used.toLocaleString()}
        </span>
        <span className="text-[11px] text-muted-foreground">used</span>
      </div>
      {allowance !== null && (
        <>
          <Progress
            value={percent}
            className={cn("mt-3 h-1.5", nearLimit && "[&>div]:bg-destructive")}
          />
          <p className="mt-2 text-[11px] text-muted-foreground">
            {left === 0
              ? "Allowance used in full"
              : `${kind === "bytes" ? formatBytes(left ?? 0) : (left ?? 0).toLocaleString()} left this period`}
          </p>
        </>
      )}
      {caption && (
        <p className="mt-2.5 text-[10px] leading-4 text-muted-foreground">
          {caption}
        </p>
      )}
    </div>
  );
}

function UncappedStat({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border p-4">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-primary">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="text-[18px] font-semibold leading-none">
          {value.toLocaleString()}
        </p>
        <p className="mt-1 truncate text-[11px] text-muted-foreground">
          {label} · never metered
        </p>
      </div>
    </div>
  );
}

function AddOnTable({
  note,
  packs,
  title,
}: {
  note: string;
  packs: AddOnPack[];
  title: string;
}) {
  return (
    <div className="rounded-lg border border-border">
      <div className="border-b border-border px-4 py-3">
        <p className="text-[12px] font-medium">{title}</p>
        <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">
          {note}
        </p>
      </div>
      <ul className="divide-y divide-border">
        {packs.map((pack) => (
          <li
            key={pack.id}
            className="flex items-center justify-between gap-3 px-4 py-2.5"
          >
            <span className="text-[12px] text-muted-foreground">
              {pack.label}
            </span>
            <span className="text-[12px] font-medium">
              ${pack.price.toFixed(2)}
              {pack.recurring && (
                <span className="text-[10px] font-normal text-muted-foreground">
                  /mo
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function BillingSection() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [usage, setUsage] = useState<UsageStats | null>(null);

  useEffect(() => {
    if (!user) return;
    let active = true;
    getUsageStats(user.id)
      .then((stats) => {
        if (active) setUsage(stats);
      })
      .catch((error) => {
        toast({
          title: "Usage could not be loaded",
          description: getErrorMessage(error),
          variant: "destructive",
        });
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [user]);

  if (loading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );
  }

  if (!usage) {
    return (
      <div className="border-y border-border py-16 text-center">
        <CircleDollarSign className="mx-auto h-5 w-5 text-muted-foreground" />
        <p className="mt-3 text-[14px] font-medium">Usage is unavailable</p>
        <p className="mt-1 text-[12px] text-muted-foreground">
          Reload the page to try again.
        </p>
      </div>
    );
  }

  const plan = planById(usage.subscription.plan);
  const storageAllowance =
    plan.limits.storageBytes === null
      ? null
      : plan.limits.storageBytes + usage.subscription.extraStorageBytes;
  const emailAllowance =
    plan.limits.emails === null
      ? null
      : plan.limits.emails + usage.subscription.extraEmails;
  const included = plan.limits.aiCredits;
  const spent = usage.credits.spentThisPeriod;
  const purchased = usage.credits.purchased;
  const creditsAvailable =
    included === null ? null : Math.max(0, included + purchased - spent);
  const periodEnd = usage.subscription.periodEnd
    ? new Date(usage.subscription.periodEnd)
    : null;
  const periodLabel = periodEnd
    ? periodEnd.toLocaleDateString(undefined, {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "";

  return (
    <div>
      <SettingsBlock title="Plan">
        <div className="max-w-[760px] rounded-lg border border-border">
          <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge>{plan.name}</Badge>
                <span className="text-[12px] text-muted-foreground">
                  {formatPlanPrice(plan)}
                  {plan.monthlyPrice ? " per month" : ""}
                </span>
                {usage.subscription.status !== "active" && (
                  <Badge variant="outline" className="text-[10px] capitalize">
                    {usage.subscription.status.replace("_", " ")}
                  </Badge>
                )}
              </div>
              <p className="mt-3 text-[13px] leading-5 text-muted-foreground">
                {plan.tagline}
              </p>
              {periodLabel && (
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  {usage.subscription.cancelAtPeriodEnd
                    ? `Access ends ${periodLabel}`
                    : `Allowances reset ${periodLabel}`}
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2 sm:shrink-0">
              <Button asChild variant="outline" className="flex-1 sm:flex-none">
                <Link to="/pricing#pricing">Compare plans</Link>
              </Button>
              <Button asChild className="flex-1 sm:flex-none">
                <Link to="/pricing#pricing">
                  {plan.id === "trial" ? "Choose a plan" : "Change plan"}
                </Link>
              </Button>
            </div>
          </div>
          <p className="border-t border-border px-5 py-4 text-[11px] leading-5 text-muted-foreground">
            Your subscription pays for the platform. Only storage, outbound
            email, and AI credits are counted against an allowance.
          </p>
        </div>
      </SettingsBlock>

      <SettingsBlock title="Counted this period">
        <div className="grid max-w-[760px] gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <UsageMeter
            allowance={included}
            icon={Bot}
            kind="count"
            label="AI credits"
            used={spent}
            caption={
              purchased > 0
                ? `Plus ${purchased.toLocaleString()} purchased credits.`
                : "Spent only by AI actions."
            }
          />
          <UsageMeter
            allowance={storageAllowance}
            icon={Database}
            kind="bytes"
            label="Storage"
            used={usage.storage.usedBytes}
            caption={
              usage.subscription.extraStorageBytes > 0
                ? `Includes ${formatBytes(usage.subscription.extraStorageBytes)} of add-on storage.`
                : undefined
            }
          />
          <UsageMeter
            allowance={emailAllowance}
            icon={Mail}
            kind="count"
            label="Emails sent"
            used={usage.emails.sent}
            caption={EMAIL_ALLOWANCE_RULE}
          />
        </div>
      </SettingsBlock>

      <SettingsBlock title="Never counted">
        <div className="grid max-w-[760px] gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <UncappedStat
            icon={ReceiptText}
            label="Form responses"
            value={usage.responses}
          />
          <UncappedStat
            icon={UsersRound}
            label="Contacts"
            value={usage.contacts}
          />
          <UncappedStat
            icon={Workflow}
            label="Workflows"
            value={usage.workflows}
          />
        </div>
        {plan.limits.forms !== null && (
          <p className="mt-3 max-w-[760px] text-[11px] leading-5 text-muted-foreground">
            {plan.name} allows {plan.limits.forms} forms and you have built{" "}
            {usage.forms.toLocaleString()}. That is a limit on how many forms
            exist, never on how many responses they can collect.
          </p>
        )}
      </SettingsBlock>

      <SettingsBlock title="AI credits">
        <div className="max-w-[760px] rounded-lg border border-border">
          <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[32px] font-semibold leading-none text-foreground">
                {creditsAvailable === null
                  ? "Unlimited"
                  : creditsAvailable.toLocaleString()}
              </p>
              <p className="mt-2 text-[13px] text-muted-foreground">
                credits available
              </p>
            </div>
            <Button asChild className="w-full sm:w-auto">
              <Link to="/pricing#add-ons">Buy credits</Link>
            </Button>
          </div>
          <dl className="grid gap-px border-t border-border bg-border sm:grid-cols-3">
            {[
              [
                "Included with plan",
                included === null ? "Unlimited" : included.toLocaleString(),
              ],
              ["Purchased packs", purchased.toLocaleString()],
              ["Used this period", spent.toLocaleString()],
            ].map(([label, value]) => (
              <div key={label} className="bg-card px-5 py-3.5">
                <dt className="text-[11px] text-muted-foreground">{label}</dt>
                <dd className="mt-1 text-[15px] font-medium">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="border-t border-border p-5">
            <p className="mb-3 text-[12px] font-medium">Where credits went</p>
            {usage.credits.breakdown.length ? (
              <ul className="divide-y divide-border">
                {usage.credits.breakdown.map((entry) => (
                  <li
                    key={entry.action}
                    className="flex items-center justify-between gap-3 py-2.5"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[12px]">
                        {entry.action}
                      </span>
                      <span className="block text-[10px] text-muted-foreground">
                        {entry.runs.toLocaleString()}{" "}
                        {entry.runs === 1 ? "run" : "runs"}
                      </span>
                    </span>
                    <span className="shrink-0 text-[12px] font-medium">
                      {entry.credits.toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div>
                <p className="text-[11px] leading-5 text-muted-foreground">
                  No AI credits used this period. Each AI action costs a fixed
                  amount:
                </p>
                <ul className="mt-3 divide-y divide-border">
                  {AI_CREDIT_COSTS.map((cost) => (
                    <li
                      key={cost.action}
                      className="flex items-center justify-between gap-3 py-2"
                    >
                      <span className="min-w-0 truncate text-[12px] text-muted-foreground">
                        {cost.action}
                      </span>
                      <span className="shrink-0 text-[11px] font-medium">
                        {cost.credits}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </SettingsBlock>

      <SettingsBlock title="Add-ons">
        <div className="grid max-w-[760px] gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <AddOnTable
            packs={AI_CREDIT_PACKS}
            title="AI credits"
            note={`One-time · rolls over ${CREDIT_ROLLOVER_DAYS} days`}
          />
          <AddOnTable
            packs={STORAGE_PACKS}
            title="Storage"
            note="Monthly · added to your quota"
          />
          <AddOnTable
            packs={EMAIL_PACKS}
            title="Email volume"
            note="One-time · this period only"
          />
        </div>
      </SettingsBlock>

      <SettingsBlock title="Billing history">
        {usage.billingHistory.length ? (
          <div className="max-w-[760px] divide-y divide-border border-y border-border">
            {usage.billingHistory.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center justify-between gap-4 py-4"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-primary">
                    <ReceiptText className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium">
                      {entry.description}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {new Date(entry.createdAt).toLocaleDateString()} ·{" "}
                      <span className="capitalize">{entry.status}</span>
                    </p>
                  </div>
                </div>
                <span className="shrink-0 text-[13px] font-medium">
                  {formatCurrency(
                    entry.amountCents / 100,
                    entry.currency || "USD",
                  )}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex max-w-[760px] items-center gap-4 border-y border-border py-5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted text-primary">
              <ReceiptText className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-[14px] font-medium">No transactions yet</p>
              <p className="mt-0.5 text-[12px] leading-5 text-muted-foreground">
                Subscription charges and add-on purchases appear here
              </p>
            </div>
          </div>
        )}
      </SettingsBlock>
    </div>
  );
}

function DataSection({ localSettings }: { localSettings: LocalUserSettings }) {
  const { profile, signOut, user } = useAuth();
  const navigate = useNavigate();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePhrase, setDeletePhrase] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    if (!user) return;
    setExporting(true);
    try {
      const [workspace, notifications, usage] = await Promise.all([
        getWorkspaceSettings(user.id),
        getNotificationSettings(user.id),
        getUsageStats(user.id),
      ]);
      const exportData = {
        exportedAt: new Date().toISOString(),
        account: user,
        profile,
        workspace,
        notifications,
        preferences: localSettings,
        usage,
      };
      const blob = new Blob([JSON.stringify(exportData, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `maxform-account-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast({ title: "Account export downloaded" });
    } catch (error) {
      toast({
        title: "Export could not be created",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  };

  const handleDelete = async () => {
    if (!user) return;
    setDeleting(true);
    try {
      await deleteUserAccount(user.id, deletePassword);
      localStorage.removeItem(`maxform-settings:${user.id}`);
      await signOut();
      navigate("/", { replace: true });
    } catch (error) {
      toast({
        title: "Account was not deleted",
        description: getErrorMessage(error),
        variant: "destructive",
      });
      setDeleting(false);
    }
  };

  return (
    <div>
      <SettingsBlock title="Export account data">
        <div className="flex max-w-[680px] flex-wrap items-center gap-4 rounded-md border border-border p-5">
          <span className="flex h-11 w-11 items-center justify-center rounded-md bg-muted text-primary">
            <Download className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-medium">MaxForm account export</p>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              JSON · profile, workspace and preferences
            </p>
          </div>
          <SavingButton
            type="button"
            variant="outline"
            loading={exporting}
            onClick={handleExport}
          >
            Download
          </SavingButton>
        </div>
      </SettingsBlock>

      <SettingsBlock title="Privacy">
        <div className="max-w-[680px] divide-y divide-border border-y border-border">
          <div className="flex items-center gap-4 py-4">
            <LockKeyhole className="h-4 w-4 text-primary" />
            <span className="min-w-0 flex-1 text-[14px] font-medium">
              Account email
            </span>
            <span className="truncate text-[13px] text-muted-foreground">
              {user?.email}
            </span>
          </div>
          <div className="flex items-center gap-4 py-4">
            <CalendarDays className="h-4 w-4 text-primary" />
            <span className="min-w-0 flex-1 text-[14px] font-medium">
              Account created
            </span>
            <span className="text-[13px] text-muted-foreground">
              {user?.created_at
                ? new Date(user.created_at).toLocaleDateString()
                : "Unavailable"}
            </span>
          </div>
          <div className="flex items-center gap-4 py-4">
            <Smartphone className="h-4 w-4 text-primary" />
            <span className="min-w-0 flex-1 text-[14px] font-medium">
              Stored sessions
            </span>
            <span className="text-[13px] text-muted-foreground">1 device</span>
          </div>
        </div>
      </SettingsBlock>

      <SettingsBlock title="Delete account">
        <div className="flex max-w-[680px] flex-wrap items-center gap-4 rounded-md border border-destructive/40 bg-destructive/5 p-5">
          <span className="flex h-11 w-11 items-center justify-center rounded-md bg-destructive/10 text-destructive">
            <Trash2 className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold">Delete MaxForm account</p>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              Permanent · includes workspace data
            </p>
          </div>
          <Button
            type="button"
            variant="destructive"
            onClick={() => setDeleteOpen(true)}
          >
            Delete account
          </Button>
        </div>
      </SettingsBlock>

      <Dialog
        open={deleteOpen}
        onOpenChange={(open) => {
          setDeleteOpen(open);
          if (!open && !deleting) {
            setDeletePhrase("");
            setDeletePassword("");
          }
        }}
      >
        <DialogContent className="max-w-[460px]">
          <DialogHeader>
            <DialogTitle>Delete account</DialogTitle>
            <DialogDescription>
              This permanently deletes your profile, forms, responses and workspace records.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="delete-password">Current password</Label>
              <Input
                id="delete-password"
                type="password"
                value={deletePassword}
                onChange={(event) => setDeletePassword(event.target.value)}
                className={inputClassName}
                autoComplete="current-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="delete-phrase">
                Type DELETE to confirm
              </Label>
              <Input
                id="delete-phrase"
                value={deletePhrase}
                onChange={(event) => setDeletePhrase(event.target.value)}
                className={inputClassName}
                autoComplete="off"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteOpen(false)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <SavingButton
              type="button"
              variant="destructive"
              loading={deleting}
              disabled={deletePhrase !== "DELETE" || !deletePassword}
              onClick={handleDelete}
            >
              Delete permanently
            </SavingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function SettingsContent() {
  const { user, workspace } = useAuth();
  const {
    loading: regionLoading,
    timezone: workspaceTimezone,
  } = useWorkspaceRegion();
  const { resolvedTheme } = useTheme();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedSection = searchParams.get("section");
  const normalizedSection =
    requestedSection === "profile"
      ? "workspace"
      : (requestedSection as SettingsSection | null);
  const visibleGroups = useMemo(
    () => sectionsForRole(workspace.canManageWorkspace),
    [workspace.canManageWorkspace],
  );
  const visibleSections = useMemo(
    () => visibleGroups.flatMap((group) => group.items),
    [visibleGroups],
  );
  const activeSection = visibleSections.some(
    (section) => section.key === normalizedSection,
  )
    ? normalizedSection!
    : "workspace";
  const [localSettings, setLocalSettings] =
    useState<LocalUserSettings>(defaultLocalSettings);

  useEffect(() => {
    if (!user) return;
    const stored = localStorage.getItem(`maxform-settings:${user.id}`);
    if (!stored) {
      setLocalSettings(defaultLocalSettings());
      return;
    }

    try {
      const storedSettings = JSON.parse(
        stored,
      ) as Partial<LocalUserSettings>;
      setLocalSettings({
        ...defaultLocalSettings(),
        ...storedSettings,
        brandColor: normalizeBrandColor(storedSettings.brandColor),
      });
    } catch {
      setLocalSettings(defaultLocalSettings());
    }
  }, [user]);

  useEffect(() => {
    if (regionLoading || !workspaceTimezone) return;
    setLocalSettings((current) => ({
      ...current,
      timezone: workspaceTimezone,
    }));
  }, [regionLoading, workspaceTimezone]);

  useEffect(() => {
    const primary = brandColorToHsl(
      localSettings.brandColor,
      resolvedTheme === "dark",
    );
    const root = document.documentElement;
    root.style.setProperty("--primary", primary);
    root.style.setProperty("--ring", primary);
    root.style.setProperty("--sidebar-primary", primary);
    root.style.setProperty("--sidebar-ring", primary);
  }, [localSettings.brandColor, resolvedTheme]);

  useEffect(() => {
    document.documentElement.dataset.reduceMotion = String(
      localSettings.reduceMotion,
    );
  }, [localSettings.reduceMotion]);

  const saveLocalSettings = (settings = localSettings) => {
    if (!user) return;
    localStorage.setItem(
      `maxform-settings:${user.id}`,
      JSON.stringify(settings),
    );
    window.dispatchEvent(
      new CustomEvent("maxform-settings-updated", {
        detail: settings,
      }),
    );
  };

  const selectSection = (section: SettingsSection) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("tab", "settings");
      next.set("section", section);
      next.delete("view");
      return next;
    });
  };

  const content = (() => {
    switch (activeSection) {
      case "workspace":
        return workspace.canManageWorkspace ? (
          <WorkspaceSection
            localSettings={localSettings}
            setLocalSettings={setLocalSettings}
            saveLocalSettings={saveLocalSettings}
          />
        ) : null;
      case "team":
        return <TeamSection />;
      case "currency":
        return <CurrencySection />;
      case "notifications":
        return (
          <NotificationsSection
            localSettings={localSettings}
            setLocalSettings={setLocalSettings}
            saveLocalSettings={saveLocalSettings}
          />
        );
      case "appearance":
        return (
          <AppearanceSection
            localSettings={localSettings}
            setLocalSettings={setLocalSettings}
            saveLocalSettings={saveLocalSettings}
          />
        );
      case "security":
        return <SecuritySection />;
      case "billing":
        return <BillingSection />;
      case "data":
        return <DataSection localSettings={localSettings} />;
      default:
        return null;
    }
  })();

  return (
    <div className="min-h-full bg-background text-foreground">
      <div className="border-b border-border xl:hidden">
        <nav className="flex overflow-x-auto px-1 py-2" aria-label="Settings sections">
          {visibleSections.map((item) => {
            const Icon = item.icon;
            const active = activeSection === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => selectSection(item.key)}
                className={cn(
                  "flex h-10 shrink-0 items-center gap-2 rounded-md px-3 text-[13px] transition-colors",
                  active
                    ? "bg-primary/10 font-medium text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="flex min-h-[640px]">
        <aside className="hidden w-[214px] shrink-0 border-r border-border py-8 pr-5 xl:block">
          <nav className="sticky top-0 space-y-7" aria-label="Settings sections">
            {visibleGroups.map((group) => (
              <div key={group.label}>
                <p className="mb-2 px-3 text-[11px] font-semibold uppercase text-muted-foreground">
                  {group.label}
                </p>
                <div className="space-y-1">
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const active = activeSection === item.key;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => selectSection(item.key)}
                        className={cn(
                          "flex h-10 w-full items-center gap-3 rounded-md px-3 text-left text-[14px] transition-colors",
                          active
                            ? "bg-primary/10 font-medium text-primary"
                            : "text-muted-foreground hover:bg-accent hover:text-foreground",
                        )}
                      >
                        <Icon className="h-4 w-4" />
                        <span className="min-w-0 flex-1 truncate">
                          {item.label}
                        </span>
                        {active && <ChevronRight className="h-3.5 w-3.5" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
        </aside>

        <div className="min-w-0 flex-1 px-1 pb-16 pt-8 sm:px-6 xl:px-10 xl:pt-8">
          <div className="max-w-[780px]">
            <div className="mb-9">
              <p className="text-[12px] font-medium uppercase text-primary">
                Settings
              </p>
              <h1 className="mt-2 text-[30px] font-semibold leading-tight sm:text-[36px]">
                {sectionMeta[activeSection].title}
              </h1>
              <p className="mt-2 text-[14px] text-muted-foreground">
                {sectionMeta[activeSection].description}
              </p>
            </div>
            {content}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Settings() {
  return <Navigate to="/dashboard?tab=settings&section=workspace" replace />;
}
