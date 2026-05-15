// =========================
// 🔒 BLOQUEIOS
// =========================
document.addEventListener('keydown', function (e) {

    if (e.key === 'F12') {

      e.preventDefault();

      return false;
    }

    if (
      e.ctrlKey &&
      e.shiftKey &&
      (
        e.key === 'I' ||
        e.key === 'J'
      )
    ) {

      e.preventDefault();

      return false;
    }

    if (
      e.ctrlKey &&
      e.key.toLowerCase() === 'u'
    ) {

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

    return (valor || '')
      .replace(/\D/g, '');
  }

  function getNunota(item) {

    return (
      item?.nunota ||
      item?.NUNOTA ||
      item?.NUNOTA?.$ ||
      ''
    );
  }

  function getNumNota(item) {

    return (
      item?.numNota ||
      item?.NUMNOTA ||
      item?.NUMNOTA?.$ ||
      ''
    );
  }

  function getLink(item) {

    return (
      item?.link ||
      item?.LINK ||
      ''
    );
  }

  function getTokenFromLink(link) {

    try {

      const url =
        new URL(
          link,
          window.location.origin
        );

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

    statusDiv.className =
      tipo || '';

    statusDiv.innerHTML =
      mensagem || '';
  }

  // =========================
  // 🎯 ELEMENTOS
  // =========================
  const cnpjInput =
    document.getElementById('cnpj');

  const ordemInput =
    document.getElementById('ordem') ||
    document.getElementById('ordemCarga');

  const pedidosInput =
    document.getElementById('pedidos');

  const nfesInput =
    document.getElementById('nfes');

  const dataInput =
    document.getElementById('data');

  const statusDiv =
    document.getElementById('status');

  const resultadoDiv =
    document.getElementById('resultado');

  // =========================
  // 🔁 CONTROLE FILTROS
  // =========================
  function atualizarFiltros() {

    const temCnpj =
      !!cnpjInput.value.trim();

    const temOrdem =
      !!ordemInput.value.trim();

    const temPedidos =
      !!pedidosInput.value.trim();

    const temNfes =
      nfesInput
        ? !!nfesInput.value.trim()
        : false;

    const temData =
      !!dataInput.value;

    cnpjInput.disabled =
      temOrdem ||
      temPedidos ||
      temNfes ||
      temData;

    ordemInput.disabled =
      temCnpj ||
      temPedidos ||
      temNfes ||
      temData;

    pedidosInput.disabled =
      temCnpj ||
      temOrdem ||
      temNfes ||
      temData;

    if (nfesInput) {

      nfesInput.disabled =
        temCnpj ||
        temOrdem ||
        temPedidos ||
        temData;
    }

    dataInput.disabled =
      temCnpj ||
      temOrdem ||
      temPedidos ||
      temNfes;
  }

  // =========================
  // 🎧 EVENTOS
  // =========================
  cnpjInput.addEventListener(
    'input',
    atualizarFiltros
  );

  ordemInput.addEventListener(
    'input',
    atualizarFiltros
  );

  pedidosInput.addEventListener(
    'input',
    atualizarFiltros
  );

  if (nfesInput) {

    nfesInput.addEventListener(
      'input',
      atualizarFiltros
    );
  }

  dataInput.addEventListener(
    'input',
    atualizarFiltros
  );

  // =========================
  // 🛡️ FETCH SEGURO
  // =========================
  async function fetchSeguro(
    url,
    options = {}
  ) {

    try {

      const res =
        await fetch(url, options);

      const text =
        await res.text();

      if (!text) {

        throw new Error(
          'Resposta vazia do servidor'
        );
      }

      let data;

      try {

        data =
          JSON.parse(text);

      } catch {

        console.error(
          '❌ JSON inválido:',
          text
        );

        throw new Error(
          'Erro ao processar resposta'
        );
      }

      if (!res.ok) {

        throw new Error(
          data.erro ||
          'Erro na requisição'
        );
      }

      return data;

    } catch (err) {

      console.error(
        '❌ FETCH:',
        err
      );

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

    if (nfesInput) {

      nfesInput.disabled = false;
    }

    dataInput.disabled = false;

    setStatus('', '');
  }

  // =========================
  // 🔍 GERAR LINKS
  // =========================
  async function gerar() {

    limparResultado();

    const documento =
      limparDoc(cnpjInput.value);

    const ordem =
      ordemInput.value.trim();

    const pedidos =
      pedidosInput.value.trim();

    const nfes =
      nfesInput
        ? nfesInput.value.trim()
        : '';

    const data =
      dataInput.value;

    const filtros = [

      documento,
      ordem,
      pedidos,
      nfes,
      data

    ].filter(Boolean);

    if (!filtros.length) {

      setStatus(
        'erro',
        '❌ Informe um filtro'
      );

      return;
    }

    if (filtros.length > 1) {

      setStatus(
        'erro',
        '❌ Utilize apenas um filtro'
      );

      return;
    }

    if (
      documento &&
      documento.length !== 11 &&
      documento.length !== 14
    ) {

      setStatus(
        'erro',
        '❌ CPF/CNPJ inválido'
      );

      return;
    }

    setStatus(
      '',
      '⏳ Buscando pedidos...'
    );

    try {

      const payload = {

        cnpj:
          documento || null,

        ordemCarga:
          ordem || null,

        pedidos:
          pedidos || null,

        nfes:
          nfes || null,

        data:
          data || null
      };

      const dataRes =
        await fetchSeguro(
          '/api/gerar-links',
          {
            method: 'POST',

            headers: {
              'Content-Type':
                'application/json'
            },

            body:
              JSON.stringify(payload)
          }
        );

      if (
        !dataRes.links ||
        !dataRes.links.length
      ) {

        setStatus(
          'warn',
          '⚠️ Nenhum pedido encontrado'
        );

        return;
      }

      pedidosGerados =
        dataRes.links
          .map(l => getNunota(l))
          .filter(Boolean);

      linksGerados =
        dataRes.links;

      setStatus(
        'ok',
        `✅ ${dataRes.total || dataRes.links.length} pedido(s) encontrado(s)`
      );

      dataRes.links.forEach(l => {

        const nunota =
          getNunota(l);

        const numNota =
          getNumNota(l);

        const link =
          getLink(l);

        const el =
          document.createElement('div');

        el.className =
          'link-box';

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

          <br><br>

          <a
            href="${link}"
            target="_blank"
          >
            ${link}
          </a>

          <div class="actions">

            <button
              onclick="copiar('${link}')"
            >
              📋 Copiar
            </button>

            <button
              onclick="abrir('${link}')"
            >
              🔗 Abrir
            </button>

            <button
              onclick="whatsapp('${link}')"
            >
              📲 WhatsApp
            </button>

          </div>
        `;

        resultadoDiv.appendChild(el);
      });

    } catch (err) {

      console.error(
        '❌ ERRO:',
        err
      );

      setStatus(
        'erro',
        `❌ ${err.message}`
      );
    }
  }

  // =========================
  // 📋 COPIAR
  // =========================
  async function copiar(link) {

    try {

      await navigator.clipboard
        .writeText(link);

      alert(
        '✅ Link copiado'
      );

    } catch (err) {

      console.error(err);

      alert(
        '❌ Erro ao copiar'
      );
    }
  }

  // =========================
  // 🔗 ABRIR
  // =========================
  function abrir(link) {

    window.open(
      link,
      '_blank'
    );
  }

  // =========================
  // 📲 WHATSAPP
  // =========================
  function whatsapp(link) {

    const texto =
      encodeURIComponent(
        `Acompanhe seu pedido:\n${link}`
      );

    window.open(
      `https://wa.me/?text=${texto}`,
      '_blank'
    );
  }

  // =========================
  // ⬇️ BAIXAR TODOS
  // =========================
  async function baixarTodos() {

    if (!linksGerados.length) {

      alert(
        '⚠️ Nenhum pedido gerado'
      );

      return;
    }

    try {

      setStatus(
        '',
        '⏳ Preparando downloads...'
      );

      let totalBaixados = 0;

      for (const item of linksGerados) {

        const nunota =
          getNunota(item);

        const link =
          getLink(item);

        const token =
          getTokenFromLink(link);

        if (!nunota || !token) {

          console.warn(
            'Item inválido para download:',
            item
          );

          continue;
        }

        const imgUrl =
          `/api/comprovante/imagem?nunota=${nunota}&token=${token}`;

        try {

          const imgRes =
            await fetch(imgUrl);

          if (imgRes.ok) {

            const blob =
              await imgRes.blob();

            if (blob.size > 1000) {

              const url =
                window.URL.createObjectURL(blob);

              const a =
                document.createElement('a');

              a.href = url;

              a.download =
                `Comprovante_${nunota}.jpg`;

              document.body.appendChild(a);

              a.click();

              a.remove();

              window.URL.revokeObjectURL(url);

              totalBaixados++;

              await new Promise(r =>
                setTimeout(r, 800)
              );

              continue;
            }
          }

        } catch (err) {

          console.error(
            `Erro imagem ${nunota}`,
            err
          );
        }

        const pdfUrl =
          `/api/comprovante/pdf?nunota=${nunota}&token=${token}`;

        try {

          const pdfRes =
            await fetch(pdfUrl);

          if (pdfRes.ok) {

            const blob =
              await pdfRes.blob();

            if (blob.size > 1000) {

              const url =
                window.URL.createObjectURL(blob);

              const a =
                document.createElement('a');

              a.href = url;

              a.download =
                `Comprovante_${nunota}.pdf`;

              document.body.appendChild(a);

              a.click();

              a.remove();

              window.URL.revokeObjectURL(url);

              totalBaixados++;

              await new Promise(r =>
                setTimeout(r, 800)
              );
            }
          }

        } catch (err) {

          console.error(
            `Erro PDF ${nunota}`,
            err
          );
        }
      }

      setStatus(
        'ok',
        `✅ ${totalBaixados} download(s) iniciado(s)`
      );

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

      setStatus(
        'erro',
        `❌ ${err.message}`
      );
    }
  }

  // =========================
  // 🚀 START
  // =========================
  atualizarFiltros();