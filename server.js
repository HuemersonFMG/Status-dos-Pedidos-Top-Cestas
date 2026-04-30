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
// ⏱️ FETCH COM TIMEOUT
// =========================
async function fetchTimeout(url, options = {}, timeout = 15000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(id);
    return response;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

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

  const response = await fetchTimeout(
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
    throw new Error("Falha ao obter sessão Sankhya");
  }

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

    const { cnpj, carga, data } = req.body;

    const documento = (cnpj || "").replace(/\D/g, '');
    const ordemCarga = (carga || "").trim();

    // 🔒 validações
    if (!documento && !ordemCarga) {
      return res.status(400).json({ erro: "Informe CPF/CNPJ ou Ordem de Carga" });
    }

    if (documento && ordemCarga) {
      return res.status(400).json({ erro: "Informe apenas um filtro" });
    }

    const cookie = await login();

    // 🎯 FILTRO DIRETO NO SANKHYA
    const expression = documento
      ? `this.CGC_CPF = '${documento}'`
      : `this.ORDEMCARGA = ${ordemCarga}`;

    const payload = {
      serviceName: "CRUDServiceProvider.loadRecords",
      requestBody: {
        dataSet: {
          rootEntity: "VW_NOTAS_FUSION_LIGHT",
          includePresentationFields: "N",
          offsetPage: "0",
          criteria: {
            expression: { $: expression }
          }
        }
      }
    };

    console.log("📤 Buscando pedidos com filtro:", expression);

    const response = await fetchTimeout(
      `${SERVICE_URL}?serviceName=CRUDServiceProvider.loadRecords&outputType=json`,
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
      console.error("❌ Sankhya inválido:", text.substring(0, 200));
      throw new Error("Erro na comunicação com Sankhya");
    }

    const json = JSON.parse(text);

    if (json?.tsError) {
      console.error("❌ Erro Sankhya:", json.tsError);
      return res.json({ total: 0, links: [] });
    }

    let lista = [];

    if (json?.responseBody?.records?.record) {
      const r = json.responseBody.records.record;
      lista = Array.isArray(r) ? r : [r];
    }

    console.log("📦 Total retornado:", lista.length);

    const filtrados = lista.filter(r => {
      if (data) {
        return new Date(r.DTNEG?.$) >= new Date(data);
      }
      return true;
    });

    const baseUrl = `${req.protocol}://${req.get('host')}`;

    const links = filtrados.map(r => {
      const nunota = r.NUNOTA?.$;
      return {
        nunota,
        link: `${baseUrl}/index.html?nunota=${nunota}&token=${gerarToken(nunota)}`
      };
    });

    res.json({ total: links.length, links });

  } catch (err) {
    console.error("❌ ERRO /gerar-links:", err);
    res.status(500).json({ erro: err.message });
  }
});

// =========================
// 🔎 CONSULTA PEDIDO (ULTRA RÁPIDA)
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
      serviceName: "CRUDServiceProvider.loadRecords",
      requestBody: {
        dataSet: {
          rootEntity: "VW_NOTAS_FUSION",
          includePresentationFields: "N",
          offsetPage: "0",
          criteria: {
            expression: {
              $: `this.NUNOTA = ${nunota}`
            }
          }
        }
      }
    };

    console.log("📤 Buscando pedido:", nunota);

    const response = await fetchTimeout(
      `${SERVICE_URL}?serviceName=CRUDServiceProvider.loadRecords&outputType=json`,
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
      return res.json({ rows: [] });
    }

    let lista = [];

    if (json?.responseBody?.records?.record) {
      const r = json.responseBody.records.record;
      lista = Array.isArray(r) ? r : [r];
    }

    if (!lista.length) {
      return res.json({ rows: [] });
    }

    const pedido = lista[0];

    // 🔥 DETECÇÃO DE ARQUIVO
    const temFoto1 = !!pedido.FOTO;
    const temFoto2 = !!pedido.AD_COMPROVTRANSP;

    let tipoFoto = 0;
    if (temFoto1) tipoFoto = 1;
    else if (temFoto2) tipoFoto = 2;

    res.json({
      rows: [{
        NUNOTA: pedido.NUNOTA?.$,
        NUMNOTA: pedido.NUMNOTA?.$,
        NOMEPARC: pedido.NOMEPARC?.$,
        CGC_CPF: pedido.CGC_CPF?.$,
        ST_ENTREGAS: pedido.ST_ENTREGAS?.$,
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
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
