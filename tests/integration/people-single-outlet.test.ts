import assert from "node:assert/strict";
import test from "node:test";
import { randomInt, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { createAttendanceEmployee, updateAttendanceEmployee } from "../../src/lib/attendance/employee-service";
import { preparePeopleOutletForm } from "../../src/lib/team/people-outlet";
import { peopleActionsFixture } from "../helpers/people-actions-fixture";
import { linkExistingStaffToEmployee } from "../../src/lib/team/people-service";

test("real People actions recheck topology, person, branch, permissions and Business access before writing", async () => {
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.port, "55447");
  assert.match(url.pathname, /^\/tetamu_phase1d1_disposable_/);
  const db = new PrismaClient();
  const fixture = await peopleActionsFixture(db);
  const idle = { status: "idle" as const, message: "" };
  let phone = randomInt(60120000000,60129900000);
  const form = (branchId: string) => {
    const f = new FormData();
    Object.entries({ peopleOutletMode: "single_outlet", peopleOutletBranchId: branchId,
      employeeCode: randomUUID(), fullName: "Synthetic action employee", phoneNumber: `+${phone++}`,
      employmentType: "FULL_TIME", status: "ACTIVE", joinedAt: "2024-01-01" }).forEach(([k,v]) => f.set(k,v));
    return f;
  };
  const result = async (call: Promise<unknown>) => {
    try { return await call; } catch (e) {
      if (typeof (e as {url?:unknown}).url === "string") return { redirect: (e as {url:string}).url };
      throw e;
    }
  };
  const create = (f: FormData) => result(fixture.actions.createAttendanceEmployeeAction(idle, f));
  const staffForm = (branchId: string) => {
    const f=form(branchId); f.set("name","Synthetic Staff action person");
    f.set("whatsappPhone",String(f.get("phoneNumber"))); f.set("payBasis","MONTHLY"); f.set("accessType","NO_LOGIN");
    return f;
  };
  const createStaff = (f: FormData) => result(fixture.actions.createStaffAction(f));
  const snapshot = async () => JSON.stringify(await Promise.all([
    db.employeeBusinessMembership.findMany({ orderBy: {id:"asc"} }),
    db.employeeBranchAssignment.findMany({ orderBy: {id:"asc"} }),
    db.user.findMany({ orderBy: {id:"asc"} }),
  ]));
  const deny = async (call: () => Promise<unknown>) => {
    const before = await snapshot(); const response = await call();
    assert.doesNotMatch(JSON.stringify(response), /type=success/);
    assert.equal(await snapshot(), before, JSON.stringify(response));
    return response;
  };
  try {
    const business = await db.business.create({ data: {name:"Action single",slug:randomUUID(),industryType:"SALON_BEAUTY"} });
    const branch = await db.branch.create({data:{businessId:business.id,name:"A"}});
    const foreign = await db.business.create({ data: {name:"Foreign",slug:randomUUID(),industryType:"SALON_BEAUTY"} });
    const foreignBranch = await db.branch.create({data:{businessId:foreign.id,name:"X"}});
    const owner = await db.user.create({data:{businessId:business.id,name:"Owner",email:`${randomUUID()}@example.test`,role:"BUSINESS_OWNER"}});
    const staff = await db.user.create({data:{businessId:business.id,branchId:branch.id,name:"Scoped actor",email:`${randomUUID()}@example.test`,role:"STAFF",permissions:["TEAM","ATTENDANCE_EMPLOYEE_MANAGE"]}});
    await db.businessModuleEntitlement.createMany({data:["POS","SALON","HR"].map(moduleKey=>({businessId:business.id,moduleKey:moduleKey as "HR",status:"ENABLED",source:"MANUAL",enabledFrom:new Date(0)}))});
    await fixture.login(owner.id);
    const success = await create(form(branch.id));
    assert.match(JSON.stringify(success), /type=success/, JSON.stringify(success));
    const employee = await db.employeeBusinessMembership.findFirstOrThrow({where:{businessId:business.id}});
    const rows = await db.employeeBranchAssignment.findMany({where:{membershipId:employee.id}});
    assert.equal(rows.length,1); assert.equal(rows[0].branchId,branch.id); assert.equal(rows[0].isPrimary,true); assert.equal(rows[0].canClockIn,false);
    assert.match(JSON.stringify(await createStaff(staffForm(branch.id))),/type=success/);
    const presentation = await fixture.actions.readPeopleWorkplaceProfile(business.id,employee.id,branch.id);
    assert.deepEqual(presentation,{canSimplify:true,updatedAt:employee.updatedAt.toISOString()}, "Client receives no assignment IDs, dates or scope-out history");
    const group=await db.businessGroup.create({data:{name:"Synthetic HR group",code:randomUUID()}});
    await db.businessGroupMember.create({data:{groupId:group.id,businessId:business.id}});
    const gm=await db.user.create({data:{businessId:foreign.id,name:"Synthetic GM",email:`${randomUUID()}@example.test`,role:"STAFF"}});
    await db.businessGroupUser.create({data:{groupId:group.id,userId:gm.id,role:"GROUP_MANAGER",accessScope:"SELECTED_BUSINESSES",businessAccesses:{create:{businessId:business.id}}}});
    await fixture.login(gm.id,business.id);
    assert.match(JSON.stringify(await create(form(branch.id))),/type=success/,"GM retains existing HR Employee create capability");
    await deny(()=>result(fixture.actions.createStaffAction(new FormData())));
    await fixture.login(owner.id);
    // Existing core-only Staff edit stays usable even when HR entitlement is disabled.
    await linkExistingStaffToEmployee({businessId:business.id,allowedBranchIds:[branch.id],wholeBusinessScope:true,
      actor:{userId:owner.id,name:owner.name,email:owner.email!},membershipId:employee.id,userId:staff.id},db);
    await db.user.update({where:{id:staff.id},data:{loginEnabled:false,permissions:[]}});
    await db.businessModuleEntitlement.updateMany({where:{businessId:business.id,moduleKey:"HR"},data:{status:"DISABLED",revision:{increment:1}}});
    const core=new FormData(); Object.entries({peopleCoreOnly:"on",userId:staff.id,name:"Core profile edited",whatsappPhone:"",branchIds:branch.id,primaryBranchId:branch.id,accessType:"NO_LOGIN"}).forEach(([k,v])=>core.set(k,v));
    const coreRows=await db.employeeBranchAssignment.findMany({where:{membershipId:employee.id},orderBy:{id:"asc"}});
    assert.match(JSON.stringify(await result(fixture.actions.updateStaffAction(core))),/type=success/);
    assert.equal((await db.user.findUniqueOrThrow({where:{id:staff.id}})).name,"Core profile edited");
    assert.deepEqual(await db.employeeBranchAssignment.findMany({where:{membershipId:employee.id},orderBy:{id:"asc"}}),coreRows);
    await db.businessModuleEntitlement.updateMany({where:{businessId:business.id,moduleKey:"HR"},data:{status:"ENABLED",revision:{increment:1}}});
    await db.user.update({where:{id:staff.id},data:{email:staff.email,loginEnabled:true,permissions:["TEAM","ATTENDANCE_EMPLOYEE_MANAGE"]}});
    for (const key of ["branchId","branchIds","primaryBranchId","posHomeBranchId","assignmentId","assignmentIds","userId","employeeId","canClockInBranchIds"]) {
      const f=form(branch.id); f.set(key,foreignBranch.id); await deny(()=>create(f));
      const s=staffForm(branch.id); s.set(key,foreignBranch.id); await deny(()=>createStaff(s));
    }
    const edit=form(branch.id); edit.set("employeeId",randomUUID()); edit.set("expectedUpdatedAt",employee.updatedAt.toISOString());
    await deny(()=>result(fixture.actions.updateAttendanceEmployeeAction(idle,edit)));
    edit.set("employeeId",employee.id); edit.set("expectedUpdatedAt",new Date(0).toISOString());
    await deny(()=>result(fixture.actions.updateAttendanceEmployeeAction(idle,edit)));
    const second=await db.branch.create({data:{businessId:business.id,name:"B"}});
    assert.equal((await fixture.actions.resolveBusinessOutletTopology(business.id,db)).kind,"legacy_multi_branch");
    await deny(()=>create(form(branch.id)));
    await deny(()=>createStaff(staffForm(branch.id)));
    edit.set("expectedUpdatedAt",employee.updatedAt.toISOString()); await deny(()=>result(fixture.actions.updateAttendanceEmployeeAction(idle,edit)));
    await db.branch.update({where:{id:second.id},data:{status:"INACTIVE"}});
    await fixture.login(staff.id);
    await db.user.update({where:{id:staff.id},data:{permissions:[]}});
    await deny(()=>create(form(branch.id)));
    await deny(()=>createStaff(staffForm(branch.id)));
    await db.user.update({where:{id:staff.id},data:{permissions:["TEAM","ATTENDANCE_EMPLOYEE_MANAGE"],branchId:null}});
    await deny(()=>create(form(branch.id)));
    await db.user.update({where:{id:staff.id},data:{branchId:branch.id,status:"inactive"}});
    await deny(()=>create(form(branch.id)));
    await fixture.login(owner.id);
    await db.branch.update({where:{id:branch.id},data:{status:"INACTIVE"}});
    await deny(()=>create(form(branch.id)));
    await deny(()=>createStaff(staffForm(branch.id)));
    assert.equal((await fixture.actions.resolveBusinessOutletTopology(business.id,db)).kind,"no_location");
    const legacy = form(branch.id); legacy.delete("peopleOutletMode"); legacy.delete("peopleOutletBranchId");
    legacy.set("branchIds",foreignBranch.id); legacy.set("primaryBranchId",foreignBranch.id);
    await deny(()=>create(legacy));
    // Foreign person IDs are rejected by real action lookup, never auto-replaced.
    const foreignAccount=await db.employeeAccount.create({data:{name:"Foreign identity",phoneNormalized:`+${phone++}`,phoneNumber:`+${phone++}`}});
    const foreignEmployee=await db.employeeBusinessMembership.create({data:{businessId:foreign.id,employeeAccountId:foreignAccount.id,employeeCode:randomUUID(),fullName:"Foreign",phoneNumber:foreignAccount.phoneNumber,phoneNumberNormalized:foreignAccount.phoneNormalized,joinedAt:new Date("2024-01-01"),status:"TERMINATED"}});
    edit.set("employeeId",foreignEmployee.id); await deny(()=>result(fixture.actions.updateAttendanceEmployeeAction(idle,edit)));
    const staffEdit=new FormData(); staffEdit.set("userId",staff.id); staffEdit.set("employeeId",foreignEmployee.id);
    await deny(()=>result(fixture.actions.updateStaffAction(staffEdit)));
  } finally { await fixture.close(); await db.$disconnect(); }
});

test("single-outlet ordinary profile save leaves current and historical assignment rows byte-for-byte unchanged", async () => {
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.port, "55447");
  assert.match(url.pathname, /^\/tetamu_phase1d1_disposable_/);
  const db = new PrismaClient();
  try {
    const business = await db.business.create({ data: { name: "PHASE1D1 disposable", slug: randomUUID(), industryType: "SALON_BEAUTY" } });
    const branch = await db.branch.create({ data: { businessId: business.id, name: "Current A" } });
    const historical = await db.branch.create({ data: { businessId: business.id, name: "Historical B", status: "INACTIVE" } });
    const owner = await db.user.create({ data: { businessId: business.id, name: "Synthetic owner", email: `owner-${randomUUID()}@example.test`, role: "BUSINESS_OWNER" } });
    const actor = { userId: owner.id, name: owner.name, email: owner.email! };
    const input = { businessId: business.id, employeeCode: "TEST1D1", fullName: "Synthetic employee", phoneNumber: "+60123456781",
      joinedAt: new Date("2024-01-01"), status: "ACTIVE", assignments: [{ branchId: branch.id, isPrimary: true,
        canClockIn: false, effectiveFrom: new Date("2024-02-01"), effectiveUntil: null, status: "ACTIVE" }] };
    const created = await createAttendanceEmployee({ businessId: business.id, allowedBranchIds: [branch.id], actor, input }, db);
    await db.employeeBranchAssignment.create({ data: { businessId: business.id, membershipId: created.id,
      branchId: historical.id, status: "INACTIVE", isPrimary: false, canClockIn: false,
      effectiveFrom: new Date("2023-01-01"), effectiveUntil: new Date("2023-12-31") } });
    const before = await db.employeeBranchAssignment.findMany({ where: { membershipId: created.id }, orderBy: { id: "asc" } });
    const form = new FormData(); form.set("peopleOutletMode", "single_outlet"); form.set("peopleOutletBranchId", branch.id);
    const prepared = preparePeopleOutletForm({ formData: form, topology: { kind: "single_outlet", internalBranchId: branch.id, branchNameSnapshot: branch.name },
      allowedBranchIds: [branch.id], existing: { status: created.status, assignments: before } });
    await updateAttendanceEmployee({ businessId: business.id, allowedBranchIds: [branch.id], actor,
      expectedUpdatedAt: created.updatedAt, input: { ...input, employeeId: created.id, fullName: "Updated name", assignments: prepared.preservedAssignments } }, db);
    const after = await db.employeeBranchAssignment.findMany({ where: { membershipId: created.id }, orderBy: { id: "asc" } });
    assert.deepEqual(after, before);
  } finally { await db.$disconnect(); }
});
