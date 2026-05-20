require('dotenv').config();
const { Telegraf } = require('telegraf');
const { Pool } = require('pg');
const express = require('express');

const bot = new Telegraf(process.env.BOT_TOKEN);
const app = express();
app.use(express.json());

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const ADMIN_ID = process.env.ADMIN_ID;
const TZ = 'Asia/Tashkent';

function nowTZ() {
  return new Date(new Date().toLocaleString('en', { timeZone: TZ }));
}

function todayStr() {
  const d = nowTZ();
  return String(d.getDate()).padStart(2,'0') + '.' +
         String(d.getMonth()+1).padStart(2,'0') + '.' +
         d.getFullYear();
}

function dateN(n) {
  const d = new Date(nowTZ().getTime() + n * 86400000);
  return String(d.getDate()).padStart(2,'0') + '.' +
         String(d.getMonth()+1).padStart(2,'0') + '.' +
         d.getFullYear();
}

async function initDB() {
  await pool.query(`CREATE TABLE IF NOT EXISTS users (
    id BIGINT PRIMARY KEY,
    username TEXT,
    first_name TEXT,
    morning_sent DATE,
    registered_at TIMESTAMP DEFAULT NOW()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS venues (
    id SERIAL PRIMARY KEY,
    user_id BIGINT,
    name TEXT,
    created_at TIMESTAMP DEFAULT NOW()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS tasks (
    id SERIAL PRIMARY KEY,
    user_id BIGINT,
    venue TEXT,
    task TEXT,
    date TEXT,
    time TEXT,
    priority TEXT DEFAULT 'mid',
    status TEXT DEFAULT 'planned',
    reminded BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
  )`);
  // Добавляем колонку morning_sent если её нет
  try {
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS morning_sent DATE`);
  } catch(e) {}
  console.log('✅ База данных готова');
}

// ─── TELEGRAM BOT ───

bot.start(async (ctx) => {
  const { id, username, first_name } = ctx.from;
  await pool.query(
    `INSERT INTO users (id, username, first_name) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING`,
    [id, username || '', first_name || '']
  );
  await ctx.reply(
    `👨‍🍳 *Добро пожаловать в ChefPlan!*\n\n` +
    `Я помогу тебе планировать задачи по заведениям.\n\n` +
    `🕐 *Напоминания за 30 минут* до каждой задачи\n` +
    `🌅 *Утренняя сводка* каждый день в 8:00\n\n` +
    `Нажми кнопку ниже 👇`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: '📋 Открыть ChefPlan', web_app: { url: 'https://chefplan.ru/app.html?uid=' + id } }
        ]]
      }
    }
  );
});

// ─── API ───

app.get('/api/setup', async (req, res) => {
  const { chat_id, username } = req.query;
  if (!chat_id) return res.json({ error: 'No chat_id' });
  try {
    await pool.query(
      `INSERT INTO users (id, username) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING`,
      [chat_id, username || '']
    );
    res.json({ success: true });
  } catch(e) { res.json({ error: e.message }); }
});

app.get('/api/venues', async (req, res) => {
  const { chat_id } = req.query;
  if (!chat_id) return res.json([]);
  try {
    const r = await pool.query('SELECT * FROM venues WHERE user_id=$1 ORDER BY id', [chat_id]);
    res.json(r.rows);
  } catch(e) { res.json([]); }
});

app.post('/api/venues', async (req, res) => {
  const { chat_id, name } = req.query;
  app.delete('/api/users', async (req, res) => {
  const { id } = req.query;
  if (!id) return res.json({ error: 'No id' });
  try {
    await pool.query('DELETE FROM tasks WHERE user_id=$1', [id]);
    await pool.query('DELETE FROM venues WHERE user_id=$1', [id]);
    await pool.query('DELETE FROM users WHERE id=$1', [id]);
    res.json({ success: true });
  } catch(e) { res.json({ error: e.message }); }
});
  if (!chat_id || !name) return res.json({ error: 'Missing params' });
  try {
    await pool.query('INSERT INTO venues (user_id, name) VALUES ($1,$2)', [chat_id, name]);
    res.json({ success: true });
  } catch(e) { res.json({ error: e.message }); }
});

app.put('/api/venues', async (req, res) => {
  const { id, name } = req.query;
  if (!id || !name) return res.json({ error: 'Missing params' });
  try {
    await pool.query('UPDATE venues SET name=$1 WHERE id=$2', [name, id]);
    res.json({ success: true });
  } catch(e) { res.json({ error: e.message }); }
});

app.delete('/api/venues', async (req, res) => {
  const { id } = req.query;
  if (!id) return res.json({ error: 'No id' });
  try {
    await pool.query('DELETE FROM venues WHERE id=$1', [id]);
    res.json({ success: true });
  } catch(e) { res.json({ error: e.message }); }
});

app.get('/api/tasks', async (req, res) => {
  const { chat_id, filter } = req.query;
  if (!chat_id) return res.json([]);
  try {
    let q = `SELECT * FROM tasks WHERE user_id=$1 AND status != 'done'`;
    if (filter === 'today') q += ` AND date='${todayStr()}'`;
    if (filter === 'week') {
      const dates = Array.from({length:7}, (_,i) => `'${dateN(i)}'`).join(',');
      q += ` AND date IN (${dates})`;
    }
    q += ' ORDER BY date, time';
    const r = await pool.query(q, [chat_id]);
    res.json(r.rows);
  } catch(e) { res.json([]); }
});

app.post('/api/tasks', async (req, res) => {
  const { chat_id, venue, task, date, time, priority } = req.query;
  if (!chat_id || !task) return res.json({ error: 'Missing params' });
  try {
    await pool.query(
      'INSERT INTO tasks (user_id,venue,task,date,time,priority) VALUES ($1,$2,$3,$4,$5,$6)',
      [chat_id, venue, task, date, time, priority || 'mid']
    );
    res.json({ success: true });
  } catch(e) { res.json({ error: e.message }); }
});

app.put('/api/tasks', async (req, res) => {
  const { id, status, task, venue, date, time } = req.query;
  if (!id) return res.json({ error: 'No id' });
  try {
    if (status) await pool.query('UPDATE tasks SET status=$1, reminded=FALSE WHERE id=$2', [status, id]);
    if (task)   await pool.query('UPDATE tasks SET task=$1 WHERE id=$2', [task, id]);
    if (venue)  await pool.query('UPDATE tasks SET venue=$1 WHERE id=$2', [venue, id]);
    if (date)   await pool.query('UPDATE tasks SET date=$1 WHERE id=$2', [date, id]);
    if (time)   await pool.query('UPDATE tasks SET time=$1 WHERE id=$2', [time, id]);
    res.json({ success: true });
  } catch(e) { res.json({ error: e.message }); }
});

app.delete('/api/tasks', async (req, res) => {
  const { id } = req.query;
  if (!id) return res.json({ error: 'No id' });
  try {
    await pool.query('DELETE FROM tasks WHERE id=$1', [id]);
    res.json({ success: true });
  } catch(e) { res.json({ error: e.message }); }
});

app.get('/api/users', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM users ORDER BY registered_at DESC');
    res.json(r.rows);
  } catch(e) { res.json([]); }
});

// ─── УВЕДОМЛЕНИЯ ───

async function sendTG(chatId, text) {
  try {
    await bot.telegram.sendMessage(chatId, text, { parse_mode: 'HTML' });
  } catch(e) { console.log('TG error:', e.message); }
}

async function morningDigest() {
  const h = nowTZ().getHours();
  if (h !== 8) return;
  const today = todayStr();
  const users = await pool.query(
    'SELECT * FROM users WHERE morning_sent IS DISTINCT FROM $1::date',
    [new Date().toISOString().split('T')[0]]
  );
  for (const u of users.rows) {
    try {
      const tasks = await pool.query(
        `SELECT * FROM tasks WHERE user_id=$1 AND date=$2 AND status!='done' ORDER BY time`,
        [u.id, today]
      );
      let text = `🌅 <b>Доброе утро, шеф!</b>\n\n`;
      if (!tasks.rows.length) {
        text += `На сегодня задач нет.\n\nХорошего дня! 💪`;
      } else {
        text += `📅 План на <b>${today}</b>:\n\n`;
        const byVenue = {};
        tasks.rows.forEach(t => {
          byVenue[t.venue] = byVenue[t.venue] || [];
          byVenue[t.venue].push(t);
        });
        for (const v of Object.keys(byVenue)) {
          text += `📍 <b>${v}</b>\n`;
          byVenue[v].forEach(t => { text += `  🕐 ${t.time} — ${t.task}\n`; });
          text += '\n';
        }
        text += `🔥 Всего: ${tasks.rows.length} задач`;
      }
      await sendTG(u.id, text);
      await pool.query(
        'UPDATE users SET morning_sent=$1 WHERE id=$2',
        [new Date().toISOString().split('T')[0], u.id]
      );
    } catch(e) {}
  }
}

async function checkReminders() {
  const now = nowTZ();
  const h = now.getHours();
  const m = now.getMinutes();
  const totalMin = h * 60 + m;

  const tasks = await pool.query(
    `SELECT t.*, u.id as uid FROM tasks t
     JOIN users u ON u.id = t.user_id
     WHERE t.date=$1 AND t.status!='done' AND t.reminded=FALSE`,
    [todayStr()]
  );

  for (const task of tasks.rows) {
    if (!task.time || !task.time.includes(':')) continue;
    const [th, tm] = task.time.split(':').map(Number);
    const taskMin = th * 60 + tm;
    const diff = taskMin - totalMin;
    if (diff >= 28 && diff <= 32) {
      await sendTG(task.uid,
        `⏰ <b>Напоминание!</b>\n\n` +
        `📍 ${task.venue}\n` +
        `📝 ${task.task}\n` +
        `🕐 Через ~30 минут — в ${task.time}`
      );
      await pool.query('UPDATE tasks SET reminded=TRUE WHERE id=$1', [task.id]);
    }
  }
}

setInterval(async () => {
  try {
    await morningDigest();
    await checkReminders();
  } catch(e) { console.log('Scheduler error:', e.message); }
}, 5 * 60 * 1000);

// ─── ЗАПУСК ───

const PORT = process.env.PORT || 3000;
initDB().then(() => {
  app.listen(PORT, () => console.log(`✅ API запущен на порту ${PORT}`));
  bot.launch().then(() => console.log('✅ Бот запущен'));
  console.log('✅ Scheduler запущен');
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
