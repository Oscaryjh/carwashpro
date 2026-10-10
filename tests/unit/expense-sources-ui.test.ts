import assert from 'node:assert/strict';
import test, { before, after, beforeEach } from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom') as { JSDOM: new(html: string) => { window: Window & typeof globalThis } };
const categoryId = '11111111-1111-4111-8111-111111111111';
const setting = { claimDefaultCategoryId: categoryId, payrollCategoryId: categoryId, inventoryPurchaseCategoryId: categoryId, revision: 7 };
const state = { setting: setting as typeof setting | null, enabled: ['CLAIMS', 'PAYROLL', 'INVENTORY'], issues: [] as { sourceType: string; sourceId: string; code: string }[], allowed: true, saveError: false, saved: [] as Record<string, unknown>[], reads: [] as unknown[] };
const globals = globalThis as typeof globalThis & { __sourcesUI?: typeof state };
let directory: string;
let Page: (props: { searchParams: Promise<Record<string, string>> }) => Promise<ReactElement>;
before(async () => {
  globals.__sourcesUI = state;
  directory = await mkdtemp(join(process.cwd(), 'node_modules/.cache/sources-ui-'));
  const serviceNames = ['confirmBusinessExpense', 'correctConfirmedBusinessExpense', 'createExpenseCategory', 'createBusinessExpense', 'getBusinessExpenseDetail', 'markBusinessExpensePaid', 'reorderExpenseCategories', 'updateDraftBusinessExpense', 'updateExpenseCategory', 'voidBusinessExpense', 'ensureStarterExpenseCategories', 'createRecurringExpenseTemplate', 'updateRecurringExpenseTemplate', 'generateRecurringExpense'];
  const stubs: Record<string, string> = {
    '@/lib/expense/create-branch': `export async function resolveExpenseCreateBranch(){throw Error('Expense creation is outside this settings UI harness')}`,
    'next/link': `import {createElement} from 'react';export default function Link({children,...props}){return createElement('a',props,children)}`,
    'next/cache': `export const revalidatePath=()=>{};`,
    'next/navigation': `export const redirect=url=>{throw Object.assign(new Error(url),{digest:'NEXT_REDIRECT'})};`,
    '@/lib/auth/business-user': `export const requireBusinessUserForModule=async(m,c)=>{if(m!=='EXPENSE'||c!=='MANAGE_EXPENSE_CATEGORY'||!globalThis.__sourcesUI.allowed)throw Error('denied');return {businessId:'business',user:{userId:'owner',name:'Owner',email:'owner@local.test'}}};`,
    '@/lib/audit': `export const getAuditRequestContext=async()=>({});`,
    '@/lib/modules/entitlements': `export const loadBusinessModuleContext=async()=>({enabledModules:new Set(globalThis.__sourcesUI.enabled)});`,
    '@/lib/expense/source-integration': `export const reconcileExpenseSources=async q=>{globalThis.__sourcesUI.reads.push(q);return {healthy:!globalThis.__sourcesUI.issues.length,issues:globalThis.__sourcesUI.issues,repairApplied:false}};export const saveExpenseIntegrationSettings=async d=>{if(globalThis.__sourcesUI.saveError)throw Error('raw database secret');globalThis.__sourcesUI.saved.push(d)};`,
    '@/lib/expense/service': `${serviceNames.map(n => `export const ${n}=async()=>{};`).join('')} export const expenseErrorMessage=e=>e.message;`,
    '@/lib/prisma': `export const prisma={expenseCategory:{findMany:async q=>{globalThis.__sourcesUI.reads.push(q);return [{id:'${categoryId}',name:'General expenses'}]}},expenseIntegrationSetting:{findUnique:async q=>{globalThis.__sourcesUI.reads.push(q);return globalThis.__sourcesUI.setting}}};`,
  };
  await build({ entryPoints: ['src/app/(business)/expenses/integrations/page.tsx'], outfile: join(directory, 'page.cjs'), bundle: true, platform: 'node', packages: 'external', format: 'cjs', jsx: 'automatic', plugins: [{ name: 'io', setup(b) {
    b.onResolve({ filter: /.*/ }, a => stubs[a.path] ? { path: a.path, namespace: 'stub' } : undefined);
    b.onLoad({ filter: /.*/, namespace: 'stub' }, a => ({ contents: stubs[a.path], resolveDir: process.cwd() }));
    b.onLoad({ filter: /\.css$/ }, () => ({ contents: `export default new Proxy({},{get:(_,k)=>k})`, loader: 'js' }));
  } }] });
  Page = require(join(directory, 'page.cjs')).default;
});
after(async () => { delete globals.__sourcesUI; await rm(directory, { recursive: true, force: true, maxRetries: 3 }); });
beforeEach(() => { state.setting = { ...setting }; state.enabled = ['CLAIMS', 'PAYROLL', 'INVENTORY']; state.issues = []; state.allowed = true; state.saveError = false; state.saved = []; state.reads = []; });
async function render(query: Record<string, string> = {}) { const element = await Page({ searchParams: Promise.resolve(query) }); return { element, dom: new JSDOM(renderToStaticMarkup(element)) }; }
function formAction(element: ReactElement): (data: FormData) => Promise<void> {
  const node = element as ReactElement<{ action?: (data: FormData) => Promise<void>; children?: ReactElement | ReactElement[] }>;
  if (node.type === 'form' && node.props.action) return node.props.action;
  for (const child of [node.props.children].flat(Infinity)) {
    if (child && typeof child === 'object' && 'props' in child) { try { return formAction(child); } catch { /* Search siblings. */ } }
  }
  throw Error('No form action');
}

test('healthy source settings show business mappings without audit panels or visible revision', async () => {
  const { dom } = await render(); const doc = dom.window.document;
  assert.equal(doc.querySelector('h1')?.textContent, 'Expense Sources');
  assert.deepEqual([...doc.querySelectorAll('form h2')].map(n => n.textContent), ['Staff Claims', 'Payroll Costs', 'Inventory Purchases']);
  assert.doesNotMatch(doc.body.textContent ?? '', /Domain ownership|canonical|Revision|Module matrix|Source health|IN SYNC|repair\/backfill|Select explicit category/);
  assert.equal(doc.querySelector('button')?.textContent, 'Save changes');
  assert.equal(doc.querySelector('a[href="/expenses"]')?.textContent, 'Back to Expenses');
  assert.equal(doc.querySelector<HTMLInputElement>('[name="expectedRevision"]')?.value, '7');
  for (const select of doc.querySelectorAll('select')) { assert.equal(select.value, categoryId); assert.equal(select.required, true); }
  assert.deepEqual(state.reads, [{ where: { active: true, businessId: 'business' }, orderBy: [{ group: 'asc' }, { name: 'asc' }], select: { id: true, name: true } }, { where: { businessId: 'business' } }, { businessId: 'business' }]);
  assert.equal(state.saved.length, 0);
});

test('Back to Expenses does not match the collapsed-sidebar sign-out selector', async () => {
  const { dom } = await render(); const doc = dom.window.document;
  const shell = doc.createElement('div'); shell.className = 'app-shell sidebar-collapsed';
  const page = doc.querySelector('section')!; page.replaceWith(shell); shell.append(page);
  const link = page.querySelector<HTMLAnchorElement>('a[href="/expenses"]')!;
  assert.equal(link.textContent, 'Back to Expenses');
  assert.equal(link.matches('.app-shell.sidebar-collapsed .secondary-button'), false);
});

test('disabled sources keep saved values in the actual form payload and original save action', async () => {
  state.enabled = ['CLAIMS']; const { element, dom } = await render(); const doc = dom.window.document;
  assert.equal(doc.querySelector<HTMLSelectElement>('select[name="payrollCategoryId"]')?.disabled, true);
  assert.equal(doc.querySelector<HTMLSelectElement>('select[name="inventoryPurchaseCategoryId"]')?.disabled, true);
  assert.match(doc.body.textContent ?? '', /Payroll is not enabled for this business\./);
  const payload = new dom.window.FormData(doc.querySelector('form')!);
  assert.deepEqual(Object.fromEntries(payload), { expectedRevision: '7', claimDefaultCategoryId: categoryId, payrollCategoryId: categoryId, inventoryPurchaseCategoryId: categoryId });
  await assert.rejects(formAction(element)(payload), /Expense%20source%20categories%20updated/);
  assert.deepEqual(state.saved[0], { actor: { userId: 'owner', name: 'Owner', email: 'owner@local.test' }, businessId: 'business', claimDefaultCategoryId: categoryId, expectedRevision: 7, payrollCategoryId: categoryId, inventoryPurchaseCategoryId: categoryId, request: {} });
});

test('missing settings never auto-select or save starter categories; re-enabled controls restore saved values', async () => {
  state.setting = null; state.enabled = []; let { dom } = await render();
  for (const select of dom.window.document.querySelectorAll('select')) { assert.equal(select.value, ''); assert.equal(select.options[0].textContent, 'Select category'); assert.equal(select.disabled, true); }
  assert.ok(!dom.window.document.querySelector('[name="expectedRevision"]')); assert.equal(state.saved.length, 0);
  state.setting = { ...setting }; state.enabled = ['CLAIMS', 'PAYROLL', 'INVENTORY']; ({ dom } = await render());
  for (const select of dom.window.document.querySelectorAll('select')) { assert.equal(select.disabled, false); assert.equal(select.value, categoryId); }
});

test('a saved category outside the active options is preserved rather than silently cleared', async () => {
  const unavailableId = '22222222-2222-4222-8222-222222222222';
  state.setting = { ...setting, payrollCategoryId: unavailableId };
  const { dom } = await render();
  assert.equal(dom.window.document.querySelector<HTMLOptionElement>(`option[value="${unavailableId}"]`)?.disabled, false);
  const payload = new dom.window.FormData(dom.window.document.querySelector('form')!);
  assert.equal(payload.get('payrollCategoryId'), unavailableId);
});

test('disabled source with unavailable saved category explains how to recover without clearing its mapping', async () => {
  state.enabled = ['CLAIMS']; state.setting = { ...setting, payrollCategoryId: '22222222-2222-4222-8222-222222222222' };
  const { dom } = await render(); const doc = dom.window.document;
  const payroll = doc.querySelector('[aria-labelledby="payrollCategoryId-heading"]')!;
  assert.match(payroll.textContent ?? '', /Reactivate the saved category in Expense Categories before saving/);
  assert.equal(payroll.querySelector('a')?.getAttribute('href'), '/expenses/categories');
  assert.equal(new dom.window.FormData(doc.querySelector('form')!).get('payrollCategoryId'), '22222222-2222-4222-8222-222222222222');
  assert.equal(state.saved.length, 0);
});

test('each existing health issue triggers a compact warning with collapsed safe details, never raw codes', async () => {
  for (const code of ['MISSING_EXPENSE', 'DUPLICATE_ACTIVE_EXPENSE', 'STALE_SOURCE_EXPENSE', 'WRONG_AMOUNT', 'WRONG_BRANCH', 'WRONG_SOURCE_REVISION', 'WRONG_PAYMENT_STATE', 'MISSING_SOURCE_SNAPSHOT', 'MISSING_SETTLEMENT_PROJECTION', 'WRONG_PAID_AMOUNT', 'WRONG_OUTSTANDING_AMOUNT', 'SOURCE_AP_MATCH_ISSUE', 'LEGACY_CONFIRMATION_REVISION_REQUIRED', 'UNKNOWN_FUTURE_CODE']) {
    state.issues = [{ sourceType: 'CLAIM', sourceId: 'internal-source-id', code }]; const { dom } = await render(); const doc = dom.window.document;
    assert.match(doc.querySelector('[role="status"]')?.textContent ?? '', /Expense sync needs attention/);
    assert.equal(doc.querySelector('details summary')?.textContent, 'View details'); assert.ok(!doc.querySelector('details[open]'));
    assert.ok(!(doc.body.textContent ?? '').includes(code)); assert.doesNotMatch(doc.body.textContent ?? '', /internal-source-id|repair|backfill/);
  }
});

test('page and original save action preserve permissions and UUID validation; UI hides raw error messages', async () => {
  const { element, dom } = await render({ type: 'error', message: 'raw database exception: secret detail' });
  assert.doesNotMatch(dom.window.document.body.textContent ?? '', /raw database exception|secret detail/);
  const payload = new FormData(); payload.set('claimDefaultCategoryId', 'not-a-uuid');
  await assert.rejects(formAction(element)(payload), /type=error/); assert.equal(state.saved.length, 0);
  state.allowed = false; await assert.rejects(render(), /denied/); await assert.rejects(formAction(element)(new FormData()), /denied/);
});

test('save failure redirects with safe copy rather than exposing a raw exception in the URL', async () => {
  const { element } = await render(); state.saveError = true;
  const payload = new FormData(); payload.set('claimDefaultCategoryId', categoryId);
  await assert.rejects(formAction(element)(payload), (error: unknown) => {
    assert.ok(error instanceof Error); assert.match(error.message, /type=error/);
    assert.doesNotMatch(decodeURIComponent(error.message), /raw database secret/);
    return true;
  });
});
