export const FIELDS = [
  ['class','Класс',true],['weekday','День недели',true],['slot','Номер урока',true],['subject','Предмет',true],
  ['start','Начало',false],['end','Конец',false],['room','Кабинет',false],['teacher','Учитель',false],['campus','Корпус',false],['subgroup','Подгруппа',false],['date','Дата замены',false],['notes','Примечание',false],
];
const ALIASES={class:['класс','class','группа'],weekday:['день','день недели','weekday','day'],slot:['урок','номер урока','номер','№','slot'],subject:['предмет','дисциплина','subject','занятие'],start:['начало','время начала','start'],end:['конец','окончание','время окончания','end'],room:['кабинет','каб','аудитория','room'],teacher:['учитель','фио учителя','преподаватель','teacher'],campus:['корпус','здание','campus'],subgroup:['подгруппа','subgroup'],date:['дата','дата замены','date'],notes:['примечание','notes']};
const strip=s=>String(s??'').trim().toLowerCase().replace(/\s+/g,' ');
export function guessMapping(headers){return Object.fromEntries(FIELDS.map(([k])=>[k,headers.findIndex(h=>ALIASES[k].includes(strip(h)))]));}
export function parseCsv(text){
  text=text.replace(/^\uFEFF/,'');
  const first=text.split(/\r?\n/)[0]||'';
  const counts=[';',',','\t'].map(d=>[d,(first.match(new RegExp(d==='\t'?'\t':d,'g'))||[]).length]);
  const delimiter=counts.sort((a,b)=>b[1]-a[1])[0][0];
  const rows=[];let row=[],cell='',quote=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(c==='"'){if(quote&&text[i+1]==='"'){cell+='"';i++;}else if(quote||cell==='')quote=!quote;else cell+=c;}
    else if(c===delimiter&&!quote){row.push(cell);cell='';}
    else if((c==='\n'||c==='\r')&&!quote){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(v=>v.trim()))rows.push(row);row=[];cell='';}
    else cell+=c;
  }
  if(quote)throw new Error('В CSV не закрыты кавычки. Пересохраните файл в Excel как CSV UTF-8.');
  row.push(cell);if(row.some(v=>v.trim()))rows.push(row);
  return rows;
}
const DAY_NAMES=[['пн','понедельник','mon','monday'],['вт','вторник','tue','tuesday'],['ср','среда','wed','wednesday'],['чт','четверг','thu','thursday'],['пт','пятница','fri','friday'],['сб','суббота','sat','saturday'],['вс','воскресенье','sun','sunday']];
function weekday(value){const s=strip(value).replace(/\.$/,'');if(/^[1-7]$/.test(s))return Number(s);const i=DAY_NAMES.findIndex(v=>v.includes(s));return i<0?null:i+1;}
function time(value){const s=String(value??'').trim();if(!s)return '';const m=s.match(/^(\d{1,2})[:.](\d{2})(?::\d{2})?$/);if(m&&+m[1]<24&&+m[2]<60)return `${m[1].padStart(2,'0')}:${m[2]}`;const n=Number(s);if(Number.isFinite(n)&&n>0&&n<1){const minutes=Math.round(n*1440);return `${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;}throw new Error(`Не получилось прочитать время «${s}». Используйте ЧЧ:ММ.`);}
function isoDate(value){const s=String(value??'').trim();if(!s)return '';let result=s;if(/^\d{4,5}$/.test(s)&&Number(s)>20000&&Number(s)<100000)result=new Date(Date.UTC(1899,11,30)+Number(s)*86400000).toISOString().slice(0,10);const m=s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);if(m)result=`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;if(!/^\d{4}-\d{2}-\d{2}$/.test(result)||!Number.isFinite(Date.parse(result+'T12:00:00Z'))||new Date(result+'T12:00:00Z').toISOString().slice(0,10)!==result)throw new Error(`Некорректная дата «${s}». Нужна ДД.ММ.ГГГГ или ГГГГ-ММ-ДД.`);return result;}
export function rowsToLessons(rows,mapping){
  const missing=FIELDS.filter(([k,,required])=>required&&!(mapping[k]>=0));
  if(missing.length)throw new Error('Выберите столбцы: '+missing.map(v=>v[1]).join(', ')+'.');
  if(rows.length>20000)throw new Error('Слишком много строк. Максимум — 20 000 уроков.');
  const result=[],seen=new Set();
  for(let i=0;i<rows.length;i++){
    const row=rows[i];if(!row.some(v=>String(v??'').trim()))continue;
    const get=k=>mapping[k]>=0?String(row[mapping[k]]??'').trim():'';
    try{
      const cl=get('class').replace(/\s+/g,'').toUpperCase(),day=weekday(get('weekday')),slot=Number(get('slot')),subject=get('subject');
      if(!cl||cl.length>40)throw new Error('Не указан класс или название слишком длинное.');
      if(!day)throw new Error('День недели: используйте Понедельник–Воскресенье или 1–7.');
      if(!Number.isInteger(slot)||slot<1||slot>20)throw new Error('Номер урока должен быть от 1 до 20.');
      if(!subject||subject.length>200)throw new Error('Не указан предмет или название слишком длинное.');
      const start=time(get('start')),end=time(get('end')),date=isoDate(get('date'));
      if(Boolean(start)!==Boolean(end))throw new Error('Для времени нужны и начало, и конец урока.');
      if(start&&start>=end)throw new Error('Конец урока должен быть позже начала.');
      if(date&&((new Date(date+'T12:00:00').getDay()+6)%7+1)!==day)throw new Error('Дата не совпадает с днём недели.');
      const subgroup=get('subgroup').slice(0,80),key=[cl,day,slot,date,subgroup].join('|');if(seen.has(key))throw new Error('Повтор номера урока для этого класса, дня и подгруппы. У параллельных занятий должны быть разные подгруппы.');seen.add(key);
      result.push({class:cl,weekday:day,slot,subject,start,end,room:get('room').slice(0,120),teacher:get('teacher').slice(0,160),campus:get('campus').slice(0,120),subgroup,date,notes:get('notes').slice(0,500)});
    }catch(e){throw new Error(`Строка ${i+2}: ${e.message}`);}
  }
  if(!result.length)throw new Error('В таблице нет уроков. Проверьте выбранный лист и столбцы.');
  return result;
}
export async function readTable(file){
  if(/\.csv$/i.test(file.name)){
    const buf=await file.arrayBuffer();let text=new TextDecoder('utf-8').decode(buf);if(text.includes('\uFFFD'))text=new TextDecoder('windows-1251').decode(buf);
    return [{name:file.name,rows:parseCsv(text)}];
  }
  if(!/\.xlsx$/i.test(file.name))throw new Error('Поддерживаются .xlsx и .csv. Старый .xls пересохраните в Excel как .xlsx.');
  if(!globalThis.JSZip)throw new Error('Не загрузился модуль Excel. Обновите страницу.');
  const zip=await globalThis.JSZip.loadAsync(await file.arrayBuffer());
  // Bound expansion before reading XML, including ZIP bombs and accidental huge workbooks.
  const entries=Object.values(zip.files);let total=0;
  for(const entry of entries){const n=entry._data?.uncompressedSize||0;total+=n;if(n>40*1024*1024||total>100*1024*1024)throw new Error('Excel слишком большой. Сохраните нужный лист отдельно в CSV.');}
  const xml=async path=>{const f=zip.file(path);if(!f)throw new Error('В Excel не найден '+path);const doc=new DOMParser().parseFromString(await f.async('string'),'application/xml');if(doc.querySelector('parsererror'))throw new Error('Не удалось прочитать XML внутри Excel.');return doc;};
  const nodes=(root,name)=>root.getElementsByTagNameNS('*',name);
  const texts=zip.file('xl/sharedStrings.xml')?Array.from(nodes(await xml('xl/sharedStrings.xml'),'si'),n=>Array.from(nodes(n,'t'),v=>v.textContent).join('')):[];
  const book=await xml('xl/workbook.xml'),rels=await xml('xl/_rels/workbook.xml.rels');
  if(['1','true'].includes(nodes(book,'workbookPr')[0]?.getAttribute('date1904')))throw new Error('В этой книге используется система дат 1904. Сохраните лист как CSV UTF-8.');
  const targets=new Map(Array.from(nodes(rels,'Relationship'),n=>[n.getAttribute('Id'),n.getAttribute('Target')]));
  const sheets=[];
  for(const sheet of nodes(book,'sheet')){
    if(sheet.getAttribute('state')==='hidden'||sheet.getAttribute('state')==='veryHidden')continue;
    const target=targets.get(sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id')||sheet.getAttribute('r:id'));if(!target)continue;
    const path=target.startsWith('/')?target.slice(1):'xl/'+target.replace(/^\.\//,'');
    if(path.includes('..'))throw new Error('Некорректная ссылка на лист Excel.');
    const doc=await xml(path);const rows=[];
    for(const rn of nodes(doc,'row')){
      const row=[];
      for(const c of nodes(rn,'c')){
        const letters=(c.getAttribute('r')||'').replace(/\d+/g,'');let col=0;for(const letter of letters)col=col*26+letter.charCodeAt(0)-64;
        if(col<1||col>1000)continue;
        const type=c.getAttribute('t'),v=nodes(c,'v')[0]?.textContent||'';
        row[col-1]=type==='s'?texts[Number(v)]??'':type==='inlineStr'?Array.from(nodes(c,'t'),n=>n.textContent).join(''):v;
      }
      if(row.some(v=>String(v??'').trim()))rows.push(Array.from({length:row.length},(_,i)=>row[i]??''));
      if(rows.length>20001)throw new Error('В листе больше 20 000 строк.');
    }
    if(rows.length)sheets.push({name:sheet.getAttribute('name'),rows});
  }
  if(!sheets.length)throw new Error('В Excel нет заполненных листов.');
  return sheets;
}
export const templateCsv='\uFEFFКласс;День недели;Номер урока;Предмет;Начало;Конец;Кабинет;Учитель;Корпус;Подгруппа;Дата замены;Примечание\r\n7А;Понедельник;1;Математика;08:30;09:15;201;;;;;\r\n7А;Понедельник;2;Русский язык;09:25;10:10;203;;;;;\r\n7Б;Понедельник;1;История;08:30;09:15;205;;;;;\r\n';
