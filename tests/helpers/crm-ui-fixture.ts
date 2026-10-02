import { build, type Plugin } from "esbuild";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

// Replace only authenticated I/O boundaries; render the actual CRM and Wallet components.
export function crmUiBoundaries(): Plugin {
  return { name: "crm-authenticated-io", setup(builder) {
    builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "crm-io" }));
    builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "navigation", namespace: "crm-io" }));
    builder.onResolve({ filter: /^@\/lib\/(prisma|branches|industry-context|wallet\/release-policy)$/ }, args => ({ path: args.path, namespace: "crm-io" }));
    builder.onResolve({ filter: /(?:^@\/app\/.*\/actions$|^\.\/actions$)/ }, args => ({ path: args.path.startsWith("@/") ? resolve("src", args.path.slice(2) + ".ts") : resolve(args.resolveDir, args.path + ".ts"), namespace: "crm-actions" }));
    builder.onLoad({ filter: /.*/, namespace: "crm-actions" }, async args => {
      const source = await readFile(args.path, "utf8");
      const names = [...source.matchAll(/export async function (\w+)/g)].map(match => match[1]);
      return { contents: names.map(name => `export async function ${name}(...args){ return globalThis.__crmFixture.actions[${JSON.stringify(name)}](...args); }`).join("\n") };
    });
    builder.onLoad({ filter: /.*/, namespace: "crm-io" }, args => {
      if (args.path === "link") return { contents: 'import {createElement} from "react";export default function Link({children,...props}){return createElement("a",props,children)}', resolveDir: process.cwd() };
      if (args.path === "navigation") return { contents: "export function useRouter(){return {refresh(){},replace(){}}} export function redirect(){throw Error('unexpected redirect')} export function unstable_rethrow(){}" };
      if (args.path.endsWith("/prisma")) return { contents: "export const prisma=new Proxy({}, {get:(_,key)=>globalThis.__crmFixture.db[key]});" };
      if (args.path.endsWith("/branches")) return { contents: "export const authorizedOperationalBranchWhere=()=>({});export const authorizedCustomerPackageBranchWhere=()=>({});export const getActiveBranches=async()=>[{id:'branch',name:'Main'}];" };
      if (args.path.endsWith("/industry-context")) return { contents: "export const requireBusinessIndustryContext=async()=>globalThis.__crmFixture.context;" };
      return { contents: "export const isWalletAccessAllowed=async()=>globalThis.__crmFixture.walletEnabled;" };
    });
  } };
}

export async function buildCrmUi(outfile: string) {
  await build({ entryPoints: ["src/app/(business)/crm/page.tsx"], outfile, bundle: true, platform: "node", format: "cjs", packages: "external", jsx: "automatic", loader: { ".css": "empty" }, plugins: [crmUiBoundaries()] });
}

export function crmFixture(walletEnabled = true, role = "BUSINESS_OWNER") {
  const customer = { id: "customer-a", name: "Alexandra Catherine Long Customer Name", phone: "0123456789", email: null, branchId: "branch", dateOfBirth: new Date("1990-01-01T00:00:00Z"), notes: "Saved customer notes", preferences: null, treatmentNotes: null, membership: { pointsBalance: 90 }, appointments: [], invoices: [], customerPackages: [], whatsappMessages: [], whatsappChatMessages: [] };
  const queries: unknown[] = [];
  return { walletEnabled, context: { businessId: "business", user: { userId: "owner", role }, industry: { industryType: "SALON_BEAUTY" } }, customer, queries,
    db: { customer: { count: async () => 2, findMany: async (args: unknown) => { queries.push(args); return [customer, { ...customer, id: "customer-b", name: "Second customer" }].map(item => ({ ...item, _count: { customerPackages: 2 } })); }, findFirst: async ({ where }: { where: { id: string } }) => ({ ...customer, id: where.id, name: where.id === "customer-b" ? "Second customer" : customer.name }) }, payment: { findMany: async () => [] }, invoice: { aggregate: async () => ({ _sum: { paidAmount: 300 } }) }, customerPackage: { count: async () => 2 }, appointment: { findFirst: async () => null } },
    actions: new Proxy({}, { get: () => () => { throw Error("unexpected action during static rendering"); } }),
  };
}
