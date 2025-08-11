document.addEventListener('DOMContentLoaded', () => {

    // --- グローバル変数 productsData が存在するかチェック ---
    if (typeof productsData === 'undefined' || !Array.isArray(productsData)) {
        console.error('商品データ (productsData) が見つからないか、形式が不正です。');
        return;
    }

    const resultsContainer = document.getElementById('results-container');
    const sortButtons = {
        rank: document.getElementById('btn-sort-rank'),
        price: document.getElementById('btn-sort-price'),
        review: document.getElementById('btn-sort-review'),
        score: document.getElementById('btn-sort-score'),
    };
    
    // --- UI要素の取得 ---
    const searchBox = document.getElementById('search-box');
    const priceMinInput = document.getElementById('price-min');
    const priceMaxInput = document.getElementById('price-max');
    const priceRangeQuick = document.getElementById('price-range');
    const filterRating = document.getElementById('filter-rating');
    const filterReview = document.getElementById('filter-review');
    const labelRating = document.getElementById('label-rating');
    const labelReview = document.getElementById('label-review');
    const favOnlyCheckbox = document.getElementById('filter-fav');
    const btnReset = document.getElementById('btn-reset');
    const btnReset2 = document.getElementById('btn-reset-2');
    const tagsContainer = document.getElementById('tags-container');
    const resultSummary = document.getElementById('result-summary');
    const compareBar = document.getElementById('compare-bar');
    const compareCount = document.getElementById('compare-count');
    const btnCompare = document.getElementById('btn-compare');
    const btnCompareClear = document.getElementById('btn-compare-clear');
    const btnDarkToggle = document.getElementById('btn-dark-toggle');
    const btnInstall = document.getElementById('btn-install');
    const top3Container = document.getElementById('top3-container');
    const chartCanvas = document.getElementById('productsChart');


    // --- 状態管理 ---
    let state = {
        products: [...productsData],
        filteredProducts: [...productsData],
        sortBy: 'rank',
        filters: {
            keyword: '',
            priceMin: null,
            priceMax: null,
            rating: 0,
            reviews: 0,
            tags: new Set(),
            favOnly: false,
        },
        favorites: getFavorites(),
        compareItems: new Set(),
        isDarkMode: localStorage.getItem('theme') === 'dark',
        priceBounds: { min: null, max: null },
    };

    // --- ユーティリティ関数 ---
    const debounce = (fn, ms = 250) => {
        let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
    };

    function getFavorites() {
        try {
            return new Set(JSON.parse(localStorage.getItem('favorites') || '[]'));
        } catch {
            return new Set();
        }
    }
    
    function saveFavorites(favs) {
        localStorage.setItem('favorites', JSON.stringify(Array.from(favs)));
    }

    // --- 表示フォーマット/画像ヘルパー ---
    // 簡易トラッキング（GA4想定 or dataLayerフォールバック）
    window.dataLayer = window.dataLayer || [];
    function track(eventName, params = {}) {
        try {
            if (window.gtag) { window.gtag('event', eventName, params); }
            else { window.dataLayer.push({ event: eventName, ...params }); }
        } catch {}
    }
    function getId(p) {
        try {
            return p.itemCode || `name:${String(p.itemName || '')}`;
        } catch { return `name:${Math.random().toString(36).slice(2)}`; }
    }
    function inferTags(p) {
        try {
            const name = `${p.itemName || ''} ${p.catchcopy || ''} ${p.description || ''}`.toLowerCase();
            const tags = new Set();
            if (name.includes('uv')) tags.add('UVカット');
            if (name.includes('冷感') || name.includes('ひんやり')) tags.add('冷感');
            if (name.includes('ワンピ') || name.includes('onepiece')) tags.add('ワンピース');
            if (name.includes('水着') || name.includes('ラッシュ')) tags.add('水着');
            if (name.includes('パンツ')) tags.add('パンツ');
            if (name.includes('デニム')) tags.add('デニム');
            if (name.includes('ルームウェア')) tags.add('ルームウェア');
            if (name.includes('体型カバー')) tags.add('体型カバー');
            if (name.includes('パーカー')) tags.add('パーカー');
            return Array.from(tags);
        } catch { return p.tags || []; }
    }
    function augmentProducts(list) {
        try {
            return list.map(p => ({ ...p, tags: Array.isArray(p.tags) ? p.tags : inferTags(p) }));
        } catch { return list; }
    }
    function computePriceBounds(list) {
        try {
            const prices = list.map(p => Number(p.itemPrice || 0)).filter(Number.isFinite);
            if (!prices.length) return { min: 0, max: 0 };
            return { min: Math.min(...prices), max: Math.max(...prices) };
        } catch { return { min: 0, max: 0 }; }
    }
    function formatRating(v) { try { return Number(v ?? 0).toFixed(2); } catch { return '0.00'; } }
    function formatPrice(v) { try { return `¥${Number(v ?? 0).toLocaleString()}`; } catch { return '¥0'; } }
    function imgUrlWithSize(url, size) {
        try {
            if (!url) return url;
            const hasQuery = url.includes('?');
            const exParam = `_ex=${size}x${size}`;
            if (/_ex=\d+x\d+/.test(url)) return url.replace(/_ex=\d+x\d+/, exParam);
            return url + (hasQuery ? '&' : '?') + exParam;
        } catch { return url; }
    }
    function buildSrcset(url) {
        const sizes = [320, 480, 640, 800, 1200];
        return sizes.map(s => `${imgUrlWithSize(url, s)} ${s}w`).join(', ');
    }

    // --- Chart.js ローダー/描画 ---
    let productsChart = null;
    let currentData = [];
    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = src; s.async = true; s.onload = resolve; s.onerror = reject;
            document.head.appendChild(s);
        });
    }
    async function ensureChart() {
        if (window.Chart) return true;
        try {
            await loadScript('https://cdn.jsdelivr.net/npm/chart.js');
            await loadScript('https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns/dist/chartjs-adapter-date-fns.bundle.min.js');
            return true;
        } catch {
            return false;
        }
    }
    function refreshChart(list) {
        const canvas = document.getElementById('productsChart');
        if (!canvas || !Array.isArray(list) || list.length === 0 || !window.Chart) return;
        const ctx = canvas.getContext('2d');
        const dataPoints = list.map((p, i) => ({
            x: p.itemPrice,
            y: Number(p.reviewAverage),
            r: Math.max(5, Math.sqrt(p.reviewCount || 0) / 10),
            label: `[${i + 1}位] ${p.itemName}`,
            id: getId(p),
        }));
        const ys = dataPoints.map(d => d.y);
        const yMin = Math.max(0, Math.min(...ys) - 0.05);
        const yMax = Math.min(5, Math.max(...ys) + 0.05);
        if (!productsChart) {
            productsChart = new Chart(ctx, {
                type: 'bubble',
                data: { datasets: [{ label: '商品', data: dataPoints, backgroundColor: 'rgba(37, 99, 235, 0.6)', borderColor: 'rgba(37, 99, 235, 1)', borderWidth: 1 }] },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: { callbacks: { label: (c) => [ `${c.raw.label}`, `価格: ${c.raw.x.toLocaleString()}円`, `評価: ${Number(c.raw.y).toFixed(2)}` ] } }
                    },
                    onClick: (_, elements) => {
                        try {
                            if (!elements || !elements.length) return;
                            const idx = elements[0].index;
                            const el = document.getElementById(`card-${idx + 1}`);
                            if (el) {
                                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                el.classList.add('highlight-ring');
                                setTimeout(() => el.classList.remove('highlight-ring'), 1600);
                                track('chart_point_click', { index: idx + 1 });
                            }
                        } catch {}
                    },
                    scales: {
                        x: { title: { display: true, text: '価格（円）' }, ticks: { callback: (v) => Number(v).toLocaleString() } },
                        y: { title: { display: true, text: 'レビュー評価' }, min: yMin, max: yMax },
                    }
                }
            });
        } else {
            productsChart.data.datasets[0].data = dataPoints;
            productsChart.options.scales.y.min = yMin;
            productsChart.options.scales.y.max = yMax;
            productsChart.update();
        }
    }

    // --- レンダリング関数 ---
    function renderProducts(productsToRender) {
        if (!resultsContainer) return;
        resultsContainer.innerHTML = productsToRender.map((p, idx) => createProductCard({ ...p, _displayRank: (idx + 1) })).join('');
        resultSummary.textContent = `${productsToRender.length}件表示中`;
        // フェードイン（不可視クラスの除去）
        try {
            requestAnimationFrame(() => {
                document.querySelectorAll('#results-container .opacity-0').forEach(el => {
                    el.classList.remove('opacity-0');
                    el.classList.remove('translate-y-4');
                });
            });
        } catch {}
        // アフィリエイトクリックのトラッキング（委譲）
        try {
            resultsContainer.querySelectorAll('a.aff-link').forEach(a => {
                a.addEventListener('click', () => {
                    const rank = a.getAttribute('data-rank');
                    const name = a.getAttribute('data-name');
                    const price = Number(a.getAttribute('data-price') || 0);
                    track('aff_click', { rank, name, price });
                }, { once: true });
            });
        } catch {}
    }

    function createProductCard(p) {
        const id = getId(p);
        const isFav = state.favorites.has(id);
        const isCompared = state.compareItems.has(id);
        const img640 = imgUrlWithSize(p.imageUrl, 640);
        const srcset = buildSrcset(p.imageUrl || '');
        return `
          <div id="card-${p._displayRank || p.rank || 0}" class="bg-white rounded-2xl card-shadow card-shadow-hover transition-all transform-gpu opacity-0 translate-y-4" style="transition-delay: ${(p._displayRank || p.rank || 0) * 40}ms;" data-id="${id}">
            <img src="${img640}" srcset="${srcset}" sizes="(min-width:1024px) 320px, (min-width:768px) 45vw, 90vw" alt="${p.itemName}" width="640" height="640" class="rounded-t-2xl w-full object-contain bg-white" style="aspect-ratio: 1 / 1;" loading="lazy" decoding="async">
            <div class="p-5 md:p-6">
              <div class="flex justify-between items-start mb-3">
                <div class="pr-2">
                  <p class="text-xs text-gray-500">RANK ${p._displayRank || p.rank || '-'}</p>
                  <h3 class="font-bold text-primary leading-tight line-clamp-2" title="${p.itemName}">${p.itemName}</h3>
                </div>
                <div class="flex items-center gap-2">
                  <button class="btn btn-fav text-yellow-500 text-xl" data-id="${id}" aria-label="お気に入りに追加/解除">${isFav ? '★' : '☆'}</button>
                  <span class="text-xl font-bold text-accent whitespace-nowrap">${formatPrice(p.itemPrice)}</span>
                </div>
              </div>
              <div class="text-base space-y-2 mb-4">
                <p class="text-gray-700 line-clamp-2">${p.catchcopy || p.description || ''}</p>
                <div class="flex items-center gap-4 text-sm">
                  <span class="badge-primary px-2 py-0.5 rounded-full">⭐ ${formatRating(p.reviewAverage)}</span>
                  <span class="text-gray-500">✍️ ${(p.reviewCount || 0).toLocaleString()}件</span>
                  ${p.pointRate && Number(p.pointRate) > 1 ? `<span class="badge-primary px-2 py-0.5 rounded-full">ポイント${p.pointRate}倍</span>` : ''}
                </div>
              </div>
              <div class="flex flex-wrap gap-2 mb-3">
                ${(p.tags || []).slice(0,3).map(t => `<span class="chip">${t}</span>`).join('')}
              </div>
              ${(p.description && String(p.description).trim().length > 0) ? `
              <div id="details-${id}" class="text-base leading-relaxed text-gray-700 bg-stone-50 p-3 rounded-lg hidden mb-4">
                <p>${p.description}</p>
              </div>
              <button class="btn btn-details w-full text-center bg-primary text-white font-bold py-3 rounded-lg hover:brightness-95 transition-colors" data-id="${id}">詳細を見る</button>
              ` : ''}
              <div class="actions-row mt-3">
                <label class="btn-chip"><input type="checkbox" class="compare-checkbox" data-id="${id}" ${isCompared ? 'checked' : ''}><span>比較</span></label>
                <a href="${p.affiliateUrl}" target="_blank" rel="sponsored nofollow noopener noreferrer" class="flex-1 block text-center btn-cta aff-link font-bold py-3 px-4 rounded-lg hover:opacity-95 hover:brightness-110 transition" data-rank="${p._displayRank || p.rank || ''}" data-name="${p.itemName}" data-price="${p.itemPrice}" aria-label="楽天で価格と在庫を確認">楽天で価格・在庫を確認</a>
              </div>
            </div>
          </div>
        `;
    }

    // --- スコア算出（正規化合成） ---
    const WEIGHTS = { price: 0.34, rating: 0.33, reviews: 0.33 };
    function computeScores(list) {
        if (!Array.isArray(list) || list.length === 0) return [];
        const vals = {
            price: list.map(p => Number(p.itemPrice || 0)),
            rating: list.map(p => Number(p.reviewAverage || 0)),
            reviews: list.map(p => Number(p.reviewCount || 0)),
        };
        const mm = (arr) => ({ min: Math.min(...arr), max: Math.max(...arr) });
        const P = mm(vals.price), R = mm(vals.rating), C = mm(vals.reviews);
        const norm = (v, { min, max }, higher) => {
            if (!Number.isFinite(v) || !Number.isFinite(min) || !Number.isFinite(max) || max === min) return 0.5;
            const t = (v - min) / (max - min);
            return higher ? t : 1 - t;
        };
        return list.map(p => {
            const sPrice = norm(Number(p.itemPrice || 0), P, false);
            const sRating = norm(Number(p.reviewAverage || 0), R, true);
            const sReviews = norm(Number(p.reviewCount || 0), C, true);
            const score = sPrice * WEIGHTS.price + sRating * WEIGHTS.rating + sReviews * WEIGHTS.reviews;
            return { ...p, score: Number(score.toFixed(4)) };
        });
    }

    function renderTop3() {
        if (!top3Container) return;
        try {
            const base = (state.products && state.products.length ? state.products : productsData) || [];
            const scored = computeScores(base);
            const top3 = scored.sort((a,b)=> (b.score||0)-(a.score||0)).slice(0,3).map((p, i) => ({ ...p, _displayRank: i+1 }));
            top3Container.innerHTML = top3.map(p => createProductCard(p)).join('');
            requestAnimationFrame(() => {
                document.querySelectorAll('#top3-container .opacity-0').forEach(el => {
                    el.classList.remove('opacity-0');
                    el.classList.remove('translate-y-4');
                });
            });
        } catch {}
    }

    // --- ソートボタンのアクティブ表示更新 ---
    function updateSortButtonsActive(){
        const ids = ['btn-sort-rank','btn-sort-price','btn-sort-review','btn-sort-score'];
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            const key = id.replace('btn-sort-','');
            const isActive = state.sortBy === key;
            el.classList.toggle('bg-primary', isActive);
            el.classList.toggle('ring-2', isActive);
            el.classList.toggle('ring-offset-2', isActive);
            el.classList.toggle('ring-primary', isActive);
            el.classList.toggle('bg-accent', !isActive);
            if (el.getAttribute('role') === 'tab') el.setAttribute('aria-selected', String(isActive));
        });
    }

    // --- ガイドカード（人気/コスパ/品質）の強調切替 ---
    function updateGuideActive(which){
        ['popular','cost','quality'].forEach(name => {
            const el = document.getElementById(`guide-${name}`);
            if (!el) return;
            el.classList.toggle('highlight-ring', which === name);
        });
    }

    // --- タグの初期化と操作 ---
    function initTags(){
        if (!tagsContainer) return;
        const tagSet = new Set();
        try {
            state.products.forEach(p => {
                if (Array.isArray(p.tags)) p.tags.forEach(t => tagSet.add(String(t)));
            });
        } catch {}
        const tags = Array.from(tagSet).slice(0, 30);
        tagsContainer.innerHTML = tags.map(t => `<button type="button" class="chip" data-tag="${t}">${t}</button>`).join('');
        tagsContainer.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-tag]');
            if (!btn) return;
            const t = btn.dataset.tag;
            if (state.filters.tags.has(t)) state.filters.tags.delete(t); else state.filters.tags.add(t);
            btn.classList.toggle('chip-selected', state.filters.tags.has(t));
            applyAll();
        });
    }
    function clearSelectedTags(){
        state.filters.tags.clear();
        if (tagsContainer) tagsContainer.querySelectorAll('button[data-tag]').forEach(el => el.classList.remove('chip-selected'));
    }

    // --- イベントリスナー ---
    function addEventListeners() {
        // ソートボタン
        Object.keys(sortButtons).forEach(key => {
            if (sortButtons[key]) {
                sortButtons[key].addEventListener('click', () => {
                    state.sortBy = key;
                    applyAll();
                    updateSortButtonsActive();
                    track('sort_change', { key });
                });
            }
        });

        // フィルタ
        if(searchBox) searchBox.addEventListener('input', debounce(() => {
            state.filters.keyword = searchBox.value;
            applyAll();
            track('filter_change', { key: 'keyword', value: state.filters.keyword });
        }));
        if (searchBox) searchBox.addEventListener('search', () => { // Safariのクリアボタン対策
            state.filters.keyword = searchBox.value;
            applyAll();
            track('filter_change', { key: 'keyword', value: state.filters.keyword });
        });
        // 価格（最小/最大）
        if (priceMinInput) priceMinInput.addEventListener('input', debounce(() => {
            const v = parseInt(priceMinInput.value, 10);
            state.filters.priceMin = Number.isFinite(v) ? v : null;
            applyAll();
            track('filter_change', { key: 'priceMin', value: state.filters.priceMin });
        }, 200));
        if (priceMaxInput) priceMaxInput.addEventListener('input', debounce(() => {
            const v = parseInt(priceMaxInput.value, 10);
            state.filters.priceMax = Number.isFinite(v) ? v : null;
            applyAll();
            track('filter_change', { key: 'priceMax', value: state.filters.priceMax });
        }, 200));
        // 価格クイックスライダー
        if (priceRangeQuick) priceRangeQuick.addEventListener('input', () => {
            const val = Number(priceRangeQuick.value);
            let min = null, max = null;
            if (val <= 5) { min = null; max = null; }
            else if (val <= 20) { min = 0; max = 2000; }
            else if (val <= 40) { min = 0; max = 3000; }
            else if (val <= 60) { min = 0; max = 5000; }
            else if (val <= 80) { min = 0; max = 8000; }
            else { min = 0; max = 12000; }
            state.filters.priceMin = min; state.filters.priceMax = max;
            if (priceMinInput) priceMinInput.value = min ?? '';
            if (priceMaxInput) priceMaxInput.value = max ?? '';
            applyAll();
            track('filter_change', { key: 'priceQuick', value: { min: state.filters.priceMin, max: state.filters.priceMax } });
        });
        // 評価/レビュー
        if (filterRating) filterRating.addEventListener('input', () => {
            const v = parseFloat(filterRating.value);
            state.filters.rating = Number.isFinite(v) ? v : 0;
            if (labelRating) labelRating.textContent = (state.filters.rating || 0).toFixed(1);
            applyAll();
            track('filter_change', { key: 'rating', value: state.filters.rating });
        });
        if (filterReview) filterReview.addEventListener('input', () => {
            const v = parseInt(filterReview.value, 10) || 0;
            state.filters.reviews = v;
            if (labelReview) labelReview.textContent = String(v);
            applyAll();
            track('filter_change', { key: 'reviews', value: state.filters.reviews });
        });
        // お気に入りのみ
        if (favOnlyCheckbox) favOnlyCheckbox.addEventListener('change', () => {
            state.filters.favOnly = !!favOnlyCheckbox.checked;
            applyAll();
            track('filter_change', { key: 'favOnly', value: state.filters.favOnly });
        });
        // リセット
        const handleReset = () => {
            state.filters = { keyword: '', priceMin: null, priceMax: null, rating: 0, reviews: 0, tags: new Set(), favOnly: false };
            state.sortBy = 'rank';
            if (searchBox) searchBox.value = '';
            if (priceMinInput) priceMinInput.value = '';
            if (priceMaxInput) priceMaxInput.value = '';
            if (priceRangeQuick) priceRangeQuick.value = 0;
            if (filterRating) filterRating.value = 0;
            if (filterReview) filterReview.value = 0;
            if (labelRating) labelRating.textContent = '0.0';
            if (labelReview) labelReview.textContent = '0';
            if (favOnlyCheckbox) favOnlyCheckbox.checked = false;
            clearSelectedTags();
            updateSortButtonsActive();
            updateGuideActive(null);
            applyAll();
            track('reset_filters', {});
        };
        if (btnReset) btnReset.addEventListener('click', handleReset);
        if (btnReset2) btnReset2.addEventListener('click', handleReset);

        // カード内のボタン
        resultsContainer.addEventListener('click', e => {
            const target = e.target.closest('button');
            if (!target) return;
            const id = target.dataset.id;
            if (target.classList.contains('btn-fav') && id) {
                toggleFavorite(id);
                return;
            }
            if (target.classList.contains('btn-compare') && id) {
                toggleCompare(id);
                return;
            }
            if (target.classList.contains('btn-details') && id) {
                const details = document.getElementById(`details-${id}`);
                if (details) {
                    const hidden = details.classList.toggle('hidden');
                    target.textContent = hidden ? '詳細を見る' : '閉じる';
                }
            }
        });
        
        top3Container.addEventListener('click', e => {
            const target = e.target.closest('button.btn-fav');
            if(target) toggleFavorite(target.dataset.itemCode);
        });
        // 比較チェックボックス
        resultsContainer.addEventListener('change', e => {
            const cb = e.target.closest('input.compare-checkbox');
            if (!cb) return;
            const id = cb.dataset.id;
            if (!id) return;
            if (cb.checked) {
                if (state.compareItems.size < 3) state.compareItems.add(id); else { cb.checked = false; alert('比較できるのは3つまでです。'); }
            } else {
                state.compareItems.delete(id);
            }
            updateCompareBar();
        });
        // ガイドカード
        const guidePopular = document.getElementById('guide-popular');
        const guideCost = document.getElementById('guide-cost');
        const guideQuality = document.getElementById('guide-quality');
        if (guidePopular) guidePopular.addEventListener('click', () => {
            state.filters.reviews = 1000; // レビュー件数閾値
            if (labelReview) labelReview.textContent = String(state.filters.reviews);
            if (filterReview) filterReview.value = state.filters.reviews;
            state.sortBy = 'review';
            updateGuideActive('popular'); updateSortButtonsActive(); applyAll();
            track('guide_click', { type: 'popular' });
        });
        if (guideCost) guideCost.addEventListener('click', () => {
            // 下位40%までの価格上限に近いところへ（簡易）
            const span = (state.priceBounds.max ?? 0) - (state.priceBounds.min ?? 0);
            state.filters.priceMin = 0;
            state.filters.priceMax = Math.round((state.priceBounds.max ?? 0) - span * 0.6);
            if (priceMinInput) priceMinInput.value = state.filters.priceMin;
            if (priceMaxInput) priceMaxInput.value = state.filters.priceMax;
            state.sortBy = 'price';
            updateGuideActive('cost'); updateSortButtonsActive(); applyAll();
            track('guide_click', { type: 'cost' });
        });
        if (guideQuality) guideQuality.addEventListener('click', () => {
            state.filters.rating = 4.4;
            if (labelRating) labelRating.textContent = state.filters.rating.toFixed(1);
            if (filterRating) filterRating.value = state.filters.rating;
            state.sortBy = 'review';
            updateGuideActive('quality'); updateSortButtonsActive(); applyAll();
            track('guide_click', { type: 'quality' });
        });
        // 比較バーのボタン
        if (btnCompare) btnCompare.addEventListener('click', () => { if (state.compareItems.size >= 2) { openCompareModal(); track('compare_open', { ids: Array.from(state.compareItems) }); } });
        if (btnCompareClear) btnCompareClear.addEventListener('click', () => {
            state.compareItems.clear();
            try {
                document.querySelectorAll('.compare-checkbox').forEach(cb => { cb.checked = false; });
            } catch {}
            updateCompareBar();
            track('compare_clear', {});
        });

        // テスティモニアル（クイック検索）
        document.querySelectorAll('.testimonial').forEach(el => {
            el.addEventListener('click', () => {
                const q = el.getAttribute('data-query') || '';
                if (searchBox) searchBox.value = q;
                state.filters.keyword = q;
                const t = (el.getAttribute('data-tags') || '').split(/\s+/).filter(Boolean);
                t.forEach(tag => state.filters.tags.add(tag));
                if (tagsContainer) tagsContainer.querySelectorAll('button[data-tag]').forEach(btn => {
                    btn.classList.toggle('chip-selected', state.filters.tags.has(btn.dataset.tag));
                });
                applyAll();
                track('testimonial_click', { query: q, tags: Array.from(state.filters.tags) });
            });
        });

        // ダークモード（ヘッダーのトグル）
        const applyTheme = (t) => {
            if (t === 'dark') document.documentElement.classList.add('dark');
            else document.documentElement.classList.remove('dark');
            if (btnDarkToggle) {
                const isDark = document.documentElement.classList.contains('dark');
                btnDarkToggle.textContent = isDark ? '☀️ ライト' : '🌙 ダーク';
                btnDarkToggle.setAttribute('aria-pressed', String(isDark));
            }
        };
        const preferred = localStorage.getItem('theme') || 'light';
        applyTheme(preferred);
        if (btnDarkToggle) btnDarkToggle.addEventListener('click', () => {
            const isDark = document.documentElement.classList.toggle('dark');
            localStorage.setItem('theme', isDark ? 'dark' : 'light');
            btnDarkToggle.textContent = isDark ? '☀️ ライト' : '🌙 ダーク';
            track('theme_toggle', { theme: isDark ? 'dark' : 'light' });
            applyAll();
        });
    }

    // --- ロジック関数 ---
    function applyAll() {
        try {
            // フィルタリング
            const q = (state.filters.keyword || '').trim().toLowerCase();
            const tags = state.filters.tags || new Set();
            state.filteredProducts = state.products.filter(p => {
                const id = getId(p);
                const keywordHay = `${p.itemName || ''} ${p.catchcopy || ''} ${p.description || ''}`.toLowerCase();
                const keywordOk = !q || keywordHay.includes(q);
                const priceOk = (state.filters.priceMin == null || Number(p.itemPrice || 0) >= state.filters.priceMin) &&
                                (state.filters.priceMax == null || Number(p.itemPrice || 0) <= state.filters.priceMax);
                const ratingOk = Number(p.reviewAverage || 0) >= (state.filters.rating || 0);
                const reviewOk = Number(p.reviewCount || 0) >= (state.filters.reviews || 0);
                const tagsOk = (tags.size === 0) || (Array.isArray(p.tags) && p.tags.some(t => tags.has(String(t))));
                const favOk = !state.filters.favOnly || state.favorites.has(id);
                return keywordOk && priceOk && ratingOk && reviewOk && tagsOk && favOk;
            });

            // スコア付与（おすすめ順用）
            if (state.filteredProducts.length) {
                state.filteredProducts = computeScores(state.filteredProducts);
            }

            // ソート
            state.filteredProducts.sort((a, b) => {
                switch (state.sortBy) {
                    case 'price': return (a.itemPrice || 0) - (b.itemPrice || 0);
                    case 'review': return (b.reviewAverage || 0) - (a.reviewAverage || 0);
                    case 'score': return (b.score || 0) - (a.score || 0);
                    default: return (a.rank || 999) - (b.rank || 999);
                }
            });

            renderProducts(state.filteredProducts);
            updateSortButtonsActive();
            // 現在のデータを保持し、グラフが開いていれば更新
            try { currentData = state.filteredProducts.slice(); } catch {}
            try {
                const detailsEl = document.querySelector('#chart-analysis details');
                if (detailsEl && detailsEl.open) {
                    ensureChart().then((ok)=>{ if (ok) refreshChart(currentData); });
                }
            } catch {}

            // 保存
            saveAppState();
            try { track('list_render', { total: state.filteredProducts.length, sortBy: state.sortBy }); } catch {}
        } catch {}
    }
    
    function toggleFavorite(id) {
        if (state.favorites.has(id)) {
            state.favorites.delete(id);
        } else {
            state.favorites.add(id);
        }
        saveFavorites(state.favorites);
        applyAll(); // 再描画してUIに反映
        try { renderTop3(); } catch {}
    }

    function toggleCompare(id) {
        if (state.compareItems.has(id)) {
            state.compareItems.delete(id);
        } else {
            if (state.compareItems.size < 3) state.compareItems.add(id);
            else alert('比較できるのは3つまでです。');
        }
        updateCompareBar();
    }
    
    function updateCompareBar(){
        if (compareCount) compareCount.textContent = state.compareItems.size;
        if (compareBar) compareBar.classList.toggle('hidden', state.compareItems.size === 0);
        if (btnCompare) btnCompare.disabled = state.compareItems.size < 2;
    }
    
    // --- 初期化 ---
    function init() {
        try { state.products = augmentProducts(state.products); } catch {}
        try { state.priceBounds = computePriceBounds(state.products); } catch {}
        try { restoreAppState(); } catch {}
        try { renderTop3(); } catch {}
        try { applyAll(); } catch {}
        try { addEventListeners(); } catch {}
        // ヘッダー固定分の上余白を付与し、右サイドTOCの開閉を有効化
        try { setupHeaderAndToc(); } catch {}
        // グラフのバインディング
        try { bindDetailsChart(); } catch {}
        try { initTags(); } catch {}
        try { updateSortButtonsActive(); } catch {}
        try { tryLoadExternalData(); } catch {}
        try { bindFaqControls(); } catch {}
        try { initShareBars(); } catch {}
        try { initPwaInstall(); } catch {}
        try { injectJsonLd(); } catch {}
        try { ensureBodyVisible(); } catch {}
        try { registerServiceWorker(); } catch {}
    }

    init();

    // --- ヘッダー/TOCの挙動 ---
    function setupHeaderAndToc(){
        // ヘッダー高さ分の余白
        document.body.classList.add('has-header');
        const header = document.getElementById('site-header');
        if (header) {
            let lastY = window.scrollY || 0;
            let ticking = false;
            window.addEventListener('scroll', () => {
                const y = window.scrollY || 0;
                if (!ticking) {
                    window.requestAnimationFrame(() => {
                        if (y > lastY && y > 80) header.classList.add('hide');
                        else header.classList.remove('hide');
                        lastY = y;
                        ticking = false;
                    });
                    ticking = true;
                }
            }, { passive: true });
        }
        // 右サイドTOCの開閉 + ScrollSpy
        const toc = document.getElementById('right-toc');
        const toggle = document.getElementById('toc-toggle');
        if (toc && toggle) {
            // 初期は閉じる
            toc.classList.add('hidden');
            let open = false;
            const setPressed = () => toggle.setAttribute('aria-pressed', String(open));
            toggle.addEventListener('click', () => {
                open = !open;
                toc.classList.toggle('hidden', !open);
                setPressed();
            });
            setPressed();

            // ScrollSpy: 現在地のリンクに active を付与
            const links = Array.from(toc.querySelectorAll('a[href^="#"]'));
            const ids = links.map(a => a.getAttribute('href').slice(1)).filter(Boolean);
            const updateActive = () => {
                let activeIndex = -1;
                let minTop = Infinity;
                ids.forEach((id, i) => {
                    const el = document.getElementById(id);
                    if (!el) return;
                    const rect = el.getBoundingClientRect();
                    if (rect.top >= -120 && rect.top < minTop) { minTop = rect.top; activeIndex = i; }
                });
                links.forEach((a, i) => a.classList.toggle('active', i === activeIndex));
            };
            window.addEventListener('scroll', updateActive, { passive: true });
            window.addEventListener('resize', updateActive, { passive: true });
            updateActive();
        }
    }

    // --- グラフ（details開閉時に初期化/更新） ---
    function bindDetailsChart(){
        const detailsEl = document.querySelector('#chart-analysis details');
        if (!detailsEl) return;
        detailsEl.addEventListener('toggle', () => {
            if (!detailsEl.open) return;
            const list = currentData && currentData.length ? currentData : state.filteredProducts || [];
            ensureChart().then((ok)=>{ if (ok) refreshChart(list); });
        });
        // 初期状態で開いている場合
        if (detailsEl.open) {
            const list = currentData && currentData.length ? currentData : state.filteredProducts || [];
            ensureChart().then((ok)=>{ if (ok) refreshChart(list); });
        }
    }

    // --- FAQ 全開/全閉 ---
    function bindFaqControls() {
        const openAll = document.getElementById('btn-faq-open-all');
        const closeAll = document.getElementById('btn-faq-close-all');
        if (openAll) openAll.addEventListener('click', () => { document.querySelectorAll('#faq details').forEach(d => d.open = true); });
        if (closeAll) closeAll.addEventListener('click', () => { document.querySelectorAll('#faq details').forEach(d => d.open = false); });
    }

    // --- 共有ボタン群 ---
    function openCenteredPopup(url) {
        try {
            const width = 600, height = 680;
            const dualScreenLeft = window.screenLeft !== undefined ? window.screenLeft : window.screenX;
            const dualScreenTop = window.screenTop !== undefined ? window.screenTop : window.screenY;
            const screenWidth = window.innerWidth || document.documentElement.clientWidth || screen.width;
            const screenHeight = window.innerHeight || document.documentElement.clientHeight || screen.height;
            const left = dualScreenLeft + (screenWidth - width) / 2;
            const top = dualScreenTop + (screenHeight - height) / 2;
            window.open(url, '_blank', `noopener,noreferrer,width=${width},height=${height},top=${top},left=${left}`);
        } catch { window.open(url, '_blank'); }
    }
    function getPageShareData() {
        const pageTitle = (document.title || '').trim();
        const heading = (document.querySelector('h1')?.textContent || '').trim();
        const text = heading && heading !== pageTitle ? heading : pageTitle;
        const url = `${location.origin}${location.pathname}${location.search}`;
        return { title: pageTitle || 'おすすめまとめ', text: text || pageTitle, url };
    }
    async function handleShareAction(action, btn) {
        const { title, text, url } = getPageShareData();
        if (action === 'native') {
            try { if (navigator.share) { await navigator.share({ title, text, url }); track('share_click', { action }); return; } } catch {}
            return handleShareAction('copy', btn);
        }
        if (action === 'x') {
            const shareUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
            openCenteredPopup(shareUrl); track('share_click', { action }); return;
        }
        if (action === 'line') {
            const shareUrl = `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(url)}`;
            openCenteredPopup(shareUrl); track('share_click', { action }); return;
        }
        if (action === 'copy') {
            try { await navigator.clipboard.writeText(url); if (btn) { const orig = btn.textContent; btn.textContent = 'コピー済み'; setTimeout(()=>btn.textContent = orig, 1500); } } catch {}
            track('share_click', { action }); return;
        }
    }
    function initShareBars() {
        const buttons = document.querySelectorAll('[data-share-action]');
        buttons.forEach(b => {
            b.addEventListener('click', () => handleShareAction(b.dataset.shareAction, b));
        });
        if (!navigator.share) {
            document.querySelectorAll('[data-share-action="native"]').forEach(el => el.classList.add('hidden'));
        }
    }

    // --- PWA Install ---
    function initPwaInstall() {
        let deferredPrompt = null;
        window.addEventListener('beforeinstallprompt', (e) => {
            try { e.preventDefault(); } catch {}
            deferredPrompt = e;
            if (btnInstall) btnInstall.classList.remove('hidden');
        });
        if (btnInstall) btnInstall.addEventListener('click', async () => {
            if (!deferredPrompt) return;
            try { deferredPrompt.prompt(); await deferredPrompt.userChoice; } catch {}
            deferredPrompt = null; btnInstall.classList.add('hidden');
        });
    }

    // --- JSON-LD 注入（重複防止のためID付与） ---
    function injectJsonLd() {
        try {
            if (document.getElementById('jsonld-itemlist')) return; // 二重注入防止
            const items = Array.isArray(state.products) ? state.products : productsData || [];
            if (!items.length) return;

            const img1200 = (url) => {
                try {
                    const hasQuery = url.includes('?');
                    const exParam = `_ex=1200x1200`;
                    if (/_ex=\d+x\d+/.test(url)) return url.replace(/_ex=\d+x\d+/, exParam);
                    return url + (hasQuery ? '&' : '?') + exParam;
                } catch { return url; }
            };
            const itemList = {
                '@context': 'https://schema.org',
                '@type': 'ItemList',
                name: (document.title || '').trim(),
                description: (document.querySelector('meta[name="description"]')?.content || '').trim(),
                numberOfItems: items.length,
                itemListOrder: 'https://schema.org/ItemListOrderAscending',
                itemListElement: items.map((p, idx) => ({
                    '@type': 'ListItem',
                    position: idx + 1,
                    url: p.affiliateUrl,
                    item: {
                        '@type': 'Product',
                        name: p.itemName,
                        image: [p.imageUrl, img1200(p.imageUrl)],
                        description: p.description || p.catchcopy || '',
                        brand: { '@type': 'Brand', name: '楽天市場' },
                        category: 'レディースファッション',
                        aggregateRating: { '@type': 'AggregateRating', ratingValue: p.reviewAverage, reviewCount: p.reviewCount, bestRating: 5, worstRating: 1 },
                        offers: { '@type': 'Offer', priceCurrency: 'JPY', price: p.itemPrice, lowPrice: p.itemPrice, highPrice: p.itemPrice, url: p.affiliateUrl, availability: 'https://schema.org/InStock', seller: { '@type': 'Organization', name: '楽天市場' } }
                    }
                }))
            };
            const breadcrumb = {
                '@context': 'https://schema.org', '@type': 'BreadcrumbList',
                itemListElement: [
                    { '@type': 'ListItem', position: 1, name: 'ホーム', item: location.origin },
                    { '@type': 'ListItem', position: 2, name: '記事', item: location.origin + '/article/' },
                    { '@type': 'ListItem', position: 3, name: (document.querySelector('h1')?.textContent || '').trim() }
                ]
            };
            const faqEls = Array.from(document.querySelectorAll('#faq details'));
            if (faqEls.length) {
                const faq = {
                    '@context': 'https://schema.org', '@type': 'FAQPage',
                    mainEntity: faqEls.map(d => ({ '@type': 'Question', name: (d.querySelector('summary span')?.textContent || '').trim(), acceptedAnswer: { '@type': 'Answer', text: (d.querySelector('div')?.textContent || '').trim() } }))
                };
                const s3 = document.createElement('script'); s3.id = 'jsonld-faq'; s3.type = 'application/ld+json'; s3.text = JSON.stringify(faq);
                document.head.appendChild(s3);
            }
            const s1 = document.createElement('script'); s1.id = 'jsonld-itemlist'; s1.type = 'application/ld+json'; s1.text = JSON.stringify(itemList);
            const s2 = document.createElement('script'); s2.id = 'jsonld-breadcrumb'; s2.type = 'application/ld+json'; s2.text = JSON.stringify(breadcrumb);
            document.head.appendChild(s1); document.head.appendChild(s2);
        } catch {}
    }

    // --- FOUC対策（ロード後に表示） ---
    function ensureBodyVisible() {
        try {
            document.body.style.display = 'block';
            document.body.classList.add('has-header');
        } catch {}
    }

    function registerServiceWorker() {
        try { if ('serviceWorker' in navigator) navigator.serviceWorker.register('../../sw.js').catch(()=>{}); } catch {}
    }

    // --- 比較モーダル ---
    function ensureCompareModal() {
        let backdrop = document.getElementById('compare-modal-backdrop');
        if (backdrop) return backdrop;
        backdrop = document.createElement('div');
        backdrop.id = 'compare-modal-backdrop';
        backdrop.className = 'modal-backdrop';
        backdrop.style.display = 'none';
        backdrop.innerHTML = `
            <div class="modal p-4 md:p-6" role="dialog" aria-modal="true" aria-label="商品比較">
                <div class="modal-header flex justify-between items-center p-2 md:p-0">
                    <h3 class="text-lg font-bold">商品比較</h3>
                    <button id="compare-modal-close" class="btn border px-3 py-1 rounded-lg">閉じる</button>
                </div>
                <div class="pt-4">
                    <div id="compare-modal-body" class="overflow-x-auto"></div>
                </div>
            </div>`;
        document.body.appendChild(backdrop);
        // 閉じる挙動
        const close = () => { backdrop.style.display = 'none'; document.body.classList.remove('modal-open'); };
        backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
        backdrop.querySelector('#compare-modal-close').addEventListener('click', close);
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && backdrop.style.display !== 'none') close(); });
        return backdrop;
    }
    function openCompareModal() {
        try {
            const ids = Array.from(state.compareItems);
            const items = state.products.filter(p => ids.includes(getId(p)));
            if (items.length < 2) return;
            const best = {
                price: Math.min(...items.map(p => Number(p.itemPrice || Infinity))),
                rating: Math.max(...items.map(p => Number(p.reviewAverage || 0))),
                reviews: Math.max(...items.map(p => Number(p.reviewCount || 0))),
            };
            const scored = computeScores(items);
            const toStars = (score) => {
                const n = Math.max(0, Math.min(5, Math.round((score || 0) * 5)));
                return '★'.repeat(n) + '☆'.repeat(5 - n);
            };
            const table = `
                <div class="mb-4 p-4 bg-blue-50 rounded-lg text-sm text-blue-800">
                    <p class="font-bold mb-2">📊 比較基準について</p>
                    <p>黄色のハイライトが各項目の最良値です（価格=最安、評価=最高、レビュー=最多）。</p>
                </div>
                <table class="w-full text-sm table-striped">
                    <thead>
                        <tr class="bg-gray-50">
                            <th class="text-left p-3 font-bold">比較項目</th>
                            ${items.map(p => `<th class="text-left p-3 font-bold">${String(p.itemName || '').slice(0, 20)}${String(p.itemName || '').length>20?'…':''}</th>`).join('')}
                        </tr>
                    </thead>
                    <tbody>
                        <tr class="border-t">
                            <td class="p-3 font-semibold bg-gray-50">価格（税込）</td>
                            ${items.map(p => `<td class="p-3 ${Number(p.itemPrice||0)===best.price?'bg-yellow-50 ring-2 ring-yellow-200 font-bold':''}">${formatPrice(p.itemPrice)}</td>`).join('')}
                        </tr>
                        <tr class="border-t">
                            <td class="p-3 font-semibold bg-gray-50">評価</td>
                            ${items.map(p => `<td class="p-3 ${Number(p.reviewAverage||0)===best.rating?'bg-yellow-50 ring-2 ring-yellow-200 font-bold':''}">⭐ ${formatRating(p.reviewAverage)} / 5.00</td>`).join('')}
                        </tr>
                        <tr class="border-t">
                            <td class="p-3 font-semibold bg-gray-50">レビュー件数</td>
                            ${items.map(p => `<td class="p-3 ${Number(p.reviewCount||0)===best.reviews?'bg-yellow-50 ring-2 ring-yellow-200 font-bold':''}">${Number(p.reviewCount||0).toLocaleString()}件</td>`).join('')}
                        </tr>
                        <tr class="border-t">
                            <td class="p-3 font-semibold bg-gray-50">機能・特徴</td>
                            ${items.map(p => `<td class="p-3">${(p.tags||[]).map(t=>`<span class='chip'>${t}</span>`).join(' ')}</td>`).join('')}
                        </tr>
                        <tr class="border-t">
                            <td class="p-3 font-semibold bg-gray-50">総合評価</td>
                            ${scored.map(p => `<td class="p-3">${toStars(p.score)}<br><small>(${((p.score||0)*100).toFixed(1)}点)</small></td>`).join('')}
                        </tr>
                    </tbody>
                </table>
                <div class="mt-4 text-xs text-gray-600">
                    <p>※ 価格・在庫は変動します。最新情報は各商品のリンク先でご確認ください。</p>
                    <p>※ 総合評価は当サイト独自のスコア（価格・評価・人気の総合値）です。</p>
                </div>
            `;
            const backdrop = ensureCompareModal();
            const body = backdrop.querySelector('#compare-modal-body');
            body.innerHTML = table;
            backdrop.style.display = 'flex';
            document.body.classList.add('modal-open');
        } catch {}
    }

    // --- 外部JSON読み込み（成功時のみ差し替え） ---
    async function tryLoadExternalData() {
        try {
            const m = location.pathname.match(/\/article\/(series\d+)\/(\d+-\d+)\.html$/);
            if (!m) return;
            const series = m[1];
            const slug = m[2];
            const rel = `../../site_data/${series}/${slug}.json`;
            const res = await fetch(rel, { cache: 'no-cache' });
            if (!res.ok) return;
            const data = await res.json();
            if (!Array.isArray(data) || data.length === 0) return;
            // 差し替え
            state.products = augmentProducts(data);
            state.priceBounds = computePriceBounds(state.products);
            // UI初期化の一部を更新
            if (priceMinInput) priceMinInput.value = '';
            if (priceMaxInput) priceMaxInput.value = '';
            if (priceRangeQuick) priceRangeQuick.value = 0;
            // タグ再構築
            initTags();
            // 再描画
            renderTop3();
            applyAll();
            // データ更新日
            const du = document.getElementById('data-updated');
            if (du) {
                try { du.textContent = new Date().toISOString().slice(0,10); } catch {}
            }
        } catch {}
    }

    // --- 状態の保存/復元 ---
    function saveAppState() {
        try {
            const obj = {
                sortBy: state.sortBy,
                filters: {
                    keyword: state.filters.keyword || '',
                    priceMin: state.filters.priceMin,
                    priceMax: state.filters.priceMax,
                    rating: state.filters.rating,
                    reviews: state.filters.reviews,
                    tags: Array.from(state.filters.tags || []),
                    favOnly: !!state.filters.favOnly,
                },
            };
            localStorage.setItem('state', JSON.stringify(obj));
        } catch {}
    }
    function restoreAppState() {
        try {
            const raw = localStorage.getItem('state');
            if (!raw) return;
            const saved = JSON.parse(raw);
            if (saved.sortBy) state.sortBy = saved.sortBy;
            if (saved.filters) {
                const f = saved.filters;
                state.filters.keyword = f.keyword || '';
                state.filters.priceMin = (f.priceMin ?? null);
                state.filters.priceMax = (f.priceMax ?? null);
                state.filters.rating = Number(f.rating || 0);
                state.filters.reviews = Number(f.reviews || 0);
                state.filters.tags = new Set(Array.isArray(f.tags) ? f.tags : []);
                state.filters.favOnly = !!f.favOnly;
            }
            // UIへ反映
            if (searchBox) searchBox.value = state.filters.keyword || '';
            if (priceMinInput) priceMinInput.value = state.filters.priceMin ?? '';
            if (priceMaxInput) priceMaxInput.value = state.filters.priceMax ?? '';
            if (filterRating) filterRating.value = state.filters.rating || 0;
            if (labelRating) labelRating.textContent = (state.filters.rating || 0).toFixed(1);
            if (filterReview) filterReview.value = state.filters.reviews || 0;
            if (labelReview) labelReview.textContent = String(state.filters.reviews || 0);
            if (favOnlyCheckbox) favOnlyCheckbox.checked = !!state.filters.favOnly;
            if (tagsContainer && state.filters.tags.size) {
                tagsContainer.querySelectorAll('button[data-tag]').forEach(btn => {
                    btn.classList.toggle('chip-selected', state.filters.tags.has(btn.dataset.tag));
                });
            }
        } catch {}
    }
});
