import {chromium} from 'playwright';
import assert from 'node:assert/strict';

const browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:1200,height:900},deviceScaleFactor:1});
 page.on("pageerror",err=>console.error("BROWSER_PAGE_ERROR",err.message));
 let lastError;
 for(let attempt=0;attempt<35;attempt++){
  try{
   const response=await page.goto('http://localhost:3000/receipt-visual-test',{waitUntil:'domcontentloaded',timeout:10000});
   if(response?.ok())break;
   lastError=new Error('HTTP '+response?.status());
  }catch(err){lastError=err;}
  await new Promise(resolve=>setTimeout(resolve,1000));
  if(attempt===34)throw lastError;
 }
 await page.locator('[data-testid="open-receipt"]').waitFor({state:'visible'});
 await page.locator('[data-testid="open-receipt"]').click({timeout:20000});
 await page.locator('dialog.fiscal-confirmation-dialog[open]').waitFor({timeout:15000});
 const desktop=await page.evaluate(()=>{
  const checkbox=document.querySelector('.fiscal-no-invoice input');
  const card=document.querySelector('.fiscal-card');
  const summary=document.querySelector('.fiscal-payment-summary');
  const fields=document.querySelector('.fiscal-recipient-grid');
  const form=document.querySelector('.fiscal-confirmation');
  if(!checkbox||!card||!summary||!fields||!form)throw Error('Novo layout ausente');
  const box=checkbox.getBoundingClientRect();
  return {layout:form.getAttribute('data-layout-version'),
   checkboxWidth:box.width,checkboxHeight:box.height,
   checkboxDisplay:getComputedStyle(checkbox).display,
   cardBorder:getComputedStyle(card).borderTopWidth,
   summaryGrid:getComputedStyle(summary).gridTemplateColumns,
   fiscalColumns:getComputedStyle(fields).gridTemplateColumns,
   cardCount:document.querySelectorAll('.fiscal-card').length};
 });
 assert.equal(desktop.layout,'receipt-20261021-v2');
 assert.equal(desktop.cardCount,2);
 assert.ok(desktop.checkboxWidth>=16&&desktop.checkboxWidth<=22,'checkbox width '+desktop.checkboxWidth);
 assert.ok(desktop.checkboxHeight>=16&&desktop.checkboxHeight<=22,'checkbox height '+desktop.checkboxHeight);
 assert.ok(parseFloat(desktop.cardBorder)>=1);
 assert.equal(desktop.summaryGrid.split(' ').length,2);
 assert.equal(desktop.fiscalColumns.split(' ').length,2);
 await page.screenshot({path:'/tmp/receipt-modal-desktop.png'});
 await page.setViewportSize({width:390,height:820});
 const mobile=await page.evaluate(()=>{
  const box=document.querySelector('.fiscal-no-invoice input').getBoundingClientRect();
  const grid=getComputedStyle(document.querySelector('.fiscal-recipient-grid')).gridTemplateColumns;
  return {checkboxWidth:box.width,checkboxHeight:box.height,grid};
 });
 assert.ok(mobile.checkboxWidth>=16&&mobile.checkboxWidth<=22);
 assert.ok(mobile.checkboxHeight>=16&&mobile.checkboxHeight<=22);
 assert.equal(mobile.grid.split(' ').length,1);
 await page.screenshot({path:'/tmp/receipt-modal-mobile.png'});
 console.log('VISUAL_BROWSER_PASS',JSON.stringify({desktop,mobile}));
}finally{await browser.close();}
