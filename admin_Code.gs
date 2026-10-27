/**
 * 立春朝搾り 取扱店マップ 管理用スクリプト
 * 使い方：管理用スプレッドシート →「拡張機能」→「Apps Script」に、このコードを全部貼り付けて保存。
 * スプレッドシートを開き直すと、メニューに「立春マップ管理」が出ます。
 */

// ===== 設定 =====
const SITE_URL = 'https://yukio0302.github.io/risshun-map/';   // 公開サイトのURL
const SHEET_STORES = '店舗';
const SHEET_SUMMARY = '集計';
const HEADERS = ['店舗ID', '表示', '店名', '銘柄', '住所', '緯度', '経度', '詳細URL', 'メモ（サイトには出ません）'];
const COL = { id: 1, show: 2, name: 3, brand: 4, addr: 5, lat: 6, lon: 7, url: 8, memo: 9 };

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('立春マップ管理')
    .addItem('① 住所から緯度・経度を入れる', 'fillLatLng')
    .addItem('② 入力チェック', 'checkRows')
    .addItem('③ 集計を更新', 'buildSummary')
    .addSeparator()
    .addItem('サイトを開く', 'openSite')
    .addSeparator()
    .addItem('（最初だけ）シートの準備と店舗データの取り込み', 'setupAndImport')
    .addToUi();
}

/** 最初の1回だけ：見出しを作り、公開サイトの stores.json から 847 店を取り込む */
function setupAndImport() {
  const ss = SpreadsheetApp.getActive();
  const ui = SpreadsheetApp.getUi();
  let sh = ss.getSheetByName(SHEET_STORES);
  if (!sh) {
    sh = ss.getSheets()[0];
    sh.setName(SHEET_STORES);
  }
  if (sh.getLastRow() > 1) {
    const ok = ui.alert('すでにデータがあります', '「店舗」シートの中身を消して取り込み直しますか？', ui.ButtonSet.YES_NO);
    if (ok !== ui.Button.YES) return;
    sh.clear();
  }
  const res = UrlFetchApp.fetch(SITE_URL + 'stores.json?_=' + Date.now(), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) {
    ui.alert('取り込めませんでした', 'サイトの stores.json を読めませんでした（' + res.getResponseCode() + '）。SITE_URL を確認してください。', ui.ButtonSet.OK);
    return;
  }
  const data = JSON.parse(res.getContentText());
  const rows = data.map(function (s) {
    return [s.u, '○', s.n, s.b.join('、'), '', s.la, s.lo, '', ''];
  });
  sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  sh.getRange(2, 1, rows.length, HEADERS.length).setValues(rows);
  formatStoresSheet_(sh);
  buildSummary();
  ui.alert('取り込み完了', rows.length + ' 店を取り込みました。', ui.ButtonSet.OK);
}

function formatStoresSheet_(sh) {
  sh.setFrozenRows(1);
  const head = sh.getRange(1, 1, 1, HEADERS.length);
  head.setFontWeight('bold').setBackground('#c8161d').setFontColor('#ffffff');
  sh.setColumnWidth(COL.id, 70);
  sh.setColumnWidth(COL.show, 50);
  sh.setColumnWidth(COL.name, 280);
  sh.setColumnWidth(COL.brand, 160);
  sh.setColumnWidth(COL.addr, 260);
  sh.setColumnWidth(COL.lat, 95);
  sh.setColumnWidth(COL.lon, 95);
  sh.setColumnWidth(COL.url, 200);
  sh.setColumnWidth(COL.memo, 220);
  const max = Math.max(sh.getMaxRows() - 1, 1);
  const rule = SpreadsheetApp.newDataValidation().requireValueInList(['○', ''], true).setAllowInvalid(true).build();
  sh.getRange(2, COL.show, max, 1).setDataValidation(rule).setHorizontalAlignment('center');
  sh.getRange(2, COL.lat, max, 2).setNumberFormat('0.000000');
  sh.getRange(1, COL.id).setNote('名門酒会サイトの店舗番号（sid）。空欄でもOK（その場合「お店の詳細」ボタンは詳細URLがあるときだけ出ます）');
  sh.getRange(1, COL.show).setNote('○ の店だけ地図に出ます。取り扱いをやめた店は空欄に');
  sh.getRange(1, COL.brand).setNote('複数あるときは「、」で区切る（例：開華、甲子）');
  sh.getRange(1, COL.addr).setNote('住所を入れて、メニュー①を押すと緯度・経度が自動で入ります');
  sh.getRange(1, COL.url).setNote('名門酒会サイト以外の詳細ページを使うときだけ入力');
  sh.getRange(1, COL.memo).setNote('この列はサイトに出ません（社内メモ用）。ただしシートを「リンクを知っている全員」に公開している場合は、リンクを知る人なら見られます');
}

/** 住所はあるのに緯度・経度が空の行を埋める */
function fillLatLng() {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_STORES);
  const last = sh.getLastRow();
  if (last < 2) return;
  const values = sh.getRange(2, 1, last - 1, HEADERS.length).getValues();
  const geocoder = Maps.newGeocoder().setLanguage('ja').setRegion('jp');
  let done = 0, failed = [];
  values.forEach(function (r, i) {
    const addr = String(r[COL.addr - 1]).trim();
    if (!addr || (r[COL.lat - 1] !== '' && r[COL.lon - 1] !== '')) return;
    const g = geocoder.geocode(addr);
    if (g.status === 'OK' && g.results.length) {
      const loc = g.results[0].geometry.location;
      sh.getRange(i + 2, COL.lat, 1, 2).setValues([[loc.lat, loc.lng]]);
      done++;
      Utilities.sleep(150);
    } else {
      failed.push((i + 2) + '行目：' + addr);
    }
  });
  SpreadsheetApp.getUi().alert('緯度・経度の入力',
    done + ' 件入れました。' + (failed.length ? '\n\n見つからなかった住所：\n' + failed.join('\n') : ''),
    SpreadsheetApp.getUi().ButtonSet.OK);
}

/** 抜け・おかしな値に色を付ける */
function checkRows() {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_STORES);
  const last = sh.getLastRow();
  if (last < 2) return;
  const range = sh.getRange(2, 1, last - 1, HEADERS.length);
  const values = range.getValues();
  const bg = values.map(function () { return HEADERS.map(function () { return null; }); });
  const problems = [];
  const seen = {};
  values.forEach(function (r, i) {
    const row = i + 2, msgs = [];
    if (String(r[COL.show - 1]).trim() !== '○') return; // 非表示の行は見ない
    if (!String(r[COL.name - 1]).trim()) { msgs.push('店名が空'); bg[i][COL.name - 1] = '#fde2e2'; }
    if (!String(r[COL.brand - 1]).trim()) { msgs.push('銘柄が空'); bg[i][COL.brand - 1] = '#fde2e2'; }
    const la = Number(r[COL.lat - 1]), lo = Number(r[COL.lon - 1]);
    if (r[COL.lat - 1] === '' || r[COL.lon - 1] === '' || !(la > 20 && la < 46 && lo > 122 && lo < 154)) {
      msgs.push('緯度・経度が空か日本の外'); bg[i][COL.lat - 1] = '#fde2e2'; bg[i][COL.lon - 1] = '#fde2e2';
    }
    const id = String(r[COL.id - 1]).trim();
    if (id) {
      if (seen[id]) { msgs.push('店舗IDが ' + seen[id] + '行目と重複'); bg[i][COL.id - 1] = '#fff1c2'; }
      seen[id] = row;
    }
    if (msgs.length) problems.push(row + '行目：' + msgs.join('、'));
  });
  range.setBackgrounds(bg);
  SpreadsheetApp.getUi().alert('入力チェック',
    problems.length ? problems.length + ' 件の要確認があります（色を付けました）\n\n' + problems.slice(0, 30).join('\n') + (problems.length > 30 ? '\n…ほか' : '')
                    : '問題は見つかりませんでした。',
    SpreadsheetApp.getUi().ButtonSet.OK);
}

/** 集計シート：銘柄ごとの店舗数など */
function buildSummary() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(SHEET_SUMMARY);
  if (!sh) sh = ss.insertSheet(SHEET_SUMMARY);
  sh.clear();
  sh.getRange('A1').setValue('立春朝搾り 取扱店 集計').setFontWeight('bold').setFontSize(14);
  sh.getRange('A3:A5').setValues([['地図に出ている店舗数'], ['非表示の店舗数'], ['銘柄の数']]);
  sh.getRange('B3').setFormula("=COUNTIF('" + SHEET_STORES + "'!B2:B,\"○\")");
  sh.getRange('B4').setFormula("=COUNTA('" + SHEET_STORES + "'!C2:C)-B3");
  sh.getRange('B5').setFormula('=COUNTA(D8:D)');
  sh.getRange('A3:A5').setFontWeight('bold');
  sh.getRange('D7:E7').setValues([['銘柄', '取扱店数（表示中）']]).setFontWeight('bold').setBackground('#c8161d').setFontColor('#ffffff');
  sh.getRange('D8').setFormula(
    "=IFERROR(QUERY(FLATTEN(ARRAYFORMULA(IF('" + SHEET_STORES + "'!B2:B=\"○\",IFERROR(SPLIT('" + SHEET_STORES + "'!D2:D,\"、\"),\"\"),))),"
    + "\"select Col1, count(Col1) where Col1 is not null and Col1 <> '' group by Col1 order by count(Col1) desc label count(Col1) ''\",0),\"\")");
  sh.setColumnWidth(1, 180);
  sh.setColumnWidth(4, 140);
  sh.setColumnWidth(5, 140);
  sh.getRange('A10').setValue('アクセス数・検索された場所は Googleアナリティクス（Looker Studio）で見られます').setFontColor('#6b6b6b');
}

function openSite() {
  const html = HtmlService.createHtmlOutput('<p><a href="' + SITE_URL + '" target="_blank">' + SITE_URL + '</a> を開く</p>').setWidth(420).setHeight(80);
  SpreadsheetApp.getUi().showModalDialog(html, 'サイトを開く');
}
