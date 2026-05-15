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

  async function fetchSeguro(url, options = {}) {
    try {
      const res = await fetch(url, options);
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

    const documento = limparDoc(cnpjInput.value);
    const periodoPap = periodoPapInput.value.trim();

    if (!documento && !periodoPap) {
      setStatus('erro', '❌ Informe o CPF/CNPJ e o Período PAP');
      return;
    }

    if (!documento) {
      setStatus('erro', '❌ Informe o CPF/CNPJ');
      return;
    }

    if (!periodoPap) {
      setStatus('erro', '❌ Informe o Período PAP');
      return;
    }

    if (documento.length !== 11 && documento.length !== 14) {
      setStatus('erro', '❌ CPF/CNPJ inválido');
      return;
    }

    setStatus('', '⏳ Buscando pedidos...');

    try {
      const payload = {
        cnpj: documento,
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
      setStatus('erro', `❌ ${err.message}`);
    }
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

  async function baixarTodos() {
    if (!linksGerados.length) {
      alert('⚠️ Nenhum pedido gerado');
      return;
    }

    try {
      setStatus('', '⏳ Preparando downloads...');

      let totalBaixados = 0;

      for (const item of linksGerados) {
        const nunota = getNunota(item);
        const link = getLink(item);
        const token = getTokenFromLink(link);

        if (!nunota || !token) {
          console.warn('Item inválido para download:', item);
          continue;
        }

        const imgUrl = `/api/comprovante/imagem?nunota=${nunota}&token=${token}`;

        try {
          const imgRes = await fetch(imgUrl);

          if (imgRes.ok) {
            const blob = await imgRes.blob();

            if (blob.size > 1000) {
              const url = window.URL.createObjectURL(blob);
              const a = document.createElement('a');

              a.href = url;
              a.download = montarNomeArquivo(item, 'jpg');

              document.body.appendChild(a);
              a.click();
              a.remove();

              window.URL.revokeObjectURL(url);

              totalBaixados++;

              await new Promise(r => setTimeout(r, 800));

              continue;
            }
          }

        } catch (err) {
          console.error(`Erro imagem ${nunota}`, err);
        }

        const pdfUrl = `/api/comprovante/pdf?nunota=${nunota}&token=${token}`;

        try {
          const pdfRes = await fetch(pdfUrl);

          if (pdfRes.ok) {
            const blob = await pdfRes.blob();

            if (blob.size > 1000) {
              const url = window.URL.createObjectURL(blob);
              const a = document.createElement('a');

              a.href = url;
              a.download = montarNomeArquivo(item, 'pdf');

              document.body.appendChild(a);
              a.click();
              a.remove();

              window.URL.revokeObjectURL(url);

              totalBaixados++;

              await new Promise(r => setTimeout(r, 800));
            }
          }

        } catch (err) {
          console.error(`Erro PDF ${nunota}`, err);
        }
      }

      setStatus('ok', `✅ ${totalBaixados} download(s) iniciado(s)`);

      alert(`

  ✅ Downloads iniciados

  📂 Os arquivos foram enviados
  para a pasta padrão de Downloads
  do navegador.

  💡 Dica:
  configure o Chrome para perguntar
  onde salvar os arquivos.

      `);

    } catch (err) {
      console.error(err);
      setStatus('erro', `❌ ${err.message}`);
    }
  }

  function abrirManual() {
    window.open('/manual.html', '_blank');
  }