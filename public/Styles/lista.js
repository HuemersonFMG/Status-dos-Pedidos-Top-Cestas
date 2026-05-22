let listaAtual = null;
let linksGerados = [];

function getIdLista() {
  const params = new URLSearchParams(window.location.search);
  return params.get('id') || '';
}

function getNunota(item) {
  return String(item?.nunota || item?.NUNOTA || '');
}

function getNumNota(item) {
  return String(item?.numNota || item?.NUMNOTA || '');
}

function getNomeCliente(item) {
  return String(item?.nomeParc || item?.NOMEPARC || 'CLIENTE');
}

function getPeriodoPap(item) {
  return String(item?.periodoPap || item?.AD_PERIODO_PAP || '');
}

function getLink(item) {
  return String(item?.link || item?.LINK || '');
}

function setStatus(tipo, mensagem) {
  const statusDiv = document.getElementById('status');

  if (!statusDiv) {
    return;
  }

  statusDiv.className = tipo || '';
  statusDiv.innerHTML = mensagem || '';
}

async function carregarLista() {
  const id = getIdLista();

  if (!id) {
    setStatus('erro', '❌ ID da lista não informado.');
    return;
  }

  try {
    setStatus('', '⏳ Carregando lista de links...');

    const response = await fetch(`/api/lista-links/${id}`, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store'
    });

    if (response.status === 401) {
      alert('Sessão expirada. Faça login novamente.');
      window.location.href = '/login.html';
      return;
    }

    const json = await response.json();

    if (!response.ok) {
      throw new Error(json.erro || 'Erro ao carregar lista.');
    }

    listaAtual = json;
    linksGerados = Array.isArray(json.links) ? json.links : [];

    renderizarLista();

  } catch (err) {
    console.error(err);
    setStatus('erro', `❌ ${err.message}`);
  }
}

function renderizarLista() {
  const resultadoDiv = document.getElementById('resultado');

  if (!resultadoDiv) {
    return;
  }

  if (!linksGerados.length) {
    resultadoDiv.innerHTML = '';
    setStatus('warn', '⚠️ Nenhum link encontrado nesta lista.');
    return;
  }

  setStatus('ok', `✅ Lista carregada com ${linksGerados.length} link(s).`);

  resultadoDiv.innerHTML = `
    <div class="resultado-topo">
      <strong>ID:</strong> ${listaAtual.id || '-'}<br>
      <strong>Tipo:</strong> ${listaAtual.tipo || '-'}<br>
      <strong>Usuário:</strong> ${listaAtual.usuario || '-'}<br>
      <strong>Data:</strong> ${listaAtual.dataGeracao || '-'}<br>
      <strong>Filtro:</strong> ${listaAtual.filtroResumo || '-'}<br>
      <strong>Total:</strong> ${linksGerados.length}
    </div>
  `;

  linksGerados.forEach(item => {
    const nunota = getNunota(item);
    const numNota = getNumNota(item);
    const nomeCliente = getNomeCliente(item);
    const periodoPap = getPeriodoPap(item);
    const link = getLink(item);

    const el = document.createElement('div');
    el.className = 'link-item';

    el.innerHTML = `<b>Pedido:</b> ${nunota}${numNota ? `<br><b>NF-e:</b> ${numNota}` : ''}<br><b>Cliente:</b> ${nomeCliente}${periodoPap ? `<br><b>Período PAP:</b> ${periodoPap}` : ''}<br><br><a href="${link}" target="_blank">${link}</a><div class="actions"><button onclick="copiar('${link}')">📋 Copiar</button><button onclick="abrir('${link}')">🔗 Abrir</button><button onclick="whatsapp('${link}')">📲 WhatsApp</button></div>`;

    resultadoDiv.appendChild(el);
  });
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

async function copiarUrlLista() {
  try {
    await navigator.clipboard.writeText(window.location.href);
    alert('✅ URL da lista copiada');
  } catch (err) {
    console.error(err);
    alert('❌ Erro ao copiar URL');
  }
}

function abrir(link) {
  window.open(link, '_blank');
}

function whatsapp(link) {
  const texto = encodeURIComponent(`Acompanhe seu pedido:\n${link}`);
  window.open(`https://wa.me/?text=${texto}`, '_blank');
}

function voltarGerador() {
  window.location.href = '/gerador.html';
}

async function baixarTodosLista() {
  if (!linksGerados.length) {
    alert('⚠️ Nenhum pedido na lista');
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

    const pedidos = linksGerados
      .map(item => getNunota(item))
      .filter(Boolean);

    if (!pedidos.length) {
      setStatus('erro', '❌ Nenhum pedido válido para download.');

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
    a.download = `Comprovantes_Lista_${new Date().toISOString().slice(0, 10)}.zip`;

    document.body.appendChild(a);
    a.click();
    a.remove();

    window.URL.revokeObjectURL(url);

    if (progressText) {
      progressText.innerHTML = '✅ ZIP gerado com sucesso.';
    }

    setStatus('ok', `✅ ZIP gerado com ${pedidos.length} pedido(s).`);

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

carregarLista();