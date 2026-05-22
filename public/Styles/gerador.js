// =========================
// 🔒 BLOQUEIOS
// =========================
document.addEventListener('keydown', function (e) {
  if (e.key === 'F12') {
    e.preventDefault();
    return false;
  }

  if (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'J')) {
    e.preventDefault();
    return false;
  }

  if (e.ctrlKey && e.key.toLowerCase() === 'u') {
    e.preventDefault();
    return false;
  }
});

// =========================
// 📦 VARIÁVEIS GLOBAIS
// =========================
let pedidosGerados = [];
let linksGerados = [];

// =========================
// 🔧 HELPERS
// =========================
function limparDoc(valor) {
  return (valor || '').replace(/\D/g, '');
}

function extrairValor(valor) {
  if (valor && typeof valor === 'object' && '$' in valor) {
    return valor.$ || '';
  }

  return valor || '';
}

function getNunota(item) {
  return String(extrairValor(item?.nunota) || extrairValor(item?.NUNOTA) || '');
}

function getNumNota(item) {
  return String(extrairValor(item?.numNota) || extrairValor(item?.NUMNOTA) || '');
}

function getNomeCliente(item) {
  const nome = extrairValor(item?.nomeParc) || extrairValor(item?.NOMEPARC) || extrairValor(item?.nomeparc) || extrairValor(item?.cliente) || extrairValor(item?.CLIENTE) || '';

  const nomeLimpo = String(nome)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .trim()
    .toUpperCase();

  return nomeLimpo || 'CLIENTE';
}

function getNomeClienteExibicao(item) {
  const nome = extrairValor(item?.nomeParc) || extrairValor(item?.NOMEPARC) || extrairValor(item?.nomeparc) || extrairValor(item?.cliente) || extrairValor(item?.CLIENTE) || '';

  return String(nome).trim() || 'CLIENTE';
}

function getLink(item) {
  return extrairValor(item?.link) || extrairValor(item?.LINK) || '';
}

function montarNomeArquivo(item, extensao) {
  const nunota = getNunota(item) || 'PEDIDO';
  const nomeCliente = getNomeCliente(item);

  return `Comprovante_${nunota}_${nomeCliente}.${extensao}`;
}

function getTokenFromLink(link) {
  try {
    const url = new URL(link, window.location.origin);
    return url.searchParams.get('token') || '';
  } catch {
    if (link && link.includes('token=')) {
      return link.split('token=')[1] || '';
    }

    return '';
  }
}

function setStatus(tipo, mensagem) {
  if (!statusDiv) {
    return;
  }

  statusDiv.className = tipo || '';
  statusDiv.innerHTML = mensagem || '';
}

function redirecionarLogin() {
  window.location.href = '/login.html';
}

function tratarSessaoExpirada(response) {
  if (response.status === 401) {
    alert('Sessão expirada. Faça login novamente.');
    redirecionarLogin();
    return true;
  }

  return false;
}

function montarResumoFiltro() {
  const documento = limparDoc(cnpjInput.value);
  const ordem = ordemInput.value.trim();
  const pedidos = pedidosInput.value.trim();
  const nfes = nfesInput ? nfesInput.value.trim() : '';
  const data = dataInput.value;

  if (documento) {
    return `CPF/CNPJ: ${documento}`;
  }

  if (ordem) {
    return `Ordem de Carga: ${ordem}`;
  }

  if (pedidos) {
    return `Pedidos: ${pedidos}`;
  }

  if (nfes) {
    return `NF-e: ${nfes}`;
  }

  if (data) {
    return `Data: ${data}`;
  }

  return 'Filtro não identificado';
}

// =========================
// 🎯 ELEMENTOS
// =========================
const cnpjInput = document.getElementById('cnpj');
const ordemInput = document.getElementById('ordem') || document.getElementById('ordemCarga');
const pedidosInput = document.getElementById('pedidos');
const nfesInput = document.getElementById('nfes');
const dataInput = document.getElementById('data');
const statusDiv = document.getElementById('status');
const resultadoDiv = document.getElementById('resultado');

// =========================
// 🔁 CONTROLE FILTROS
// =========================
function atualizarFiltros() {
  const temCnpj = !!cnpjInput.value.trim();
  const temOrdem = !!ordemInput.value.trim();
  const temPedidos = !!pedidosInput.value.trim();
  const temNfes = nfesInput ? !!nfesInput.value.trim() : false;
  const temData = !!dataInput.value;

  cnpjInput.disabled = temOrdem || temPedidos || temNfes || temData;
  ordemInput.disabled = temCnpj || temPedidos || temNfes || temData;
  pedidosInput.disabled = temCnpj || temOrdem || temNfes || temData;

  if (nfesInput) {
    nfesInput.disabled = temCnpj || temOrdem || temPedidos || temData;
  }

  dataInput.disabled = temCnpj || temOrdem || temPedidos || temNfes;
}

// =========================
// 🎧 EVENTOS
// =========================
cnpjInput.addEventListener('input', atualizarFiltros);
ordemInput.addEventListener('input', atualizarFiltros);
pedidosInput.addEventListener('input', atualizarFiltros);
dataInput.addEventListener('input', atualizarFiltros);

if (nfesInput) {
  nfesInput.addEventListener('input', atualizarFiltros);
}

// =========================
// 🛡️ FETCH SEGURO
// =========================
async function fetchSeguro(url, options = {}) {
  try {
    const res = await fetch(url, {
      credentials: 'same-origin',
      cache: 'no-store',
      ...options
    });

    if (tratarSessaoExpirada(res)) {
      throw new Error('Sessão expirada');
    }

    const text = await res.text();

    if (!text) {
      throw new Error('Resposta vazia do servidor');
    }

    let data;

    try {
      data = JSON.parse(text);
    } catch {
      console.error('❌ JSON inválido:', text);
      throw new Error('Erro ao processar resposta');
    }

    if (!res.ok) {
      throw new Error(data.erro || 'Erro na requisição');
    }

    return data;

  } catch (err) {
    console.error('❌ FETCH:', err);
    throw err;
  }
}

// =========================
// 🧹 LIMPAR RESULTADO
// =========================
function limparResultado() {
  resultadoDiv.innerHTML = '';
  pedidosGerados = [];
  linksGerados = [];
}

// =========================
// 🧹 LIMPAR TELA
// =========================
function limpar() {
  cnpjInput.value = '';
  ordemInput.value = '';
  pedidosInput.value = '';

  if (nfesInput) {
    nfesInput.value = '';
  }

  dataInput.value = '';

  limparResultado();

  cnpjInput.disabled = false;
  ordemInput.disabled = false;
  pedidosInput.disabled = false;
  dataInput.disabled = false;

  if (nfesInput) {
    nfesInput.disabled = false;
  }

  setStatus('', '');
}

// =========================
// 🔍 GERAR LINKS
// =========================
async function gerar() {
  limparResultado();

  const documento = limparDoc(cnpjInput.value);
  const ordem = ordemInput.value.trim();
  const pedidos = pedidosInput.value.trim();
  const nfes = nfesInput ? nfesInput.value.trim() : '';
  const data = dataInput.value;

  const filtros = [
    documento,
    ordem,
    pedidos,
    nfes,
    data
  ].filter(Boolean);

  if (!filtros.length) {
    setStatus('erro', '❌ Informe um filtro');
    return;
  }

  if (filtros.length > 1) {
    setStatus('erro', '❌ Utilize apenas um filtro');
    return;
  }

  if (documento && documento.length !== 11 && documento.length !== 14) {
    setStatus('erro', '❌ CPF/CNPJ inválido');
    return;
  }

  setStatus('', '⏳ Buscando pedidos...');

  try {
    const payload = {
      cnpj: documento || null,
      ordemCarga: ordem || null,
      pedidos: pedidos || null,
      nfes: nfes || null,
      data: data || null
    };

    const dataRes = await fetchSeguro('/api/gerar-links', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!dataRes.links || !dataRes.links.length) {
      setStatus('warn', '⚠️ Nenhum pedido encontrado');
      return;
    }

    pedidosGerados = dataRes.links.map(l => getNunota(l)).filter(Boolean);
    linksGerados = dataRes.links;

    setStatus('ok', `✅ ${dataRes.total || dataRes.links.length} pedido(s) encontrado(s)`);

    dataRes.links.forEach(l => {
      const nunota = getNunota(l);
      const numNota = getNumNota(l);
      const nomeCliente = getNomeClienteExibicao(l);
      const link = getLink(l);

      const el = document.createElement('div');
      el.className = 'link-box';

      el.innerHTML = `
        <b>Pedido:</b>
        ${nunota}

        ${numNota
          ? `
            <br>
            <b>NF-e:</b>
            ${numNota}
          `
          : ''
        }

        <br>
        <b>Cliente:</b>
        ${nomeCliente}

        <br><br>

        <a href="${link}" target="_blank">
          ${link}
        </a>

        <div class="actions">
          <button onclick="copiar('${link}')">📋 Copiar</button>
          <button onclick="abrir('${link}')">🔗 Abrir</button>
          <button onclick="whatsapp('${link}')">📲 WhatsApp</button>
        </div>
      `;

      resultadoDiv.appendChild(el);
    });

  } catch (err) {
    if (err.message !== 'Sessão expirada') {
      console.error('❌ ERRO:', err);
      setStatus('erro', `❌ ${err.message}`);
    }
  }
}

// =========================
// 💾 SALVAR LISTA INTERNA
// =========================
async function salvarListaLinks() {
  if (!linksGerados.length) {
    alert('⚠️ Nenhum link gerado para salvar.');
    return;
  }

  try {
    setStatus('', '💾 Salvando lista interna de links...');

    const payload = {
      tipo: 'GERADOR',
      filtroResumo: montarResumoFiltro(),
      links: linksGerados
    };

    const json = await fetchSeguro('/api/salvar-lista-links', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!json.url) {
      throw new Error('Lista salva, mas URL não retornada.');
    }

    const abrirAgora = confirm(
      `✅ Lista salva com ${json.total || linksGerados.length} link(s).\n\nDeseja abrir a página da lista agora?`
    );

    try {
      await navigator.clipboard.writeText(json.url);
      setStatus('ok', `✅ Lista salva. URL copiada: <a href="${json.url}" target="_blank">${json.url}</a>`);
    } catch {
      setStatus('ok', `✅ Lista salva: <a href="${json.url}" target="_blank">${json.url}</a>`);
    }

    if (abrirAgora) {
      window.open(json.url, '_blank');
    }

  } catch (err) {
    console.error('❌ ERRO SALVAR LISTA:', err);
    setStatus('erro', `❌ ${err.message}`);
  }
}

// compatibilidade com nomes alternativos de botão
function salvarLista() {
  salvarListaLinks();
}

function salvarLinks() {
  salvarListaLinks();
}

// =========================
// 📋 COPIAR
// =========================
async function copiar(link) {
  try {
    await navigator.clipboard.writeText(link);
    alert('✅ Link copiado');
  } catch (err) {
    console.error(err);
    alert('❌ Erro ao copiar');
  }
}

// =========================
// 🔗 ABRIR
// =========================
function abrir(link) {
  window.open(link, '_blank');
}

// =========================
// 🔗 ABRIR GERADOR COMERCIAL
// =========================
async function abrirGeradorComercial() {
  try {
    const response = await fetch('/api/gerador-comercial-ticket', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store'
    });

    if (response.status === 401) {
      alert('Sessão expirada. Faça login novamente.');
      window.location.href = '/login.html';
      return;
    }

    let json = {};

    try {
      json = await response.json();
    } catch {
      json = {};
    }

    if (!response.ok || !json.url) {
      throw new Error(json.erro || 'Erro ao abrir Gerador Comercial.');
    }

    window.open(json.url, '_blank');

  } catch (err) {
    console.error('❌ ERRO GERADOR COMERCIAL:', err);
    alert('❌ Erro ao abrir Gerador Comercial.');
  }
}

function abrirgeradorcomercial() {
  abrirGeradorComercial();
}

// =========================
// 🔗 ABRIR MANUAL DO USUARIO
// =========================
function abrirManual() {
  window.open('/docs/manual.html', '_blank');
}

// =========================
// 🔄 SAIR / RECARREGAR LOGIN
// =========================
async function recarga() {
  const confirmar = confirm('Deseja encerrar a sessão atual e voltar para o login?');

  if (!confirmar) {
    return;
  }

  try {
    const response = await fetch('/api/admin-logout', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store'
    });

    if (!response.ok) {
      throw new Error('Erro ao encerrar sessão.');
    }

    window.location.href = '/login.html';

  } catch (err) {
    console.error('❌ ERRO RECARGA:', err);
    alert('Erro ao recarregar login. Você será redirecionado para a tela de login.');
    window.location.href = '/login.html';
  }
}

// =========================
// 📲 WHATSAPP
// =========================
function whatsapp(link) {
  const texto = encodeURIComponent(`Acompanhe seu pedido:\n${link}`);
  window.open(`https://wa.me/?text=${texto}`, '_blank');
}

// =========================
// ⬇️ BAIXAR TODOS
// =========================
async function baixarTodos() {
  if (!linksGerados.length) {
    alert('⚠️ Nenhum pedido gerado');
    return;
  }

  const progressBox = document.getElementById('download-progress');
  const progressText = document.getElementById('download-progress-text');

  try {
    if (progressBox) progressBox.style.display = 'block';
    if (progressText) progressText.innerHTML = '⏳ Preparando comprovantes...';

    setStatus('', '⏳ Gerando arquivo ZIP dos comprovantes...');

    const pedidos = linksGerados
      .map(item => getNunota(item))
      .filter(Boolean);

    if (!pedidos.length) {
      setStatus('erro', '❌ Nenhum pedido válido para download.');
      if (progressBox) progressBox.style.display = 'none';
      return;
    }

    if (progressText) {
      progressText.innerHTML = `📦 Buscando ${pedidos.length} comprovante(s)...`;
    }

    const response = await fetch('/api/baixar-comprovantes', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        pedidos
      })
    });

    if (response.status === 401) {
      alert('Sessão expirada. Faça login novamente.');
      window.location.href = '/login.html';
      return;
    }

    if (!response.ok) {
      const erro = await response.text();
      console.error('Erro ZIP:', erro);
      throw new Error('Erro ao gerar ZIP dos comprovantes.');
    }

    if (progressText) {
      progressText.innerHTML = '⬇️ Baixando arquivo ZIP...';
    }

    const blob = await response.blob();

    if (!blob || blob.size === 0) {
      throw new Error('ZIP vazio.');
    }

    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');

    a.href = url;
    a.download = `Comprovantes_${new Date().toISOString().slice(0, 10)}.zip`;

    document.body.appendChild(a);
    a.click();
    a.remove();

    window.URL.revokeObjectURL(url);

    if (progressText) {
      progressText.innerHTML = '✅ ZIP gerado com sucesso.';
    }

    setStatus('ok', `✅ ZIP gerado com ${pedidos.length} pedido(s).`);

    setTimeout(() => {
      if (progressBox) progressBox.style.display = 'none';
    }, 2500);

  } catch (err) {
    console.error(err);
    setStatus('erro', `❌ ${err.message}`);

    if (progressText) {
      progressText.innerHTML = `❌ ${err.message}`;
    }

    setTimeout(() => {
      if (progressBox) progressBox.style.display = 'none';
    }, 4000);
  }
}

// =========================
// 🚀 START
// =========================
atualizarFiltros();