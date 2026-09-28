"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { readPerformanceDashboard } from "@/lib/performance/dashboard";
import { DEFAULT_LEVELS, equalTargets, parseTargetAmount, targetGap, type TargetDraft } from "@/lib/performance/targets-contract";
import { performanceMoney as money, performanceError } from "./display";
import { previewTargetAction, publishTargetAction } from "./actions";
import styles from "./performance.module.css";

type Data=Awaited<ReturnType<typeof readPerformanceDashboard>>;
const rate=(value:number|null|undefined)=>value==null?"N/A":`${value.toFixed(2)}%`;
export function TargetEditor({data,branchId}:{data:Data;branchId:string}) {
  const router=useRouter();
  const [levels,setLevels]=useState((data.target?.levels??DEFAULT_LEVELS).map(v=>(v/100).toFixed(2)));
  const [amounts,setAmounts]=useState<Record<string,string>>(Object.fromEntries((data.target?.people??[]).map(p=>[p.membershipId,(p.amount/100).toFixed(2)])));
  const [manager,setManager]=useState(data.target?.managerId??"");
  const [managerAmount,setManagerAmount]=useState(data.target?.people.find(p=>p.membershipId===manager)?.amount ? String(data.target.people.find(p=>p.membershipId===manager)!.amount/100) : "300000");
  const [participants,setParticipants]=useState<string[]>([]);
  const [q,setQ]=useState(""); const [reason,setReason]=useState(""); const [confirmGap,setConfirmGap]=useState(false);
  const [error,setError]=useState(""); const [notice,setNotice]=useState(""); const [pending,start]=useTransition();
  const [preview,setPreview]=useState<Extract<Awaited<ReturnType<typeof previewTargetAction>>,{ok:true}>|null>(null);
  const [requestKey,setRequestKey]=useState("");
  const [allocation,setAllocation]=useState<ReturnType<typeof equalTargets>|null>(null);
  const [bulk,setBulk]=useState("50000");
  const change=()=>{setPreview(null);setError("");setAllocation(null);};
  const available=data.members.filter(m=>m.eligible && m.status==="ACTIVE");
  const visible=data.members.filter(m=>`${m.fullName} ${m.employeeCode}`.toLowerCase().includes(q.toLowerCase()));
  let gap:number|null=null;
  try { gap=targetGap(parseTargetAmount(levels[0]),Object.values(amounts).map(v=>({amount:parseTargetAmount(v)}))); } catch {}
  function draft():TargetDraft { return {year:data.year,levels:levels.map(parseTargetAmount) as [number,number,number],managerId:manager||null,
    people:Object.entries(amounts).map(([membershipId,value])=>({membershipId,amount:parseTargetAmount(value)})),
    expectedRevision:data.revision,reason,confirmGap}; }
  function calculate() { try {
    if (gap!==null && gap<0) throw new Error("Individual targets exceed Level 1. Adjust them before distributing evenly.");
    setAllocation(equalTargets(parseTargetAmount(levels[0]),parseTargetAmount(managerAmount),manager,participants));setError("");
  } catch(e){setError((e as Error).message);} }
  function copyPrevious() {
    if (!data.previousTarget) return;
    change();setLevels(data.previousTarget.levels.map(v=>(v/100).toFixed(2)));
    const valid=new Set(available.map(m=>m.id));
    const invalid=data.previousTarget.people.filter(p=>!valid.has(p.membershipId));
    const added=available.filter(m=>!data.previousTarget!.people.some(p=>p.membershipId===m.id));
    setAmounts(Object.fromEntries(data.previousTarget.people.filter(p=>valid.has(p.membershipId)).map(p=>[p.membershipId,(p.amount/100).toFixed(2)])));
    setManager(data.previousTarget.managerId&&valid.has(data.previousTarget.managerId)?data.previousTarget.managerId:"");
    setManagerAmount(String((data.previousTarget.people.find(p=>p.membershipId===data.previousTarget?.managerId)?.amount??0)/100));
    setNotice(`Copied as an unpublished draft. Inactive or outside this branch/year: ${invalid.map(p=>p.fullName+" · "+p.employeeCode).join(", ")||"None"}; new members: ${added.map(m=>m.fullName+" · "+m.employeeCode).join(", ")||"None"}. Review each member before publishing.`);
  }
  return <section className={styles.card}>
    <h2>Annual target settings <small>Current version {data.revision || "Unpublished"}</small></h2>
    <p>Individual targets are annual. The three team thresholds do not automatically increase individual targets.</p>
    <button type="button" disabled={!data.previousTarget||pending} onClick={copyPrevious}>Copy previous year as draft</button>
    {notice&&<p role="status" className={styles.notice}>{notice}</p>}
    <div className={styles.grid}>{levels.map((v,i)=><label key={i}>Team Level {i+1} target · RM<input inputMode="decimal" aria-label={`Level ${i+1} target`} value={v} onChange={e=>{change();setLevels(levels.map((x,j)=>i===j?e.target.value:x));}} /></label>)}</div>
    <h3>Allocate the manager target first, then other employees</h3>
    <div className={styles.grid}><label>Manager (does not grant permissions)<select aria-label="Target manager" value={manager} onChange={e=>{change();setManager(e.target.value);}}>
      <option value="">Select a manager</option>{data.members.filter(m=>m.eligible||m.id===data.target?.managerId).map(m=><option key={m.id} value={m.id}>{m.fullName} · {m.employeeCode} · {m.status}</option>)}</select></label>
      <label>Manager target · RM<input aria-label="Manager target" inputMode="decimal" value={managerAmount} onChange={e=>{change();setManagerAmount(e.target.value);}} /></label>
      <label>Bulk amount · RM<input aria-label="Bulk target" value={bulk} inputMode="decimal" onChange={e=>setBulk(e.target.value)} /></label></div>
    <p>Select participants to preview an equal allocation. Applying it changes only selected participants. Rounding differences follow a fixed membership ID order.</p>
    <div className={styles.tools}><button type="button" onClick={()=>{change();setParticipants(available.filter(m=>m.id!==manager).map(m=>m.id));}}>Select all active employees</button>
      <button type="button" onClick={()=>{change();setParticipants([]);}}>Clear selection</button>
      <button type="button" onClick={calculate}>Preview equal allocation</button>
      <button type="button" onClick={()=>{try{const value=(parseTargetAmount(bulk)/100).toFixed(2);if(!participants.length)throw new Error("Select employees first.");change();setAmounts(a=>({...a,...Object.fromEntries(participants.filter(id=>id!==manager).map(id=>[id,value]))}));}catch(e){setError((e as Error).message);}}}>Apply bulk targets</button></div>
    {allocation&&<div className={styles.notice}><strong>Equal allocation preview</strong>{allocation.map(p=><p key={p.membershipId}>{data.members.find(m=>m.id===p.membershipId)?.employeeCode}: {money(p.amount)}</p>)}
      <button type="button" onClick={()=>{setPreview(null);setAmounts(a=>({...a,...Object.fromEntries(allocation.map(p=>[p.membershipId,(p.amount/100).toFixed(2)]))}));setAllocation(null);}}>Apply allocation</button></div>}
    <label>Search by name or employee ID<input type="search" aria-label="Search target employees" value={q} onChange={e=>setQ(e.target.value)} /></label>
    <div className={styles.memberList}>{visible.map(m=><div key={m.id} className={styles.editRow}>
      <label><input type="checkbox" aria-label={`Allocate ${m.employeeCode}`} disabled={m.id===manager||!available.some(a=>a.id===m.id)} checked={participants.includes(m.id)&&m.id!==manager}
        onChange={e=>{change();setParticipants(ids=>e.target.checked?[...ids,m.id]:ids.filter(id=>id!==m.id));}} />{m.fullName}<small>{m.employeeCode} · {m.status}</small></label>
      <label>Individual annual target · RM<input aria-label={`Annual target ${m.employeeCode}`} inputMode="decimal" value={amounts[m.id]??""} placeholder="No individual target set"
        onChange={e=>{change();setAmounts(a=>{const next={...a};if(e.target.value==="")delete next[m.id];else next[m.id]=e.target.value;return next;});}} /></label>
    </div>)}</div>
    {!visible.length&&<p>No matching employees.</p>}
    <p className={styles.gap}>Level 1 minus individual targets = Unallocated target gap: <strong>{money(gap)}</strong></p>
    {gap!==null&&gap!==0&&<label className={styles.check}><input type="checkbox" checked={confirmGap} onChange={e=>{setPreview(null);setConfirmGap(e.target.checked);}} />I confirm this allocation gap (it will not be filled automatically)</label>}
    <label>Reason for publishing or changing targets (at least 5 characters)<textarea aria-label="Target change reason" value={reason} maxLength={500} onChange={e=>{setPreview(null);setReason(e.target.value);}} /></label>
    {error&&<p role="alert" className={styles.error}>{performanceError(error)}</p>}
    <button className={styles.primary} disabled={pending} type="button" onClick={()=>start(async()=>{try {const result=await previewTargetAction(branchId,draft());if(!result.ok){setError(result.error);return;}setPreview(result);setRequestKey(crypto.randomUUID());setError("");}catch(e){setError((e as Error).message);}})}>{pending?"Processing…":"Preview publication"}</button>
    {preview&&<div className={styles.preview} aria-label="Target publish preview"><h3>Publication preview</h3>
      <p>Previous version {data.revision} → New version {data.revision+1}; reason: {reason}</p>
      <p>Three thresholds: {preview.preview.previous?.levels.map(money).join(" / ")??"Not set"} → {preview.preview.next.levels.map(money).join(" / ")}</p>
      <p>Target gap: {money(preview.preview.previous?.gap??null)} → {money(preview.preview.next.gap)}</p>
      <p>Year-to-date completion: {rate(preview.preview.before.team.percent)} → {rate(preview.preview.after.team.percent)}</p>
      <p>Current level: {preview.preview.before.level.level??"Unconfirmed"} → {preview.preview.after.level.level??"Unconfirmed"}; {preview.preview.coverageStatus==="COMPLETE"?"Data complete as of the reporting time":"Data incomplete; levels and completion rates are unconfirmed"}</p>
      <p>As of {preview.preview.asOf}; {preview.preview.personalAllocationIncomplete?"Unassigned amounts remain; individual completion rates are unconfirmed":preview.preview.coverageStatus!=="COMPLETE"?"Source verification is incomplete; individual completion rates are unconfirmed":"Individual attribution is complete as of the reporting time"}.</p>
      {preview.preview.next.people.map(p=><p key={p.membershipId}>{p.fullName} · {p.employeeCode}: {preview.preview.previous?.people.find(old=>old.membershipId===p.membershipId)?money(preview.preview.previous.people.find(old=>old.membershipId===p.membershipId)!.amount):"No individual target set"} → {p.amount?money(p.amount):"Not participating (0)"} · Completion {rate(preview.preview.before.people.find(a=>a.membershipId===p.membershipId)?.percent)} → {rate(preview.preview.after.people.find(a=>a.membershipId===p.membershipId)?.percent)}</p>)}
      {preview.preview.previous?.people.filter(p=>!preview.preview.next.people.some(n=>n.membershipId===p.membershipId)).map(p=><p key={p.membershipId}>{p.fullName} · {p.employeeCode}: {money(p.amount)} → Target removed (performance retained)</p>)}
      <button className={styles.primary} disabled={pending} type="button" onClick={()=>start(async()=>{try{const result=await publishTargetAction(branchId,draft(),preview.token,requestKey);if(!result.ok){setError(result.error);return;}setNotice(`Published version ${result.revision}. Actual receipts are unchanged.`);setPreview(null);router.refresh();}catch(e){setError((e as Error).message);}})}>Publish targets</button>
    </div>}
  </section>;
}
