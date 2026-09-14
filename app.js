// ===== ここにGASのウェブアプリURLを貼る =====
const GAS_URL = 'YOUR_GAS_WEBAPP_URL';

// ===== 要素取得 =====
const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const preview = document.getElementById('preview');
const btnCapture = document.getElementById('btnCapture');
const btnScan = document.getElementById('btnScan');
const btnRetry = document.getElementById('btnRetry');
const btnSave = document.getElementById('btnSave');
const btnCancel = document.getElementById('btnCancel');
const btnAddItem = document.getElementById('btnAddItem');
const loading = document.getElementById('loading');
const editForm = document.getElementById('editForm');
const itemsContainer = document.getElementById('itemsContainer');
const status = document.getElementById('status');
const statusMsg = document.getElementById('statusMsg');
const searchInput = document.getElementById('searchInput');
const searchResults = document.getElementById('searchResults');

let imageBase64 = '';
let items = [];

// ===== タブ切り替え =====
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
  });
});

// ===== カメラ起動 =====
async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'environment',
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      }
    });
    video.srcObject = stream;
  } catch (err) {
    alert('カメラを起動できませんでした: ' + err.message);
  }
}

// ===== 撮影 =====
btnCapture.addEventListener('click', () => {
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0);

  const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
  imageBase64 = dataUrl.split(',')[1];

  preview.src = dataUrl;
  preview.style.display = 'block';
  video.style.display = 'none';
  btnCapture.style.display = 'none';
  btnScan.style.display = 'block';
  btnRetry.style.display = 'block';
  status.classList.remove('show');
  editForm.classList.remove('show');
});

// ===== 撮り直し =====
function resetCamera() {
  preview.style.display = 'none';
  video.style.display = 'block';
  btnCapture.style.display = 'block';
  btnScan.style.display = 'none';
  btnSave.style.display = 'none';
  btnRetry.style.display = 'none';
  editForm.classList.remove('show');
  status.classList.remove('show');
  imageBase64 = '';
  items = [];
  itemsContainer.innerHTML = '';
}

btnRetry.addEventListener('click', resetCamera);
btnCancel.addEventListener('click', resetCamera);

// ===== 明細UI =====
function emptyItem() {
  return { name: '', jan: '', quantity: 1, taxRate: 0.1, unitPrice: 0, tax: 0 };
}

function renderItems() {
  itemsContainer.innerHTML = items.map((item, index) => `
    <div class="item-card" data-index="${index}">
      <div class="item-card-header">
        <span>商品 ${index + 1}</span>
        <button type="button" class="btn btn-danger" data-remove="${index}">削除</button>
      </div>
      <div class="item-grid">
        <div class="form-group full">
          <label>商品名</label>
          <input type="text" data-field="name" data-index="${index}" value="${escapeAttr(item.name)}">
        </div>
        <div class="form-group full">
          <label>JANコード</label>
          <input type="text" data-field="jan" data-index="${index}" value="${escapeAttr(item.jan)}" inputmode="numeric">
        </div>
        <div class="form-group">
          <label>数量</label>
          <input type="number" data-field="quantity" data-index="${index}" value="${item.quantity}" step="1" min="0">
        </div>
        <div class="form-group">
          <label>消費税率</label>
          <input type="number" data-field="taxRate" data-index="${index}" value="${item.taxRate}" step="0.01" min="0">
        </div>
        <div class="form-group">
          <label>単価</label>
          <input type="number" data-field="unitPrice" data-index="${index}" value="${item.unitPrice}" step="1">
        </div>
        <div class="form-group">
          <label>消費税</label>
          <input type="number" data-field="tax" data-index="${index}" value="${item.tax}" step="1">
        </div>
      </div>
    </div>
  `).join('');
}

function escapeAttr(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function syncItemsFromDom() {
  itemsContainer.querySelectorAll('input[data-field]').forEach(input => {
    const index = Number(input.dataset.index);
    const field = input.dataset.field;
    if (!items[index]) return;
    if (field === 'name' || field === 'jan') {
      items[index][field] = input.value;
    } else {
      const n = Number(input.value);
      items[index][field] = isNaN(n) ? 0 : n;
    }
  });
}

itemsContainer.addEventListener('input', (e) => {
  const input = e.target;
  if (!input.dataset.field) return;
  const index = Number(input.dataset.index);
  const field = input.dataset.field;
  if (!items[index]) return;
  if (field === 'name' || field === 'jan') {
    items[index][field] = input.value;
  } else {
    const n = Number(input.value);
    items[index][field] = isNaN(n) ? 0 : n;
  }
});

itemsContainer.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-remove]');
  if (!btn) return;
  syncItemsFromDom();
  const index = Number(btn.dataset.remove);
  items.splice(index, 1);
  if (items.length === 0) items.push(emptyItem());
  renderItems();
});

btnAddItem.addEventListener('click', () => {
  syncItemsFromDom();
  items.push(emptyItem());
  renderItems();
});

function fillHeader(data) {
  document.getElementById('edit-date').value = data.date || '';
  document.getElementById('edit-time').value = (data.time || '').substring(0, 5);
  document.getElementById('edit-store').value = data.store || '';
  document.getElementById('edit-tNumber').value = data.tNumber || '';
}

function collectReceiptData() {
  syncItemsFromDom();
  return {
    date: document.getElementById('edit-date').value,
    time: document.getElementById('edit-time').value,
    store: document.getElementById('edit-store').value,
    tNumber: document.getElementById('edit-tNumber').value,
    items: items.map(item => ({
      name: item.name || '',
      jan: item.jan || '',
      quantity: Number(item.quantity) || 0,
      taxRate: item.taxRate === '' ? '' : Number(item.taxRate),
      unitPrice: Number(item.unitPrice) || 0,
      tax: Number(item.tax) || 0
    }))
  };
}

// ===== 読み取り =====
btnScan.addEventListener('click', async () => {
  if (!imageBase64) return;

  btnScan.style.display = 'none';
  btnRetry.style.display = 'none';
  loading.textContent = '処理中...レシートを読み取っています（JAN補完含む）';
  loading.classList.add('show');

  try {
    const response = await fetch(GAS_URL, {
      method: 'POST',
      body: JSON.stringify({ action: 'scan', image: imageBase64 }),
      redirect: 'follow'
    });

    const result = await response.json();
    loading.classList.remove('show');

    if (result.status === 'success') {
      fillHeader(result.data);
      items = (result.data.items || []).map(item => ({
        name: item.name || '',
        jan: item.jan || '',
        quantity: item.quantity != null ? item.quantity : 1,
        taxRate: item.taxRate != null ? item.taxRate : 0.1,
        unitPrice: item.unitPrice != null ? item.unitPrice : 0,
        tax: item.tax != null ? item.tax : 0
      }));
      if (items.length === 0) items.push(emptyItem());
      renderItems();
      editForm.classList.add('show');
      btnSave.style.display = 'block';
      btnRetry.style.display = 'block';
    } else {
      alert('読み取りエラー: ' + (result.message || '不明'));
      btnScan.style.display = 'block';
      btnRetry.style.display = 'block';
    }
  } catch (err) {
    loading.classList.remove('show');
    alert('通信エラー: ' + err.message);
    btnScan.style.display = 'block';
    btnRetry.style.display = 'block';
  }
});

// ===== 登録 =====
btnSave.addEventListener('click', async () => {
  const receiptData = collectReceiptData();
  if (!receiptData.items.some(i => i.name)) {
    alert('商品名が入力された明細が1件以上必要です');
    return;
  }

  btnSave.style.display = 'none';
  loading.textContent = '登録中...画像をDriveに保存しています';
  loading.classList.add('show');

  try {
    const response = await fetch(GAS_URL, {
      method: 'POST',
      body: JSON.stringify({
        action: 'save',
        data: receiptData,
        image: imageBase64
      }),
      redirect: 'follow'
    });

    const result = await response.json();
    loading.classList.remove('show');
    loading.textContent = '処理中...レシートを読み取っています';

    if (result.status === 'success') {
      editForm.classList.remove('show');
      statusMsg.textContent =
        (receiptData.store || '店舗不明') + ' / ' +
        (receiptData.date || '') + ' / ' +
        result.data.itemCount + '件登録\n' +
        (result.data.filename || '');
      status.classList.add('show');
      btnRetry.style.display = 'block';
    } else {
      alert('登録エラー: ' + (result.message || '不明'));
      btnSave.style.display = 'block';
    }
  } catch (err) {
    loading.classList.remove('show');
    loading.textContent = '処理中...レシートを読み取っています';
    editForm.classList.remove('show');
    statusMsg.textContent = '送信しました。シートとDriveを確認してください。';
    status.classList.add('show');
    btnRetry.style.display = 'block';
  }
});

// ===== 検索 =====
let searchTimer = null;
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    const query = searchInput.value.trim();
    if (query.length < 1) {
      searchResults.classList.remove('show');
      return;
    }

    try {
      const response = await fetch(GAS_URL, {
        method: 'POST',
        body: JSON.stringify({ action: 'search', query: query }),
        redirect: 'follow'
      });

      const result = await response.json();

      if (result.status === 'success' && result.data.length > 0) {
        searchResults.innerHTML = result.data.map(row => `
          <div class="search-card">
            <div class="search-card-name">${escapeHtml(row.name || '（商品名なし）')}</div>
            <div class="search-card-company">
              ${escapeHtml(row.store || '')}
              ${row.date ? ' / ' + escapeHtml(row.date) : ''}
              ${row.time ? ' ' + escapeHtml(row.time) : ''}
            </div>
            <div class="search-card-detail">
              ${row.jan ? 'JAN: ' + escapeHtml(row.jan) + '<br>' : ''}
              数量: ${escapeHtml(row.quantity)} /
              単価: ${escapeHtml(row.unitPrice)} /
              税率: ${escapeHtml(row.taxRate)} /
              税額: ${escapeHtml(row.tax)}
              ${row.driveUrl ? '<br><a href="' + escapeAttr(row.driveUrl) + '" target="_blank" rel="noopener">画像を開く</a>' : ''}
            </div>
          </div>
        `).join('');
        searchResults.classList.add('show');
      } else {
        searchResults.innerHTML = '<div class="search-card"><div class="search-card-name">該当なし</div></div>';
        searchResults.classList.add('show');
      }
    } catch (err) {
      // 検索エラーは静かに無視
    }
  }, 500);
});

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ===== 起動 =====
startCamera();
