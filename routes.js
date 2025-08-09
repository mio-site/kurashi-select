(function(){
  // ルーティング定義を一元管理
  // 後からパスを変更しても、このファイルだけ直せば全ページに反映されます

  function slugify(input) {
    if (!input) return '';
    return String(input)
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)+/g, '');
  }

  // ルート基準パス（GitHub Pagesのユーザー/組織サイトなら空文字でOK）
  var BASE = '';
  function path(p){ return BASE + p; }

  // 比較（まとめ）記事の登録
  var compare = {
    series001: path('/article/series001/001-001.html')
    // 必要に応じて追加: series002: path('/article/series002/002-001.html'),
  };

  // 個別記事（商品）の登録: key はスラッグ
  var products = {
    // デモ: Monomam Primo（003-001.html）
    'monomam-primo': path('/article/series003/003-001.html')
  };

  // 名前→URLの直参照（日本語名などスラッグ化が困難な場合はこちらを優先）
  var productByName = {
    'Monomam Primo': products['monomam-primo']
    // 例: '＼18％OFFクーポン／UV パーカー 冷感 -7℃': path('/article/items/uv-parka.html')
  };

  // 個別→関連比較記事への逆引き（任意）
  var productCompare = {
    'monomam-primo': compare.series001 // デモとして series001 を関連に設定
  };

  // 公開
  window.AppRoutes = {
    slugify: slugify,
    compare: compare,
    products: products,
    productByName: productByName,
    productCompare: productCompare
  };
})();


