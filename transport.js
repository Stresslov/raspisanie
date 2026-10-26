import {createGitHubApi} from './github-api.js';

export const githubMode=Boolean(globalThis.SCHOOL_GITHUB);
let github;
export function schoolFetch(url,options={}){
  if(!githubMode)return fetch(url,options);
  github??=createGitHubApi({config:globalThis.SCHOOL_GITHUB,baseUrl:new URL('./',location.href).href});
  return github.request(new Request(url,options));
}
export function publishedMessage(fallback){return githubMode?'Сохранено в GitHub. Для всех обновится после публикации GitHub Pages.':fallback;}
export function accessHelp(){return `<details class="github-help"><summary>Как получить ключ доступа</summary><ol class="help-list"><li>В GitHub откройте Settings → Developer settings → Personal access tokens → Fine-grained tokens.</li><li>Создайте ключ для владельца Stresslov, выберите Only select repositories → raspisanie.</li><li>В Repository permissions установите Contents → Read and write. Задайте срок действия.</li><li>Скопируйте ключ в это поле. Он нужен только для изменения файлов; просмотр открыт всем.</li></ol><p class="muted">Ключ даёт права изменения репозитория. Передавайте его только ответственным. Он хранится в памяти вкладки и не записывается в файлы или localStorage. Прежний пароль сайта здесь не действует.</p></details>`;}
