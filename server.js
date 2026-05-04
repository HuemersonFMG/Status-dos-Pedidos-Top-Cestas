// =========================
// 📎 SERVIR ARQUIVO (IMG / PDF)
// =========================
app.get('/api/arquivo', async (req, res) => {
  try {
    const { nunota, tipo } = req.query;

    if (!nunota || !tipo) {
      return res.status(400).send("Parâmetros inválidos");
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

    const text = await response.text();
    const json = JSON.parse(text);

    let lista = [];
    if (json?.responseBody?.records?.record) {
      const r = json.responseBody.records.record;
      lista = Array.isArray(r) ? r : [r];
    }

    const pedido = lista.find(r => r.NUNOTA?.$ == nunota);

    if (!pedido) {
      return res.status(404).send("Pedido não encontrado");
    }

    let base64;

    if (tipo == 1) {
      base64 = pedido.FOTO_ENTREGA?.$;
    }

    if (tipo == 2) {
      base64 = pedido.FOTO_COMPROV?.$;
    }

    if (!base64) {
      return res.status(404).send("Arquivo não encontrado");
    }

    const buffer = Buffer.from(base64, 'base64');

    // 🔥 DETECTAR TIPO REAL
    const inicio = buffer.slice(0, 4).toString('hex');

    // PDF começa com: 25504446 (%PDF)
    if (inicio.startsWith('25504446')) {
      res.setHeader("Content-Type", "application/pdf");
    } else {
      res.setHeader("Content-Type", "image/jpeg");
    }

    res.send(buffer);

  } catch (err) {
    console.error("❌ ERRO /arquivo:", err);
    res.status(500).send("Erro ao carregar arquivo");
  }
});
