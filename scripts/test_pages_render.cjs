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
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try{
  browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/APPPost/index.html');
  await page.locator('#newProject').click();await page.locator('[name=name]').fill('初始化显示回归');await page.locator('#createForm [type=submit]').click();await page.waitForURL(/board.html\?id=/);await page.waitForFunction(()=>typeof online!=='undefined'&&online);
  const chapters=page.locator('#sectionFilter');assert.ok(await chapters.locator('option').count()>2);const chapter=await chapters.locator('option').nth(1).getAttribute('value');assert.match(await chapters.locator(`option[value="${chapter}"]`).innerText(),/已处理 \d+\/\d+ · 完成率 \d+%/);await chapters.selectOption(chapter);assert.ok(await page.locator('#list li.item:not(.gateitem):not(.hidden)').count()>0);assert.equal(await page.locator('#list li.item:not(.gateitem):not(.hidden)').evaluateAll(items=>items.every(item=>item.closest('section.card').dataset.sec===document.getElementById('sectionFilter').value)),true);await chapters.selectOption('all');
  const gate=page.locator('.gateitem input[type=checkbox]');assert.equal(await gate.isChecked(),false);assert.equal(await page.locator('#gateBar').isVisible(),true);
  await gate.check();assert.equal(await page.locator('#gateBar').isVisible(),false,'勾选阅读确认后顶部提醒应立即消失');assert.doesNotMatch(await page.locator('#seqline').innerText(),/清单未解锁/);assert.equal(await page.locator('#list li.item:not(.gateitem)').first().getAttribute('data-locked'),'0');
  await gate.click();await page.locator('#ov').waitFor({state:'visible'});await page.locator('#dlgCancel').click();assert.equal(await gate.isChecked(),true,'取消确认框后阅读状态应保持');assert.equal(await page.locator('#gateBar').isVisible(),false);
  await gate.click();await page.locator('#ov').waitFor({state:'visible'});await page.locator('#dlgOk').click();assert.equal(await gate.isChecked(),false);assert.equal(await page.locator('#gateBar').isVisible(),true,'确认取消后应重新显示阅读提醒');assert.equal(await page.locator('#list li.item:not(.gateitem)').first().getAttribute('data-locked'),'1');
  await gate.check();assert.equal(await page.locator('#gateBar').isVisible(),false);
  await page.locator('#btnSave').click();await page.waitForFunction(()=>document.getElementById('btnSave').textContent==='保存进度');await page.reload();await page.waitForFunction(()=>typeof online!=='undefined'&&online);assert.equal(await page.locator('.gateitem input[type=checkbox]').isChecked(),true);assert.equal(await page.locator('#gateBar').isVisible(),false,'保存并重新载入后阅读确认仍应生效');
  const heading=()=>page.getByRole('heading').filter({hasText:/用户反馈.*feedbackApiKey/});
  const verifyHidden=async()=>{
   await page.waitForFunction(()=>typeof online!=='undefined'&&online);
   assert.equal(await heading().count(),0,'反馈默认关闭时，初始化/重建/刷新都不能显示反馈小节');
   assert.equal(await page.locator('li.item').filter({hasText:/feedbackApiKey.*已替换为正式 Key/}).count(),0,'隐藏的反馈条目不能留在 DOM 中');
   const numbers=await page.locator('#list li.item:not(.gateitem) .seq').allTextContents();assert.deepEqual(numbers.map(Number),numbers.map((_,i)=>i+1));
  };
  await verifyHidden();await page.reload();await verifyHidden();
  await page.locator('#btnFeat').click();assert.equal(await page.locator('#featFeedback').isChecked(),false);assert.equal(await heading().count(),0);await page.locator('#featCancel').click();
  await page.evaluate(()=>persistReview({...reviewData,release:{version:'1'},history:[{release:{version:'0.9'},date:'2026-01-01T00:00:00Z',items:[{id:'old',text:'历史跳过项',state:'skip',applicable:true,reason:'暂不适用',notes:'旧版本备注',evidence:'audit.png'}]}]}));await verifyHidden();
  await page.locator('#summaryVersion').selectOption('history:0');const downloadPromise=page.waitForEvent('download');await page.locator('#releaseSummary').click();const summary=await downloadPromise;assert.match(summary.suggestedFilename(),/0\.9/);const summaryText=fs.readFileSync(await summary.path(),'utf8');assert.match(summaryText,/暂不适用/);assert.match(summaryText,/旧版本备注/);assert.match(summaryText,/各版本进度对比/);await page.locator('#summaryVersion').selectOption('current');
  for(const enabled of [true,false]){
   await page.locator('#btnFeat').click();await page.locator('#featFeedback').setChecked(enabled);await page.locator('#featAcc').uncheck();await page.locator('#featMinor').uncheck();const featurePreview=await page.locator('#featPreview').textContent();assert.match(featurePreview,/按当前开关预览/);assert.match(featurePreview,/将显示/);assert.match(featurePreview,/将隐藏/);assert.equal(featurePreview.includes('无用户反馈系统'),!enabled);await page.locator('#featSave').click();await page.waitForFunction(()=>!document.getElementById('featPanel').classList.contains('on'));
   assert.equal(await heading().count(),enabled?1:0);await page.reload();await page.waitForFunction(()=>typeof online!=='undefined'&&online);assert.equal(await heading().count(),enabled?1:0);
   assert.equal(await page.getByRole('heading').filter({hasText:'账号注销与数据主体权利'}).count(),0);
  }
  await verifyHidden();await page.goto('http://127.0.0.1:'+server.address().port+'/APPPost/index.html');await page.waitForFunction(()=>document.getElementById('projectCount').textContent==='1');const backup=await page.evaluate(()=>PagesStore.exportAll());let importPreview='';page.once('dialog',async dialog=>{importPreview=dialog.message();await dialog.dismiss();});await page.locator('#workspaceImport').setInputFiles({name:'workspace.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});await page.waitForFunction(()=>document.getElementById('workspaceImport').value==='');assert.match(importPreview,/导入前预览/);assert.match(importPreview,/历史快照/);assert.equal(await page.locator('#projectCount').innerText(),'1');
  let branchSha='commit1',writes=0,nextBlob='blob1';const commitTrees={commit1:'tree1'},treeBlobs={tree1:'blob1'},blobContents={blob1:JSON.stringify(backup)};
  await page.route('https://api.github.com/**',async route=>{
   const req=route.request(),url=new URL(req.url()),path=url.pathname,method=req.method(),base='/repos/Arise903/APPdata';let status=200,body={};
   if(path===base&&method==='GET')body={private:true,default_branch:'main',size:1};
   else if(path===base+'/git/ref/heads/main'&&method==='GET')body={object:{sha:branchSha}};
   else if(path.startsWith(base+'/git/commits/')&&method==='GET')body={tree:{sha:commitTrees[path.split('/').pop()]}};
   else if(path.startsWith(base+'/git/trees/')&&method==='GET')body={tree:[{path:'release-desk/workspace.json',type:'blob',sha:treeBlobs[path.split('/').pop()]}]};
   else if(path.startsWith(base+'/git/blobs/')&&method==='GET')body={encoding:'base64',content:Buffer.from(blobContents[path.split('/').pop()]).toString('base64')};
   else if(path===base+'/commits'&&method==='GET')body=[{sha:'commit2',commit:{message:'encrypted sync',author:{date:'2026-10-29T00:00:00Z'}}},{sha:'commit1',commit:{message:'first sync',author:{date:'2026-10-28T00:00:00Z'}}}];
   else if(path===base+'/git/blobs'&&method==='POST'){nextBlob='blob'+(++writes+1);blobContents[nextBlob]=JSON.parse(req.postData()).content;body={sha:nextBlob};}
   else if(path===base+'/git/trees'&&method==='POST'){treeBlobs.tree2=nextBlob;body={sha:'tree2'};}
   else if(path===base+'/git/commits'&&method==='POST'){branchSha='commit2';commitTrees.commit2='tree2';body={sha:branchSha};}
   else if(path===base+'/git/refs/heads/main'&&method==='PATCH')body={object:{sha:branchSha}};
   else{status=404;body={message:'Unexpected mock API request: '+method+' '+path};}
   await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  });
  await page.locator('#githubSyncConnect').click();await page.locator('#githubToken').fill('github_pat_mock_only');await page.locator('#githubTokenSubmit').click();await page.waitForFunction(()=>!document.getElementById('githubSyncPush').disabled);
  await page.evaluate(async()=>{const p=PagesStore.list()[0];await PagesStore.mutate(p.id,p.version,'test conflict',x=>x.name='Changed locally for sync');});
  await page.locator('#githubSyncPush').click();await page.locator('#githubEncryptUpload').check();await page.locator('#githubEncryptPassword').fill('correct horse battery staple');await page.locator('#githubReviewConfirm').click();await page.waitForFunction(()=>document.getElementById('githubSyncStatus').textContent.includes('上传完成'));
  assert.equal(JSON.parse(blobContents.blob2).format,'release-desk-encrypted/v1','启用加密后仓库只收到密文信封');assert.doesNotMatch(blobContents.blob2,/Changed locally for sync|github_pat_mock_only/);
  await page.locator('#githubSyncHistory').click();page.once('dialog',dialog=>dialog.accept('correct horse battery staple'));await page.locator('[data-commit="commit2"]').click();await page.waitForSelector('#githubReviewConfirm:not([hidden])');await page.locator('#githubReviewCancel').click();await page.locator('#githubSyncHistory').click();await page.locator('[data-commit="commit1"]').click();await page.waitForSelector('#githubReviewConfirm:not([hidden])');const restoreDownload=page.waitForEvent('download');await page.locator('#githubReviewConfirm').click();await restoreDownload;await page.waitForFunction(()=>PagesStore.list()[0].name!=='Changed locally for sync');assert.deepEqual(errors,[]);console.log('Pages DOM regression passed: guide acknowledgement, settings, backup import, private sync diff/encryption, history restore, token isolation, reload and responsive interactions.');
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
