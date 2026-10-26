const TARGET_KEY='dmitrovsky-home-page';
function scheduleTarget(){const url=new URL(location.href);url.hash='';for(const name of [...url.searchParams.keys()])if(!['class','teacher','room','schedule'].includes(name))url.searchParams.delete(name);return url;}
export function initInstallApp(){
  const button=document.querySelector('#install-app'),dialog=document.querySelector('#install-dialog'),body=document.querySelector('#install-help'),status=document.querySelector('#install-status');
  const standalone=window.matchMedia?.('(display-mode: standalone)'),isStandalone=()=>Boolean(standalone?.matches||navigator.standalone);
  let promptEvent=null,installed=isStandalone(),prompting=false;
  // A home-screen launch restores the timetable selected when the icon was added.
  // Credentials and administrative routes are never stored in this target.
  if(installed&&!location.search&&!location.hash){try{const saved=localStorage.getItem(TARGET_KEY);if(saved){const target=new URL(saved,location.href);if(target.origin===location.origin&&new URL('./',target).pathname===new URL('./',location.href).pathname){const safe=new URL(target);for(const name of [...safe.searchParams.keys()])if(!['class','teacher','room','schedule'].includes(name))safe.searchParams.delete(name);safe.hash='';history.replaceState(null,'',safe.href);}}}catch{ /* Storage may be disabled by the browser. */ }}
  function update(){button.hidden=installed;button.disabled=prompting;}
  function saveTarget(){try{const url=scheduleTarget();localStorage.setItem(TARGET_KEY,url.pathname+url.search);}catch{ /* Installation still works without remembered selection. */ }}
  function help(){
    const ios=/iPad|iPhone|iPod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
    const embedded=/FBAN|FBAV|Instagram|Telegram|; wv\)|\bwv\b/i.test(navigator.userAgent);
    body.innerHTML=ios?'<p>На iPhone и iPad значок добавляется через меню браузера.</p><ol><li>Откройте эту страницу в <strong>Safari</strong>.</li><li>Нажмите <strong>«Поделиться»</strong> — кнопку со стрелкой вверх. Она также может находиться в меню страницы.</li><li>Выберите <strong>«На экран „Домой“»</strong>, затем <strong>«Добавить»</strong>. Если есть переключатель «Открыть как веб-приложение», включите его.</li></ol>':embedded?'<p>Встроенный браузер мессенджера может не поддерживать добавление значка.</p><ol><li>Откройте меню страницы и выберите <strong>«Открыть в браузере»</strong> — например, Chrome.</li><li>В меню браузера нажмите <strong>«Установить приложение»</strong> или <strong>«Добавить на главный экран»</strong>.</li><li>Подтвердите добавление.</li></ol>':'<p>Если окно установки не открылось, добавьте значок через меню браузера.</p><ol><li>Нажмите <strong>⋮</strong> или откройте меню браузера.</li><li>Выберите <strong>«Установить приложение»</strong> или <strong>«Добавить на главный экран»</strong>.</li><li>Подтвердите добавление. Название пункта зависит от браузера; если его нет, откройте страницу в Chrome или Safari.</li></ol>';
    status.textContent='';dialog.showModal();
  }
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();if(!installed)promptEvent=event;update();});
  window.addEventListener('appinstalled',()=>{installed=true;promptEvent=null;update();if(dialog.open)dialog.close();});
  standalone?.addEventListener?.('change',()=>{installed=isStandalone();update();});
  button.addEventListener('click',async()=>{
    saveTarget();if(!promptEvent){help();return;}
    const event=promptEvent;promptEvent=null;prompting=true;update();
    try{const result=await event.prompt();const choice=await (event.userChoice||result);if(choice?.outcome==='accepted')installed=true;}
    catch{help();}
    finally{prompting=false;update();}
  });
  document.querySelector('#install-close').addEventListener('click',()=>dialog.close());
  document.querySelector('#install-copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(scheduleTarget().href);status.textContent='Ссылка скопирована. Откройте её в браузере.';}catch{status.textContent='Не удалось скопировать автоматически. Скопируйте адрес страницы из строки браузера.';}});
  update();
}
