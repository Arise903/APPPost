/* Fixed whole-page/modal screenshots. UPDATE_VISUAL=1 deliberately accepts reviewed changes. */
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const project=path.resolve(__dirname,'..'),root=path.join(project,'docs'),assets=path.join(project,'tests/visual');
const output=path.resolve(process.env.RELEASE_QA_DIR||path.join(project,'artifacts/visual'));
fs.mkdirSync(output,{recursive:true});
const server=http.createServer((req,res)=>{try{const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);const base=name.startsWith('/visual/')?assets:root;const target=path.resolve(base,name.replace(/^\/(APPPost|visual)\//,'')||'index.html');if(!target.startsWith(base+path.sep))throw Error();res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.woff2':'font/woff2'})[path.extname(target)]||'application/octet-stream');res.end(fs.readFileSync(target));}catch(_){res.writeHead(404).end();}});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;try{
 browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
 const base='http://127.0.0.1:'+server.address().port+'/APPPost/',errors=[];
 for(const [label,width,height] of [['desktop',1280,900],['mobile',390,844]]){
  const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1,locale:'zh-CN',timezoneId:'Asia/Shanghai',reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.message));
  await page.clock.setFixedTime(new Date('2026-10-30T08:00:00Z'));
  await page.goto(base);await page.waitForFunction(()=>document.getElementById('projectCount').textContent==='0');
  const id=await page.evaluate(()=>PagesStore.create({name:'发布检查示例',document:'# 应用发布检查\n## 发布准备\n- [x] 应用标识、版本和构建号与商店记录一致 <!-- task:identity -->\n- [-] 当前版本不适用的渠道设置 <!-- task:channel -->\n- [ ] 正式构建使用已核验的生产环境地址 <!-- task:environment -->\n- [ ] 隐私政策与实际数据处理一致 <!-- task:privacy -->\n## 核心验证\n- [ ] 核心流程已在目标设备完成验证 <!-- task:flow -->\n- [ ] 商店素材、描述、支持地址已准备 <!-- task:store -->\n- [ ] 发布负责人、目标日期和回退方案已确认 <!-- task:owner -->\n',review:{release:{app:'示例应用',version:'2.0',build:'42',platform:'iOS / Android',owner:'发布负责人',targetDate:'2026-11-20'},items:{identity:{notes:'已核对正式包与商店记录。'},channel:{reason:'当前版本不发布此渠道。'},flow:{evidenceRequired:'on'}},history:[],subscriptions:[{id:'monthly',name:'月订阅',period:'month',periodCount:'1',currency:'CNY',price:'18.50',trialEnabled:'off',trialCount:'7',trialUnit:'day',offerEnabled:'off',offerType:'intro',paymentMode:'recurring',offerPrice:'6.00',offerPeriod:'month',offerPeriodCount:'1',offerCycles:'3'}]}}));
  await page.goto(base+'board.html?id='+id);await page.waitForFunction(()=>typeof online!=='undefined'&&online&&window.ReleaseWorkflowBooted);
  await page.addStyleTag({content:'@font-face{font-family:Visual;font-weight:100 900;src:url(/visual/font.woff2)}#toast,.version-label{visibility:hidden!important}*{font-family:Visual,sans-serif!important;font-synthesis:none!important;animation:none!important;transition:none!important;caret-color:transparent!important}'});await page.evaluate(()=>document.fonts.ready);
  async function snap(name,fullPage=false){await page.mouse.move(0,0);await page.evaluate(()=>document.fonts.ready);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,name+' overflow');await page.screenshot({path:path.join(output,label+'-'+name+'.png'),fullPage,animations:'disabled'});}
  async function command(id){const c=page.locator(id),menu=await c.evaluate(el=>el.closest('details.board-menu')?.id);if(menu&&!await page.locator('#'+menu).evaluate(el=>el.open))await page.locator('#'+menu+'>summary').click();await c.click();}
  assert.equal(await page.locator('#recoveryActions').isVisible(),false);
  await snap('board',true);
  await page.locator('#viewMode').selectOption('focus');await snap('focus',true);await page.locator('#viewMode').selectOption('all');
  await page.locator('li[data-id=flow] .item-title').click();await snap('details');await page.locator('#itemReviewClose').click();
  await command('#btnSubscriptions');await snap('subscription-off');
  await page.locator('[data-field=trialEnabled]').selectOption('on');await page.locator('[data-field=offerEnabled]').selectOption('on');await page.locator('[data-field=trialEnabled]').evaluate(el=>el.closest('label').scrollIntoView({block:'start'}));await snap('subscription-on');await page.locator('[data-field=offerEnabled]').evaluate(el=>el.closest('label').scrollIntoView({block:'start'}));await snap('promotion-on');
  page.once('dialog',d=>d.accept());await page.locator('#subscriptionClose').click();
  await command('#btnFeat');await snap('features');await page.locator('#featCancel').click();
  await command('#releaseEdit');await snap('release');await page.locator('#releaseEditCancel').click();
  await page.evaluate(()=>{saveFailure='网络暂时不可用';saveConflict=true;updateSaveStatus();});await snap('conflict',true);
  await page.close();
 }
 assert.deepEqual(errors,[]);
 if(process.env.UPDATE_VISUAL==='1'){fs.mkdirSync(path.join(assets,'reference'),{recursive:true});for(const name of fs.readdirSync(output).filter(n=>/^(desktop|mobile)-.*\.png$/.test(n)))fs.copyFileSync(path.join(output,name),path.join(assets,'reference',name));console.log('Visual references updated; review PNGs before committing.');}
 else execFileSync(process.env.VISUAL_PYTHON||'python3',[path.join(__dirname,'compare_visual.py'),path.join(assets,'reference'),output],{stdio:'inherit'});
}finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}})().catch(e=>{console.error(e);process.exitCode=1;});
