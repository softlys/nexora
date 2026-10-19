import {
  Building2,
  ChartColumn,
  Handshake,
  LayoutDashboard,
  ListChecks,
  Package,
  Palette,
  Plug,
  Settings,
  SquareKanban,
  Target,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import type { NavIcon } from "@/domain/navigation";

export const NAV_ICONS: Record<NavIcon, LucideIcon> = {
  overview: LayoutDashboard,
  companies: Building2,
  contacts: Users,
  leads: Target,
  deals: Handshake,
  pipeline: SquareKanban,
  orders: Package,
  tasks: ListChecks,
  automation: Workflow,
  integrations: Plug,
  analytics: ChartColumn,
  uikit: Palette,
  settings: Settings,
};
