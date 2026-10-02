const $ = (s) => document.querySelector(s);
let pw = sessionStorage.getItem('wash_admin') || '';

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

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', 'x-admin-password': pw },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  return res.json();
}

async function onLogin(e) {
  e.preventDefault();
  pw = $('#admin-password').value;
  const data = await api('/api/login/admin', { method: 'POST', body: { password: pw } });
  if (!data.ok) { showToast(data.error, 'error'); return; }
  sessionStorage.setItem('wash_admin', pw);
  enterAdmin();
}

function enterAdmin() {
  $('#login-section').classList.add('hidden');
  $('#admin-section').classList.remove('hidden');
  poll();
}

function onLogout() {
  sessionStorage.removeItem('wash_admin');
  pw = '';
  location.reload();
}

const statusLabels = { available: 'ว่าง', busy: 'กำลังใช้งาน', maintenance: 'ปรับปรุง' };

async function poll() {
  if (!pw) return;
  try {
    const data = await api('/api/state');
    if (data.machines) renderMachines(data.machines);
  } catch (err) {}
  loadResidents();
}

function renderMachines(machines) {
  const grid = $('#machines-grid');
  grid.innerHTML = '';
  if (!machines.length) {
    grid.innerHTML = '<p class="muted">ยังไม่มีตู้ซักผ้าในระบบ เพิ่มตู้ซักผ้าได้ด้านล่าง</p>';
    return;
  }
  machines.forEach(m => {
    const card = document.createElement('div');
    card.className = 'machine-card ' + m.status;
    let bookingLine = '<div class="booking-info muted">ไม่มีรายการจอง</div>';
    if (m.booking) {
      bookingLine = `<div class="booking-info">ห้อง ${escapeHtml(m.booking.room)} (${escapeHtml(m.booking.name)}) · เหลือ <strong class="mini-count" data-end="${m.booking.endAt}"></strong></div>`;
    }
    card.innerHTML = `
      <div class="machine-head">
        <h3>${escapeHtml(m.name)}</h3>
        <span class="status-pill ${m.status}">${statusLabels[m.status]}</span>
      </div>
      ${bookingLine}
      <div class="btn-row">
        <button class="btn small" data-id="${m.id}" data-act="available" ${m.status === 'available' ? 'disabled' : ''}>ตั้งเป็นว่าง</button>
        <button class="btn small warn" data-id="${m.id}" data-act="busy" ${m.status === 'busy' || !m.booking ? 'disabled title="ตู้จะเป็นกำลังใช้งานเมื่อมีรายการจอง"' : ''}>ตั้งเป็นใช้งาน</button>
        <button class="btn small" data-id="${m.id}" data-act="maintenance" ${m.status === 'maintenance' ? 'disabled' : ''}>ปรับปรุง</button>
        <button class="btn small danger" data-id="${m.id}" data-act="delete">ลบตู้</button>
      </div>`;
    grid.appendChild(card);
  });
  grid.querySelectorAll('button[data-act]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const act = btn.dataset.act;
      if (act === 'delete') {
        if (!confirm('ต้องการลบตู้ซักผ้านี้หรือไม่?')) return;
        await api('/api/admin/machines/' + id, { method: 'DELETE' });
        showToast('ลบตู้ซักผ้าแล้ว', 'info');
      } else {
        const data = await api('/api/admin/machines/' + id, { method: 'PUT', body: { status: act } });
        if (data.ok) showToast('อัปเดตสถานะเป็น "' + statusLabels[act] + '" แล้ว', 'success');
        else showToast(data.error || 'อัปเดตสถานะไม่สำเร็จ', 'error');
      }
      poll();
    });
  });
  updateMiniCounts();
}

function updateMiniCounts() {
  document.querySelectorAll('.mini-count').forEach(el => {
    const ms = +el.dataset.end - Date.now();
    el.textContent = ms > 0 ? fmtCountdown(ms) : '00:00';
  });
}

async function loadResidents() {
  const data = await api('/api/admin/residents');
  if (!data.ok) return;
  const tbody = $('#residents-body');
  tbody.innerHTML = '';
  if (!data.residents.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="muted">ยังไม่มีลูกบ้านในระบบ เพิ่มลูกบ้านใหม่ได้ด้านบน</td></tr>';
    return;
  }
  data.residents.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(r.room)}</td>
      <td>${escapeHtml(r.name)}</td>
      <td>${escapeHtml(r.phone || '-')}</td>
      <td>${escapeHtml(r.code)}</td>
      <td><button class="btn small danger">ลบ</button></td>`;
    tr.querySelector('button').addEventListener('click', async () => {
      if (!confirm(`ลบลูกบ้านห้อง ${r.room} (${r.name}) ?`)) return;
      await api('/api/admin/residents/' + r.id, { method: 'DELETE' });
      showToast('ลบลูกบ้านเรียบร้อย', 'info');
      loadResidents();
    });
    tbody.appendChild(tr);
  });
}

async function init() {
  $('#login-form').addEventListener('submit', onLogin);
  $('#logout-btn').addEventListener('click', onLogout);
  $('#add-machine-form').addEventListener('submit', async e => {
    e.preventDefault();
    const name = $('#machine-name').value.trim();
    const data = await api('/api/admin/machines', { method: 'POST', body: { name } });
    if (data.ok) {
      $('#machine-name').value = '';
      showToast('เพิ่ม' + name + 'แล้ว', 'success');
      poll();
    } else {
      showToast(data.error, 'error');
    }
  });
  $('#add-resident-form').addEventListener('submit', async e => {
    e.preventDefault();
    const body = {
      name: $('#resident-name').value.trim(),
      room: $('#resident-room').value.trim(),
      phone: $('#resident-phone').value.trim(),
      code: $('#resident-code').value.trim()
    };
    const data = await api('/api/admin/residents', { method: 'POST', body });
    if (data.ok) {
      showToast(`เพิ่มลูกบ้านห้อง ${body.room} เรียบร้อย`, 'success');
      e.target.reset();
      loadResidents();
    } else {
      showToast(data.error, 'error');
    }
  });
  if (pw) {
    const data = await api('/api/login/admin', { method: 'POST', body: { password: pw } });
    if (data.ok) enterAdmin();
    else sessionStorage.removeItem('wash_admin');
  }
  setInterval(poll, 3000);
}

init();
