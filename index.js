// ============================================================
// Bot Leads Alameda — Notificaciones por Email
// ============================================================
const fetch  = require('node-fetch');
const fs     = require('fs');
const { Resend } = require('resend');

// ── Configuración ──────────────────────────────────────────
const BASE         = 'https://alameda-administracion.azurewebsites.net';
const ALAMEDA_USER = process.env.ALAMEDA_USER    || '';
const ALAMEDA_PASS = process.env.ALAMEDA_PASS    || '';
const NOMBRE       = process.env.NOMBRE_VENDEDOR || 'Franco Barahona';
const MAX_DIARIO   = parseInt(process.env.MAX_DIARIO || '20');
const RESEND_KEY   = process.env.RESEND_API_KEY  || '';
const EMAIL_TO     = process.env.EMAIL_TO        || 'franco.barahona@automotoralameda.cl';
const POLL_MS      = 5 * 60 * 1000;
const ESTADO_SIN   = 130;
const ESTADO_PEND  = 116;
const SEEN_FILE    = './seen_leads.json';
const DAILY_FILE   = './daily.json';

const resend = new Resend(RESEND_KEY);

let _token = null;
let _seen  = new Set();

function cargarSeen() {
  try { _seen = new Set(JSON.parse(fs.readFileSync(SEEN_FILE, 'utf8'))); }
  catch { _seen = new Set(); }
}
function guardarSeen() {
  try { fs.writeFileSync(SEEN_FILE, JSON.stringify([..._seen])); } catch {}
}
function getDiario() {
  try {
    const d = JSON.parse(fs.readFileSync(DAILY_FILE, 'utf8'));
    const hoy = new Date().toISOString().slice(0, 10);
    return d.f === hoy ? d.c : 0;
  } catch { return 0; }
}
function incDiario() {
  const hoy = new Date().toISOString().slice(0, 10);
  let d = { f: hoy, c: 0 };
  try { d = JSON.parse(fs.readFileSync(DAILY_FILE, 'utf8')); } catch {}
  if (d.f !== hoy) d = { f: hoy, c: 0 };
  d.c++;
  fs.writeFileSync(DAILY_FILE, JSON.stringify(d));
  return d.c;
}

async function getToken() {
  if (_token) return _token;
  const r = await fetch(BASE + '/api/sesion/inicia', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombreUsuario: ALAMEDA_USER, clave: ALAMEDA_PASS })
  });
  const d = await r.json();
  if (!d.token) throw new Error('Login Alameda fallido');
  _token = d.token;
  log('Sesion Alameda iniciada');
  return _token;
}
async function apiPost(path, body) {
  const tok = await getToken();
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'apiKey ' + tok },
    body: JSON.stringify(body)
  });
  if (r.status === 401) { _token = null; return apiPost(path, body); }
  const txt = await r.text();
  try { return JSON.parse(txt); } catch { return { ok: true }; }
}
async function apiGet(path) {
  const tok = await getToken();
  const r = await fetch(BASE + path, { headers: { 'Authorization': 'apiKey ' + tok } });
  if (r.status === 401) { _token = null; return apiGet(path); }
  return r.json();
}

function splitCamel(s) {
  return (s || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-zA-Z])([0-9])/g, '$1 $2')
    .replace(/([0-9])([a-zA-Z])/g, '$1 $2');
}
function fmtPrice(n) { return '$' + Number(n).toLocaleString('es-CL'); }
function saludo() { return new Date().getHours() < 13 ? 'Buen dia' : 'Buenas tardes'; }
function normPhone(tel) {
  const d = (tel || '').replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('56') && d.length >= 11) return d;
  if (d.startsWith('9')  && d.length === 9)  return '56' + d;
  if (d.startsWith('09') && d.length === 10) return '56' + d.slice(1);
  if (d.length === 8) return '569' + d;
  if (d.length >= 9) return '56' + d;
  return null;
}
function buildMsg(nombre, modelo, precio) {
  const first = (nombre || 'cliente').split(' ')[0];
  const mod   = splitCamel(modelo || '').trim();
  if (!mod) {
    return 'Hola ' + first + ', mi nombre es ' + NOMBRE + ' ejecutivo de Peugeot, Citroen y Opel de automotora Alameda. Hemos recibido una solicitud de cotizacion pero me gustaria saber que vehiculo buscas? asi te puedo entregar una mejor atencion.';
  }
  const ps = precio ? 'parte desde los ' + fmtPrice(precio) : 'tiene un valor especial este mes';
  return saludo() + ', ' + first + ', mi nombre es ' + NOMBRE + ', ejecutivo de ventas de Peugeot, Citroen y Opel de Automotora Alameda. Hemos recibido una solicitud de cotizacion por ' + mod + '. Te queria comentar que este mes tenemos grandes promociones y su valor ' + ps + '. Quedo muy atento a como poder ayudarte a tener tu proximo 0km.';
}

async function enviarEmail(lead, phone, nombre, modelo, msg) {
  const waUrl = phone ? 'https://wa.me/' + phone + '?text=' + encodeURIComponent(msg) : null;
  const phoneDisplay = phone ? '+' + phone.slice(0,2) + ' ' + phone.slice(2,3) + ' ' + phone.slice(3,7) + ' ' + phone.slice(7) : 'Sin telefono';
  const modeloDisplay = modelo ? splitCamel(modelo) : '';

  const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="font-family:Arial,sans-serif;max-width:580px;margin:0 auto;padding:16px;background:#f0f2f5"><div style="background:white;border-radius:14px;padding:28px;box-shadow:0 2px 12px rgba(0,0,0,0.08)"><h2 style="margin:0 0 4px;color:#1a1a2e">Nuevo Lead</h2><p style="margin:0 0 20px;color:#666;font-size:13px">' + new Date().toLocaleString('es-CL') + '</p><table style="width:100%;border-collapse:collapse;margin-bottom:20px;background:#f8f9fa;border-radius:10px"><tr><td style="padding:10px 14px;color:#555;font-size:14px;width:100px">Cliente</td><td style="padding:10px 14px;font-weight:bold">' + nombre + '</td></tr><tr style="border-top:1px solid #eee"><td style="padding:10px 14px;color:#555;font-size:14px">Telefono</td><td style="padding:10px 14px;font-weight:bold">' + phoneDisplay + '</td></tr>' + (modeloDisplay ? '<tr style="border-top:1px solid #eee"><td style="padding:10px 14px;color:#555;font-size:14px">Vehiculo</td><td style="padding:10px 14px;font-weight:bold">' + modeloDisplay + '</td></tr>' : '') + '<tr style="border-top:1px solid #eee"><td style="padding:10px 14px;color:#555;font-size:14px">ID</td><td style="padding:10px 14px;color:#888">#' + lead.id + '</td></tr></table><div style="background:#eef4ff;border-left:4px solid #2563eb;border-radius:6px;padding:14px 16px;margin-bottom:24px"><p style="margin:0 0 6px;color:#2563eb;font-size:11px;font-weight:bold;text-transform:uppercase">Mensaje listo para enviar</p><p style="margin:0;color:#1a1a2e;font-size:14px;line-height:1.7">' + msg + '</p></div>' + (waUrl ? '<a href="' + waUrl + '" style="display:block;background:#25D366;color:white;text-align:center;padding:18px;border-radius:10px;text-decoration:none;font-size:18px;font-weight:bold">Abrir WhatsApp y Enviar</a><p style="text-align:center;color:#999;font-size:12px;margin-top:10px">Toca el boton desde tu celular</p>' : '<div style="background:#fff3cd;border-radius:8px;padding:14px;text-align:center;color:#856404">Sin numero de telefono</div>') + '</div><p style="text-align:center;color:#bbb;font-size:11px;margin-top:14px">Bot Leads Alameda</p></body></html>';

  await resend.emails.send({
    from:    'Bot Alameda <onboarding@resend.dev>',
    to:      EMAIL_TO,
    subject: 'Nuevo lead: ' + nombre + (modelo ? ' - ' + splitCamel(modelo) : ''),
    html
  });
}

async function checkLeads() {
  log('Buscando leads nuevos...');
  try {
    const data   = await apiPost('/api/lead/busqueda', { paginaActual: 1, cantidadPorPagina: 50 });
    const all    = data.lstLeads || [];
    const nuevos = all.filter(function(l) { return (l.idEstado === ESTADO_SIN || l.idEstado === ESTADO_PEND) && !_seen.has(l.id); });
    log('Total: ' + all.length + ' | Nuevos: ' + nuevos.length);
    for (const lead of nuevos) {
      _seen.add(lead.id);
      guardarSeen();
      try {
        const det    = await apiGet('/api/lead/obtener?id=' + lead.id);
        const phone  = normPhone(det.telefono || lead.telefono);
        const nombre = det.nombreCliente || lead.nombreCliente || 'Cliente';
        const modelo = det.nombreModelo  || lead.nombreModelo  || '';
        const msg    = buildMsg(nombre, modelo, null);
        const diario = getDiario();
        if (diario < MAX_DIARIO) {
          await enviarEmail(lead, phone, nombre, modelo, msg);
          const cnt = incDiario();
          log('Email enviado - ' + nombre + ' - ' + cnt + '/' + MAX_DIARIO + ' hoy');
          await apiPost('/api/lead/seguimiento', {
            id: lead.id, idMotivo: 169, otroMotivo: '',
            asunto: 'Esperamos su Confirmacion',
            descripcion: 'Notificacion enviada al ejecutivo para contacto via WhatsApp',
            idUsuario: 0, fecha: '', hora: 9, minuto: 0,
            numeroFacturaBoleta: 0, idMarca: 0, idPromocion: 0
          });
          log('Seguimiento #' + lead.id + ' registrado');
        } else {
          log('Limite diario ' + MAX_DIARIO + ' alcanzado');
        }
      } catch (e) { log('Error #' + lead.id + ': ' + e.message); }
    }
  } catch (e) { log('Error buscando leads: ' + e.message); }
  setTimeout(checkLeads, POLL_MS);
}

function log(msg) {
  const hora = new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  console.log('[' + hora + '] ' + msg);
}

async function main() {
  log('Bot Leads Alameda - Email iniciando...');
  cargarSeen();
  log('Vendedor: ' + NOMBRE + ' | Limite: ' + MAX_DIARIO + ' emails/dia a ' + EMAIL_TO);
  setTimeout(checkLeads, 3000);
}

main().catch(function(e) { console.error(e); process.exit(1); });
