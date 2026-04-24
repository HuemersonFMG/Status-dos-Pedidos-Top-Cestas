const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 5050;

// =========================
// 🌐 LOG GLOBAL
// =========================
app.use((req, res, next) => {
  console.log(`🌐 ${req.method} ${req.url}`);
  next();
});

// =========================
// 🔐 AUTH API
// =========================
app.use('/api', (req, res, next) => {
  const token = req.headers.authorization;
  const cleanToken = token?.replace("Bearer ", "");

  if (cleanToken !== "d7e10ab7-a425-4e84-874b-ce5d2961fe2a") {
    console.log("❌ Token inválido:", token);
    return res.status(401).json({ erro: "Não autorizado" });
  }

  next();
});

// =========================
// 🔗 CONFIG SANKHYA
// =========================
const BASE_URL = "http://topcesta.fwc.cloud:8180";
const SERVICE_URL = `${BASE_URL}/mge/service.sbr`;

const USER = "HUEMERSON";
const PASS = "654321";

// =========================
// 🔐 LOGIN (RETORNA COOKIE)
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

  const res = await fetch(
    `${SERVICE_URL}?serviceName=MobileLoginSP.login&outputType=json`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }
  );

  const rawCookie = res.headers.get("set-cookie") || "";
  const cookie = rawCookie.split(";")[0];

  console.log("🍪 COOKIE GERADO:", cookie);

  return cookie;
}

// =========================
// HEALTH CHECK
// =========================
app.get('/api/health', (req, res) => {
  res.json({ status: "OK" });
});

// =========================
// 🚀 CONSULTA
// =========================
app.post('/api/notas', async (req, res) => {
  try {

    const cookie = await login();

    // 🔥 NOVO PADRÃO
    const { tipo, valor } = req.body;

    const filtro = (valor || "").trim();

    console.log("🔎 Filtro recebido:", tipo, filtro);

    // =========================
    // 🔐 VALIDAÇÃO
    // =========================
    if (!tipo || !filtro) {
      return res.status(400).json({ erro: "Filtro inválido" });
    }

    if (tipo === "cpf" && !/^\d{11,14}$/.test(filtro.replace(/\D/g, ''))) {
      return res.status(400).json({ erro: "CPF/CNPJ inválido" });
    }

    // =========================
    // 🔥 CHAMADA DA VIEW
    // =========================
    const payload = {
      serviceName: "CRUDServiceProvider.loadView",
      requestBody: {
        query: {
          viewName: "VW_NOTAS_FUSION"
        }
      }
    };

    console.log("📤 Chamando loadView...");

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

    console.log("📥 Resposta recebida");

    if (!response.ok || text.startsWith("<")) {
      throw new Error("Erro na comunicação com Sankhya");
    }

    const json = JSON.parse(text);

    if (json?.tsError) {
      console.log("❌ ERRO SANKHYA:", json.tsError);
      return res.json({ rows: [] });
    }

    let rows = [];

    const registros = json?.responseBody?.records?.record;

    if (registros) {

      const lista = Array.isArray(registros) ? registros : [registros];

      rows = lista
        .map(r => ({
          NUNOTA: r.NUNOTA?.$ || "",
          NUMNOTA: r.NUMNOTA?.$ || "",
          TOP: r.TOP?.$ || "",
          DTNEG: r.DTNEG?.$ || "",
          VLRNOTA: r.VLRNOTA?.$ || "",
          CODPARC: r.CODPARC?.$ || "",
          NOMEPARC: r.NOMEPARC?.$ || "",
          CGC_CPF: (r.CGC_CPF?.$ || "").replace(/\D/g, ""),
          ENTREGAR: r.ENTREGAR?.$ || "",
          RECEBIDO: r.RECEBIDO?.$ || "",
          ST_ENTREGAS: r.ST_ENTREGAS?.$ || ""
        }))
        .filter(r => {

          if (tipo === "cpf") {
            return r.CGC_CPF === filtro.replace(/\D/g, '');
          }

          if (tipo === "pedido") {
            return String(r.NUMNOTA) === filtro;
          }

          if (tipo === "nome") {
            return (r.NOMEPARC || "")
              .toLowerCase()
              .includes(filtro.toLowerCase());
          }

          return true;
        });
    }

    console.log(`📊 Registros encontrados: ${rows.length}`);

    res.json({ rows });

  } catch (err) {
    console.error("❌ Erro:", err);
    res.status(500).json({ erro: err.message });
  }
});

// =========================
// START
// =========================
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
});
