/* Subscription catalogue: saved with review metadata for backup, sync and release archives. */
const subscriptionDialog=document.getElementById('subscriptionDialog');
const subscriptionForm=document.getElementById('subscriptionForm');
const subscriptionProducts=document.getElementById('subscriptionProducts');
const subscriptionPeriods=[['week','周'],['month','月'],['year','年'],['day','天'],['custom','自定义']];
const subscriptionFields=[
 ['基本信息',[
  ['name','商品名称','text'],['period','订阅周期',subscriptionPeriods],['periodCount','周期数量','integer'],
  ['customPeriod','自定义周期说明','text'],['status','销售状态',[['draft','草稿'],['review','待审核'],['active','在售'],['off','停售']]],
  ['platform','适用平台',[['both','iOS / Android'],['ios','iOS'],['android','Android']]],
  ['iosProductId','iOS 商品 ID','text'],['androidProductId','Android 商品 ID','text'],['basePlanId','Android 基础方案 ID','text'],
  ['group','订阅分组 / 权益档位','text'],['currency','币种（如 CNY / USD）','currency'],['price','标准订阅金额','money'],
  ['territories','销售地区（如 CN、US）','text'],['familySharing','家庭共享',[['off','关闭'],['on','开启']]],['renewal','续订方式',[['auto','自动续订'],['manual','非自动续订']]],
  ['benefits','商品权益','textarea']]],
 ['免费试用',[
  ['trialEnabled','免费试用',[['off','关闭'],['on','开启']]],['trialCount','试用周期数量','integer'],['trialUnit','试用周期单位',subscriptionPeriods.slice(0,4)],
  ['trialEligibility','试用领取资格 / 次数限制','text']]],
 ['优惠 / 促销',[
  ['offerEnabled','优惠状态',[['off','关闭'],['on','开启']]],['offerId','优惠 / Offer ID','text'],
  ['offerType','优惠类型',[['intro','首次订阅优惠'],['promo','促销优惠'],['winback','回流优惠'],['code','优惠码']]],
  ['paymentMode','优惠计费方式',[['recurring','每周期优惠价'],['upfront','优惠期一次付清'],['free','免费优惠']]],
  ['offerPrice','优惠实付金额（所选币种）','money'],['discountAmount','减免金额（所选币种）','money'],
  ['offerPeriodCount','每次优惠周期数量','integer'],['offerPeriod','优惠周期单位',subscriptionPeriods],['offerCustomPeriod','自定义优惠周期说明','text'],
  ['offerCycles','优惠持续次数','integer'],['offerStart','优惠开始时间','datetime-local'],['offerEnd','优惠结束时间','datetime-local'],
  ['offerTimezone','优惠时区（如 Asia/Shanghai）','text'],['offerLimit','每用户可享次数','integer'],
  ['offerEligibility','优惠适用用户 / 资格','text'],['stacking','试用与优惠叠加规则','textarea'],['notes','其他配置 / 升降级 / 价格变更备注','textarea']]]
];
let subscriptionDraft=[],subscriptionBaseline='',subscriptionFocus=null,subscriptionSaving=false;
const subscriptionEnabled=document.getElementById('subscriptionEnabled');
function subscriptionState(){return {enabled:subscriptionEnabled.checked,products:subscriptionRead()};}
function subscriptionHasChanges(){return subscriptionDialog.open&&JSON.stringify(subscriptionState())!==subscriptionBaseline;}
function subscriptionRead(){return Array.from(subscriptionProducts.querySelectorAll('[data-subscription-product]')).map(card=>{const product={...subscriptionDraft[Number(card.dataset.subscriptionProduct)]};card.querySelectorAll('[data-field]').forEach(input=>product[input.dataset.field]=input.value.trim());return product;});}
function subscriptionConditions(){
 const enabled=subscriptionEnabled.checked;
 document.getElementById('subscriptionConfiguration').classList.toggle('subscription-off',!enabled);
 subscriptionForm.querySelectorAll('[data-add-subscription]').forEach(button=>button.disabled=!enabled||subscriptionSaving);
 for(const card of subscriptionProducts.querySelectorAll('[data-subscription-product]')){
  const get=key=>card.querySelector('[data-field="'+key+'"]')?.value;
  for(const label of card.querySelectorAll('[data-field-label]')){const key=label.dataset.fieldLabel;let visible=true;
   if(label.dataset.group==='trial'&&key!=='trialEnabled')visible=get('trialEnabled')==='on';
   if(label.dataset.group==='offer'&&key!=='offerEnabled')visible=get('offerEnabled')==='on';
   if(key==='customPeriod')visible=get('period')==='custom';
   if(key==='offerCustomPeriod')visible=visible&&get('offerPeriod')==='custom';
   if(key==='offerPrice')visible=visible&&get('paymentMode')!=='free';
   label.hidden=!visible;label.querySelectorAll('input,select,textarea').forEach(input=>input.disabled=!enabled||!visible||subscriptionSaving);
  }
  card.querySelector('[data-remove-product]').disabled=!enabled||subscriptionSaving;
 }
}
function subscriptionRender(){
 subscriptionProducts.replaceChildren();
 if(!subscriptionDraft.length){const empty=document.createElement('p');empty.className='subscription-empty';empty.textContent='暂无订阅商品。开启订阅后，选择周期添加商品。';subscriptionProducts.append(empty);}
 subscriptionDraft.forEach((product,index)=>{
  const card=document.createElement('details');card.className='subscription-product';card.dataset.subscriptionProduct=index;card.open=true;
  const summary=document.createElement('summary');summary.textContent=(product.name||'未命名商品')+' · '+(subscriptionPeriods.find(p=>p[0]===product.period)?.[1]||'自定义')+'订阅';card.append(summary);
  for(const [heading,fields] of subscriptionFields){const title=document.createElement('h3');title.textContent=heading;card.append(title);const grid=document.createElement('div');grid.className='subscription-grid';
   const group=heading==='免费试用'?'trial':heading==='优惠 / 促销'?'offer':'basic';
   for(const [key,caption,type] of fields){const label=document.createElement('label');label.textContent=caption;label.dataset.fieldLabel=key;label.dataset.group=group;let input;
    if(Array.isArray(type)){input=document.createElement('select');for(const [value,text] of type)input.add(new Option(text,value));}
    else{input=document.createElement(type==='textarea'?'textarea':'input');if(type!=='textarea'){input.type=['integer','money'].includes(type)?'number':type==='currency'?'text':type;if(type==='integer'){input.min='1';input.step='1';}if(type==='money'){input.min='0';input.step='any';}}else label.className='subscription-wide';input.maxLength=type==='textarea'?4000:500;}
    input.dataset.field=key;input.value=product[key]??(['trialEnabled','offerEnabled'].includes(key)?'off':'');if(key==='name')input.required=true;if(key==='currency'){input.pattern='[A-Z]{3}';input.maxLength=3;}
    input.setAttribute('aria-label',caption);label.append(input);grid.append(label);
   }card.append(grid);
  }
  const remove=document.createElement('button');remove.type='button';remove.className='btn danger';remove.dataset.removeProduct='';remove.textContent='删除此商品';remove.onclick=()=>{if(!confirm('删除此订阅商品？保存后生效。'))return;subscriptionDraft=subscriptionRead();subscriptionDraft.splice(index,1);subscriptionRender();subscriptionUpdateStatus();};card.append(remove);subscriptionProducts.append(card);
 });subscriptionConditions();
}
function subscriptionUpdateStatus(){subscriptionConditions();document.getElementById('subscriptionStatus').textContent=JSON.stringify(subscriptionState())===subscriptionBaseline?'已保存 · '+(subscriptionEnabled.checked?'已启用 · '+subscriptionDraft.length+' 个商品':'未启用订阅'):'有未保存的订阅设置';document.getElementById('subscriptionError').textContent='';setTimeout(updateSaveStatus,0);}
function subscriptionClose(){if(subscriptionSaving)return;if(subscriptionHasChanges()&&!confirm('放弃尚未保存的订阅设置与商品修改？'))return;subscriptionDialog.close();updateSaveStatus();subscriptionFocus?.focus();}
document.getElementById('btnSubscriptions').onclick=()=>{subscriptionFocus=document.activeElement;subscriptionDraft=JSON.parse(JSON.stringify(reviewData.subscriptions||[]));subscriptionEnabled.checked=DATA?.features?.hasSubscriptions!==false;subscriptionRender();subscriptionBaseline=JSON.stringify(subscriptionState());subscriptionUpdateStatus();subscriptionDialog.showModal();};
document.getElementById('subscriptionClose').onclick=subscriptionClose;document.getElementById('subscriptionCancel').onclick=subscriptionClose;
subscriptionDialog.addEventListener('cancel',event=>{event.preventDefault();subscriptionClose();});
subscriptionForm.addEventListener('input',subscriptionUpdateStatus);subscriptionForm.addEventListener('change',subscriptionUpdateStatus);
subscriptionForm.querySelectorAll('[data-add-subscription]').forEach(button=>button.onclick=()=>{subscriptionDraft=subscriptionRead();subscriptionDraft.push({id:crypto.randomUUID(),name:({week:'周订阅',month:'月订阅',year:'年订阅',custom:'自定义订阅'})[button.dataset.addSubscription],period:button.dataset.addSubscription,periodCount:'1',status:'draft',platform:'both',currency:'CNY',price:'',familySharing:'off',renewal:'auto',trialEnabled:'off',trialUnit:'day',offerEnabled:'off',offerType:'intro',paymentMode:'recurring',offerPeriod:'month',offerTimezone:ReleaseReadiness.DEFAULT_TIME_ZONE});subscriptionRender();subscriptionUpdateStatus();subscriptionProducts.lastElementChild.scrollIntoView({block:'nearest'});});
function subscriptionValidate(products){
 const ids=new Set();
 for(const product of products){
  if(!product.name)throw Error('请填写商品名称');
  if(!/^[A-Z]{3}$/.test(product.currency))throw Error(product.name+'：请填写三位大写币种代码');
  for(const [heading,fields] of subscriptionFields)for(const [key,label,type] of fields){if(heading==='免费试用'&&product.trialEnabled!=='on'||heading==='优惠 / 促销'&&product.offerEnabled!=='on')continue;const value=product[key];if(value&&type==='money'&&(!Number.isFinite(Number(value))||Number(value)<0))throw Error(product.name+'：'+label+'必须是非负金额');if(value&&type==='integer'&&(!Number.isSafeInteger(Number(value))||Number(value)<1))throw Error(product.name+'：'+label+'必须是正整数');}
  if(!product.periodCount)throw Error(product.name+'：请填写周期数量');
  if(product.period==='custom'&&!product.customPeriod)throw Error(product.name+'：请填写自定义周期说明');
  if(product.trialEnabled==='on'&&!product.trialCount)throw Error(product.name+'：请填写试用周期数量');
  if(product.offerEnabled==='on'){
   if(!product.offerPeriodCount||!product.offerCycles)throw Error(product.name+'：请填写优惠周期和持续次数');
   if(product.paymentMode!=='free'&&product.offerPrice==='')throw Error(product.name+'：请填写优惠实付金额');
   if(product.offerPeriod==='custom'&&!product.offerCustomPeriod)throw Error(product.name+'：请填写自定义优惠周期');
   if((product.offerStart||product.offerEnd)&&!product.offerTimezone)throw Error(product.name+'：请填写优惠时区');
   if(product.offerStart&&product.offerEnd&&product.offerEnd<=product.offerStart)throw Error(product.name+'：优惠结束时间必须晚于开始时间');
  }
  for(const key of ['iosProductId','androidProductId'])if(product[key]){const id=key+':'+product[key]+(key==='androidProductId'?':'+product.basePlanId:'');if(ids.has(id))throw Error(product.name+'：商品 ID / 基础方案重复');ids.add(id);}
 }
}
subscriptionForm.onsubmit=async event=>{
 event.preventDefault();if(subscriptionSaving)return;
 try{const products=subscriptionRead();if(subscriptionEnabled.checked)subscriptionValidate(products);if(!online)throw Error('请先连接存储服务');subscriptionSaving=true;subscriptionForm.querySelectorAll('button,input,select,textarea').forEach(input=>input.disabled=true);
  const d=await api('/api/subscriptions',{enabled:subscriptionEnabled.checked,products});
  reviewData=d.review;DATA=mergeItems(d);serverBaseline=baselineFromData(d);updateSummaryReleaseOptions();render();refreshFeatUI();markDirty();saveState();subscriptionDraft=JSON.parse(JSON.stringify(products));subscriptionBaseline=JSON.stringify(subscriptionState());subscriptionUpdateStatus();toast('订阅设置与商品已保存');
 }catch(error){showFormSaveFailure(document.getElementById('subscriptionError'),subscriptionForm,error.message);}
 finally{subscriptionSaving=false;subscriptionForm.querySelectorAll('button,input,select,textarea').forEach(input=>input.disabled=false);subscriptionConditions();updateSaveStatus();}
};
document.getElementById('subscriptionExport').onclick=()=>{const products=subscriptionRead();const url=URL.createObjectURL(new Blob([JSON.stringify({format:'release-desk-subscriptions/v1',enabled:subscriptionEnabled.checked,products},null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='订阅商品配置.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
window.addEventListener('beforeunload',event=>{if(subscriptionHasChanges()){event.preventDefault();event.returnValue='';}});
