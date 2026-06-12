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

function escapeSql(valor) {
  return String(valor || '').replace(/'/g, "''");
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

async function executarUpdateSankhya(cookie, sql) {
  const payload = {
    serviceName: 'DbExplorerSP.executeUpdate',
    requestBody: {
      sql
    }
  };

  const response = await fetch(
    `${SERVICE_URL}?serviceName=DbExplorerSP.executeUpdate&outputType=json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie
      },
      body: JSON.stringify(payload)
    }
  );

  let json = {};

  try {
    json = await response.json();
  } catch {
    throw new Error('Erro ao interpretar retorno do Sankhya ao executar update.');
  }

  if (!response.ok || String(json.status || '') !== '1') {
    throw new Error(
      json.statusMessage ||
      json.message ||
      'Erro ao executar comando no Sankhya.'
    );
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
    const nunota = Number(item?.nunota || item?.NUNOTA);
    const link = String(item?.link || item?.LINK || '').trim();

    if (!nunota || isNaN(nunota) || !link) {
      continue;
    }

    const linkSql = escapeSql(link);

    await executarUpdateSankhya(cookie, `
      MERGE INTO AD_LINKSPEDIDOS LNK
      USING (
        SELECT
          ${nunota} AS NUNOTA,
          TO_CLOB('${linkSql}') AS LINK,
          SYSDATE AS DHCAD
        FROM DUAL
      ) SRC
      ON (LNK.NUNOTA = SRC.NUNOTA)
      WHEN MATCHED THEN
        UPDATE SET
          LNK.LINK = SRC.LINK,
          LNK.DHCAD = SRC.DHCAD
      WHEN NOT MATCHED THEN
        INSERT (
          SEQ,
          NUNOTA,
          LINK,
          DHCAD
        )
        VALUES (
          NVL((SELECT MAX(SEQ) + 1 FROM AD_LINKSPEDIDOS), 1),
          SRC.NUNOTA,
          SRC.LINK,
          SRC.DHCAD
        )
    `);

    totalGravado++;
  }

  console.log(`✅ Links gravados/atualizados na AD_LINKSPEDIDOS: ${totalGravado}`);

  return {
    totalRecebido: links.length,
    totalGravado
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