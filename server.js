const express = require('express');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ===== Хранилище =====
const messages = [];
const MAX_MESSAGES = 100;

// ===== SSE-клиенты (кто слушает поток) =====
const sseClients = [];

function broadcast(msg) {
  const data = `data: ${JSON.stringify(msg)}\n\n`;
  sseClients.forEach(client => {
    try { client.res.write(data); } catch(e) {}
  });
}

// ===== Главная страница =====
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>ESP Уведомления</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0a1929;color:#eee;font-family:Arial;padding:20px;max-width:700px;margin:0 auto}
h1{color:#00d9ff;margin-bottom:10px;text-align:center}
.status{text-align:center;color:#8fa8bf;font-size:13px;margin-bottom:20px}
.dot{display:inline-block;width:10px;height:10px;border-radius:50%;
background:#f44336;margin-right:6px;vertical-align:middle}
.dot.on{background:#4CAF50;box-shadow:0 0 10px #4CAF50;animation:pulse 1.5s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
.counter{text-align:center;color:#8fa8bf;font-size:14px;margin-bottom:15px}
.msg{background:#132f4c;padding:14px 16px;border-radius:12px;
margin:10px 0;border-left:4px solid #00d9ff;
animation:slide 0.4s ease-out}
@keyframes slide{from{opacity:0;transform:translateX(-20px)}to{opacity:1;transform:none}}
.msg .text{font-size:16px;line-height:1.4;word-wrap:break-word}
.msg .meta{color:#8fa8bf;font-size:12px;margin-top:6px;display:flex;justify-content:space-between}
.empty{color:#484f58;text-align:center;padding:40px;font-style:italic}
</style>
</head>
<body>
<h1>📬 ESP Уведомления</h1>
<div class="status"><span class="dot" id="dot"></span><span id="status">Подключение...</span></div>
<div class="counter">Всего: <span id="count">0</span></div>
<div id="messages"><div class="empty">Пока нет сообщений</div></div>

<script>
const messagesEl = document.getElementById('messages');
const dotEl = document.getElementById('dot');
const statusEl = document.getElementById('status');
const countEl = document.getElementById('count');
let totalCount = 0;
let firstMessage = true;

// Подключаемся к SSE-потоку
const source = new EventSource('/stream');

source.onopen = function() {
  dotEl.classList.add('on');
  statusEl.textContent = 'Подключено (реальное время)';
};

source.onerror = function() {
  dotEl.classList.remove('on');
  statusEl.textContent = 'Отключено. Переподключение...';
};

source.onmessage = function(event) {
  const msg = JSON.parse(event.data);
  
  // Удаляем заглушку "Пока нет сообщений"
  if (firstMessage) {
    messagesEl.innerHTML = '';
    firstMessage = false;
  }
  
  // Добавляем сообщение сверху
  const div = document.createElement('div');
  div.className = 'msg';
  div.innerHTML = 
    '<div class="text">' + escapeHtml(msg.text) + '</div>' +
    '<div class="meta"><span>' + escapeHtml(msg.time) + '</span>' +
    '<span>' + escapeHtml(msg.ip || '') + '</span></div>';
  
  messagesEl.insertBefore(div, messagesEl.firstChild);
  
  totalCount++;
  countEl.textContent = totalCount;
  
  // Ограничиваем количество на странице
  if (messagesEl.children.length > 50) {
    messagesEl.removeChild(messagesEl.lastChild);
  }
};

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;')
                  .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
</script>
</body>
</html>
  `);
});

// ===== SSE-поток =====
app.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');   // для прокси Render
  res.flushHeaders();

  // Отправляем историю сразу при подключении
  messages.forEach(m => {
    res.write(`data: ${JSON.stringify(m)}\n\n`);
  });

  const client = { res };
  sseClients.push(client);

  // Heartbeat каждые 30 сек (чтобы Render не рвал соединение)
  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch(e) {}
  }, 30000);

  req.on('close', () => {
    clearInterval(heartbeat);
    const idx = sseClients.indexOf(client);
    if (idx >= 0) sseClients.splice(idx, 1);
  });
});

// ===== Health check =====
app.get('/health', (req, res) => res.status(200).send('OK'));

// ===== Приём уведомлений от ESP =====
app.all('/notify', (req, res) => {
  const text = req.body.text || req.query.text;
  
  if (!text) return res.status(400).json({ error: 'no text' });
  
  const msg = {
    text: text,
    time: new Date().toLocaleString('ru-RU'),
    ip: req.ip.replace('::ffff:', '')
  };
  
  messages.push(msg);
  if (messages.length > MAX_MESSAGES) messages.shift();
  
  // Мгновенно рассылаем всем открытым страницам
  broadcast(msg);
  
  console.log(`📥 Принято: ${text}`);
  res.json({ ok: true, count: messages.length });
});

// ===== API =====
app.get('/messages', (req, res) => res.json({ messages }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Сервер на порту ${PORT}`));