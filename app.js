// ─── Supabase config ─────────────────────────────────────────────────────────
const SUPABASE_URL = 'https://lwhkactwgccnfrvmyqgg.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx3aGthY3R3Z2NjbmZydm15cWdnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwNDI4OTcsImV4cCI6MjA5MTYxODg5N30._10D-G-q6ueCh6gH59zf8KfxdoZmP3yg478E4pakUSc';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── State ───────────────────────────────────────────────────────────────────
let state = { setup: false, balance: 0, entries: [] };
let modal = null;
let pendingImg = null;
let loading = false;
let imgPickerOpen = false;

// ─── Helpers ─────────────────────────────────────────────────────────────────
function fmt(n) {
  return new Intl.NumberFormat('vi-VN').format(Math.round(Math.abs(n))) + 'đ';
}

function timeStr(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: '2-digit' })
    + ' ' + d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

function showToast(msg, isError = false) {
  const t = document.createElement('div');
  t.style.cssText = `position:fixed;bottom:2rem;left:50%;transform:translateX(-50%);
    background:${isError ? '#d63b3b' : '#1a9e6e'};color:white;padding:10px 20px;
    border-radius:20px;font-size:14px;z-index:999;animation:fadeIn .2s ease`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

// ─── Load data ────────────────────────────────────────────────────────────────
async function loadData() {
  const [{ data: bal }, { data: entries }] = await Promise.all([
    sb.from('balance').select('amount, initialized').eq('id', 1).single(),
    sb.from('entries').select('*').order('ts', { ascending: false })
  ]);
  if (bal && bal.initialized) {
    state.setup = true;
    state.balance = bal.amount;
  }
  if (entries) state.entries = entries;
  render();
}

// ─── Compress ─────────────────────────────────────────────────────────────────
function compressImage(dataUrl, maxPx = 1200, quality = 0.75) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.src = dataUrl;
  });
}

// ─── Upload image ─────────────────────────────────────────────────────────────
async function uploadImage(dataUrl) {
  const blob = await (await fetch(dataUrl)).blob();
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
  const { error } = await sb.storage.from('images').upload(filename, blob, { contentType: 'image/jpeg' });
  if (error) throw error;
  const { data } = sb.storage.from('images').getPublicUrl(filename);
  return data.publicUrl;
}

// ─── Image picker: show menu chọn camera hay album ────────────────────────────
function openImgPicker() {
  imgPickerOpen = true;
  render();
}

function closeImgPicker() {
  imgPickerOpen = false;
  render();
}

function triggerCamera() {
  imgPickerOpen = false;
  const input = document.getElementById('img-camera');
  input.click();
}

function triggerAlbum() {
  imgPickerOpen = false;
  const input = document.getElementById('img-album');
  input.click();
}

async function handleImageFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async ev => {
    pendingImg = await compressImage(ev.target.result);
    render();
  };
  reader.readAsDataURL(file);
}

// ─── Actions ─────────────────────────────────────────────────────────────────
async function doSetup() {
  const val = parseFloat(document.getElementById('init').value) || 0;
  const { error } = await sb.from('balance').upsert({ id: 1, amount: val, initialized: true });
  if (error) { showToast('Lỗi kết nối Supabase', true); return; }
  state.setup = true;
  state.balance = val;
  render();
}

function openModal(type) { modal = type; pendingImg = null; imgPickerOpen = false; render(); }
function closeModal() { modal = null; pendingImg = null; imgPickerOpen = false; render(); }

async function doEntry(type) {
  const amtEl = document.getElementById('m-amt');
  const amt = parseFloat(amtEl?.value);
  if (!amt || amt <= 0) { amtEl.classList.add('error'); return; }
  const note = document.getElementById('m-note')?.value.trim();
  const ts = Date.now();
  const newBalance = state.balance + (type === 'income' ? amt : -amt);

  loading = true;
  render();

  try {
    let img_url = null;
    if (pendingImg) img_url = await uploadImage(pendingImg);

    const [{ data: inserted, error: e1 }, { error: e2 }] = await Promise.all([
      sb.from('entries').insert({ type, amount: amt, note, img_url, ts }).select().single(),
      sb.from('balance').upsert({ id: 1, amount: newBalance, initialized: true })
    ]);
    if (e1 || e2) throw new Error();

    state.entries.unshift(inserted);
    state.balance = newBalance;
    modal = null;
    pendingImg = null;
    showToast(type === 'income' ? '+' + fmt(amt) : '−' + fmt(amt));
  } catch {
    showToast('Lỗi, thử lại nhé', true);
  }

  loading = false;
  render();
}

async function deleteEntry(id, amount, type) {
  const newBalance = state.balance - (type === 'income' ? amount : -amount);
  const [{ error: e1 }, { error: e2 }] = await Promise.all([
    sb.from('entries').delete().eq('id', id),
    sb.from('balance').upsert({ id: 1, amount: newBalance, initialized: true })
  ]);
  if (e1 || e2) { showToast('Lỗi xoá', true); return; }
  state.entries = state.entries.filter(e => e.id !== id);
  state.balance = newBalance;
  render();
}

function viewImg(url) {
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;z-index:999;cursor:pointer';
  ov.innerHTML = `<img src="${url}" style="max-width:92%;max-height:92%;border-radius:12px">`;
  ov.onclick = () => ov.remove();
  document.body.appendChild(ov);
}

// ─── Render ──────────────────────────────────────────────────────────────────
function render() {
  const root = document.getElementById('root');

  if (!state.setup) {
    root.innerHTML = `
      <div class="setup">
        <div class="setup-emoji">💰</div>
        <h1>Số dư hiện tại</h1>
        <p>Nhập số tiền bạn đang có.<br>Âm nếu đang nợ, ví dụ: -500000</p>
        <input id="init" type="number" inputmode="decimal" placeholder="0" step="1000">
        <button onclick="doSetup()">Bắt đầu →</button>
      </div>`;
    setTimeout(() => document.getElementById('init')?.focus(), 50);
    return;
  }

  const pos = state.balance >= 0;

  let entriesHtml = state.entries.length === 0
    ? '<div class="empty">Chưa có giao dịch nào</div>'
    : state.entries.map(e => {
        const sign = e.type === 'income' ? '+' : '−';
        const imgHtml = e.img_url
          ? `<img class="thumb" src="${e.img_url}" onclick="viewImg('${e.img_url}')" alt="ảnh">`
          : '';
        return `
          <div class="entry">
            <div class="dot ${e.type}"></div>
            <div class="entry-body">
              <div class="entry-note">${e.note || '<span class="no-note">—</span>'}</div>
              <div class="entry-time">${timeStr(e.ts)}</div>
              ${imgHtml}
            </div>
            <div class="entry-amount ${e.type}">${sign}${fmt(e.amount)}</div>
            <button class="del-btn" onclick="deleteEntry('${e.id}',${e.amount},'${e.type}')">✕</button>
          </div>`;
      }).join('');

  // img picker menu
  const imgPickerMenu = imgPickerOpen ? `
    <div class="img-picker-overlay" onclick="closeImgPicker()">
      <div class="img-picker-menu" onclick="event.stopPropagation()">
        <button onclick="triggerCamera()">📷 Chụp ảnh</button>
        <div class="picker-divider"></div>
        <button onclick="triggerAlbum()">🖼️ Chọn từ thư viện</button>
        <div class="picker-divider"></div>
        <button class="picker-cancel" onclick="closeImgPicker()">Huỷ</button>
      </div>
    </div>` : '';

  let modalHtml = '';
  if (modal) {
    const isIncome = modal === 'income';
    const imgSection = pendingImg
      ? `<div class="img-preview-wrap">
           <img src="${pendingImg}" class="img-preview" alt="preview">
           <button class="img-remove" onclick="pendingImg=null;render()">✕</button>
         </div>`
      : `<button class="attach-btn" onclick="openImgPicker()">📎 Đính kèm ảnh</button>`;

    modalHtml = `
      <div class="overlay" onclick="if(event.target===this){closeModal()}">
        <div class="modal ${modal}">
          <div class="modal-header">
            <span class="modal-title">${isIncome ? '+ Thu tiền' : '− Chi tiền'}</span>
            <button class="close-btn" onclick="closeModal()">✕</button>
          </div>
          <input id="m-amt" class="big-input" type="number" inputmode="decimal"
                 placeholder="Số tiền..." step="1000" ${loading ? 'disabled' : ''}>
          <input id="m-note" class="note-input" type="text" placeholder="Nội dung..." ${loading ? 'disabled' : ''}>
          ${imgSection}
          <button class="confirm-btn ${modal}" onclick="doEntry('${modal}')" ${loading ? 'disabled style="opacity:.6"' : ''}>
            ${loading ? 'Đang lưu...' : (isIncome ? 'Cộng vào' : 'Trừ đi')}
          </button>
        </div>
      </div>
      ${imgPickerMenu}`;
  }

  root.innerHTML = `
    <div class="screen">
      <div class="balance-card">
        <div class="balance-label">Số dư</div>
        <div class="balance-amount ${pos ? 'pos' : 'neg'}">${pos ? '' : '−'}${fmt(state.balance)}</div>
      </div>
      <div class="action-row">
        <button class="action-btn income" onclick="openModal('income')">+ Thu</button>
        <button class="action-btn expense" onclick="openModal('expense')">− Chi</button>
      </div>
      <div class="entries-wrap">
        <div class="entries-label">Lịch sử</div>
        ${entriesHtml}
      </div>
    </div>
    ${modalHtml}`;

  if (modal && !loading) setTimeout(() => document.getElementById('m-amt')?.focus(), 50);
}

// ─── Image inputs ─────────────────────────────────────────────────────────────
document.getElementById('img-camera').addEventListener('change', async function () {
  await handleImageFile(this.files[0]);
  this.value = '';
});

document.getElementById('img-album').addEventListener('change', async function () {
  await handleImageFile(this.files[0]);
  this.value = '';
});

// ─── Keyboard shortcuts ───────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && modal && !loading) doEntry(modal);
  if (e.key === 'Escape' && modal) closeModal();
});

// ─── Service Worker ───────────────────────────────────────────────────────────
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js');

// ─── Init ─────────────────────────────────────────────────────────────────────
loadData();
