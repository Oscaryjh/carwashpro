import assert from "node:assert/strict";
import test,{after} from "node:test";
import { randomUUID } from "node:crypto";
import { walletTestDatabase } from "../helpers/wallet-fixture";
import { catalogFixture,catalogForm,loginCatalogFixture } from "../helpers/catalog-outlet-fixture";
import { catalogOutletPages } from "../helpers/catalog-outlet-pages";
import { findPosElement } from "../helpers/pos-outlet-pages";
const db=walletTestDatabase(); after(()=>db.$disconnect());
type Action=(data:FormData)=>Promise<void>;
const component=(name:string)=>(type:unknown)=>typeof type==="function"&&type.name===name;

for(const kind of ["Service","Package"] as const) {
  test(`${kind}: real single edit preserves null/current/inactive branch and CustomerPackage metadata`,async()=>{
    const f=await catalogFixture(db);await loginCatalogFixture(db,f);const pages=await catalogOutletPages(db);
    const before=await db.customerPackage.findUniqueOrThrow({where:{id:f.customerPackage.id}});
    for(let i=0;i<3;i++) {
      const record=(kind==="Service"?f.services:f.packages)[i];
      const page=kind==="Service"?await pages.ServiceDetail({params:Promise.resolve({serviceId:record.id})}):await pages.PackageDetail({params:Promise.resolve({packageId:record.id})});
      const props=findPosElement(page,component(`${kind}Form`));assert.equal((props.outlet as {kind:string}).kind,"single_outlet");
      await assert.rejects((props.action as Action)(catalogForm(f,kind,i)),/REDIRECT:/);
      const saved=kind==="Service"?await db.service.findUniqueOrThrow({where:{id:record.id}}):await db.package.findUniqueOrThrow({where:{id:record.id}});
      assert.equal(saved.branchId,record.branchId);
    }
    assert.deepEqual(await db.customerPackage.findUniqueOrThrow({where:{id:before.id}}),before);
    assert.equal(await db.customerPackageActivity.count({where:{businessId:f.business.id}}),0);
  });
  test(`${kind}: single create uses current branch; explicit foreign/stale/revoked submissions never write`,async()=>{
    const f=await catalogFixture(db);await loginCatalogFixture(db,f);const pages=await catalogOutletPages(db);
    const page=await pages[kind==="Service"?"Services":"Packages"]({searchParams:Promise.resolve({modal:"create"})});
    const props=findPosElement(page,component(`${kind}CreateModal`));const action=props.action as Action;
    const form=catalogForm(f,kind);form.delete(kind==="Service"?"serviceId":"packageId");
    const name=form.get("name")!.toString();await assert.rejects(action(form),/REDIRECT:/);
    const saved=kind==="Service"?await db.service.findFirstOrThrow({where:{businessId:f.business.id,name}}):await db.package.findFirstOrThrow({where:{businessId:f.business.id,name}});
    assert.equal(saved.branchId,f.branches[0].id);
    form.set("branchId",randomUUID());await assert.rejects(action(form),/changed|denied|access|Reload/i);
    form.delete("branchId");await db.branch.create({data:{businessId:f.business.id,name:"New active"}});
    await assert.rejects(action(form),/changed|Reload/);
    await db.branch.updateMany({where:{businessId:f.business.id,name:"New active"},data:{status:"INACTIVE"}});
    await db.user.update({where:{id:f.owner.id},data:{status:"inactive"}});
    await assert.rejects(action(form));
    assert.equal(kind==="Service"?await db.service.count({where:{businessId:f.business.id}}):await db.package.count({where:{businessId:f.business.id}}),4);
  });
  test(`${kind}: legacy create/edit require explicit branch and no-location create fails closed`,async()=>{
    const f=await catalogFixture(db,2);await loginCatalogFixture(db,f);const pages=await catalogOutletPages(db);
    const create=findPosElement(await pages[kind==="Service"?"Services":"Packages"]({searchParams:Promise.resolve({modal:"create"})}),component(`${kind}CreateModal`));
    assert.equal((create.outlet as {kind:string}).kind,"legacy_multi_branch");
    const form=catalogForm(f,kind);await assert.rejects((create.action as Action)(form),/required/);
    form.set("branchId",f.branches[1].id);await assert.rejects((create.action as Action)(form),/REDIRECT:/);
    const detail=kind==="Service"?await pages.ServiceDetail({params:Promise.resolve({serviceId:f.services[1].id})}):await pages.PackageDetail({params:Promise.resolve({packageId:f.packages[1].id})});
    const edit=findPosElement(detail,component(`${kind}Form`));
    const update=catalogForm(f,kind,1);await assert.rejects((edit.action as Action)(update),/required/);
    update.set("branchId",f.branches[1].id);await assert.rejects((edit.action as Action)(update),/REDIRECT:/);
    const edited=kind==="Service"?await db.service.findUniqueOrThrow({where:{id:f.services[1].id}}):await db.package.findUniqueOrThrow({where:{id:f.packages[1].id}});
    assert.equal(edited.branchId,f.branches[1].id);
    const zero=await catalogFixture(db,0);await loginCatalogFixture(db,zero);
    const z=findPosElement(await pages[kind==="Service"?"Services":"Packages"]({searchParams:Promise.resolve({modal:"create"})}),component(`${kind}CreateModal`));
    assert.equal((z.outlet as {kind:string}).kind,"no_location");
    await assert.rejects((z.action as Action)(catalogForm(zero,kind)),/operating location/);
    assert.equal(kind==="Service"?await db.service.count({where:{businessId:zero.business.id}}):await db.package.count({where:{businessId:zero.business.id}}),3);
  });
}

for(const kind of ["Service","Package"] as const) test(`${kind}: edit rechecks topology and revoked authorization before writer`,async()=>{
  const f=await catalogFixture(db);await loginCatalogFixture(db,f);const pages=await catalogOutletPages(db);
  const record=(kind==="Service"?f.services:f.packages)[0];
  const page=kind==="Service"?await pages.ServiceDetail({params:Promise.resolve({serviceId:record.id})}):await pages.PackageDetail({params:Promise.resolve({packageId:record.id})});
  const edit=findPosElement(page,component(`${kind}Form`));const form=catalogForm(f,kind,0);
  const added=await db.branch.create({data:{businessId:f.business.id,name:"Topology changed"}});
  await assert.rejects((edit.action as Action)(form),/changed|Reload/);
  await db.branch.update({where:{id:added.id},data:{status:"INACTIVE"}});
  await db.user.update({where:{id:f.owner.id},data:{status:"inactive"}});
  await assert.rejects((edit.action as Action)(form));
  const after=kind==="Service"?await db.service.findUniqueOrThrow({where:{id:record.id}}):await db.package.findUniqueOrThrow({where:{id:record.id}});
  assert.equal(after.name,record.name);assert.equal(after.branchId,record.branchId);
});

test("legacy Staff one-branch topology, explicit other branch, no-scope and cross-Business are fail closed",async()=>{
  const f=await catalogFixture(db,2);await loginCatalogFixture(db,f,f.staff);const pages=await catalogOutletPages(db);
  const props=findPosElement(await pages.Services({searchParams:Promise.resolve({modal:"create"})}),component("ServiceCreateModal"));
  assert.equal((props.outlet as {kind:string}).kind,"legacy_multi_branch");
  const form=catalogForm(f,"Service");form.set("branchId",f.branches[1].id);
  await assert.rejects((props.action as Action)(form),/changed|denied|access|Reload/i);
  const other=await catalogFixture(db);await assert.rejects(pages.ServiceDetail({params:Promise.resolve({serviceId:other.services[0].id})}),/NOT_FOUND/);
  for(const branchId of [f.branches[1].id,other.branches[0].id,"invalid"]) await assert.rejects(pages.Services({searchParams:Promise.resolve({branchId})}),/NOT_FOUND/);
  await loginCatalogFixture(db,f,f.noScope);
  const noScope=findPosElement(await pages.Services({searchParams:Promise.resolve({modal:"create"})}),component("ServiceCreateModal"));
  form.delete("branchId");await assert.rejects((noScope.action as Action)(form));
});
