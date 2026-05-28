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

let pedidosGerados = [];
let linksGerados = [];

const cnpjInput = document.getElementById('cnpj');
const periodoPapInput = document.getElementById('periodoPap');
const statusDiv = document.getElementById('status');
const resultadoDiv = document.getElementById('resultado');

function limparDoc(valor) {
  return (valor || '').replace(/\D/g, '');
}

function limparDocs(valor) {
  return String(valor || '')
    .split(/[;,\n\r\t]+/)
    .map(v => v.replace(/\D/g, ''))
    .filter(Boolean);
}

function formatarListaDocs(docs) {
  return docs && docs.length ? docs.join(', ') : '-';
}

function extrairValor(valor) {
  if (valor && typeof valor === 'object' && '$' in valor) {
    return valor.$ || '';
  }

  return valor || '';
}

function getNunota(item) {
  return String(
    extrairValor(item?.nunota) ||
    extrairValor(item?.NUNOTA) ||
    ''
  );
}

function getNumNota(item) {
  return String(
    extrairValor(item?.numNota) ||
    extrairValor(item?.NUMNOTA) ||
    ''
  );
}

function getNomeCliente(item) {
  const nome =
    extrairValor(item?.nomeParc) ||
    extrairValor(item?.NOMEPARC) ||
    extrairValor(item?.nomeparc) ||
    extrairValor(item?.cliente) ||
    extrairValor(item?.CLIENTE) ||
    '';

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
  const nome =
    extrairValor(item?.nomeParc) ||
    extrairValor(item?.NOMEPARC) ||
    extrairValor(item?.nomeparc) ||
    extrairValor(item?.cliente) ||
    extrairValor(item?.CLIENTE) ||
    '';

  return String(nome).trim() || 'CLIENTE';
}

function getPeriodoPap(item) {
  return String(
    extrairValor(item?.periodoPap) ||
    extrairValor(item?.AD_PERIODO_PAP) ||
    extrairValor(item?.ad_periodo_pap) ||
    ''
  );
}

function getLink(item) {
  return (
    extrairValor(item?.link) ||
    extrairValor(item?.LINK) ||
    ''
  );
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

function montarResumoFiltroComercial() {
  const documentos = limparDocs(cnpjInput.value);
  const periodoPap = periodoPapInput.value.trim();

  return `CPF/CNPJ: ${formatarListaDocs(documentos)} | Período PAP: ${periodoPap || '-'}`;
}

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

function limparResultado() {
  resultadoDiv.innerHTML = '';
  pedidosGerados = [];
  linksGerados = [];
}

function limpar() {
  cnpjInput.value = '';
  periodoPapInput.value = '';
  limparResultado();
  setStatus('', '');
}

async function gerar() {
  limparResultado();

  const documentos = limparDocs(cnpjInput.value);
  const periodoPap = periodoPapInput.value.trim();

  if (!documentos.length && !periodoPap) {
    setStatus('erro', '❌ Informe o(s) CPF/CNPJ e o Período PAP');
    return;
  }

  if (!documentos.length) {
    setStatus('erro', '❌ Informe ao menos um CPF/CNPJ');
    return;
  }

  if (!periodoPap) {
    setStatus('erro', '❌ Informe o Período PAP');
    return;
  }

  const documentosInvalidos = documentos.filter(doc => doc.length !== 11 && doc.length !== 14);

  if (documentosInvalidos.length) {
    setStatus('erro', `❌ CPF/CNPJ inválido: ${documentosInvalidos.join(', ')}`);
    return;
  }

  setStatus('', '⏳ Buscando pedidos...');

  try {
    const payload = {
      cnpj: documentos.join(','),
      cnpjs: documentos,
      periodoPap: periodoPap
    };

    const dataRes = await fetchSeguro('/api/gerar-links-comercial', {
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

    resultadoDiv.innerHTML = `<div class="resultado-topo">Total encontrado: <strong>${dataRes.total || dataRes.links.length}</strong></div>`;

    dataRes.links.forEach(l => {
      const nunota = getNunota(l);
      const numNota = getNumNota(l);
      const nomeCliente = getNomeClienteExibicao(l);
      const periodo = getPeriodoPap(l);
      const link = getLink(l);

      const el = document.createElement('div');
      el.className = 'link-item';

      el.innerHTML = `<b>Pedido:</b> ${nunota}${numNota ? `<br><b>NF-e:</b> ${numNota}` : ''}<br><b>Cliente:</b> ${nomeCliente}${periodo ? `<br><b>Período PAP:</b> ${periodo}` : ''}<br><br><a href="${link}" target="_blank">${link}</a><div class="actions"><button onclick="copiar('${link}')">📋 Copiar</button><button onclick="abrir('${link}')">🔗 Abrir</button><button onclick="whatsapp('${link}')">📲 WhatsApp</button></div>`;

      resultadoDiv.appendChild(el);
    });

  } catch (err) {
    console.error('❌ ERRO:', err);

    if (err.message !== 'Sessão expirada') {
      setStatus('erro', `❌ ${err.message}`);
    }
  }
}

async function salvarListaLinks() {
  if (!linksGerados.length) {
    alert('⚠️ Nenhum link gerado para salvar.');
    return;
  }

  try {
    setStatus('', '💾 Salvando lista interna de links...');

    const payload = {
      tipo: 'GERADOR_COMERCIAL',
      filtroResumo: montarResumoFiltroComercial(),
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
      `✅ Lista comercial salva com ${json.total || linksGerados.length} link(s).\n\nDeseja abrir a página da lista agora?`
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

function salvarLista() {
  salvarListaLinks();
}

function salvarLinks() {
  salvarListaLinks();
}

async function copiar(link) {
  try {
    await navigator.clipboard.writeText(link);
    alert('✅ Link copiado');
  } catch (err) {
    console.error(err);
    alert('❌ Erro ao copiar');
  }
}

function abrir(link) {
  window.open(link, '_blank');
}

function whatsapp(link) {
  const texto = encodeURIComponent(`Acompanhe seu pedido:\n${link}`);
  window.open(`https://wa.me/?text=${texto}`, '_blank');
}

//-----------------------------------------------------
// BAIXAR TODOS COMPROVANTES ZIP
//-----------------------------------------------------
async function baixarTodos() {
  if (!linksGerados.length) {
    alert('⚠️ Nenhum pedido gerado');
    return;
  }

  const progressBox = document.getElementById('download-progress');
  const progressText = document.getElementById('download-progress-text');

  try {
    if (progressBox) {
      progressBox.style.display = 'block';
    }

    if (progressText) {
      progressText.innerHTML = '⏳ Preparando comprovantes...';
    }

    setStatus('', '⏳ Gerando arquivo ZIP dos comprovantes...');

    const pedidos = linksGerados
      .map(item => getNunota(item))
      .filter(Boolean);

    if (!pedidos.length) {
      setStatus('erro', '❌ Nenhum pedido válido.');
      if (progressBox) {
        progressBox.style.display = 'none';
      }
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
    a.download = `Comprovantes_Comercial_${new Date().toISOString().slice(0, 10)}.zip`;

    document.body.appendChild(a);
    a.click();
    a.remove();

    window.URL.revokeObjectURL(url);

    if (progressText) {
      progressText.innerHTML = '✅ ZIP gerado com sucesso.';
    }

    setStatus('ok', `✅ ZIP gerado com ${pedidos.length} comprovante(s).`);

    setTimeout(() => {
      if (progressBox) {
        progressBox.style.display = 'none';
      }
    }, 2500);

  } catch (err) {
    console.error(err);
    setStatus('erro', `❌ ${err.message}`);

    if (progressText) {
      progressText.innerHTML = `❌ ${err.message}`;
    }

    setTimeout(() => {
      if (progressBox) {
        progressBox.style.display = 'none';
      }
    }, 4000);
  }
}

//-----------------------------------------------
// ABRIR MANUALMENTE
//-----------------------------------------------
function abrirManual() {
  window.open('/docs/manual.html', '_blank');
}