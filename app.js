import {renderDayGrid,renderWeekGrid} from './calendar.js';
import {FIELDS,guessMapping,readTable,rowsToLessons,templateCsv} from './import.js';
import {isoDay,addDays,monday,weekday,entityLessonsFor,entityOptions,classNames,emptyState} from './schedule.js';
const $=s=>document.querySelector(s),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let state=emptyState(),revision='',page='schedule',view='day',day=isoDay(),selectedClass='',adminKey='',draft=null,preview=false,workbook=[],sheetIndex=0,mapping={},pendingLessons=null,pendingName='',saving=false,readFailed=false;
const API_BASE=globalThis.SCHOOL_API_BASE||new URL('./api/',location.href).href;
const MODE={class:{label:'Класс',prompt:'Выберите класс',search:'Поиск класса'},teacher:{label:'Учитель',prompt:'Выберите учителя',search:'Поиск по фамилии'},room:{label:'Кабинет',prompt:'Выберите кабинет',search:'Поиск кабинета'}};
let mode=['teacher','room'].find(m=>new URLSearchParams(location.search).has(m))||'class',entityInitialized=false;
const data=()=>preview&&draft?draft:state;
let selectedSchedule=new URLSearchParams(location.search).get('schedule')||'current',schedules=[{id:'current',name:'Актуальное'}],manage='edit',pickerOpen=false,pickerIndex=-1,pickerMatches=[];
const savedDrafts=new Map();
const statePath=()=> 'state?schedule='+encodeURIComponent(selectedSchedule);
const draftPdfUrls=new Map();
function docUrl(doc){return draftPdfUrls.get(doc.id)||API_BASE+'files/'+encodeURIComponent(doc.id);}
const format=(d,options)=>new Intl.DateTimeFormat('ru-RU',{...options,timeZone:'UTC'}).format(new Date(d+'T12:00:00Z'));
let toastTimer;
function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,4200);}
function error(message){$('#notice').textContent=message;$('#notice').hidden=false;$('#notice').className='notice error';}
function storageGet(key){try{return localStorage.getItem(key)||'';}catch{return '';}}
function storageSet(key,value){try{value?localStorage.setItem(key,value):localStorage.removeItem(key);}catch{toast('Браузер не разрешил сохранить выбор класса.');}}
function download(name,content,type){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
async function copy(text){try{await navigator.clipboard.writeText(text);toast('Ссылка скопирована');}catch{window.prompt('Скопируйте ссылку:',text);}}
function classUrl(){const url=new URL(location.href);url.hash='';url.search='';if(selectedClass)url.searchParams.set(mode,selectedClass);if(selectedSchedule!=='current')url.searchParams.set('schedule',selectedSchedule);return url.href;}
function updateUrl(){const url=new URL(location.href);['class','teacher','room'].forEach(k=>url.searchParams.delete(k));if(selectedClass)url.searchParams.set(mode,selectedClass);selectedSchedule==='current'?url.searchParams.delete('schedule'):url.searchParams.set('schedule',selectedSchedule);history.replaceState(null,'',url);}
async function api(path,options={}){
  const headers=new Headers(options.headers);if(adminKey)headers.set('x-school-admin-key',adminKey);
  const response=await fetch(API_BASE+path,{...options,headers,cache:'no-store'});
  let result;try{result=await response.json();}catch{throw new Error('Сервер не вернул данные. Проверьте соединение.');}
  if(!response.ok)throw new Error(result.error||`Ошибка сервера (${response.status}).`);
  return {result,response};
}
async function load(){
  try{const {result,response}=await api(statePath());state=result;revision=response.headers.get('etag')||'';readFailed=false;renderAll();return true;}
  catch(e){readFailed=true;error('Не удалось получить актуальное расписание. '+e.message);renderSchedule();return false;}
}
function empty(title,text,action=''){return `<div class="empty"><div class="empty-icon" aria-hidden="true">▦</div><h2>${esc(title)}</h2><p>${esc(text)}</p>${action}</div>`;}
function renderAll(){
  const d=data();
  if(!entityInitialized){selectedClass=new URLSearchParams(location.search).get(mode)||storageGet('dmitrovsky-'+mode);entityInitialized=true;}
  renderPicker();
  if(d.updatedAt){$('#updated').textContent='Обновлено '+new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Moscow'}).format(new Date(d.updatedAt))+' МСК';$('#updated').classList.add('live');}else{$('#updated').textContent='Расписание ещё не загружено';$('#updated').classList.remove('live');}
  if(!readFailed){$('#notice').className='notice preview-note';$('#notice').textContent=preview?'Предпросмотр: эти изменения видите только вы. Чтобы их увидели все, вернитесь в управление и нажмите «Опубликовать».':'';$('#notice').hidden=!preview;}
  renderSchedule();renderDocuments();renderBells();
}
function renderPicker(){const cfg=MODE[mode];$('#entity-label').textContent=cfg.label;$('#entity-search').placeholder=cfg.prompt;if(!pickerOpen)$('#entity-search').value=selectedClass;document.querySelectorAll('[data-mode]').forEach(b=>{b.classList.toggle('selected',b.dataset.mode===mode);b.setAttribute('aria-pressed',String(b.dataset.mode===mode));});if(pickerOpen)renderOptions();}
function renderOptions(query=''){const normalize=v=>v.toLocaleLowerCase('ru').replace(/ё/g,'е');pickerMatches=entityOptions(data(),mode).filter(v=>normalize(v).includes(normalize(query)));pickerIndex=-1;$('#entity-options').innerHTML=pickerMatches.length?pickerMatches.map((v,i)=>`<button role="option" id="entity-option-${i}" data-entity="${esc(v)}" aria-selected="${v===selectedClass}">${esc(v)}</button>`).join(''):'<div class="no-options">Ничего не найдено</div>';$('#entity-search').removeAttribute('aria-activedescendant');}
function openPicker(){pickerOpen=true;$('#entity-options').hidden=false;$('#entity-search').setAttribute('aria-expanded','true');$('#entity-toggle').setAttribute('aria-expanded','true');renderOptions();}
function closePicker(){pickerOpen=false;$('#entity-options').hidden=true;$('#entity-search').setAttribute('aria-expanded','false');$('#entity-toggle').setAttribute('aria-expanded','false');$('#entity-search').removeAttribute('aria-activedescendant');$('#entity-search').value=selectedClass;}
function chooseEntity(value){selectedClass=value;storageSet('dmitrovsky-'+mode,value);$('#entity-search').focus();closePicker();updateUrl();renderSchedule();}
async function loadSchedules(){const {result}=await api('schedules');schedules=result;$('#schedule-select').innerHTML=schedules.map(s=>`<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');$('#schedule-select').value=selectedSchedule;}
async function switchSchedule(id){saveDraftFields();if(draft)savedDrafts.set(selectedSchedule,{draft,revision});const previous=selectedSchedule;selectedSchedule=id;draft=null;preview=false;workbook=[];pendingLessons=null;closePicker();$('#schedule-select').disabled=true;const loaded=await load();if(!loaded){selectedSchedule=previous;$('#schedule-select').value=previous;readFailed=false;renderAll();toast('Файл не загружен. Осталось предыдущее расписание.');}updateUrl();$('#schedule-select').disabled=false;if(adminKey){const cached=savedDrafts.get(selectedSchedule);draft=cached?.draft||structuredClone(state);if(cached)revision=cached.revision;renderAdmin();}}
async function saveNamed(){saveDraftFields();const name=$('#schedule-name').value.trim();if(!name){$('#admin-error').textContent='Введите название расписания.';return;}const button=$('#save-named');button.disabled=true;try{const {result}=await api('schedules',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,state:draft})});await loadSchedules();await switchSchedule(result.id);$('#schedule-select').value=result.id;toast('Отдельное расписание опубликовано. Актуальное сохранено.');}catch(e){$('#admin-error').textContent=e.message;}finally{if(button.isConnected)button.disabled=false;}}
function renderSchedule(){
  const start=monday(day),end=addDays(start,6);$('#week-range').textContent=`${format(start,{day:'numeric',month:'short'})} — ${format(end,{day:'numeric',month:'short'})}`;
  $('#days').innerHTML=Array.from({length:7},(_,i)=>{const date=addDays(start,i);return `<button class="day-button${date===day?' selected':''}${date===isoDay()?' today':''}" data-day="${date}" aria-pressed="${date===day}"><span class="weekday">${esc(format(date,{weekday:'short'}))}</span><strong>${Number(date.slice(-2))}</strong></button>`;}).join('');
  document.querySelectorAll('[data-view]').forEach(b=>{b.classList.toggle('selected',b.dataset.view===view);b.setAttribute('aria-pressed',String(b.dataset.view===view));});
  const d=data();let body='';
  if(readFailed){body=empty('Расписание временно недоступно','Не удалось загрузить актуальные данные. Попробуйте ещё раз.', '<button class="primary" id="retry-load">Повторить</button>');}
  else if(!d.lessons.length){body=empty('Здесь будет расписание',d.documents.length?'Расписание пока доступно в PDF. Откройте документы, чтобы посмотреть его.':'Администратор ещё не опубликовал расписание школы. После загрузки здесь появятся классы и уроки.',d.documents.length?'<button class="primary" data-page="documents">Открыть PDF →</button>':'');}
  else if(!selectedClass){body=empty(MODE[mode].prompt,'Нажмите на поле выбора и начните вводить класс, фамилию учителя или кабинет.');}
  else if(!entityOptions(d,mode).includes(selectedClass)){body=empty('Пока нет расписания','Проверьте выбор или дождитесь обновления.');}
  else {body=view==='week'?renderWeekGrid(d,mode,selectedClass,day,format):renderDayGrid(d,mode,selectedClass,day,format);}
  $('#days').hidden=view==='week';$('#lessons').className=view==='week'?'week-mode':'';$('#lessons').innerHTML=body;
}
function renderDocuments(){const docs=data().documents;$('#documents-list').innerHTML=docs.length?docs.map(doc=>`<article class="document-card"><span class="file-icon">PDF</span><h2>${esc(doc.name)}</h2><p>${esc(doc.class?'Класс '+doc.class:'Все классы')} · ${Math.max(1,Math.round(doc.size/1024))} КБ</p><div class="actions"><button class="primary" data-pdf="${esc(doc.id)}">Открыть</button><a class="secondary" href="${esc(docUrl(doc))}${draftPdfUrls.has(doc.id)?'':'?download=1'}" download="${esc(doc.name)}">Скачать ↓</a></div></article>`).join(''):empty('Документов пока нет','Здесь появятся PDF-файлы расписания после публикации.');}
function renderBells(){const items=data().lessons.filter(l=>l.start&&l.end),unique=new Map();for(const l of items){const k=[l.slot,l.start,l.end].join('|');if(!unique.has(k))unique.set(k,l);}$('#bell-list').innerHTML=unique.size?[...unique.values()].sort((a,b)=>a.slot-b.slot||a.start.localeCompare(b.start)).map(l=>`<div class="bell-row"><span>${l.slot} урок</span><strong>${esc(l.start)} — ${esc(l.end)}</strong></div>`).join(''):'<p class="muted">Время звонков ещё не загружено.</p>';}
const titles={schedule:['Расписание школы','Найдите уроки класса, учителя или кабинета.','Расписание'],admin:['Управление расписанием','Файлы расписания, документы и звонки.','Управление']};
function renderManage(){document.querySelectorAll('[data-manage]').forEach(b=>b.classList.toggle('selected',b.dataset.manage===manage));$('#admin-content').hidden=manage!=='edit';$('#management-documents').hidden=manage!=='documents';$('#management-bells').hidden=manage!=='bells';}
function showPage(next){if(next==='documents'||next==='bells'){manage=next;next='admin';}page=titles[next]?next:'schedule';Object.keys(titles).forEach(p=>$('#'+p+'-page').hidden=p!==page);document.querySelectorAll('.nav-item').forEach(b=>{b.classList.toggle('active',b.dataset.page===page);b.dataset.page===page?b.setAttribute('aria-current','page'):b.removeAttribute('aria-current');});const [title,sub,crumb]=titles[page];$('#page-title').textContent=title;$('#page-subtitle').textContent=sub;$('#crumb').textContent=crumb;if(page==='admin'){renderAdmin();renderManage();}location.hash=page==='schedule'?'':page;window.scrollTo({top:0,behavior:'instant'});}
function renderAdmin(){
  const host=$('#admin-content');
  if(!adminKey){host.innerHTML=`<section class="panel" style="max-width:470px"><h2>Вход для администратора</h2><p class="muted">Ученикам и родителям вход не нужен. Пароль требуется только для изменения расписания.</p><form id="login-form"><label class="field">Пароль администратора<input id="admin-password" type="password" autocomplete="current-password" required></label><button class="primary" type="submit">Войти</button><p id="login-error" class="inline-error" role="alert"></p></form></section>`;return;}
  if(!draft)draft=structuredClone(state);
  const classes=classNames(draft);
  host.innerHTML=`<div class="panel"><div class="version-row"><span class="status-tag">Вы вошли как администратор</span><span class="muted">${draft.lessons.length} уроков · ${classes.length} классов · ${draft.documents.length} PDF</span><button id="logout" class="text-btn">Выйти</button></div><div class="draft-banner">Загрузка файла создаёт черновик. Изменения станут доступны всем только после публикации.</div><div class="actions"><button id="publish" class="primary" ${saving?'disabled':''}>${saving?'Публикуем…':'Опубликовать для всех'}</button><button id="preview" class="secondary">Предпросмотр</button><button id="discard" class="secondary">Сбросить черновик</button><button id="backup" class="secondary">Скачать резервную копию</button></div><p id="admin-error" class="inline-error" role="alert"></p></div><section class="panel"><h2>Отдельный файл расписания</h2><p class="muted">Сохраните черновик под своим названием. Он появится в списке файлов сверху; остальные расписания сохранятся.</p><label class="field">Название<input id="schedule-name" maxlength="100" placeholder="Например, С 2 ноября" value="${esc(pendingName.replace(/\.[^.]+$/,''))}"></label><button id="save-named" class="secondary">Сохранить и опубликовать отдельно</button></section><div class="admin-grid"><div><section class="panel"><h2>Таблица Excel или CSV</h2><p class="muted">Одна строка — один урок. Можно загрузить сразу все классы. Новый импорт заменяет всю таблицу уроков; PDF сохраняются.</p><label class="drop-zone">↑ Выберите файл Excel / CSV<input id="table-file" type="file" accept=".xlsx,.csv"><small>XLSX или CSV · до 10 МБ</small></label><div class="actions"><button class="secondary" id="template">Скачать пример CSV</button><button class="secondary" id="template-xlsx">Скачать пример Excel</button></div><div id="import-panel"></div></section><section class="panel"><h2>Документы PDF</h2><p class="muted">PDF отображается целиком, без автоматического распознавания уроков.</p><label class="field">Для какого класса<input id="pdf-class" placeholder="Например, 7А. Пусто — для всей школы" maxlength="40"></label><label class="drop-zone">↑ Добавить PDF<input id="pdf-file" type="file" accept=".pdf,application/pdf"><small>До 20 МБ на документ</small></label><div id="draft-docs">${draft.documents.map(d=>`<div class="bell-row"><span style="flex:1;overflow-wrap:anywhere">${esc(d.name)}</span><button class="danger" data-remove-doc="${esc(d.id)}">Убрать</button></div>`).join('')}</div></section></div><div><section class="panel"><h2>Период расписания</h2><label class="field">Действует с<input id="valid-from" type="date" value="${esc(draft.validFrom)}"></label><label class="field">Действует до<input id="valid-to" type="date" value="${esc(draft.validTo)}"></label><p class="muted">Без дат таблица повторяется каждую неделю. Столбец «Дата замены» заменяет отдельный урок только в указанную дату.</p></section><section class="panel"><h2>Как подготовить файл</h2><ol class="help-list"><li>Скачайте пример Excel или CSV.</li><li>Заполните классы, дни недели, номера уроков и предметы.</li><li>Время, кабинеты и учителей можно оставить пустыми.</li><li>Загрузите таблицу и сопоставьте столбцы.</li><li>Проверьте предпросмотр и опубликуйте.</li></ol><p class="muted">Таблицы с объединёнными ячейками и отдельными блоками классов нужно привести к примеру. PDF можно загрузить как есть.</p></section></div></div>`;
  if(workbook.length)renderImport();
}
function saveDraftFields(){if(!adminKey||!draft)return;for(const [id,key] of [['valid-from','validFrom'],['valid-to','validTo'],['school-notice','notice']])if($('#'+id))draft[key]=$('#'+id).value;}
function renderImport(){
  const sheet=workbook[sheetIndex],headers=sheet.rows[0]||[],panel=$('#import-panel');if(!panel)return;
  panel.innerHTML=`<label class="field">Лист Excel<select id="sheet-select">${workbook.map((s,i)=>`<option value="${i}"${i===sheetIndex?' selected':''}>${esc(s.name)}</option>`).join('')}</select></label><p class="muted">Первая заполненная строка должна содержать заголовки. Укажите, какие столбцы использовать.</p><div class="mapping">${FIELDS.map(([key,label,required])=>`<label class="field">${label}${required?' *':''}<select data-map="${key}"><option value="-1">Не использовать</option>${headers.map((h,i)=>`<option value="${i}"${mapping[key]===i?' selected':''}>${esc(h||'Столбец '+(i+1))}</option>`).join('')}</select></label>`).join('')}</div><button id="check-import" class="secondary">Проверить таблицу</button><div id="import-result"></div>`;
}
function checkImport(){
  pendingLessons=null;const el=$('#import-result');
  try{pendingLessons=rowsToLessons(workbook[sheetIndex].rows.slice(1),mapping);el.innerHTML=`<p class="muted">Готово: ${pendingLessons.length} уроков, ${new Set(pendingLessons.map(l=>l.class)).size} классов. Ниже первые 10 строк.</p><div class="table-wrap"><table><thead><tr><th>Класс</th><th>День</th><th>Урок</th><th>Предмет</th><th>Время</th><th>Каб.</th></tr></thead><tbody>${pendingLessons.slice(0,10).map(l=>`<tr><td>${esc(l.class)}</td><td>${l.weekday}</td><td>${l.slot}</td><td>${esc(l.subject)}</td><td>${esc(l.start)}${l.end?'–'+esc(l.end):''}</td><td>${esc(l.room)}</td></tr>`).join('')}</tbody></table></div><button id="apply-import" class="primary">Добавить в черновик</button>`;}
  catch(e){el.innerHTML=`<p class="inline-error" role="alert">${esc(e.message)}</p>`;}
}
async function publish(){
  saveDraftFields();if(draft.validFrom&&draft.validTo&&draft.validFrom>draft.validTo){$('#admin-error').textContent='Дата окончания раньше даты начала.';return;}
  saving=true;$('#publish').disabled=true;$('#publish').textContent='Публикуем…';
  try{const {result,response}=await api(statePath(),{method:'PUT',headers:{'Content-Type':'application/json','If-Match':revision},body:JSON.stringify(draft)});state=result;revision=response.headers.get('etag')||'';draft=structuredClone(state);preview=false;readFailed=false;renderAll();renderAdmin();toast('Опубликовано! Обновление доступно всем по ссылке.');}
  catch(e){$('#admin-error').textContent=e.message;}
  finally{saving=false;if($('#publish')){$('#publish').disabled=false;$('#publish').textContent='Опубликовать для всех';}}
}
async function uploadPdf(file){
  if(!file)return;if(file.size>20*1024*1024)throw new Error('PDF больше 20 МБ. Уменьшите размер файла.');
  const cl=$('#pdf-class').value.trim().replace(/\s+/g,'').toUpperCase();const input=$('#pdf-file');input.disabled=true;toast('Загружаем PDF…');
  try{const form=new FormData();form.append('file',file);form.append('class',cl);const {result}=await api('upload',{method:'POST',body:form});saveDraftFields();draftPdfUrls.set(result.id,URL.createObjectURL(file));draft.documents.push(result);renderAdmin();toast('PDF добавлен в черновик. Нажмите «Опубликовать для всех».');}
  finally{if(input.isConnected)input.disabled=false;}
}
async function openPdf(id){const doc=(draft||data()).documents.find(d=>d.id===id);if(!doc)return;$('#pdf-title').textContent=doc.name;$('#pdf-frame').src=docUrl(doc);$('#pdf-download').href=docUrl(doc)+(draftPdfUrls.has(id)?'':'?download=1');$('#pdf-download').download=doc.name;$('#pdf-dialog').showModal();}
document.addEventListener('click',async e=>{
  const b=e.target.closest('button,[data-page]');if(!b)return;
  if(b.dataset.lesson){const l=JSON.parse(b.dataset.lesson);$('#lesson-details').innerHTML=`<h2>${esc(l.subject)}</h2><dl>${[['Класс',(l.classes||[l.class]).join(', ')],['Подгруппа',(l.subgroups||[]).join(', ')],['Учитель',l.teacher||'Не указан'],['Кабинет',l.room||'Не указан'],['Время',l.start?l.start+'–'+l.end:'Не указано'],['Примечание',l.notes]].filter(([,v])=>v).map(([k,v])=>`<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;$('#lesson-dialog').showModal();return;}
  if(b.dataset.entity){chooseEntity(b.dataset.entity);return;}
  if(b.dataset.manage){manage=b.dataset.manage;renderManage();return;}
  if(b.dataset.page){showPage(b.dataset.page);return;}
  if(b.dataset.mode){mode=b.dataset.mode;selectedClass=storageGet('dmitrovsky-'+mode);closePicker();entityInitialized=true;updateUrl();renderAll();return;}
  if(b.dataset.day){day=b.dataset.day;renderSchedule();return;}
  if(b.dataset.view){view=b.dataset.view;renderSchedule();return;}
  if(b.dataset.pdf){openPdf(b.dataset.pdf);return;}
  if(b.dataset.removeDoc){saveDraftFields();draft.documents=draft.documents.filter(d=>d.id!==b.dataset.removeDoc);renderAdmin();return;}
  switch(b.id){
    case 'share':if(navigator.share){try{await navigator.share({title:'Расписание · Школа Дмитровский',url:classUrl()});}catch(err){if(err.name!=='AbortError')await copy(classUrl());}}else await copy(classUrl());break;
    case 'copy-class':await copy(classUrl());break;
    case 'entity-toggle':if(pickerOpen)closePicker();else{openPicker();$('#entity-search').focus();$('#entity-search').select();}break;
    case 'save-named':await saveNamed();break;
    case 'lesson-close':$('#lesson-dialog').close();break;
    case 'prev-week':day=addDays(day,-7);renderSchedule();break;
    case 'next-week':day=addDays(day,7);renderSchedule();break;
    case 'today':day=isoDay();renderSchedule();break;
    case 'retry-load':await load();break;
    case 'pdf-close':$('#pdf-dialog').close();$('#pdf-frame').src='about:blank';break;
    case 'logout':adminKey='';draft=null;savedDrafts.clear();preview=false;workbook=[];pendingLessons=null;renderAll();renderAdmin();break;
    case 'discard':draft=structuredClone(state);workbook=[];pendingLessons=null;preview=false;renderAll();renderAdmin();toast('Черновик сброшен');break;
    case 'preview':saveDraftFields();preview=true;const options=entityOptions(draft,mode);if(!options.includes(selectedClass))selectedClass=options[0]||'';renderAll();showPage('schedule');break;
    case 'publish':await publish();break;
    case 'template':download('Пример расписания.csv',templateCsv,'text/csv;charset=utf-8');break;
    case 'template-xlsx':location.href='./template.xlsx';break;
    case 'check-import':checkImport();break;
    case 'apply-import':if(pendingLessons){saveDraftFields();draft.lessons=pendingLessons;workbook=[];pendingLessons=null;renderAdmin();toast('Уроки добавлены в черновик. Проверьте предпросмотр.');}break;
    case 'backup':saveDraftFields();download('Резервная копия расписания.json',JSON.stringify(draft,null,2),'application/json');break;
  }
});
document.addEventListener('change',async e=>{
  const el=e.target;
  if(el.id==='schedule-select')await switchSchedule(el.value);
  if(el.dataset.map){mapping[el.dataset.map]=Number(el.value);pendingLessons=null;$('#import-result').innerHTML='';}
  if(el.id==='sheet-select'){sheetIndex=Number(el.value);mapping=guessMapping(workbook[sheetIndex].rows[0]);pendingLessons=null;renderImport();}
  if(['valid-from','valid-to','school-notice'].includes(el.id))saveDraftFields();
  if(el.id==='table-file'){
    const file=el.files[0];if(!file)return;
    try{if(file.size>10*1024*1024)throw new Error('Таблица больше 10 МБ.');workbook=await readTable(file);sheetIndex=0;pendingName=file.name;mapping=guessMapping(workbook[0].rows[0]);pendingLessons=null;renderImport();}
    catch(err){toast(err.message);el.value='';}
  }
  if(el.id==='pdf-file')try{await uploadPdf(el.files[0]);}catch(err){toast(err.message);el.value='';}
});
$('#entity-search').addEventListener('focus',()=>{if(!pickerOpen){openPicker();$('#entity-search').select();}});
$('#entity-search').addEventListener('input',()=>{if(!pickerOpen)openPicker();renderOptions($('#entity-search').value);});
$('#entity-search').addEventListener('keydown',e=>{if(e.key==='Escape'){closePicker();return;}if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();if(!pickerOpen)openPicker();if(!pickerMatches.length)return;pickerIndex=(pickerIndex+(e.key==='ArrowDown'?1:-1)+pickerMatches.length)%pickerMatches.length;document.querySelectorAll('#entity-options [role=option]').forEach((b,i)=>b.classList.toggle('highlight',i===pickerIndex));const option=$('#entity-option-'+pickerIndex);$('#entity-search').setAttribute('aria-activedescendant',option.id);option.scrollIntoView({block:'nearest'});}if(e.key==='Enter'&&pickerOpen){e.preventDefault();if(pickerMatches.length)chooseEntity(pickerMatches[Math.max(0,pickerIndex)]);}});
document.addEventListener('click',e=>{if(pickerOpen&&!e.target.closest('.combobox'))closePicker();});
document.addEventListener('focusin',e=>{if(pickerOpen&&!e.target.closest('.combobox'))closePicker();});
document.addEventListener('submit',async e=>{
  if(e.target.id!=='login-form')return;e.preventDefault();const button=e.target.querySelector('button');button.disabled=true;adminKey=$('#admin-password').value;
  try{await api('admin');draft=structuredClone(state);renderAdmin();}
  catch(err){adminKey='';$('#login-error').textContent=err.message;button.disabled=false;}
});
$('#pdf-dialog').addEventListener('close',()=>$('#pdf-frame').src='about:blank');
window.addEventListener('hashchange',()=>{const p=location.hash.slice(1)||'schedule';if(titles[p]&&p!==page)showPage(p);});
showPage(titles[location.hash.slice(1)]?location.hash.slice(1):'schedule');
try{await loadSchedules();}catch(e){error('Не удалось загрузить список файлов. '+e.message);}
await load();
// Refresh shared state, while preserving an administrator's in-progress draft.
setInterval(()=>{if(!adminKey&&!document.hidden)load();},60000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!adminKey)load();});
