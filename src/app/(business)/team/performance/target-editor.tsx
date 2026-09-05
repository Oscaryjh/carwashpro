"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { readPerformanceDashboard } from "@/lib/performance/dashboard";
import { DEFAULT_LEVELS, equalTargets, formatTargetMoney as money, parseTargetAmount, targetGap, type TargetDraft } from "@/lib/performance/targets-contract";
import { previewTargetAction, publishTargetAction } from "./actions";
import styles from "./performance.module.css";

type Data=Awaited<ReturnType<typeof readPerformanceDashboard>>;
const rate=(value:number|null|undefined)=>value==null?"未确认／未设目标":`${value.toFixed(2)}%`;
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
    if (gap!==null && gap<0) throw new Error("个人目标合计已超过第一级，请先调整后再平均分配。");
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
    setNotice(`已复制为待发布草稿。失效／不在本年门店：${invalid.map(p=>p.fullName+" · "+p.employeeCode).join("、")||"无"}；新增成员：${added.map(m=>m.fullName+" · "+m.employeeCode).join("、")||"无"}。请逐人复核，尚未发布。`);
  }
  return <section className={styles.card}>
    <h2>年度目标设置 <small>当前版本 {data.revision || "未发布"}</small></h2>
    <p>个人只有年度目标；团队三级累计门槛不会自动提高个人目标。</p>
    <button type="button" disabled={!data.previousTarget||pending} onClick={copyPrevious}>复制上一年度为草稿</button>
    {notice&&<p role="status" className={styles.notice}>{notice}</p>}
    <div className={styles.grid}>{levels.map((v,i)=><label key={i}>团队第{i+1}级目标 · RM<input inputMode="decimal" aria-label={`Level ${i+1} target`} value={v} onChange={e=>{change();setLevels(levels.map((x,j)=>i===j?e.target.value:x));}} /></label>)}</div>
    <h3>先分配店长，再分配其他员工</h3>
    <div className={styles.grid}><label>店长（不授予权限）<select aria-label="Target manager" value={manager} onChange={e=>{change();setManager(e.target.value);}}>
      <option value="">请选择</option>{data.members.filter(m=>m.eligible||m.id===data.target?.managerId).map(m=><option key={m.id} value={m.id}>{m.fullName} · {m.employeeCode} · {m.status}</option>)}</select></label>
      <label>店长个人目标 · RM<input aria-label="Manager target" inputMode="decimal" value={managerAmount} onChange={e=>{change();setManagerAmount(e.target.value);}} /></label>
      <label>批量套用金额 · RM<input aria-label="Bulk target" value={bulk} inputMode="decimal" onChange={e=>setBulk(e.target.value)} /></label></div>
    <p>勾选参与员工后预览平均分配；应用只更改本次选中的人。尾差按 membership ID 固定顺序分配。</p>
    <div className={styles.tools}><button type="button" onClick={()=>{change();setParticipants(available.filter(m=>m.id!==manager).map(m=>m.id));}}>选择全部在职员工</button>
      <button type="button" onClick={()=>{change();setParticipants([]);}}>清空参与选择</button>
      <button type="button" onClick={calculate}>预览平均分配</button>
      <button type="button" onClick={()=>{try{const value=(parseTargetAmount(bulk)/100).toFixed(2);if(!participants.length)throw new Error("请先勾选员工。");change();setAmounts(a=>({...a,...Object.fromEntries(participants.filter(id=>id!==manager).map(id=>[id,value]))}));}catch(e){setError((e as Error).message);}}}>批量套用个人目标</button></div>
    {allocation&&<div className={styles.notice}><strong>平均分配预览</strong>{allocation.map(p=><p key={p.membershipId}>{data.members.find(m=>m.id===p.membershipId)?.employeeCode}：{money(p.amount)}</p>)}
      <button type="button" onClick={()=>{setPreview(null);setAmounts(a=>({...a,...Object.fromEntries(allocation.map(p=>[p.membershipId,(p.amount/100).toFixed(2)]))}));setAllocation(null);}}>应用分配</button></div>}
    <label>搜索姓名或员工编号<input type="search" aria-label="Search target employees" value={q} onChange={e=>setQ(e.target.value)} /></label>
    <div className={styles.memberList}>{visible.map(m=><div key={m.id} className={styles.editRow}>
      <label><input type="checkbox" aria-label={`Allocate ${m.employeeCode}`} disabled={m.id===manager||!available.some(a=>a.id===m.id)} checked={participants.includes(m.id)&&m.id!==manager}
        onChange={e=>{change();setParticipants(ids=>e.target.checked?[...ids,m.id]:ids.filter(id=>id!==m.id));}} />{m.fullName}<small>{m.employeeCode} · {m.status}</small></label>
      <label>个人年度目标 · RM<input aria-label={`Annual target ${m.employeeCode}`} inputMode="decimal" value={amounts[m.id]??""} placeholder="未设个人目标"
        onChange={e=>{change();setAmounts(a=>{const next={...a};if(e.target.value==="")delete next[m.id];else next[m.id]=e.target.value;return next;});}} /></label>
    </div>)}</div>
    {!visible.length&&<p>没有符合条件的员工。</p>}
    <p className={styles.gap}>第一级－个人目标合计＝未分配目标差额：<strong>{money(gap)}</strong></p>
    {gap!==null&&gap!==0&&<label className={styles.check}><input type="checkbox" checked={confirmGap} onChange={e=>{setPreview(null);setConfirmGap(e.target.checked);}} />我确认保留上述目标分配差额（不会自动补齐）</label>}
    <label>发布／修改原因（至少5个字符）<textarea aria-label="Target change reason" value={reason} maxLength={500} onChange={e=>{setPreview(null);setReason(e.target.value);}} /></label>
    {error&&<p role="alert" className={styles.error}>{error}</p>}
    <button className={styles.primary} disabled={pending} type="button" onClick={()=>start(async()=>{try {const result=await previewTargetAction(branchId,draft());if(!result.ok){setError(result.error);return;}setPreview(result);setRequestKey(crypto.randomUUID());setError("");}catch(e){setError((e as Error).message);}})}>{pending?"处理中…":"预览发布"}</button>
    {preview&&<div className={styles.preview} aria-label="Target publish preview"><h3>完整发布预览</h3>
      <p>旧版本 {data.revision} → 新版本 {data.revision+1}；原因：{reason}</p>
      <p>三级门槛：{preview.preview.previous?.levels.map(money).join(" / ")??"未设置"} → {preview.preview.next.levels.map(money).join(" / ")}</p>
      <p>目标差额：{money(preview.preview.previous?.gap??null)} → {money(preview.preview.next.gap)}</p>
      <p>今年累计完成率：{rate(preview.preview.before.team.percent)} → {rate(preview.preview.after.team.percent)}</p>
      <p>当前等级：{preview.preview.before.level.level??"未确认"} → {preview.preview.after.level.level??"未确认"}；{preview.preview.coverageStatus==="COMPLETE"?"截至统计时刻数据完整":"数据待补齐，无法确认等级或正式完成率"}</p>
      <p>截至 {preview.preview.asOf}；{preview.preview.personalAllocationIncomplete?"仍有未分配，暂不确认个人完成率":preview.preview.coverageStatus!=="COMPLETE"?"来源核查未完整，暂不确认个人完成率":"截至统计时刻个人归属完整"}。</p>
      {preview.preview.next.people.map(p=><p key={p.membershipId}>{p.fullName} · {p.employeeCode}：{preview.preview.previous?.people.find(old=>old.membershipId===p.membershipId)?money(preview.preview.previous.people.find(old=>old.membershipId===p.membershipId)!.amount):"未设个人目标"} → {p.amount?money(p.amount):"不参与目标（0）"} · 完成率 {rate(preview.preview.before.people.find(a=>a.membershipId===p.membershipId)?.percent)} → {rate(preview.preview.after.people.find(a=>a.membershipId===p.membershipId)?.percent)}</p>)}
      {preview.preview.previous?.people.filter(p=>!preview.preview.next.people.some(n=>n.membershipId===p.membershipId)).map(p=><p key={p.membershipId}>{p.fullName} · {p.employeeCode}：{money(p.amount)} → 移除目标（业绩保留）</p>)}
      <button className={styles.primary} disabled={pending} type="button" onClick={()=>start(async()=>{try{const result=await publishTargetAction(branchId,draft(),preview.token,requestKey);if(!result.ok){setError(result.error);return;}setNotice(`已发布版本 ${result.revision}，实际收款未改变。`);setPreview(null);router.refresh();}catch(e){setError((e as Error).message);}})}>确认发布目标</button>
    </div>}
  </section>;
}
