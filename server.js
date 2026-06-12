const express = require('express');
const cors = require('cors');
const crypto = require('crypto');

const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 5050;

// =========================
// 🔐 CONFIG
// =========================
const SECRET = process.env.SECRET || "chave_super_secreta";

const BASE_URL = "http://topcesta.fwc.cloud:8180";
const SERVICE_URL = `${BASE_URL}/mge/service.sbr`;

const USER = process.env.USER || "HUEMERSON";
const PASS = process.env.PASS || "654321";

// =========================
// 🌐 LOG
// =========================
app.use((req, res, next) => {
  console.log(`🌐 ${req.method} ${req.url}`);
  next();
});

// =========================
// 🔐 LOGIN (CACHE)
// =========================
let cachedCookie = null;
let cookieTime = 0;

async function login() {
  const now = Date.now();

  if (cachedCookie && (now - cookieTime < 5 * 60 * 1000)) {
    return cachedCookie;
  }

  const payload = {
    serviceName: "MobileLoginSP.login",
    requestBody: {
      NOMUSU: { $: USER },
      INTERNO: { $: PASS }
    }
  };

  const response = await fetch(
    `${SERVICE_URL}?serviceName=MobileLoginSP.login&outputType=json`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }
  );

  const rawCookie = response.headers.get("set-cookie") || "";
  const cookie = rawCookie.split(";")[0];

  if (!cookie) throw new Error("Erro ao autenticar no Sankhya");

  cachedCookie = cookie;
  cookieTime = now;

  return cookie;
}

// =========================
// 🔐 TOKEN
// =========================
function gerarToken(nunota) {
  return crypto
    .createHash('sha256')
    .update(String(nunota) + SECRET)
    .digest('hex');
}

// =========================
// 📅 PARSE DATA BR
// =========================
function parseDataBR(dataStr) {
  if (!dataStr) return null;

  const [data] = dataStr.split(" ");
  const [dia, mes, ano] = data.split("/");

  return new Date(`${ano}-${mes}-${dia}`);
}

function escapeSql(valor) {
  return String(valor || '').replace(/'/g, "''");
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

  const json = await response.json();

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
    return;
  }

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
  }

  console.log(`✅ Links gravados/atualizados na AD_LINKSPEDIDOS: ${links.length}`);
}

// =========================
// 🔎 GERAR LINKS
// =========================
app.post('/api/gerar-links', async (req, res) => {
  try {

    const { cnpj, ordemCarga, data, pedidos } = req.body;

    const documento = (cnpj || "").replace(/\D/g, '');
    const ordem = ordemCarga ? String(ordemCarga) : null;

    let listaPedidos = [];
    if (pedidos) {
      listaPedidos = pedidos
        .split(',')
        .map(p => p.trim())
        .filter(p => p.length > 0);
    }

    // =========================
    // 🔥 IDENTIFICA FILTRO ATIVO
    // =========================
    let tipoFiltro = null;

    if (listaPedidos.length > 0) tipoFiltro = "PEDIDOS";
    else if (documento) tipoFiltro = "DOCUMENTO";
    else if (ordem) tipoFiltro = "ORDEM";
    else if (data) tipoFiltro = "DATA";

    if (!tipoFiltro) {
      return res.status(400).json({
        erro: "Informe ao menos um filtro"
      });
    }

    const cookie = await login();

    const payload = {
      serviceName: "CRUDServiceProvider.loadView",
      requestBody: {
        query: {
          viewName: "VW_NOTAS_FUSION_LIGHT"
        }
      }
    };

    const response = await fetch(
      `${SERVICE_URL}?serviceName=CRUDServiceProvider.loadView&outputType=json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cookie": cookie
        },
        body: JSON.stringify(payload)
      }
    );

    const json = await response.json();

    let lista = [];
    const rec = json?.responseBody?.records?.record;

    if (rec) {
      lista = Array.isArray(rec) ? rec : [rec];
    }

    // =========================
    // 📅 DATA RANGE
    // =========================
    let inicio = null;
    let fim = null;

    if (tipoFiltro === "DATA") {
      inicio = new Date(data + "T00:00:00");
      fim = new Date(data + "T23:59:59");
    }

    const filtrados = lista.filter(r => {

      const doc = (r.CGC_CPF?.$ || "").replace(/\D/g, '');
      const oc = r.ORDEMCARGA?.$ ? String(r.ORDEMCARGA.$) : "";
      const nunota = String(r.NUNOTA?.$ || "");

      switch (tipoFiltro) {

        case "PEDIDOS":
          return listaPedidos.includes(nunota);

        case "DOCUMENTO":
          return doc === documento;

        case "ORDEM":
          return oc === ordem;

        case "DATA":
          const dataPedido = parseDataBR(r.DTNEG?.$);
          return dataPedido >= inicio && dataPedido <= fim;

        default:
          return false;
      }
    });

    const baseUrl = `${req.protocol}://${req.get('host')}`;

    const links = filtrados.map(r => ({
      nunota: r.NUNOTA.$,
      link: `${baseUrl}/index.html?nunota=${r.NUNOTA.$}&token=${gerarToken(r.NUNOTA.$)}`
    }));

    await gravarLinksPedidos(cookie, links);

    res.json({ total: links.length, links });

  } catch (err) {
    console.error("❌ ERRO gerar-links:", err);
    res.status(500).json({ erro: err.message });
  }
});

// =========================
// 🔎 CONSULTA PEDIDO
// =========================
app.get('/api/pedido', async (req, res) => {
  try {

    const { nunota, token } = req.query;

    if (!nunota || !token) {
      return res.status(400).json({ erro: "Parâmetros inválidos" });
    }

    if (token !== gerarToken(nunota)) {
      return res.status(403).json({ erro: "Acesso negado" });
    }

    const cookie = await login();

    const payload = {
      serviceName: "CRUDServiceProvider.loadView",
      requestBody: {
        query: {
          viewName: "VW_NOTAS_FUSION"
        }
      }
    };

    const response = await fetch(
      `${SERVICE_URL}?serviceName=CRUDServiceProvider.loadView&outputType=json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cookie": cookie
        },
        body: JSON.stringify(payload)
      }
    );

    const json = await response.json();

    let lista = [];
    const rec = json?.responseBody?.records?.record;

    if (rec) {
      lista = Array.isArray(rec) ? rec : [rec];
    }

    const pedido = lista.find(r => String(r.NUNOTA.$) === String(nunota));

    if (!pedido) {
      return res.json({ rows: [] });
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
        TRANSPORTADORA: (pedido.TRANSPORTADORA?.$ || "").trim(),
        ST_ENTREGAS: pedido.ST_ENTREGAS?.$,
        TEM_FOTO: tipo === 1,
        TEM_PDF: tipo === 2
      }]
    });

  } catch (err) {
    console.error("❌ ERRO pedido:", err);
    res.status(500).json({ erro: err.message });
  }
});

// =========================
// 📷 IMAGEM
// =========================
app.get('/api/comprovante/imagem', async (req, res) => {
  try {

    const { nunota, token } = req.query;

    if (token !== gerarToken(nunota)) {
      return res.status(403).send("Acesso negado");
    }

    const cookie = await login();

    const url = `${BASE_URL}/mge/AD_APPENTFOTO@FOTO@NUNOTA=${nunota}@SEQ=1.dbimage`;

    const response = await fetch(url, {
      headers: { "Cookie": cookie }
    });

    if (!response.ok) {
      return res.status(404).send("Imagem não encontrada");
    }

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'no-store');

    response.body.pipe(res);

  } catch (err) {
    console.error(err);
    res.status(500).send("Erro ao carregar imagem");
  }
});

// =========================
// 📄 PDF
// =========================
app.get('/api/comprovante/pdf', async (req, res) => {
  try {

    const { nunota, token } = req.query;
    const nunotaNum = Number(nunota);

    if (!nunota || isNaN(nunotaNum)) {
      return res.status(400).send("NUNOTA inválido");
    }

    if (token !== gerarToken(nunota)) {
      return res.status(403).send("Acesso negado");
    }

    const cookie = await login();

    const payload = {
      serviceName: "DbExplorerSP.executeQuery",
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
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cookie": cookie
        },
        body: JSON.stringify(payload)
      }
    );

    const json = await response.json();
    const registro = json?.responseBody?.rows?.[0];

    if (!registro || !registro[0]) {
      return res.status(404).send("PDF não encontrado");
    }

    const buffer = Buffer.from(registro[0], 'base64');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="comprovante.pdf"');

    res.send(buffer);

  } catch (err) {
    console.error("❌ ERRO PDF:", err);
    res.status(500).send("Erro ao processar PDF");
  }
});

// =========================
// START
// =========================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`📱 Acesse: http://localhost:${PORT}`);
  console.log(`🌐 Rede: http://${require('os').networkInterfaces().Ethernet?.[0]?.address || 'SEU_IP'}:${PORT}`);
});