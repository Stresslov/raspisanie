import {baseLessonsFor,lessonsFor,classNames} from './schedule.js';
export const emptyChanges=()=>({version:1,updatedAt:null,absences:[],tasks:[],staff:[],staffEtag:'"empty"'});
const normalize=s=>String(s||'').trim().toLocaleLowerCase('ru').replace(/ё/g,'е').replace(/\s+/g,' ');
export function teacherProfiles(state,changes){
  const profiles=new Map(),names=new Map();
  function add(name,subjects,scheduled){if(!name||/ваканси/i.test(name))return;const key=normalize(name),teacher=names.get(key)||name;names.set(key,teacher);if(!profiles.has(teacher))profiles.set(teacher,{subjects:new Set(),scheduled:false});const profile=profiles.get(teacher);profile.scheduled||=scheduled;for(const subject of subjects)if(subject)profile.subjects.add(subject);}
  for(const lesson of state.lessons)add(lesson.teacher,[lesson.subject],true);
  for(const employee of changes.staff||[])add(employee.teacher,employee.subjects,false);
  return profiles;
}
export function teacherNames(state,changes){return [...new Set([...teacherProfiles(state,changes).keys(),...changes.tasks.filter(t=>!t.cancelledAt&&t.replacement).map(t=>t.replacement.teacher)])].sort((a,b)=>a.localeCompare(b,'ru'));}
export function campusOf(lesson){const room=String(lesson.room||'').trim();return /^\d/.test(room)?room[0]:String(lesson.campus||'').trim();}
export function lessonSignature(l){return JSON.stringify(['class','slot','subgroup','subject','teacher','start','end','room','campus'].map(k=>l[k]||''));}
export function taskIsCurrent(state,task){return baseLessonsFor(state,task.lesson.class,task.date).some(l=>lessonSignature(l)===lessonSignature(task.lesson));}
export function overlaps(a,b){return a.start&&a.end&&b.start&&b.end?a.start<b.end&&b.start<a.end:a.slot===b.slot;}
export function dailyLessons(state,changes,date){const source={...state,changes};return classNames(state).flatMap(cl=>lessonsFor(source,cl,date));}
export function teacherLessons(state,changes,teacher,date){return dailyLessons(state,changes,date).filter(l=>l.teacher===teacher&&l.replacementStatus!=='pending').sort((a,b)=>a.slot-b.slot||a.class.localeCompare(b.class,'ru',{numeric:true}));}
export function unavailable(changes,teacher,date,lesson){return changes.absences.some(a=>!a.cancelledAt&&normalize(a.teacher)===normalize(teacher)&&a.date===date&&(a.allDay||a.slots.includes(lesson.slot)));}
export function homeroomTeachers(state,className){
  const lessons=state.lessons.filter(l=>l.class===className&&/(?:^|\s)разговоры\s+о\s+важном(?:\s|$)/u.test(normalize(l.subject).replace(/[«»„“”"'().,_-]/g,' '))&&l.teacher&&!/ваканси/i.test(l.teacher));
  const regular=lessons.filter(l=>!l.date),source=regular.length?regular:lessons;
  return [...new Set(source.map(l=>l.teacher))];
}
const priorities=['','Учитель другой подгруппы этого класса','Классный руководитель','Тот же предмет · предыдущий урок в этом корпусе','Тот же предмет · предыдущий урок в другом корпусе','Другой предмет · предыдущий урок в этом корпусе','Другой предмет · предыдущий урок в другом корпусе','Тот же предмет · предыдущий корпус не определён','Другой предмет · предыдущий корпус не определён'];
export function replacementCandidates(state,changes,task){
  if(task.cancelledAt||!taskIsCurrent(state,task))return [];
  const l=task.lesson,all=dailyLessons(state,changes,task.date).filter(x=>x.replacementId!==task.id&&x.replacementStatus!=='pending'),profiles=teacherProfiles(state,changes),homeroomNames=new Set(homeroomTeachers(state,l.class).map(normalize));
  const candidates=[];
  for(const [teacher,profile] of profiles){
    const subjectsSet=profile.subjects;
    if(normalize(teacher)===normalize(l.teacher)||unavailable(changes,teacher,task.date,l))continue;
    const teacherDay=all.filter(x=>normalize(x.teacher)===normalize(teacher)),busy=teacherDay.filter(x=>overlaps(x,l));
    const joinsGroup=!!l.subgroup&&busy.length>0&&busy.every(x=>x.class===l.class&&x.slot===l.slot&&x.subgroup&&x.subgroup!==l.subgroup);
    if(busy.length&&!joinsGroup)continue;
    const previous=teacherDay.filter(x=>x.start&&x.end&&l.start?x.end<=l.start:x.slot<l.slot).sort((a,b)=>(b.end||'').localeCompare(a.end||'')||b.slot-a.slot);
    const previousCampuses=[...new Set(previous.filter(x=>x.slot===previous[0]?.slot).map(campusOf).filter(Boolean))];
    const previousCampus=previousCampuses.length===1?previousCampuses[0]:'',targetCampus=campusOf(l),sameSubject=[...subjectsSet].some(s=>normalize(s)===normalize(l.subject));
    const known=!!previousCampus&&!!targetCampus,homeroom=homeroomNames.has(normalize(teacher)),priority=joinsGroup?1:homeroom?2:known?(sameSubject?(previousCampus===targetCampus?3:4):(previousCampus===targetCampus?5:6)):(sameSubject?7:8);
    const shared=joinsGroup?busy[0]:null;
    candidates.push({teacher,subjects:[...subjectsSet].sort((a,b)=>a.localeCompare(b,'ru')),sameSubject,priority,reason:priorities[priority],joinsGroup,homeroom,additional:!profile.scheduled,previous:previous[0]?{slot:previous[0].slot,room:previous[0].room,campus:previousCampus}:null,room:shared?.room||l.room,campus:shared?.campus||l.campus,sharedSubject:shared?.subject||'',sharedGroups:joinsGroup?[...new Set(busy.map(x=>x.subgroup))]:[]});
  }
  return candidates.sort((a,b)=>a.priority-b.priority||Number(b.joinsGroup)-Number(a.joinsGroup)||a.teacher.localeCompare(b.teacher,'ru'));
}
function requireValue(condition,message){if(!condition)throw new Error(message);}
export function registerAbsence(state,changes,input,{id=()=>crypto.randomUUID(),now=()=>new Date().toISOString()}={}){
  const {teacher,date}=input,allDay=input.allDay===true,slots=allDay?[]:[...new Set(input.slots||[])].sort((a,b)=>a-b);
  requireValue(teacherNames(state,changes).includes(teacher),'Выберите учителя из расписания или списка сотрудников.');
  requireValue(allDay||slots.length&&slots.every(s=>Number.isInteger(s)&&s>=1&&s<=20),'Выберите хотя бы один урок.');
  const wanted=l=>allDay||slots.includes(l.slot),existing=changes.absences.find(a=>!a.cancelledAt&&normalize(a.teacher)===normalize(teacher)&&a.date===date);
  const affected=teacherLessons(state,changes,teacher,date).filter(wanted);
  requireValue(affected.length||(changes.staff||[]).some(p=>p.teacher===teacher),'На выбранные уроки нет занятий учителя либо отсутствие уже отмечено.');
  const next=structuredClone(changes),timestamp=now();
  let absence=next.absences.find(a=>a.id===existing?.id);
  if(absence){absence.allDay=absence.allDay||allDay;absence.slots=[...new Set([...absence.slots,...slots])].sort((a,b)=>a-b);}
  else {absence={id:id(),teacher,date,allDay,slots,createdAt:timestamp};next.absences.push(absence);}
  // A substitute who becomes absent returns their existing covered lessons to the queue.
  for(const task of next.tasks)if(!task.cancelledAt&&task.date===date&&task.replacement?.teacher===teacher&&wanted(task.lesson)){task.replacement=null;task.updatedAt=timestamp;}
  for(const cl of classNames(state))for(const lesson of baseLessonsFor(state,cl,date))if(lesson.teacher===teacher&&wanted(lesson)&&!next.tasks.some(t=>!t.cancelledAt&&t.date===date&&lessonSignature(t.lesson)===lessonSignature(lesson))){next.tasks.push({id:id(),absenceId:absence.id,date,lesson:structuredClone(lesson),replacement:null,createdAt:timestamp,updatedAt:timestamp});}
  next.updatedAt=timestamp;return next;
}
export function assignReplacement(state,changes,input){
  const task=changes.tasks.find(t=>t.id===input.taskId&&!t.cancelledAt);requireValue(task,'Урок для замены не найден.');requireValue(taskIsCurrent(state,task),'Исходное расписание урока изменилось. Отмените отсутствие и отметьте его заново.');
  const candidate=replacementCandidates(state,changes,task).find(c=>c.teacher===input.teacher);requireValue(candidate,'Этот учитель занят, отсутствует или больше не подходит. Обновите варианты.');
  const subject=String(input.subject||task.lesson.subject).trim();requireValue(subject===task.lesson.subject||candidate.subjects.includes(subject)||(candidate.joinsGroup&&subject===candidate.sharedSubject),'Выберите предмет из предложенного списка.');
  // A teacher merging two subgroups conducts the lesson already scheduled for their group.
  requireValue(!candidate.joinsGroup||subject===candidate.sharedSubject,'При объединении подгрупп предмет должен совпадать с уроком второй подгруппы.');
  const next=structuredClone(changes),item=next.tasks.find(t=>t.id===task.id),timestamp=new Date().toISOString();
  item.replacement={teacher:candidate.teacher,subject,room:candidate.room,campus:candidate.campus,joinsGroup:candidate.joinsGroup};item.updatedAt=timestamp;next.updatedAt=timestamp;return next;
}
export function undoChange(changes,input){const next=structuredClone(changes),timestamp=new Date().toISOString();if(input.action==='unassign'){const task=next.tasks.find(t=>t.id===input.taskId&&!t.cancelledAt);requireValue(task,'Замена не найдена.');task.replacement=null;task.updatedAt=timestamp;}else{const absence=next.absences.find(a=>a.id===input.absenceId&&!a.cancelledAt);requireValue(absence,'Отсутствие не найдено.');absence.cancelledAt=timestamp;for(const task of next.tasks)if(task.absenceId===absence.id){task.cancelledAt=timestamp;task.updatedAt=timestamp;}}next.updatedAt=timestamp;return next;}
