const express = require('express');
const cors = require('cors');
const crypto = require('crypto');

// 🔥 fetch compatível com Render
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 5050;

// =========================
// 🔐 CONFIG
// =========================
const SECRET = process.env.SECRET || "chave_super_secreta";

// 🔗 SANKHYA
const BASE_URL = "http://topcesta.fwc.cloud:8180";
const SERVICE_URL = `${BASE_URL}/mge/service.sbr`;

const USER = process.env.USER || "HUEMERSON";
const PASS = process.env.PASS || "654321";

// =========================
// 🌐 LOG GLOBAL
// =========================
app.use((req, res, next) => {
  console.log(`🌐 ${req.method} ${req.url}`);
  next();
});

// =========================
// 🔐 LOGIN SANKHYA
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

  console.log("🍪 Cookie obtido");

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
// 🔍 GERAR LINKS (VIEW LEVE)
// =========================
app.post('/api/gerar-links', async (req, res) => {
  try {
    const { cnpj, data } = req.body;

    const documento = (cnpj || "")
      .replace(/\D/g, '')
      .trim();

    if (!documento) {
      return res.status(400).json({ erro: "CPF/CNPJ obrigatório" });
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

    console.log("📤 Buscando dados (VIEW LIGHT)...");

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

    // 🔥 proteção
    if (!response.ok || text.startsWith("<")) {
      console.error("❌ Resposta inválida Sankhya:", text.substring(0, 200));
      throw new Error("Erro na comunicação com Sankhya");
    }

    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      console.error("❌ JSON inválido:", text.substring(0, 300));
      throw new Error("Erro ao processar resposta");
    }

    if (json?.tsError) {
      console.error("❌ Erro Sankhya:", json.tsError);
      return res.json({ total: 0, links: [] });
    }

    let lista = [];

    if (json?.responseBody?.records?.record) {
      const registros = json.responseBody.records.record;
      lista = Array.isArray(registros) ? registros : [registros];
    }

    console.log("📦 Total registros:", lista.length);

    const filtrados = lista
      .map(r => ({
        NUNOTA: r.NUNOTA?.$,
        CGC_CPF: (r.CGC_CPF?.$ || "").replace(/\D/g, ''),
        DTNEG: r.DTNEG?.$
      }))
      .filter(r => {

        if (!r.CGC_CPF) return false;

        if (r.CGC_CPF !== documento) return false;

        if (data) {
          return new Date(r.DTNEG) >= new Date(data);
        }

        return true;
      });

    console.log("📊 Filtrados:", filtrados.length);

    const baseUrl = `${req.protocol}://${req.get('host')}`;

    const links = filtrados.map(r => {
      const token = gerarToken(r.NUNOTA);

      return {
        nunota: r.NUNOTA,
        link: `${baseUrl}/index.html?nunota=${r.NUNOTA}&token=${token}`
      };
    });

    res.json({ total: links.length, links });

  } catch (err) {
    console.error("❌ ERRO /gerar-links:", err);
    res.status(500).json({ erro: err.message });
  }
});

// =========================
// 🔎 CONSULTA PEDIDO (VIEW COMPLETA)
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

    console.log("📤 Buscando pedido completo...");

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
      console.error("❌ Erro Sankhya:", json.tsError);
      return res.json({ rows: [] });
    }

    let lista = [];

    if (json?.responseBody?.records?.record) {
      const registros = json.responseBody.records.record;
      lista = Array.isArray(registros) ? registros : [registros];
    }

    const pedido = lista.find(r => r.NUNOTA?.$ == nunota);

    if (!pedido) {
      return res.json({ rows: [] });
    }

    res.json({
      rows: [{
        NUNOTA: pedido.NUNOTA?.$,
        NUMNOTA: pedido.NUMNOTA?.$,
        NOMEPARC: pedido.NOMEPARC?.$,
        ST_ENTREGAS: pedido.ST_ENTREGAS?.$,
        TIPO_FOTO: pedido.TIPO_FOTO?.$,
        STATUS_FOTO: pedido.STATUS_FOTO?.$
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
