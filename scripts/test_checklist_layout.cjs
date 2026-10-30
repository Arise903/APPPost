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
 const url='http://127.0.0.1:'+server.address().port+'/APPPost/';
 try{
  browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
  const page=await browser.newPage({viewport:{width:820,height:900}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  async function openCommand(selector){const control=page.locator(selector),id=await control.evaluate(el=>el.closest('details.board-menu')?.id);if(id&&!await page.locator('#'+id).evaluate(el=>el.open))await page.locator('#'+id+' > summary').click();}
  async function clickCommand(selector){await openCommand(selector);await page.locator(selector).click();}
  await page.goto(url);await page.waitForFunction(()=>document.getElementById('projectCount').textContent==='0');
  const id=await page.evaluate(()=>PagesStore.create({name:'检查项排版验证',document:ReleaseTemplates.find(t=>t.id==='base').document,review:{release:{platform:'iOS / Android'},items:{base_test:{required:'on',evidenceRequired:'on'}},history:[]}}));
  await page.goto(url+'board.html?id='+id);await page.waitForFunction(()=>typeof online!=='undefined'&&online);
  const proof=page.locator('li.item[data-id="base_test"]');assert.equal(await page.locator('.item-evidence-summary').count(),0,'只有要求设置的条目不应生成空备注区');
  async function verify(width){await page.setViewportSize({width,height:900});const result=await proof.evaluate(row=>{const box=row.getBoundingClientRect(),label=row.querySelector('.item-main').getBoundingClientRect(),text=row.querySelector('.txt').getBoundingClientRect(),actions=row.querySelector('.item-actions').getBoundingClientRect();return {hasSummary:!!row.querySelector('.item-evidence-summary'),height:box.height,labelWidth:label.width,textWidth:text.width,overlap:!(actions.left>=label.right-1||actions.top>=label.bottom-1),contained:actions.right<=box.right+1&&actions.left>=box.left-1,overflow:document.documentElement.scrollWidth>innerWidth};});assert.ok(result.textWidth>=150,JSON.stringify({width,...result}));if(!result.hasSummary)assert.ok(result.height<170,JSON.stringify({width,...result}));assert.equal(result.overlap,false,JSON.stringify({width,...result}));assert.equal(result.contained,true,JSON.stringify({width,...result}));assert.equal(result.overflow,false,JSON.stringify({width,...result}));}
  for(const width of [1280,820,701,700,600,390,320])await verify(width);
  await page.setViewportSize({width:820,height:900});
  // Saving only policy flags must not reintroduce an empty summary via the incremental update path.
  await proof.getByRole('button',{name:'详情 · 备注 / 证据',exact:true}).click();await page.locator('#itemReviewForm [type=submit]').click();await page.waitForFunction(()=>!document.getElementById('itemReviewDialog').open);assert.equal(await page.locator('.item-evidence-summary').count(),0);await verify(820);
  if(process.env.RELEASE_QA_DIR){await proof.locator('xpath=ancestor::section').screenshot({path:process.env.RELEASE_QA_DIR+'/checklist-layout-desktop.png'});}
  await proof.getByRole('button',{name:'详情 · 备注 / 证据',exact:true}).click();const notes='已核对核心流程，记录实际设备、结果和复查说明。'.repeat(6)+' https://evidence.example.com/'+ 'a'.repeat(200);await page.locator('#itemReviewForm [name=notes]').fill(notes);await page.locator('#itemReviewForm [type=submit]').click();await page.waitForFunction(()=>!document.getElementById('itemReviewDialog').open);assert.equal(await proof.locator('.item-evidence-summary').innerText(),notes);
  for(const width of [1280,820,700,390,320]){await page.setViewportSize({width,height:900});const rect=await proof.evaluate(row=>{const box=row.getBoundingClientRect(),label=row.querySelector('.item-main').getBoundingClientRect(),summary=row.querySelector('.item-evidence-summary').getBoundingClientRect();return {labelWidth:label.width,summaryBelow:summary.top>=label.bottom-1,contained:summary.right<=box.right+1,overflow:document.documentElement.scrollWidth>innerWidth};});assert.ok(rect.labelWidth>=180,JSON.stringify({width,...rect}));assert.equal(rect.summaryBelow,true);assert.equal(rect.contained,true);assert.equal(rect.overflow,false);}
  await page.setViewportSize({width:390,height:900});if(process.env.RELEASE_QA_DIR)await proof.locator('xpath=ancestor::section').screenshot({path:process.env.RELEASE_QA_DIR+'/checklist-layout-mobile.png'});
  await page.evaluate(async()=>{const p=PagesStore.get(PagesStore.projectId());await PagesStore.mutate(p.id,p.version,'layout fixture',p=>{p.document+='\n## 长文本与缩进\n- [ ] '+ '长检查项'.repeat(25)+' <!-- task:long -->\n      - [ ] `CONFIG_'+ 'X'.repeat(200)+'` <!-- task:nested -->\n';});await loadFromServer();});
  for(const width of [1280,820,700,390,320]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'长文本不应撑破页面：'+width);assert.ok(await page.locator('li.item[data-id="nested"] .txt').evaluate(el=>el.getBoundingClientRect().width)>=100);}
  // Completed and skipped styles use the same stable layout after a rebuild.
  await page.evaluate(async()=>{const p=PagesStore.get(PagesStore.projectId());await PagesStore.mutate(p.id,p.version,'layout states',p=>p.document=PagesStore.apply(p.document,{base_identity:'done',base_environment:'skip'}));await loadFromServer();});await verify(820);assert.equal(await page.locator('li.item[data-id="base_identity"]').evaluate(el=>el.classList.contains('done')),true);assert.equal(await page.locator('li.item[data-id="base_environment"]').evaluate(el=>el.classList.contains('skip')),true);
  assert.deepEqual(errors,[]);console.log('Checklist layout passed: empty policy-only notes, incremental saves, separate action columns, long notes, nested text, saved states and seven viewport widths.');
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
