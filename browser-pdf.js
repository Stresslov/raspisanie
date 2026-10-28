const DAYS={пн:1,вт:2,ср:3,чт:4,пт:5,сб:6,вс:7,понедельник:1,вторник:2,среда:3,четверг:4,пятница:5,суббота:6,воскресенье:7};
const TEACHER=/^[А-ЯЁA-Z][а-яёА-ЯЁA-Za-z-]+\s+[А-ЯЁA-Z]\.\s*[А-ЯЁA-Z]\.$/u;
const near=(a,b)=>Math.abs(a-b)<.4;
const unique=values=>values.sort((a,b)=>a-b).filter((value,index,array)=>!index||!near(value,array[index-1]));
function covers(segments,lo,hi){let edge=lo;for(const [a,b] of segments.sort((x,y)=>x[0]-y[0])){if(a>edge+.5)break;if(b>edge)edge=b;}return edge>=hi-.5;}
function splitCells(rect,vertical,horizontal,depth=0){
  if(depth>12)return [rect];const [x0,y0,x1,y1]=rect;
  const cuts=unique(vertical.filter(l=>l[0]>x0+.5&&l[0]<x1-.5).map(l=>l[0])).filter(x=>covers(vertical.filter(l=>near(l[0],x)).map(l=>[l[1],l[3]]),y0,y1));
  if(cuts.length){const xs=[x0,...cuts,x1];return xs.slice(0,-1).flatMap((x,i)=>splitCells([x,y0,xs[i+1],y1],vertical,horizontal,depth+1));}
  const ys=unique(horizontal.filter(l=>l[1]>y0+.5&&l[1]<y1-.5).map(l=>l[1])).filter(y=>covers(horizontal.filter(l=>near(l[1],y)).map(l=>[l[0],l[2]]),x0,x1));
  if(ys.length){const values=[y0,...ys,y1];return values.slice(0,-1).flatMap((y,i)=>splitCells([x0,y,x1,values[i+1]],vertical,horizontal,depth+1));}
  return [rect];
}
function gridLines(ops,pdfjs){
  let matrix=[1,0,0,1,0,0];const stack=[],vertical=[],horizontal=[];
  const point=(x,y)=>[matrix[0]*x+matrix[2]*y+matrix[4],matrix[1]*x+matrix[3]*y+matrix[5]];
  for(let i=0;i<ops.fnArray.length;i++){
    const op=ops.fnArray[i],args=ops.argsArray[i];
    if(op===pdfjs.OPS.save)stack.push([...matrix]);
    else if(op===pdfjs.OPS.restore)matrix=stack.pop()||[1,0,0,1,0,0];
    else if(op===pdfjs.OPS.transform)matrix=pdfjs.Util.transform(matrix,args);
    else if(op===pdfjs.OPS.constructPath&&args[0]===pdfjs.OPS.stroke){
      const box=args[2];if(!box||!near(box[0],box[2])&&!near(box[1],box[3]))continue;
      const a=point(box[0],box[1]),b=point(box[2],box[3]),line=[Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[0],b[0]),Math.max(a[1],b[1])];
      if(near(line[0],line[2]))vertical.push(line);else if(near(line[1],line[3]))horizontal.push(line);
    }
  }
  return {vertical,horizontal};
}
function cardLesson(texts,base){
  let ti=texts.findIndex(t=>TEACHER.test(t)||/^[А-ЯЁ]{3}$/u.test(t)||/ваканси/iu.test(t)),te=ti;const notes=[];
  if(ti<0)for(let i=0;i<texts.length-1;i++)if(TEACHER.test(texts[i]+' '+texts[i+1])){ti=i;te=i+1;break;}
  let subject,teacher,tail;
  if(ti<0){subject=texts.join(' ');teacher='';tail=[];notes.push('Не определена граница предмета и учителя: проверьте исходный текст.');}
  else{subject=texts.slice(0,ti).join(' ');teacher=texts.slice(ti,te+1).join(' ');tail=texts.slice(te+1);}
  for(const [before,after] of [['Православ ие','Православие'],['религиозн ых','религиозных'],['Индивидуа льный','Индивидуальный']])subject=subject.replaceAll(before,after);
  const room=tail[0]&&/^(?:\d|э\s)/iu.test(tail[0])?tail[0]:'',subgroup=(room?tail.slice(1):tail).join(' ');
  if(teacher&&!TEACHER.test(teacher))notes.push('В PDF вместо ФИО указан код или вакансия: '+teacher);
  if(!room)notes.push('Кабинет не указан или не определён.');
  if(!base.class||!subject)notes.push('Не определено обязательное поле.');
  return {...base,subject,teacher,room,subgroup,date:'',notes:notes.join('; '),needsReview:Boolean(notes.length),sourceText:texts.join(' | ')};
}
export function parseTimetablePage(textContent,operatorList,pdfjs,{page,campus='',classOverride=''}){
  const items=textContent.items.filter(item=>typeof item.str==='string'&&item.str.trim()).map(item=>({text:item.str.trim().replaceAll('\u00a0',' '),x:item.transform[4],y:item.transform[5],height:item.height,width:item.width}));
  const {vertical,horizontal}=gridLines(operatorList,pdfjs),headers=items.filter(item=>DAYS[item.text.toLocaleLowerCase('ru').replace(/\.$/,'')]);
  if(!headers.length||!vertical.length||!horizontal.length)throw new Error('Не найдена таблица с днями недели и строками уроков. Нужен текстовый PDF из школьной рассылки, а не скан.');
  const headingSize=Math.max(...headers.map(h=>h.height)),days=headers.filter(h=>h.height>=headingSize*.8),headerY=Math.max(...days.map(h=>h.y));
  const title=items.filter(item=>item.y>headerY+5).sort((a,b)=>b.height-a.height)[0]?.text||'',className=(classOverride||title).replace(/\s+/g,'').toLocaleUpperCase('ru');
  const columns=days.map(item=>{const x=item.x+item.width/2,y=item.y+item.height/2,cuts=unique(vertical.filter(l=>l[1]<=y+.4&&l[3]>=y-.4).map(l=>l[0]));return {day:DAYS[item.text.toLocaleLowerCase('ru').replace(/\.$/,'')],left:cuts.filter(c=>c<x).at(-1),right:cuts.find(c=>c>x)};}).filter(c=>Number.isFinite(c.left)&&Number.isFinite(c.right));
  const rowLabels=items.filter(item=>/^\d+\s*урок$/iu.test(item.text)&&item.x<Math.min(...columns.map(c=>c.left))),lessons=[];
  for(const label of rowLabels){
    const x=label.x+label.width/2,y=label.y+label.height/2,borders=unique(horizontal.filter(l=>l[0]<=x+.4&&l[2]>=x-.4).map(l=>l[1])),bottom=borders.filter(v=>v<y).at(-1),top=borders.find(v=>v>y);
    if(!Number.isFinite(bottom)||!Number.isFinite(top))continue;
    const timeText=items.filter(item=>item.x<Math.min(...columns.map(c=>c.left))&&item.y>bottom&&item.y<=top).map(item=>item.text).join(' '),times=timeText.match(/(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})/);
    for(const column of columns){
      const cells=splitCells([column.left,bottom,column.right,top],vertical,horizontal).sort((a,b)=>b[3]-a[3]||a[0]-b[0]);
      for(const [x0,y0,x1,y1] of cells){const texts=items.filter(item=>item.x>=x0-.15&&item.x<x1-.15&&item.y>y0&&item.y<=y1+.15).map(item=>item.text);if(!texts.length)continue;lessons.push(cardLesson(texts,{class:className.length<=40?className:'',weekday:column.day,slot:Number(label.text.match(/^\d+/)[0]),start:times?times[1].padStart(5,'0'):'',end:times?times[2].padStart(5,'0'):'',campus,page}));}
    }
  }
  if(!lessons.length)throw new Error('На странице не распознаны уроки. Проверьте формат таблицы.');return lessons;
}
async function loadEngine(){
  const root=new URL('./vendor/pdfjs/',document.baseURI);
  let pdfjs;try{pdfjs=await import(new URL('pdf.mjs',root).href);}catch{throw new Error('Не удалось загрузить модуль PDF. Проверьте, что папка vendor из обновления загружена в GitHub, и обновите страницу.');}
  pdfjs.GlobalWorkerOptions.workerSrc=new URL('pdf.worker.mjs',root).href;return {pdfjs,root};
}
export async function parseBrowserPdf(file,settings,{engine,onProgress=()=>{}}={}){
  if(!file||typeof file==='string'||!file.size||file.size>20*1024*1024||await file.slice(0,5).text()!=='%PDF-')throw new Error('Нужен PDF не больше 20 МБ.');
  if(typeof settings.campus!=='string'||settings.campus.length>120||typeof settings.classOverride!=='string'||settings.classOverride.length>40)throw new Error('Проверьте корпус и название класса.');
  const {pdfjs,root}=engine||await loadEngine(),task=pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false,disableFontFace:true,useSystemFonts:false,enableXfa:false,maxImageSize:0,...(root?{standardFontDataUrl:new URL('standard_fonts/',root).href,wasmUrl:new URL('wasm/',root).href}:{})});
  try{
    const pdf=await task.promise;if(pdf.numPages>120)throw new Error('В PDF больше 120 страниц. Разделите его на несколько файлов.');const lessons=[],warnings=[];
    for(let page=1;page<=pdf.numPages;page++){onProgress(page,pdf.numPages);const current=await pdf.getPage(page);try{const [text,ops]=await Promise.all([current.getTextContent({disableNormalization:true}),current.getOperatorList()]);lessons.push(...parseTimetablePage(text,ops,pdfjs,{page,...settings}));}catch(error){warnings.push({page,message:error.message});}finally{current.cleanup();}if(lessons.length>20000)throw new Error('В PDF больше 20 000 уроков.');}
    if(!lessons.length)throw new Error(warnings[0]?.message||'Не распознано ни одного урока.');
    const groups=new Map();for(const lesson of lessons){const key=[lesson.class,lesson.weekday,lesson.slot].join('|');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(lesson);}
    for(const rows of groups.values())if(rows.length>1){const used=new Set();for(let i=0;i<rows.length;i++){const lesson=rows[i];if(!lesson.subgroup||used.has(lesson.subgroup)){lesson.subgroup='Подгруппа '+(i+1);lesson.needsReview=true;lesson.notes+='; Подгруппа обозначена по порядку в PDF: проверьте.';}used.add(lesson.subgroup);}}
    return {lessons,warnings,pages:pdf.numPages,reviewCount:lessons.filter(l=>l.needsReview).length};
  }finally{await task.destroy();}
}
