const $ = (s) => document.querySelector(s);
let me = null;
let curBooking = null;
let selectedMachine = null;

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function showToast(msg, type = 'info', duration = 3500) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast ' + type;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), duration);
}

function fmtCountdown(ms) {
  if (ms < 0) ms = 0;
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = n => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function playChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const notes = [880, 1108.73, 1318.51];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      o.connect(g);
      g.connect(ctx.destination);
      const t0 = ctx.currentTime + i * 0.25;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.45);
      o.start(t0);
      o.stop(t0 + 0.5);
    });
  } catch (e) {}
}

function notifyWashDone(machineName) {
  playChime();
  const banner = $('#done-banner');
  banner.innerHTML = `<div><strong>ซักผ้าเสร็จแล้ว!</strong> ${escapeHtml(machineName)} ซักเสร็จเรียบร้อย กรุณามารับผ้าของคุณ</div><button id="close-done" class="btn small">ปิด</button>`;
  banner.classList.remove('hidden');
  $('#close-done').onclick = () => banner.classList.add('hidden');
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification('ซักผ้าเสร็จแล้ว!', { body: `${machineName} ซักเสร็จเรียบร้อยแล้ว กรุณามารับผ้า` });
  }
  showToast('การซักผ้าเสร็จสิ้นแล้ว', 'success');
}

async function onLogin(e) {
  e.preventDefault();
  const room = $('#room').value.trim();
  const code = $('#code').value.trim();
  try {
    const res = await fetch('/api/login/resident', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room, code })
    });
    const data = await res.json();
    if (!data.ok) { showToast(data.error, 'error'); return; }
    me = { room: data.resident.room, name: data.resident.name, code };
    localStorage.setItem('wash_user', JSON.stringify(me));
    enterMain();
  } catch (err) {
    showToast('เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ', 'error');
  }
}

function enterMain() {
  $('#login-section').classList.add('hidden');
  $('#main-section').classList.remove('hidden');
  $('#welcome').textContent = `สวัสดี คุณ${me.name} (ห้อง ${me.room})`;
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
  poll();
}

function onLogout() {
  localStorage.removeItem('wash_user');
  location.reload();
}

async function poll() {
  if (!me) return;
  try {
    const res = await fetch(`/api/state?room=${encodeURIComponent(me.room)}&code=${encodeURIComponent(me.code)}`);
    const data = await res.json();
    renderMachines(data.machines);
    renderMyBooking(data.myBooking);
  } catch (err) {}
}

function renderMachines(machines) {
  const grid = $('#machines-grid');
  grid.innerHTML = '';
  const statusLabels = { available: 'ว่าง', busy: 'กำลังใช้งาน', maintenance: 'ปรับปรุง' };
  machines.forEach(m => {
    const card = document.createElement('div');
    card.className = 'machine-card ' + m.status;
    let inner = `
      <div class="machine-head">
        <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
          <rect x="4" y="2.5" width="16" height="19" rx="2.5"></rect>
          <circle cx="12" cy="13" r="5"></circle>
          <circle cx="12" cy="13" r="2.2"></circle>
          <path d="M7 5.5h3.5"></path>
          <path d="M16.5 5.2h.01"></path>
        </svg>
        <h3>${escapeHtml(m.name)}</h3>
      </div>
      <span class="status-pill ${m.status}">${statusLabels[m.status]}</span>`;
    if (m.booking) {
      const mine = m.booking.room === me.room;
      inner += `<div class="booking-info">${mine ? 'การจองของคุณกำลังทำงาน' : 'ห้อง ' + escapeHtml(m.booking.room) + ' กำลังใช้งาน'} · เหลือ <strong class="mini-count" data-end="${m.booking.endAt}"></strong></div>`;
    }
    if (m.status === 'available' && !m.booking) {
      inner += `<button class="btn primary book-btn" data-id="${m.id}" data-name="${escapeHtml(m.name)}">จองใช้งาน</button>`;
    }
    card.innerHTML = inner;
    grid.appendChild(card);
  });
  grid.querySelectorAll('.book-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedMachine = { id: btn.dataset.id, name: btn.dataset.name };
      $('#modal-machine-name').textContent = selectedMachine.name;
      $('#modal').classList.remove('hidden');
    });
  });
  updateMiniCounts();
}

function renderMyBooking(b) {
  curBooking = b;
  const card = $('#my-booking');
  if (!b || b.cancelled || (b.finished && localStorage.getItem('wash_notified_' + b.id) === '1')) {
    card.classList.add('hidden');
    return;
  }
  card.classList.remove('hidden');
  $('#booking-machine').textContent = b.machineName;
  $('#booking-room').textContent = 'ห้อง ' + me.room;
  if (b.finished) {
    if (localStorage.getItem('wash_notified_' + b.id) !== '1') {
      localStorage.setItem('wash_notified_' + b.id, '1');
      notifyWashDone(b.machineName);
    }
    card.classList.add('done');
    $('#booking-countdown').textContent = '00:00';
    $('#booking-progress').style.width = '100%';
    $('#cancel-booking').classList.add('hidden');
  } else {
    card.classList.remove('done');
    $('#cancel-booking').classList.remove('hidden');
    tickBooking();
  }
}

function tickBooking() {
  if (!curBooking || curBooking.finished || curBooking.cancelled) return;
  const now = Date.now();
  const remain = curBooking.endAt - now;
  $('#booking-countdown').textContent = fmtCountdown(remain);
  const total = curBooking.endAt - curBooking.startAt;
  const pct = total > 0 ? Math.min(100, Math.max(0, ((now - curBooking.startAt) / total) * 100)) : 100;
  $('#booking-progress').style.width = pct + '%';
}

function updateMiniCounts() {
  document.querySelectorAll('.mini-count').forEach(el => {
    const ms = +el.dataset.end - Date.now();
    el.textContent = ms > 0 ? fmtCountdown(ms) : '00:00';
  });
}

async function confirmBook() {
  if (!selectedMachine) return;
  const minutes = parseInt($('#duration').value, 10);
  try {
    const res = await fetch('/api/book', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ machineId: selectedMachine.id, room: me.room, code: me.code, minutes })
    });
    const data = await res.json();
    if (!data.ok) { showToast(data.error, 'error'); return; }
    $('#modal').classList.add('hidden');
    showToast(`จอง${selectedMachine.name}สำเร็จ เริ่มจับเวลา ${minutes} นาที`, 'success');
    poll();
  } catch (err) {
    showToast('เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ', 'error');
  }
}

async function cancelBooking() {
  if (!curBooking || curBooking.finished) return;
  if (!confirm('ต้องการยกเลิกการจองนี้หรือไม่?')) return;
  try {
    const res = await fetch('/api/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room: me.room, code: me.code, bookingId: curBooking.id })
    });
    const data = await res.json();
    if (data.ok) {
      localStorage.setItem('wash_notified_' + curBooking.id, '1');
      showToast('ยกเลิกการจองแล้ว', 'info');
      poll();
    } else {
      showToast(data.error, 'error');
    }
  } catch (err) {
    showToast('เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ', 'error');
  }
}

function init() {
  $('#login-form').addEventListener('submit', onLogin);
  $('#logout-btn').addEventListener('click', onLogout);
  $('#confirm-book').addEventListener('click', confirmBook);
  $('#close-modal').addEventListener('click', () => $('#modal').classList.add('hidden'));
  $('#cancel-booking').addEventListener('click', cancelBooking);
  const saved = localStorage.getItem('wash_user');
  if (saved) {
    try {
      me = JSON.parse(saved);
      enterMain();
    } catch (e) {
      localStorage.removeItem('wash_user');
    }
  }
  setInterval(poll, 3000);
  setInterval(updateMiniCounts, 1000);
  setInterval(tickBooking, 1000);
}

init();
