// ===== サイトの設定（ここだけ書き換えればOK） =====
window.MAP_CONFIG = {
  // 管理用スプレッドシートのID（URLの /d/ と /edit の間の文字列）
  // 空のときは同じフォルダの stores.json を使います
  SHEET_ID: '1WV1anO6dmrOyg1wtzU-uoVtW2i-bbnvBp3xGBHh3R80',
  // 店舗一覧のシート（タブ）名
  SHEET_NAME: '店舗',

  // Google Maps のAPIキー（場所検索の精度アップ用・任意）
  // 必ず「HTTPリファラー：yukio0302.github.io/*」で制限した新しいキーを使ってください
  GOOGLE_MAPS_KEY: '',

  // Googleアナリティクス4 の測定ID（例：G-XXXXXXXXXX）。空なら計測しません
  GA_ID: '',

  // 検索範囲（km）
  RADIUS_KM: 10,
  WIDE_RADIUS_KM: 30,
};
