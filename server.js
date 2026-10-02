const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');
const ADMIN_PASSWORD = 'admin1234';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function loadDb() {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch (e) {
    return {
      machines: [
        { id: 'w1', name: 'ตู้ซักผ้า 1', status: 'available' },
        { id: 'w2', name: 'ตู้ซักผ้า 2', status: 'available' },
        { id: 'w3', name: 'ตู้ซักผ้า 3', status: 'available' }
      ],
      residents: [],
      bookings: []
    };
  }
}

let db = loadDb();

function saveDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function activeBooking(machineId) {
  return db.bookings.find(b => b.machineId === machineId && !b.finished && b.endAt > Date.now());
}

function finishExpired() {
  const now = Date.now();
  let changed = false;
  for (const b of db.bookings) {
    if (!b.finished && b.endAt <= now) {
      b.finished = true;
      changed = true;
    }
  }
  for (const m of db.machines) {
    if (m.status === 'busy' && !activeBooking(m.id)) {
      m.status = 'available';
      changed = true;
    }
  }
  if (changed) saveDb();
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise(resolve => {
    let data = '';
    req.on('data', c => { data += c; });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { resolve({}); }
    });
  });
}

function findResident(room, code) {
  return db.residents.find(r => r.room === String(room || '').trim() && r.code === String(code || '').trim());
}

function isAdmin(req) {
  return req.headers['x-admin-password'] === ADMIN_PASSWORD;
}

async function handleApi(req, res, p, u, body) {
  const method = req.method;

  if (method === 'POST' && p === '/api/login/admin') {
    if (body.password === ADMIN_PASSWORD) return sendJson(res, 200, { ok: true });
    return sendJson(res, 401, { ok: false, error: 'รหัสผ่านแอดมินไม่ถูกต้อง' });
  }

  if (method === 'POST' && p === '/api/login/resident') {
    const r = findResident(body.room, body.code);
    if (!r) return sendJson(res, 401, { ok: false, error: 'ไม่พบข้อมูลนี้ในระบบ กรุณาตรวจสอบเลขห้องและรหัสอีกครั้ง' });
    return sendJson(res, 200, { ok: true, resident: { id: r.id, name: r.name, room: r.room } });
  }

  if (method === 'GET' && p === '/api/state') {
    finishExpired();
    const now = Date.now();
    const machines = db.machines.map(m => {
      const b = activeBooking(m.id);
      return {
        id: m.id,
        name: m.name,
        status: b ? 'busy' : m.status,
        booking: b ? { id: b.id, room: b.room, name: b.name, startAt: b.startAt, endAt: b.endAt } : null
      };
    });
    let myBooking = null;
    const r = findResident(u.searchParams.get('room'), u.searchParams.get('code'));
    if (r) {
      const b = [...db.bookings].reverse().find(x => x.room === r.room && now - x.endAt < 10 * 60 * 1000);
      if (b) {
        const m = db.machines.find(m => m.id === b.machineId);
        myBooking = {
          id: b.id,
          machineId: b.machineId,
          machineName: m ? m.name : '',
          startAt: b.startAt,
          endAt: b.endAt,
          finished: !!b.finished,
          cancelled: !!b.cancelled
        };
      }
    }
    return sendJson(res, 200, { machines, myBooking, now });
  }

  if (method === 'POST' && p === '/api/book') {
    finishExpired();
    const r = findResident(body.room, body.code);
    if (!r) return sendJson(res, 401, { ok: false, error: 'กรุณาเข้าสู่ระบบอีกครั้ง' });
    const m = db.machines.find(m => m.id === body.machineId);
    if (!m) return sendJson(res, 404, { ok: false, error: 'ไม่พบตู้ซักผ้านี้' });
    if (activeBooking(m.id)) return sendJson(res, 400, { ok: false, error: 'ตู้นี้มีผู้ใช้งานอยู่' });
    if (m.status !== 'available') return sendJson(res, 400, { ok: false, error: 'ตู้นี้ไม่พร้อมใช้งาน' });
    const mine = db.bookings.find(b => !b.finished && b.room === r.room && b.endAt > Date.now());
    if (mine) return sendJson(res, 400, { ok: false, error: 'คุณมีรายการจองที่ยังไม่จบ ไม่สามารถจองเพิ่มได้' });
    const minutes = Math.min(180, Math.max(10, parseInt(body.minutes, 10) || 60));
    const booking = {
      id: 'b' + Date.now(),
      machineId: m.id,
      room: r.room,
      name: r.name,
      startAt: Date.now(),
      endAt: Date.now() + minutes * 60000,
      finished: false,
      cancelled: false
    };
    db.bookings.push(booking);
    m.status = 'busy';
    saveDb();
    return sendJson(res, 200, { ok: true, booking });
  }

  if (method === 'POST' && p === '/api/cancel') {
    const r = findResident(body.room, body.code);
    if (!r) return sendJson(res, 401, { ok: false, error: 'กรุณาเข้าสู่ระบบอีกครั้ง' });
    const b = db.bookings.find(x => x.id === body.bookingId && x.room === r.room && !x.finished);
    if (!b) return sendJson(res, 404, { ok: false, error: 'ไม่พบรายการจองนี้' });
    b.finished = true;
    b.cancelled = true;
    const m = db.machines.find(m => m.id === b.machineId);
    if (m && m.status === 'busy') m.status = 'available';
    saveDb();
    return sendJson(res, 200, { ok: true });
  }

  if (p.startsWith('/api/admin/')) {
    if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'ไม่ได้รับอนุญาต' });

    if (method === 'POST' && p === '/api/admin/machines') {
      const name = String(body.name || '').trim();
      if (!name) return sendJson(res, 400, { ok: false, error: 'กรุณากรอกชื่อตู้ซักผ้า' });
      const machine = { id: 'w' + Date.now(), name, status: 'available' };
      db.machines.push(machine);
      saveDb();
      return sendJson(res, 200, { ok: true, machine });
    }

    let match = p.match(/^\/api\/admin\/machines\/([^/]+)$/);
    if (match) {
      const m = db.machines.find(x => x.id === match[1]);
      if (!m) return sendJson(res, 404, { ok: false, error: 'ไม่พบตู้ซักผ้านี้' });
      if (method === 'PUT') {
        if (body.name) m.name = String(body.name).trim();
        if (['available', 'busy', 'maintenance'].includes(body.status)) {
          if (body.status === 'busy' && !activeBooking(m.id)) {
            return sendJson(res, 400, { ok: false, error: 'ตู้จะแสดงเป็น "กำลังใช้งาน" เมื่อมีรายการจองเท่านั้น (ใช้ปุ่มปรับปรุงเพื่อปิดตู้ชั่วคราว)' });
          }
          m.status = body.status;
          if (body.status !== 'busy') {
            db.bookings.forEach(b => {
              if (b.machineId === m.id && !b.finished) {
                b.finished = true;
                b.cancelled = true;
              }
            });
          }
        }
        saveDb();
        return sendJson(res, 200, { ok: true });
      }
      if (method === 'DELETE') {
        db.machines = db.machines.filter(x => x.id !== m.id);
        db.bookings.forEach(b => {
          if (b.machineId === m.id && !b.finished) { b.finished = true; b.cancelled = true; }
        });
        saveDb();
        return sendJson(res, 200, { ok: true });
      }
    }

    if (method === 'GET' && p === '/api/admin/residents') {
      return sendJson(res, 200, { ok: true, residents: db.residents });
    }

    if (method === 'POST' && p === '/api/admin/residents') {
      const name = String(body.name || '').trim();
      const room = String(body.room || '').trim();
      const phone = String(body.phone || '').trim();
      const code = String(body.code || '').trim();
      if (!name || !room || !code) return sendJson(res, 400, { ok: false, error: 'กรุณากรอกชื่อ เลขห้อง และรหัสเข้าใช้งานให้ครบ' });
      if (db.residents.some(r => r.room === room)) return sendJson(res, 400, { ok: false, error: 'ห้องนี้มีอยู่ในระบบแล้ว' });
      const resident = { id: 'r' + Date.now(), name, room, phone, code };
      db.residents.push(resident);
      saveDb();
      return sendJson(res, 200, { ok: true, resident });
    }

    match = p.match(/^\/api\/admin\/residents\/([^/]+)$/);
    if (match && method === 'DELETE') {
      db.residents = db.residents.filter(r => r.id !== match[1]);
      saveDb();
      return sendJson(res, 200, { ok: true });
    }

    return sendJson(res, 404, { ok: false, error: 'ไม่พบเส้นทาง API' });
  }

  return sendJson(res, 404, { ok: false, error: 'ไม่พบเส้นทาง API' });
}

function serveStatic(req, res, p) {
  if (p === '/') p = '/index.html';
  const filePath = path.join(PUBLIC_DIR, path.normalize(p));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 Not Found');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://localhost');
    const p = u.pathname;
    if (p.startsWith('/api/')) {
      const body = await readBody(req);
      return await handleApi(req, res, p, u, body);
    }
    return serveStatic(req, res, p);
  } catch (e) {
    sendJson(res, 500, { ok: false, error: 'เกิดข้อผิดพลาดในเซิร์ฟเวอร์' });
  }
});

function start(port) {
  server.once('error', err => {
    if (err.code === 'EADDRINUSE') {
      console.log('พอร์ต ' + port + ' ถูกใช้งานอยู่ กำลังสลับไปพอร์ต ' + (port + 1));
      start(port + 1);
    } else {
      throw err;
    }
  });
  server.listen(port, () => {
    console.log('ระบบจองซักผ้าคอนโด ทำงานที่ http://localhost:' + port);
  });
}

start(PORT);
