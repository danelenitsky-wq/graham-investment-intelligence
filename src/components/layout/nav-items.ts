import {
  Activity,
  Bell,
  GitCompare,
  BarChart3,
  Briefcase,
  Calculator,
  Eye,
  Filter,
  History,
  LayoutDashboard,
  Settings,
  type LucideIcon,
} from "lucide-react";

export type NavKey = "overview" | "stocks" | "screening" | "valuation" | "financials" | "portfolio" | "watchlist" | "alerts" | "history" | "dataHealth" | "settings";

export interface NavItem {
  key: NavKey;
  path: string;
  icon: LucideIcon;
  section: "research" | "holdings" | "system";
}

export const NAV_ITEMS: NavItem[] = [
  { key: "overview", path: "/", icon: LayoutDashboard, section: "research" },
  { key: "stocks", path: "/stocks", icon: BarChart3, section: "research" },
  { key: "screening", path: "/screening", icon: Filter, section: "research" },
  { key: "valuation", path: "/valuation", icon: Calculator, section: "research" },
  { key: "financials", path: "/financials", icon: History, section: "research" },
  { key: "portfolio", path: "/portfolio", icon: Briefcase, section: "holdings" },
  { key: "watchlist", path: "/watchlist", icon: Eye, section: "holdings" },
  { key: "alerts", path: "/alerts", icon: Bell, section: "holdings" },
  { key: "history", path: "/history", icon: GitCompare, section: "holdings" },
  { key: "dataHealth", path: "/data-health", icon: Activity, section: "system" },
  { key: "settings", path: "/settings", icon: Settings, section: "system" },
];
