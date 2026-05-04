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

  if (!cookie) {
    throw new Error("Erro ao autenticar no Sankhya");
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

//===========================
//FORMAT DATA
//===========================
function formatarDataBR(data) {
  if (!data) return null;

  try {
    const d = new Date(data);
    return d.toLocaleDateString('pt-BR');
  } catch {
    return data;
  }
}

// =========================
// 📦 DEFINIR ARQUIVO
// =========================
function montarArquivo(nunota, registro) {

  const temFoto =
    registro.FOTO_ENTREGA &&
    registro.FOTO_ENTREGA.$ &&
    registro.FOTO_ENTREGA.$ !== "";

  const temComprov =
    registro.FOTO_COMPROV &&
    registro.FOTO_COMPROV.$ &&
    registro.FOTO_COMPROV.$ !== "";

  // 🔥 PRIORIDADE: FOTO APP
  if (temFoto) {
    return {
      url: `${BASE_URL}/mge/AD_APPENTFOTO@FOTO@NUNOTA=${nunota}@SEQ=1.dbimage`,
      tipo: "img"
    };
  }

  // 🔥 FALLBACK: PDF
  if (temComprov) {
    return {
      url: `${BASE_URL}/mge/TGFCAB@AD_COMPROVTRANSP@NUNOTA=${nunota}.dbimage`,
      tipo: "pdf"
    };
  }

  return null;
}

// =========================
// 🔍 GERAR LINKS
// =========================
app.post('/api/gerar-links', async (req, res) => {
  try {

    const { cnpj, ordemCarga, data } = req.body;

    const documento = (cnpj || "").replace(/\D/g, '');
    const ordem = ordemCarga ? String(ordemCarga) : null;

    // 🔥 validação exclusiva
    if ((!documento && !ordem) || (documento && ordem)) {
      return res.status(400).json({
        erro: "Informe CPF/CNPJ OU Ordem de Carga (apenas um)"
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
    const rec = json?.responseBody?.records?.record;

    if (rec) {
      lista = Array.isArray(rec) ? rec : [rec];
    }

    // 🔥 FILTRO CORRETO
    const filtrados = lista.filter(r => {

      const doc = (r.CGC_CPF?.$ || "").replace(/\D/g, '');
      const oc = r.ORDEMCARGA?.$ ? String(r.ORDEMCARGA.$) : "";

      if (documento && doc !== documento) return false;
      if (ordem && oc !== ordem) return false;

      if (data) {
        return new Date(r.DTNEG?.$) >= new Date(data);
      }

      return true;
    });

    const baseUrl = `${req.protocol}://${req.get('host')}`;

    const links = filtrados.map(r => ({
      nunota: r.NUNOTA.$,
      link: `${baseUrl}/index.html?nunota=${r.NUNOTA.$}&token=${gerarToken(r.NUNOTA.$)}`
    }));

    res.json({ total: links.length, links });

  } catch (err) {
    console.error("❌ ERRO gerar-links:", err);
    res.status(500).json({ erro: err.message });
  }
});

// =========================
// 🔎 CONSULTA PEDIDO (CORRIGIDO)
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
    const rec = json?.responseBody?.records?.record;

    if (rec) {
      lista = Array.isArray(rec) ? rec : [rec];
    }

    // 🔥 BUSCA EXATA POR NUNOTA
    const pedido = lista.find(r => String(r.NUNOTA.$) === String(nunota));

    if (!pedido) {
      return res.json({ rows: [] });
    }

    // 🔥 ARQUIVO COM FALLBACK INTELIGENTE
    const arquivo = montarArquivo(nunota, pedido);

    res.json({
      rows: [{
        NUNOTA: pedido.NUNOTA?.$,
        NUMNOTA: pedido.NUMNOTA?.$,

        NOMEPARC: pedido.NOMEPARC?.$,
        CGC_CPF: pedido.CGC_CPF?.$,

        DTNEG: formatarDataBR(pedido.DTNEG?.$),
        ORDEMCARGA: pedido.ORDEMCARGA?.$,

        TRANSPORTADORA: (pedido.TRANSPORTADORA?.$ || "").trim(),

        ST_ENTREGAS: pedido.ST_ENTREGAS?.$,

        ARQUIVO: arquivo,

        STATUS_FOTO: arquivo
          ? (arquivo.tipo === "img"
              ? "Foto Entrega"
              : "Comprovante PDF")
          : "Sem comprovante"
      }]
    });

  } catch (err) {
    console.error("❌ ERRO pedido:", err);
    res.status(500).json({ erro: err.message });
  }
});

// =========================
// START
// =========================
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
