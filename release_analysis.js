/* Pure configuration checks and release comparison. Raw input files are never persisted. */
(function(root){
'use strict';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function basis(snapshot){const r=snapshot.release||{};return JSON.stringify({platform:r.platform||'',appIdIOS:r.appIdIOS||'',appIdAndroid:r.appIdAndroid||'',version:r.version||'',build:r.build||'',environment:r.environment||'production',apiBaseUrl:r.apiBaseUrl||'',permissions:[...(snapshot.selectedPermissions||snapshot.permissions?.selected||[])].sort()});}
function safeURL(value){try{if(!value)return '';const url=new URL(String(value));if(!['http:','https:'].includes(url.protocol))return '[无效URL]';url.username='';url.password='';url.search='';url.hash='';return url.href;}catch(_){return value?'[无效URL]':'';}}
function parseFile(name,text){
 if(typeof text!=='string'||text.length>2000000)throw Error('配置文件应为小于 2 MB 的文本');
 const lower=name.toLowerCase();let facts={},platform='common',kind='';
 if(lower.endsWith('.json')){
  const value=JSON.parse(text),v=value.expo||value;kind='json';
  const choose=(...keys)=>keys.map(k=>v[k]).find(x=>typeof x==='string'||typeof x==='number');
  facts={applicationId:String(choose('applicationId','bundleIdentifier','package')||v.ios?.bundleIdentifier||v.android?.package||''),version:String(choose('versionName','version')||''),build:String(choose('versionCode','buildNumber','build')||''),environment:String(choose('environment','env','APP_ENV')||''),apiBaseUrl:safeURL(choose('apiBaseUrl','API_BASE_URL','baseUrl')||''),permissions:Array.isArray(v.permissions)?v.permissions.filter(p=>typeof p==='string'):v.android?.permissions||[]};
  const explicit=String(v.platform||'').toLowerCase();platform=explicit==='ios'||v.ios&&!v.android?'ios':explicit==='android'||v.android&&!v.ios?'android':'common';
 }else if(lower.endsWith('.env')||lower.startsWith('.env')||lower.endsWith('.properties')){
  kind='environment';const allowed={APP_ENV:'environment',ENVIRONMENT:'environment',NODE_ENV:'environment',API_BASE_URL:'apiBaseUrl',BASE_URL:'apiBaseUrl',APPLICATION_ID:'applicationId',VERSION_NAME:'version',VERSION_CODE:'build'};
  for(const line of text.split(/\r?\n/)){const m=line.match(/^\s*(?:export\s+)?([A-Z_]+)\s*=\s*(.*?)\s*$/);if(m&&allowed[m[1]]){let value=m[2].replace(/\s+#.*$/,'').replace(/^(['"])(.*)\1$/,'$2');facts[allowed[m[1]]]=m[1].includes('URL')?safeURL(value):value.slice(0,1000);}}
 }else{
  if(!root.DOMParser)throw Error('XML 预检需要浏览器 XML 解析器');
  const doc=new root.DOMParser().parseFromString(text,'application/xml');if(doc.querySelector('parsererror'))throw Error('XML 格式无效或二进制 plist，请导出为文本 XML');
  if(doc.documentElement.tagName==='plist'){
   kind='plist';platform='ios';const values={};for(const key of [...(doc.documentElement.children[0]?.children||[])].filter(el=>el.tagName==='key')){const next=key.nextElementSibling;if(next&&next.tagName==='string')values[key.textContent]=next.textContent;}
   facts={applicationId:values.CFBundleIdentifier||'',version:values.CFBundleShortVersionString||'',build:values.CFBundleVersion||'',usageDescriptions:Object.fromEntries(Object.entries(values).filter(([k])=>/^NS.*UsageDescription$/.test(k)))};
  }else if(doc.documentElement.tagName==='manifest'){
   kind='manifest';platform='android';const manifest=doc.documentElement,attr=(el,key)=>el.getAttributeNS('http://schemas.android.com/apk/res/android',key)||el.getAttribute('android:'+key)||'';
   facts={applicationId:manifest.getAttribute('package')||'',version:attr(manifest,'versionName'),build:attr(manifest,'versionCode'),permissions:[...doc.querySelectorAll('uses-permission,uses-permission-sdk-23')].map(el=>attr(el,'name'))};
  }else throw Error('支持 Info.plist、AndroidManifest.xml、JSON 及环境配置文件');
 }
 for(const key of ['applicationId','version','build','environment','apiBaseUrl'])if(facts[key]!==undefined&&typeof facts[key]!=='string')throw Error('配置字段应为文本或数字');
 if(facts.permissions&&(!Array.isArray(facts.permissions)||facts.permissions.some(p=>typeof p!=='string')))throw Error('permissions 必须是字符串数组');
 return {name:String(name).slice(0,200),platform,kind,facts};
}
function preflight(files,snapshot,profiles,date=new Date().toISOString()){
 if(!files.length)throw Error('请至少选择一个配置文件');if(files.length>20)throw Error('每次最多预检 20 个配置文件');
 const findings=[],release=snapshot.release||{},add=(severity,file,field,expected,actual,message)=>findings.push({severity,file,field,expected:String(expected??''),actual:String(actual??''),message});
 const selected=new Set(snapshot.selectedPermissions||snapshot.permissions?.selected||[]),chosen=(profiles.permissions||[]).filter(p=>selected.has(p.id)),platform=String(release.platform||'').toLowerCase();
 for(const file of files){
  const f=file.facts;
  if(['ios','android'].includes(platform)&&file.platform!=='common'&&file.platform!==platform)add('warning',file.name,'platform',platform,file.platform,'文件属于另一平台');
  const expectedId=file.platform==='ios'?release.appIdIOS:file.platform==='android'?release.appIdAndroid:release.appIdIOS===release.appIdAndroid?release.appIdIOS:'';
  for(const [key,expected] of [['applicationId',expectedId],['version',release.version],['build',release.build],['environment',release.environment||'production'],['apiBaseUrl',safeURL(release.apiBaseUrl||'')]]){
   if(!(key in f))continue;const actual=f[key];
   if(/\$\(|\$\{|\[.*\]|YOUR_|TODO/i.test(actual))add('error',file.name,key,expected,actual,'配置包含未解析占位符');
   else if(!actual&&['applicationId','version','build'].includes(key))add('warning',file.name,key,expected,actual,'未提供该字段，请核对最终构建产物');
   else if(expected&&String(actual)!==String(expected))add('error',file.name,key,expected,actual,'与发布配置不一致');
  }
  if(f.apiBaseUrl&&/localhost|127\.0\.0\.1|sandbox|staging|(?:^|[./_-])dev(?:[./_-]|$)/i.test(f.apiBaseUrl)&&(!release.environment||release.environment==='production'))add('error',file.name,'apiBaseUrl','正式环境地址',f.apiBaseUrl,'正式发布仍使用测试地址');
  if(file.kind==='manifest'){
   const expected=chosen.map(p=>p.android?.manifest).filter(Boolean);for(const permission of expected)if(!f.permissions.includes(permission))add('error',file.name,'permissions',permission,'未声明','所选权限缺少 Manifest 声明');
   const known=new Set(expected);for(const permission of f.permissions)if(!known.has(permission))add('warning',file.name,'permissions','工作台选中的权限',permission,'配置中存在工作台未选择的声明，请核对是否必要');
  }
  if(file.kind==='plist'){
   const expected=chosen.flatMap(p=>p.ios?.infoplist_keys?.map(k=>k.key)||(p.ios?.infoplist_key?[p.ios.infoplist_key]:[]));
   for(const key of expected)if(!String(f.usageDescriptions[key]||'').trim())add('error',file.name,key,'非空用途说明',f.usageDescriptions[key]||'','所选权限缺少用途说明');
   for(const [key,value] of Object.entries(f.usageDescriptions))if(!String(value).trim()||/TODO|YOUR_|\[.*\]/i.test(value))add('error',file.name,key,'已填写并核验的用途说明',value,'用途说明为空或含占位符');
  }
 }
 for(let a=0;a<files.length;a++)for(let b=a+1;b<files.length;b++)if(files[a].platform===files[b].platform)for(const field of ['applicationId','version','build','environment','apiBaseUrl']){const x=files[a].facts[field],y=files[b].facts[field];if(x&&y&&x!==y)add('error',files[b].name,field,x,y,'与同平台文件 '+files[a].name+' 不一致');}
 return {id:root.crypto?.randomUUID?.()||String(Date.now()),date,basis:basis(snapshot),files,findings,errors:findings.filter(f=>f.severity==='error').length,warnings:findings.filter(f=>f.severity==='warning').length};
}
function compare(before,after){
 const changes=[];const add=(area,id,kind,oldValue,newValue)=>changes.push({area,id,kind,before:oldValue??null,after:newValue??null});
 const objects=(area,left,right)=>{for(const id of new Set([...Object.keys(left||{}),...Object.keys(right||{})]))if(!same(left?.[id],right?.[id]))add(area,id,!(id in (left||{}))?'added':!(id in (right||{}))?'removed':'changed',left?.[id],right?.[id]);};
 objects('发布信息',before.release,after.release);objects('功能',before.features,after.features);
 const permissions=s=>Object.fromEntries((s.selectedPermissions||s.permissions?.selected||[]).map(id=>[id,{selected:true,description:s.permissions?.descs?.[id]||'',descriptionEn:s.permissions?.descsEn?.[id]||''}]));objects('权限',permissions(before),permissions(after));
 const items=s=>Object.fromEntries((s.items||[]).map(i=>[i.id,Object.fromEntries(['text','state','applicable','required','evidenceRequired','evidence','attachmentIds','evidenceExpiresAt','reason','notes','exceptionType','exceptionOwner','reviewDue','approvalStatus','approvalBy','reviewStatus'].filter(k=>i[k]!==undefined).map(k=>[k,i[k]]))]));objects('检查项',items(before),items(after));
 const products=s=>Object.fromEntries((s.subscriptions||[]).map((p,index)=>[p.id||p.iosProductId||p.androidProductId||String(index),p]));objects('订阅商品',products(before),products(after));objects('证据附件',before.evidenceFiles,after.evidenceFiles);objects('配置预检',before.preflight?{result:before.preflight}: {},after.preflight?{result:after.preflight}:{});
 return {format:'release-desk-diff/v1',date:new Date().toISOString(),changes};
}
root.ReleaseAnalysis={parseFile,preflight,compare,basis,safeURL};
})(typeof window==='undefined'?globalThis:window);
