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
let subscriptionUsage;
const subscriptionEditableFields=new Set(['iosProductId','androidProductId','currency','price','period','periodCount','customPeriod']);
function subscriptionRequiredFields(product){const platform=product.platform||subscriptionProjectPlatform();return new Set(['currency','price','period','periodCount',...(platform==='ios'?['iosProductId']:platform==='android'?['androidProductId']:['iosProductId','androidProductId']),...(product.period==='custom'?['customPeriod']:[])]);}
function subscriptionProjectPlatform(){const value=String(reviewData.release?.platform||'').toLowerCase();return ['ios','android'].includes(value)?value:'both';}
function subscriptionPeriodName(product){return product.period==='custom'?(product.customPeriod||'自定义订阅'):(product.periodCount==='1'?'':product.periodCount||'')+({day:'天订阅',week:'周订阅',month:'月订阅',year:'年订阅'}[product.period]||'订阅');}
let subscriptionDraft=[],subscriptionBaseline='',subscriptionFocus=null,subscriptionSaving=false;
const subscriptionEnabled=document.getElementById('subscriptionEnabled');
function subscriptionState(){return {enabled:subscriptionEnabled.checked,featureState:subscriptionUsage?.value||(subscriptionEnabled.checked?'on':'off'),products:subscriptionRead()};}
function subscriptionHasChanges(){return subscriptionDialog.open&&JSON.stringify(subscriptionState())!==subscriptionBaseline;}
function subscriptionRead(){return Array.from(subscriptionProducts.querySelectorAll('[data-subscription-product]')).map(card=>{const product={...subscriptionDraft[Number(card.dataset.subscriptionProduct)]};card.querySelectorAll('[data-field]').forEach(input=>{if(subscriptionEditableFields.has(input.dataset.field))product[input.dataset.field]=input.value.trim();});if(product.nameGenerated==='on')product.name=subscriptionPeriodName(product);return product;});}
function subscriptionConditions(){
 const enabled=subscriptionEnabled.checked;
 document.getElementById('subscriptionConfiguration').classList.toggle('subscription-off',!enabled);
 subscriptionForm.querySelectorAll('[data-add-subscription]').forEach(button=>button.disabled=!enabled||subscriptionSaving);
 for(const card of subscriptionProducts.querySelectorAll('[data-subscription-product]')){
  const get=key=>card.querySelector('[data-field="'+key+'"]')?.value;const product={...subscriptionDraft[Number(card.dataset.subscriptionProduct)],period:get('period'),platform:get('platform')};const required=subscriptionRequiredFields(product);const platform=product.platform||subscriptionProjectPlatform();
  for(const label of card.querySelectorAll('[data-field-label]')){const key=label.dataset.fieldLabel;let visible=true;
   if(label.dataset.group==='trial'&&key!=='trialEnabled')visible=get('trialEnabled')==='on';
   if(label.dataset.group==='offer'&&key!=='offerEnabled')visible=get('offerEnabled')==='on';
   if(key==='customPeriod')visible=get('period')==='custom';
   if(key==='offerCustomPeriod')visible=visible&&get('offerPeriod')==='custom';
   if(key==='offerPrice')visible=visible&&get('paymentMode')!=='free';
   if(key==='iosProductId'&&platform==='android'||key==='androidProductId'&&platform==='ios')visible=false;
   label.hidden=!visible;const editable=subscriptionEditableFields.has(key);label.classList.toggle('subscription-readonly',!editable);label.querySelector('.required-mark').hidden=!required.has(key);label.querySelectorAll('input,select,textarea').forEach(input=>{input.disabled=!enabled||!visible||subscriptionSaving||!editable;input.required=required.has(key)&&editable&&visible;});
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
   for(const [key,caption,type] of fields){const label=document.createElement('label');const star=document.createElement('span');star.className='required-mark';star.textContent='* ';star.setAttribute('aria-hidden','true');const captionText=document.createElement('span');captionText.textContent=caption;const captionLine=document.createElement('span');captionLine.className='field-caption';captionLine.append(star,captionText);label.append(captionLine);label.dataset.fieldLabel=key;label.dataset.group=group;let input;
    if(Array.isArray(type)){input=document.createElement('select');for(const [value,text] of type)input.add(new Option(text,value));}
    else{input=document.createElement(type==='textarea'?'textarea':'input');if(type!=='textarea'){input.type=['integer','money'].includes(type)?'number':type==='currency'?'text':type;if(type==='integer'){input.min='1';input.step='1';}if(type==='money'){input.min='0';input.step='any';}}else label.className='subscription-wide';input.maxLength=type==='textarea'?4000:500;}
    input.dataset.field=key;input.value=product[key]??(['trialEnabled','offerEnabled'].includes(key)?'off':'');if(key==='currency'){input.pattern='[A-Z]{3}';input.maxLength=3;}
    input.setAttribute('aria-label',caption);label.append(input);grid.append(label);
   }card.append(grid);
  }
  const remove=document.createElement('button');remove.type='button';remove.className='btn danger';remove.dataset.removeProduct='';remove.textContent='删除此商品';remove.onclick=async()=>{if(!await releaseDialog('删除此订阅商品？保存后生效。'))return;subscriptionDraft=subscriptionRead();subscriptionDraft.splice(index,1);subscriptionRender();subscriptionUpdateStatus();};card.append(remove);subscriptionProducts.append(card);
 });subscriptionConditions();
}
function subscriptionUpdateStatus(){for(const [index,product] of subscriptionRead().entries())if(product.nameGenerated==='on'){const card=subscriptionProducts.querySelector('[data-subscription-product="'+index+'"]');card.querySelector('[data-field=name]').value=product.name;card.querySelector('summary').textContent=product.name;}subscriptionConditions();document.getElementById('subscriptionStatus').textContent=JSON.stringify(subscriptionState())===subscriptionBaseline?'已保存 · '+(subscriptionEnabled.checked?'已启用 · '+subscriptionDraft.length+' 个商品':'未启用订阅'):'有未保存的订阅设置';document.getElementById('subscriptionError').textContent='';setTimeout(updateSaveStatus,0);}
async function subscriptionClose(){if(subscriptionSaving)return;if(subscriptionHasChanges()&&!await releaseDialog('放弃尚未保存的订阅设置与商品修改？'))return;subscriptionDialog.close();updateSaveStatus();subscriptionFocus?.focus();}
document.getElementById('btnSubscriptions').onclick=()=>{subscriptionFocus=document.activeElement;subscriptionDraft=JSON.parse(JSON.stringify(reviewData.subscriptions||[]));subscriptionEnabled.checked=DATA?.features?.hasSubscriptions!==false;subscriptionRender();subscriptionBaseline=JSON.stringify(subscriptionState());subscriptionUpdateStatus();if(!subscriptionUsage){subscriptionUsage=document.createElement('select');subscriptionUsage.id='subscriptionUsage';subscriptionUsage.setAttribute('aria-label','订阅使用情况');for(const [value,text] of [['on','已启用'],['off','未使用'],['unknown','待确认']])subscriptionUsage.add(new Option(text,value));subscriptionEnabled.closest('label').after(subscriptionUsage);subscriptionUsage.onchange=()=>{subscriptionEnabled.checked=subscriptionUsage.value!=='off';subscriptionUpdateStatus();};subscriptionEnabled.addEventListener('change',()=>{subscriptionUsage.value=subscriptionEnabled.checked?'on':'off';subscriptionUpdateStatus();});}subscriptionUsage.value=DATA.featureStates?.hasSubscriptions||(subscriptionEnabled.checked?'on':'off');subscriptionBaseline=JSON.stringify(subscriptionState());subscriptionDialog.showModal();};
document.getElementById('subscriptionClose').onclick=subscriptionClose;document.getElementById('subscriptionCancel').onclick=subscriptionClose;
subscriptionDialog.addEventListener('cancel',event=>{event.preventDefault();subscriptionClose();});
subscriptionForm.addEventListener('input',event=>{if(event.target.dataset.field==='name'){const card=event.target.closest('[data-subscription-product]');subscriptionDraft[Number(card.dataset.subscriptionProduct)].nameGenerated='off';}subscriptionUpdateStatus();});subscriptionForm.addEventListener('change',subscriptionUpdateStatus);
subscriptionForm.querySelectorAll('[data-add-subscription]').forEach(button=>button.onclick=()=>{subscriptionDraft=subscriptionRead();subscriptionDraft.push({id:crypto.randomUUID(),nameGenerated:'on',name:({week:'周订阅',month:'月订阅',year:'年订阅',custom:'自定义订阅'})[button.dataset.addSubscription],period:button.dataset.addSubscription,periodCount:'1',status:'draft',platform:subscriptionProjectPlatform(),currency:'CNY',price:'',familySharing:'off',renewal:'auto',trialEnabled:'off',trialUnit:'day',offerEnabled:'off',offerType:'intro',paymentMode:'recurring',offerPeriod:'month',offerTimezone:ReleaseReadiness.DEFAULT_TIME_ZONE});subscriptionRender();subscriptionUpdateStatus();subscriptionProducts.lastElementChild.scrollIntoView({block:'nearest'});});
function subscriptionValidate(products){
 const ids=new Set();
 for(const product of products){
  const name=product.name||subscriptionPeriodName(product);
  if(!/^[A-Z]{3}$/.test(product.currency||''))throw Error(name+'：请填写三位大写币种代码');
  if(product.price===''||product.price===undefined||!Number.isFinite(Number(product.price))||Number(product.price)<0)throw Error(name+'：请填写有效的标准订阅金额');
  if(!subscriptionPeriods.some(([value])=>value===product.period))throw Error(name+'：请选择订阅周期');
  if(!Number.isSafeInteger(Number(product.periodCount))||Number(product.periodCount)<1)throw Error(name+'：周期数量必须是正整数');
  if(product.period==='custom'&&!product.customPeriod?.trim())throw Error(name+'：请填写自定义周期说明');
  for(const key of subscriptionRequiredFields(product))if(['iosProductId','androidProductId'].includes(key)){
   if(!product[key]?.trim())throw Error(name+'：请填写'+(key==='iosProductId'?'iOS':'Android')+' 商品 ID');
   const id=key+':'+product[key]+(key==='androidProductId'?':'+(product.basePlanId||''):'');if(ids.has(id))throw Error(name+'：商品 ID 重复');ids.add(id);
  }
 }
}
subscriptionForm.onsubmit=async event=>{
 event.preventDefault();if(subscriptionSaving)return;
 try{const products=subscriptionRead();if(subscriptionEnabled.checked)subscriptionValidate(products);if(!online)throw Error('请先连接存储服务');subscriptionSaving=true;subscriptionForm.querySelectorAll('button,input,select,textarea').forEach(input=>input.disabled=true);
  const d=await api('/api/subscriptions',{enabled:subscriptionEnabled.checked,featureState:subscriptionUsage.value,products});
  reviewData=d.review;DATA=mergeItems(d);serverBaseline=baselineFromData(d);updateSummaryReleaseOptions();render();refreshFeatUI();markDirty();saveState();subscriptionDraft=JSON.parse(JSON.stringify(products));subscriptionBaseline=JSON.stringify(subscriptionState());subscriptionUpdateStatus();subscriptionDialog.close();subscriptionFocus?.focus();toast('订阅设置与商品已保存');
 }catch(error){showFormSaveFailure(document.getElementById('subscriptionError'),subscriptionForm,error.message);}
 finally{subscriptionSaving=false;subscriptionForm.querySelectorAll('button,input,select,textarea').forEach(input=>input.disabled=false);subscriptionConditions();updateSaveStatus();}
};
document.getElementById('subscriptionExport').onclick=()=>{const products=subscriptionRead();saveFile('订阅商品配置.json',new Blob([JSON.stringify({format:'release-desk-subscriptions/v1',enabled:subscriptionEnabled.checked,products},null,2)],{type:'application/json'}));};
window.addEventListener('beforeunload',event=>{if(subscriptionHasChanges()){event.preventDefault();event.returnValue='';}});

function releaseDialog(message,confirmation=true){return new Promise(resolve=>{const d=document.createElement('dialog'),h=document.createElement('h2'),p=document.createElement('p'),actions=document.createElement('div'),ok=document.createElement('button');h.textContent=confirmation?'确认操作':'操作提示';p.textContent=message;p.style.whiteSpace='pre-wrap';actions.className='dialog-actions';ok.textContent=confirmation?'继续':'知道了';ok.type='button';ok.className='btn primary button';const finish=value=>{d.close();d.remove();resolve(value);};if(confirmation){const cancel=document.createElement('button');cancel.type='button';cancel.className='btn button secondary';cancel.textContent='取消';cancel.onclick=()=>finish(false);actions.append(cancel);}ok.onclick=()=>finish(true);d.oncancel=e=>{e.preventDefault();finish(false);};actions.append(ok);d.append(h,p,actions);document.body.append(d);d.showModal();(actions.querySelector('button')).focus();});}
