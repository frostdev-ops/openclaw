import type { PageId } from "../../types";
import { Icon, type IconName } from "../ui/Icon";

interface NavItem {
  id: PageId;
  label: string;
  icon: IconName;
  badge?: number;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

interface SidebarProps {
  activePage: PageId;
  onNavigate: (page: PageId) => void;
  approvalCount: number;
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: "CONTROL",
    items: [
      { id: "overview", label: "Overview", icon: "activity" },
      { id: "channels", label: "Channels", icon: "radio" },
      { id: "instances", label: "Instances", icon: "layers" },
      { id: "sessions", label: "Sessions", icon: "messageSquare" },
      { id: "usage", label: "Usage", icon: "barChart" },
      { id: "cron", label: "Cron Jobs", icon: "clock" },
    ],
  },
  {
    label: "AGENT",
    items: [
      { id: "agents", label: "Agents", icon: "users" },
      { id: "skills", label: "Skills", icon: "zap" },
      { id: "nodes", label: "Nodes", icon: "cpu" },
    ],
  },
  {
    label: "SETTINGS",
    items: [
      { id: "config", label: "Configuration", icon: "settings" },
      { id: "approvals", label: "Approvals", icon: "shield" },
      { id: "logs", label: "Logs", icon: "scrollText" },
      { id: "security", label: "Security", icon: "shield" },
    ],
  },
];

export function Sidebar({ activePage, onNavigate, approvalCount }: SidebarProps) {
  const groups = NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.map((item) => ({
      ...item,
      badge: item.id === "approvals" ? (approvalCount || undefined) : undefined,
    })),
  }));

  return (
    <nav className="nav">
      <div className="nav-brand">
        <div className="nav-brand-name">OPENCLAW</div>
        <div className="nav-brand-sub">NODE CLIENT</div>
      </div>
      <div className="nav-scroll">
        {groups.map((group) => (
          <div key={group.label} className="nav-group">
            <div className="nav-label">{group.label}</div>
            {group.items.map((item) => (
              <button
                key={item.id}
                className={`nav-item${activePage === item.id ? " active" : ""}`}
                onClick={() => onNavigate(item.id)}
                type="button"
              >
                <Icon name={item.icon} size={14} className="nav-item-icon" />
                <span>{item.label}</span>
                {item.badge != null && item.badge > 0 && (
                  <span className="nav-badge">{item.badge}</span>
                )}
              </button>
            ))}
          </div>
        ))}
      </div>
    </nav>
  );
}
