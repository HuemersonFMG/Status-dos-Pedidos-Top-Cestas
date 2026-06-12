const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');

const fetch = (...args) =>
  import('node-fetch')
    .then(({ default: fetch }) => fetch(...args));

const app = express();

app.use(cors({
  origin: true,
  credentials: true
}));

app.use(express.json({
  limit: '50mb'
}));

app.use(express.urlencoded({
  extended: true,
  limit: '50mb'
}));

const PORT = process.env.PORT || 5050;
const SECRET = process.env.SECRET || 'chave_super_secreta';
const BASE_URL = 'http://topcesta.fwc.cloud:8180';
const SERVICE_URL = `${BASE_URL}/mge/service.sbr`;
const USER = process.env.USER || 'HUEMERSON';
const PASS = process.env.PASS || '654321';
const PUBLIC_DIR = path.join(__dirname, 'public');
const STORAGE_DIR = path.join(__dirname, 'storage');
const LISTAS_DIR = path.join(STORAGE_DIR, 'listas');

const ADMIN_SESSION_COOKIE = 'topcestas_admin_session';
const ADMIN_SESSION_TTL = 8 * 60 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_BLOCK_TIME = 5 * 60 * 1000;
const COMERCIAL_TICKET_TTL = 2 * 60 * 1000;

const adminSessions = new Map();
const loginAttempts = new Map();
const comercialTickets = new Map();

if (!fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

if (!fs.existsSync(LISTAS_DIR)) {
  fs.mkdirSync(LISTAS_DIR, { recursive: true });
}

app.use((req, res, next) => {
  console.log(`🌐 ${req.method} ${req.url}`);
  next();
});

let cachedCookie = null;
let cookieTime = 0;

function getCookie(req, nome) {
  const raw = req.headers.cookie || '';

  return raw
    .split(';')
    .map(c => c.trim())
    .find(c => c.startsWith(`${nome}=`))
    ?.split('=')
    .slice(1)
    .join('=') || '';
}

function getClientKey(req, usuario) {
  const ip =
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket.remoteAddress ||
    'unknown';

  return `${ip}:${String(usuario || '').trim().toUpperCase()}`;
}

function isLoginBlocked(key) {
  const item = loginAttempts.get(key);

  if (!item) {
    return false;
  }

  if (item.blockedUntil && item.blockedUntil > Date.now()) {
    return true;
  }

  if (item.blockedUntil && item.blockedUntil <= Date.now()) {
    loginAttempts.delete(key);
    return false;
  }

  return false;
}

function registerFailedLogin(key) {
  const now = Date.now();

  const item =
    loginAttempts.get(key) || {
      count: 0,
      blockedUntil: null
    };

  item.count++;

  if (item.count >= MAX_LOGIN_ATTEMPTS) {
    item.blockedUntil = now + LOGIN_BLOCK_TIME;
  }

  loginAttempts.set(key, item);

  return item;
}

function clearFailedLogin(key) {
  loginAttempts.delete(key);
}

function limparSessoesExpiradas() {
  const now = Date.now();

  for (const [token, session] of adminSessions.entries()) {
    if (!session || session.expiresAt <= now) {
      adminSessions.delete(token);
    }
  }

  for (const [ticket, item] of comercialTickets.entries()) {
    if (!item || item.expiresAt <= now) {
      comercialTickets.delete(ticket);
    }
  }
}

function getAdminSession(req) {
  limparSessoesExpiradas();

  const token = getCookie(req, ADMIN_SESSION_COOKIE);

  if (!token) {
    return null;
  }

  const session = adminSessions.get(token);

  if (!session || session.expiresAt <= Date.now()) {
    adminSessions.delete(token);
    return null;
  }

  session.lastAccess = Date.now();

  return session;
}

function requireAdminPage(req, res, next) {
  const session = getAdminSession(req);

  if (!session) {
    return res.redirect('/login.html');
  }

  req.adminSession = session;

  next();
}

function requireAdminApi(req, res, next) {
  const session = getAdminSession(req);

  if (!session) {
    return res.status(401).json({
      erro: 'Sessão administrativa expirada. Faça login novamente.'
    });
  }

  req.adminSession = session;

  next();
}

function criarTicketGeradorComercial(session) {
  const ticket = crypto.randomBytes(32).toString('hex');

  comercialTickets.set(ticket, {
    usuario: session.usuario,
    createdAt: Date.now(),
    expiresAt: Date.now() + COMERCIAL_TICKET_TTL,
    usado: false
  });

  return ticket;
}

function requireGeradorComercialTicket(req, res, next) {
  limparSessoesExpiradas();

  const ticket = String(req.query.ticket || '').trim();

  if (!ticket) {
    return res.redirect('/login.html');
  }

  const item = comercialTickets.get(ticket);

  if (!item || item.usado || item.expiresAt <= Date.now()) {
    comercialTickets.delete(ticket);

    return res.redirect('/login.html');
  }

  item.usado = true;
  comercialTickets.delete(ticket);

  next();
}

function normalizarNomeArquivo(valor) {
  return String(valor || 'CLIENTE')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .trim()
    .toUpperCase() || 'CLIENTE';
}

function montarNomeComprovante(nunota, nomeParc, extensao) {
  const pedido = String(nunota || 'PEDIDO').replace(/\D/g, '') || 'PEDIDO';
  const cliente = normalizarNomeArquivo(nomeParc);

  return `Comprovante_${pedido}_${cliente}.${extensao}`;
}

function escaparHtml(valor) {
  return String(valor || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function executarQuerySankhya(cookie, sql) {
  const payload = {
    serviceName: 'DbExplorerSP.executeQuery',
    requestBody: { sql }
  };

  const response = await fetch(
    `${SERVICE_URL}?serviceName=DbExplorerSP.executeQuery&outputType=json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookie
      },
      body: JSON.stringify(payload)
    }
  );

  const json = await response.json();

  if (!response.ok || String(json.status || '') !== '1') {
    throw new Error(json.statusMessage || 'Erro ao consultar Sankhya.');
  }

  return json;
}

async function buscarSeqLinkPedido(cookie, nunota) {
  const json = await executarQuerySankhya(cookie, `
    SELECT SEQ
    FROM AD_LINKSPEDIDOS
    WHERE NUNOTA = ${Number(nunota)}
  `);

  const row = json?.responseBody?.rows?.[0];

  return row?.[0] ? Number(row[0]) : null;
}

async function buscarProximaSeqLinkPedido(cookie) {
  const json = await executarQuerySankhya(cookie, `
    SELECT NVL(MAX(SEQ), 0) + 1 AS PROXSEQ
    FROM AD_LINKSPEDIDOS
  `);

  const row = json?.responseBody?.rows?.[0];

  return row?.[0] ? Number(row[0]) : 1;
}

async function salvarLinkPedidoCrud(cookie, seq, nunota, link) {
  const payload = {
    serviceName: 'CRUDServiceProvider.saveRecord',
    requestBody: {
      dataSet: {
        rootEntity: 'AD_LINKSPEDIDOS',
        includePresentationFields: 'N',
        dataRow: {
          localFields: {
            SEQ: { $: String(seq) },
            NUNOTA: { $: String(nunota) },
            LINK: { $: String(link) },
            DHCAD: { $: new Date().toLocaleString('pt-BR') }
          }
        }
      }
    }
  };

  const response = await fetch(
    `${SERVICE_URL}?serviceName=CRUDServiceProvider.saveRecord&outputType=json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookie
      },
      body: JSON.stringify(payload)
    }
  );

  const json = await response.json();

  if (!response.ok || String(json.status || '') !== '1') {
    throw new Error(json.statusMessage || 'Erro ao salvar link na AD_LINKSPEDIDOS.');
  }

  return json;
}

async function gravarLinksPedidos(cookie, links) {
  if (!Array.isArray(links) || !links.length) {
    return {
      totalRecebido: 0,
      totalGravado: 0
    };
  }

  let totalGravado = 0;

  for (const item of links) {
    const nunota = Number(item.nunota || item.NUNOTA);
    const link = String(item.link || item.LINK || '').trim();

    if (!nunota || !link) {
      continue;
    }

    let seq = await buscarSeqLinkPedido(cookie, nunota);

    if (!seq) {
      seq = await buscarProximaSeqLinkPedido(cookie);
    }

    await salvarLinkPedidoCrud(cookie, seq, nunota, link);

    totalGravado++;
  }

  console.log(`✅ Links gravados/atualizados na AD_LINKSPEDIDOS: ${totalGravado}`);

  return {
    totalRecebido: links.length,
    totalGravado
  };
}

function gerarIdLista() {
  return crypto.randomBytes(12).toString('hex');
}

function caminhoLista(id) {
  const idSeguro = String(id || '').replace(/[^a-zA-Z0-9_-]/g, '');

  return path.join(LISTAS_DIR, `${idSeguro}.json`);
}

function validarItemLista(item) {
  const nunota =
    item?.nunota ||
    item?.NUNOTA ||
    '';

  const link =
    item?.link ||
    item?.LINK ||
    '';

  if (!nunota || !link) {
    return null;
  }

  return {
    nunota: String(item.nunota || item.NUNOTA || ''),
    NUNOTA: String(item.NUNOTA || item.nunota || ''),
    numNota: String(item.numNota || item.NUMNOTA || ''),
    NUMNOTA: String(item.NUMNOTA || item.numNota || ''),
    nomeParc: String(item.nomeParc || item.NOMEPARC || item.nomeparc || ''),
    NOMEPARC: String(item.NOMEPARC || item.nomeParc || item.nomeparc || ''),
    periodoPap: String(item.periodoPap || item.AD_PERIODO_PAP || ''),
    AD_PERIODO_PAP: String(item.AD_PERIODO_PAP || item.periodoPap || ''),
    link: String(link)
  };
}

function montarHtmlLista(lista) {
  const itens = Array.isArray(lista.links) ? lista.links : [];

  const linhas = itens.map((item, idx) => {
    const nunota = escaparHtml(item.nunota || item.NUNOTA);
    const numNota = escaparHtml(item.numNota || item.NUMNOTA);
    const nomeParc = escaparHtml(item.nomeParc || item.NOMEPARC);
    const periodoPap = escaparHtml(item.periodoPap || item.AD_PERIODO_PAP);
    const link = escaparHtml(item.link || item.LINK);

    return `
      <tr>
        <td>${idx + 1}</td>
        <td>${nunota}</td>
        <td>${numNota || '-'}</td>
        <td>${nomeParc || '-'}</td>
        <td>${periodoPap || '-'}</td>
        <td><a href="${link}" target="_blank">${link}</a></td>
        <td>
          <button onclick="copiarLink('${link}')">Copiar</button>
          <button onclick="window.open('${link}', '_blank')">Abrir</button>
          <button onclick="enviarWhatsApp('${link}')">WhatsApp</button>
        </td>
      </tr>
    `;
  }).join('');

  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Lista de Links - Top Cestas Track</title>
  <link rel="icon" href="https://tutoriaissankhya.netlify.app/img/IcoTop.png" type="image/png">
  <style>
    *{box-sizing:border-box;}
    body{margin:0;font-family:Arial,sans-serif;background:#f5f5f5;color:#333;}
    header{background:linear-gradient(to right,rgb(243,54,54),orange);color:white;padding:18px 25px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:15px;box-shadow:0 2px 10px rgba(0,0,0,0.15);}
    .header-left{display:flex;flex-direction:column;}
    .header-left h1{margin:0;font-size:24px;}
    .header-left span{font-size:13px;opacity:.9;}
    .header-actions{display:flex;gap:10px;flex-wrap:wrap;}
    button{border:none;padding:10px 14px;border-radius:8px;cursor:pointer;font-weight:bold;background:#007bff;color:white;}
    button:hover{opacity:.9;}
    .container{width:95%;margin:35px auto;background:white;border-radius:14px;padding:25px;box-shadow:0 0 20px rgba(0,0,0,0.08);}
    .info{background:#e9ecfa;border:4px solid #7d93f5;border-radius:12px;padding:12px;margin-bottom:20px;}
    table{width:100%;border-collapse:collapse;margin-top:20px;}
    th{background:#234b72;color:white;padding:12px;text-align:left;}
    td{border-bottom:1px solid #ddd;padding:10px;vertical-align:top;}
    a{color:#007bff;word-break:break-all;}
    footer{background:linear-gradient(to right,rgb(243,54,54),orange);color:white;text-align:center;padding:15px;font-size:13px;margin-top:30px;}
    @media(max-width:900px){table{font-size:13px;}td,th{padding:8px;}.container{width:98%;padding:15px;}}
  </style>
</head>
<body>
  <header>
    <div class="header-left">
      <h1>Top Cestas - Lista Interna de Links</h1>
      <span>Lista salva para consulta operacional - v1.6.0</span>
    </div>
    <div class="header-actions">
      <button onclick="copiarUrlPagina()">Copiar URL da Lista</button>
      <button onclick="window.print()">Imprimir</button>
      <button onclick="window.location.href='/gerador.html'">Voltar ao Gerador</button>
    </div>
  </header>

  <div class="container">
    <div class="info">
      <p><strong>ID da lista:</strong> ${escaparHtml(lista.id)}</p>
      <p><strong>Tipo:</strong> ${escaparHtml(lista.tipo || '-')}</p>
      <p><strong>Usuário gerador:</strong> ${escaparHtml(lista.usuario || '-')}</p>
      <p><strong>Data de geração:</strong> ${escaparHtml(lista.dataGeracao || '-')}</p>
      <p><strong>Total de links:</strong> ${itens.length}</p>
      <p><strong>Filtro usado:</strong> ${escaparHtml(lista.filtroResumo || '-')}</p>
    </div>

    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Pedido</th>
          <th>NF-e</th>
          <th>Cliente</th>
          <th>Período PAP</th>
          <th>Link</th>
          <th>Ações</th>
        </tr>
      </thead>
      <tbody>
        ${linhas || '<tr><td colspan="7">Nenhum link salvo nesta lista.</td></tr>'}
      </tbody>
    </table>
  </div>

  <footer>Top Cestas Track © 2026 - Sistema de rastreamento integrado Sankhya ERP</footer>

  <script>
    async function copiarLink(link){
      try{
        await navigator.clipboard.writeText(link);
        alert('Link copiado.');
      }catch(e){
        alert('Não foi possível copiar o link.');
      }
    }

    async function copiarUrlPagina(){
      try{
        await navigator.clipboard.writeText(window.location.href);
        alert('URL da lista copiada.');
      }catch(e){
        alert('Não foi possível copiar a URL.');
      }
    }

    function enviarWhatsApp(link){
      const texto = encodeURIComponent('Acompanhe seu pedido:\\n' + link);
      window.open('https://wa.me/?text=' + texto, '_blank');
    }
  </script>
</body>
</html>
  `;
}

async function buscarNomeParcPorNunota(cookie, nunota) {
  const nunotaNum = Number(nunota);

  if (!nunota || isNaN(nunotaNum)) {
    return 'CLIENTE';
  }

  const payload = {
    serviceName: 'DbExplorerSP.executeQuery',
    requestBody: {
      sql: `
        SELECT NOMEPARC
        FROM VW_NOTAS_FUSION_LIGHT
        WHERE NUNOTA = ${nunotaNum}
      `
    }
  };

  const response = await fetch(
    `${SERVICE_URL}?serviceName=DbExplorerSP.executeQuery&outputType=json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookie
      },
      body: JSON.stringify(payload)
    }
  );

  const json = await response.json();
  const row = json?.responseBody?.rows?.[0];

  return row?.[0] || 'CLIENTE';
}

function montarMapaNomeParc(lista) {
  const mapa = new Map();

  for (const r of lista || []) {
    const nunota = String(r.NUNOTA?.$ || '').trim();
    const nomeParc = String(r.NOMEPARC?.$ || '').trim();

    if (nunota) {
      mapa.set(nunota, nomeParc || 'CLIENTE');
    }
  }

  return mapa;
}

async function validarLoginSankhya(usuario, senha) {
  const payload = {
    serviceName: 'MobileLoginSP.login',
    requestBody: {
      NOMUSU: {
        $: usuario
      },
      INTERNO: {
        $: senha
      }
    }
  };

  const response = await fetch(
    `${SERVICE_URL}?serviceName=MobileLoginSP.login&outputType=json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    }
  );

  const rawCookie = response.headers.get('set-cookie') || '';
  const cookie = rawCookie.split(';')[0];

  let json = {};

  try {
    const text = await response.text();
    json = text ? JSON.parse(text) : {};
  } catch {
    return false;
  }

  const statusOk =
    String(json?.status || '') === '1';

  const temErro =
    String(json?.statusMessage || '')
      .toLowerCase()
      .includes('erro') ||
    String(json?.statusMessage || '')
      .toLowerCase()
      .includes('inválid') ||
    String(json?.statusMessage || '')
      .toLowerCase()
      .includes('invalid');

  if (!response.ok || !cookie || !statusOk || temErro) {
    console.warn('❌ Login admin Sankhya negado:', {
      usuario,
      status: json?.status,
      statusMessage: json?.statusMessage
    });

    return false;
  }

  console.log('✅ Login admin Sankhya validado:', usuario);

  return true;
}

async function login() {
  const now = Date.now();

  if (cachedCookie && (now - cookieTime < 5 * 60 * 1000)) {
    return cachedCookie;
  }

  const payload = {
    serviceName: 'MobileLoginSP.login',
    requestBody: {
      NOMUSU: {
        $: USER
      },
      INTERNO: {
        $: PASS
      }
    }
  };

  const response = await fetch(
    `${SERVICE_URL}?serviceName=MobileLoginSP.login&outputType=json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    }
  );

  const rawCookie = response.headers.get('set-cookie') || '';
  const cookie = rawCookie.split(';')[0];

  if (!cookie) {
    throw new Error('Erro ao autenticar no Sankhya');
  }

  cachedCookie = cookie;
  cookieTime = now;

  console.log('✅ Login Sankhya OK');

  return cookie;
}

function gerarToken(nunota) {
  return crypto
    .createHash('sha256')
    .update(String(nunota) + SECRET)
    .digest('hex');
}

function parseDataBR(dataStr) {
  if (!dataStr) {
    return null;
  }

  try {
    const [data] = dataStr.split(' ');
    const [dia, mes, ano] = data.split('/');

    return new Date(`${ano}-${mes}-${dia}`);
  } catch {
    return null;
  }
}

async function carregarViewLight(cookie) {
  const payload = {
    serviceName: 'CRUDServiceProvider.loadView',
    requestBody: {
      query: {
        viewName: 'VW_NOTAS_FUSION_LIGHT'
      }
    }
  };

  const response = await fetch(
    `${SERVICE_URL}?serviceName=CRUDServiceProvider.loadView&outputType=json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookie
      },
      body: JSON.stringify(payload)
    }
  );

  const json = await response.json();
  const rec = json?.responseBody?.records?.record;

  if (!rec) {
    return [];
  }

  return Array.isArray(rec)
    ? rec
    : [rec];
}

function montarLinks(filtrados, baseUrl) {
  return filtrados.map(r => ({
    nunota: r.NUNOTA?.$ || '',
    NUNOTA: r.NUNOTA?.$ || '',
    numNota: r.NUMNOTA?.$ || '',
    NUMNOTA: r.NUMNOTA?.$ || '',
    nomeParc: r.NOMEPARC?.$ || '',
    NOMEPARC: r.NOMEPARC?.$ || '',
    periodoPap: r.AD_PERIODO_PAP?.$ || '',
    AD_PERIODO_PAP: r.AD_PERIODO_PAP?.$ || '',
    link: `${baseUrl}/index.html?nunota=${r.NUNOTA?.$}&token=${gerarToken(r.NUNOTA?.$)}`
  }));
}

app.get('/gerador.html', requireAdminPage, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'gerador.html'));
});

app.post('/api/gerador-comercial-ticket', requireAdminApi, (req, res) => {
  const ticket = criarTicketGeradorComercial(req.adminSession);

  res.json({
    ok: true,
    url: `/geradorcomercial.html?ticket=${ticket}`
  });
});

app.get('/geradorcomercial.html', requireAdminPage, requireGeradorComercialTicket, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'geradorcomercial.html'));
});

app.post('/api/salvar-lista-links', requireAdminApi, (req, res) => {
  try {
    const {
      tipo,
      filtroResumo,
      links
    } = req.body;

    if (!Array.isArray(links) || !links.length) {
      return res.status(400).json({
        erro: 'Nenhum link informado para salvar.'
      });
    }

    const linksValidos = links
      .map(validarItemLista)
      .filter(Boolean);

    if (!linksValidos.length) {
      return res.status(400).json({
        erro: 'Nenhum link válido informado.'
      });
    }

    const id = gerarIdLista();
    const dataGeracao = new Date().toISOString();

    const lista = {
      id,
      tipo: String(tipo || 'GERADOR').toUpperCase(),
      usuario: req.adminSession?.usuario || 'USUARIO',
      filtroResumo: String(filtroResumo || ''),
      dataGeracao,
      total: linksValidos.length,
      links: linksValidos
    };

    fs.writeFileSync(
      caminhoLista(id),
      JSON.stringify(lista, null, 2),
      'utf8'
    );

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const url = `${baseUrl}/lista.html?id=${id}`;

    res.json({
      ok: true,
      id,
      total: linksValidos.length,
      url
    });

  } catch (err) {
    console.error('❌ ERRO salvar-lista-links:', err);

    res.status(500).json({
      erro: err.message
    });
  }
});

app.get('/api/lista-links/:id', requireAdminApi, (req, res) => {
  try {
    const arquivo = caminhoLista(req.params.id);

    if (!fs.existsSync(arquivo)) {
      return res.status(404).json({
        erro: 'Lista não encontrada.'
      });
    }

    const lista = JSON.parse(fs.readFileSync(arquivo, 'utf8'));

    res.json(lista);

  } catch (err) {
    console.error('❌ ERRO api lista-links:', err);

    res.status(500).json({
      erro: err.message
    });
  }
});

app.get('/lista-links/:id', requireAdminPage, (req, res) => {
  try {
    const arquivo = caminhoLista(req.params.id);

    if (!fs.existsSync(arquivo)) {
      return res.status(404).send(`
        <h2 style="font-family:Arial;text-align:center;margin-top:50px;color:red;">
          Lista não encontrada.
        </h2>
      `);
    }

    const lista = JSON.parse(fs.readFileSync(arquivo, 'utf8'));

    res.send(montarHtmlLista(lista));

  } catch (err) {
    console.error('❌ ERRO lista-links page:', err);

    res.status(500).send(`
      <h2 style="font-family:Arial;text-align:center;margin-top:50px;color:red;">
        Erro ao abrir lista.
      </h2>
    `);
  }
});

app.post('/api/admin-login', async (req, res) => {
  try {
    const usuario = String(req.body.usuario || '').trim();
    const senha = String(req.body.senha || '').trim();

    if (!usuario || !senha) {
      return res.status(400).json({
        erro: 'Informe usuário e senha'
      });
    }

    const loginKey = getClientKey(req, usuario);

    if (isLoginBlocked(loginKey)) {
      const item = loginAttempts.get(loginKey);
      const segundos = Math.ceil((item.blockedUntil - Date.now()) / 1000);

      return res.status(429).json({
        erro: `Muitas tentativas inválidas. Tente novamente em ${segundos} segundos.`
      });
    }

    const loginOk = await validarLoginSankhya(usuario, senha);

    if (!loginOk) {
      const tentativa = registerFailedLogin(loginKey);
      const restantes = Math.max(0, MAX_LOGIN_ATTEMPTS - tentativa.count);

      if (tentativa.blockedUntil && tentativa.blockedUntil > Date.now()) {
        return res.status(429).json({
          erro: 'Muitas tentativas inválidas. Aguarde alguns minutos e tente novamente.'
        });
      }

      return res.status(401).json({
        erro: `Usuário ou senha inválidos. Tentativas restantes: ${restantes}`
      });
    }

    clearFailedLogin(loginKey);

    const sessionToken = crypto.randomBytes(32).toString('hex');

    adminSessions.set(sessionToken, {
      usuario,
      createdAt: Date.now(),
      lastAccess: Date.now(),
      expiresAt: Date.now() + ADMIN_SESSION_TTL
    });

    res.setHeader(
      'Set-Cookie',
      `${ADMIN_SESSION_COOKIE}=${sessionToken}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${ADMIN_SESSION_TTL / 1000}`
    );

    res.json({
      ok: true,
      usuario
    });

  } catch (err) {
    console.error('❌ ERRO admin-login:', err);

    res.status(500).json({
      erro: err.message
    });
  }
});

app.post('/api/admin-logout', (req, res) => {
  const token = getCookie(req, ADMIN_SESSION_COOKIE);

  if (token) {
    adminSessions.delete(token);
  }

  res.setHeader(
    'Set-Cookie',
    `${ADMIN_SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`
  );

  res.json({
    ok: true
  });
});

app.get('/api/admin-status', (req, res) => {
  const session = getAdminSession(req);

  if (!session) {
    return res.status(401).json({
      autenticado: false
    });
  }

  res.json({
    autenticado: true,
    usuario: session.usuario
  });
});

app.use(express.static(PUBLIC_DIR));

app.post('/api/gerar-links', requireAdminApi, async (req, res) => {
  try {
    const { cnpj, ordemCarga, data, pedidos, nfes } = req.body;

    const documento = (cnpj || '').replace(/\D/g, '');
    const ordem = ordemCarga ? String(ordemCarga) : null;

    let listaPedidos = [];
    let listaNfes = [];

    if (pedidos) {
      listaPedidos = String(pedidos).split(',').map(p => p.trim()).filter(Boolean);
    }

    if (nfes) {
      listaNfes = String(nfes).split(',').map(n => n.trim()).filter(Boolean);
    }

    let tipoFiltro = null;

    if (listaPedidos.length) {
      tipoFiltro = 'PEDIDOS';
    } else if (listaNfes.length) {
      tipoFiltro = 'NFES';
    } else if (documento) {
      tipoFiltro = 'DOCUMENTO';
    } else if (ordem) {
      tipoFiltro = 'ORDEM';
    } else if (data) {
      tipoFiltro = 'DATA';
    }

    if (!tipoFiltro) {
      return res.status(400).json({
        erro: 'Informe um filtro'
      });
    }

    const cookie = await login();
    const lista = await carregarViewLight(cookie);

    let inicio = null;
    let fim = null;

    if (tipoFiltro === 'DATA') {
      inicio = new Date(data + 'T00:00:00');
      fim = new Date(data + 'T23:59:59');
    }

    const filtrados = lista.filter(r => {
      const doc = (r.CGC_CPF?.$ || '').replace(/\D/g, '');
      const oc = r.ORDEMCARGA?.$ ? String(r.ORDEMCARGA.$) : '';
      const nunota = String(r.NUNOTA?.$ || '');
      const numNota = String(r.NUMNOTA?.$ || '');

      switch (tipoFiltro) {
        case 'PEDIDOS':
          return listaPedidos.includes(nunota);

        case 'NFES':
          return listaNfes.includes(numNota);

        case 'DOCUMENTO':
          return doc === documento;

        case 'ORDEM':
          return oc === ordem;

        case 'DATA': {
          const dataPedido = parseDataBR(r.DTNEG?.$);

          return (
            dataPedido &&
            dataPedido >= inicio &&
            dataPedido <= fim
          );
        }

        default:
          return false;
      }
    });

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const links = montarLinks(filtrados, baseUrl);

    const gravacao = await gravarLinksPedidos(cookie, links);

    res.json({
      total: links.length,
      gravacao,
      links
    });

  } catch (err) {
    console.error('❌ ERRO gerar-links:', err);

    res.status(500).json({
      erro: err.message
    });
  }
});

app.post('/api/gerar-links-comercial', requireAdminApi, async (req, res) => {
  try {
    const { cnpj, cnpjs, periodoPap } = req.body;

    const documentosOrigem = Array.isArray(cnpjs)
      ? cnpjs
      : String(cnpj || '').split(/[;,\n\r\t]+/);

    const documentosLimpos = [...new Set(
      documentosOrigem
        .map(doc => String(doc || '').replace(/\D/g, ''))
        .filter(Boolean)
    )];

    const periodo = String(periodoPap || '').trim();

    if (!documentosLimpos.length && !periodo) {
      return res.status(400).json({
        erro: 'Informe CPF/CNPJ e Período PAP'
      });
    }

    if (!documentosLimpos.length) {
      return res.status(400).json({
        erro: 'Informe CPF/CNPJ'
      });
    }

    if (!periodo) {
      return res.status(400).json({
        erro: 'Informe Período PAP'
      });
    }

    const documentosInvalidos = documentosLimpos.filter(doc => doc.length !== 11 && doc.length !== 14);

    if (documentosInvalidos.length) {
      return res.status(400).json({
        erro: `CPF/CNPJ inválido: ${documentosInvalidos.join(', ')}`
      });
    }

    const documentosSet = new Set(documentosLimpos);

    const cookie = await login();
    const lista = await carregarViewLight(cookie);

    const filtrados = lista.filter(r => {
      const doc = (r.CGC_CPF?.$ || '').replace(/\D/g, '');
      const periodoRegistro = String(r.AD_PERIODO_PAP?.$ || '').trim();

      return (
        documentosSet.has(doc) &&
        periodoRegistro === periodo
      );
    });

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const links = montarLinks(filtrados, baseUrl);

    const gravacao = await gravarLinksPedidos(cookie, links);

    res.json({
      total: links.length,
      documentos: documentosLimpos,
      gravacao,
      links
    });

  } catch (err) {
    console.error('❌ ERRO gerar-links-comercial:', err);

    res.status(500).json({
      erro: err.message
    });
  }
});

app.get('/api/pedido', async (req, res) => {
  try {
    const { nunota, token } = req.query;

    if (!nunota || !token) {
      return res.status(400).json({
        erro: 'Parâmetros inválidos'
      });
    }

    if (token !== gerarToken(nunota)) {
      return res.status(403).json({
        erro: 'Acesso negado'
      });
    }

    const cookie = await login();

    const payload = {
      serviceName: 'CRUDServiceProvider.loadView',
      requestBody: {
        query: {
          viewName: 'VW_NOTAS_FUSION'
        }
      }
    };

    const response = await fetch(
      `${SERVICE_URL}?serviceName=CRUDServiceProvider.loadView&outputType=json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': cookie
        },
        body: JSON.stringify(payload)
      }
    );

    const json = await response.json();
    const rec = json?.responseBody?.records?.record;

    let lista = [];

    if (rec) {
      lista = Array.isArray(rec) ? rec : [rec];
    }

    const pedido = lista.find(
      r => String(r.NUNOTA?.$) === String(nunota)
    );

    if (!pedido) {
      return res.json({
        rows: []
      });
    }

    const tipo = Number(pedido.TIPO_FOTO?.$ || 0);

    res.json({
      rows: [{
        NUNOTA: pedido.NUNOTA?.$,
        NUMNOTA: pedido.NUMNOTA?.$,
        NOMEPARC: pedido.NOMEPARC?.$,
        CGC_CPF: pedido.CGC_CPF?.$,
        DTNEG: parseDataBR(pedido.DTNEG?.$),
        ORDEMCARGA: pedido.ORDEMCARGA?.$,
        TRANSPORTADORA: (pedido.TRANSPORTADORA?.$ || '').trim(),
        ST_ENTREGAS: pedido.ST_ENTREGAS?.$,
        TEM_FOTO: tipo === 1,
        TEM_PDF: tipo === 2
      }]
    });

  } catch (err) {
    console.error('❌ ERRO pedido:', err);

    res.status(500).json({
      erro: err.message
    });
  }
});

app.get('/api/comprovante/imagem', async (req, res) => {
  try {
    const { nunota, token } = req.query;

    const nunotaNum = Number(nunota);

    if (!nunota || isNaN(nunotaNum)) {
      return res.status(400).send('NUNOTA inválido');
    }

    if (token !== gerarToken(nunota)) {
      return res.status(403).send('Acesso negado');
    }

    const cookie = await login();
    const nomeParc = await buscarNomeParcPorNunota(cookie, nunotaNum);
    const nomeArquivo = montarNomeComprovante(nunotaNum, nomeParc, 'jpg');

    const url =
      `${BASE_URL}/mge/AD_APPENTFOTO@FOTO@NUNOTA=${nunotaNum}@SEQ=1.dbimage`;

    const response = await fetch(url, {
      headers: {
        Cookie: cookie
      }
    });

    if (!response.ok) {
      return res.status(404).send('Imagem não encontrada');
    }

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Content-Disposition', `inline; filename="${nomeArquivo}"`);
    res.setHeader('Cache-Control', 'no-store');

    response.body.pipe(res);

  } catch (err) {
    console.error('❌ ERRO IMAGEM:', err);

    res.status(500).send('Erro ao carregar imagem');
  }
});

app.get('/api/comprovante/pdf', async (req, res) => {
  try {
    const { nunota, token } = req.query;

    const nunotaNum = Number(nunota);

    if (!nunota || isNaN(nunotaNum)) {
      return res.status(400).send('NUNOTA inválido');
    }

    if (token !== gerarToken(nunota)) {
      return res.status(403).send('Acesso negado');
    }

    const cookie = await login();
    const nomeParc = await buscarNomeParcPorNunota(cookie, nunotaNum);
    const nomeArquivo = montarNomeComprovante(nunotaNum, nomeParc, 'pdf');

    const payload = {
      serviceName: 'DbExplorerSP.executeQuery',
      requestBody: {
        sql: `
          SELECT AD_COMPROVTRANSP
          FROM TGFCAB
          WHERE NUNOTA = ${nunotaNum}
        `
      }
    };

    const response = await fetch(
      `${SERVICE_URL}?serviceName=DbExplorerSP.executeQuery&outputType=json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': cookie
        },
        body: JSON.stringify(payload)
      }
    );

    const json = await response.json();
    const registro = json?.responseBody?.rows?.[0];

    if (!registro || !registro[0]) {
      return res.status(404).send('PDF não encontrado');
    }

    const buffer = Buffer.from(registro[0], 'base64');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${nomeArquivo}"`);

    res.send(buffer);

  } catch (err) {
    console.error('❌ ERRO PDF:', err);

    res.status(500).send('Erro ao processar PDF');
  }
});

app.post('/api/baixar-comprovantes', requireAdminApi, async (req, res) => {
  try {
    const { pedidos } = req.body;

    if (!Array.isArray(pedidos) || !pedidos.length) {
      return res.status(400).json({
        erro: 'Nenhum pedido informado'
      });
    }

    const listaPedidos = pedidos
      .map(p => Number(p))
      .filter(p => p && !isNaN(p));

    if (!listaPedidos.length) {
      return res.status(400).json({
        erro: 'Nenhum pedido válido informado'
      });
    }

    const cookie = await login();
    const listaLight = await carregarViewLight(cookie);
    const mapaNomeParc = montarMapaNomeParc(listaLight);

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename=comprovantes.zip'
    );

    const archive = archiver('zip', {
      zlib: {
        level: 9
      }
    });

    archive.on('error', err => {
      console.error('❌ ERRO ARCHIVE:', err);

      if (!res.headersSent) {
        res.status(500).json({
          erro: err.message
        });
      }
    });

    archive.pipe(res);

    for (const nunota of listaPedidos) {
      try {
        console.log(`🔍 PROCESSANDO ${nunota}`);

        const nomeParc =
          mapaNomeParc.get(String(nunota)) ||
          await buscarNomeParcPorNunota(cookie, nunota);

        const imgUrl =
          `${BASE_URL}/mge/AD_APPENTFOTO@FOTO@NUNOTA=${nunota}@SEQ=1.dbimage`;

        const imgResponse = await fetch(
          imgUrl,
          {
            headers: {
              Cookie: cookie
            }
          }
        );

        if (imgResponse.ok) {
          const arrayBuffer = await imgResponse.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);

          if (buffer.length > 0) {
            archive.append(buffer, {
              name: montarNomeComprovante(nunota, nomeParc, 'jpg')
            });

            console.log(`✅ IMG ${nunota}`);

            continue;
          }
        }

        const payload = {
          serviceName: 'DbExplorerSP.executeQuery',
          requestBody: {
            sql: `
              SELECT AD_COMPROVTRANSP
              FROM TGFCAB
              WHERE NUNOTA = ${Number(nunota)}
            `
          }
        };

        const response = await fetch(
          `${SERVICE_URL}?serviceName=DbExplorerSP.executeQuery&outputType=json`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Cookie': cookie
            },
            body: JSON.stringify(payload)
          }
        );

        const json = await response.json();
        const registro = json?.responseBody?.rows?.[0];

        if (registro && registro[0]) {
          const buffer = Buffer.from(registro[0], 'base64');

          if (buffer.length > 0) {
            archive.append(buffer, {
              name: montarNomeComprovante(nunota, nomeParc, 'pdf')
            });

            console.log(`✅ PDF ${nunota}`);
          }
        }

      } catch (err) {
        console.error(`❌ ERRO ${nunota}:`, err.message);
      }
    }

    await archive.finalize();

    console.log('✅ ZIP FINALIZADO');

  } catch (err) {
    console.error('❌ ERRO ZIP:', err);

    if (!res.headersSent) {
      res.status(500).json({
        erro: err.message
      });
    }
  }
});

app.listen(
  PORT,
  '0.0.0.0',
  () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log(`📱 Local: http://localhost:${PORT}`);
  }
);