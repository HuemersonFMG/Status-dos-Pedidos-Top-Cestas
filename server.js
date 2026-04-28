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
const SECRET = "chave_super_secreta";

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

  const cookie = (response.headers.get("set-cookie") || "").split(";")[0];
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
// 🔧 UTIL
// =========================
function limparDoc(doc) {
  return (doc || "").replace(/\D/g, '');
}

// =========================
// 🔗 GERAR LINKS
// =========================
app.post('/api/gerar-links', async (req, res) => {
  try {

    let { doc, data } = req.body;
    doc = limparDoc(doc);

    if (!doc) {
      return res.status(400).json({ erro: "CPF/CNPJ obrigatório" });
    }

    const cookie = await login();

    const payload = {
      serviceName: "CRUDServiceProvider.loadView",
      requestBody: {
        query: { viewName: "VW_NOTAS_FUSION" }
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
      throw new Error("Erro Sankhya");
    }

    const json = JSON.parse(text);

    let lista = [];
    if (json?.responseBody?.records?.record) {
      const registros = json.responseBody.records.record;
      lista = Array.isArray(registros) ? registros : [registros];
    }

    // 🔎 FILTRO
    const filtrados = lista.filter(r => {
      const docBanco = limparDoc(r.CGC_CPF?.$);
      if (docBanco !== doc) return false;

      if (data) {
        const dt = new Date(r.DTNEG?.$);
        return dt >= new Date(data);
      }

      return true;
    });

    const baseUrl = `${req.protocol}://${req.get('host')}`;

    const links = filtrados.map(r => {
      const nunota = r.NUNOTA?.$;
      return {
        nunota,
        nome: r.NOMEPARC?.$,
        link: `${baseUrl}/index.html?nunota=${nunota}&token=${gerarToken(nunota)}`
      };
    });

    res.json({ total: links.length, links });

  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: err.message });
  }
});

// =========================
// 🔎 PEDIDO
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
        query: { viewName: "VW_NOTAS_FUSION" }
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
      throw new Error("Erro Sankhya");
    }

    const json = JSON.parse(text);

    let lista = [];
    if (json?.responseBody?.records?.record) {
      const registros = json.responseBody.records.record;
      lista = Array.isArray(registros) ? registros : [registros];
    }

    const p = lista.find(r => r.NUNOTA?.$ == nunota);

    if (!p) return res.json({ rows: [] });

    res.json({
      rows: [{
        NUNOTA: p.NUNOTA?.$,
        NUMNOTA: p.NUMNOTA?.$,
        NOMEPARC: p.NOMEPARC?.$,
        CGC_CPF: p.CGC_CPF?.$,
        TIPO_DOC: p.TIPO_DOC?.$,
        ST_ENTREGAS: p.ST_ENTREGAS?.$,
        STATUS_FOTO: p.STATUS_FOTO?.$
      }]
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: err.message });
  }
});

// =========================
// 🖼️ FOTO
// =========================
app.get('/api/nota/:nunota/foto', async (req, res) => {
  try {

    const nunota = req.params.nunota;
    const cookie = await login();

    const payload = {
      serviceName: "CRUDServiceProvider.loadView",
      requestBody: {
        query: { viewName: "VW_NOTAS_FUSION" }
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
    const json = JSON.parse(text);

    let lista = [];
    if (json?.responseBody?.records?.record) {
      const registros = json.responseBody.records.record;
      lista = Array.isArray(registros) ? registros : [registros];
    }

    const p = lista.find(r => r.NUNOTA?.$ == nunota);

    if (!p) return res.json({ imagem: null });

    let imagem = null;

    // 🔥 FOTO ENTREGA (BLOB → base64)
    if (p.TIPO_FOTO?.$ == 1 && p.FOTO_ENTREGA?.$) {
      const buffer = Buffer.from(p.FOTO_ENTREGA.$, 'base64');
      imagem = `data:image/jpeg;base64,${buffer.toString('base64')}`;
    }

    // 🔥 FOTO COMPROV (CLOB base64)
    if (p.TIPO_FOTO?.$ == 2 && p.FOTO_COMPROV?.$) {
      imagem = p.FOTO_COMPROV.$;
    }

    res.json({ imagem });

  } catch (err) {
    console.error(err);
    res.json({ imagem: null });
  }
});

// =========================
// START
// =========================
app.listen(PORT, () => {
  console.log(`🚀 Rodando na porta ${PORT}`);
});
