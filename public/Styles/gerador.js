const cnpjInput =
    document.getElementById('cnpj');

const ordemInput =
    document.getElementById('ordem');

const pedidosInput =
    document.getElementById('pedidos');

const nfesInput =
    document.getElementById('nfes');

const dataInput =
    document.getElementById('data');

const resultado =
    document.getElementById('resultado');

let listaAtual = [];

// =========================
// HELPERS
// =========================

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

function mostrarMensagem(texto, tipo = '') {

    resultado.innerHTML = `
        <div class="mensagem ${tipo}">
            ${texto}
        </div>
    `;
}

// =========================
// FILTROS
// =========================

function atualizarFiltros() {

    const temCnpj =
        !!cnpjInput.value.trim();

    const temOrdem =
        !!ordemInput.value.trim();

    const temPedidos =
        !!pedidosInput.value.trim();

    const temNfes =
        !!nfesInput.value.trim();

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

    nfesInput.disabled =
        temCnpj ||
        temOrdem ||
        temPedidos ||
        temData;

    dataInput.disabled =
        temCnpj ||
        temOrdem ||
        temPedidos ||
        temNfes;
}

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

nfesInput.addEventListener(
    'input',
    atualizarFiltros
);

dataInput.addEventListener(
    'input',
    atualizarFiltros
);

// =========================
// LIMPAR
// =========================

function limpar() {

    cnpjInput.value = '';
    ordemInput.value = '';
    pedidosInput.value = '';
    nfesInput.value = '';
    dataInput.value = '';

    resultado.innerHTML = '';

    listaAtual = [];

    cnpjInput.disabled = false;
    ordemInput.disabled = false;
    pedidosInput.disabled = false;
    nfesInput.disabled = false;
    dataInput.disabled = false;
}

// =========================
// GERAR
// =========================

async function gerar() {

    mostrarMensagem(
        'Carregando...'
    );

    const documento =
        cnpjInput.value.trim();

    const ordemCarga =
        ordemInput.value.trim();

    const pedidos =
        pedidosInput.value.trim();

    const nfes =
        nfesInput.value.trim();

    const data =
        dataInput.value;

    const filtros = [
        documento,
        ordemCarga,
        pedidos,
        nfes,
        data
    ].filter(Boolean);

    if (filtros.length !== 1) {

        mostrarMensagem(
            'Utilize apenas UM filtro.',
            'erro'
        );

        return;
    }

    try {

        const response =
            await fetch(
                '/api/gerar-links',
                {
                    method: 'POST',

                    headers: {
                        'Content-Type':
                            'application/json'
                    },

                    body:
                        JSON.stringify({
                            cnpj:
                                documento || null,

                            ordemCarga:
                                ordemCarga || null,

                            pedidos:
                                pedidos || null,

                            nfes:
                                nfes || null,

                            data:
                                data || null
                        })
                }
            );

        const json =
            await response.json();

        if (!response.ok) {

            throw new Error(
                json?.erro ||
                'Erro ao gerar links'
            );
        }

        listaAtual =
            json.links || [];

        if (!listaAtual.length) {

            mostrarMensagem(
                'Nenhum resultado encontrado.',
                'erro'
            );

            return;
        }

        resultado.innerHTML = `

            <div class="resultado-topo">
                Total encontrado:
                <strong>${json.total || listaAtual.length}</strong>
            </div>

            ${listaAtual.map(item => {

                const nunota =
                    getNunota(item);

                const numNota =
                    getNumNota(item);

                const link =
                    getLink(item);

                return `

                    <div class="link-item">

                        <strong>Pedido:</strong>
                        ${nunota || '-'}

                        ${numNota
                            ? `
                                <br>
                                <strong>NF-e:</strong>
                                ${numNota}
                            `
                            : ''
                        }

                        <br><br>

                        <a
                            href="${link}"
                            target="_blank">

                            ${link}

                        </a>

                    </div>
                `;
            }).join('')}
        `;

    } catch (err) {

        console.error(
            'Erro gerar links:',
            err
        );

        mostrarMensagem(
            'Erro ao gerar links.',
            'erro'
        );
    }
}

// =========================
// BAIXAR TODOS
// =========================

async function baixarTodos() {

    if (!listaAtual.length) {

        alert(
            'Nenhum pedido gerado.'
        );

        return;
    }

    try {

        const pedidos =
            listaAtual
                .map(item =>
                    getNunota(item)
                )
                .filter(Boolean);

        if (!pedidos.length) {

            alert(
                'Nenhum pedido válido encontrado para download.'
            );

            return;
        }

        const response =
            await fetch(
                '/api/baixar-comprovantes',
                {
                    method: 'POST',

                    headers: {
                        'Content-Type':
                            'application/json'
                    },

                    body:
                        JSON.stringify({
                            pedidos
                        })
                }
            );

        if (!response.ok) {

            const erro =
                await response.text();

            console.error(
                'Erro backend baixar comprovantes:',
                erro
            );

            throw new Error(
                'Erro ao baixar comprovantes'
            );
        }

        const blob =
            await response.blob();

        if (!blob || blob.size === 0) {

            throw new Error(
                'Arquivo ZIP vazio'
            );
        }

        const url =
            window.URL.createObjectURL(blob);

        const a =
            document.createElement('a');

        a.href = url;

        a.download =
            'comprovantes.zip';

        document.body.appendChild(a);

        a.click();

        a.remove();

        window.URL.revokeObjectURL(url);

    } catch (err) {

        console.error(
            'Erro baixar comprovantes:',
            err
        );

        alert(
            'Erro ao baixar comprovantes.'
        );
    }
}

// =========================
// MANUAL
// =========================

function abrirManual() {

    window.open(
        '/manual.html',
        '_blank'
    );
}