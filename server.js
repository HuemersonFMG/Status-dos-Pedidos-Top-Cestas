const express = require('express');
const cors = require('cors');
const crypto = require('crypto');

// 🔥 fetch compatível com Render
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
// 🔐 LOGIN
// =========================
async function login() {
  console.log("🔐 Login Sankhya...");

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

  if (!cookie) {
    throw new Error("Falha ao obter cookie Sankhya");
  }

  console.log("🍪 Cookie OK");

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
// 🔥 NORMALIZADOR
// =========================
function normalizarRegistro(r) {
  return {
    NUNOTA: String(r.NUNOTA?.$ || '').trim(),
    CGC_CPF: String(r.CGC_CPF?.$ || '').replace(/\D/g, ''),
    ORDEMCARGA: String(r.ORDEMCARGA?.$ || '').trim(),
    DTNEG: r.DTNEG?.$ || '',
    NOMEPARC: r.NOMEPARC?.$
  };
}

// =========================
// 🔍 GERAR LINKS
// =========================
app.post('/api/gerar-links', async (req, res) => {
  try {

    let { cnpj, ordemCarga, data } = req.body;

    cnpj = (cnpj || "").replace(/\D/g, '');
    ordemCarga = (ordemCarga || "").trim();

    // 🔥 validação obrigatória
    if ((!cnpj && !ordemCarga) || (cnpj && ordemCarga)) {
      return res.status(400).json({
        erro: "Informe apenas CPF/CNPJ OU Ordem de Carga"
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

    console.log("📤 Buscando VIEW LIGHT...");

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

    if (json?.tsError) {
      console.error("❌ Sankhya:", json.tsError);
      return res.json({ total: 0, links: [] });
    }

    let lista = [];
    if (json?.responseBody?.records?.record) {
      const r = json.responseBody.records.record;
      lista = Array.isArray(r) ? r : [r];
    }

    console.log("📦 Total bruto:", lista.length);

    const listaNormalizada = lista.map(normalizarRegistro);

    // 🔥 FILTRO REAL
    const filtrados = listaNormalizada.filter(r => {

      if (cnpj) {
        return r.CGC_CPF === cnpj;
      }

      if (ordemCarga) {
        return r.ORDEMCARGA === ordemCarga;
      }

      return false;
    });

    console.log("📊 Filtrados:", filtrados.length);

    const baseUrl = `${req.protocol}://${req.get('host')}`;

    const links = filtrados.map(r => ({
      nunota: r.NUNOTA,
      link: `${baseUrl}/index.html?nunota=${r.NUNOTA}&token=${gerarToken(r.NUNOTA)}`
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

    console.log("📤 Buscando pedido...");

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

    if (json?.tsError) {
      console.error("❌ Sankhya:", json.tsError);
      return res.json({ rows: [] });
    }

    let lista = [];
    if (json?.responseBody?.records?.record) {
      const r = json.responseBody.records.record;
      lista = Array.isArray(r) ? r : [r];
    }

    const listaNormalizada = lista.map(normalizarRegistro);

    // 🔥 AGORA SIM: busca correta
    const pedidoBase = listaNormalizada.find(r => r.NUNOTA === String(nunota));

    if (!pedidoBase) {
      return res.json({ rows: [] });
    }

    // 🔥 pega o original (com campos completos)
    const pedidoOriginal = lista.find(r => String(r.NUNOTA?.$).trim() === String(nunota));

    // 🔥 DETECÇÃO DE ARQUIVO
    let tipoFoto = 0;

    if (pedidoOriginal.FOTO_ENTREGA) tipoFoto = 1;
    else if (pedidoOriginal.FOTO_COMPROV) tipoFoto = 2;

    res.json({
      rows: [{
        NUNOTA: pedidoBase.NUNOTA,
        NOMEPARC: pedidoBase.NOMEPARC,
        CGC_CPF: pedidoBase.CGC_CPF,
        ST_ENTREGAS: pedidoOriginal.ST_ENTREGAS?.$,

        TIPO_FOTO: tipoFoto,
        STATUS_FOTO: tipoFoto ? "Disponível" : "Sem comprovante"
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
  console.log(`🚀 Rodando na porta ${PORT}`);
});
