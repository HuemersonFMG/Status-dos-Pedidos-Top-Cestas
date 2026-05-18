const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const archiver = require('archiver');
const path = require('path');

const fetch = (...args) =>
  import('node-fetch')
    .then(({ default: fetch }) => fetch(...args));

const app = express();

app.use(cors({
  origin: true,
  credentials: true
}));

app.use(express.json({
  limit: '50mb'
}));

app.use(express.urlencoded({
  extended: true,
  limit: '50mb'
}));

const PORT = process.env.PORT || 5050;

const SECRET = process.env.SECRET || 'chave_super_secreta';

const BASE_URL = 'http://topcesta.fwc.cloud:8180';

const SERVICE_URL = `${BASE_URL}/mge/service.sbr`;

const USER = process.env.USER || 'HUEMERSON';

const PASS = process.env.PASS || '654321';

const PUBLIC_DIR = path.join(__dirname, 'public');

const ADMIN_SESSION_COOKIE = 'topcestas_admin_session';

const ADMIN_SESSION_TTL = 8 * 60 * 60 * 1000;

const MAX_LOGIN_ATTEMPTS = 5;

const LOGIN_BLOCK_TIME = 5 * 60 * 1000;

const adminSessions = new Map();

const loginAttempts = new Map();

app.use((req, res, next) => {
  console.log(`🌐 ${req.method} ${req.url}`);
  next();
});

let cachedCookie = null;
let cookieTime = 0;

function getCookie(req, nome) {
  const raw = req.headers.cookie || '';

  return raw
    .split(';')
    .map(c => c.trim())
    .find(c => c.startsWith(`${nome}=`))
    ?.split('=')
    .slice(1)
    .join('=') || '';
}

function getClientKey(req, usuario) {
  const ip =
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket.remoteAddress ||
    'unknown';

  return `${ip}:${String(usuario || '').trim().toUpperCase()}`;
}

function isLoginBlocked(key) {
  const item = loginAttempts.get(key);

  if (!item) {
    return false;
  }

  if (item.blockedUntil && item.blockedUntil > Date.now()) {
    return true;
  }

  if (item.blockedUntil && item.blockedUntil <= Date.now()) {
    loginAttempts.delete(key);
    return false;
  }

  return false;
}

function registerFailedLogin(key) {
  const now = Date.now();

  const item =
    loginAttempts.get(key) || {
      count: 0,
      blockedUntil: null
    };

  item.count++;

  if (item.count >= MAX_LOGIN_ATTEMPTS) {
    item.blockedUntil = now + LOGIN_BLOCK_TIME;
  }

  loginAttempts.set(key, item);

  return item;
}

function clearFailedLogin(key) {
  loginAttempts.delete(key);
}

function limparSessoesExpiradas() {
  const now = Date.now();

  for (const [token, session] of adminSessions.entries()) {
    if (!session || session.expiresAt <= now) {
      adminSessions.delete(token);
    }
  }
}

function getAdminSession(req) {
  limparSessoesExpiradas();

  const token = getCookie(req, ADMIN_SESSION_COOKIE);

  if (!token) {
    return null;
  }

  const session = adminSessions.get(token);

  if (!session || session.expiresAt <= Date.now()) {
    adminSessions.delete(token);
    return null;
  }

  session.lastAccess = Date.now();

  return session;
}

function requireAdminPage(req, res, next) {
  const session = getAdminSession(req);

  if (!session) {
    return res.redirect('/login.html');
  }

  next();
}

function requireAdminApi(req, res, next) {
  const session = getAdminSession(req);

  if (!session) {
    return res.status(401).json({
      erro: 'Sessão administrativa expirada. Faça login novamente.'
    });
  }

  next();
}

async function validarLoginSankhya(usuario, senha) {
  const payload = {
    serviceName: 'MobileLoginSP.login',
    requestBody: {
      NOMUSU: {
        $: usuario
      },
      INTERNO: {
        $: senha
      }
    }
  };

  const response =
    await fetch(
      `${SERVICE_URL}?serviceName=MobileLoginSP.login&outputType=json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      }
    );

  const rawCookie =
    response.headers.get('set-cookie') || '';

  const cookie =
    rawCookie.split(';')[0];

  if (!response.ok || !cookie) {
    return false;
  }

  return true;
}

async function login() {
  const now = Date.now();

  if (cachedCookie && (now - cookieTime < 5 * 60 * 1000)) {
    return cachedCookie;
  }

  const payload = {
    serviceName: 'MobileLoginSP.login',
    requestBody: {
      NOMUSU: {
        $: USER
      },
      INTERNO: {
        $: PASS
      }
    }
  };

  const response =
    await fetch(
      `${SERVICE_URL}?serviceName=MobileLoginSP.login&outputType=json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      }
    );

  const rawCookie =
    response.headers.get('set-cookie') || '';

  const cookie =
    rawCookie.split(';')[0];

  if (!cookie) {
    throw new Error('Erro ao autenticar no Sankhya');
  }

  cachedCookie = cookie;
  cookieTime = now;

  console.log('✅ Login Sankhya OK');

  return cookie;
}

function gerarToken(nunota) {
  return crypto
    .createHash('sha256')
    .update(String(nunota) + SECRET)
    .digest('hex');
}

function parseDataBR(dataStr) {
  if (!dataStr) {
    return null;
  }

  try {
    const [data] = dataStr.split(' ');
    const [dia, mes, ano] = data.split('/');

    return new Date(`${ano}-${mes}-${dia}`);
  } catch {
    return null;
  }
}

async function carregarViewLight(cookie) {
  const payload = {
    serviceName: 'CRUDServiceProvider.loadView',
    requestBody: {
      query: {
        viewName: 'VW_NOTAS_FUSION_LIGHT'
      }
    }
  };

  const response =
    await fetch(
      `${SERVICE_URL}?serviceName=CRUDServiceProvider.loadView&outputType=json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': cookie
        },
        body: JSON.stringify(payload)
      }
    );

  const json =
    await response.json();

  const rec =
    json?.responseBody?.records?.record;

  if (!rec) {
    return [];
  }

  return Array.isArray(rec)
    ? rec
    : [rec];
}

function montarLinks(filtrados, baseUrl) {
  return filtrados.map(r => ({
    nunota: r.NUNOTA?.$ || '',
    NUNOTA: r.NUNOTA?.$ || '',
    numNota: r.NUMNOTA?.$ || '',
    NUMNOTA: r.NUMNOTA?.$ || '',
    nomeParc: r.NOMEPARC?.$ || '',
    NOMEPARC: r.NOMEPARC?.$ || '',
    periodoPap: r.AD_PERIODO_PAP?.$ || '',
    AD_PERIODO_PAP: r.AD_PERIODO_PAP?.$ || '',
    link: `${baseUrl}/index.html?nunota=${r.NUNOTA?.$}&token=${gerarToken(r.NUNOTA?.$)}`
  }));
}

app.get('/gerador.html', requireAdminPage, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'gerador.html'));
});

app.get('/geradorcomercial.html', requireAdminPage, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'geradorcomercial.html'));
});

app.post('/api/admin-login', async (req, res) => {
  try {
    const usuario = String(req.body.usuario || '').trim();
    const senha = String(req.body.senha || '').trim();

    if (!usuario || !senha) {
      return res.status(400).json({
        erro: 'Informe usuário e senha'
      });
    }

    const loginKey = getClientKey(req, usuario);

    if (isLoginBlocked(loginKey)) {
      const item = loginAttempts.get(loginKey);
      const segundos = Math.ceil((item.blockedUntil - Date.now()) / 1000);

      return res.status(429).json({
        erro: `Muitas tentativas inválidas. Tente novamente em ${segundos} segundos.`
      });
    }

    const loginOk =
      await validarLoginSankhya(usuario, senha);

    if (!loginOk) {
      const tentativa =
        registerFailedLogin(loginKey);

      const restantes =
        Math.max(0, MAX_LOGIN_ATTEMPTS - tentativa.count);

      if (tentativa.blockedUntil && tentativa.blockedUntil > Date.now()) {
        return res.status(429).json({
          erro: 'Muitas tentativas inválidas. Aguarde alguns minutos e tente novamente.'
        });
      }

      return res.status(401).json({
        erro: `Usuário ou senha inválidos. Tentativas restantes: ${restantes}`
      });
    }

    clearFailedLogin(loginKey);

    const sessionToken =
      crypto.randomBytes(32).toString('hex');

    adminSessions.set(sessionToken, {
      usuario,
      createdAt: Date.now(),
      lastAccess: Date.now(),
      expiresAt: Date.now() + ADMIN_SESSION_TTL
    });

    res.setHeader(
      'Set-Cookie',
      `${ADMIN_SESSION_COOKIE}=${sessionToken}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${ADMIN_SESSION_TTL / 1000}`
    );

    res.json({
      ok: true,
      usuario
    });

  } catch (err) {
    console.error('❌ ERRO admin-login:', err);

    res.status(500).json({
      erro: err.message
    });
  }
});

app.post('/api/admin-logout', (req, res) => {
  const token = getCookie(req, ADMIN_SESSION_COOKIE);

  if (token) {
    adminSessions.delete(token);
  }

  res.setHeader(
    'Set-Cookie',
    `${ADMIN_SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`
  );

  res.json({
    ok: true
  });
});

app.get('/api/admin-status', (req, res) => {
  const session = getAdminSession(req);

  if (!session) {
    return res.status(401).json({
      autenticado: false
    });
  }

  res.json({
    autenticado: true,
    usuario: session.usuario
  });
});

app.use(express.static(PUBLIC_DIR));

app.post(
  '/api/gerar-links',
  requireAdminApi,
  async (req, res) => {
    try {
      const {
        cnpj,
        ordemCarga,
        data,
        pedidos,
        nfes
      } = req.body;

      const documento =
        (cnpj || '').replace(/\D/g, '');

      const ordem =
        ordemCarga
          ? String(ordemCarga)
          : null;

      let listaPedidos = [];
      let listaNfes = [];

      if (pedidos) {
        listaPedidos =
          String(pedidos)
            .split(',')
            .map(p => p.trim())
            .filter(Boolean);
      }

      if (nfes) {
        listaNfes =
          String(nfes)
            .split(',')
            .map(n => n.trim())
            .filter(Boolean);
      }

      let tipoFiltro = null;

      if (listaPedidos.length) {
        tipoFiltro = 'PEDIDOS';
      } else if (listaNfes.length) {
        tipoFiltro = 'NFES';
      } else if (documento) {
        tipoFiltro = 'DOCUMENTO';
      } else if (ordem) {
        tipoFiltro = 'ORDEM';
      } else if (data) {
        tipoFiltro = 'DATA';
      }

      if (!tipoFiltro) {
        return res.status(400).json({
          erro: 'Informe um filtro'
        });
      }

      const cookie =
        await login();

      const lista =
        await carregarViewLight(cookie);

      let inicio = null;
      let fim = null;

      if (tipoFiltro === 'DATA') {
        inicio = new Date(data + 'T00:00:00');
        fim = new Date(data + 'T23:59:59');
      }

      const filtrados =
        lista.filter(r => {
          const doc =
            (r.CGC_CPF?.$ || '').replace(/\D/g, '');

          const oc =
            r.ORDEMCARGA?.$
              ? String(r.ORDEMCARGA.$)
              : '';

          const nunota =
            String(r.NUNOTA?.$ || '');

          const numNota =
            String(r.NUMNOTA?.$ || '');

          switch (tipoFiltro) {
            case 'PEDIDOS':
              return listaPedidos.includes(nunota);

            case 'NFES':
              return listaNfes.includes(numNota);

            case 'DOCUMENTO':
              return doc === documento;

            case 'ORDEM':
              return oc === ordem;

            case 'DATA': {
              const dataPedido =
                parseDataBR(r.DTNEG?.$);

              return (
                dataPedido &&
                dataPedido >= inicio &&
                dataPedido <= fim
              );
            }

            default:
              return false;
          }
        });

      const baseUrl =
        `${req.protocol}://${req.get('host')}`;

      const links =
        montarLinks(filtrados, baseUrl);

      res.json({
        total: links.length,
        links
      });

    } catch (err) {
      console.error('❌ ERRO gerar-links:', err);

      res.status(500).json({
        erro: err.message
      });
    }
  }
);

app.post(
  '/api/gerar-links-comercial',
  requireAdminApi,
  async (req, res) => {
    try {
      const {
        cnpj,
        periodoPap
      } = req.body;

      const documento =
        (cnpj || '').replace(/\D/g, '');

      const periodo =
        String(periodoPap || '').trim();

      if (!documento && !periodo) {
        return res.status(400).json({
          erro: 'Informe CPF/CNPJ e Período PAP'
        });
      }

      if (!documento) {
        return res.status(400).json({
          erro: 'Informe CPF/CNPJ'
        });
      }

      if (!periodo) {
        return res.status(400).json({
          erro: 'Informe Período PAP'
        });
      }

      if (
        documento.length !== 11 &&
        documento.length !== 14
      ) {
        return res.status(400).json({
          erro: 'CPF/CNPJ inválido'
        });
      }

      const cookie =
        await login();

      const lista =
        await carregarViewLight(cookie);

      const filtrados =
        lista.filter(r => {
          const doc =
            (r.CGC_CPF?.$ || '').replace(/\D/g, '');

          const periodoRegistro =
            String(r.AD_PERIODO_PAP?.$ || '').trim();

          return (
            doc === documento &&
            periodoRegistro === periodo
          );
        });

      const baseUrl =
        `${req.protocol}://${req.get('host')}`;

      const links =
        montarLinks(filtrados, baseUrl);

      res.json({
        total: links.length,
        links
      });

    } catch (err) {
      console.error('❌ ERRO gerar-links-comercial:', err);

      res.status(500).json({
        erro: err.message
      });
    }
  }
);

app.get(
  '/api/pedido',
  async (req, res) => {
    try {
      const {
        nunota,
        token
      } = req.query;

      if (!nunota || !token) {
        return res.status(400).json({
          erro: 'Parâmetros inválidos'
        });
      }

      if (token !== gerarToken(nunota)) {
        return res.status(403).json({
          erro: 'Acesso negado'
        });
      }

      const cookie =
        await login();

      const payload = {
        serviceName: 'CRUDServiceProvider.loadView',
        requestBody: {
          query: {
            viewName: 'VW_NOTAS_FUSION'
          }
        }
      };

      const response =
        await fetch(
          `${SERVICE_URL}?serviceName=CRUDServiceProvider.loadView&outputType=json`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Cookie': cookie
            },
            body: JSON.stringify(payload)
          }
        );

      const json =
        await response.json();

      const rec =
        json?.responseBody?.records?.record;

      let lista = [];

      if (rec) {
        lista =
          Array.isArray(rec)
            ? rec
            : [rec];
      }

      const pedido =
        lista.find(
          r =>
            String(r.NUNOTA?.$) ===
            String(nunota)
        );

      if (!pedido) {
        return res.json({
          rows: []
        });
      }

      const tipo =
        Number(pedido.TIPO_FOTO?.$ || 0);

      res.json({
        rows: [{
          NUNOTA: pedido.NUNOTA?.$,
          NUMNOTA: pedido.NUMNOTA?.$,
          NOMEPARC: pedido.NOMEPARC?.$,
          CGC_CPF: pedido.CGC_CPF?.$,
          DTNEG: parseDataBR(pedido.DTNEG?.$),
          ORDEMCARGA: pedido.ORDEMCARGA?.$,
          TRANSPORTADORA: (pedido.TRANSPORTADORA?.$ || '').trim(),
          ST_ENTREGAS: pedido.ST_ENTREGAS?.$,
          TEM_FOTO: tipo === 1,
          TEM_PDF: tipo === 2
        }]
      });

    } catch (err) {
      console.error('❌ ERRO pedido:', err);

      res.status(500).json({
        erro: err.message
      });
    }
  }
);

app.get(
  '/api/comprovante/imagem',
  async (req, res) => {
    try {
      const {
        nunota,
        token
      } = req.query;

      if (token !== gerarToken(nunota)) {
        return res.status(403).send('Acesso negado');
      }

      const cookie =
        await login();

      const url =
        `${BASE_URL}/mge/AD_APPENTFOTO@FOTO@NUNOTA=${nunota}@SEQ=1.dbimage`;

      const response =
        await fetch(url, {
          headers: {
            Cookie: cookie
          }
        });

      if (!response.ok) {
        return res.status(404).send('Imagem não encontrada');
      }

      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'no-store');

      response.body.pipe(res);

    } catch (err) {
      console.error('❌ ERRO IMAGEM:', err);

      res.status(500).send('Erro ao carregar imagem');
    }
  }
);

app.get(
  '/api/comprovante/pdf',
  async (req, res) => {
    try {
      const {
        nunota,
        token
      } = req.query;

      const nunotaNum =
        Number(nunota);

      if (!nunota || isNaN(nunotaNum)) {
        return res.status(400).send('NUNOTA inválido');
      }

      if (token !== gerarToken(nunota)) {
        return res.status(403).send('Acesso negado');
      }

      const cookie =
        await login();

      const payload = {
        serviceName: 'DbExplorerSP.executeQuery',
        requestBody: {
          sql: `
            SELECT AD_COMPROVTRANSP
            FROM TGFCAB
            WHERE NUNOTA = ${nunotaNum}
          `
        }
      };

      const response =
        await fetch(
          `${SERVICE_URL}?serviceName=DbExplorerSP.executeQuery&outputType=json`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Cookie': cookie
            },
            body: JSON.stringify(payload)
          }
        );

      const json =
        await response.json();

      const registro =
        json?.responseBody?.rows?.[0];

      if (!registro || !registro[0]) {
        return res.status(404).send('PDF não encontrado');
      }

      const buffer =
        Buffer.from(registro[0], 'base64');

      res.setHeader('Content-Type', 'application/pdf');

      res.setHeader(
        'Content-Disposition',
        `inline; filename=comprovante_${nunota}.pdf`
      );

      res.send(buffer);

    } catch (err) {
      console.error('❌ ERRO PDF:', err);

      res.status(500).send('Erro ao processar PDF');
    }
  }
);

app.post(
  '/api/baixar-comprovantes',
  requireAdminApi,
  async (req, res) => {
    try {
      const { pedidos } =
        req.body;

      if (!Array.isArray(pedidos) || !pedidos.length) {
        return res.status(400).json({
          erro: 'Nenhum pedido informado'
        });
      }

      const cookie =
        await login();

      res.setHeader('Content-Type', 'application/zip');

      res.setHeader(
        'Content-Disposition',
        'attachment; filename=comprovantes.zip'
      );

      const archive =
        archiver('zip', {
          zlib: {
            level: 9
          }
        });

      archive.on(
        'error',
        err => {
          throw err;
        }
      );

      archive.pipe(res);

      for (const nunota of pedidos) {
        try {
          console.log(`🔍 PROCESSANDO ${nunota}`);

          const imgUrl =
            `${BASE_URL}/mge/AD_APPENTFOTO@FOTO@NUNOTA=${nunota}@SEQ=1.dbimage`;

          const imgResponse =
            await fetch(
              imgUrl,
              {
                headers: {
                  Cookie: cookie
                }
              }
            );

          if (imgResponse.ok) {
            const arrayBuffer =
              await imgResponse.arrayBuffer();

            const buffer =
              Buffer.from(arrayBuffer);

            archive.append(buffer, {
              name: `Comprovante_${nunota}.jpg`
            });

            console.log(`✅ IMG ${nunota}`);

            continue;
          }

          const payload = {
            serviceName: 'DbExplorerSP.executeQuery',
            requestBody: {
              sql: `
                SELECT AD_COMPROVTRANSP
                FROM TGFCAB
                WHERE NUNOTA = ${Number(nunota)}
              `
            }
          };

          const response =
            await fetch(
              `${SERVICE_URL}?serviceName=DbExplorerSP.executeQuery&outputType=json`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Cookie': cookie
                },
                body: JSON.stringify(payload)
              }
            );

          const json =
            await response.json();

          const registro =
            json?.responseBody?.rows?.[0];

          if (registro && registro[0]) {
            const buffer =
              Buffer.from(registro[0], 'base64');

            archive.append(buffer, {
              name: `Comprovante_${nunota}.pdf`
            });

            console.log(`✅ PDF ${nunota}`);
          }

        } catch (err) {
          console.error(`❌ ERRO ${nunota}:`, err.message);
        }
      }

      await archive.finalize();

      console.log('✅ ZIP FINALIZADO');

    } catch (err) {
      console.error('❌ ERRO ZIP:', err);

      res.status(500).json({
        erro: err.message
      });
    }
  }
);

app.listen(
  PORT,
  '0.0.0.0',
  () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log(`📱 Local: http://localhost:${PORT}`);
  }
);