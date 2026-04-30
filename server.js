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
// 🔐 LOGIN SANKHYA
// =========================
async function login() {

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

  if (!cookie) throw new Error("Falha ao autenticar no Sankhya");

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
// 🔍 GERAR LINKS
// =========================
app.post('/api/gerar-links', async (req, res) => {

  try {

    let { cnpj, ordemCarga, data } = req.body;

    const documento = (cnpj || "").replace(/\D/g, '');
    const ordem = ordemCarga ? String(ordemCarga).trim() : null;

    // 🔥 validação
    if ((!documento && !ordem) || (documento && ordem)) {
      return res.status(400).json({
        erro: "Informe CPF/CNPJ OU Ordem de Carga"
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

    const text = await response.text();

    if (!response.ok || text.startsWith("<")) {
      throw new Error("Erro na comunicação com Sankhya");
    }

    const json = JSON.parse(text);

    let lista = [];
    if (json?.responseBody?.records?.record) {
      const r = json.responseBody.records.record;
      lista = Array.isArray(r) ? r : [r];
    }

    // =========================
    // 🔥 FILTRO CORRETO
    // =========================
    const filtrados = lista.filter(r => {

      const doc = (r.CGC_CPF?.$ || "").replace(/\D/g, '');
      const oc = String(r.ORDEMCARGA?.$ || "").trim();

      if (documento) {
        if (doc !== documento) return false;
      }

      if (ordem) {
        if (oc !== ordem) return false;
      }

      if (data) {
        if (new Date(r.DTNEG?.$) < new Date(data)) return false;
      }

      return true;
    });

    const baseUrl = `${req.protocol}://${req.get('host')}`;

    const links = filtrados.map(r => ({
      nunota: r.NUNOTA?.$,
      link: `${baseUrl}/index.html?nunota=${r.NUNOTA?.$}&token=${gerarToken(r.NUNOTA?.$)}`
    }));

    res.json({ total: links.length, links });

  } catch (err) {
    console.error("❌ ERRO /gerar-links:", err);
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

    const text = await response.text();

    if (!response.ok || text.startsWith("<")) {
      throw new Error("Erro na comunicação com Sankhya");
    }

    const json = JSON.parse(text);

    let lista = [];
    if (json?.responseBody?.records?.record) {
      const r = json.responseBody.records.record;
      lista = Array.isArray(r) ? r : [r];
    }

    // 🔥 ENCONTRA O PEDIDO CORRETO
    const pedido = lista.find(r => r.NUNOTA?.$ == nunota);

    if (!pedido) {
      return res.json({ rows: [] });
    }

    // =========================
    // 🔥 USAR VIEW (CORRETO)
    // =========================
    const tipoFoto = Number(pedido.TIPO_FOTO?.$ || 0);
    const statusFoto = pedido.STATUS_FOTO?.$ || "Sem comprovante";

    // =========================
    // 🔥 DETECTAR URL EXTERNA (PDF S3)
    // =========================
    let urlArquivo = null;

    const comprov = pedido.FOTO_COMPROV?.$;

    if (tipoFoto === 2 && comprov) {
      const valor = String(comprov);

      if (valor.startsWith("http")) {
        urlArquivo = valor;
      }
    }

    res.json({
      rows: [{
        NUNOTA: pedido.NUNOTA?.$,
        NOMEPARC: pedido.NOMEPARC?.$,
        CGC_CPF: pedido.CGC_CPF?.$,
        ST_ENTREGAS: pedido.ST_ENTREGAS?.$,

        TIPO_FOTO: tipoFoto,
        STATUS_FOTO: statusFoto,
        URL_ARQUIVO: urlArquivo
      }]
    });

  } catch (err) {
    console.error("❌ ERRO /pedido:", err);
    res.status(500).json({ erro: err.message });
  }
});

// =========================
// START
// =========================
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
