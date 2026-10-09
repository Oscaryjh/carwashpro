import { notFound } from "next/navigation";
import { WalletHub, type WalletHubProps } from "@/components/wallet/wallet-hub";
import { getBusinessContext } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import { authorizedOperationalBranchWhere } from "@/lib/branches";
import { resolveWalletHubScope } from "@/lib/wallet/hub-scope";
import { isWalletHubAccessError } from "@/lib/wallet/hub-availability";
import { parseHubQuery, resolveHubPeriod } from "@/lib/wallet/hub-presentation";
import { readWalletHubOverview, readWalletHubTransactions, readWalletHubTopUps, readWalletHubCustomerBalances } from "@/lib/wallet/hub-read-model";

export default async function WalletPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const context = await getBusinessContext();
  if (context.isPlatformAdmin || !context.businessId) notFound();
  let query;
  try { query = parseHubQuery(await searchParams); } catch { notFound(); }
  const ctx = { businessId: context.businessId, user: context.user, branchId: query.branchId };
  try { await resolveWalletHubScope(ctx); } catch (error) { if (isWalletHubAccessError(error)) notFound(); throw error; }
  const [business, branches] = await Promise.all([
    prisma.business.findUniqueOrThrow({ where: { id: context.businessId }, select: { timezone: true, businessDayCutoffTime: true } }),
    prisma.branch.findMany({ where: { businessId: context.businessId }, select: { id: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }] }),
  ]);
  let period;
  try { period = resolveHubPeriod(query, business); } catch { notFound(); }
  const input = { fromDate: period.fromDate, toDateExclusive: period.toDateExclusive, search: query.q, cursor: query.cursor, pageSize: 20 };
  const props: WalletHubProps = { query, period, timezone: business.timezone, branches, invoiceViewIds: [], canViewCustomers: hasBusinessCapability(context.access, "VIEW_CRM") };
  // Same effective Owner contract as the Offers route, after the live Hub
  // authorization and WALLET availability checks above. Never infer from UI role.
  props.canManageTopUpOffers = context.access.granted && context.access.effectiveBusinessRole === "BUSINESS_OWNER";
  try {
  if (query.view === "overview") {
    [props.overview, props.transactions] = await Promise.all([readWalletHubOverview(ctx, input), readWalletHubTransactions(ctx, { ...input, search: "", cursor: undefined })]);
  } else if (query.view === "transactions") props.transactions = await readWalletHubTransactions(ctx, { ...input, type: query.type });
  else if (query.view === "top-ups") props.topUps = await readWalletHubTopUps(ctx, input);
  else props.balances = await readWalletHubCustomerBalances(ctx, { pageSize: 20, search: query.q, cursor: query.cursor });
  } catch (error) {
    if (error instanceof SyntaxError || isWalletHubAccessError(error)) notFound();
    throw error;
  }
  const invoiceIds = props.transactions?.rows.flatMap(row => row.invoiceId ? [row.invoiceId] : []) ?? [];
  if (invoiceIds.length && hasBusinessCapability(context.access, "VIEW_INVOICES")) {
    props.invoiceViewIds = (await prisma.invoice.findMany({ where: { businessId: context.businessId, id: { in: invoiceIds }, ...authorizedOperationalBranchWhere(context.user) }, select: { id: true } })).map(row => row.id);
  }
  return <WalletHub {...props} />;
}
