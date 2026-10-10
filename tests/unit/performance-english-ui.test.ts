import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { performanceError, performanceMoney, performanceMonth, comparisonLabel } from "../../src/app/(business)/team/performance/display";
import { formatTargetMoney, parseTargetAmount, equalTargets, targetDraftSchema } from "../../src/lib/performance/targets-contract";

test("Performance navigation uses the same English product name", () => {
  for (const path of ["src/components/app-shell.tsx", "src/app/(business)/team/layout.tsx"]) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /href: "\/team\/performance", label: "Performance"/);
    assert.doesNotMatch(source, /业绩管理/);
  }
});

test("Performance display preserves monetary values and translates existing comparison contracts", () => {
  for (const value of [0, 1000, -1000, 123456789]) assert.equal(performanceMoney(value), formatTargetMoney(value));
  assert.equal(performanceMoney(null), "Pending verification");
  assert.equal(performanceMonth(1), "January");
  assert.equal(performanceMonth(12), "December");
  assert.equal(comparisonLabel("上月同期"), "Previous period");
  assert.equal(comparisonLabel("上月整月"), "Previous month (full period)");
});

test("Performance maps real validation errors without changing validation or exposing raw failures", () => {
  for (const [action, expected] of [
    [() => parseTargetAmount("bad"), "Enter a valid amount with up to two decimal places."],
    [() => equalTargets(100, 200, "manager", ["staff"]), "The manager target exceeds Level 1. Adjust it before distributing evenly."],
    [() => equalTargets(100, 50, "", []), "Select a manager and at least one other employee."],
  ] as const) {
    assert.throws(action, error => {
      assert.equal(performanceError((error as Error).message), expected);
      return true;
    });
  }
  const invalid = targetDraftSchema.safeParse({ year: 2026, levels: [0, 0, 0], managerId: null,
    people: [], expectedRevision: 0, reason: "x", confirmGap: false });
  assert.equal(invalid.success, false);
  if (!invalid.success) {
    const copy = performanceError(invalid.error.message);
    assert.match(copy, /Enter a reason between 5 and 500 characters/);
    assert.match(copy, /All three thresholds must be above zero/);
    assert.doesNotMatch(copy, /\p{Script=Han}/u);
  }
  for (const message of ["目标版本已改变，请重新加载并预览。", "请明确确认目标分配差额。", "预览已过期，请重新预览。"]) {
    assert.doesNotMatch(performanceError(message), /\p{Script=Han}/u);
    assert.notEqual(performanceError(message), performanceError("unknown"));
  }
  for (const message of ["DB_PASSWORD=secret", "内部异常", '{"stack":"secret"}', '[null]', "constructor"]) {
    assert.equal(performanceError(message), "Unable to update targets. Check your entries and try again.");
  }
});

// Render the real components; only authentication, database and action boundaries are stubbed.
// Reintroducing Chinese product copy in any tab must fail this contract.
test("Performance renders English overview, targets, details and recovery states without translating user data", async () => {
  const cache = join(process.cwd(), "node_modules", ".cache");
  await mkdir(cache, { recursive: true });
  const directory = await mkdtemp(join(cache, "performance-copy-"));
  const key = "__performanceEnglishUI";
  const totals = { salesReceived: 1000, tipsReceived: 0, refunds: 0, total: 1000 };
  const period = { team: totals, unassigned: totals, started: true, complete: true, unassignedCount: 0,
    uncapturedCount: 0, pendingCount: 0, basisGapCount: 0,
    from: "2026-09-01T00:00:00Z", asOf: "2026-09-28T14:25:00Z", toExclusive: "2026-10-01T00:00:00Z" };
  const data = { year: 2026, month: 9, timezone: "Asia/Kuala_Lumpur", asOf: period.asOf,
    annual: { ...period }, current: { ...period }, previous: { ...period, from: "2026-08-01T00:00:00Z", asOf: "2026-08-28T14:25:00Z" },
    comparison: { future: false, complete: true, delta: 1000, percent: null, label: "上月同期" },
    progress: { percent: null, gap: null }, level: { level: null, nextGap: null },
    target: null as { levels: number[] } | null, previousTarget: null, revision: 0, history: [] as any[], page: 1, pageSize: 20, totalRows: 0, details: [] as any[],
    members: [{ id: "member", fullName: "Synthetic Member", employeeCode: "UAT01", status: "ACTIVE", eligible: true,
      goal: null, amount: totals, month: totals, progress: { percent: null, gap: null },
      comparison: { complete: true, delta: 1000, percent: null }, months: [{ month: 9, amount: totals, complete: true, future: false }] }],
  };
  const state = { data, canManage: true };
  (globalThis as any)[key] = state;
  const oldFlag = process.env.TETAMU_PERFORMANCE_PHASE2;
  process.env.TETAMU_PERFORMANCE_PHASE2 = "true";
  try {
    await build({ entryPoints: ["page", "loading", "error"].map(name => `src/app/(business)/team/performance/${name}.tsx`),
      outdir: directory, outExtension: { ".js": ".cjs" }, bundle: true, platform: "node", format: "cjs", packages: "external",
      jsx: "automatic", loader: { ".css": "empty" }, logLevel: "silent",
      plugins: [{ name: "performance-boundaries", setup(builder) {
        builder.onResolve({ filter: /^(?:@\/lib\/(?:report-outlet-context|auth\/business-user|business-groups\/business-access|prisma|performance\/dashboard)|\.\/actions|next\/navigation)$/ }, args => ({ path: args.path, namespace: "copy-boundary" }));
        builder.onLoad({ filter: /.*/, namespace: "copy-boundary" }, args => {
          const s = `globalThis[${JSON.stringify(key)}]`;
          return { contents: args.path.endsWith("report-outlet-context") ? "export const resolveReportOutletScope=async()=>({kind:'ready',topologyMode:'single_outlet',selection:{kind:'branch',branchId:'branch'},branches:[{id:'branch',name:'Synthetic Outlet'}],historical:false})" :
            args.path.endsWith("auth/business-user") ? "export const requireBusinessUserWithAnyCapability=async()=>({businessId:'business',user:{role:'BUSINESS_OWNER',userId:'owner',branchId:'branch'},access:{source:'DIRECT_BUSINESS'}})" :
            args.path.endsWith("business-access") ? `export const hasBusinessCapability=()=>${s}.canManage` :
            args.path.endsWith("/prisma") ? "export const prisma={branch:{findMany:async()=>[{id:'branch',name:'Synthetic Outlet'}]},business:{findUniqueOrThrow:async()=>({timezone:'Asia/Kuala_Lumpur'})}}" :
            args.path.endsWith("/dashboard") ? `export const readPerformanceDashboard=async()=>${s}.data` :
            args.path === "./actions" ? "export const previewTargetAction=()=>{throw Error('Unexpected action')};export const publishTargetAction=previewTargetAction" :
            "export const useRouter=()=>({refresh(){}});export const notFound=()=>{throw Error('NOT_FOUND')}" };
        });
      } }],
    });
    const require = createRequire(import.meta.url);
    const page = require(join(directory, "page.cjs")).default;
    const render = async (tab: string, q?: string) => renderToStaticMarkup(await page({ searchParams: Promise.resolve({ tab, year: "2026", month: "9", q }) }));
    const overview = await render("overview");
    for (const copy of ["Performance", "Previous period", "Current period", "Change", "Team performance", "Find team member", "Name or employee ID", "Search", "Annual target", "No individual target set", "28 Aug 2026", "22:25"]) assert.ok(overview.includes(copy), `Missing English copy: ${copy}`);
    assert.match(overview, /<dt>Percentage change<\/dt><dd>N\/A<\/dd>/);
    assert.match(overview, /RM\s*10\.00/);
    assert.doesNotMatch(overview, /\p{Script=Han}/u);
    // Catch swapped KPI amounts, hidden historical staff, lost disclosure content,
    // and search/detail links that drop the selected branch/year/month.
    data.annual.team = { salesReceived: 1200, tipsReceived: 100, refunds: 300, total: 1000 };
    data.current.team = { salesReceived: 800, tipsReceived: 0, refunds: 0, total: 800 };
    data.previous.team = { salesReceived: 0, tipsReceived: 0, refunds: 0, total: 0 };
    data.members[0].status = "SUSPENDED";
    data.members[0].eligible = false;
    const compact = await render("overview");
    const section = (html: string, label: string) => {
      const content = html.match(new RegExp(`aria-label="${label}"[^>]*>([\\s\\S]*?)</section>`))?.[1];
      assert.ok(content, `Missing section: ${label}`);
      return content;
    };
    assert.match(section(compact, "Year to date performance"), /<strong[^>]*>RM\s*10\.00<\/strong>/);
    assert.match(section(compact, "Monthly performance"), /<strong[^>]*>RM\s*8\.00<\/strong>/);
    const previousFrom = data.previous.from;
    data.previous.from = "2200-10-01T00:00:00Z";
    data.comparison.future = true;
    const future = section(await render("overview"), "Monthly performance");
    assert.match(future, /<dt>Previous period<\/dt><dd>Not started<\/dd>/);
    assert.match(future, /<strong[^>]*>—<\/strong>/);
    data.previous.from = previousFrom;
    data.comparison.future = false;
    const levels = (html: string) => {
      const table = html.match(/<table[^>]*aria-label="Performance levels"[^>]*>([\s\S]*?)<\/table>/)?.[1];
      assert.ok(table, "Performance levels table is present");
      return table;
    };
    assert.equal((levels(compact).match(/Not set/g) ?? []).length, 3);
    data.target = { levels: [500, 1500, 2500] };
    const configured = levels(await render("overview"));
    assert.match(configured, /Level 1<\/th><td>RM\s*5\.00<\/td><td>Reached/);
    assert.match(configured, /Level 2<\/th><td>RM\s*15\.00<\/td><td>In progress/);
    data.annual.complete = false;
    const incomplete = levels(await render("overview"));
    assert.equal((incomplete.match(/Unconfirmed/g) ?? []).length, 3);
    assert.doesNotMatch(incomplete, /<progress/);
    data.annual.started = false;
    assert.equal((levels(await render("overview")).match(/Not started/g) ?? []).length, 3);
    data.annual.started = true;
    data.annual.complete = true;
    data.target = null;
    assert.match(compact, /<summary>Coverage<\/summary>[\s\S]*?Asia\/Kuala_Lumpur/);
    assert.match(compact, /<table[^>]*aria-label="Performance levels"/);
    assert.match(compact, /data-status="SUSPENDED"[\s\S]*?Synthetic Member[\s\S]*?Suspended/);
    assert.match(compact, /Former branch member/);
    assert.match(compact, /<summary[^>]*>[\s\S]*?Synthetic Member[\s\S]*?<\/summary>/);
    assert.match(compact, /tab=details&amp;year=2026&amp;month=9&amp;branch=branch&amp;employee=member/);
    assert.ok((await render("overview", "uat01")).includes("Synthetic Member"));
    assert.ok(!(await render("overview", "no-match")).includes("Synthetic Member"));
    assert.match(await render("overview", "no-match"), /No team members match your search/);
    assert.doesNotMatch(compact, />Target management</);
    data.members[0].status = "ACTIVE";
    data.members[0].eligible = true;
    for (const tab of ["targets", "details"]) assert.doesNotMatch(await render(tab), /\p{Script=Han}/u, tab);
    data.details.push({ sourceKey: "REFUND:synthetic", invoiceNumber: "无发票", occurredAt: period.asOf,
      method: "CASH", qualifiedCents: null, rawCents: 1000, taxCents: null, salesCents: 1000, tipCents: 0,
      classification: "CAPTURED_PENDING", compositionStatus: "PENDING", paymentId: "synthetic",
      issues: ["ORIGINAL_PAYMENT_UNCAPTURED"], detail: { allocations: [{ membershipId: null, ...totals }] },
      attributionHistory: [{ id: "revision", revision: 1, createdAt: period.asOf, component: "SALE",
        reason: "Synthetic correction", actorUserId: "synthetic", paymentId: null, shares: [{ employeeName: null, employeeCode: "", basisPoints: 10000 }] }] });
    const details = await render("details");
    assert.match(details, /No invoice/);
    assert.match(details, /Pending verification/);
    assert.doesNotMatch(details, /\p{Script=Han}/u);
    data.history.push({ id: "history", revision: 1, actorName: "Synthetic Owner", reason: "Synthetic reason",
      createdAt: period.asOf, previousSnapshot: null, snapshot: { levels: [1000, 2000, 3000], gap: 1000, people: [] } });
    assert.doesNotMatch(await render("targets"), /\p{Script=Han}/u);
    data.history[0].reason = "合成备注";
    assert.ok((await render("targets")).includes("合成备注"), "User reasons must remain unchanged");
    data.history = [];
    state.canManage = false;
    assert.match(await render("targets"), /Annual targets \(read-only\)/);
    assert.doesNotMatch(await render("targets"), /\p{Script=Han}/u);
    data.annual.complete = false; data.annual.started = false; data.comparison.future = true; data.annual.unassignedCount = 1;
    data.members[0].comparison.complete = false; data.members[0].months[0].complete = false;
    assert.doesNotMatch(await render("overview"), /\p{Script=Han}/u);
    assert.doesNotMatch(await render("overview"), /[，；。：（）]/u);
    for (const name of ["loading", "error"]) assert.doesNotMatch(renderToStaticMarkup(createElement(require(join(directory, `${name}.cjs`)).default, { reset() {} })), /\p{Script=Han}/u);
    data.members[0].fullName = "合成员工";
    assert.ok((await render("overview")).includes("合成员工"), "User names must remain unchanged");
  } finally {
    if (oldFlag === undefined) delete process.env.TETAMU_PERFORMANCE_PHASE2; else process.env.TETAMU_PERFORMANCE_PHASE2 = oldFlag;
    delete (globalThis as any)[key];
    await rm(directory, { recursive: true, force: true });
  }
});
