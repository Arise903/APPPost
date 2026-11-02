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
 const url='http://127.0.0.1:'+server.address().port+'/APPPost/';
 for(const [label,width,height] of [['desktop',1280,900],['mobile',390,844]]){
  const context=await browser.newContext({viewport:{width,height},acceptDownloads:true}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);await page.waitForFunction(()=>document.getElementById('projectCount').textContent==='0');
  await page.locator('#newProject').click();await page.locator('[name=name]').fill('新建配置验证');await page.locator('#createTemplate').selectOption('base');await page.locator('[name=platform]').selectOption('Android');await page.locator('[name=hasSubscriptions]').check();await page.locator('[name=hasAccountSystem]').check();
  assert.equal(await page.locator('[name=hasSubscriptions]').isVisible(),true);await page.locator('[name=hasAdjust]').check();await page.locator('#createSetup details').filter({has:page.locator('#createPermissions')}).locator('summary').click();assert.equal(await page.locator('#createPermissions input[value=tracking]').isChecked(),true);
  await page.locator('#createForm [type=submit]').click();await page.waitForURL(/board.html/);await page.waitForFunction(()=>typeof online!=='undefined'&&online);
  assert.equal(await page.evaluate(()=>reviewData.release.platform),'Android');assert.equal(await page.evaluate(()=>DATA.features.hasSubscriptions),true);assert.equal(await page.evaluate(()=>DATA.features.hasInitialization),true);assert.equal(await page.evaluate(()=>DATA.permSelected.includes('tracking')),true);assert.equal(await page.locator('li[data-id^=module_init_]').count(),3);
  assert.match(await page.locator('#projectConfigurationLines').textContent(),/Adjust 广告归因/);assert.match(await page.locator('#projectConfigurationLines').textContent(),/初始化流程核对/);assert.match(await page.locator('#projectConfigurationLines').textContent(),/ATT/);await page.goto(url);await page.waitForFunction(()=>document.getElementById('projectCount').textContent==='1');assert.match(await page.locator('.project-configuration').innerText(),/平台：Android/);assert.match(await page.locator('.project-configuration').innerText(),/Adjust 广告归因/);assert.match(await page.locator('.project-configuration').innerText(),/ATT/);
  const id=await page.evaluate(()=>PagesStore.create({name:'完整发布流程',document:'# Flow\n## Check\n- [ ] 验证生产构建 <!-- task:first -->\n- [ ] 验证核心功能 <!-- task:second -->\n',features:{hasAccountSystem:false,hasSubscriptions:false,hasPush:false,hasFeedbackSystem:false,targetMinors:false,hasAdjust:false,hasAnalysisApi:false},review:{release:{app:'Flow',platform:'Android',version:'1',owner:'Tester'},items:{first:{evidenceRequired:'on'}},history:[]}}));
  await page.goto(url+'board.html?id='+id);await page.waitForFunction(()=>typeof online!=='undefined'&&online);
  assert.match(await page.locator('#releasePriorities').innerText(),/必检待完成 2/);
  await page.locator('#viewMode').selectOption('focus');await page.locator('#releasePriorities button').first().click();assert.equal(await page.locator('#viewMode').inputValue(),'all');
  await page.evaluate(()=>{state.first='done';markDirty();render();});
  let aiDownloads=0;page.on('download',()=>aiDownloads++);await page.locator('#configMenu > summary').click();assert.equal(await page.locator('#aiReviewExport').isDisabled(),true);assert.match(await page.locator('#aiReviewExportHint').innerText(),/100%/);assert.equal(aiDownloads,0);await page.locator('#configMenu > summary').click();
  await page.locator('li[data-id=first] .item-title').click();await page.locator('#itemReviewForm [name=notes]').fill('保存全部同时保存备注和检查进度');await page.locator('#itemEvidenceSection > summary').click();await page.locator('#itemAttachmentUpload').setInputFiles({name:'proof.txt',mimeType:'text/plain',buffer:Buffer.from('evidence body')});
  // Inject a storage failure at the common request boundary: no data may disappear.
  await page.evaluate(()=>{window.originalFlowFetch=window.fetch;window.fetch=(url,options)=>url==='/api/review'?Promise.resolve(new Response(JSON.stringify({error:'模拟保存失败'}),{status:503})):window.originalFlowFetch(url,options);});
  await page.locator('#itemReviewForm .save-all-form').click();await page.waitForFunction(()=>saveFailure.includes('尚未保存'));
  assert.equal(await page.locator('#itemReviewDialog').evaluate(el=>el.open),true);assert.equal(await page.locator('#itemReviewForm [name=notes]').inputValue(),'保存全部同时保存备注和检查进度');assert.equal(await page.evaluate(()=>dirty),true);
  await page.evaluate(()=>{window.fetch=window.originalFlowFetch;});await page.locator('#itemReviewForm .save-all-form').click();await page.waitForFunction(()=>!dirty&&!document.getElementById('itemReviewDialog').open);
  const saved=await page.evaluate(()=>PagesStore.export(PagesStore.projectId()));assert.equal(saved.review.items.first.notes,'保存全部同时保存备注和检查进度');assert.equal(Object.keys(saved.assets).length,1);assert.match(saved.document,/\[x\] 验证生产构建/);
  await page.locator('#configMenu > summary').click();assert.equal(await page.locator('#aiReviewExport').isDisabled(),true);await page.locator('#configMenu > summary').click();
  await page.evaluate(()=>{state.second='skip';markDirty();render();});await page.locator(width<600?'#mobileSave':'#saveAll').click();await page.waitForFunction(()=>!dirty);assert.equal(await page.locator('#aiReviewExport').isDisabled(),true);
  await page.evaluate(()=>{state.second='done';markDirty();render();});await page.locator('#configMenu > summary').click();assert.equal(await page.locator('#aiReviewExport').isEnabled(),true);await page.locator('#aiReviewExport').click();await page.waitForFunction(()=>document.getElementById('toastMsg').textContent.includes('请先保存全部'));assert.equal(aiDownloads,0);await page.locator(width<600?'#mobileSave':'#saveAll').click();await page.waitForFunction(()=>!dirty);assert.equal(await page.locator('#pct').innerText(),'100%');
  await page.locator('#configMenu > summary').click();const aiDownloading=page.waitForEvent('download',{timeout:10000}).catch(async error=>{console.log(await page.evaluate(()=>({toast:document.getElementById('toastMsg').textContent,pending:boardPendingDetails(),failure:saveFailure})));throw error;});await page.locator('#aiReviewExport').click();const aiDownload=await aiDownloading,aiMarkdown=fs.readFileSync(await aiDownload.path(),'utf8');assert.match(aiDownload.suggestedFilename(),/AI排查.*\.md$/);assert.match(aiMarkdown,/release-desk-ai-review\/v1/);assert.match(aiMarkdown,/权限与隐私说明排查单/);assert.match(aiMarkdown,/PRIV-001/);assert.match(aiMarkdown,/PRIV-UNSELECTED-camera/);assert.match(aiMarkdown,/保存全部同时保存备注和检查进度/);assert.match(aiMarkdown,/proof.txt/);assert.match(aiMarkdown,/仅包含附件元信息/);assert.doesNotMatch(aiMarkdown,/ZXZpZGVuY2UgYm9keQ==/);
  await page.evaluate(()=>{state.second='todo';markDirty();render();});await page.locator(width<600?'#mobileSave':'#saveAll').click();await page.waitForFunction(()=>!dirty);assert.equal(await page.locator('#aiReviewExport').isDisabled(),true);
  await page.locator('#publishMenu > summary').click();await page.locator('#releaseArchive').click();await page.locator('.archive-decision [name=notes]').fill('核心功能待完成，暂不发布');await page.locator('.archive-decision [name=ack]').check();await page.locator('.archive-decision [type=submit]').click();await page.waitForFunction(()=>reviewData.history.length===1);
  const conclusion=await page.evaluate(()=>reviewData.history[0].conclusion);assert.equal(conclusion.ready,false);assert.equal(conclusion.owner,'Tester');assert.ok(conclusion.confirmedAt);assert.equal(conclusion.issues[0].id,'second');
  await page.locator('#publishMenu > summary').click();await page.locator('#summaryVersion').selectOption('history:0');const downloading=page.waitForEvent('download');await page.locator('#releaseSummary').click();const download=await downloading;const report=fs.readFileSync(await download.path(),'utf8');assert.match(report,/## 发布结论/);assert.match(report,/暂不发布/);assert.match(report,/### 证据缺口/);
  const restored=await page.evaluate(async()=>{const bundle=PagesStore.export(PagesStore.projectId()),copy=await PagesStore.create({name:'备份恢复验证',...bundle});return PagesStore.export(copy);});assert.deepEqual(restored.assets,saved.assets);assert.equal(restored.review.history[0].conclusion.owner,'Tester');
  // A second browser tab makes the first tab stale; save-all must retain its draft.
  const other=await context.newPage();await other.goto(url+'board.html?id='+id);await other.waitForFunction(()=>typeof online!=='undefined'&&online);await other.evaluate(async()=>{const p=PagesStore.get(PagesStore.projectId());await PagesStore.mutate(p.id,p.version,'another tab',p=>p.review.release.build='2');});await page.evaluate(()=>{state.second='done';markDirty();render();});await page.locator(width<600?'#mobileSave':'#saveAll').click();await page.waitForFunction(()=>saveConflict||saveFailure);assert.equal(await page.evaluate(()=>dirty),true);assert.equal(await page.evaluate(()=>state.second),'done');await other.close();
  fs.mkdirSync(path.resolve(__dirname,'../artifacts/release-flow'),{recursive:true});await page.screenshot({path:path.resolve(__dirname,'../artifacts/release-flow/'+label+'.png'),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);await context.close();
  console.log(label+': create → configure → save-all failure/retry with attachment → archive confirmation → summary → backup import → stale-tab protection passed');
 }
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(error=>{console.error(error);process.exitCode=1;});
