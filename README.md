# 立春朝搾り 取扱店マップ（静的サイト版）

Streamlit版（risshun-mapkensaku）を、サーバー不要のHTML/JSに作り直したものです。

## ファイル
- `index.html` … 画面
- `style.css` … デザイン（色は先頭の `:root` で変更可）
- `app.js` … 検索・地図の動き（検索範囲 `RADIUS_KM` などは先頭で変更可）
- `stores.json` … 加盟店データ（847店）
- `banner.jpg` … トップ画像
- 地図ライブラリ Leaflet 1.9.4（cdnjs から読み込み）

## 公開（GitHub Pages）
1. GitHubで新しいリポジトリを作成（例：risshun-map）し、このフォルダの中身をすべてアップロード
2. Settings → Pages → Branch を `main` / `/(root)` にして Save
3. 数分後 `https://ユーザー名.github.io/risshun-map/` で公開

`?q=新宿駅` を付けたURLを開くと、その場所で検索した状態で表示されます。

## 加盟店データの更新（管理表）
- 店舗データは Google スプレッドシート「立春朝搾り 取扱店マップ 管理表」の「店舗」タブで管理します（`config.js` の `SHEET_ID`）。
- サイトは開くたびにこの表を読みます。表が読めないときは同梱の `stores.json` で表示します。
- 管理表は「リンクを知っている全員が閲覧可」にしておく必要があります（編集は共有した人だけ）。
- 管理用スクリプトは `admin_Code.gs`。表の「拡張機能 → Apps Script」に貼り付けると「立春マップ管理」メニューが出ます。

| 列 | 内容 |
|---|---|
| 店舗ID | 名門酒会サイトの店舗番号(sid)。空欄可 |
| 表示 | ○ の店だけ地図に出る |
| 店名 / 銘柄 | 銘柄は「、」区切り |
| 住所 | 入れてメニュー①で緯度・経度を自動入力 |
| 緯度 / 経度 | 地図の位置 |
| 詳細URL | 名門酒会サイト以外の詳細ページを使うとき |
| メモ | サイトには出ない社内メモ |

## アクセス解析
`config.js` の `GA_ID` に GA4 の測定ID を入れると計測します。記録するイベント：
`search`（検索語・件数）/ `search_location`（現在地）/ `search_not_found` / `filter_brand` / `select_store` / `click_detail` / `click_route`

## 使っている外部サービス（無料・APIキー不要）
- 地図：国土地理院 淡色地図
- 場所検索：OpenStreetMap Nominatim（駅名など）→ 見つからない時は国土地理院 住所検索
