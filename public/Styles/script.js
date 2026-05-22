// =========================
// 🔒 BLOQUEIOS
// =========================
document.addEventListener('keydown', function(e) {
  if (
    e.key === 'F12' ||
    (e.ctrlKey && e.shiftKey && e.key === 'I') ||
    (e.ctrlKey && e.shiftKey && e.key === 'J') ||
    (e.ctrlKey && e.key === 'U')
  ) {
    e.preventDefault();
    return false;
  }

  if (e.key === 'Escape') {
    fechar();
  }
});

// =========================
// 🔗 PARAMS
// =========================
function getParam(nome) {
  return new URLSearchParams(window.location.search).get(nome);
}

// =========================
// 📦 STATUS
// =========================
function normalizarStatus(status) {
  return String(status || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

function traduzirStatus(status) {
  const st = normalizarStatus(status);

  const mapa = {
    "AGUARDANDO ROTA": "🧺 Sua cesta foi produzida e aguarda transporte.",
    "ENTREGANDO": "🚚 Sua Cesta foi entregue a Transportadora.",
    "NOTA EMITIDA": "🧾 Sua Nota Fiscal foi emitida e o pedido está pronto para entrega.",
    "ENTREGUE": "✅ Pedido entregue com sucesso."
  };

  return mapa[st] || status || "-";
}

function classeStatus(status) {
  const st = normalizarStatus(status);

  const mapa = {
    "AGUARDANDO ROTA": "warn",
    "NOTA EMITIDA": "nota-emitida",
    "ENTREGANDO": "ok",
    "ENTREGUE": "ok"
  };

  return mapa[st] || "";
}

// =========================
// 🛡️ FETCH
// =========================
async function fetchSeguro(url) {
  const res = await fetch(url);
  const text = await res.text();

  if (!text) {
    throw new Error("Resposta vazia do servidor");
  }

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    console.error("Resposta inválida:", text);
    throw new Error("Erro ao processar resposta");
  }

  if (!res.ok) {
    throw new Error(data.erro || "Erro na requisição");
  }

  return data;
}

// =========================
// 📅 DATA
// =========================
function formatarData(data) {
  if (!data) return "-";

  try {
    return new Date(data).toLocaleDateString('pt-BR');
  } catch {
    return data;
  }
}

// =========================
// 🎮 CONTROLE IMAGEM
// =========================
let zoom = 1;
let rotate = 0;

// =========================
// 🔄 ATUALIZAR TRANSFORM
// =========================
function atualizarImagem() {
  const img = document.getElementById('imgComprovante');

  if (!img) return;

  img.style.setProperty('--zoom', zoom);
  img.style.setProperty('--rotate', `${rotate}deg`);
}

// =========================
// 🔍 ZOOM +
// =========================
function zoomMais() {
  zoom += 0.2;
  atualizarImagem();
}

// =========================
// 🔍 ZOOM -
// =========================
function zoomMenos() {
  zoom -= 0.2;

  if (zoom < 0.2) {
    zoom = 0.2;
  }

  atualizarImagem();
}

// =========================
// 🔄 GIRAR
// =========================
function girar() {
  rotate += 90;
  atualizarImagem();
}

// =========================
// ♻ RESET
// =========================
function resetarImagem() {
  zoom = 1;
  rotate = 0;
  atualizarImagem();
}

// =========================
// 📷 IMAGEM
// =========================
function abrirImagem(nunota, token) {
  resetarImagem();

  const url = `/api/comprovante/imagem?nunota=${nunota}&token=${token}`;

  document.getElementById('viewer').innerHTML = `
    <img
      id="imgComprovante"
      src="${url}"
      onerror="
        this.src='';
        this.alt='Erro ao carregar imagem';
      "
    >
  `;

  document.getElementById('controls').innerHTML = `
    <button onclick="zoomMais()">➕ Zoom</button>
    <button onclick="zoomMenos()">➖ Zoom</button>
    <button onclick="girar()">🔄 Girar</button>
    <button onclick="resetarImagem()">♻ Reset</button>
    <button onclick="window.open('${url}','_blank')">🔗 Abrir</button>
    <button onclick="baixar('${url}')">⬇️ Download</button>
  `;

  document.getElementById('popup').style.display = "flex";

  atualizarImagem();
}

// =========================
// 📄 PDF
// =========================
function abrirPDF(nunota, token) {
  const url = `/api/comprovante/pdf?nunota=${nunota}&token=${token}`;

  document.getElementById('viewer').innerHTML = `
    <iframe src="${url}"></iframe>
  `;

  document.getElementById('controls').innerHTML = `
    <button onclick="window.open('${url}','_blank')">🔗 Abrir PDF</button>
    <button onclick="baixar('${url}')">⬇️ Download</button>
  `;

  document.getElementById('popup').style.display = "flex";
}

// =========================
// ⬇ DOWNLOAD
// =========================
function baixar(url) {
  const a = document.createElement('a');

  a.href = url;
  a.download = "";

  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// =========================
// ❌ FECHAR
// =========================
function fechar() {
  document.getElementById('popup').style.display = "none";
  document.getElementById('viewer').innerHTML = "";
  document.getElementById('controls').innerHTML = "";

  resetarImagem();
}

// =========================
// 🚀 CARREGAR
// =========================
async function carregar() {
  const nunota = getParam('nunota');
  const token = getParam('token');
  const div = document.getElementById('conteudo');

  if (!nunota || !token) {
    div.innerHTML = "<p class='erro'>❌ Link inválido</p>";
    return;
  }

  div.innerHTML = "⏳ Carregando pedido...";

  try {
    const data = await fetchSeguro(
      `/api/pedido?nunota=${nunota}&token=${token}`
    );

    if (!data.rows || !data.rows.length) {
      div.innerHTML = "<p class='warn'>⚠️ Pedido não encontrado</p>";
      return;
    }

    const p = data.rows[0];
    const statusEntrega = p.ST_ENTREGAS || p.st_entregas || "";
    const statusClasse = classeStatus(statusEntrega);

    div.innerHTML = `
      <div class="card">

        <p>
          <b>📅 Data:</b>
          ${formatarData(p.DTNEG)}
        </p>

        <p>
          <b>🚚 Ordem de Carga:</b>
          ${p.ORDEMCARGA || "-"}
        </p>

        <hr>

        <p>
          <b>🧾 Pedido:</b>
          ${p.NUNOTA}
        </p>

        <p>
          <b>👤 Cliente:</b>
          ${p.NOMEPARC}
        </p>

        <p>
          <b>📄 Documento:</b>
          ${p.CGC_CPF || "-"}
        </p>

        <p>
          <b>🚛 Transportadora:</b>
          ${p.TRANSPORTADORA || "-"}
        </p>

        <hr>

        <p class="status ${statusClasse}">
          ${traduzirStatus(statusEntrega)}
        </p>

        <hr>

        ${
          p.TEM_FOTO
            ? `
              <p
                style="
                  color:blue;
                  cursor:pointer;
                  font-weight:bold;
                "
                onclick="
                  abrirImagem(
                    '${p.NUNOTA}',
                    '${token}'
                  )
                "
              >
                📷 Visualizar Foto
              </p>
            `
            : ''
        }

        ${
          p.TEM_PDF
            ? `
              <p
                style="
                  color:blue;
                  cursor:pointer;
                  font-weight:bold;
                "
                onclick="
                  abrirPDF(
                    '${p.NUNOTA}',
                    '${token}'
                  )
                "
              >
                📄 Visualizar PDF
              </p>
            `
            : ''
        }

        ${
          !p.TEM_FOTO && !p.TEM_PDF
            ? `
              <p>
                📷 Sem comprovante disponível
              </p>
            `
            : ''
        }

      </div>
    `;

  } catch (err) {
    console.error("Erro:", err);

    div.innerHTML = `
      <p class="erro">
        ❌ ${err.message}
      </p>
    `;
  }
}

// START
carregar();