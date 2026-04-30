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

  if (!cookie) throw new Error("Erro ao logar no Sankhya");

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
// 📎 PROXY DE ARQUIVO (PDF)
// =========================
app.get('/api/arquivo', async (req, res) => {
  try {

    const { url } = req.query;

    if (!url) {
      return res.status(400).send("URL não informada");
    }

    console.log("📎 Baixando arquivo externo:", url);

    const response = await fetch(url);

    if (!response.ok) {
      return res.status(500).send("Erro ao buscar arquivo");
    }

    const contentType = response.headers.get("content-type") || "application/octet-stream";

    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", "inline");

    response.body.pipe(res);

  } catch (err) {
    console.error("❌ ERRO /api/arquivo:", err);
    res.status(500).send("Erro ao carregar arquivo");
  }
});

// =========================
// 🔍 GERAR LINKS
// =========================
app.post('/api/gerar-links', async (req, res) => {
  try {

    const { cnpj, ordemCarga, data } = req.body;

    const cookie = await login();

    const payload = {
      serviceName: "CRUDServiceProvider.loadView",
      requestBody: {
        query: { viewName: "VW_NOTAS_FUSION_LIGHT" }
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
    const r = json?.responseBody?.records?.record;
    lista = Array.isArray(r) ? r : [r];

    const filtrados = lista.filter(item => {

      const doc = (item.CGC_CPF?.$ || "").replace(/\D/g, '');
      const ordem = String(item.ORDEMCARGA?.$ || "");

      if (cnpj && doc !== cnpj) return false;
      if (ordemCarga && ordem !== ordemCarga) return false;

      if (data) {
        return new Date(item.DTNEG?.$) >= new Date(data);
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

    const json = await response.json();

    let lista = [];
    const r = json?.responseBody?.records?.record;
    lista = Array.isArray(r) ? r : [r];

    const pedido = lista.find(p => p.NUNOTA?.$ == nunota);

    if (!pedido) {
      return res.json({ rows: [] });
    }

    // =========================
    // 📎 TRATAR COMPROVANTE (CLOB)
    // =========================
    const comprovante = pedido.AD_COMPROVTRANSP?.$ || null;

    let tipoArquivo = null;
    let urlArquivo = null;

    if (comprovante) {

      console.log("📄 Conteúdo comprovante:", comprovante.substring(0, 80));

      // 🔥 URL direta
      if (comprovante.startsWith("http")) {
        tipoArquivo = "pdf";
        urlArquivo = `/api/arquivo?url=${encodeURIComponent(comprovante)}`;
      }

      // 🔥 Base64 PDF
      else if (comprovante.startsWith("JVBER")) {
        tipoArquivo = "pdf";
        urlArquivo = `data:application/pdf;base64,${comprovante}`;
      }

      // 🔥 JSON com URL
      else if (comprovante.startsWith("{")) {
        try {
          const obj = JSON.parse(comprovante);
          if (obj.url) {
            tipoArquivo = "pdf";
            urlArquivo = `/api/arquivo?url=${encodeURIComponent(obj.url)}`;
          }
        } catch {}
      }
    }

    // =========================
    // 🖼️ IMAGEM (mantida)
    // =========================
    const temFoto = pedido.FOTO_ENTREGA;

    res.json({
      rows: [{
        NUNOTA: pedido.NUNOTA?.$,
        NOMEPARC: pedido.NOMEPARC?.$,
        CGC_CPF: pedido.CGC_CPF?.$,
        ST_ENTREGAS: pedido.ST_ENTREGAS?.$,

        // imagem continua funcionando
        TIPO_FOTO: temFoto ? 1 : 0,

        // novo padrão
        TIPO_ARQUIVO: tipoArquivo,
        URL_ARQUIVO: urlArquivo,

        STATUS_FOTO: tipoArquivo
          ? "Comprovante disponível"
          : temFoto
          ? "Foto disponível"
          : "Sem comprovante"
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
