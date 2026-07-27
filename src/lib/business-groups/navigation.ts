import type { NavItem } from "@/components/app-shell-frame";

export function getBusinessGroupNavItems(groupId: string): NavItem[] {
  return [
    {
      href: `/groups/${groupId}/overview`,
      label: "All Stores",
      shortLabel: "All",
      icon: "businesses",
    },
    {
      href: `/groups/${groupId}/reports?range=today`,
      label: "Group Reports",
      shortLabel: "Reports",
      icon: "reports",
    },
    {
      href: `/groups/${groupId}/closing?range=today`,
      label: "Daily Closing",
      shortLabel: "Closing",
      icon: "reports",
    },
  ];
}
