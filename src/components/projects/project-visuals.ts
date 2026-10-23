import {
  Building2,
  Briefcase,
  CalendarDays,
  Flag,
  FolderKanban,
  Megaphone,
  Rocket,
  Sparkles,
  Target,
  Ticket,
  type LucideIcon,
} from "lucide-react";

import type { ProjectColor, ProjectIcon } from "@/lib/projects";

const icons: Record<ProjectIcon, LucideIcon> = {
  briefcase: Briefcase,
  building: Building2,
  calendar: CalendarDays,
  flag: Flag,
  folder: FolderKanban,
  megaphone: Megaphone,
  rocket: Rocket,
  sparkles: Sparkles,
  target: Target,
  ticket: Ticket,
};

/**
 * Tailwind cannot see class names built at runtime, so each swatch is written
 * out in full. Both themes are covered: the tinted surface reads on a light
 * card without glowing on a dark one.
 */
const colors: Record<ProjectColor, string> = {
  amber: "bg-amber-500/12 text-amber-700 dark:text-amber-300",
  blue: "bg-blue-500/12 text-blue-700 dark:text-blue-300",
  cyan: "bg-cyan-500/12 text-cyan-700 dark:text-cyan-300",
  emerald: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  orange: "bg-orange-500/12 text-orange-700 dark:text-orange-300",
  rose: "bg-rose-500/12 text-rose-700 dark:text-rose-300",
  slate: "bg-slate-500/12 text-slate-700 dark:text-slate-300",
  violet: "bg-violet-500/12 text-violet-700 dark:text-violet-300",
};

const swatches: Record<ProjectColor, string> = {
  amber: "bg-amber-500",
  blue: "bg-blue-500",
  cyan: "bg-cyan-500",
  emerald: "bg-emerald-500",
  orange: "bg-orange-500",
  rose: "bg-rose-500",
  slate: "bg-slate-500",
  violet: "bg-violet-500",
};

export const projectIcon = (value: string): LucideIcon =>
  icons[value as ProjectIcon] || FolderKanban;

export const projectTint = (value: string) =>
  colors[value as ProjectColor] || colors.blue;

export const projectSwatch = (value: string) =>
  swatches[value as ProjectColor] || swatches.blue;
