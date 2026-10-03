import {parseBusinessDateTime} from "@/lib/business-time";

type CalendarEvent = {id:string; staffId:string|null; scheduledAt:string; durationMinutes:number};
export type CalendarCardPlacement<T> = {appointment:T; offsetSlots:number; spanSlots:number; lane:number; laneCount:number};

/** Pixel-layout metadata only. Never changes scheduling durations or availability rules. */
export function buildCalendarPresentation<T extends CalendarEvent>(appointments:T[],date:string,times:string[]) {
  const cards=new Map<string,CalendarCardPlacement<T>[]>();
  const occupied=new Set<string>();
  if(!times.length)return {cards,occupied};
  const slotMs=15*60_000;
  const start=parseBusinessDateTime(date,times[0]).getTime();
  const end=start+times.length*slotMs;
  const staffEvents=new Map<string,{appointment:T;start:number;end:number;lane:number}[]>();
  for(const appointment of appointments){
    const eventStart=new Date(appointment.scheduledAt).getTime();
    const eventEnd=eventStart+appointment.durationMinutes*60_000;
    if(!appointment.staffId||!Number.isFinite(eventEnd)||eventEnd<=eventStart||eventEnd<=start||eventStart>=end)continue;
    const events=staffEvents.get(appointment.staffId)??[];
    events.push({appointment,start:Math.max(start,eventStart),end:Math.min(end,eventEnd),lane:0});
    staffEvents.set(appointment.staffId,events);
  }
  for(const [staffId,events] of staffEvents){
    events.sort((a,b)=>a.start-b.start||a.end-b.end||a.appointment.id.localeCompare(b.appointment.id));
    let cluster:typeof events=[];let clusterEnd=-Infinity;let laneEnds:number[]=[];
    const flush=()=>{
      for(const event of cluster){
        const row=Math.floor((event.start-start)/slotMs);
        const key=`${date}T${times[row]}::${staffId}`;
        const current=cards.get(key)??[];
        current.push({appointment:event.appointment,offsetSlots:(event.start-start)/slotMs-row,spanSlots:(event.end-event.start)/slotMs,lane:event.lane,laneCount:laneEnds.length});
        cards.set(key,current);
        for(let index=row;index<Math.ceil((event.end-start)/slotMs);index++)occupied.add(`${date}T${times[index]}::${staffId}`);
      }
    };
    for(const event of events){
      if(event.start>=clusterEnd){flush();cluster=[];laneEnds=[];}
      let lane=laneEnds.findIndex(laneEnd=>laneEnd<=event.start);
      if(lane<0)lane=laneEnds.length;
      laneEnds[lane]=event.end;event.lane=lane;cluster.push(event);clusterEnd=Math.max(clusterEnd,event.end);
    }
    flush();
  }
  return {cards,occupied};
}
