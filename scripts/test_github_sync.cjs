/* Real DOM regression: visibility must remain correct on initial load and every rebuild. */
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'../docs');
const server=http.createServer((req,res)=>{
 try{
  const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(!name.startsWith('/APPPost/')){res.writeHead(404).end();return;}
  const target=path.resolve(root,name.slice('/APPPost/'.length)||'index.html');
  if(!target.startsWith(root+path.sep)||!fs.statSync(target).isFile()){res.writeHead(404).end();return;}
  const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json'};
  res.setHeader('Content-Type',(mime[path.extname(target)]||'application/octet-stream')+'; charset=utf-8');res.end(fs.readFileSync(target));
 }catch(_){res.writeHead(404).end();}
});

(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;try{
 browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
 const url='http://127.0.0.1:'+server.address().port+'/APPPost/',context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[],requests=[],unexpected=[],repos=new Map();page.on('pageerror',e=>errors.push(e.message));
 for(const [name,branch] of [['Example-Team/release.private-data','releases/data'],['OtherUser/another-backup','main'],['Arise903/APPdata','main']])repos.set(name,{private:true,branch,commit:null,content:null,writes:0,id:repos.size+1});
 await context.route('https://api.github.com/**',async route=>{const req=route.request(),path=new URL(req.url()).pathname,method=req.method(),match=path.match(/^\/repos\/([^/]+)\/([^/]+)(.*)$/),name=match?match[1]+'/'+match[2]:'',suffix=match?.[3]||'',repo=repos.get(name);requests.push({name,method,suffix});let status=200,body={};
  if(!repo){status=404;body={message:'not found'};}
  else if(!suffix)body={id:repo.id,private:repo.private,default_branch:repo.branch,size:repo.commit?1:0};
  else if(method==='GET'&&suffix==='/git/ref/heads/'+encodeURIComponent(repo.branch)){if(repo.commit)body={object:{sha:repo.commit}};else{status=404;body={message:'empty'};}}
  else if(method==='GET'&&suffix.startsWith('/git/commits/'))body={tree:{sha:'tree'}};
  else if(method==='GET'&&suffix.startsWith('/git/trees/'))body={tree:[{type:'blob',path:'release-desk/workspace.json',sha:'blob'}]};
  else if(method==='GET'&&suffix.startsWith('/git/blobs/'))body={encoding:'base64',content:Buffer.from(repo.content).toString('base64')};
  else if(method==='GET'&&suffix==='/commits')body=[{sha:repo.commit,commit:{message:'sync',author:{date:'2026-11-02'}}}];
  else if(method==='POST'&&suffix==='/git/blobs'){repo.content=JSON.parse(req.postData()).content;repo.writes++;body={sha:'blob'};}
  else if(method==='POST'&&suffix==='/git/trees'){assert.equal(JSON.parse(req.postData()).tree[0].path,'release-desk/workspace.json');body={sha:'tree'};}
  else if(method==='POST'&&suffix==='/git/commits'){repo.commit='commit-'+repo.writes;body={sha:repo.commit};}
  else if(method==='POST'&&suffix==='/git/refs'){assert.equal(JSON.parse(req.postData()).ref,'refs/heads/'+repo.branch);body={object:{sha:repo.commit}};}
  else if(method==='PATCH'&&suffix==='/git/refs/heads/'+encodeURIComponent(repo.branch)){assert.equal(JSON.parse(req.postData()).force,false);body={object:{sha:repo.commit}};}
  else{unexpected.push(method+' '+path);status=404;body={message:'unexpected'};}
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.goto(url);await page.waitForFunction(()=>document.getElementById('projectCount').textContent==='0');await page.evaluate(()=>PagesStore.create({name:'同步配置验证'}));await page.locator('#openDataManager').click();await page.locator('#githubSyncConnect').click();assert.equal(await page.locator('#githubOwner').inputValue(),'');assert.equal(await page.locator('#githubRepo').inputValue(),'');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);fs.mkdirSync(path.resolve(__dirname,'../artifacts'),{recursive:true});await page.screenshot({path:path.resolve(__dirname,'../artifacts/github-custom-repo-mobile.png')});
 await page.locator('#githubGuideNextToken').click();await page.locator('#githubGuideNextConnect').click();assert.equal(await page.evaluate(()=>document.activeElement.id),'githubToken');
 async function fill(owner,repo){await page.locator('#githubOwner').fill(owner);await page.locator('#githubRepo').fill(repo);assert.equal(await page.locator('[data-guide-owner]').textContent(),owner);assert.equal(await page.locator('[data-guide-repo]').textContent(),repo);const link=new URL(await page.locator('#githubTokenCreate').getAttribute('href'));assert.equal(link.searchParams.get('contents'),'write');assert.equal(link.searchParams.get('expires_in'),'30');if(owner==='Example-Team')assert.equal(link.searchParams.get('target_name'),owner);await page.locator('#githubToken').fill('github_pat_isolated_mock');await page.locator('#githubTokenSubmit').click();}
 await fill('https://github.com/team','bad');await page.waitForFunction(()=>document.getElementById('githubTokenError').textContent.includes('有效'));assert.equal(requests.length,0);
 repos.get('Example-Team/release.private-data').private=false;await fill('Example-Team','release.private-data');await page.waitForFunction(()=>document.getElementById('githubTokenError').textContent.includes('私有'));assert.equal(await page.locator('#githubSyncPush').isDisabled(),true);assert.equal(await page.evaluate(()=>sessionStorage.getItem('release-desk-github-connection:session:v2')),null);
 repos.get('Example-Team/release.private-data').private=true;await fill('Example-Team','release.private-data');await page.waitForFunction(()=>!document.getElementById('githubSyncPush').disabled);assert.match(await page.locator('#githubSyncStatus').textContent(),/Example-Team\/release.private-data/);
 assert.equal(await page.evaluate(()=>JSON.stringify(localStorage).includes('github_pat_isolated_mock')),false);
 // Recheck privacy after preview: never write to a repository made public meanwhile.
 await page.locator('#githubSyncPush').click();await page.waitForFunction(()=>document.getElementById('githubReviewDialog').open);assert.match(await page.locator('#githubReviewTitle').textContent(),/Example-Team\/release.private-data/);repos.get('Example-Team/release.private-data').private=false;await page.locator('#githubReviewConfirm').click();await page.waitForFunction(()=>document.getElementById('githubSyncStatus').textContent.includes('停止上传'));assert.equal(repos.get('Example-Team/release.private-data').writes,0);repos.get('Example-Team/release.private-data').private=true;
 async function upload(){await page.locator('#githubSyncPush').click();await page.waitForFunction(()=>document.getElementById('githubReviewDialog').open);await page.locator('#githubReviewConfirm').click();await page.waitForFunction(()=>document.getElementById('githubSyncStatus').textContent.includes('上传完成'));}
 await upload();assert.equal(repos.get('Example-Team/release.private-data').writes,1);assert.equal(JSON.parse(repos.get('Example-Team/release.private-data').content).projects.length,1);await page.locator('#githubSyncHistory').click();await page.waitForFunction(()=>document.getElementById('githubReviewDialog').open);assert.match(await page.locator('#githubReviewTitle').textContent(),/Example-Team\/release.private-data/);await page.locator('#githubReviewCancel').click();
 await page.locator('#githubSyncDisconnect').click();await page.locator('#githubSyncConnect').click();assert.equal(await page.locator('#githubOwner').inputValue(),'Example-Team');await fill('OtherUser','another-backup');await page.waitForFunction(()=>!document.getElementById('githubSyncPush').disabled);assert.doesNotMatch(await page.locator('#githubSyncStatus').textContent(),/上次同步/);await upload();
 const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('release-desk-github-sync:v1')));assert.equal(stored.repo,'OtherUser/another-backup');assert.ok(stored.repositories['example-team/release.private-data'].lastSyncedAt);assert.ok(stored.repositories['otheruser/another-backup'].lastSyncedAt);
 const beforeReload=requests.length;await page.reload();await page.waitForFunction(()=>!document.getElementById('githubSyncPush').disabled);await page.waitForFunction(()=>document.getElementById('githubSyncStatus').textContent.includes('OtherUser/another-backup'));assert.equal(requests.slice(beforeReload).every(r=>r.name==='OtherUser/another-backup'),true);assert.equal(repos.get('Example-Team/release.private-data').writes,1);
 // Deleting cloud data removes only the sync file and leaves local projects untouched.
 await page.locator('#openDataManager').click();await page.waitForFunction(()=>!document.getElementById('githubSyncDeleteRemote').disabled);
 await page.locator('#githubSyncDeleteRemote').click();await page.waitForFunction(()=>document.getElementById('githubReviewDialog').open);
 assert.match(await page.locator('#githubReviewTitle').textContent(),/删除云端数据/);
 page.once('dialog',dialog=>dialog.accept('DELETE'));
 await page.locator('#githubReviewConfirm').click();
 await page.waitForFunction(()=>document.getElementById('githubSyncStatus').textContent.includes('云端同步文件已删除'));
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('release-desk-github-sync:v1')).fileSha),null);
 assert.equal(await page.evaluate(()=>PagesStore.list().length>=1),true,'本机项目不受影响');
 assert.equal(repos.get('OtherUser/another-backup').writes,1,'删除不写入工作台内容');
 // Existing token-only sessions retain the original repository, with no new default for fresh users.
 const legacy=await context.newPage();await legacy.addInitScript(()=>{sessionStorage.clear();sessionStorage.setItem('release-desk-github-token:session:v1','legacy_mock_token');});await legacy.goto(url);await legacy.waitForFunction(()=>document.getElementById('githubSyncStatus').textContent.includes('Arise903/APPdata'));assert.equal(await legacy.evaluate(()=>JSON.parse(sessionStorage.getItem('release-desk-github-connection:session:v2')).repo),'APPdata');assert.equal(await legacy.evaluate(()=>sessionStorage.getItem('release-desk-github-token:session:v1')),null);
 assert.deepEqual(unexpected,[]);assert.deepEqual(errors,[]);await context.close();console.log('Custom GitHub sync passed: blank setup, input validation, private-only verification, custom owner/repo/default branch, empty upload, history scope, repository switching, per-repo status, reload, remote deletion and legacy session migration.');
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(error=>{console.error(error);process.exitCode=1;});
