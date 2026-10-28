const fail=message=>Object.assign(new Error(message),{status:400});
export function prepareMeshExport(changes,schedule,from,to){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||from>to||![from,to].every(date=>Number.isFinite(Date.parse(date))&&new Date(date).toISOString().slice(0,10)===date)||Date.parse(to)-Date.parse(from)>31*86400000)throw fail('Выберите период до 31 дня.');
  const rows=changes.tasks.filter(t=>!t.cancelledAt&&t.date>=from&&t.date<=to),pending=rows.filter(t=>!t.replacement),stale=rows.filter(t=>t.stale);
  return {schedule,from,to,preparedAt:new Date().toISOString(),canExport:!pending.length&&!stale.length,pending:pending.length,stale:stale.length,rows:rows.filter(t=>t.replacement&&!t.stale).map(t=>({id:t.id,date:t.date,class:t.lesson.class,subgroup:t.lesson.subgroup,slot:t.lesson.slot,start:t.lesson.start,end:t.lesson.end,originalTeacher:t.lesson.teacher,originalSubject:t.lesson.subject,teacher:t.replacement.teacher,subject:t.replacement.subject,room:t.replacement.room,joinsGroup:t.replacement.joinsGroup}))};
}
