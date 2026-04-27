const express = require('express');
const cors = require('cors');
const crypto = require('crypto');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 5050;

// =========================
// 🔐 CONFIG
// =========================
const SECRET = "chave_super_secreta"; // troque em produção

// =========================
// 🌐 LOG GLOBAL
// =========================
app.use((req, res, next) => {
  console.log(`🌐 ${req.method} ${req.url}`);
  next();
});

// =========================
// 🔗 SANKHYA
// =========================
const BASE_URL = "http://topcesta.fwc.cloud:8180";
const SERVICE_URL = `${BASE_URL}/mge/service.sbr`;

const USER = "HUEMERSON";
const PASS = "654321";

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

  console.log("🍪 COOKIE:", cookie);

  return cookie;
}

// =========================
// 🔐 GERAR TOKEN
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

    const { cnpj, data } = req.body;

    const documento = (cnpj || "").replace(/\D/g, '');

    if (!documento) {
      return res.status(400).json({ erro: "CNPJ obrigatório" });
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

    console.log("📤 Chamando Sankhya...");

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

    // 🔥 erro Sankhya
    if (json?.tsError) {
      console.log("❌ ERRO SANKHYA:", json.tsError);
      return res.json({ total: 0, links: [] });
    }

    // =========================
    // 🔥 TRATAMENTO SEGURO
    // =========================
    let lista = [];

    if (json?.responseBody?.records?.record) {
      const registros = json.responseBody.records.record;
      lista = Array.isArray(registros) ? registros : [registros];
    }

    console.log("📦 TOTAL REGISTROS:", lista.length);

    // =========================
    // 🔎 FILTRO
    // =========================
    const filtrados = lista
      .map(r => ({
        NUNOTA: r.NUNOTA?.$,
        CGC_CPF: (r.CGC_CPF?.$ || "").replace(/\D/g, ''),
        DTNEG: r.DTNEG?.$
      }))
      .filter(r => {

        if (r.CGC_CPF !== documento) return false;

        if (data) {
          const dataPedido = new Date(r.DTNEG);
          const dataFiltro = new Date(data);
          return dataPedido >= dataFiltro;
        }

        return true;
      });

    console.log("📊 FILTRADOS:", filtrados.length);

    // =========================
    // 🔗 GERAR LINKS
    // =========================
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
    console.error("❌ ERRO:", err);
    res.status(500).json({ erro: err.message });
  }
});

// =========================
// 🔎 CONSULTA POR LINK
// =========================
app.get('/api/pedido', async (req, res) => {
  try {

    const { nunota, token } = req.query;

    if (!nunota || !token) {
      return res.status(400).json({ erro: "Parâmetros inválidos" });
    }

    const tokenValido = gerarToken(nunota);

    if (token !== tokenValido) {
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
      console.log("❌ ERRO SANKHYA:", json.tsError);
      return res.json({ rows: [] });
    }

    let lista = [];

    if (json?.responseBody?.records?.record) {
      const registros = json.responseBody.records.record;
      lista = Array.isArray(registros) ? registros : [registros];
    }

    console.log("📦 TOTAL REGISTROS:", lista.length);

    const pedido = lista.find(r => r.NUNOTA?.$ == nunota);

    if (!pedido) {
      console.log("⚠️ Pedido não encontrado");
      return res.json({ rows: [] });
    }

    res.json({
      rows: [{
        NUNOTA: pedido.NUNOTA?.$,
        NUMNOTA: pedido.NUMNOTA?.$,
        NOMEPARC: pedido.NOMEPARC?.$,
        ST_ENTREGAS: pedido.ST_ENTREGAS?.$
      }]
    });

  } catch (err) {
    console.error("❌ ERRO:", err);
    res.status(500).json({ erro: err.message });
  }
});

// =========================
// START
// =========================
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
