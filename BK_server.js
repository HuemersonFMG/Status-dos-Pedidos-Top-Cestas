const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const PORT = 5050;

// =========================
// 🌐 LOG GLOBAL
// =========================
app.use((req, res, next) => {
  console.log(`🌐 ${req.method} ${req.url}`);
  next();
});

// =========================
// 🔗 URL SANKHYA
// =========================
const SERVICE_URL = "http://topcesta.fwc.cloud:8180/mge/service.sbr";

// =========================
// 🔐 USUÁRIO
// =========================
const USER = "HUEMERSON";
const PASS = "654321";

// =========================
// 🍪 COOKIE
// =========================
let cookie = "";

// =========================
// 🔐 LOGIN
// =========================
async function login() {
  console.log("🔐 Fazendo login no Sankhya...");

  const payload = {
    serviceName: "MobileLoginSP.login",
    requestBody: {
      NOMUSU: { $: USER },
      INTERNO: { $: PASS }
    }
  };

  const res = await fetch(`${SERVICE_URL}?serviceName=MobileLoginSP.login&outputType=json`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const rawCookie = res.headers.get("set-cookie") || "";
  cookie = rawCookie.split(";")[0];

  console.log("✅ Login realizado");
}

// =========================
// 🩺 HEALTH CHECK
// =========================
app.get('/api/health', (req, res) => {
  res.json({ status: "OK" });
});

// =========================
// 🔍 CONSULTA COM FILTRO
// =========================
app.post('/api/notas', async (req, res) => {
  try {

    if (!cookie) {
      await login();
    }

    // =========================
    // 📥 RECEBE CPF/CNPJ
    // =========================
    const { cpf } = req.body;

    const documento = (cpf || "").replace(/\D/g, '');

    console.log("🔎 Documento recebido:", documento);

    if (!documento) {
      return res.status(400).json({
        erro: true,
        message: "CPF/CNPJ não informado"
      });
    }

    // 🔐 valida se é só número
    if (!/^\d+$/.test(documento)) {
      return res.status(400).json({
        erro: true,
        message: "Documento inválido"
      });
    }

    // =========================
    // 📤 PAYLOAD SANKHYA
    // =========================
    const payload = {
      serviceName: "CRUDServiceProvider.loadView",
      requestBody: {
        query: {
          viewName: "VW_NOTAS_FUSION",
          fields: {
            field: {
              $: "*"
            }
          },
          where: {
            $: `CGC_CPF = '${documento}'`
          }
        }
      }
    };

    console.log("📤 Consultando Sankhya com filtro...");

    const response = await fetch(`${SERVICE_URL}?serviceName=CRUDServiceProvider.loadView&outputType=json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cookie": cookie
      },
      body: JSON.stringify(payload)
    });

    const text = await response.text();

    console.log("📥 Retorno bruto:");
    console.log(text);

    // =========================
    // ❌ ERRO HTML (sessão expirada, etc)
    // =========================
    if (!response.ok || text.trim().startsWith("<")) {
      throw new Error(`Resposta inválida do Sankhya (status ${response.status})`);
    }

    const json = JSON.parse(text);

    console.log("📦 JSON parseado:");
    console.log(JSON.stringify(json, null, 2));

    // =========================
    // ❌ ERRO DO SANKHYA
    // =========================
    if (json.status === "0") {
      throw new Error(json.statusMessage || "Erro retornado pelo Sankhya");
    }

    // =========================
    // 🔄 NORMALIZA RETORNO
    // =========================
    let rows = [];

    if (json?.responseBody?.rows) {
      rows = json.responseBody.rows;
    }
    else if (json?.responseBody?.data) {
      rows = json.responseBody.data;
    }
    else if (Array.isArray(json)) {
      rows = json;
    }
    else if (json?.responseBody) {
      rows = Object.values(json.responseBody);
    }

    console.log(`📊 Registros encontrados: ${rows.length}`);

    // =========================
    // 📤 RESPOSTA FINAL
    // =========================
    res.json({
      rows: rows
    });

  } catch (err) {

    console.error("❌ Erro na API:", err.message);

    res.status(500).json({
      erro: true,
      message: err.message
    });
  }
});

// =========================
// 🚀 START SERVIDOR
// =========================
app.listen(PORT, async () => {
  console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
  await login();
});
