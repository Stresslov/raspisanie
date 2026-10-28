// The existing API and replacement rules run against a GitHub-backed store.
// This module never contacts the previous hosting service.
import {handleApi} from './school-api.js';
import {parseBrowserPdf} from './browser-pdf.js';
import {prepareMeshExport} from './mesh-export.js';

const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const clone=value=>structuredClone(value);
const encode=bytes=>{let text='';for(let i=0;i<bytes.length;i+=16384)text+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(text);};
const decode=text=>Uint8Array.from(atob(text.replace(/\s/g,'')),c=>c.charCodeAt(0));
const textBytes=value=>new TextEncoder().encode(value);
const tag=()=>crypto.randomUUID().replaceAll('-','');

function validateSnapshot(data){
  if(!data||data.format!==1||!data.records||typeof data.records!=='object'||Array.isArray(data.records)||data.records['school/state.json']?.kind!=='json')throw fail('Файл данных GitHub повреждён или имеет неизвестный формат.',502);
  return data;
}

class RepositoryBucket{
  constructor(snapshot,pending,readPdf){this.snapshot=clone(snapshot);this.pending=pending;this.readPdf=readPdf;this.changed=false;}
  record(key){return this.snapshot.records[key]||this.pending.get(key)?.record;}
  metadata(record){return {etag:record.etag,httpEtag:'"'+record.etag+'"',size:record.kind==='json'?textBytes(JSON.stringify(record.value)).length:record.size,customMetadata:record.customMetadata};}
  async head(key){const record=this.record(key);return record?this.metadata(record):null;}
  async get(key){
    const record=this.record(key);if(!record)return null;
    const bytes=record.kind==='json'?textBytes(JSON.stringify(record.value)):this.pending.get(key)?.bytes||await this.readPdf(key);
    return {...this.metadata(record),json:async()=>clone(record.value),body:new Response(bytes).body};
  }
  async put(key,value,{onlyIf,customMetadata}={}){
    const old=this.record(key);if(onlyIf?.etagMatches&&old?.etag!==onlyIf.etagMatches||onlyIf?.etagDoesNotMatch==='*'&&old)return null;
    const etag=tag();
    if(key.startsWith('pdf/')){
      const bytes=new Uint8Array(await new Response(value).arrayBuffer()),record={kind:'pdf',etag,size:bytes.length,customMetadata};
      this.pending.set(key,{bytes,record});return this.metadata(record);
    }
    const record={kind:'json',etag,value:typeof value==='string'?JSON.parse(value):clone(value)};
    this.snapshot.records[key]=record;this.changed=true;return this.metadata(record);
  }
}

export function createGitHubApi({config,baseUrl,fetcher=(...args)=>fetch(...args),importPdf=parseBrowserPdf}){
  const {owner,repo,branch='main',dataPath='data/school.json'}=config;
  if(!/^[\w-]+$/.test(owner)||!/^[\w.-]+$/.test(repo)||!branch||dataPath!=='data/school.json')throw new Error('Неверные настройки репозитория GitHub.');
  const root=new URL(baseUrl),repository=`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,pending=new Map();
  let queue=Promise.resolve(),publicCache=null,publicPending=null;
  const contentUrl=path=>repository+'/contents/'+path.split('/').map(encodeURIComponent).join('/')+'?ref='+encodeURIComponent(branch);
  function headers(token,raw=false){return {'Accept':raw?'application/vnd.github.raw+json':'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10','Authorization':'Bearer '+token};}
  async function gitFetch(url,token,options={}){
    const response=await fetcher(url,{...options,headers:{...headers(token),...options.headers},cache:'no-store',credentials:'omit',redirect:'error'});
    if(!response.ok){
      if(response.status===401)throw fail('Ключ GitHub неверный или истёк. Создайте новый ключ доступа.',401);
      if(response.status===403)throw fail('GitHub запретил действие. Проверьте доступ к raspisanie, Contents: Read and write и лимит запросов.',403);
      if(response.status===409||response.status===422)throw fail('Данные в GitHub изменились или запись запрещена правилами ветки. Обновите список и повторите действие; черновик сохранён во вкладке.',409);
      if(response.status===404)throw fail('Файл или репозиторий не найден. Проверьте доступ ключа и загрузку папки data в GitHub.',404);
      throw fail('GitHub временно недоступен. Повторите действие позже.',502);
    }
    return response;
  }
  async function verifyToken(token){
    if(!token||token.length>200)throw fail('Введите ключ доступа GitHub к репозиторию raspisanie.',401);
    const response=await gitFetch(repository,token),info=await response.json();
    if(!info.permissions?.push)throw fail('У этого аккаунта нет прав изменения репозитория raspisanie.',403);
  }
  async function readRepository(token){
    const response=await gitFetch(contentUrl(dataPath),token),meta=await response.json();
    let bytes;
    if(meta.encoding==='base64')bytes=decode(meta.content);
    else{
      bytes=new Uint8Array(await (await gitFetch(contentUrl(dataPath),token,{headers:headers(token,true)})).arrayBuffer());
      const prefix=textBytes('blob '+bytes.length+'\0'),blob=new Uint8Array(prefix.length+bytes.length);blob.set(prefix);blob.set(bytes,prefix.length);
      const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-1',blob))].map(b=>b.toString(16).padStart(2,'0')).join('');
      if(digest!==meta.sha)throw fail('Файл изменился во время загрузки. Повторите действие.',409);
    }
    if(!meta.sha)throw fail('GitHub не вернул версию файла. Повторите действие.',502);
    return {snapshot:validateSnapshot(JSON.parse(new TextDecoder().decode(bytes))),sha:meta.sha};
  }
  async function readPublic(){
    if(publicCache&&Date.now()-publicCache.at<750)return clone(publicCache.snapshot);
    if(!publicPending)publicPending=(async()=>{
      const url=new URL(dataPath,root);url.searchParams.set('v',String(Date.now()));
      const response=await fetcher(url.href,{cache:'no-store',credentials:'omit'});
      if(!response.ok)throw fail(response.status===404?'Файл data/school.json ещё не загружен в GitHub. Загрузите index.html и папку data из архива.':'Не удалось загрузить данные с GitHub Pages. Повторите попытку.',response.status===404?404:502);
      const snapshot=validateSnapshot(await response.json());publicCache={at:Date.now(),snapshot};return snapshot;
    })().finally(()=>{publicPending=null;});
    return clone(await publicPending);
  }
  async function writeFile(path,bytes,token,sha,message){
    return gitFetch(repository+'/contents/'+path.split('/').map(encodeURIComponent).join('/'),token,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({message,content:encode(bytes),branch,...(sha?{sha}:{})})});
  }
  async function commit(bucket,sha,token,path){
    const referenced=new Set();
    for(const [key,record] of Object.entries(bucket.snapshot.records))if((key==='school/state.json'||key.startsWith('school/schedules/'))&&record.kind==='json')for(const doc of record.value.documents||[])referenced.add('pdf/'+doc.id);
    for(const key of referenced){
      const file=pending.get(key);if(!file||bucket.snapshot.records[key])continue;
      if(!file.uploaded){await writeFile('data/'+key+'.pdf',file.bytes,token,null,'Добавить PDF расписания');file.uploaded=true;}
      bucket.snapshot.records[key]=file.record;
    }
    bucket.snapshot.updatedAt=new Date().toISOString();
    await writeFile(dataPath,textBytes(JSON.stringify(bucket.snapshot)),token,sha,path==='changes'?'Обновить замены уроков':path==='changes/staff'?'Обновить сотрудников для замен':'Обновить расписание школы');
    for(const key of referenced)if(bucket.snapshot.records[key])pending.delete(key);
    publicCache=null;
  }
  async function dispatch(request){
    try{
      const url=new URL(request.url),prefix=new URL('api/',root).pathname;
      if(url.origin!==root.origin||!url.pathname.startsWith(prefix))throw fail('Неизвестный адрес данных.',404);
      const path=url.pathname.slice(prefix.length),token=request.headers.get('x-school-admin-key')||'',write=['PUT','POST'].includes(request.method),protectedRoute=write||['admin','changes/admin','changes/candidates'].includes(path)||path.startsWith('mesh/');
      if(protectedRoute)await verifyToken(token);
      const {snapshot,sha}=token?await readRepository(token):{snapshot:await readPublic(),sha:null};
      const bucket=new RepositoryBucket(snapshot,pending,async key=>{
        const response=await fetcher(new URL('data/'+key+'.pdf',root).href,{cache:'no-store',credentials:'omit'});
        if(!response.ok)throw fail('Документ пока не опубликован GitHub Pages. Повторите попытку позже.',404);
        return new Uint8Array(await response.arrayBuffer());
      });
      if(path==='pdf-import'&&request.method==='POST'){
        const form=await request.formData(),file=form.get('file'),settings={classOverride:String(form.get('classOverride')||'').trim(),campus:String(form.get('campus')||'').trim()};
        let result;try{result=await importPdf(file,settings,{onProgress:(page,pages)=>{if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('school-pdf-progress',{detail:{page,pages}}));}});}catch(error){throw fail(error.message||'Не удалось распознать PDF. Проверьте файл.');}
        const id=crypto.randomUUID(),document={id,name:String(file.name||'Расписание.pdf').slice(0,180),class:settings.classOverride,size:file.size};
        await bucket.put('pdf/'+id,file.stream(),{customMetadata:{name:document.name,createdAt:new Date().toISOString()}});return json({...result,document});
      }
      if(path.startsWith('mesh/')){
        if(path==='mesh/send')throw fail('Прямая передача в МЭШ ещё не подключена. Нужны официальный способ интеграции и доступ школы. Данные не отправлены.',501);
        if(request.method!=='GET')throw fail('Метод не поддерживается.',405);
        if(path==='mesh/status')return json({configured:false,message:'Доступны подготовка и выгрузка. Для прямой отправки нужны официальная документация интеграции МЭШ и доступ школы.'});
        if(!['mesh/preview','mesh/export'].includes(path))throw fail('Неизвестный адрес данных.',404);
        const schedule=url.searchParams.get('schedule')||'current',changes=await handleApi(new Request('https://school.internal/api/changes?schedule='+encodeURIComponent(schedule),{headers:request.headers}),{BUCKET:bucket,ADMIN_TOKEN:token});
        if(!changes.ok)return changes;
        const bundle=prepareMeshExport(await changes.json(),schedule,url.searchParams.get('from')||'',url.searchParams.get('to')||'');
        if(path==='mesh/export'&&!bundle.canExport)throw fail('Сначала назначьте все замены и устраните изменённые исходные уроки.',409);
        return json(bundle);
      }
      const response=await handleApi(new Request('https://school.internal/api/'+path+url.search,{method:request.method,headers:request.headers,body:write?await request.arrayBuffer():undefined}),{BUCKET:bucket,ADMIN_TOKEN:token||undefined});
      if(response.ok&&write&&bucket.changed)await commit(bucket,sha,token,path);
      return response;
    }catch(error){return json({error:error.status?error.message:'Не удалось связаться с GitHub. Проверьте соединение и повторите попытку.'},error.status||502);}
  }
  return {request(request){if(['POST','PUT'].includes(request.method)){const result=queue.then(()=>dispatch(request));queue=result.then(()=>{},()=>{});return result;}return dispatch(request);}};
}
