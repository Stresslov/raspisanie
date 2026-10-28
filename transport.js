import {createGitHubApi} from './github-api.js';

export const githubMode=Boolean(globalThis.SCHOOL_GITHUB);
export const serverMode=Boolean(globalThis.SCHOOL_SERVER);
let session={user:null,csrf:''};
export const serverUser=()=>session.user;
export const serverCan=role=>Boolean(session.user&&(session.user.role==='admin'||role==='changes'&&session.user.role==='changes'));
function setSession(next){session=next;window.dispatchEvent(new Event('school-session-changed'));}
export async function restoreServerSession(){if(!serverMode)return;try{const response=await fetch(new URL('./api/session',location.href),{credentials:'same-origin',cache:'no-store'});if(response.ok)setSession(await response.json());}catch{ /* Public schedule loading reports connection failures separately. */ }}
export async function serverLogin(username,password){const response=await fetch(new URL('./api/session',location.href),{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})}),result=await response.json();if(!response.ok)throw new Error(result.error||'Не удалось войти.');setSession(result);return result.user;}
export async function serverLogout(){const response=await fetch(new URL('./api/session',location.href),{method:'DELETE',credentials:'same-origin',headers:{'x-csrf-token':session.csrf}});if(!response.ok&&response.status!==401)throw new Error('Не удалось выйти. Повторите попытку.');setSession({user:null,csrf:''});}
let github;
export function schoolFetch(url,options={}){
  if(serverMode){const headers=new Headers(options.headers);headers.delete('x-school-admin-key');if(!['GET','HEAD'].includes(options.method||'GET'))headers.set('x-csrf-token',session.csrf);return fetch(url,{...options,headers,credentials:'same-origin'}).then(response=>{if(response.status===401)setSession({user:null,csrf:''});return response;});}
  if(!githubMode)return fetch(url,options);
  github??=createGitHubApi({config:globalThis.SCHOOL_GITHUB,baseUrl:new URL('./',location.href).href});
  return github.request(new Request(url,options));
}
export function publishedMessage(fallback){return githubMode?'Сохранено в GitHub. Для всех обновится после публикации GitHub Pages.':fallback;}
export function accessHelp(){return `<details class="github-help"><summary>Как получить ключ доступа</summary><ol class="help-list"><li>В GitHub откройте Settings → Developer settings → Personal access tokens → Fine-grained tokens.</li><li>Создайте ключ для владельца Stresslov, выберите Only select repositories → raspisanie.</li><li>В Repository permissions установите Contents → Read and write. Задайте срок действия.</li><li>Скопируйте ключ в это поле. Он нужен только для изменения файлов; просмотр открыт всем.</li></ol><p class="muted">Ключ даёт права изменения репозитория. Передавайте его только ответственным. Он хранится в памяти вкладки и не записывается в файлы или localStorage. Прежний пароль сайта здесь не действует.</p></details>`;}
