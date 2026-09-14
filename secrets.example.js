// このファイルをコピーして secrets.js を作り、実値を入れる
//   copy secrets.example.js secrets.js
// secrets.js は .gitignore 済み（push されない）
//
// GAS の CONFIG.API_TOKEN と API_TOKEN は必ず同じ値にする

window.RECEIPT_OCR = {
  GAS_URL: 'https://script.google.com/macros/s/XXXX/exec',
  // 例: 長いランダム文字列（英数字32文字以上推奨）
  API_TOKEN: 'change-me-to-a-long-random-string'
};
