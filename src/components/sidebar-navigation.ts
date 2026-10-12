import type { NavItem } from "./app-shell-frame";

// Presentation only: the caller supplies items AFTER all existing access gates.
export function organizeBusinessNavigation(items: NavItem[]): NavItem[] {
  const leaves = items.flatMap(item => item.children ?? [item]);
  const pick = (href: string) => leaves.find(item => item.href === href);
  const customers = ["/crm", "/loyalty", "/wallet", "/whatsapp/inbox"]
    .flatMap(href => {
      const item = pick(href);
      return item ? [{ ...item, ...(href === "/crm" ? { label: "Customer list", shortLabel: "Customers" } : {}) }] : [];
    });
  const catalog = [pick("/services"), pick("/products"), pick("/package-hub") ?? pick("/packages"), pick("/inventory"), pick("/discounts")]
    .filter((item): item is NavItem => Boolean(item));
  const moved = new Set([...customers, ...catalog].map(item => item.href));
  const remaining = items.filter(item => item.href !== "/catalog" && !moved.has(item.href));
  const ordered: NavItem[] = [];
  function take(predicate: (item: NavItem) => boolean) {
    const index = remaining.findIndex(predicate);
    if (index >= 0) ordered.push(...remaining.splice(index, 1));
  }
  take(item => item.href === "/dashboard");
  take(item => item.href === "/cashier" || item.href === "/work-orders");
  take(item => item.href === "/appointments");
  if (customers.length) ordered.push({ href: "/crm", label: "Customers", shortLabel: "Customers", icon: "crm", children: customers });
  if (catalog.length) ordered.push({ href: "/catalog", label: "Catalog", shortLabel: "Catalog", icon: "catalog", children: catalog });
  take(item => item.icon === "team");
  take(item => item.href === "/expenses");
  take(item => item.href === "/closing");
  take(item => item.icon === "reports");
  take(item => item.href === "/ai");
  const system = remaining.filter(item => item.icon === "companySettings" || item.icon === "security");
  // Preserve any existing unclassified entry rather than silently removing it.
  ordered.push(...remaining.filter(item => !system.includes(item)));
  ordered.push(...system.map((item, index) => ({ ...item, separatorBefore: index === 0 })));
  return ordered;
}
