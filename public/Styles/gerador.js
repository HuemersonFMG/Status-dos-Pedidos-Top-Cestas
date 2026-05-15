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

    resultado.innerHTML =
    'Carregando...';

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

    resultado.innerHTML =
        '<p style=\"color:red\">Utilize apenas UM filtro.</p>';

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

    listaAtual =
        json.links || [];

    if (!listaAtual.length) {

        resultado.innerHTML =
        '<p>Nenhum resultado encontrado.</p>';

        return;
    }

    resultado.innerHTML = `

        <div class="resultado-topo">

        Total encontrado:
        <strong>${json.total}</strong>

        </div>

        ${listaAtual.map(link => `

        <div class="link-item">

            <strong>Pedido:</strong>
            ${link.nunota}

            ${link.numNota
            ? `<br><strong>NF-e:</strong> ${link.numNota}`
            : ''
            }

            <br><br>

            <a
            href="${link.link}"
            target="_blank">

            ${link.link}

            </a>

        </div>

        `).join('')}
    `;

    } catch (err) {

    console.error(err);

    resultado.innerHTML =
        '<p style=\"color:red\">Erro ao gerar links.</p>';
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
        listaAtual.map(
        item => item.nunota
        );

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

        throw new Error(
        'Erro ao baixar comprovantes'
        );
    }

    const blob =
        await response.blob();

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

    console.error(err);

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