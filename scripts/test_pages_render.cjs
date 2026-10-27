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
  const heading=()=>page.getByRole('heading').filter({hasText:/用户反馈.*feedbackApiKey/});
  const verifyHidden=async()=>{
   await page.waitForFunction(()=>typeof online!=='undefined'&&online);
   assert.equal(await heading().count(),0,'反馈默认关闭时，初始化/重建/刷新都不能显示反馈小节');
   assert.equal(await page.locator('li.item').filter({hasText:/feedbackApiKey.*已替换为正式 Key/}).count(),0,'隐藏的反馈条目不能留在 DOM 中');
   const numbers=await page.locator('#list li.item:not(.gateitem) .seq').allTextContents();assert.deepEqual(numbers.map(Number),numbers.map((_,i)=>i+1));
  };
  await verifyHidden();await page.reload();await verifyHidden();
  await page.locator('#btnFeat').click();assert.equal(await page.locator('#featFeedback').isChecked(),false);assert.equal(await heading().count(),0);await page.locator('#featCancel').click();
  await page.evaluate(()=>persistReview({...reviewData,release:{version:'1'}}));await verifyHidden();
  for(const enabled of [true,false]){
   await page.locator('#btnFeat').click();await page.locator('#featFeedback').setChecked(enabled);await page.locator('#featAcc').uncheck();await page.locator('#featMinor').uncheck();await page.locator('#featSave').click();await page.waitForFunction(()=>!document.getElementById('featPanel').classList.contains('on'));
   assert.equal(await heading().count(),enabled?1:0);await page.reload();await page.waitForFunction(()=>typeof online!=='undefined'&&online);assert.equal(await heading().count(),enabled?1:0);
   assert.equal(await page.getByRole('heading').filter({hasText:'账号注销与数据主体权利'}).count(),0);
  }
  await verifyHidden();assert.deepEqual(errors,[]);console.log('Pages DOM regression passed: initialization, reload, settings, review rebuild and continuous numbering.');
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
