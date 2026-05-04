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

  if (!cookie) throw new Error("Erro login Sankhya");

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
// 🔧 NORMALIZAR
// =========================
function limparDoc(valor) {
  return (valor || "").replace(/\D/g, '');
}

// =========================
// 🔍 GERAR LINKS (LIGHT)
// =========================
app.post('/api/gerar-links', async (req, res) => {
  try {

    let { cnpj, ordemCarga, data } = req.body;

    cnpj = limparDoc(cnpj);
    ordemCarga = limparDoc(ordemCarga);

    if (!cnpj && !ordemCarga) {
      return res.status(400).json({ erro: "Informe CPF/CNPJ ou Ordem de Carga" });
    }

    if (cnpj && ordemCarga) {
      return res.status(400).json({ erro: "Use apenas um filtro" });
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
    if (json?.responseBody?.records?.record) {
      const r = json.responseBody.records.record;
      lista = Array.isArray(r) ? r : [r];
    }

    const filtrados = lista.filter(r => {

      const doc = limparDoc(r.CGC_CPF?.$);
      const oc = limparDoc(r.ORDEMCARGA?.$);

      if (cnpj && doc !== cnpj) return false;
      if (ordemCarga && oc !== ordemCarga) return false;

      if (data) {
        return new Date(r.DTNEG?.$) >= new Date(data);
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
    console.error(err);
    res.status(500).json({ erro: err.message });
  }
});

// =========================
// 🔎 PEDIDO (COMPLETO)
// =========================
app.get('/api/pedido', async (req, res) => {
  try {

    const { nunota, token } = req.query;

    if (!nunota || !token) {
      return res.status(400).json({ erro: "Parâmetros inválidos" });
    }

    if (token !== gerarToken(nunota)) {
      return res.status(403).json({ erro: "Token inválido" });
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
    if (json?.responseBody?.records?.record) {
      const r = json.responseBody.records.record;
      lista = Array.isArray(r) ? r : [r];
    }

    const pedido = lista.find(r => r.NUNOTA?.$ == nunota);

    if (!pedido) {
      return res.json({ rows: [] });
    }

    // =========================
    // 📎 ARQUIVO
    // =========================
    let arquivo = null;

    if (pedido.FOTO_ENTREGA) {
      arquivo = {
        tipo: "img",
        url: `/api/arquivo?nunota=${nunota}&tipo=1`
      };
    } else if (pedido.FOTO_COMPROV) {
      arquivo = {
        tipo: "pdf",
        url: `/api/arquivo?nunota=${nunota}&tipo=2`
      };
    }

    res.json({
      rows: [{
        NUNOTA: pedido.NUNOTA?.$,
        NOMEPARC: pedido.NOMEPARC?.$,
        CGC_CPF: pedido.CGC_CPF?.$,
        ST_ENTREGAS: pedido.ST_ENTREGAS?.$,

        STATUS_FOTO: arquivo
          ? (arquivo.tipo === "img" ? "Foto Entrega" : "Comprovante PDF")
          : "Sem comprovante",

        ARQUIVO: arquivo
      }]
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: err.message });
  }
});

// =========================
// 📎 SERVIR ARQUIVO
// =========================
app.get('/api/arquivo', async (req, res) => {
  try {

    const { nunota, tipo } = req.query;

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
    if (json?.responseBody?.records?.record) {
      const r = json.responseBody.records.record;
      lista = Array.isArray(r) ? r : [r];
    }

    const pedido = lista.find(r => r.NUNOTA?.$ == nunota);

    let base64;

    if (tipo == 1) base64 = pedido.FOTO_ENTREGA?.$;
    if (tipo == 2) base64 = pedido.FOTO_COMPROV?.$;

    if (!base64) return res.status(404).send("Arquivo não encontrado");

    const buffer = Buffer.from(base64, 'base64');

    // 🔥 DETECÇÃO PDF
    const header = buffer.slice(0, 4).toString();

    if (header === "%PDF") {
      res.setHeader("Content-Type", "application/pdf");
    } else {
      res.setHeader("Content-Type", "image/jpeg");
    }

    res.send(buffer);

  } catch (err) {
    console.error(err);
    res.status(500).send("Erro arquivo");
  }
});

// =========================
// START
// =========================
app.listen(PORT, () => {
  console.log(`🚀 Rodando na porta ${PORT}`);
});
