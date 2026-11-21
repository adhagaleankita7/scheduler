import {
  CalendarDays,
  CalendarRange,
  FileText,
  LayoutDashboard,
  LayoutGrid,
  ListOrdered,
  PenSquare,
  Settings,
  Share2,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
  featured?: boolean;
  badge?: string;
};

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/pages", label: "Pages", icon: LayoutGrid },
  { href: "/composer", label: "Composer", icon: PenSquare },
  { href: "/planner", label: "7-day planner", icon: CalendarRange, exact: true },
  {
    href: "/planner/month",
    label: "30-day planner",
    icon: CalendarDays,
    featured: true,
    badge: "30d",
  },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/queue", label: "Queue", icon: ListOrdered },
  { href: "/posts", label: "All posts", icon: FileText },
  { href: "/accounts", label: "Accounts", icon: Share2 },
];

export const SETTINGS_ITEM: NavItem = {
  href: "/settings",
  label: "Settings",
  icon: Settings,
};

export const PAGE_TITLES: Record<string, { title: string; subtitle: string }> = {
  "/dashboard": { title: "Dashboard", subtitle: "Your publishing command center" },
  "/pages": { title: "Pages", subtitle: "One dashboard for every page" },
  "/composer": { title: "Composer", subtitle: "Craft a post that sounds like you" },
  "/planner": { title: "7-day planner", subtitle: "A full week of content, handled" },
  "/planner/month": { title: "30-day planner", subtitle: "A full month of content, handled" },
  "/calendar": { title: "Calendar", subtitle: "Every post, mapped in time" },
  "/queue": { title: "Queue", subtitle: "Your automatic publishing rhythm" },
  "/posts": { title: "All posts", subtitle: "Drafts, scheduled and published" },
  "/accounts": { title: "Accounts", subtitle: "LinkedIn and Facebook connections" },
  "/settings": { title: "Settings", subtitle: "Workspace preferences" },
};
