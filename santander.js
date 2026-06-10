'use strict';
// Santander Drive Automation - modulo separado, no afecta bot Alameda
const puppeteer = require('puppeteer');
const SB_URL  = 'https://santanderconsumer.custhelp.com';
const SB_USER = process.env.SANT_USER || '';
const SB_PASS = process.env.SANT_PASS || '';
const PRECIOS = {
  '208': 14000000, '2008': 18000000, '3008': 25000000, '5008': 30000000,
  '308': 20000000, 'rifter': 20000000, 'landtrek': 27000000, 'partner': 20000000,
  'expert': 28000000, 'boxer': 30000000
};
let _browser = null;
async function getBrowser() {
  if (_browser && _browser.isConnected()) return _browser;
  _browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });
  return _browser;
}
function getModeloKey(m) {
  m = (m || '').toLowerCase();
  for (const k of Object.keys(PRECIOS)) { if (m.includes(k)) return k; }
  return null;
}
function getRut(lead) {
  return lead.rut || lead.rutCliente || lead.RutCliente || lead.rut_cliente ||
         lead.identificador || lead.cedula || '';
}
async function loginYNavegar(log) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  await page.setDefaultTimeout(40000);
  await page.goto(SB_URL + '/app/utils/login_form', { waitUntil: 'networkidle2' });
  if (!page.url().includes('simulador')) {
    await page.waitForSelector('#rn_LoginForm_2_Username');
    await page.type('#rn_LoginForm_2_Username', SB_USER);
    await page.type('#rn_LoginForm_2_Password', SB_PASS);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2' }),
      page.click('#rn_LoginForm_2_Submit')
    ]);
    if (!page.url().includes('simulador')) {
      await page.goto(SB_URL + '/app/simulador_credito', { waitUntil: 'networkidle2' });
    }
    log('Santander: login OK');
  }
  return page;
}
async function registrarEnSantander(lead, log) {
  if (!SB_USER || !SB_PASS) { log('Santander: credenciales no configuradas'); return; }
  const modeloBruto = (lead.modelo || '').toLowerCase();
  if (!modeloBruto.includes('peugeot')) { log('Santander: no es Peugeot, saltando'); return; }
  const rut = getRut(lead);
  if (!rut) { log('Santander: RUT no encontrado. Campos: ' + Object.keys(lead).join(', ')); return; }
  const modeloKey = getModeloKey(modeloBruto);
  if (!modeloKey) { log('Santander: modelo no mapeado: ' + lead.modelo); return; }
  const precio = PRECIOS[modeloKey];
  const pie = Math.round(precio / 2);
  const rutNum = rut.replace(/[.\-]/g, '');
  log('Santander: procesando lead #' + lead.id + ' rut:' + rutNum + ' modelo:' + modeloKey);
  const page = await loginYNavegar(log);
  try {
    await page.goto(SB_URL + '/app/simulador_credito', { waitUntil: 'networkidle2' });
    await page.waitForSelector('#rut');
    await page.click('#rut', { clickCount: 3 });
    await page.type('#rut', rutNum);
    await page.keyboard.press('Tab');
    log('Santander: esperando datos del cliente (35s)...');
    await new Promise(r => setTimeout(r, 35000));
    try {
      const tel = String(lead.telefono || '').replace(/\D/g, '').slice(-9);
      if (tel) await page.evaluate(v => { const e = document.querySelector('#telefonoMovil,[name=telefonoMovil]'); if(e){e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));} }, tel);
    } catch(e) {}
    try {
      if (lead.email) await page.evaluate(v => { const e = document.querySelector('[name=email]'); if(e){e.value=v;e.dispatchEvent(new Event('change',{bubbles:true}));} }, lead.email);
    } catch(e) {}
    await page.select('[name=concesionarioSolicitud]', '8665');
    await new Promise(r => setTimeout(r, 800));
    await page.select('[name=dealers]', '7503');
    await new Promise(r => setTimeout(r, 500));
    await page.evaluate(() => { const s=document.querySelector('[name=estadoVehiculo]'); const o=Array.from(s.options).find(x=>x.text.toUpperCase().includes('NUEVO')); if(o){s.value=o.value;s.dispatchEvent(new Event('change',{bubbles:true}));} });
    await new Promise(r => setTimeout(r, 300));
    await page.evaluate(() => { const s=document.querySelector('[name=usoVehiculo]'); const o=Array.from(s.options).find(x=>x.text.toUpperCase().includes('PARTICULAR')); if(o){s.value=o.value;s.dispatchEvent(new Event('change',{bubbles:true}));} });
    await page.select('[name=marcaVehiculo]', '73');
    await new Promise(r => setTimeout(r, 2500));
    const modeloVal = await page.evaluate(key => { const s=document.querySelector('[name=modeloVehiculo]'); const o=Array.from(s.options).find(x=>x.text.toLowerCase().startsWith(key)); return o?o.value:''; }, modeloKey);
    if (modeloVal) { await page.select('[name=modeloVehiculo]', modeloVal); log('Santander: modelo seleccionado'); }
    await new Promise(r => setTimeout(r, 500));
    await page.select('[name=anoVehiculo]', '2026');
    await new Promise(r => setTimeout(r, 300));
    await page.evaluate(v => { const e=document.querySelector('#valorVehiculo,[name=valorVehiculo]'); if(e){e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));e.dispatchEvent(new Event('blur',{bubbles:true}));} }, String(precio));
    await new Promise(r => setTimeout(r, 2500));
    await page.evaluate(() => { for(const c of document.querySelectorAll('tr td')){ if(c.textContent.trim()==='5'){c.closest('tr').click();break;} } });
    log('Santander: CREDIYA seleccionado');
    await new Promise(r => setTimeout(r, 1000));
    const plazoVal = await page.evaluate(() => { const s=document.querySelector('[name=plazo]'); const o=Array.from(s.options).find(x=>x.text.includes('36')); return o?o.value:''; });
    if (plazoVal) await page.select('[name=plazo]', plazoVal);
    await new Promise(r => setTimeout(r, 300));
    await page.evaluate(v => { const e=document.querySelector('#pie,[name=pie]'); if(e){e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));e.dispatchEvent(new Event('blur',{bubbles:true}));} }, String(pie));
    await new Promise(r => setTimeout(r, 500));
    await page.evaluate(() => { for(const b of document.querySelectorAll('button')){ if(b.textContent.includes('Simular')){b.click();break;} } });
    await new Promise(r => setTimeout(r, 3000));
    log('Santander: simulacion enviada para lead #' + lead.id);
  } finally {
    await page.close();
  }
}
module.exports = { registrarEnSantander };
