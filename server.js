const express = require('express');
const fs = require('fs');
const path = require('path');
const httpProxy = require('http-proxy');

const app = express();
const proxy = httpProxy.createProxyServer({});

const CONFIG_PATH = path.join(__dirname, 'config.json');
const ROUTES_PATH = path.join(__dirname, 'routes.json');
const RESERVED_PATHS = ['/RouTe/panel'];

const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const adminUser = config.admin?.username || 'admin';
const adminPass = config.admin?.password || 'admin';

app.use(express.urlencoded({ extended: false }));

function loadRoutes() {
  try {
    const data = JSON.parse(fs.readFileSync(ROUTES_PATH, 'utf8'));
    return Array.isArray(data.routes) ? data.routes : [];
  } catch (error) {
    return [];
  }
}

function saveRoutes(routes) {
  fs.writeFileSync(ROUTES_PATH, JSON.stringify({ routes }, null, 2));
}

function isReservedPath(value) {
  return RESERVED_PATHS.some((reserved) => value === reserved || value.startsWith(`${reserved}/`));
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="RouTe"');
    return res.status(401).send('Authentication required');
  }
  const raw = Buffer.from(header.split(' ')[1], 'base64').toString();
  const [user, pass] = raw.split(':');
  if (user === adminUser && pass === adminPass) {
    return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="RouTe"');
  return res.status(401).send('Invalid credentials');
}

function renderPanel(message = '') {
  const routes = loadRoutes();
  const rows = routes
    .map(
      (route) =>
        `<tr><td>${route.path}</td><td>${route.type}</td><td>${route.target}</td></tr>`
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <title>RouTe Admin Panel</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 40px; }
    table { border-collapse: collapse; width: 100%; margin-top: 20px; }
    th, td { border: 1px solid #ddd; padding: 8px; }
    th { background: #f2f2f2; }
    .message { margin: 10px 0; color: #d9534f; }
  </style>
</head>
<body>
  <h1>RouTe Admin Panel</h1>
  ${message ? `<div class="message">${message}</div>` : ''}
  <form method="POST" action="/RouTe/panel/routes">
    <label>Path (например, /test):</label><br />
    <input name="path" type="text" required />
    <br /><br />
    <label>Type:</label><br />
    <select name="type">
      <option value="proxy">proxy</option>
      <option value="redirect">redirect</option>
    </select>
    <br /><br />
    <label>Target (например, http://localhost:1203):</label><br />
    <input name="target" type="text" required />
    <br /><br />
    <button type="submit">Создать маршрут</button>
  </form>

  <h2>Текущие маршруты</h2>
  <table>
    <thead>
      <tr><th>Path</th><th>Type</th><th>Target</th></tr>
    </thead>
    <tbody>
      ${rows || '<tr><td colspan="3">Маршрутов нет</td></tr>'}
    </tbody>
  </table>
</body>
</html>`;
}

app.get('/RouTe/panel', requireAuth, (req, res) => {
  res.send(renderPanel());
});

app.post('/RouTe/panel/routes', requireAuth, (req, res) => {
  const newPath = String(req.body.path || '').trim();
  const type = String(req.body.type || '').trim();
  const target = String(req.body.target || '').trim();

  const routes = loadRoutes();

  if (!newPath.startsWith('/')) {
    return res.status(400).send(renderPanel('Path должен начинаться с /'));
  }
  if (isReservedPath(newPath)) {
    return res.status(400).send(renderPanel('Этот путь зарезервирован для панели управления'));
  }
  if (routes.some((route) => route.path === newPath)) {
    return res.status(400).send(renderPanel('Такой путь уже существует'));
  }
  if (!['proxy', 'redirect'].includes(type)) {
    return res.status(400).send(renderPanel('Неверный тип маршрутизации'));
  }
  if (!target) {
    return res.status(400).send(renderPanel('Укажите target для маршрутизации'));
  }

  routes.push({ path: newPath, type, target });
  saveRoutes(routes);

  return res.redirect('/RouTe/panel');
});

proxy.on('error', (err, req, res) => {
  if (!res.headersSent) {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
  }
  res.end(`Proxy error: ${err.message}`);
});

app.use((req, res) => {
  const routes = loadRoutes();
  const route = routes.find((item) => item.path === req.path);

  if (!route) {
    return res.status(404).send('Маршрут не найден');
  }

  if (route.type === 'redirect') {
    return res.redirect(route.target);
  }

  if (route.type === 'proxy') {
    return proxy.web(req, res, {
      target: route.target,
      changeOrigin: true,
      xfwd: true
    });
  }

  return res.status(500).send('Неизвестный тип маршрутизации');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`RouTe host запущен на http://localhost:${PORT}`);
});
