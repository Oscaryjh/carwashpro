import assert from 'node:assert/strict';
import test, { before, after, beforeEach } from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { ExpenseDocumentAutofillForm } from '../../src/components/expense-document-autofill-form';
import type { ExpenseDocumentScanDto } from '../../src/lib/expense/document-ai/service';

const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom') as { JSDOM: new (html: string) => { window: Window & typeof globalThis } };
const branch = { id: '11111111-1111-4111-8111-111111111111', name: 'Main' };
const second = { id: '22222222-2222-4222-8222-222222222222', name: 'Second' };
const state = { branches: [branch], role: 'BUSINESS_OWNER', assigned: branch.id as string | null, created: [] as Record<string, unknown>[] };
const globals = globalThis as typeof globalThis & { __expenseAdd?: typeof state; IS_REACT_ACT_ENVIRONMENT?: boolean };
let directory: string;
let Form: typeof ExpenseDocumentAutofillForm;
let createAction: (data: FormData) => Promise<void>;
before(async () => {
  globals.__expenseAdd = state;
  directory = await mkdtemp(join(process.cwd(), 'node_modules/.cache/expense-add-'));
  const serviceNames = ['confirmBusinessExpense','correctConfirmedBusinessExpense','createExpenseCategory','createRecurringExpenseTemplate','generateRecurringExpense','getBusinessExpenseDetail','markBusinessExpensePaid','reorderExpenseCategories','updateDraftBusinessExpense','updateExpenseCategory','updateRecurringExpenseTemplate','voidBusinessExpense'];
  const stubs: Record<string, string> = {
    'next/link': `import {createElement} from 'react';export default function Link({children,...props}){return createElement('a',props,children)}`,
    'next/cache': `export const revalidatePath=()=>{};`,
    'next/navigation': `export const redirect=url=>{throw Object.assign(new Error(url),{digest:'NEXT_REDIRECT'})};`,
    '@/lib/auth/business-user': `export const requireBusinessUserForModule=async(module,cap)=>{if(module!=='EXPENSE'||cap!=='CREATE_EXPENSE')throw Error('wrong permission');const s=globalThis.__expenseAdd;return {businessId:'business',access:{granted:true,effectiveBusinessRole:s.role},user:{role:s.role,branchId:s.assigned,userId:'owner',name:'Test',email:'test.invalid'}}};`,
    '@/lib/audit': `export const getAuditRequestContext=async()=>({});`,
    '@/lib/expense/source-integration': `export const saveExpenseIntegrationSettings=async()=>{};`,
    '@/lib/prisma': `export const prisma={branch:{findMany:async({where})=>{if(where.businessId!=='business'||where.status!=='ACTIVE')throw Error('scope lost');return globalThis.__expenseAdd.branches},findFirst:async({where})=>where.businessId==='business'&&where.status==='ACTIVE'?globalThis.__expenseAdd.branches.find(b=>b.id===where.id)??null:null}};`,
    '@/lib/expense/service': `${serviceNames.map(n=>`export const ${n}=async()=>{};`).join('')} export const expenseErrorMessage=e=>e.message;export const createBusinessExpense=async data=>{globalThis.__expenseAdd.created.push(data);return {id:'created',expenseNumber:'EXP-1'}};`,
  };
  const plugins = [{ name: 'expense-boundaries', setup(b: import('esbuild').PluginBuild) {
    b.onResolve({filter:/.*/}, args => stubs[args.path] ? {path:args.path,namespace:'stub'} : undefined);
    b.onLoad({filter:/.*/,namespace:'stub'}, args => ({contents:stubs[args.path],resolveDir:process.cwd()}));
    b.onLoad({filter:/\.css$/}, () => ({contents:`export default new Proxy({},{get:(_,key)=>key})`,loader:'js'}));
  }}];
  await build({entryPoints:['src/components/expense-document-autofill-form.tsx','src/app/(business)/expenses/actions.ts'],outdir:directory,outbase:'src',bundle:true,platform:'node',packages:'external',format:'cjs',outExtension:{'.js':'.cjs'},jsx:'automatic',plugins});
  Form = require(join(directory,'components/expense-document-autofill-form.cjs')).ExpenseDocumentAutofillForm;
  createAction = require(join(directory,'app/(business)/expenses/actions.cjs')).createExpenseAction;
});
after(async () => { delete globals.__expenseAdd; if(directory) await rm(directory,{recursive:true,force:true,maxRetries:3}); });
beforeEach(() => { state.branches=[branch];state.role='BUSINESS_OWNER';state.assigned=branch.id;state.created=[]; });

async function withForm(overrides: Partial<Parameters<typeof ExpenseDocumentAutofillForm>[0]>, run:(doc:Document, win:Window & typeof globalThis)=>void | Promise<void>) {
  const dom = new JSDOM('<div id="root"></div>');
  const previous = ['window','document'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)] as const);
  Object.defineProperty(globalThis,'window',{value:dom.window,configurable:true});Object.defineProperty(globalThis,'document',{value:dom.window.document,configurable:true});globals.IS_REACT_ACT_ENVIRONMENT=true;
  const root=createRoot(dom.window.document.getElementById('root')!);
  try {
    act(()=>root.render(createElement(Form,{operationKey:'CREATE_EXPENSE:test-key',categories:[{id:second.id,name:'Supplies',requiresReceipt:false}],branches:[branch],defaultBranchId:branch.id,includeBusinessWide:true,autofillEnabled:false,openShifts:[],...overrides})));
    await run(dom.window.document,dom.window);
  } finally { act(()=>root.unmount());dom.window.close();for(const [key,value] of previous){if(value)Object.defineProperty(globalThis,key,value);else Reflect.deleteProperty(globalThis,key);}delete globals.IS_REACT_ACT_ENVIRONMENT; }
}
function select(doc:Document,label:string) { const field=[...doc.querySelectorAll('label')].find(l=>l.textContent?.startsWith(label))?.querySelector('select');assert.ok(field,`missing ${label}`);return field; }
function change(field:HTMLSelectElement,value:string,win:Window & typeof globalThis){act(()=>{field.value=value;field.dispatchEvent(new win.Event('change',{bubbles:true}));});}

test('one real branch plus business-wide eligibility hides all branch options and opens manual details',async()=>withForm({branches:[branch],includeBusinessWide:true},doc=>{
  assert.ok(doc.querySelector('#expense-details-section'));
  assert.ok(![...doc.querySelectorAll('label')].some(l=>l.textContent?.startsWith('Branch')));
  assert.ok(!doc.querySelector('input[name="branchId"]'),'single outlet must be resolved without client branch input');
  assert.ok(![...doc.querySelectorAll('option')].some(option=>option.textContent==='Business-wide'),'pseudo-option must not turn one real branch into multi-branch');
  assert.doesNotMatch(doc.body.textContent??'',/Business-wide/);
  assert.doesNotMatch(doc.body.textContent??'',/Document autofill is disabled|Manual entry selected|Receipt autofill/);
  assert.match(doc.body.textContent??'',/Expense details/);
  assert.match(doc.body.textContent??'',/Optional details/);
  assert.ok(doc.querySelector('input[name="receipt"]'));
  assert.equal(doc.querySelector('button[value="CONFIRMED"]')?.textContent,'Create & Confirm');
  assert.ok(doc.querySelector('button[value="DRAFT"]'));
  assert.equal(doc.querySelector('.editorActions button')?.getAttribute('value'),'CONFIRMED','implicit submit keeps the existing confirm intent');
}));
test('multiple authorised branches keep selection and business-wide option',async()=>withForm({branches:[branch,second]},doc=>{
  assert.deepEqual([...select(doc,'Branch').options].map(o=>o.value),['',branch.id,second.id]);
}));
test('unpaid disclosure removes required controls and switching back keeps existing cleared-payment contract',async()=>withForm({},(doc,win)=>{
  const status=select(doc,'Payment Status');
  const paymentLabels=()=>[...doc.querySelectorAll('label')].map(l=>l.textContent??'').join('|');
  assert.doesNotMatch(paymentLabels(),/Payment account|Payment Date|Payment Reference/);
  assert.match(doc.body.textContent??'',/Payment can be recorded later\./);
  change(status,'PAID',win);
  const account=select(doc,'Payment account');assert.equal(account.required,true);change(account,'PETTY_CASH',win);
  assert.match(paymentLabels(),/Payment Date/);assert.match(paymentLabels(),/Payment Reference/);
  change(status,'UNPAID',win);
  assert.doesNotMatch(paymentLabels(),/Payment account|Payment Date|Payment Reference/);
  for(const name of ['paymentMethod','paymentSource','paymentDate','paymentReference'])assert.equal(doc.querySelector<HTMLInputElement>(`[name="${name}"]`)?.value,'');
  change(status,'PAID',win);assert.equal(select(doc,'Payment account').value,'');
}));
test('enabled autofill retains photo upload and manual entry controls',async()=>withForm({autofillEnabled:true},doc=>{
  const buttons=[...doc.querySelectorAll('button')].map(b=>b.textContent);
  assert.ok(buttons.includes('Take photo'));assert.ok(buttons.includes('Upload receipt'));
  assert.ok(doc.querySelector('input[capture="environment"]'));
}));
test('scanned receipt keeps review and attachment but does not expose a single outlet',async()=>withForm({autofillEnabled:true},async(doc,win)=>{
  const result:ExpenseDocumentScanDto={id:second.id,expiresAt:'2026-10-06T00:00:00Z',documentType:'EXPENSE_RECEIPT',confidence:'HIGH',rawDocumentDate:'05/10/2026',fieldConfidence:{merchantName:1,documentDate:1,totalAmount:1,paymentStatus:1,paymentDate:null},suggested:{expenseDate:'2026-10-05',payeeName:'Test shop',amount:'12.34',description:'Test supplies',categoryId:second.id,categoryName:'Supplies',categoryConfidence:'HIGH',paymentStatus:'UNPAID',paymentMethod:null,paymentDate:null,paymentReference:null,invoiceNumber:null},warnings:[],duplicateCandidates:[]};
  const previousFetch=globalThis.fetch;
  globalThis.fetch=async(input,init)=>{assert.equal(input,'/api/expenses/document-scans');assert.equal(init?.method,'POST');return new Response(JSON.stringify(result));};
  try{
    const input=doc.querySelector<HTMLInputElement>('input[type="file"]:not([capture]):not([name])')!;
    Object.defineProperty(input,'files',{value:[new File(['test'],'receipt.png',{type:'image/png'})]});
    await act(async()=>{input.dispatchEvent(new win.Event('change',{bubbles:true}));});
    assert.match(doc.body.textContent??'',/Ready to confirm/);
    assert.ok(![...doc.querySelectorAll('dt')].some(n=>n.textContent==='Branch'));
    assert.equal(doc.querySelector<HTMLInputElement>('[name="documentScanId"]')?.value,second.id);
    assert.equal(doc.querySelector<HTMLInputElement>('[name="amount"]')?.value,'12.34');
  }finally{globalThis.fetch=previousFetch;}
}));
function data(requested?:string){const form=new FormData();for(const [key,value] of Object.entries({operationKey:'CREATE_EXPENSE:unit-test-key',amount:'12.34',categoryId:second.id,description:'Test supplies',expenseDate:'2026-10-05',intent:'CONFIRMED',paymentStatus:'UNPAID'}))form.set(key,value);if(requested!==undefined)form.set('branchId',requested);return form;}
async function submit(form:FormData){try{await createAction(form);assert.fail('expected redirect');}catch(error){assert.ok(error instanceof Error);return error.message;}}
test('create action resolves sole branch without input and preserves expense payload',async()=>{
  assert.match(await submit(data()),/type=success/);assert.equal(state.created.length,1);assert.equal(state.created[0].branchId,branch.id);assert.equal(state.created[0].amount,'12.34');assert.equal(state.created[0].paymentStatus,'UNPAID');
});
test('create action rejects tampered single branch rather than trusting or ignoring it',async()=>{
  assert.match(await submit(data(second.id)),/type=error/);assert.equal(state.created.length,0);
});
test('multi branch preserves explicit selection and existing business-wide contract',async()=>{
  state.branches=[branch,second];assert.match(await submit(data(second.id)),/type=success/);assert.equal(state.created[0].branchId,second.id);
  await submit(data());assert.equal(state.created[1].branchId,null);
});
test('staff stays in authenticated branch and group manager cannot create',async()=>{
  state.role='STAFF';await submit(data(second.id));assert.equal(state.created[0].branchId,branch.id);
  state.role='GROUP_MANAGER_READ_ONLY';state.created=[];assert.match(await submit(data()),/type=error/);assert.equal(state.created.length,0);
});
