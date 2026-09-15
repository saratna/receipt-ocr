// ===== 設定 =====
const CONFIG = {
  VISION_API_KEY: 'YOUR_API_KEY',
  GEMINI_API_KEY: 'YOUR_API_KEY',
  // 新規キーでは gemini-2.5-flash 不可。最新の Flash 系を指定
  GEMINI_MODEL: 'gemini-3.6-flash',
  SPREADSHEET_ID: 'YOUR_SPREADSHEET_ID',
  SHEET_NAME: 'レシートDB',
  DRIVE_FOLDER_ID: 'YOUR_DRIVE_FOLDER_ID',
  // フロントの secrets.js と同じ長いランダム文字列にする（GitHub に実値を上げない）
  API_TOKEN: 'YOUR_API_TOKEN'
};

// ===== リクエスト受信 =====
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    if (!isValidToken(data.token)) {
      return jsonResponse({ status: 'error', message: 'Unauthorized' });
    }

    const action = data.action || 'scan';

    if (action === 'scan') {
      return handleScan(data.image);
    } else if (action === 'save') {
      return handleSave(data.data, data.image);
    } else if (action === 'search') {
      return handleSearch(data.query);
    } else {
      return jsonResponse({ status: 'error', message: 'Unknown action: ' + action });
    }
  } catch (error) {
    return jsonResponse({ status: 'error', message: error.toString() });
  }
}

function doGet(e) {
  // 生存確認のみ（データ操作なし）。トークン不要。
  return jsonResponse({ status: 'ok' });
}

function isValidToken(token) {
  const expected = CONFIG.API_TOKEN;
  if (!expected || expected === 'YOUR_API_TOKEN') {
    return false;
  }
  return token === expected;
}

// ===== スキャン（OCR + Gemini → 編集用データ） =====
function handleScan(imageBase64) {
  const ocrText = callVisionAPI(imageBase64);
  const receiptData = callGeminiAPI(imageBase64, ocrText);
  receiptData.items = fillMissingJanCodes(receiptData.items || [], imageBase64, receiptData.store || '');
  return jsonResponse({ status: 'success', data: receiptData });
}

// ===== 保存（Drive + Sheets 明細行） =====
function handleSave(receiptData, imageBase64) {
  if (!receiptData || !receiptData.items || receiptData.items.length === 0) {
    return jsonResponse({ status: 'error', message: '商品明細がありません' });
  }

  const fileInfo = saveImageToDrive(imageBase64, receiptData);
  writeItemsToSheet(receiptData, fileInfo);

  return jsonResponse({
    status: 'success',
    data: {
      store: receiptData.store || '',
      date: receiptData.date || '',
      itemCount: receiptData.items.length,
      filename: fileInfo.filename,
      driveUrl: fileInfo.driveUrl
    }
  });
}

// ===== 検索 =====
function handleSearch(query) {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return jsonResponse({ status: 'success', data: [] });
  }

  const dataRange = sheet.getRange(2, 1, lastRow - 1, 13).getValues();
  const queryLower = String(query).toLowerCase();

  const results = dataRange
    .filter(row => {
      const searchTarget = [
        row[1],  // レシート日付
        row[2],  // レシート時間
        row[3],  // 店舗
        row[4],  // T番号
        row[5],  // 商品名
        row[6],  // JAN
        row[11]  // ファイル名
      ].join(' ').toLowerCase();
      return searchTarget.indexOf(queryLower) !== -1;
    })
    .slice(0, 20)
    .map(row => ({
      date: row[1],
      time: row[2],
      store: row[3],
      tNumber: row[4],
      name: row[5],
      jan: row[6],
      quantity: row[7],
      taxRate: row[8],
      unitPrice: row[9],
      tax: row[10],
      filename: row[11],
      driveUrl: row[12]
    }));

  return jsonResponse({ status: 'success', data: results });
}

// ===== Cloud Vision API =====
function callVisionAPI(imageBase64) {
  const url = 'https://vision.googleapis.com/v1/images:annotate?key=' + CONFIG.VISION_API_KEY;

  const requestBody = {
    requests: [{
      image: { content: imageBase64 },
      features: [
        { type: 'TEXT_DETECTION' },
        { type: 'DOCUMENT_TEXT_DETECTION' }
      ]
    }]
  };

  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(requestBody)
  });

  const result = JSON.parse(response.getContentText());

  if (result.responses && result.responses[0] && result.responses[0].fullTextAnnotation) {
    return result.responses[0].fullTextAnnotation.text;
  }
  return '';
}

// ===== Gemini API（レシート構造化） =====
function geminiUrl() {
  return 'https://generativelanguage.googleapis.com/v1beta/models/' +
    CONFIG.GEMINI_MODEL + ':generateContent?key=' + CONFIG.GEMINI_API_KEY;
}

function geminiFetch(requestBody) {
  const response = UrlFetchApp.fetch(geminiUrl(), {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(requestBody),
    muteHttpExceptions: true
  });
  const code = response.getResponseCode();
  const body = response.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error(
      'Geminiエラー HTTP ' + code +
      ' / モデル=' + CONFIG.GEMINI_MODEL +
      ' / ' + body.substring(0, 300)
    );
  }
  return JSON.parse(body);
}

function callGeminiAPI(imageBase64, ocrText) {
  const prompt = `あなたは日本のレシートデータ抽出の専門家です。
以下のOCRテキストとレシート画像から、正確に情報を抽出してください。
OCRの読み取りミスがあれば文脈から補正してください。

【OCRテキスト】
${ocrText}

【抽出ルール】
- date は yyyy-MM-dd 形式
- time は HH:mm 形式（秒は省略）
- tNumber は適格請求書発行事業者登録番号（T + 13桁）。なければ空文字
- items は購入商品のみ（小計・合計・釣銭・ポイント・支払方法は除外）
- taxRate は 0.1（10%）または 0.08（8%）など小数。不明なら空文字
- unitPrice は税抜単価が分かる場合は税抜、分からなければレシート表記の単価
- tax は当該商品の消費税額。分からなければ空文字または 0
- jan はレシートに印字された JAN/バーコード（8桁または13桁の数字）。なければ空文字
- 数量・金額は数値（文字列ではなく number）

【出力形式】必ず以下のJSON形式のみで返してください。余計な説明は不要です。
{
  "date": "yyyy-MM-dd",
  "time": "HH:mm",
  "store": "店舗名または会社名",
  "tNumber": "T1234567890123",
  "items": [
    {
      "name": "商品名",
      "jan": "4901234567890",
      "quantity": 1,
      "taxRate": 0.1,
      "unitPrice": 100,
      "tax": 10
    }
  ]
}

該当情報がない項目は空文字（数値項目は 0）にしてください。`;

  const requestBody = {
    contents: [{
      parts: [
        { text: prompt },
        {
          inline_data: {
            mime_type: 'image/jpeg',
            data: imageBase64
          }
        }
      ]
    }],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json'
    }
  };

  const result = geminiFetch(requestBody);
  const text = result.candidates[0].content.parts[0].text;
  const parsed = JSON.parse(text);

  if (!parsed.items || !Array.isArray(parsed.items)) {
    parsed.items = [];
  }

  parsed.items = parsed.items.map(normalizeItem);
  return parsed;
}

function normalizeItem(item) {
  return {
    name: item.name || '',
    jan: normalizeJan(item.jan),
    quantity: toNumber(item.quantity, 1),
    taxRate: toNumber(item.taxRate, ''),
    unitPrice: toNumber(item.unitPrice, 0),
    tax: toNumber(item.tax, 0)
  };
}

function toNumber(value, fallback) {
  if (value === '' || value === null || value === undefined) return fallback;
  const n = Number(value);
  return isNaN(n) ? fallback : n;
}

function normalizeJan(value) {
  if (!value) return '';
  const digits = String(value).replace(/[^0-9]/g, '');
  if (digits.length === 8 || digits.length === 13) return digits;
  return '';
}

// ===== JAN補完（商品名検索 → 画像から再抽出） =====
function fillMissingJanCodes(items, imageBase64, store) {
  const missingIndexes = [];
  items.forEach((item, idx) => {
    if (!normalizeJan(item.jan) && item.name) {
      missingIndexes.push(idx);
    }
  });

  if (missingIndexes.length === 0) return items;

  // 1) 商品名から JAN を探す
  const nameLookups = lookupJanByProductNames(
    missingIndexes.map(i => ({ index: i, name: items[i].name, store: store }))
  );

  nameLookups.forEach(entry => {
    const jan = normalizeJan(entry.jan);
    if (jan && items[entry.index]) {
      items[entry.index].jan = jan;
    }
  });

  // 2) まだ無いものは画像から再抽出
  const stillMissing = [];
  missingIndexes.forEach(idx => {
    if (!normalizeJan(items[idx].jan)) {
      stillMissing.push({ index: idx, name: items[idx].name });
    }
  });

  if (stillMissing.length > 0) {
    const imageLookups = lookupJanFromImage(stillMissing, imageBase64);
    imageLookups.forEach(entry => {
      const jan = normalizeJan(entry.jan);
      if (jan && items[entry.index]) {
        items[entry.index].jan = jan;
      }
    });
  }

  return items;
}

function lookupJanByProductNames(targets) {
  if (!targets.length) return [];

  const list = targets.map((t, i) => `${i + 1}. 店舗: ${t.store || ''} / 商品名: ${t.name}`).join('\n');

  const prompt = `あなたは日本の商品マスタ（JANコード）に詳しいアシスタントです。
以下の商品について、一般に流通している JANコード（8桁または13桁）が分かる場合のみ返してください。
確信度が低い場合は空文字にしてください。推測で適当な数字を作らないでください。

【商品リスト】
${list}

【出力形式】JSON配列のみ
[
  {"index": 1, "jan": "4901234567890"},
  {"index": 2, "jan": ""}
]`;

  const requestBody = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json'
    }
  };

  try {
    const result = geminiFetch(requestBody);
    const text = result.candidates[0].content.parts[0].text;
    const arr = JSON.parse(text);
    return arr.map(item => ({
      index: targets[item.index - 1] ? targets[item.index - 1].index : -1,
      jan: item.jan || ''
    })).filter(x => x.index >= 0);
  } catch (e) {
    return [];
  }
}

function lookupJanFromImage(targets, imageBase64) {
  if (!targets.length || !imageBase64) return [];

  const list = targets.map((t, i) => `${i + 1}. ${t.name}`).join('\n');

  const prompt = `レシート画像とOCR付近の情報から、指定商品の JANコード（バーコード数字 8桁/13桁）を読み取ってください。
商品名の近く・下・横に印字された数字列を優先してください。
読めない場合は空文字。数字を捏造しないでください。

【対象商品】
${list}

【出力形式】JSON配列のみ
[
  {"index": 1, "jan": "4901234567890"},
  {"index": 2, "jan": ""}
]`;

  const requestBody = {
    contents: [{
      parts: [
        { text: prompt },
        {
          inline_data: {
            mime_type: 'image/jpeg',
            data: imageBase64
          }
        }
      ]
    }],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json'
    }
  };

  try {
    const result = geminiFetch(requestBody);
    const text = result.candidates[0].content.parts[0].text;
    const arr = JSON.parse(text);
    return arr.map(item => ({
      index: targets[item.index - 1] ? targets[item.index - 1].index : -1,
      jan: item.jan || ''
    })).filter(x => x.index >= 0);
  } catch (e) {
    return [];
  }
}

// ===== Drive に画像保存 =====
function saveImageToDrive(imageBase64, receiptData) {
  const now = new Date();
  const stamp = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyyMMdd_HHmmss');
  const storeSafe = String(receiptData.store || 'receipt')
    .replace(/[\\/:*?"<>|]/g, '_')
    .substring(0, 30);
  const filename = 'receipt_' + stamp + '_' + storeSafe + '.jpg';

  const blob = Utilities.newBlob(
    Utilities.base64Decode(imageBase64),
    'image/jpeg',
    filename
  );

  const folder = DriveApp.getFolderById(CONFIG.DRIVE_FOLDER_ID);
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  return {
    filename: filename,
    driveUrl: file.getUrl(),
    fileId: file.getId()
  };
}

// ===== Sheets 書き込み（商品1行ずつ） =====
function writeItemsToSheet(receiptData, fileInfo) {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.SHEET_NAME);

  const now = new Date();
  const timestamp = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
  const date = receiptData.date || '';
  const time = receiptData.time || '';
  const store = receiptData.store || '';
  const tNumber = receiptData.tNumber || '';
  const filename = fileInfo.filename || '';
  const driveUrl = fileInfo.driveUrl || '';

  const rows = (receiptData.items || []).map(item => {
    const normalized = normalizeItem(item);
    return [
      timestamp,
      date,
      time,
      store,
      tNumber,
      normalized.name,
      normalized.jan,
      normalized.quantity,
      normalized.taxRate === '' ? '' : normalized.taxRate,
      normalized.unitPrice,
      normalized.tax,
      filename,
      driveUrl
    ];
  });

  if (rows.length === 0) return;

  const startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, rows.length, 13).setValues(rows);
}

// ===== JSON レスポンス =====
function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ===== シート初期化（ヘッダー作成） =====
function setupSheetHeaders() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  let sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_NAME);
  }

  const headers = [
    '登録日時',
    'レシート日付',
    'レシート時間',
    '店舗',
    'T番号',
    '商品名',
    'JANコード',
    '数量',
    '消費税率',
    '単価',
    '消費税',
    'レシートファイル名',
    'Drive URL'
  ];

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  Logger.log('ヘッダー設定完了: ' + CONFIG.SHEET_NAME);
}

// ===== 接続テスト =====
function testSetup() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  Logger.log('シート接続OK: ' + sheet.getName());
  Logger.log('現在の行数: ' + sheet.getLastRow());

  const folder = DriveApp.getFolderById(CONFIG.DRIVE_FOLDER_ID);
  Logger.log('DriveフォルダOK: ' + folder.getName());
}

// ===== Geminiモデル確認（Apps Scriptでこの関数を実行） =====
function testGeminiModel() {
  Logger.log('CONFIG.GEMINI_MODEL = ' + CONFIG.GEMINI_MODEL);

  const listUrl = 'https://generativelanguage.googleapis.com/v1beta/models?key=' + CONFIG.GEMINI_API_KEY;
  const listRes = UrlFetchApp.fetch(listUrl, { muteHttpExceptions: true });
  Logger.log('モデル一覧 HTTP ' + listRes.getResponseCode());
  const listBody = listRes.getContentText();
  Logger.log(listBody.substring(0, 1500));

  const ping = {
    contents: [{ parts: [{ text: 'Reply with OK only.' }] }]
  };
  const res = UrlFetchApp.fetch(geminiUrl(), {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(ping),
    muteHttpExceptions: true
  });
  Logger.log('generateContent HTTP ' + res.getResponseCode());
  Logger.log(res.getContentText().substring(0, 800));
}
