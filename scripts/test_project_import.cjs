/* Real browser contract: AI instructions -> source Markdown -> imported project. */
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const unlockVault=require('./vault-test-helper.cjs');
const root=path.resolve(__dirname,'../docs');
const server=http.createServer((req,res)=>{try{const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname),target=path.resolve(root,'.'+(name==='/'?'/index.html':name));if(!target.startsWith(root+path.sep))throw Error('path');const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json'};res.setHeader('Content-Type',mime[path.extname(target)]||'application/octet-stream');res.end(fs.readFileSync(target));}catch(_){res.writeHead(404).end();}});
(async()=>{
 let browser;await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:'+server.address().port);await unlockVault(page);
  await page.locator('#newProject').click();await page.locator('#openAIImport').click();
  const prompt=await page.locator('#aiImportPrompt').inputValue();assert.match(prompt,/RELEASE_DESK_IMPORT/);assert.match(prompt,/已有工程上架清单.md/);
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const shot=process.env.RELEASE_QA_DIR;if(shot)await page.screenshot({path:path.join(shot,'ai-project-import.png')});
  const pending=page.waitForEvent('download');await page.locator('#downloadAIImport').click();const download=await pending;assert.equal(download.suggestedFilename(),'已有工程-AI采集说明.md');assert.equal(fs.readFileSync(await download.path(),'utf8'),prompt);await page.locator('#aiImportDialog').waitFor({state:'hidden'});assert.equal(await page.locator('#createDialog').isVisible(),true);
  await page.locator('#openAIImport').click();await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('blocked');}}}));await page.locator('#copyAIImport').click();assert.equal(await page.locator('#aiImportDialog').isVisible(),true);assert.match(await page.locator('#aiImportError').innerText(),/手动复制/);
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.copiedImportPrompt=text;}}}));await page.locator('#copyAIImport').click();await page.locator('#aiImportDialog').waitFor({state:'hidden'});assert.equal(await page.evaluate(()=>window.copiedImportPrompt),prompt);
  const metadata=JSON.parse(prompt.match(/<!-- RELEASE_DESK_IMPORT\n([\s\S]*?)\n-->/)[1]);metadata.release={app:'已有工程',platform:'Android',appIdAndroid:'org.example.existing',version:'3.2',build:'32',strictValidation:'on'};metadata.features.hasPush=true;metadata.permissions={selected:['camera'],descs:{camera:'扫描二维码'},descsEn:{camera:'Scan QR codes'}};
  await page.locator('#createForm [name=name]').fill('已有工程');await page.locator('#createForm [name=file]').setInputFiles({name:'invalid.md',mimeType:'text/markdown',buffer:Buffer.from('# App\n<!-- RELEASE_DESK_IMPORT invalid -->\n## Tasks\n- [ ] Check')});await page.locator('#createForm [type=submit]').click();await page.waitForFunction(()=>document.getElementById('createError').textContent.includes('JSON'));assert.equal(await page.locator('#createDialog').isVisible(),true);assert.equal(await page.evaluate(()=>PagesStore.list().length),0);
  const document='# 已有工程\n<!-- RELEASE_DESK_IMPORT\n'+JSON.stringify(metadata)+'\n-->\n## 工程配置与源码依据\n| 配置项 | 实际值 | 源码依据 | 确认状态 |\n| --- | --- | --- | --- |\n| Android 应用标识 | org.example.existing | app/build.gradle:12 | 已确认 |\n## 上架检查清单\n- [ ] 真机验证推送\n- [ ] 核对生产构建\n';
  await page.locator('#createForm [name=file]').setInputFiles({name:'已有工程上架清单.md',mimeType:'text/markdown',buffer:Buffer.from(document)});await page.locator('#createForm [type=submit]').click();await page.waitForURL(/board.html/);await page.waitForFunction(()=>window.ReleaseBoardLoaded&&typeof online!=='undefined'&&online);
  const project=await page.evaluate(()=>PagesStore.get(PagesStore.projectId()));assert.equal(project.review.release.appIdAndroid,'org.example.existing');assert.equal(project.review.release.version,'3.2');assert.equal(project.permissions.descs.camera,'扫描二维码');assert.doesNotMatch(project.document,/RELEASE_DESK_IMPORT/);assert.equal(await page.evaluate(()=>PagesStore.parse(PagesStore.get(PagesStore.projectId()).document).features.hasPush),true);assert.equal(await page.evaluate(()=>PagesStore.payload(PagesStore.get(PagesStore.projectId())).gateDone),false);assert.deepEqual(errors,[]);
  console.log('AI import browser checks passed: instructions, download/copy, failure retention, mobile layout and source Markdown import.');
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
