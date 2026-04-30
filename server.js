const express = require('express');
const cors = require('cors');
const crypto = require('crypto');

// fetch compatível com Render
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
// 🔍 GERAR LINKS (FILTRO DIRETO)
// =========================
app.post('/api/gerar-links', async (req, res) => {
  try {
    let { cnpj, ordemCarga, data } = req.body;

    cnpj = (cnpj || "").replace(/\D/g, '');
    ordemCarga = (ordemCarga || "").toString().trim();

    // 🚫 validação
    if (!cnpj && !ordemCarga) {
      return res.status(400).json({ erro: "Informe CPF/CNPJ ou Ordem de Carga" });
    }

    if (cnpj && ordemCarga) {
      return res.status(400).json({ erro: "Use apenas um filtro por vez" });
    }

    const cookie = await login();

    // =========================
    // 🔥 MONTA FILTRO DINÂMICO
    // =========================
    let filtro = "";

    if (cnpj) {
      filtro = `CGC_CPF = '${cnpj}'`;
    } else {
      filtro = `ORDEMCARGA = ${Number(ordemCarga)}`;
    }

    if (data) {
      filtro += ` AND DTNEG >= TO_DATE('${data}','YYYY-MM-DD')`;
    }

    console.log("🔎 Filtro:", filtro);

    const payload = {
      serviceName: "CRUDServiceProvider.loadView",
      requestBody: {
        query: {
          viewName: "VW_NOTAS_FUSION_LIGHT",
          criteria: {
            expression: { $: filtro }
          }
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
      console.error("❌ Sankhya:", text.substring(0, 200));
      throw new Error("Erro na comunicação com Sankhya");
    }

    const json = JSON.parse(text);

    let lista = [];
    if (json?.responseBody?.records?.record) {
      const r = json.responseBody.records.record;
      lista = Array.isArray(r) ? r : [r];
    }

    console.log("📦 Encontrados:", lista.length);

    const baseUrl = `${req.protocol}://${req.get('host')}`;

    const links = lista.map(r => ({
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
// 🔎 CONSULTA PEDIDO (POR NUNOTA)
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
          viewName: "VW_NOTAS_FUSION",
          criteria: {
            expression: {
              $: `NUNOTA = ${Number(nunota)}`
            }
          }
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
      console.error("❌ Sankhya:", text.substring(0, 200));
      throw new Error("Erro na comunicação com Sankhya");
    }

    const json = JSON.parse(text);

    let lista = [];
    if (json?.responseBody?.records?.record) {
      const r = json.responseBody.records.record;
      lista = Array.isArray(r) ? r : [r];
    }

    if (!lista.length) {
      return res.json({ rows: [] });
    }

    const p = lista[0];

    res.json({
      rows: [{
        NUNOTA: p.NUNOTA?.$,
        NUMNOTA: p.NUMNOTA?.$,
        NOMEPARC: p.NOMEPARC?.$,
        CGC_CPF: p.CGC_CPF?.$,
        ST_ENTREGAS: p.ST_ENTREGAS?.$,
        TIPO_FOTO: Number(p.TIPO_FOTO?.$ || 0),
        STATUS_FOTO: p.STATUS_FOTO?.$
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
