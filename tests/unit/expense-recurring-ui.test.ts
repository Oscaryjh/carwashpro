import assert from 'node:assert/strict';
import test, { before, after, beforeEach } from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom') as { JSDOM: new(html: string) => { window: Window & typeof globalThis } };
const branch = { id: '11111111-1111-4111-8111-111111111111', name: 'Main' };
const second = { id: '22222222-2222-4222-8222-222222222222', name: 'Second' };
const recurring = { id: second.id, branchId: branch.id, categoryId: second.id, branch: { name: 'Main' }, category: { name: 'Rental' }, payeeName: 'Landlord', defaultDescription: 'Shop rental', notes: 'Private note', active: true, revision: 2, startDate: new Date('2026-10-01'), endDate: null as Date | null, createdAt: new Date('2026-10-01'), amount: { toFixed: () => '3000.00', comparedTo: () => 0 }, expenses: [{ generatedPeriod: '2026-09', id: 'expense-1' }] };
const state = { branches: [branch], role: 'BUSINESS_OWNER', assigned: branch.id as string | null, records: [] as typeof recurring[], created: [] as Record<string, unknown>[], updated: [] as Record<string, unknown>[], generated: [] as Record<string, unknown>[] };
const globals = globalThis as typeof globalThis & { __recurringUI?: typeof state; IS_REACT_ACT_ENVIRONMENT?: boolean };
let directory: string;
let Page: (props: { searchParams: Promise<Record<string, string>> }) => Promise<ReactElement>;
let actions: Record<string, (data: FormData) => Promise<void>>;
before(async () => {
  globals.__recurringUI = state;
  directory = await mkdtemp(join(process.cwd(), 'node_modules/.cache/recurring-ui-'));
  const serviceNames = ['confirmBusinessExpense', 'correctConfirmedBusinessExpense', 'createExpenseCategory', 'createBusinessExpense', 'getBusinessExpenseDetail', 'markBusinessExpensePaid', 'reorderExpenseCategories', 'updateDraftBusinessExpense', 'updateExpenseCategory', 'voidBusinessExpense', 'ensureStarterExpenseCategories'];
  const stubs: Record<string, string> = {
    'next/link': `import {createElement} from 'react';export default function Link({children,...props}){return createElement('a',props,children)}`,
    'next/cache': `export const revalidatePath=()=>{};`,
    'next/navigation': `export const redirect=url=>{throw Object.assign(new Error(url),{digest:'NEXT_REDIRECT'})};`,
    '@/lib/auth/business-user': `export const requireBusinessUserForModule=async(m,c)=>{if(m!=='EXPENSE'||!['MANAGE_EXPENSE_CATEGORY','CREATE_EXPENSE'].includes(c))throw Error('permission changed');const s=globalThis.__recurringUI;return {businessId:'business',access:{granted:true,effectiveBusinessRole:s.role},user:{role:s.role,branchId:s.assigned,userId:'owner',name:'Test',email:'test.invalid'}}};`,
    '@/lib/audit': `export const getAuditRequestContext=async()=>({});`,
    '@/lib/expense/source-integration': `export const saveExpenseIntegrationSettings=async()=>{};`,
    '@/lib/prisma': `export const prisma={branch:{findMany:async({where})=>{if(where.businessId!=='business'||where.status!=='ACTIVE')throw Error('scope lost');return globalThis.__recurringUI.branches},findFirst:async({where})=>where.businessId==='business'&&where.status==='ACTIVE'?globalThis.__recurringUI.branches.find(b=>b.id===where.id)??null:null},expenseCategory:{findMany:async()=>[{id:'${second.id}',name:'Rental'}]},recurringExpenseTemplate:{findMany:async()=>globalThis.__recurringUI.records}};`,
    '@/lib/expense/service': `${serviceNames.map(n => `export const ${n}=async()=>{};`).join('')} export const expenseErrorMessage=e=>e.message;export const createRecurringExpenseTemplate=async d=>{globalThis.__recurringUI.created.push(d)};export const updateRecurringExpenseTemplate=async d=>{globalThis.__recurringUI.updated.push(d)};export const generateRecurringExpense=async d=>{globalThis.__recurringUI.generated.push(d);return {id:'draft',expenseNumber:'EXP-1'}};`,
  };
  await build({ entryPoints: ['src/app/(business)/expenses/recurring/page.tsx', 'src/app/(business)/expenses/actions.ts'], outdir: directory, outbase: 'src', bundle: true, platform: 'node', packages: 'external', format: 'cjs', outExtension: { '.js': '.cjs' }, jsx: 'automatic', plugins: [{ name: 'io', setup(b) {
    b.onResolve({ filter: /.*/ }, a => stubs[a.path] ? { path: a.path, namespace: 'stub' } : undefined);
    b.onLoad({ filter: /.*/, namespace: 'stub' }, a => ({ contents: stubs[a.path], resolveDir: process.cwd() }));
    b.onLoad({ filter: /\.css$/ }, () => ({ contents: `export default new Proxy({},{get:(_,k)=>k})`, loader: 'js' }));
  } }] });
  Page = require(join(directory, 'app/(business)/expenses/recurring/page.cjs')).default;
  actions = require(join(directory, 'app/(business)/expenses/actions.cjs'));
});
after(async () => { delete globals.__recurringUI; await rm(directory, { recursive: true, force: true, maxRetries: 3 }); });
beforeEach(() => { state.branches = [branch]; state.role = 'BUSINESS_OWNER'; state.assigned = branch.id; state.records = []; state.created = []; state.updated = []; state.generated = []; });
async function document(query: Record<string, string> = {}) { return new JSDOM(renderToStaticMarkup(await Page({ searchParams: Promise.resolve(query) }))).window.document; }
function data(extra: Record<string, string> = {}) { const d = new FormData(); for (const [k, v] of Object.entries({ operationKey: 'RECURRING:unit-test-operation', amount: '3000.00', categoryId: second.id, description: 'Shop rental', startDate: '2026-10-01', ...extra })) d.set(k, v); return d; }
async function submit(name: string, d: FormData) { try { await actions[name](d); assert.fail('expected redirect'); } catch (e) { assert.ok(e instanceof Error); return decodeURIComponent(e.message); } }

test('recurring defaults to list/empty CTA with create dialog hidden, note collapsed, single branch absent', async () => {
  const doc = await document(); assert.equal(doc.querySelector('h1')?.textContent, 'Recurring Expenses');
  assert.ok(!doc.querySelector('.recurringSafety')); assert.ok(!doc.querySelector('dialog[open]'));
  const create = doc.querySelector('dialog')!; assert.ok(create);
  assert.deepEqual([...create.querySelectorAll('legend')].map(n => n.textContent), ['Expense', 'Schedule']);
  assert.ok(create.querySelector('details:not([open]) textarea[name="notes"]'));
  assert.ok(!create.querySelector('[name="branchId"]')); assert.doesNotMatch(create.textContent ?? '', /Business-wide/);
  assert.doesNotMatch(doc.body.textContent ?? '', /template|Safe by default|above/i);
  assert.ok(doc.querySelector('.recurringEmpty button')); assert.match(doc.body.textContent ?? '', /Nothing is created automatically/);
});
test('multi real branches retain selector; View keeps edit scope, dates and draft generation fields', async () => {
  state.branches.push(second); state.records = [recurring]; const doc = await document();
  assert.ok(doc.querySelector('dialog select[name="branchId"]'));
  assert.deepEqual([...doc.querySelectorAll('thead th')].map(n => n.textContent), ['Recurring Expense', 'Category', 'Monthly Amount', 'Period', 'Status', 'Action']);
  assert.match(doc.querySelector('tbody')?.textContent ?? '', /From Oct 2026/);
  assert.ok(doc.querySelector('input[name="period"]')); assert.ok(doc.querySelector('input[name="expectedRevision"][value="2"]'));
  assert.ok(doc.querySelector('input[name="templateId"]')); assert.ok(!doc.querySelector('.activeBadge'));
});
test('single branch create resolves real branch without trusting submitted branch; edit business-wide unchanged', async () => {
  await submit('createRecurringExpenseAction', data()); assert.equal(state.created[0]?.branchId, branch.id);
  state.created = []; await submit('createRecurringExpenseAction', data({ branchId: second.id })); assert.equal(state.created.length, 0);
  await submit('updateRecurringExpenseAction', data({ templateId: second.id, expectedRevision: '2', reason: 'Update defaults', active: 'on' })); assert.equal(state.updated[0]?.branchId, null);
});
test('multi branch selection and staff assignment remain scoped; group manager cannot create', async () => {
  state.branches.push(second); await submit('createRecurringExpenseAction', data({ branchId: second.id })); assert.equal(state.created[0]?.branchId, second.id);
  state.role = 'STAFF'; await submit('createRecurringExpenseAction', data({ branchId: second.id })); assert.equal(state.created[1]?.branchId, branch.id);
  state.role = 'GROUP_MANAGER_READ_ONLY'; await submit('createRecurringExpenseAction', data()); assert.equal(state.created.length, 2);
});
test('inactive recurring rows retain edit but no draft action; month generation payload is unchanged', async () => {
  state.records = [{ ...recurring, active: false, endDate: new Date('2026-12-31') }];
  const doc = await document(); assert.ok(doc.querySelector('.inactiveBadge')); assert.ok(!doc.querySelector('[name="period"]'));
  assert.match(doc.querySelector('tbody')?.textContent ?? '', /Oct 2026 – Dec 2026/);
  const message = await submit('generateRecurringExpenseAction', data({ templateId: second.id, period: '2026-11' }));
  assert.equal(state.generated[0]?.period, '2026-11'); assert.equal(state.generated[0]?.templateId, second.id); assert.match(message, /\/expenses\/draft/);
});
test('filters and pagination preserve existing query keys and page size', async () => {
  state.records = Array.from({ length: 11 }, (_, index) => ({ ...recurring, id: `record-${index}` }));
  const doc = await document({ q: 'Shop', categoryId: second.id, branchId: branch.id, status: 'active', sort: 'newest' });
  assert.equal(doc.querySelectorAll('tbody tr').length, 10);
  const next = [...doc.querySelectorAll('nav a')].find(a => a.textContent === 'Next')!;
  const params = new URL(next.getAttribute('href')!, 'http://local').searchParams;
  assert.deepEqual(Object.fromEntries(params), { q: 'Shop', branchId: branch.id, categoryId: second.id, status: 'active', sort: 'newest', page: '2' });
  const empty = await document({ q: 'missing' }); assert.match(empty.querySelector('.recurringEmpty')?.textContent ?? '', /No matching recurring expenses/);
  assert.ok(!empty.querySelector('.recurringEmpty button'));
});
test('Add dialog opens and cancels without a write; View exposes unchanged draft and edit controls', async () => {
  const dom = new JSDOM('<div id="root"></div>'); const old = ['window', 'document'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)] as const);
  Object.defineProperty(globalThis, 'window', { value: dom.window, configurable: true }); Object.defineProperty(globalThis, 'document', { value: dom.window.document, configurable: true });
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; }; dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; }; globals.IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(dom.window.document.getElementById('root')!);
  try {
    state.records = [recurring]; const element = await Page({ searchParams: Promise.resolve({}) }); act(() => root.render(element)); const doc = dom.window.document;
    const button = (text: string) => [...doc.querySelectorAll('button')].find(n => n.textContent === text)!;
    assert.ok(button('+ Add Recurring Expense')); act(() => button('+ Add Recurring Expense').click()); let dialog = doc.querySelector<HTMLDialogElement>('dialog[open]')!; assert.ok(dialog);
    act(() => dialog.querySelector<HTMLButtonElement>('[data-cancel]')!.click()); assert.ok(!dialog.open); assert.equal(state.created.length, 0);
    act(() => button('View').click()); dialog = doc.querySelector<HTMLDialogElement>('dialog[open]')!; assert.ok(dialog.querySelector('[name="period"]'));
    assert.ok(dialog.querySelector('[name="reason"]')); assert.ok(dialog.querySelector('select[name="branchId"]'), 'Edit retains original scope selector');
  } finally { act(() => root.unmount()); dom.window.close(); for (const [k, v] of old) { if (v) Object.defineProperty(globalThis, k, v); else Reflect.deleteProperty(globalThis, k); } delete globals.IS_REACT_ACT_ENVIRONMENT; }
});
