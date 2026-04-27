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
const SECRET = "chave_super_secreta"; // 🔥 troque isso

// =========================
// 🌐 LOG
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
  const payload = {
    serviceName: "MobileLoginSP.login",
    requestBody: {
      NOMUSU: { $: USER },
      INTERNO: { $: PASS }
    }
  };

  const res = await fetch(
    `${SERVICE_URL}?serviceName=MobileLoginSP.login&outputType=json`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }
  );

  const rawCookie = res.headers.get("set-cookie") || "";
  return rawCookie.split(";")[0];
}

// =========================
// 🔐 GERAR TOKEN
// =========================
function gerarToken(nunota) {
  return crypto
    .createHash('sha256')
    .update(nunota + SECRET)
    .digest('hex');
}

// =========================
// 🔍 GERAR LINKS POR CNPJ
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

    const json = JSON.parse(await response.text());

    const registros = json?.responseBody?.records?.record || [];
    const lista = Array.isArray(registros) ? registros : [registros];

    const filtrados = lista
      .map(r => ({
        NUNOTA: r.NUNOTA?.$,
        CGC_CPF: (r.CGC_CPF?.$ || "").replace(/\D/g, ''),
        DTNEG: r.DTNEG?.$
      }))
      .filter(r => {
        if (r.CGC_CPF !== documento) return false;

        if (data) {
          return r.DTNEG >= data;
        }

        return true;
      });

    const baseUrl = "https://status-dos-pedidos-top-cestas.onrender.com";

    const links = filtrados.map(r => {
      const token = gerarToken(r.NUNOTA);

      return {
        nunota: r.NUNOTA,
        link: `${baseUrl}/index.html?nunota=${r.NUNOTA}&token=${token}`
      };
    });

    res.json({ total: links.length, links });

  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: err.message });
  }
});

// =========================
// 🔎 CONSULTA SEGURA POR LINK
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

    const json = JSON.parse(await response.text());

    const registros = json?.responseBody?.records?.record || [];
    const lista = Array.isArray(registros) ? registros : [registros];

    const pedido = lista.find(r => r.NUNOTA?.$ == nunota);

    if (!pedido) {
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
    console.error(err);
    res.status(500).json({ erro: err.message });
  }
});

// =========================
// START
// =========================
app.listen(PORT, () => {
  console.log(`🚀 Rodando na porta ${PORT}`);
});
