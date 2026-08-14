// ===========================================================================
// 05-scans.js — Tutarlılık ve üslup taramaları
// Bu dosya app.js'in bölünmesiyle oluştu. Tüm tanımlar GLOBAL kapsamda
// kalır (modül sistemi yok); index.html'de SIRAYLA yüklenir.
// ===========================================================================

// ---------------------------------------------------------------------
// Tüm Roman Tutarlılık Taraması
// ---------------------------------------------------------------------

function renderFullScanView(container) {
  (container || main()).innerHTML = `
    <p style="color:var(--text-muted);font-size:13.5px;max-width:600px;">Yazılmış tüm bölümleri tek seferde Qwen'e gönderip roman geneli tutarsızlıkları arar (karakter bilgisi çelişkileri, zaman çizelgesi hataları, kural ihlalleri). Uzun romanlarda biraz sürebilir.</p>
    <button class="btn btn-primary" id="startScanBtn">Taramayı Başlat</button>
    <div id="scanResult" style="margin-top:20px;"></div>`;

  // Önceki tarama varsa göster (yeniden çalıştırmadan)
  const oncekiTutarlilik = loadGlobalScan('fullscan');
  if (oncekiTutarlilik) {
    const el = (container || main()).querySelector('#scanResult');
    if (el) el.innerHTML = `<div style="font-size:11.5px;color:var(--text-muted);background:var(--paper-dim);padding:6px 8px;border-radius:6px;">
      📦 Kayıtlı tarama (${scanAgeLabel(oncekiTutarlilik)}) - yeniden çalıştırmak için düğmeye bas.</div>`
      + renderScanIssues(oncekiTutarlilik.veri);
  }
  document.getElementById('startScanBtn').addEventListener('click', async () => {
    const resultEl = document.getElementById('scanResult');
    resultEl.innerHTML = `<div class="empty-state">Qwen tüm romanı okuyor, bu biraz sürebilir…</div>`;
    try {
      const result = await api.post('/ai/full-scan', {});
      saveGlobalScan('fullscan', result);   // sonuç saklanır - baştan çalışmasın
      resultEl.innerHTML = renderScanIssues(result);
    } catch (err) {
      resultEl.innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`;
    }
  });
}



async function renderSearchResults(q) {
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  main().innerHTML = `
    <h1 class="view-title">Arama: "${escapeHtml(q)}"</h1>
    <div class="toolbar">
      <select id="typeFilter">
        <option value="">Tüm tipler</option>
        <option value="character">Kişi</option>
        <option value="place">Mekan</option>
        <option value="event">Olay</option>
        <option value="object">Nesne</option>
        <option value="foreshadowing">İpucu</option>
        <option value="term">Terim</option>
        <option value="metin">Serbest Metin</option>
      </select>
      <div></div>
    </div>
    <div id="searchResults" class="search-results"><div class="empty-state">Aranıyor…</div></div>`;

  let allResults = [];
  try {
    allResults = await api.get(`/chapters/search?q=${encodeURIComponent(q)}`);
  } catch (err) {
    el('searchResults').innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`;
    return;
  }

  function draw() {
    const filterType = el('typeFilter').value;
    const results = filterType ? allResults.filter(r => r.entity_type === filterType) : allResults;
    const el = document.getElementById('searchResults');
    if (!results.length) { el.innerHTML = '<div class="empty-state">Sonuç bulunamadı.</div>'; return; }
    el.innerHTML = results.map(r => `
      <div class="search-result-item" data-chapter="${r.chapter_number}">
        <strong>${r.entity_name ? escapeHtml(r.entity_name) : 'Serbest metin eşleşmesi'}</strong> — Bölüm ${r.chapter_number}, Paragraf ${r.paragraph_number}
        <div style="color:var(--text-muted);margin-top:3px;">${escapeHtml(r.text_preview)}</div>
      </div>`).join('');
    el.querySelectorAll('.search-result-item').forEach(item => {
      item.addEventListener('click', async () => {
        await switchView('roman');
        const chapters = await api.get('/chapters/');
        const target = chapters.find(c => c.number === parseInt(item.dataset.chapter, 10));
        if (target) selectChapter(target.id);
      });
    });
  }

  document.getElementById('typeFilter').addEventListener('change', draw);
  draw();
}

// ---------------------------------------------------------------------
// Başlangıç
// ---------------------------------------------------------------------

// ---------------------------------------------------------------------
// Roman seçimi
// ---------------------------------------------------------------------

async function loadAndRenderNovelList() {
  const listEl = document.getElementById('novelList');
  listEl.innerHTML = '<div class="empty-state">Yükleniyor…</div>';
  const novels = await api.get('/novels/');
  if (!novels.length) {
    listEl.innerHTML = '<div class="empty-state">Henüz roman yok - aşağıdan ilkini oluştur.</div>';
    return novels;
  }

  // Aynı evrendeki (serideki) kitapları grupluyoruz - karakterler/mekanlar/
  // kurallar artık kitap değil EVREN düzeyinde paylaşıldığı için (bkz.
  // backend Universe/Novel modeli), bunu görsel olarak da yansıtmak lazım:
  // "hangi kitaplar aynı dünyayı paylaşıyor" tek bakışta belli olsun.
  const groups = new Map();
  novels.forEach(n => {
    const key = n.universe_id != null ? `u${n.universe_id}` : `n${n.id}`;
    if (!groups.has(key)) groups.set(key, { universeId: n.universe_id, universeName: n.universe_name || n.name, novels: [] });
    groups.get(key).novels.push(n);
  });
  groups.forEach(g => g.novels.sort((a, b) => (a.book_number ?? 999) - (b.book_number ?? 999)));

  listEl.innerHTML = Array.from(groups.values()).map(g => `
    <div class="universe-group">
      <div class="universe-group-header">
        <span>${escapeHtml(g.universeName)}${g.novels.length > 1 ? ` <span style="font-weight:400;color:var(--text-muted);">— ${g.novels.length} kitap</span>` : ''}</span>
        ${g.universeId != null ? `<button class="btn-icon-sm delete-universe-btn" data-id="${g.universeId}" data-name="${escapeHtml(g.universeName)}" title="Bu SERİNİN tamamını (tüm kitaplar + karakterler/mekanlar/kurallar) sil">🗑️ Seriyi tamamen sil</button>` : ''}
      </div>
      ${g.novels.map(n => `
        <div class="novel-list-item" data-id="${n.id}">
          <span>${n.book_number ? `Kitap ${n.book_number}: ` : ''}${escapeHtml(n.name)}</span>
          <div class="actions">
            <button class="btn btn-sm rename-novel-btn" data-id="${n.id}" data-name="${escapeHtml(n.name)}">Yeniden adlandır</button>
            <button class="btn btn-sm btn-danger delete-novel-btn" data-id="${n.id}">Bu kitabı sil</button>
          </div>
        </div>`).join('')}
      ${g.universeId != null ? `<button class="btn btn-sm add-book-btn" data-universe-id="${g.universeId}" style="margin:2px 0 12px;">+ Bu seriye yeni kitap ekle</button>` : ''}
    </div>`).join('');

  listEl.querySelectorAll('.novel-list-item').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.actions')) return;
      selectNovelAndStart(el.dataset.id);
    });
  });
  listEl.querySelectorAll('.rename-novel-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const newName = prompt('Yeni kitap adı:', btn.dataset.name);
      if (!newName || !newName.trim()) return;
      await api.put(`/novels/${btn.dataset.id}`, { name: newName.trim() });
      loadAndRenderNovelList();
    });
  });
  listEl.querySelectorAll('.delete-novel-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      // ÖNEMLİ: artık sadece bu KİTABIN bölüm/paragrafları silinir -
      // karakterler/mekanlar/kurallar gibi seri genelinde paylaşılan veri
      // SİLİNMEZ (başka kitaplarda hâlâ kullanılıyor olabilir).
      if (!confirm('Bu kitabın bölüm/paragraflarını kalıcı olarak silmek istediğine emin misin?\n\nKarakterler/mekanlar/kurallar gibi seri genelinde paylaşılan veriler SİLİNMEYECEK (varsa diğer kitaplarda kullanılmaya devam eder).')) return;
      await api.del(`/novels/${btn.dataset.id}`);
      if (getNovelId() === btn.dataset.id) clearNovelId();
      loadAndRenderNovelList();
    });
  });
  listEl.querySelectorAll('.delete-universe-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const name = btn.dataset.name;
      if (!confirm(`"${name}" SERİSİNİN TAMAMINI silmek üzeresin: bu seriye ait TÜM kitaplar, TÜM bölümler/paragraflar VE karakterler/mekanlar/kurallar/ilişkiler/gelişim çizelgesi/olaylar/faksiyonlar dahil HER ŞEY kalıcı olarak silinecek.\n\nBu işlem GERİ ALINAMAZ. Emin misin?`)) return;
      if (!confirm('Son kez soruyorum - gerçekten TÜM SERİYİ silmek istiyor musun?')) return;
      await api.del(`/universes/${btn.dataset.id}`);
      if (novels.some(n => n.universe_id != null && String(n.universe_id) === btn.dataset.id && String(n.id) === getNovelId())) clearNovelId();
      loadAndRenderNovelList();
    });
  });
  listEl.querySelectorAll('.add-book-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const name = prompt('Yeni kitabın adı (ör. "Kışın Külleri - Kitap 2"):');
      if (!name || !name.trim()) return;
      const bookNumberRaw = prompt('Kaçıncı kitap? (boş bırakabilirsin, sadece gösterim için kullanılır):');
      const book_number = bookNumberRaw && bookNumberRaw.trim() ? parseInt(bookNumberRaw.trim(), 10) : null;
      try {
        const novel = await api.post('/novels/', { name: name.trim(), universe_id: parseInt(btn.dataset.universeId, 10), book_number });
        selectNovelAndStart(novel.id);
      } catch (err) { alert(err.message); }
    });
  });
  return novels;
}

function selectNovelAndStart(novelId) {
  setNovelId(novelId);
  window.location.reload();
}

function showNovelSelectScreen() {
  el('novelSelectOverlay').style.display = 'flex';
  loadAndRenderNovelList();
  document.getElementById('createNovelBtn').addEventListener('click', async () => {
    const input = document.getElementById('newNovelName');
    const name = input.value.trim();
    if (!name) return;
    const novel = await api.post('/novels/', { name });
    selectNovelAndStart(novel.id);
  });
}

async function initApp() {
  if (!getToken()) {
    window.location.href = '/app/login.html';
    return;
  }

  const novelId = getNovelId();
  if (!novelId) {
    showNovelSelectScreen();
    return;
  }

  // Kayıtlı roman hâlâ var mı diye doğrula (silinmiş olabilir)
  let novels;
  try {
    novels = await api.get('/novels/');
  } catch (err) {
    showNovelSelectScreen();
    return;
  }
  const activeNovel = novels.find(n => String(n.id) === String(novelId));
  if (!activeNovel) {
    clearNovelId();
    showNovelSelectScreen();
    return;
  }

  el('activeNovelName').textContent = activeNovel.name;
  // Kalıcı üst çubuk: "Seri · Kitap N: Ad" - her görünümde, mobilde de
  // görünür. Tıklayınca seçim ekranı YERİNDE açılır (sayfa yenilenmez,
  // aktif kitap kaybolmaz - ✕ ile vazgeçilebilir).
  const bar = document.getElementById('activeNovelBar');
  const barText = document.getElementById('activeNovelBarText');
  const seriesPart = activeNovel.universe_name ? `${activeNovel.universe_name} · ` : '';
  const bookPart = activeNovel.book_number ? `Kitap ${activeNovel.book_number}: ` : '';
  barText.textContent = `${seriesPart}${bookPart}${activeNovel.name}`;
  bar.style.display = '';
  const openSwitcher = async () => {
    await loadAndRenderNovelList();
    const closeBtn = document.getElementById('closeNovelSelectBtn');
    closeBtn.style.display = '';  // aktif kitap varken vazgeçilebilir
    closeBtn.onclick = () => { el('novelSelectOverlay').style.display = 'none'; };
    el('novelSelectOverlay').style.display = 'flex';
  };
  bar.addEventListener('click', openSwitcher);
  document.getElementById('switchNovelBtn').addEventListener('click', openSwitcher);

  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      switchView(btn.dataset.view);
      document.body.classList.remove('sidebar-open'); // mobilde menüden seçince kapansın
    });
  });
  document.getElementById('mobileMenuToggle')?.addEventListener('click', () => {
    document.body.classList.toggle('sidebar-open');
  });
  document.getElementById('sidebarOverlay')?.addEventListener('click', () => {
    document.body.classList.remove('sidebar-open');
  });
  document.getElementById('logoutBtn').addEventListener('click', () => {
    clearToken();
    window.location.href = '/app/login.html';
  });
  document.getElementById('globalSearch').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.value.trim()) {
      const query = e.target.value.trim();
      const pMatch = query.match(/^[Pp](\d+)$/);
      if (pMatch) {
        jumpToParagraphById(parseInt(pMatch[1], 10));
      } else {
        renderSearchResults(query);
      }
    }
  });
  switchView('roman');
}

async function jumpToParagraphById(paragraphId) {
  try {
    const info = await api.get(`/chapters/paragraph/${paragraphId}`);
    switchView('roman');
    await loadChapterList(info.chapter_id);
    setTimeout(() => {
      const el = document.getElementById(`para-global-${paragraphId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.style.transition = 'background 0.3s';
        el.style.background = 'var(--gold-dim, #fdf3d8)';
        setTimeout(() => { el.style.background = ''; }, 2000);
      }
    }, 300);
  } catch (err) {
    alert(err.message);
  }
}

initApp();

// ---------------------------------------------------------------------------
// ÜSLUP TARAMASI: yazım tiki dedektörü. Backend'deki /style uçlarını kullanır.
// "Tara" tüm seriyi regex'lerle sayar (AI çağrısı yok, ücretsiz), sonuç
// önbelleklenir; eşiği aşan kalıplar her AI isteğinin context'ine otomatik
// "bundan kaçın" uyarısı olarak girer. Kalıplar buradan eklenip düzenlenir.
// ---------------------------------------------------------------------------
function renderStyleScanView(container) {
  (container || main()).innerHTML = `
    <p style="color:var(--text-muted);font-size:13.5px;max-width:640px;">
      Serinin tüm metnini tarayıp "gibi / sanki / X yerine Y" tarzı aşırı kullanılan
      yazım tiklerini sayar. Eşiği aşan kalıplar, bir sonraki taramaya kadar her AI
      isteğine otomatik olarak <b>"bu kalıptan kaçın"</b> uyarısı olarak eklenir.
      Tarama AI kullanmaz, ücretsizdir.</p>
    <button class="btn btn-primary" id="styleScanBtn">Taramayı Başlat</button>
    <button class="btn" id="suggestPatternsBtn" title="Romandan örnek pasajlar alıp AI'ya 'hangi YAPI tekrar ediyor' diye sorar - yeni kalıp adayları önerir, onaysız kaydetmez">🔎 AI Yeni Kalıp Önersin</button>
    <div id="patternCandidates"></div>
    <div id="styleReport" style="margin-top:18px;"></div>
    <h2 style="margin-top:28px;font-size:16px;">Kalıplar</h2>
    <p style="color:var(--text-muted);font-size:12.5px;max-width:640px;">
      Regex'leri <b>küçük harfle</b> yaz (tarama Türkçe'ye uygun küçültme yapar).
      Bir kalıp "aşırı" sayılmak için <b>iki eşiği birden</b> aşmalı: 1000 kelimedeki
      yoğunluk VE toplam tekrar sayısı - böylece kısa metinlerde tek kelime yanlış alarm vermez.</p>
    <div id="stylePatterns"></div>
    <div class="panel" style="margin-top:12px;max-width:640px;">
      <div class="field"><label>Yeni kalıp adı</label><input type="text" id="sp_name" placeholder="ör. 'bir an için'"></div>
      <div class="field"><label>Regex (küçük harf)</label><input type="text" id="sp_pattern" placeholder="\\bbir an için\\b"></div>
      <div style="display:flex;gap:12px;">
        <div class="field" style="flex:1;"><label>Yoğunluk eşiği (binde)</label><input type="number" id="sp_threshold" value="2.0" step="0.5" min="0"></div>
        <div class="field" style="flex:1;"><label>Min. tekrar</label><input type="number" id="sp_mincount" value="5" step="1" min="0"></div>
      </div>
      <label style="display:flex;align-items:center;gap:6px;font-size:12.5px;margin:4px 0;">
        <input type="checkbox" id="sp_refrain"> Nakarat (bilinçli leitmotif - sayılır ama asla "aşırı" uyarısı vermez)
      </label>
      <div class="form-actions"><button class="btn btn-primary" id="sp_addBtn">Kalıp Ekle</button></div>
      <div id="sp_error" class="error-text"></div>
    </div>`;

  document.getElementById('styleScanBtn').addEventListener('click', async () => {
    const el = document.getElementById('styleReport');
    el.innerHTML = `<div class="empty-state">Tüm seri taranıyor…</div>`;
    try {
      renderStyleReport(await api.post('/style/scan', {}));
    } catch (err) {
      el.innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`;
    }
  });

  document.getElementById('suggestPatternsBtn').addEventListener('click', async () => {
    const box = document.getElementById('patternCandidates');
    box.innerHTML = '<div class="empty-state">Roman taranıyor, tekrar eden yapılar aranıyor…</div>';
    try {
      const result = await api.post('/style/suggest-patterns', {});
      if (!result.candidates.length) {
        box.innerHTML = '<div style="font-size:12.5px;color:var(--text-muted);padding:6px 0;">Yeni kalıp adayı bulunamadı (ya da bulunanlar zaten kayıtlı).</div>';
        return;
      }
      box.innerHTML = `
        <div class="panel" style="margin-top:10px;">
          <strong style="font-size:11px;letter-spacing:0.4px;">AI KALIP ADAYLARI - onaysız kaydedilmez</strong>
          ${result.candidates.map((c, i) => `
            <div style="border-top:1px solid var(--border);padding:8px 0;">
              <b style="font-size:13px;">${escapeHtml(c.name)}</b>
              <span style="font-size:11px;color:var(--text-muted);">örneklemde ${c.sample_hits}×</span>
              <code style="display:block;font-size:11.5px;color:var(--text-muted);">${escapeHtml(c.pattern)}</code>
              ${c.example ? `<div style="font-size:12px;font-style:italic;color:var(--text-muted);">"${escapeHtml(c.example)}"</div>` : ''}
              ${c.why ? `<div style="font-size:12px;">${escapeHtml(c.why)}</div>` : ''}
              <button class="btn btn-sm btn-primary cand-add" data-idx="${i}" style="margin-top:5px;">Kalıp olarak ekle</button>
            </div>`).join('')}
        </div>`;
      box.querySelectorAll('.cand-add').forEach(btn => btn.addEventListener('click', async () => {
        const c = result.candidates[parseInt(btn.dataset.idx, 10)];
        try {
          await api.post('/style/patterns', {
            name: c.name, pattern: c.pattern,
            threshold_per_1000: 0.5, min_count: 3, notes: c.why || '',
          });
          btn.textContent = '✓ eklendi'; btn.disabled = true;
          await loadStylePatterns();
        } catch (err) { alert(err.message); }
      }));
    } catch (err) {
      box.innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`;
    }
  });

  document.getElementById('sp_addBtn').addEventListener('click', async () => {
    const errEl = document.getElementById('sp_error');
    errEl.textContent = '';
    try {
      await api.post('/style/patterns', {
        name: el('sp_name').value.trim(),
        pattern: el('sp_pattern').value.trim(),
        threshold_per_1000: parseFloat(el('sp_threshold').value) || 0,
        min_count: parseInt(el('sp_mincount').value, 10) || 0,
        is_refrain: el('sp_refrain').checked,
      });
      el('sp_name').value = '';
      el('sp_pattern').value = '';
      await loadStylePatterns();
    } catch (err) { errEl.textContent = err.message; }
  });

  // Açılışta: önbellekteki son rapor + kalıp listesi (ikisi de ucuz GET)
  (async () => {
    try {
      const report = await api.get('/style/report');
      if (report.scanned) renderStyleReport(report);
      else el('styleReport').innerHTML = `<div class="empty-state">Henüz tarama yapılmadı - "Taramayı Başlat"a bas.</div>`;
    } catch (e) { /* rapor yüklenemezse sessiz geç, buton hâlâ çalışır */ }
    await loadStylePatterns();
  })();
}

function renderStyleReport(report) {
  const el = document.getElementById('styleReport');
  if (!el) return;
  const when = report.scanned_at ? new Date(report.scanned_at).toLocaleString('tr-TR') : '';
  let html = `<div style="color:var(--text-muted);font-size:12.5px;margin-bottom:10px;">
    ${report.total_words.toLocaleString('tr-TR')} kelime, ${report.chapter_count} bölüm tarandı${when ? ' · ' + escapeHtml(when) : ''}</div>`;

  if (report.invalid_patterns && report.invalid_patterns.length) {
    html += report.invalid_patterns.map(p => `
      <div class="panel" style="border-left:4px solid var(--danger);margin-bottom:8px;">
        <b>${escapeHtml(p.name)}</b> taranamadı - regex hatalı: ${escapeHtml(p.error)}
      </div>`).join('');
  }

  const rows = report.patterns.map(p => {
    const worst = (p.worst_chapters || []).map(w => `${escapeHtml(w.label)} (${w.count}×)`).join(', ');
    const border = p.exceeded ? 'var(--danger)' : 'var(--border)';
    const badge = p.exceeded
      ? `<span style="color:var(--danger);font-weight:600;font-size:11px;text-transform:uppercase;">Aşırı - AI'ya uyarı gidiyor</span>`
      : (p.is_refrain
        ? `<span style="color:var(--text-muted);font-size:11px;">♪ nakarat - uyarı vermez</span>`
        : `<span style="color:var(--text-muted);font-size:11px;">eşik altında</span>`);
    return `
      <div class="panel" style="margin-top:8px;border-left:4px solid ${border};">
        <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;">
          <b>${escapeHtml(p.name)}</b>${badge}
        </div>
        <div style="font-size:13px;margin-top:4px;">
          ${p.count} tekrar · binde ${p.per_1000} <span style="color:var(--text-muted);">(eşik: binde ${p.threshold_per_1000} ve en az ${p.min_count} tekrar)</span>
        </div>
        ${worst ? `<div style="font-size:12.5px;color:var(--text-muted);margin-top:3px;">En yoğun: ${worst}</div>` : ''}
      </div>`;
  }).join('');
  el.innerHTML = html + (rows || `<div class="empty-state">Etkin kalıp yok.</div>`);
}

async function loadStylePatterns() {
  const el = document.getElementById('stylePatterns');
  if (!el) return;
  try {
    const patterns = await api.get('/style/patterns');
    el.innerHTML = patterns.map(p => `
      <div class="panel" style="margin-top:8px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
        <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;">
          <input type="checkbox" class="sp-enabled" data-id="${p.id}" ${p.enabled ? 'checked' : ''}> etkin
        </label>
        <div style="flex:1;min-width:180px;">
          <b style="font-size:13.5px;">${escapeHtml(p.name)}</b>${p.is_refrain ? ' <span style="font-size:10px;background:var(--paper-dim);border:1px solid var(--border);border-radius:3px;padding:0 4px;" title="Nakarat: sayılır ama uyarıya dönüşmez">♪ nakarat</span>' : ''}
          <code style="display:block;font-size:12px;color:var(--text-muted);">${escapeHtml(p.pattern)}</code>
        </div>
        <div style="font-size:12px;color:var(--text-muted);">binde ${p.threshold_per_1000} · min ${p.min_count}</div>
        <button class="btn btn-sm sp-del" data-id="${p.id}">Sil</button>
      </div>`).join('');

    el.querySelectorAll('.sp-enabled').forEach(cb => cb.addEventListener('change', async () => {
      try { await api.put(`/style/patterns/${cb.dataset.id}`, { enabled: cb.checked }); }
      catch (err) { alert(err.message); cb.checked = !cb.checked; }
    }));
    el.querySelectorAll('.sp-del').forEach(btn => btn.addEventListener('click', async () => {
      if (!confirm('Bu kalıbı silmek istediğine emin misin?')) return;
      try { await api.del(`/style/patterns/${btn.dataset.id}`); await loadStylePatterns(); }
      catch (err) { alert(err.message); }
    }));
  } catch (err) {
    el.innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`;
  }
}

// ---------------------------------------------------------------------------
// PLAN MATRİSİ: Excel benzeri eşleştirme tablosu. Üstte kolonlar (kişiler/
// turlar), yanda satırlar (aşamalar), hücrelerde madde madde plan. Bir hücre
// bir bölüme bağlıysa, o bölüm yazılırken plan AI context'ine otomatik girer.
// "Fihristi Oluştur": her kolon bir KISIM, her hücre bir BÖLÜM olur.
// ---------------------------------------------------------------------------
let currentMatrixId = null;
