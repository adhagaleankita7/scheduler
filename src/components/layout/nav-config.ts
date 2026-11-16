import {
  CalendarDays,
  CalendarRange,
  FileText,
  LayoutDashboard,
  Linkedin,
  ListOrdered,
  PenSquare,
  Settings,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
  featured?: boolean;
};

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/composer", label: "Composer", icon: PenSquare },
  { href: "/planner", label: "7-day planner", icon: CalendarRange, featured: true },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/queue", label: "Queue", icon: ListOrdered },
  { href: "/posts", label: "All posts", icon: FileText },
  { href: "/accounts", label: "Accounts", icon: Linkedin },
];

export const SETTINGS_ITEM: NavItem = {
  href: "/settings",
  label: "Settings",
  icon: Settings,
};

export const PAGE_TITLES: Record<string, { title: string; subtitle: string }> = {
  "/dashboard": { title: "Dashboard", subtitle: "Your publishing command center" },
  "/composer": { title: "Composer", subtitle: "Craft a post that sounds like you" },
  "/planner": { title: "7-day planner", subtitle: "A full week of LinkedIn, handled" },
  "/calendar": { title: "Calendar", subtitle: "Every post, mapped in time" },
  "/queue": { title: "Queue", subtitle: "Your automatic publishing rhythm" },
  "/posts": { title: "All posts", subtitle: "Drafts, scheduled and published" },
  "/accounts": { title: "Accounts", subtitle: "LinkedIn connections and pages" },
  "/settings": { title: "Settings", subtitle: "Workspace preferences" },
};
