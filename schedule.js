export function isoDay(date=new Date()){const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);const get=k=>p.find(x=>x.type===k).value;return `${get('year')}-${get('month')}-${get('day')}`;}
export function addDays(day,n){const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
export function weekday(day){return (new Date(day+'T12:00:00Z').getUTCDay()+6)%7+1;}
export function monday(day){return addDays(day,1-weekday(day));}
export function lessonsFor(state,cl,day){
  if((state.validFrom&&day<state.validFrom)||(state.validTo&&day>state.validTo))return [];
  const all=(state.lessons||[]).filter(l=>l.class===cl);
  const special=all.filter(l=>l.date===day),wholeSlots=new Set(special.filter(l=>!l.subgroup).map(l=>l.slot)),groupSlots=new Set(special.map(l=>[l.slot,l.subgroup||''].join('|')));
  return [...all.filter(l=>!l.date&&l.weekday===weekday(day)&&!wholeSlots.has(l.slot)&&!groupSlots.has([l.slot,l.subgroup||''].join('|'))),...special].sort((a,b)=>a.slot-b.slot||(a.subgroup||'').localeCompare(b.subgroup||'','ru'));
}
export function classNames(state){return [...new Set(state.lessons.map(l=>l.class))].sort((a,b)=>a.localeCompare(b,'ru',{numeric:true}));}
export function entityOptions(state,mode='class'){const key=mode==='teacher'?'teacher':mode==='room'?'room':'class';return [...new Set(state.lessons.map(l=>l[key]).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru',{numeric:true}));}
export function entityLessonsFor(state,mode,entity,day){
  if(mode==='class')return lessonsFor(state,entity,day).map(l=>({...l,classes:[l.class],subgroups:l.subgroup?[l.subgroup]:[]}));
  const matches=[];for(const cl of classNames(state))matches.push(...lessonsFor(state,cl,day).filter(l=>l[mode]===entity));
  const joined=new Map();
  for(const l of matches){const key=JSON.stringify([l.start,l.end,l.slot,l.subject,l.teacher,l.room,l.campus,l.date]);if(!joined.has(key))joined.set(key,{...l,classes:[],subgroups:[]});const item=joined.get(key);if(!item.classes.includes(l.class))item.classes.push(l.class);if(l.subgroup&&!item.subgroups.includes(l.subgroup))item.subgroups.push(l.subgroup);}
  return [...joined.values()].sort((a,b)=>a.start.localeCompare(b.start)||a.slot-b.slot||a.classes[0].localeCompare(b.classes[0],'ru',{numeric:true}));
}
export function emptyState(){return {version:1,updatedAt:null,validFrom:'',validTo:'',notice:'',lessons:[],documents:[]};}

// Empty slots use the bell times printed in the school's source PDF.
export function lessonSlots(state){
  const max=Math.max(10,...state.lessons.map(l=>l.slot));
  return Array.from({length:max},(_,i)=>{const slot=i+1,observed=state.lessons.find(l=>l.slot===slot&&l.start&&l.end);return {slot,start:observed?.start||(slot<=10?`${String(7+slot).padStart(2,'0')}:30`:''),end:observed?.end||(slot<=10?`${String(8+slot).padStart(2,'0')}:10`:'')};});
}
export function dayGrid(state,mode,entity,date){const items=entityLessonsFor(state,mode,entity,date);return lessonSlots(state).map(slot=>({...slot,items:items.filter(l=>l.slot===slot.slot)}));}
export function weekDates(state,day){const start=monday(day),max=Math.max(5,...state.lessons.map(l=>l.date?weekday(l.date):l.weekday));return Array.from({length:max},(_,i)=>addDays(start,i));}
