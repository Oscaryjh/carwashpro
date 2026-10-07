import { notFound } from "next/navigation";
import { ZodError } from "zod";
import { getBusinessContext } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import { authorizedOperationalBranchWhere } from "@/lib/branches";
import { resolvePackageHubScope } from "@/lib/packages/hub-scope";
import { readPackageHubOverview, readPackageHubActivity, readPackageHubSales, readPackageHubCustomerPackages } from "@/lib/packages/hub-read-model";
import { parsePackageHubQuery, resolvePackageHubPeriod } from "@/lib/packages/hub-presentation";
import { PackageHub, type PackageHubProps } from "@/components/packages/package-hub";
function accessDenied(error: unknown) { return error instanceof Error && ["Package Hub access denied.", "Package Hub branch unavailable."].includes(error.message); }
export default async function PackageHubPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const context = await getBusinessContext();
  if (context.isPlatformAdmin || !context.businessId) notFound();
  let query;
  try { query = parsePackageHubQuery(await searchParams); } catch { notFound(); }
  const ctx = { businessId: context.businessId, user: context.user, branchId: query.branchId };
  try { await resolvePackageHubScope(ctx); } catch (error) { if (accessDenied(error) || error instanceof ZodError) notFound(); throw error; }
  const [business, branches] = await Promise.all([
    prisma.business.findUniqueOrThrow({ where: { id: context.businessId }, select: { timezone: true, businessDayCutoffTime: true } }),
    prisma.branch.findMany({ where: { businessId: context.businessId }, select: { id: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }] }),
  ]);
  let period;
  try { period = resolvePackageHubPeriod(query, business); } catch (error) {
    if (query.range !== "custom") throw error;
    return <section className="content"><h1>Packages</h1><p role="alert">Choose a period of up to 31 days, with the end on or after the start.</p><form action="/package-hub">
      <input type="hidden" name="view" value={query.view} /><input type="hidden" name="range" value="custom" />
      {query.branchId ? <input type="hidden" name="branchId" value={query.branchId} /> : null}
      <input type="hidden" name="q" value={query.q} /><input type="hidden" name="packageSearch" value={query.packageSearch} />
      {query.type ? <input type="hidden" name="type" value={query.type} /> : null}{query.status ? <input type="hidden" name="status" value={query.status} /> : null}
      <label>From<input type="date" name="from" defaultValue={query.from} required /></label><label>To<input type="date" name="to" defaultValue={query.to} required /></label><button type="submit">Apply</button>
    </form></section>;
  }
  const input = { fromDate: period.fromDate, toDateExclusive: period.toDateExclusive, search: query.q, packageSearch: query.packageSearch, cursor: query.cursor };
  const props: PackageHubProps = { query, period, branches, timezone: business.timezone,
    canManage: hasBusinessCapability(context.access, "VIEW_CATALOG"), canViewCustomers: hasBusinessCapability(context.access, "VIEW_CRM"), invoiceViewIds: [] };
  try {
    if (query.view === "overview") [props.overview, props.activity] = await Promise.all([readPackageHubOverview(ctx, input), readPackageHubActivity(ctx, { ...input, search: "", packageSearch: "", cursor: undefined })]);
    else if (query.view === "activity") props.activity = await readPackageHubActivity(ctx, { ...input, eventType: query.type });
    else if (query.view === "sales") props.sales = await readPackageHubSales(ctx, input);
    else props.customers = await readPackageHubCustomerPackages(ctx, { search: query.q, packageSearch: query.packageSearch, cursor: query.cursor, status: query.status });
  } catch (error) { if (accessDenied(error) || error instanceof ZodError || error instanceof SyntaxError) notFound(); throw error; }
  const invoiceIds = [...new Set([...(props.activity?.rows ?? []), ...(props.sales?.rows ?? [])].flatMap(row => row.invoiceId ? [row.invoiceId] : []))];
  if (invoiceIds.length && hasBusinessCapability(context.access, "VIEW_INVOICES")) props.invoiceViewIds = (await prisma.invoice.findMany({ where: { businessId: context.businessId, id: { in: invoiceIds }, ...authorizedOperationalBranchWhere(context.user) }, select: { id: true } })).map(row => row.id);
  return <PackageHub {...props} />;
}
