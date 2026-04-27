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
const EMAIL_TO     = process.env.EMAIL_TO        || 'fra.barahona@gmail.com';
const POLL_MS      = 5 * 60 * 1000;
const ESTADO_SIN   = 130;
const ESTADO_PEND  = 116;
const SEEN_FILE    = './seen_leads.json';
const DAILY_FILE   = './daily.json';

// ── Supabase precios ─────────────────────────────────────────
const SB_URL = 'https://zgxuslezeqxqcubwbore.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpneHVzbGV6ZXF4cWN1Yndib3JlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4NjI1MTcsImV4cCI6MjA4OTQzODUxN30.kdf_8yccI9TQweh-tx_E7v8aNMVeISanX2f8CUx1M6M';
let _preciosDB = null;
let _preciosTS = 0;

const resend = new Resend(RESEND_KEY);

// ── Estado interno ──────────────────────────────────────────
let _token = null;
let _seen  = new Set();

// ── Persistencia ────────────────────────────────────────────
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

// ── Precios (Supabase) ────────────────────────────────────────
async function cargarPrecios() {
  const CACHE_MS = 60 * 60 * 1000;
  if (_preciosDB && Date.now() - _preciosTS < CACHE_MS) return _preciosDB;
  try {
    const r = await fetch(SB_URL + '/rest/v1/price_data?select=db&id=eq.1', {
      headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY }
    });
    const rows = await r.json();
    const row = rows[0];
    if (row && row.db) {
      _preciosDB = row.db;
      _preciosTS = Date.now();
      log('💰 Precios cargados desde Supabase');
    }
  } catch (e) {
    log('⚠️ No se pudieron cargar precios: ' + e.message);
  }
  return _preciosDB;
}

function normKey(s) {
  return (s || '').toUpperCase().replace(/\s+/g, '').replace(/MCA$/, '').replace(/^MCA/, '');
}

function stripBrand(s) {
  return (s || '').replace(/^(peugeot|citroen|citroën|opel)\s+/i, '').trim();
}

async function getPrecio(modelo) {
  const db = await cargarPrecios();
  if (!db || !modelo) return null;
  const target = normKey(stripBrand(modelo));
  for (const brand of Object.values(db)) {
    for (const tipo of Object.values(brand)) {
      for (const [key, versions] of Object.entries(tipo)) {
        if (normKey(key) === target) {
          const ci = versions.map(function(v) { return v.ci; }).filter(function(p) { return p > 0; });
          const cc = versions.map(function(v) { return v.cc; }).filter(function(p) { return p > 0; });
          if (ci.length) return Math.min.apply(null, ci);
          if (cc.length) return Math.min.apply(null, cc);
        }
      }
    }
  }
  return null;
}

// ── API Alameda ──────────────────────────────────────────────
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
  log('✅ Sesión Alameda iniciada');
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
  const r = await fetch(BASE + path, {
    headers: { 'Authorization': 'apiKey ' + tok }
  });
  if (r.status === 401) { _token = null; return apiGet(path); }
  return r.json();
}

// ── Helpers ──────────────────────────────────────────────────
function splitCamel(s) {
  return (s || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-zA-Z])([0-9])/g, '$1 $2')
    .replace(/([0-9])([a-zA-Z])/g, '$1 $2');
}
function fmtPrice(n) { return '$' + Number(n).toLocaleString('es-CL'); }
function saludo() { return new Date().getHours() < 13 ? 'Buen día' : 'Buenas tardes'; }
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

// ── Email ────────────────────────────────────────────────────
async function enviarEmail(lead, phone, nombre, modelo, msg) {
  const waUrl = phone
    ? 'https://wa.me/' + phone + '?text=' + encodeURIComponent(msg)
    : null;

  const phoneDisplay = phone
    ? '+' + phone.slice(0,2) + ' ' + phone.slice(2,3) + ' ' + phone.slice(3,7) + ' ' + phone.slice(7)
    : 'Sin teléfono';

  const vehiculoRow = modelo ? '<tr style="border-top:1px solid #eee"><td style="padding:10px 14px;color:#555;font-size:14px">🚗 Vehículo</td><td style="padding:10px 14px;font-weight:bold;font-size:15px">' + splitCamel(modelo) + '</td></tr>' : '';
  const waBtn = waUrl
    ? '<a href="' + waUrl + '" style="display:block;background:#25D366;color:white;text-align:center;padding:18px;border-radius:10px;text-decoration:none;font-size:18px;font-weight:bold;box-shadow:0 4px 12px rgba(37,211,102,0.35)">📲 &nbsp;Abrir WhatsApp y Enviar</a><p style="text-align:center;color:#999;font-size:12px;margin-top:10px">Toca el botón desde tu celular</p>'
    : '<div style="background:#fff3cd;border-radius:8px;padding:14px;text-align:center;color:#856404">⚠️ Este lead no tiene número de teléfono registrado</div>';

  const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>'
    + '<body style="font-family:Arial,sans-serif;max-width:580px;margin:0 auto;padding:16px;background:#f0f2f5">'
    + '<div style="background:white;border-radius:14px;padding:28px;box-shadow:0 2px 12px rgba(0,0,0,0.08)">'
    + '<div style="margin-bottom:20px"><h2 style="margin:0;color:#1a1a2e;font-size:22px">🔔 Nuevo Lead</h2>'
    + '<p style="margin:4px 0 0;color:#666;font-size:13px">' + new Date().toLocaleString('es-CL', {timeZone:'America/Santiago'}) + '</p></div>'
    + '<table style="width:100%;border-collapse:collapse;margin-bottom:20px;background:#f8f9fa;border-radius:10px">'
    + '<tr><td style="padding:10px 14px;color:#555;font-size:14px;width:100px">👤 Cliente</td><td style="padding:10px 14px;font-weight:bold;font-size:15px">' + nombre + '</td></tr>'
    + '<tr style="border-top:1px solid #eee"><td style="padding:10px 14px;color:#555;font-size:14px">📱 Teléfono</td><td style="padding:10px 14px;font-weight:bold;font-size:15px">' + phoneDisplay + '</td></tr>'
    + vehiculoRow
    + '<tr style="border-top:1px solid #eee"><td style="padding:10px 14px;color:#555;font-size:14px">🆔 ID</td><td style="padding:10px 14px;color:#888;font-size:13px">#' + lead.id + '</td></tr>'
    + '</table>'
    + '<div style="background:#eef4ff;border-left:4px solid #2563eb;border-radius:6px;padding:14px 16px;margin-bottom:24px">'
    + '<p style="margin:0 0 6px;color:#2563eb;font-size:11px;font-weight:bold;text-transform:uppercase;letter-spacing:0.5px">Mensaje listo para enviar</p>'
    + '<p style="margin:0;color:#1a1a2e;font-size:14px;line-height:1.7">' + msg + '</p></div>'
    + waBtn
    + '</div><p style="text-align:center;color:#bbb;font-size:11px;margin-top:14px">Bot Leads Alameda · ' + NOMBRE + '</p>'
    + '</body></html>';

  const result = await resend.emails.send({
    from:    'Bot Alameda <onboarding@resend.dev>',
    to:      EMAIL_TO,
    subject: '🔔 Lead: ' + nombre + (modelo ? ' — ' + splitCamel(modelo) : ''),
    html
  });
  if (result.error) throw new Error('Resend error: ' + JSON.stringify(result.error));
}

// ── Ciclo principal ───────────────────────────────────────────
async function checkLeads() {
  log('🔍 Buscando leads nuevos...');
  try {
    const data   = await apiPost('/api/lead/busqueda', { paginaActual: 1, cantidadPorPagina: 50 });
    const all    = data.lstLeads || [];
    const nuevos = all.filter(function(l) {
      return (l.idEstado === ESTADO_SIN || l.idEstado === ESTADO_PEND) && !_seen.has(l.id);
    });
    log('📊 Total: ' + all.length + ' | Nuevos: ' + nuevos.length);

    for (const lead of nuevos) {
      _seen.add(lead.id);
      guardarSeen();
      try {
        const det    = await apiGet('/api/lead/obtener?id=' + lead.id);
        const phone  = normPhone(det.telefono || lead.telefono);
        const nombre = det.nombreCliente || lead.nombreCliente || 'Cliente';
        const modelo = det.nombreModelo  || lead.nombreModelo  || '';
        const precio = await getPrecio(modelo);
        const msg    = buildMsg(nombre, modelo, precio);
        const diario = getDiario();

        if (precio) log('💰 Precio ' + modelo + ': ' + fmtPrice(precio));
        else if (modelo) log('⚠️ Sin precio para: ' + modelo);

        if (diario < MAX_DIARIO) {
          await enviarEmail(lead, phone, nombre, modelo, msg);
          const cnt = incDiario();
          log('✅ Email enviado — ' + nombre + ' — ' + cnt + '/' + MAX_DIARIO + ' hoy');
          await apiPost('/api/lead/seguimiento', {
            id: lead.id, idMotivo: 169, otroMotivo: '',
            asunto: 'Esperamos su Confirmación',
            descripcion: 'Notificación enviada al ejecutivo para contacto vía WhatsApp',
            idUsuario: 0, fecha: '', hora: 9, minuto: 0,
            numeroFacturaBoleta: 0, idMarca: 0, idPromocion: 0
          });
          log('✅ Seguimiento #' + lead.id + ' registrado');
        } else {
          log('⚠️ Límite diario ' + MAX_DIARIO + ' emails alcanzado');
        }
      } catch (e) {
        log('❌ #' + lead.id + ': ' + e.message);
      }
    }
  } catch (e) {
    log('❌ Error buscando leads: ' + e.message);
  }
  setTimeout(checkLeads, POLL_MS);
}

// ── Log ───────────────────────────────────────────────────────
function log(msg) {
  const hora = new Date().toLocaleTimeString('es-CL', {
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  console.log('[' + hora + '] ' + msg);
}

// ── Inicio ────────────────────────────────────────────────────
async function main() {
  log('🤖 Bot Leads Alameda — Email iniciando...');
  cargarSeen();
  log('👤 Vendedor: ' + NOMBRE + ' | Límite: ' + MAX_DIARIO + ' emails/día → ' + EMAIL_TO);
  await cargarPrecios();
  setTimeout(checkLeads, 3000);
}

main().catch(function(e) { console.error(e); process.exit(1); });
