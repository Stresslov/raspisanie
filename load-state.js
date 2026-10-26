const validDate=value=>value&&Number.isFinite(new Date(value).getTime());
const time=value=>new Intl.DateTimeFormat('ru-RU',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Moscow'}).format(new Date(value));
const stamp=value=>new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Moscow'}).format(new Date(value))+' МСК';
// A fallback is available only after a real successful response for this timetable file.
export function loadPresentation({loading=false,failed=false,hasLoaded=false,updatedAt=null}={}){
  if(loading)return {kind:hasLoaded?'refreshing':'loading',text:hasLoaded?'Обновляем расписание…':'Загружаем расписание…',retry:false};
  if(failed)return hasLoaded?{kind:'stale',text:validDate(updatedAt)?'Не удалось обновить. Показана версия от '+stamp(updatedAt):'Не удалось обновить. Показана последняя загруженная версия.',retry:true}:{kind:'error',text:'Расписание временно недоступно',retry:true};
  if(hasLoaded&&validDate(updatedAt))return {kind:'fresh',text:'Обновлено в '+time(updatedAt)+' МСК',retry:false};
  return {kind:'empty',text:'Расписание ещё не опубликовано',retry:false};
}
export function scheduleSkeleton(){return `<div class="skeleton-list" aria-label="Загрузка расписания">${Array.from({length:4},()=>'<div class="skeleton-row" aria-hidden="true"><div class="skeleton-line short"></div><div class="skeleton-copy"><div class="skeleton-line"></div><div class="skeleton-line"></div></div></div>').join('')}</div>`;}
