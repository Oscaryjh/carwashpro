import assert from "node:assert/strict";
import test from "node:test";
import {build} from "esbuild";
import {createRequire} from "node:module";
import {createElement, type ReactNode} from "react";
import {renderToStaticMarkup} from "react-dom/server";
const require=createRequire(import.meta.url);
const {JSDOM}=require("jsdom");
type SettingsRead = { where: Record<string, unknown>; orderBy?: unknown; take?: number };
type SettingsPages = {
 Settings: typeof import("../../src/app/(business)/loyalty/settings/page").default;
 Overview: typeof import("../../src/app/(business)/loyalty/page").default;
 Members: typeof import("../../src/app/(business)/loyalty/members/page").default;
 LoyaltyTabs: typeof import("../../src/components/loyalty-tabs").LoyaltyTabs;
};
type ElementNode = { type: unknown; props: { children?: unknown; action?: unknown } };
async function fixture(){
 const program={name:"Saved custom program",pointsPerRinggit:2.5,welcomePoints:30,enabled:true,redemptionPointsPerRinggit:80,minimumRedemptionPoints:160,redemptionEnabled:true};
 const f={role:"BUSINESS_OWNER",program,reads:[] as SettingsRead[],action:()=>{},db:{} as Record<string, unknown>};
 f.db={loyaltyProgram:{findUnique:async(args:SettingsRead)=>{f.reads.push(args);return f.program;}},customerMembership:{count:async()=>1,aggregate:async()=>({_sum:{pointsBalance:123,lifetimePointsEarned:456,lifetimePointsReversed:78}}),findMany:async(args:SettingsRead)=>{f.reads.push(args);return [{id:"member",customerId:"customer",customer:{name:"A",phone:"123"},status:"ACTIVE",pointsBalance:123,lifetimePointsEarned:456,lifetimePointsReversed:78,joinedAt:new Date("2026-01-01")}];}},loyaltyTransaction:{findMany:async()=>[]}};
 const stubs:Record<string,string>={"next/link":"import React from 'react';export default function Link(p){return React.createElement('a',p)}", "next/navigation":"export const redirect=p=>{throw Error('REDIRECT:'+p)};", "@/lib/prisma":"export const prisma=f.db;", "@/lib/auth/business-user":"export const requireBusinessUserForModule=async m=>{if(m!=='LOYALTY')throw Error('Wrong module');return {businessId:'business',user:{role:f.role},industryType:'SALON_BEAUTY'}};", "@/lib/auth/staff-permissions":"export const assertStaffPermission=(u,p)=>{if(p!=='LOYALTY')throw Error('Wrong permission')};", "@/app/(business)/loyalty/actions":"export const updateLoyaltySettingsAction=f.action;"};
 const bundle=await build({stdin:{contents:`export {default as Settings} from './src/app/(business)/loyalty/settings/page';export {default as Overview} from './src/app/(business)/loyalty/page';export {default as Members} from './src/app/(business)/loyalty/members/page';export {LoyaltyTabs} from './src/components/loyalty-tabs';`,loader:"tsx",resolveDir:process.cwd()},bundle:true,write:false,platform:"node",format:"cjs",packages:"external",jsx:"automatic",loader:{".css":"empty"},plugins:[{name:"boundaries",setup(b){b.onResolve({filter:/.*/},a=>stubs[a.path]?{path:a.path,namespace:"fixture"}:undefined);b.onLoad({filter:/.*/,namespace:"fixture"},a=>({contents:stubs[a.path],resolveDir:process.cwd()}));}}]});
 const settingsPages={exports:{} as SettingsPages};new Function("require","module","exports","f",bundle.outputFiles[0].text)(require,settingsPages,settingsPages.exports,f);
 return {f,...settingsPages.exports};
}
const dom=(element:ReactNode)=>new JSDOM(renderToStaticMarkup(element));
function nodes(node:unknown):ElementNode[]{
 if(!node||typeof node!=="object")return [];
 if(Array.isArray(node))return node.flatMap(nodes);
 const element=node as ElementNode;
 return [element,...nodes(element.props?.children)];
}
test("Loyalty Settings keeps settings route, active state and Owner-only visibility",async()=>{
 const {LoyaltyTabs}=await fixture();
 const d=dom(createElement(LoyaltyTabs,{active:"settings",showSettings:true})).window.document;
 assert.equal(d.querySelector('[aria-current="page"]').textContent,"Loyalty Settings");
 assert.equal(d.querySelector('[aria-current="page"]').getAttribute('href'),"/loyalty/settings");
 assert.doesNotMatch(d.body.textContent,/Program Settings/);
 const staff=dom(createElement(LoyaltyTabs,{active:"members",showSettings:false})).window.document;
 assert.equal(staff.querySelector('[href="/loyalty/settings"]'),null);
});
test("same settings form groups earning and redemption while preserving saved payload and validation",async()=>{
 const {Settings,f}=await fixture();const tree=await Settings({searchParams:Promise.resolve({})});
 assert.equal(nodes(tree).find(n=>n.type==="form")!.props.action,f.action);
 const w=dom(tree).window,d=w.document,form=d.querySelector('form');
 assert.equal(d.querySelector('h2').textContent,"Loyalty settings");assert.equal(d.querySelectorAll('form').length,1);
 const groups=Array.from(d.querySelectorAll('fieldset')) as HTMLFieldSetElement[];
 assert.deepEqual(groups.map(g=>g.querySelector('legend')?.textContent),["Earn points","Redeem points"]);
 assert.deepEqual(groups.map(g=>Array.from(g.querySelectorAll('input')).map(i=>i.name)),[["name","pointsPerRinggit","welcomePoints","enabled"],["redemptionPointsPerRinggit","minimumRedemptionPoints","redemptionEnabled"]]);
 for(const label of ["Points earned per RM1 spent","Points needed for RM1 discount","Minimum points to redeem","Allow points redemption at checkout","Package voucher uses do not earn points again."])assert.ok(d.body.textContent.includes(label),label);
 assert.deepEqual(Object.fromEntries(new w.FormData(form)),{name:"Saved custom program",pointsPerRinggit:"2.5",welcomePoints:"30",enabled:"on",redemptionPointsPerRinggit:"80",minimumRedemptionPoints:"160",redemptionEnabled:"on"});
 for(const [name,min,max,step] of [["pointsPerRinggit","0","100","0.01"],["welcomePoints","0","100000","1"],["redemptionPointsPerRinggit","1","1000000","1"],["minimumRedemptionPoints","1","1000000","1"]]){
  const i=form.elements.namedItem(name);assert.equal(i.required,true);assert.deepEqual([i.min,i.max,i.step],[min,max,step]);
 }
 assert.deepEqual(f.reads,[{where:{businessId:"business"}}]);
 f.role="STAFF";await assert.rejects(()=>Settings({searchParams:Promise.resolve({})}),/REDIRECT:\/loyalty/);assert.equal(f.reads.length,1);
});
test("Overview and Members relabel existing numbers without changing search, sort or links",async()=>{
 const {Overview,Members,f}=await fixture();
 const d=dom(await Overview({searchParams:Promise.resolve({})})).window.document;
 const metrics=Array.from(d.querySelectorAll('.loyalty-metrics .customer-info-card')) as HTMLElement[];
 assert.deepEqual(metrics.slice(2).map(m=>[m.querySelector('span')?.textContent,m.querySelector('strong')?.textContent]),[["Points balance","123"],["Points earned","456"],["Points reversed","78"]]);
 const members=dom(await Members({searchParams:Promise.resolve({q:" A ",status:"ACTIVE"})})).window.document;
 assert.deepEqual(Array.from(members.querySelectorAll('th') as NodeListOf<Element>).map(n=>n.textContent),["No.","Customer","Status","Points balance","Earned","Reversed","Joined","Action"]);
 assert.equal(members.querySelector('form').getAttribute('action'),"/loyalty/members");
 assert.equal(members.querySelector('[name="q"]').value,"A");assert.ok(members.querySelector('[href="/crm/customers/customer"]'));
 assert.deepEqual(f.reads[0].orderBy,[{pointsBalance:"desc"},{joinedAt:"desc"}]);assert.equal(f.reads[0].take,20);assert.equal(f.reads[0].where.status,"ACTIVE");
});
