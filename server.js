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

// =========================
// 🔗 SANKHYA
// =========================
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

  if (!cookie) {
    console.error("❌ Falha ao obter cookie:", rawCookie);
    throw new Error("Falha ao autenticar no Sankhya");
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
// 🔍 GERAR LINKS
// =========================
app.post('/api/gerar-links', async (req, res) => {
  try {
    const { cnpj, data } = req.body;

    const documento = (cnpj || "").replace(/\D/g, '');

    if (!documento) {
      return res.status(400).json({ erro: "CPF/CNPJ obrigatório" });
    }

    const cookie = await login();

    const payload = {
      serviceName: "CRUDServiceProvider.loadView",
      requestBody: {
        query: { viewName: "VW_NOTAS_FUSION_LIGHT" }
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
      console.error("❌ Sankhya retornou inválido:", text.substring(0, 200));
      throw new Error("Erro Sankhya");
    }

    const json = JSON.parse(text);

    if (json?.tsError) {
      console.error("❌ Erro Sankhya:", json.tsError);
      return res.json({ total: 0, links: [] });
    }

    let lista = [];
    const registros = json?.responseBody?.records?.record;

    if (registros) {
      lista = Array.isArray(registros) ? registros : [registros];
    }

    const filtrados = lista
      .map(r => ({
        NUNOTA: r.NUNOTA?.$,
        CGC_CPF: (r.CGC_CPF?.$ || "").replace(/\D/g, ''),
        DTNEG: r.DTNEG?.$
      }))
      .filter(r => {
        if (r.CGC_CPF !== documento) return false;
        if (data) return new Date(r.DTNEG) >= new Date(data);
        return true;
      });

    const baseUrl = `${req.protocol}://${req.get('host')}`;

    const links = filtrados.map(r => ({
      nunota: r.NUNOTA,
      link: `${baseUrl}/index.html?nunota=${r.NUNOTA}&token=${gerarToken(r.NUNOTA)}`
    }));

    console.log("📊 Links gerados:", links.length);

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
        query: { viewName: "VW_NOTAS_FUSION" }
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
      console.error("❌ Sankhya inválido:", text.substring(0, 200));
      throw new Error("Erro Sankhya");
    }

    const json = JSON.parse(text);

    if (json?.tsError) {
      console.error("❌ Erro Sankhya:", json.tsError);
      return res.json({ rows: [] });
    }

    let lista = [];
    const registros = json?.responseBody?.records?.record;

    if (registros) {
      lista = Array.isArray(registros) ? registros : [registros];
    }

    const pedido = lista.find(r => r.NUNOTA?.$ == nunota);

    if (!pedido) {
      return res.json({ rows: [] });
    }

    // =========================
    // 🔥 DETECÇÃO DE ARQUIVO
    // =========================
    let tipoFoto = 0;
    let tipoArquivo = null;

    if (pedido.FOTO) {
      tipoFoto = 1;
      tipoArquivo = "imagem";
    }
    else if (pedido.AD_COMPROVTRANSP) {
      tipoFoto = 2;

      // tentativa simples de detectar PDF
      if (String(pedido.AD_COMPROVTRANSP).includes("JVBER")) {
        tipoArquivo = "pdf";
      } else {
        tipoArquivo = "imagem";
      }
    }

    res.json({
      rows: [{
        NUNOTA: pedido.NUNOTA?.$,
        NUMNOTA: pedido.NUMNOTA?.$,
        NOMEPARC: pedido.NOMEPARC?.$,
        CGC_CPF: pedido.CGC_CPF?.$,
        ST_ENTREGAS: pedido.ST_ENTREGAS?.$,

        TIPO_FOTO: tipoFoto,
        TIPO_ARQUIVO: tipoArquivo,
        STATUS_FOTO: tipoFoto ? "Disponível" : "Sem arquivo"
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
