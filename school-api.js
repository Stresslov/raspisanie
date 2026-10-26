// Generated from lib/school-api.mjs; edit the shared source.
import {emptyChanges,replacementCandidates,registerAbsence,assignReplacement,undoChange,taskIsCurrent} from './replacements-core.js';
const STATE_KEY='school/state.json';
const CATALOG_KEY='school/catalog.json';
const STAFF_KEY='school/staff.json';
const normalizedName=value=>String(value||'').toLocaleLowerCase('ru').replace(/ё/g,'е').replace(/\s+/g,' ').trim();
async function staffContext(env){const object=await env.BUCKET.get(STAFF_KEY);return {object,staff:object?await object.json():[],staffEtag:object?.httpEtag||'"empty"'};}
async function catalog(env){const object=await env.BUCKET.get(CATALOG_KEY);return {object,entries:object?await object.json():[]};}
async function stateKey(url,env){const id=url.searchParams.get('schedule')||'current';if(id==='current')return STATE_KEY;if(!/^[a-f0-9-]{36}$/.test(id)||(await catalog(env)).entries.every(e=>e.id!==id))throw fail('Файл расписания не найден.',404);return 'school/schedules/'+id+'.json';}
async function readJson(request){if(Number(request.headers.get('content-length'))>MAX_JSON)throw fail('Расписание слишком большое.',413);const body=await request.text();if(new TextEncoder().encode(body).length>MAX_JSON)throw fail('Расписание слишком большое.',413);try{return JSON.parse(body);}catch{throw fail('Не удалось прочитать данные расписания.');}}
async function checkDocuments(next,env){await Promise.all(next.documents.map(async d=>{const file=await env.BUCKET.head('pdf/'+d.id);if(!file||file.size!==d.size)throw fail('PDF не найден в хранилище. Загрузите его снова.');}));}
const EMPTY={version:1,updatedAt:null,validFrom:'',validTo:'',notice:'',lessons:[],documents:[]};
const MAX_JSON=6*1024*1024,MAX_PDF=20*1024*1024;
const PUBLIC_FRONTEND='https://stresslov.github.io';
function allowedOrigin(origin,url){return !origin||origin===url.origin||origin===PUBLIC_FRONTEND;}
const json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
function text(value,max,required=false){if(typeof value!=='string'||value.length>max||(required&&!value.trim()))throw fail('Неверный текст или превышена допустимая длина.');return value.trim();}
function date(value){const s=text(value,10);if(!s)return '';if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(Date.parse(s+'T12:00:00Z'))||new Date(s+'T12:00:00Z').toISOString().slice(0,10)!==s)throw fail('Некорректная дата.');return s;}
function time(value){const s=text(value,5);if(s&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(s))throw fail('Некорректное время.');return s;}
export function validateState(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw fail('Неверные данные расписания.');
  const validFrom=date(raw.validFrom??''),validTo=date(raw.validTo??'');
  if(validFrom&&validTo&&validFrom>validTo)throw fail('Дата окончания раньше начала.');
  if(!Array.isArray(raw.lessons)||raw.lessons.length>20000||!Array.isArray(raw.documents)||raw.documents.length>30)throw fail('Допускается до 20 000 уроков и до 30 PDF.');
  const keys=new Set();
  const lessons=raw.lessons.map(l=>{
    if(!l||typeof l!=='object')throw fail('Неверная строка урока.');
    const cl=text(l.class,40,true),day=l.weekday,slot=l.slot;
    if(!Number.isInteger(day)||day<1||day>7||!Number.isInteger(slot)||slot<1||slot>20)throw fail('Неверный день или номер урока.');
    const start=time(l.start??''),end=time(l.end??''),d=date(l.date??'');
    if(Boolean(start)!==Boolean(end)||(start&&start>=end))throw fail('Проверьте время начала и конца урока.');
    if(d&&(new Date(d+'T12:00:00Z').getUTCDay()+6)%7+1!==day)throw fail('Дата замены не совпадает с днём недели.');
    const subgroup=text(l.subgroup??'',80),k=[cl,day,slot,d,subgroup].join('|');if(keys.has(k))throw fail('Для класса и подгруппы указан один номер урока дважды.');keys.add(k);
    return {class:cl,weekday:day,slot,subject:text(l.subject,200,true),start,end,room:text(l.room??'',120),teacher:text(l.teacher??'',160),campus:text(l.campus??'',120),subgroup,notes:text(l.notes??'',500),date:d};
  });
  const docIds=new Set();
  const documents=raw.documents.map(d=>{
    if(!d||typeof d.id!=='string'||!/^[-a-f0-9]{36}$/.test(d.id)||docIds.has(d.id))throw fail('Некорректный PDF-документ.');docIds.add(d.id);
    if(!Number.isInteger(d.size)||d.size<5||d.size>MAX_PDF)throw fail('Некорректный размер PDF.');
    return {id:d.id,name:text(d.name,180,true),class:text(d.class??'',40),size:d.size};
  });
  return {version:1,updatedAt:new Date().toISOString(),validFrom,validTo,notice:text(raw.notice??'',1000),lessons,documents};
}
async function authorized(request,env,changes=false){
  const secrets=(changes?[env.CHANGES_TOKEN,env.ADMIN_TOKEN]:[env.ADMIN_TOKEN]).filter(Boolean);
  if(!secrets.length)throw fail('Пароль администратора ещё не настроен.',503);
  const key=request.headers.get('x-school-admin-key')||'';
  if(!key||key.length>200)throw fail('Неверный пароль администратора.',401);
  const enc=new TextEncoder(),hash=async s=>new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(s)));
  const a=await hash(key);let accepted=0;for(const secret of secrets){const b=await hash(secret);let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];accepted|=Number(diff===0);}
  if(!accepted)throw fail(changes?'Неверный пароль ответственного.':'Неверный пароль администратора.',401);
}
async function changesContext(url,env){const key=await stateKey(url,env),source=await env.BUCKET.get(key),storageKey=key===STATE_KEY?'school/changes/current.json':key.replace('school/schedules/','school/changes/'),object=await env.BUCKET.get(storageKey),staff=await staffContext(env);return {key:storageKey,source,sourceTag:source?.httpEtag||'"empty"',state:source?await source.json():EMPTY,object,tag:object?.httpEtag||'"empty"',changes:{...(object?await object.json():emptyChanges()),staff:staff.staff,staffEtag:staff.staffEtag}};}
async function handleRequest(request,env){
  try{
    const url=new URL(request.url),path=url.pathname.replace(/^\/api\//,'');
    if(!env.BUCKET)throw fail('Общее хранилище ещё не настроено.',503);
    if(request.method==='GET'&&path==='schedules')return json([{id:'current',name:'Актуальное'},...(await catalog(env)).entries]);
    if(request.method==='GET'&&path==='state'){
      const object=await env.BUCKET.get(await stateKey(url,env));
      return object?json(await object.json(),200,{ETag:object.httpEtag}):json(EMPTY,200,{ETag:'"empty"'});
    }
    if(request.method==='GET'&&path==='admin'){await authorized(request,env);return json({ok:true});}
    if(request.method==='GET'&&path==='changes/admin'){await authorized(request,env,true);return json({ok:true,separatePassword:!!env.CHANGES_TOKEN});}
    if(request.method==='GET'&&path==='changes'){
      const c=await changesContext(url,env);return json({...c.changes,scheduleEtag:c.sourceTag,tasks:c.changes.tasks.map(t=>({...t,stale:!t.cancelledAt&&!taskIsCurrent(c.state,t)}))},200,{ETag:c.tag});
    }
    if(request.method==='GET'&&path==='changes/candidates'){
      await authorized(request,env,true);const c=await changesContext(url,env),task=c.changes.tasks.find(t=>t.id===url.searchParams.get('task')&&!t.cancelledAt);
      if(!task)throw fail('Урок для замены не найден.',404);
      if(!taskIsCurrent(c.state,task))throw fail('Исходный урок изменился. Отмените отсутствие и отметьте его заново.',409);
      return json({task,candidates:replacementCandidates(c.state,c.changes,task),scheduleEtag:c.sourceTag},200,{ETag:c.tag});
    }
    const fileMatch=path.match(/^files\/([-a-f0-9]{36})$/);
    if(request.method==='GET'&&fileMatch){
      const id=fileMatch[1],object=await env.BUCKET.get('pdf/'+id);
      if(!object)throw fail('Документ не найден.',404);
      // Draft PDFs require admin authorization; only published documents are public.
      const state=await env.BUCKET.get(STATE_KEY);let published=state?(await state.json()).documents.find(d=>d.id===id):null;
      if(!published)for(const entry of (await catalog(env)).entries){const saved=await env.BUCKET.get('school/schedules/'+entry.id+'.json');published=saved?(await saved.json()).documents.find(d=>d.id===id):null;if(published)break;}
      if(!published){await authorized(request,env);}
      const filename=published?.name||object.customMetadata?.name||'Расписание.pdf';
      return new Response(object.body,{headers:{'Content-Type':'application/pdf','Content-Length':String(object.size),'Content-Disposition':`${url.searchParams.has('download')?'attachment':'inline'}; filename="schedule.pdf"; filename*=UTF-8''${encodeURIComponent(filename)}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"frame-ancestors 'self' https://stresslov.github.io"}});
    }
    if(request.method==='PUT'||request.method==='POST'){
      await authorized(request,env,path==='changes'||path==='changes/staff');
      const origin=request.headers.get('origin');if(!allowedOrigin(origin,url))throw fail('Публикация разрешена только с разрешённого сайта.',403);
    }
    if(request.method==='POST'&&path==='changes/staff'){
      const raw=await readJson(request),current=await staffContext(env);
      if(!raw||typeof raw!=='object'||Array.isArray(raw))throw fail('Неверные данные сотрудника.');
      if((request.headers.get('if-match')||'').replace(/^W\//,'')!==current.staffEtag)throw fail('Список сотрудников изменился. Обновите его и повторите действие.',409);
      const name=text(raw.teacher,160,true),normalized=normalizedName(name),index=current.staff.findIndex(p=>normalizedName(p.teacher)===normalized),staff=structuredClone(current.staff);
      if(raw.action==='upsert'){
        if(/ваканси/i.test(name))throw fail('Укажите ФИО сотрудника, а не название вакансии.');
        if(!Array.isArray(raw.subjects)||!raw.subjects.length||raw.subjects.length>20)throw fail('Укажите от 1 до 20 предметов.');
        const subjects=[...new Map(raw.subjects.map(subject=>{const label=text(subject,200,true);return [normalizedName(label),label];})).values()];
        const context=await changesContext(url,env),scheduled=context.state.lessons.find(l=>normalizedName(l.teacher)===normalized);
        const employee={teacher:index>=0?staff[index].teacher:scheduled?.teacher||name,subjects};
        if(index>=0)staff[index]=employee;else {if(staff.length>=500)throw fail('Можно добавить до 500 сотрудников.');staff.push(employee);}
      }else if(raw.action==='delete'){if(index<0)throw fail('Сотрудник не найден.',404);staff.splice(index,1);}
      else throw fail('Неизвестное действие со списком сотрудников.');
      staff.sort((a,b)=>a.teacher.localeCompare(b.teacher,'ru'));
      const stored=await env.BUCKET.put(STAFF_KEY,JSON.stringify(staff),{httpMetadata:{contentType:'application/json'},onlyIf:current.object?{etagMatches:current.object.etag}:{etagDoesNotMatch:'*'}});
      if(!stored)throw fail('Другой ответственный изменил список сотрудников. Обновите его и повторите действие.',409);
      return json({staff,staffEtag:stored.httpEtag},200,{ETag:stored.httpEtag});
    }
    if(request.method==='POST'&&path==='changes'){
      const raw=await readJson(request),c=await changesContext(url,env),expected=(request.headers.get('if-match')||'').replace(/^W\//,'');
      if(!raw||typeof raw!=='object'||Array.isArray(raw))throw fail('Неверные данные замены.');
      if(expected!==c.tag)throw fail('Список замен изменился в другом окне. Обновите его и повторите действие.',409);
      if(String(raw.scheduleEtag||'').replace(/^W\//,'')!==c.sourceTag)throw fail('Основное расписание обновилось. Обновите страницу перед назначением замены.',409);
      let next;try{
        if(raw.action==='absence'){
          const day=date(raw.date);if(!day)throw fail('Выберите дату отсутствия.');
          next=registerAbsence(c.state,c.changes,{teacher:text(raw.teacher,160,true),date:day,allDay:raw.allDay===true,slots:raw.slots});
        }else if(raw.action==='assign')next=assignReplacement(c.state,c.changes,{taskId:text(raw.taskId,80,true),teacher:text(raw.teacher,160,true),subject:text(raw.subject||'',200)});
        else if(['unassign','cancel-absence'].includes(raw.action))next=undoChange(c.changes,raw);
        else throw fail('Неизвестное действие с заменами.');
      }catch(e){if(e.status)throw e;throw fail(e.message);}
      if(next.tasks.length>20000||next.absences.length>5000)throw fail('Хранилище замен заполнено. Сохраните историю и обратитесь к администратору.');
      // Recheck the source revision before writing; stale assignments are also hidden by the client overlay.
      const sourceNow=await env.BUCKET.get(await stateKey(url,env));if((sourceNow?.httpEtag||'"empty"')!==c.sourceTag)throw fail('Расписание изменилось во время назначения. Обновите страницу.',409);
      const storedChanges=structuredClone(next);delete storedChanges.staff;delete storedChanges.staffEtag;
      const stored=await env.BUCKET.put(c.key,JSON.stringify(storedChanges),{httpMetadata:{contentType:'application/json'},onlyIf:c.object?{etagMatches:c.object.etag}:{etagDoesNotMatch:'*'}});
      if(!stored)throw fail('Другой ответственный изменил замены. Обновите список и повторите действие.',409);
      return json({...next,scheduleEtag:c.sourceTag},200,{ETag:stored.httpEtag});
    }
    if(request.method==='PUT'&&path==='state'){
      const parsed=await readJson(request),key=await stateKey(url,env);
      // Hosting compression may turn the response ETag into a weak ETag.
      // The R2 conditional write below still compares the strong storage tag.
      const next=validateState(parsed),current=await env.BUCKET.get(key),expected=(request.headers.get('if-match')||'').replace(/^W\//,'');
      if(expected!==(current?.httpEtag||'"empty"'))throw fail('Расписание уже изменилось в другом окне. Скачайте резервную копию черновика, обновите страницу и повторите изменения.',409);
      await checkDocuments(next,env);
      const stored=await env.BUCKET.put(key,JSON.stringify(next),{httpMetadata:{contentType:'application/json'},onlyIf:current?{etagMatches:current.etag}:{etagDoesNotMatch:'*'}});
      if(!stored)throw fail('Другой администратор успел опубликовать изменения. Обновите страницу.',409);
      return json(next,200,{ETag:stored.httpEtag});
    }
    if(request.method==='POST'&&path==='schedules'){
      const raw=await readJson(request),name=text(raw.name,100,true),next=validateState(raw.state);
      if(name.toLocaleLowerCase('ru')==='актуальное')throw fail('Название «Актуальное» уже занято.');
      await checkDocuments(next,env);
      const entry={id:crypto.randomUUID(),name,createdAt:new Date().toISOString()};
      await env.BUCKET.put('school/schedules/'+entry.id+'.json',JSON.stringify(next),{httpMetadata:{contentType:'application/json'}});
      for(let attempt=0;attempt<3;attempt++){
        const {object,entries}=await catalog(env);
        if(entries.length>=30)throw fail('Можно сохранить до 30 отдельных расписаний.');
        if(entries.some(e=>e.name.toLocaleLowerCase('ru')===name.toLocaleLowerCase('ru')))throw fail('Такое название уже есть. Укажите другое.');
        const stored=await env.BUCKET.put(CATALOG_KEY,JSON.stringify([...entries,entry]),{httpMetadata:{contentType:'application/json'},onlyIf:object?{etagMatches:object.etag}:{etagDoesNotMatch:'*'}});
        if(stored)return json(entry,201);
      }
      throw fail('Список файлов изменился в другом окне. Повторите сохранение.',409);
    }
    if(request.method==='POST'&&path==='upload'){
      if(Number(request.headers.get('content-length'))>MAX_PDF+65536)throw fail('Размер PDF должен быть не больше 20 МБ.',413);
      const form=await request.formData(),file=form.get('file');
      if(!file||typeof file==='string'||!file.size||file.size>MAX_PDF)throw fail('Выберите PDF размером до 20 МБ.');
      const name=text(file.name,180,true),cl=text(form.get('class')||'',40);
      if(!/\.pdf$/i.test(name)||await file.slice(0,5).text()!=='%PDF-')throw fail('Файл не является PDF.');
      const id=crypto.randomUUID();
      await env.BUCKET.put('pdf/'+id,file.stream(),{httpMetadata:{contentType:'application/pdf'},customMetadata:{name}});
      return json({id,name,class:cl,size:file.size},201);
    }
    throw fail('Адрес не найден.',404);
  }catch(e){if(!e.status)console.error('School API:',e);return json({error:e.status?e.message:'Не удалось выполнить запрос. Попробуйте ещё раз.'},e.status||500);}
}
export async function handleApi(request,env){
  const url=new URL(request.url),origin=request.headers.get('origin'),allowed=allowedOrigin(origin,url);
  if(request.method==='OPTIONS'){
    if(!origin||!allowed)return json({error:'Этот адрес сайта не разрешён.'},403);
    return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET, POST, PUT, OPTIONS','Access-Control-Allow-Headers':'Content-Type, X-School-Admin-Key, If-Match','Access-Control-Max-Age':'600','Vary':'Origin'}});
  }
  const response=await handleRequest(request,env);
  if(origin&&allowed){response.headers.set('Access-Control-Allow-Origin',origin);response.headers.set('Access-Control-Expose-Headers','ETag');response.headers.set('Vary','Origin');}
  return response;
}
