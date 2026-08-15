// ===========================================================================
// 03-chapters.js — Roman görünümü, fihrist, okuyucu, paragraf düzenleme
// Bu dosya app.js'in bölünmesiyle oluştu. Tüm tanımlar GLOBAL kapsamda
// kalır (modül sistemi yok); index.html'de SIRAYLA yüklenir.
// ===========================================================================

async function renderRomanView() {
  main().innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:baseline;">
      <h1 class="view-title">Roman</h1>
      <span id="wordCountBadge" style="font-size:12.5px;color:var(--text-muted);"></span>
    </div>
    <div class="toolbar">
      <div></div>
      <div style="position:relative;">
        <button class="btn btn-primary" id="newChapterBtn">+ Yeni</button>
        <div id="newChapterMenu" style="display:none;position:absolute;right:0;top:110%;background:#fff;border:1px solid var(--border);border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.08);z-index:10;min-width:180px;">
          <button class="btn btn-sm" data-kind="chapter" style="display:block;width:100%;text-align:left;border:none;border-radius:0;">Yeni Bölüm</button>
          <button class="btn btn-sm" data-kind="part" style="display:block;width:100%;text-align:left;border:none;border-radius:0;">Yeni Başlık (Kısım)</button>
          <button class="btn btn-sm" data-kind="subtitle" style="display:block;width:100%;text-align:left;border:none;border-radius:0;">Yeni Alt Başlık</button>
        </div>
      </div>
    </div>
    <div class="roman-layout">
      <div class="chapter-list" id="chapterList"><div class="empty-state">Yükleniyor…</div></div>
      <div id="bulkScanPanel" style="display:none;grid-column:1;"></div>
      <div class="reader" id="readerPane"><div class="empty-state">Bir bölüm seç ya da yeni oluştur.</div></div>
      <div class="side-panel" id="aiPanel"></div>
    </div>
    <div id="createItemModalOverlay" style="display:none;position:fixed;inset:0;background:rgba(10,12,20,0.45);z-index:50;align-items:center;justify-content:center;"></div>`;

  el('newChapterBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    const menu = document.getElementById('newChapterMenu');
    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
  });
  document.querySelectorAll('#newChapterMenu button').forEach(btn => {
    btn.addEventListener('click', () => {
      el('newChapterMenu').style.display = 'none';
      openCreateItemModal(btn.dataset.kind);
    });
  });
  document.addEventListener('click', () => {
    const menu = document.getElementById('newChapterMenu');
    if (menu) menu.style.display = 'none';
  });
  await loadChapterList();
  loadWordCount();
}

async function loadWordCount() {
  const badge = document.getElementById('wordCountBadge');
  try {
    const stats = await api.get('/chapters/stats');
    badge.textContent = `Toplam ${stats.total_words.toLocaleString('tr-TR')} kelime`;
  } catch (err) { /* sessizce geç */ }
}

// Başlık (part) ve Alt Başlık (subtitle) satırları artık Word'deki taslak
// (outline) görünümü gibi hiyerarşik: bir Başlık'ın altındaki Alt Başlık ve
// Bölümler ona "ait" sayılır (sırayla belirlenir - novel_id+number'a göre
// gelen liste zaten sıralı). collapsedGroups, kullanıcının kapattığı
// Başlık/Alt Başlık id'lerini tutar - liste her yeniden çizildiğinde
// (API'den yeniden çekmeden) bu set'e bakılarak hangi satırların
// gizleneceğine karar verilir.
let lastLoadedChapters = [];
const collapsedGroups = new Set();

// --- Daraltma durumu KALICI: roman başına localStorage'da tutulur -----------
// Eskiden collapsedGroups salt bellekteydi - her sayfa yenilemede/görünüm
// değişiminde her şey yeniden AÇIK geliyordu ve uzun bir fihrist her
// seferinde yeniden yönetilemez hale dönüyordu. Şimdi:
//   1. Her daralt/genişlet anında durum kaydedilir, yenilemede geri yüklenir.
//   2. HİÇ kayıt yoksa (ilk açılış) ve liste uzunsa (>15 girdi) tüm
//      Kısım/Alt Başlıklar DARALTIK başlar - açılışta seçilen bölümün
//      ataları otomatik açıldığı için (bkz. expandAncestorsOf) kullanıcı
//      "çalıştığı bölge açık, gerisi kapalı" bir taslak görünümüyle karşılaşır.
//   3. Silinmiş başlıkların id'leri geri yüklenirken ayıklanır (birikmez).
function collapsedStorageKey() { return `roman_collapsed_${getNovelId() || 'none'}`; }

function saveCollapsedGroups() {
  try { localStorage.setItem(collapsedStorageKey(), JSON.stringify([...collapsedGroups])); } catch (e) { /* özel modda dolu olabilir */ }
}

function loadCollapsedGroups(hierarchy) {
  collapsedGroups.clear();
  const validIds = new Set(hierarchy.filter(it => it.hasChildren).map(it => String(it.chapter.id)));
  let saved = null;
  try { saved = localStorage.getItem(collapsedStorageKey()); } catch (e) { /* yoksay */ }
  if (saved !== null) {
    try {
      for (const id of JSON.parse(saved)) if (validIds.has(String(id))) collapsedGroups.add(String(id));
      return;
    } catch (e) { /* bozuk kayıt - varsayılana düş */ }
  }
  if (hierarchy.length > 15) validIds.forEach(id => collapsedGroups.add(id));
}

// Bir bölüme gidilirken onu içeren Kısım/Alt Başlık kapalıysa otomatik açar
// - kapalı bir grubun içindeki bölüm seçilince listede "kaybolmuş" gibi
// görünmesin. Değişiklik olduysa listeyi yeniden çizer ve true döner.
function expandAncestorsOf(chapterId) {
  const hierarchy = buildChapterHierarchy(lastLoadedChapters);
  const item = hierarchy.find(it => String(it.chapter.id) === String(chapterId));
  if (!item || !item.ancestorIds.length) return false;
  let changed = false;
  for (const aid of item.ancestorIds) if (collapsedGroups.delete(String(aid))) changed = true;
  if (changed) { saveCollapsedGroups(); renderChapterListDOM(); }
  return changed;
}

function buildChapterHierarchy(chapters) {
  const items = [];
  let currentPartId = null;
  let currentSubtitleId = null;
  // Klasik taslak (outline) numaralaması: Kısım 1 -> "1", altındaki Alt
  // Başlık/Bölüm -> "1-1", onun altındaki Bölüm -> "1-1-1". Her seviyenin
  // kendi sayacı var; bir üst seviye ilerleyince alt seviyelerin sayaçları
  // sıfırlanır (yeni bir Kısım başlayınca alt numaralama 1'den başlar).
  const counters = [0, 0, 0, 0, 0];
  // BÖLÜM DE KAPSAYICI OLABİLİR: gerçek romanlarda "BİRİNCİ BÖLÜM"ün
  // altında turlar/sahneler (Alt Başlık) yer alabiliyor. Bir Bölüm'ün
  // hemen ardından bir Alt Başlık geliyorsa, o Bölüm kapsayıcı sayılır -
  // kendi ▾ oku olur ve daraltılınca altındaki tüm alt başlıklar ve
  // onların bölümleri birlikte gizlenir (Word taslak görünümü gibi).
  // Böylece kullanıcı yapısını Kısım'a çevirmeye ZORLANMAZ.
  let currentChapterContainerId = null;
  // Kapsayıcı bölüm: hemen ardından bir Alt Başlık YA DA Kısım geliyorsa.
  // Kısım'ın da kapsanabilmesi, dört seviyeli ağaca izin verir:
  //   BÖLÜM (kapsayıcı) > KISIM > ALT BAŞLIK > bölümler
  // Word'ün Başlık1>Başlık2>Başlık3 yapısının karşılığı budur.
  // İki koşuldan biri sağlanmalı:
  //  a) ardından bir KISIM geliyorsa (Kısım yaprak bölümün altına giremez,
  //     demek ki bu bölüm bir üst başlıktır), ya da
  //  b) ardından Alt Başlık geliyor VE o an açık bir Kısım yok (Kısım
  //     varsa bölüm zaten onun yaprağıdır - alt başlık da Kısım'a bağlanır).
  // Ayırt edici sinyal: BAŞLIKLARIN METNİ YOKTUR. "BİRİNCİ BÖLÜM" gibi
  // üst başlık olarak kullanılan girdiler boştur; gerçek bölümlerin
  // paragrafı vardır. Bu yüzden bir Bölüm ancak (a) paragrafı yoksa ve
  // (b) ardından bir Kısım/Alt Başlık geliyorsa kapsayıcı sayılır.
  // Böylece bir turun SON bölümü (metni var), ardından yeni bir Kısım
  // gelse bile yaprak kalır - Kısım kardeş olarak üst başlığa bağlanır.
  const isContainerChapter = (idx) => {
    const c = chapters[idx];
    if (!c || c.kind !== 'chapter') return false;
    if ((c.paragraphs || []).length > 0) return false;
    // Zaten bir başlığın ALTINDAYSA kapsayıcı olamaz - kardeşlerini yutmasın
    if (currentPartId || currentSubtitleId) return false;
    const next = chapters[idx + 1];
    return !!next && (next.kind === 'part' || next.kind === 'subtitle');
  };
  for (let idx = 0; idx < chapters.length; idx++) {
    const c = chapters[idx];
    const id = String(c.id);
    let level, ancestorIds;
    if (c.kind === 'part') {
      // Kısım artık MUTLAK üst seviye değil: bir kapsayıcı Bölüm'ün altına
      // girebilir (varsa). Yoksa eskisi gibi en üstte kalır.
      ancestorIds = currentChapterContainerId ? [currentChapterContainerId] : [];
      level = ancestorIds.length;
      currentPartId = id;
      currentSubtitleId = null;
    } else if (c.kind === 'subtitle') {
      ancestorIds = [];
      if (currentChapterContainerId) ancestorIds.push(currentChapterContainerId);
      if (currentPartId) ancestorIds.push(currentPartId);
      level = ancestorIds.length;
      currentSubtitleId = id;
    } else if (isContainerChapter(idx)) {
      // Kapsayıcı Bölüm en üst seviyede yeni bir ağaç başlatır - altındaki
      // Kısım/Alt Başlık zinciri sıfırdan kurulur.
      ancestorIds = [];
      level = 0;
      currentChapterContainerId = id;
      currentPartId = null;
      currentSubtitleId = null;
    } else {
      ancestorIds = [];
      if (currentChapterContainerId) ancestorIds.push(currentChapterContainerId);
      if (currentPartId) ancestorIds.push(currentPartId);
      if (currentSubtitleId) ancestorIds.push(currentSubtitleId);
      level = ancestorIds.length;
    }
    counters[level] = (counters[level] || 0) + 1;
    for (let l = level + 1; l < counters.length; l++) counters[l] = 0;
    const displayNumber = counters.slice(0, level + 1).join('-');
    items.push({ chapter: c, level, ancestorIds, displayNumber });
  }
  // Daraltılabilirlik: HER Kısım/Alt Başlık daraltılabilir sayılır.
  // Eskiden şart "hemen altında daha derin bir girdi olması"ydı; bu,
  // altına henüz bölüm eklenmemiş (ama kendi paragrafları olan ya da
  // sonradan doldurulacak) başlıklarda oku hiç göstermiyordu ve kullanıcı
  // "daraltma butonu nerede?" diye arıyordu. Artık ok her zaman var:
  // altı boşsa daraltmak sadece başlığı tek satıra indirir - zararsız,
  // beklenen davranış.
  // Ok kimde çıkar: her Kısım/Alt Başlık'ta ve KAPSAYICI bölümlerde
  // (altında gerçekten daha derin girdi olan bölümler).
  items.forEach((item, idx) => {
    if (item.chapter.kind !== 'chapter') { item.hasChildren = true; return; }
    item.hasChildren = idx + 1 < items.length && items[idx + 1].level > item.level;
  });
  return items;
}

// Bir Kısım/Alt Başlık'ın altındaki İLK gerçek bölümü bulur - başlığa
// tıklanınca artık düzenleme değil, doğrudan o bölüme gitme davranışı
// için kullanılır (bkz. renderChapterListDOM). Daraltılmış (collapsed)
// olması bu aramayı etkilemez - veri her zaman tam listede aranır.
function findFirstChapterUnder(dividerId) {
  const hierarchy = buildChapterHierarchy(lastLoadedChapters);
  const idx = hierarchy.findIndex(item => String(item.chapter.id) === String(dividerId));
  if (idx === -1) return null;
  const dividerLevel = hierarchy[idx].level;
  for (let i = idx + 1; i < hierarchy.length; i++) {
    if (hierarchy[i].level <= dividerLevel) break; // Kısım/Alt Başlık'ın dışına çıkıldı
    if (hierarchy[i].chapter.kind === 'chapter') return hierarchy[i].chapter;
  }
  return null;
}

async function loadChapterList(selectId, skipSelect) {
  const listEl = document.getElementById('chapterList');
  try {
    const chapters = await api.get('/chapters/');
    lastLoadedChapters = chapters;
    if (!chapters.length) {
      listEl.innerHTML = `<div class="empty-state">Henüz bölüm yok.</div>`;
      if (!skipSelect) renderAiPanel(null);
      return;
    }
    // Kaydedilmiş daraltma durumunu (ya da ilk açılış varsayılanını) yükle -
    // her API yenilemesinde çağrılır; durum zaten her mutasyonda kaydedildiği
    // için bellek ile localStorage hiç ayrışmaz.
    loadCollapsedGroups(buildChapterHierarchy(chapters));
    renderChapterListDOM();
    if (skipSelect) return;
    const firstRealChapter = chapters.find(c => c.kind === 'chapter');
    if (selectId || firstRealChapter) selectChapter(selectId || firstRealChapter.id);
  } catch (err) {
    listEl.innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`;
  }
}

// API'ye tekrar gitmeden, sadece açma/kapama ya da düzenleme sonrası liste
// HTML'ini yeniden çizer - collapsedGroups değiştiğinde de bu çağrılır.
function renderChapterListDOM() {
  const listEl = document.getElementById('chapterList');
  const chapters = lastLoadedChapters;
  const hierarchy = buildChapterHierarchy(chapters);

  // Liste (özellikle uzun bir romanda yüzlerce Kısım/Bölüm birikince) çok
  // uzayabiliyor - "Tümünü Daralt" tüm Kısım/Alt Başlık'ları tek tıkla
  // kapatıp sadece üst seviye başlıkları bırakır, "Tümünü Genişlet" hepsini
  // tekrar açar. Sadece GERÇEKTEN alt öğesi olan (hasChildren) girdiler
  // daraltılabilir olduğu için sadece onlar collapsedGroups'a eklenir.
  const collapsibleIds = hierarchy.filter(it => it.hasChildren).map(it => String(it.chapter.id));
  // Hiç daraltılabilir başlık yoksa (tüm girdiler düz 'chapter' ise) neden
  // ok görünmediğini AÇIKLA - kullanıcı "buton nerede?" diye aramasın.
  const noGroupsHint = !collapsibleIds.length && hierarchy.length > 3 ? `
    <div style="font-size:11px;color:var(--text-muted);padding:4px 10px;line-height:1.4;">
      Daraltma okları <b>Kısım</b> ve <b>Alt Başlık</b> girdilerinde çıkar.
      Listedeki tüm girdiler düz "Bölüm" türünde - birini ✎ ile açıp
      türünü Kısım/Alt Başlık yaparsan hem ▾ oku hem "Tümünü Daralt"
      belirir ve altındaki bölümler ona bağlanır.
    </div>` : '';
  const controlsHtml = collapsibleIds.length ? `
    <div style="display:flex;gap:6px;padding:8px 10px;border-bottom:1px solid var(--border);background:var(--paper-dim);">
      <button class="btn-icon-sm" id="collapseAllBtn" style="font-size:11px;">▸ Tümünü Daralt</button>
      <button class="btn-icon-sm" id="expandAllBtn" style="font-size:11px;">▾ Tümünü Genişlet</button>
    </div>` : '';

  listEl.innerHTML = controlsHtml + noGroupsHint + hierarchy.map(item => {
    const c = item.chapter;
    const hidden = item.ancestorIds.some(id => collapsedGroups.has(id));
    if (hidden) return '';
    const indent = item.level * 18;
    const cleanTitle = stripMarkdownArtifacts(c.title);

    if (c.kind === 'part' || c.kind === 'subtitle') {
      const isCollapsed = collapsedGroups.has(String(c.id));
      // Word'deki gibi: ok her başlıkta var, kapalıyken ▸ açıkken ▾.
      // Tıklama ÖZYİNELEMELİ gizler - altındaki alt başlıklar ve onların
      // bölümleri hep birlikte kaybolur (bkz. aşağıdaki `hidden` hesabı:
      // ancestorIds zinciri sayesinde torunlar da kapsanır).
      const toggle = `<button class="chapter-toggle" data-id="${c.id}" title="${isCollapsed ? 'Genişlet (altındaki tüm başlık ve bölümler)' : 'Daralt (altındaki tüm başlık ve bölümler)'}">${isCollapsed ? '▸' : '▾'}</button>`;
      // Daraltılmışken altında kaç girdi gizlendiğini göster - "▸ (12)" -
      // uzun bir taslakta hangi kısmın ne kadar dolu olduğunu kapalıyken
      // bile hissettirir.
      let hiddenCount = 0;
      if (isCollapsed) {
        const selfIdx = hierarchy.indexOf(item);
        for (let i = selfIdx + 1; i < hierarchy.length; i++) {
          if (hierarchy[i].level <= item.level) break;
          hiddenCount++;
        }
      }
      const countBadge = hiddenCount
        ? `<span style="font-size:11px;color:var(--text-muted);font-weight:400;">(${hiddenCount})</span>`
        : '';
      const isPart = c.kind === 'part';
      // Toplu tarama düğmesi yalnızca ALTINDA gerçekten girdi olan
      // başlıklarda anlamlı - altı boş bir Kısım'da tarayacak bölüm yok.
      const bulkScanBtn = item.hasChildren
        ? `<button class="btn-icon-sm bulk-scan-btn" data-id="${c.id}" title="Bu ${isPart ? 'Kısımdaki' : 'Alt Başlıktaki'} TÜM bölümleri tara - yeni varlık ve gelişim notu önerileri">🔍</button>`
          + `<button class="btn-icon-sm arc-review-btn" data-id="${c.id}" title="TUR DEĞERLENDİRMESİ: alt sahnelerin tamamını BİR BÜTÜN olarak denetler - iç yay, ritim dengesi, sahneler arası tekrar, kapanış, hacim">📈</button>`
        : '';
      // Kısım/Alt Başlık normalde sadece bir ayraç, paragraf tutmaz - ama
      // eski bir veri/yanlış tıklama sonucu KENDİSİNE paragraf yazılmışsa
      // (backend artık bunu YENİ paragraf için engelliyor ama var olan
      // eski kayıtlar hâlâ olabilir) bunu görünür kılıyoruz - yoksa o
      // içerik fihristten hiç erişilemez hale gelirdi.
      const hasOrphanText = (c.paragraph_count || 0) > 0;
      // Başlığın kendisinde metin olması bir HATA değil, bir DURUM: içe
      // aktarılan romanlarda olağan ve kullanıcı bilerek de böyle
      // kurabiliyor. Bu yüzden kırmızı ⚠ yerine nötr bir belirteç:
      // "burada metin var, tıklayınca açılır".
      const orphanBadge = hasOrphanText
        ? `<span title="Bu başlığın kendisinde ${c.paragraph_count} paragraf var - tıklayınca açılır" style="font-size:10px;color:var(--text-muted);">📄${c.paragraph_count}</span>`
        : '';
      return `<div class="chapter-item ${isPart ? 'chapter-part-divider' : 'chapter-subtitle-divider'}" data-id="${c.id}" style="cursor:${item.hasChildren ? 'pointer' : 'default'};padding-left:${14 + indent}px;${isPart ? 'background:var(--paper-dim);' : ''}" ${item.hasChildren ? `title="${isCollapsed ? 'Genişletmek' : 'Daraltmak'} için tıkla"` : ''}>
        ${toggle}
        <div class="chapter-label-edit" data-id="${c.id}" style="flex:1;cursor:pointer;${isPart ? 'font-weight:700;letter-spacing:0.5px;text-transform:uppercase;font-size:12.5px;' : 'font-style:italic;font-size:12.5px;color:var(--text-muted);'}" title="${hasOrphanText ? 'Bu kısımda paragraf var - tıklayınca aç' : 'Bu kısımdaki ilk bölüme git'}">
          <span style="opacity:0.6;font-weight:600;">${item.displayNumber}</span> ${escapeHtml(cleanTitle) || '<span style=\"opacity:0.5;\">(başlıksız)</span>'} <span style="font-size:9.5px;letter-spacing:0.3px;opacity:0.55;border:1px solid var(--border);border-radius:3px;padding:0 3px;font-style:normal;text-transform:none;" title="Girdi türü - ✎ ile değiştirilebilir. Kısım en üst seviyedir; Alt Başlık bir Kısım'ın altına girer.">${isPart ? 'ÜST BAŞLIK' : 'ARA BAŞLIK'}</span>  <span class="entry-code" style="font-size:9.5px;color:var(--gold);font-weight:600;cursor:pointer;" title="AI atıf numarası - sohbette bu numarayı yazarsan (ör. 1-2) bu girdinin özeti ve metni bağlama girer (tıkla: kopyala)">#${item.displayNumber}</span> ${countBadge} ${orphanBadge}
        </div>
        ${bulkScanBtn}
        <button class="btn-icon-sm edit-chapter-btn" data-id="${c.id}" title="Başlığı ve TÜRÜ düzenle (Bölüm / Kısım / Alt Başlık)">✎</button>
        <button class="btn-icon-sm del-chapter-btn" data-id="${c.id}" title="Sil">✕</button>
      </div>`;
    }

    const cleanSummary = stripMarkdownArtifacts(c.summary);
    const isDuplicateOfTitle = cleanTitle && cleanSummary &&
      cleanSummary.toLowerCase().startsWith(cleanTitle.toLowerCase().slice(0, 40));
    const preview = (cleanSummary && !isDuplicateOfTitle)
      ? cleanSummary.slice(0, 80) + (cleanSummary.length > 80 ? '…' : '')
      : '';
    // KAPSAYICI BÖLÜM (altında alt başlıklar var): Word gibi kendi ▾ oku
    // olur ve daraltılınca tüm alt ağacı gizler. Yaprak bölümlerde ok
    // yerine görünmez yer tutucu - girintiler bozulmasın.
    const chIsCollapsed = collapsedGroups.has(String(c.id));
    const chHiddenCount = (item.hasChildren && chIsCollapsed)
      ? hierarchy.slice(hierarchy.indexOf(item) + 1).findIndex(x => x.level <= item.level) : 0;
    const chToggle = item.hasChildren
      ? `<button class="chapter-toggle" data-id="${c.id}" title="${chIsCollapsed ? 'Genişlet' : 'Daralt'} (altındaki tüm başlık ve bölümler)">${chIsCollapsed ? '▸' : '▾'}</button>`
      : `<span class="chapter-toggle" style="visibility:hidden;">▸</span>`;
    const chCountBadge = (chHiddenCount > 0)
      ? ` <span style="font-size:11px;color:var(--text-muted);">(${chHiddenCount})</span>` : '';
    return `<div class="chapter-item${currentChapter && String(currentChapter.id) === String(c.id) ? ' active' : ''}" data-id="${c.id}" style="padding-left:${14 + indent}px;" title="${escapeHtml(c.summary || 'Henüz özet yok')}">
      ${chToggle}
      <div style="flex:1;min-width:0;">
        <span>${item.displayNumber}${cleanTitle ? ' — ' + escapeHtml(cleanTitle) : ''}${chCountBadge} <span class="entry-code" style="font-size:9.5px;color:var(--gold);font-weight:600;cursor:pointer;" title="AI atıf numarası - sohbette bu numarayı yazarsan bu bölümün özeti ve metni bağlama girer (tıkla: kopyala)">#${item.displayNumber}</span></span>
        ${preview ? `<div style="font-size:11px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(preview)}</div>` : ''}
      </div>
      <button class="btn-icon-sm edit-chapter-btn" data-id="${c.id}" title="Başlığı ve TÜRÜ düzenle - Kısım/Alt Başlık yaparsan altındakiler ona bağlanır ve daraltılabilir olur">✎</button>
      <button class="btn-icon-sm del-chapter-btn" data-id="${c.id}" title="Bölümü sil">✕</button>
    </div>`;
  }).join('');

  // Gerçek bölümler (kind === 'chapter') tıklanınca seçilir/okunur.
  listEl.querySelectorAll('.chapter-item').forEach(el => {
    const c = chapters.find(x => String(x.id) === el.dataset.id);
    // ✎/✕ tıklamaları satır seçimini tetiklemesin (kendi dinleyicileri var)
    if (c && c.kind !== 'chapter') return; // part/subtitle satırları bu genel handler'a girmez
    el.addEventListener('click', (e) => {
      if (e.target.closest('.del-chapter-btn')) return;
      selectChapter(el.dataset.id);
    });
  });
  // Kısım/Alt Başlık metnine tıklamak artık DÜZENLEME AÇMIYOR - liste
  // uzadıkça (12.000 sayfalık bir seri gibi) asıl ihtiyaç o bölgeye HIZLICA
  // GİTMEK, her tıklamanın bir düzenleme penceresi açması değil. Öncelik
  // sırası: (1) bu Kısım/Alt Başlık'ın KENDİSİNDE paragraf varsa (normalde
  // olmaz ama eski/yanlış veri varsa - bkz. paragraph_count) doğrudan onu
  // aç, (2) yoksa altındaki İLK gerçek bölümü seçip okuyucuya götür, (3)
  // hiçbiri yoksa uyarı ver. Metni değiştirmek için ayrı, açık bir ✎
  // butonu var - kazara tıklayıp yazı kaybetme riski yok.
  listEl.querySelectorAll('.chapter-label-edit').forEach(el => {
    el.addEventListener('click', () => {
      const c = chapters.find(x => String(x.id) === el.dataset.id);
      if (c && (c.paragraph_count || 0) > 0) {
        selectChapter(c.id);
        return;
      }
      const target = findFirstChapterUnder(el.dataset.id);
      if (target) selectChapter(target.id);
      else alert('Bu kısımda henüz bölüm yok. Metni değiştirmek için ✎ simgesine tıkla.');
    });
  });
  listEl.querySelectorAll('.entry-code').forEach(el => el.addEventListener('click', (e) => {
    e.stopPropagation();
    const code = el.textContent.trim().replace(/^#/, '');
    navigator.clipboard?.writeText(code);
    const prev = el.textContent;
    el.textContent = '✓ kopyalandı';
    setTimeout(() => { el.textContent = prev; }, 1200);
  }));
  listEl.querySelectorAll('.chapter-toggle').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      if (collapsedGroups.has(id)) collapsedGroups.delete(id); else collapsedGroups.add(id);
      saveCollapsedGroups();
      renderChapterListDOM();
    });
  });
  // Kısım/Alt Başlık satırının BOŞ alanına tıklamak da daraltır/genişletir -
  // minicik ▸ okunu hedeflemek yerine tüm satır tıklama hedefi. Başlık
  // metni (navigasyon) ve butonlar (🔍/✎/✕) kendi işlerini korur.
  listEl.querySelectorAll('.chapter-part-divider, .chapter-subtitle-divider').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('button') || e.target.closest('.chapter-label-edit')) return;
      const id = el.dataset.id;
      if (!collapsibleIds.includes(id)) return;
      if (collapsedGroups.has(id)) collapsedGroups.delete(id); else collapsedGroups.add(id);
      saveCollapsedGroups();
      renderChapterListDOM();
    });
  });
  const collapseAllBtn = document.getElementById('collapseAllBtn');
  if (collapseAllBtn) {
    collapseAllBtn.addEventListener('click', () => {
      collapsibleIds.forEach(id => collapsedGroups.add(id));
      saveCollapsedGroups();
      renderChapterListDOM();
    });
  }
  const expandAllBtn = document.getElementById('expandAllBtn');
  if (expandAllBtn) {
    expandAllBtn.addEventListener('click', () => {
      collapsedGroups.clear();
      saveCollapsedGroups();
      renderChapterListDOM();
    });
  }
  listEl.querySelectorAll('.arc-review-btn').forEach(btn => btn.addEventListener('click', (e) => {
    e.stopPropagation();
    runArcReview(parseInt(btn.dataset.id, 10));
  }));
  listEl.querySelectorAll('.bulk-scan-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openBulkScanForPart(btn.dataset.id);
    });
  });
  listEl.querySelectorAll('.edit-chapter-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openChapterEditPrompt(btn.dataset.id);
    });
  });
  listEl.querySelectorAll('.del-chapter-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Bu bölümü ve içindeki tüm paragrafları silmek istediğine emin misin?')) return;
      try {
        await api.del(`/chapters/${btn.dataset.id}`);
        await loadChapterList();
      } catch (err) { alert(err.message); }
    });
  });
}

// Fihrist girdisi düzenleme: başlık + TÜR. Tür değiştirme kritik çünkü
// içe aktarılan romanlarda her şey düz "Bölüm" olarak gelir; bir girdiyi
// Kısım/Alt Başlık yapmadan altındakiler ona bağlanmaz ve daraltma okları
// (▾) hiç çıkmaz. Eskiden burada sadece prompt() ile başlık metni
// düzenlenebiliyordu - tür değiştirmenin arayüzde hiçbir yolu yoktu.
function openChapterEditPrompt(id) {
  const c = lastLoadedChapters.find(x => String(x.id) === String(id));
  if (!c) return;
  const overlay = ensureModalOverlay();
  // Tür adları SEVİYE anlatımıyla: kullanıcının kendi başlık metinleri
  // ("BİRİNCİ BÖLÜM", "KISIM 2") sistemin tür adlarıyla çakışıyordu.
  // Artık soru "bu ne isimle anılıyor" değil, "hiyerarşide nerede duruyor".
  const kindLabels = {
    chapter: '📄 Metin bölümü (paragrafları burada tutulur)',
    part: '📁 Üst başlık (en üst seviye - altındakileri gruplar)',
    subtitle: '📂 Ara başlık (bir üst başlığın altına girer)',
  };
  overlay.innerHTML = `
    <div class="panel" style="max-width:420px;width:92%;">
      <b>Fihrist Girdisini Düzenle</b>
      <div class="field" style="margin-top:8px;"><label>Başlık</label>
        <input type="text" id="editChapterTitle" value="${escapeHtml(stripMarkdownArtifacts(c.title) || '')}"></div>
      <div class="field"><label>Tür</label>
        <select id="editChapterKind">
          ${Object.entries(kindLabels).map(([k, label]) => `<option value="${k}" ${c.kind === k ? 'selected' : ''}>${label}</option>`).join('')}
        </select>
        <div style="font-size:11.5px;color:var(--text-muted);margin-top:4px;">
          Bu seçim <b>hiyerarşideki yeri</b> belirler, başlığın adını değil.
          İstediğin adı yazabilirsin ("BİRİNCİ BÖLÜM" bir üst başlık olabilir).
          Üst/Ara başlık yaptığında altındaki girdiler ona bağlanır, numarası
          "1-1" gibi olur ve ▾ ile daraltılır. Paragraflar korunur.
        </div>
      </div>
      <div class="form-actions">
        <button class="btn btn-primary" id="editChapterSave">Kaydet</button>
        <button class="btn" id="editChapterCancel">Vazgeç</button>
      </div>
      <div id="editChapterError" class="error-text"></div>
    </div>`;
  overlay.style.display = 'flex';
  const close = () => { overlay.style.display = 'none'; overlay.innerHTML = ''; };
  el('editChapterCancel').addEventListener('click', close);
  el('editChapterSave').addEventListener('click', async () => {
    const title = el('editChapterTitle').value.trim();
    const kind = el('editChapterKind').value;
    if (!title && kind !== 'chapter') {
      el('editChapterError').textContent = 'Kısım/Alt Başlık için başlık zorunlu.';
      return;
    }
    try {
      await api.put(`/chapters/${c.id}`, { title: stripMarkdownArtifacts(title), kind });
      close();
      await loadChapterList(currentChapter ? currentChapter.id : undefined, true);
    } catch (err) { el('editChapterError').textContent = err.message; }
  });
}

// "Altın vuruş": bir Kısım'ın (Part) TAMAMINI tek seferde tarayıp henüz
// menülerde kayıtlı olmayan karakter/mekan/nesneleri VE yeni/değişen
// gelişim notlarını önerir - fihristteki hiyerarşiyle senkron (Kısım
// seviyesinde). Varsayılan olarak o Kısım'ın altındaki TÜM bölümler
// seçili gelir, kullanıcı isterse bazılarının işaretini kaldırıp
// "seçilebilir bütün bölümlerden" tara mantığını da karşılar.
function getChaptersUnderPart(partId) {
  const hierarchy = buildChapterHierarchy(lastLoadedChapters);
  return hierarchy
    .filter(item => item.chapter.kind === 'chapter' && item.ancestorIds.includes(String(partId)))
    .map(item => item.chapter);
}

function openBulkScanForPart(partId) {
  const chapters = getChaptersUnderPart(partId).filter(c => true);
  const panel = document.getElementById('bulkScanPanel');
  if (!panel) return;
  if (!chapters.length) {
    alert('Bu Kısım altında henüz bölüm yok.');
    return;
  }
  panel.style.display = 'block';
  panel.innerHTML = `
    <div class="panel" style="margin-top:0;">
      <strong style="font-size:11px;color:var(--text-muted);letter-spacing:0.4px;">KISIM TARAMASI</strong>
      <p style="font-size:12.5px;color:var(--text-muted);margin:4px 0 8px;">Bu Kısım'daki bölümler AI ile taranıp yeni varlık ve gelişim notu önerileri çıkarılacak. İstemediğin bölümün işaretini kaldırabilirsin.</p>
      ${chapters.map(c => `<label style="display:flex;gap:8px;align-items:center;padding:3px 0;font-size:13px;">
        <input type="checkbox" class="bulk-scan-chapter-check" value="${c.id}" checked>
        <span>Bölüm ${c.number}${c.title ? ' — ' + escapeHtml(stripMarkdownArtifacts(c.title)) : ''}</span>
      </label>`).join('')}
      <div style="display:flex;gap:8px;margin-top:8px;">
        <button class="btn btn-primary btn-sm" id="runBulkScanBtn">Tara</button>
        <button class="btn btn-sm" id="closeBulkScanBtn">Kapat</button>
      </div>
      <div id="bulkScanResult" style="margin-top:10px;"></div>
    </div>`;

  el('closeBulkScanBtn').addEventListener('click', () => {
    panel.style.display = 'none';
    panel.innerHTML = '';
  });
  el('runBulkScanBtn').addEventListener('click', async (e) => {
    const chosenIds = Array.from(panel.querySelectorAll('.bulk-scan-chapter-check:checked')).map(cb => parseInt(cb.value, 10));
    if (!chosenIds.length) { alert('En az bir bölüm seçmelisin.'); return; }
    e.target.disabled = true;
    const resultEl = document.getElementById('bulkScanResult');
    resultEl.innerHTML = '<div class="empty-state">Taranıyor, bölüm sayısına göre biraz sürebilir…</div>';
    try {
      const [entitySuggestions, progressionSuggestions, relationshipSuggestions, eventSuggestions] = await Promise.all([
        api.post('/chapters/suggest-entities-bulk', { chapter_ids: chosenIds }),
        api.post('/chapters/suggest-progressions-bulk', { chapter_ids: chosenIds }),
        api.post('/chapters/suggest-relationships-bulk', { chapter_ids: chosenIds }),
        api.post('/chapters/suggest-events-bulk', { chapter_ids: chosenIds }),
      ]);
      resultEl.innerHTML = `
        <div id="bulkEntityPanel"></div>
        <div id="bulkProgressionPanel" style="margin-top:10px;"></div>
        <div id="bulkRelationshipPanel" style="margin-top:10px;"></div>
        <div id="bulkEventPanel" style="margin-top:10px;"></div>`;
      renderEntitySuggestionsInto(document.getElementById('bulkEntityPanel'), 'bulk-' + partId, entitySuggestions);
      renderProgressionSuggestionsInto(document.getElementById('bulkProgressionPanel'), progressionSuggestions);
      renderRelationshipSuggestionsInto(document.getElementById('bulkRelationshipPanel'), relationshipSuggestions);
      renderEventSuggestionsInto(document.getElementById('bulkEventPanel'), eventSuggestions);
    } catch (err) {
      resultEl.innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`;
    }
    e.target.disabled = false;
  });
}

async function refreshAfterChatActions() {
  // Fihristi yenile ama AI panelini/sohbet geçmişini SIFIRLAMA - selectChapter
  // yerine sadece liste HTML'ini ve (varsa) okuyucuyu güncelliyoruz.
  await loadChapterList(undefined, true);
  loadWordCount();
  if (currentChapter) {
    try {
      const refreshed = await api.get(`/chapters/${currentChapter.id}`);
      currentChapter = refreshed;
      renderReader(refreshed);
    } catch (err) { /* sessizce geç */ }
  }
}

// ---------------------------------------------------------------------
// "+ Yeni" oluşturma akışı: rastgele bir "sıra numarası" yazdırmak yerine
// (kafa karıştırıcıydı - flat bir sayı, hiyerarşiyle ilgisi yoktu) fihristin
// gösterdiği "1-2-3" numaralamasıyla BİREBİR eşleşen 3 kutu gösteriyoruz:
// [Kısım#] [Alt Başlık#] [Bölüm#]. Hangi kutunun kilitli/değiştirilebilir
// olduğu, neyi oluşturduğuna VE şu an neyin içinde bulunduğuna (son
// görüntülenen bölümün bağlamına) göre otomatik belirlenir:
//   - Yeni Bölüm: içinde bulunduğun Kısım/Alt Başlık kutuları KİLİTLİ
//     (o bağlamı DEĞİŞTİRMÜYORSUN, sadece ona bölüm ekliyorsun),
//     Bölüm# kutusu değiştirilebilir ve bir sonraki sayı önerilir.
//   - Yeni Başlık (Kısım): tek kutu (Kısım#) değiştirilebilir, sıradaki
//     numara önerilir - henüz hiç Kısım yoksa "1" önerilir.
//   - Yeni Alt Başlık: içinde bulunduğun Kısım kutusu KİLİTLİ (varsa),
//     Alt Başlık# kutusu değiştirilebilir ve sıradaki numara önerilir.
// Gerçek arka plan "sıra numarası" (backend'in number alanı) bu seçime
// göre OTOMATİK hesaplanır - gerekirse (araya ekleniyorsa) sonraki
// kayıtlar sessizce +1 kaydırılır (bkz. insertAfterNumber).
// ---------------------------------------------------------------------

function getCurrentContext() {
  const hierarchy = buildChapterHierarchy(lastLoadedChapters);
  if (!currentChapter) return { partId: null, partNum: null, subtitleId: null, subNum: null };
  const item = hierarchy.find(it => String(it.chapter.id) === String(currentChapter.id));
  if (!item) return { partId: null, partNum: null, subtitleId: null, subNum: null };
  const partId = item.ancestorIds[0] || null;
  const subtitleId = item.ancestorIds[1] || null;
  const partItem = partId ? hierarchy.find(it => String(it.chapter.id) === partId) : null;
  const subItem = subtitleId ? hierarchy.find(it => String(it.chapter.id) === subtitleId) : null;
  return {
    partId, partNum: partItem ? partItem.displayNumber : null,
    subtitleId, subNum: subItem ? subItem.displayNumber.split('-').pop() : null,
  };
}

function countExistingInScope(kind, partId, subtitleId) {
  const hierarchy = buildChapterHierarchy(lastLoadedChapters);
  if (kind === 'part') return hierarchy.filter(it => it.chapter.kind === 'part').length;
  if (kind === 'subtitle') {
    return hierarchy.filter(it => it.chapter.kind === 'subtitle' && (it.ancestorIds[0] || null) === partId).length;
  }
  const scopeIds = [partId, subtitleId].filter(Boolean);
  return hierarchy.filter(it => it.chapter.kind === 'chapter' && JSON.stringify(it.ancestorIds) === JSON.stringify(scopeIds)).length;
}

// Yeni öğenin arka plandaki (backend) "number"ının hangi mevcut kaydın
// HEMEN ARDINDAN geleceğini bulur - o kaydın number'ı döner, ekleme bunun
// +1 fazlası olarak yapılır (gerekirse sonrakiler kaydırılır).
function findInsertionAnchorNumber(kind, ctx) {
  const hierarchy = buildChapterHierarchy(lastLoadedChapters);
  if (!hierarchy.length) return 0;
  const lastOverall = hierarchy[hierarchy.length - 1].chapter.number;

  if (kind === 'part') return lastOverall; // yeni Kısım her zaman dokümanın en sonuna eklenir

  if (kind === 'subtitle') {
    if (!ctx.partId) return lastOverall; // üst seviye alt başlık - en sona
    let last = null;
    for (const it of hierarchy) {
      if (String(it.chapter.id) === ctx.partId || it.ancestorIds.includes(ctx.partId)) last = it;
    }
    return last ? last.chapter.number : lastOverall;
  }

  // kind === 'chapter'
  const scopeIds = [ctx.partId, ctx.subtitleId].filter(Boolean);
  if (!scopeIds.length) return lastOverall; // hiçbir bağlam yok - en sona
  let last = null;
  for (const it of hierarchy) {
    const isSelfDivider = (ctx.subtitleId && String(it.chapter.id) === ctx.subtitleId) ||
      (!ctx.subtitleId && ctx.partId && String(it.chapter.id) === ctx.partId);
    const isDescendant = JSON.stringify(it.ancestorIds) === JSON.stringify(scopeIds);
    if (isSelfDivider || isDescendant) last = it;
  }
  return last ? last.chapter.number : lastOverall;
}

// anchorNumber'dan HEMEN SONRAKİ boş "number" değerini bulur - araya
// sıkıştırmak gerekiyorsa (bir sonraki kayıt zaten anchor+1'de duruyorsa)
// ondan sonraki TÜM kayıtları SONDAN BAŞA doğru +1 kaydırır (unique
// constraint çakışmasın diye) - böylece hiçbir veri kaybı/çakışma olmadan
// dokümanın ortasına yeni bir bölüm/kısım/alt başlık eklenebilir.
async function insertAfterNumber(anchorNumber) {
  const sorted = [...lastLoadedChapters].sort((a, b) => a.number - b.number);
  const idx = sorted.findIndex(c => c.number === anchorNumber);
  const nextItem = idx >= 0 ? sorted[idx + 1] : undefined;
  if (!nextItem || nextItem.number > anchorNumber + 1) {
    return anchorNumber + 1; // boşluk var ya da liste sonu - kaydırmaya gerek yok
  }
  const toShift = sorted.slice(idx + 1);
  for (let i = toShift.length - 1; i >= 0; i--) {
    const c = toShift[i];
    await api.put(`/chapters/${c.id}`, { number: c.number + 1 });
  }
  return anchorNumber + 1;
}

function openCreateItemModal(kind) {
  kind = kind || 'chapter';
  const kindLabel = kind === 'part' ? 'Başlık (Kısım)' : kind === 'subtitle' ? 'Alt Başlık' : 'Bölüm';
  const ctx = getCurrentContext();

  // Her kutunun durumu: { value, locked } - locked=true ise input disabled.
  let box1, box2, box3; // Kısım# / Alt Başlık# / Bölüm#
  if (kind === 'part') {
    box1 = { value: countExistingInScope('part') + 1, locked: false };
    box2 = null; box3 = null;
  } else if (kind === 'subtitle') {
    box1 = ctx.partId ? { value: ctx.partNum, locked: true } : { value: '—', locked: true, na: true };
    box2 = { value: countExistingInScope('subtitle', ctx.partId, null) + 1, locked: false };
    box3 = null;
  } else {
    box1 = ctx.partId ? { value: ctx.partNum, locked: true } : { value: '—', locked: true, na: true };
    box2 = ctx.subtitleId ? { value: ctx.subNum, locked: true } : { value: '—', locked: true, na: true };
    box3 = { value: countExistingInScope('chapter', ctx.partId, ctx.subtitleId) + 1, locked: false };
  }

  const renderBox = (label, box) => {
    if (!box) return `<div style="flex:1;min-width:0;"></div>`;
    return `<div style="flex:1;min-width:0;text-align:center;">
      <div style="font-size:10.5px;color:var(--text-muted);margin-bottom:3px;">${label}</div>
      <input type="text" class="pos-box" value="${box.value}" ${box.locked ? 'disabled' : ''}
        style="width:100%;text-align:center;padding:8px 4px;border-radius:8px;border:1px solid var(--border);
        ${box.locked ? 'background:var(--paper-dim);color:var(--text-muted);' : 'background:#fff;font-weight:600;'}">
    </div>`;
  };

  const overlay = ensureModalOverlay();
  overlay.innerHTML = `
    <div class="panel" style="width:340px;max-width:92vw;">
      <strong style="font-size:13px;">Yeni ${kindLabel}</strong>
      <div style="display:flex;gap:8px;margin:12px 0;">
        ${renderBox('Kısım', box1)}
        ${renderBox('Alt Başlık', box2)}
        ${renderBox('Bölüm', box3)}
      </div>
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:10px;">Gri kutular şu an içinde bulunduğun bağlamı gösterir, değiştirilemez - sadece koyu renkli kutu düzenlenebilir.</div>
      <div class="field">
        <label>${kindLabel} metni${kind === 'chapter' ? ' (opsiyonel)' : ''}</label>
        <input type="text" id="createItemTitle" placeholder="${kind === 'chapter' ? 'Boş bırakabilirsin' : 'Zorunlu'}">
      </div>
      <div class="form-actions">
        <button class="btn btn-primary" id="createItemConfirmBtn">Oluştur</button>
        <button class="btn" id="createItemCancelBtn">Vazgeç</button>
      </div>
      <div id="createItemError" class="error-text"></div>
    </div>`;
  overlay.style.display = 'flex';

  el('createItemCancelBtn').addEventListener('click', () => { overlay.style.display = 'none'; });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.style.display = 'none'; }, { once: true });

  el('createItemConfirmBtn').addEventListener('click', async (e) => {
    const rawTitle = el('createItemTitle').value;
    if (kind !== 'chapter' && !rawTitle.trim()) {
      el('createItemError').textContent = `${kindLabel} için bir metin gerekli.`;
      return;
    }
    const title = stripMarkdownArtifacts(rawTitle);
    e.target.disabled = true;
    try {
      const anchorNumber = findInsertionAnchorNumber(kind, ctx);
      const newNumber = await insertAfterNumber(anchorNumber);
      const chapter = await api.post('/chapters/', { number: newNumber, title, kind });
      overlay.style.display = 'none';
      await loadChapterList(chapter.id);
    } catch (err) {
      el('createItemError').textContent = err.message;
      e.target.disabled = false;
    }
  });
}

async function selectChapter(id) {
  // Başka bölüme geçilirken sesli okuma dursun - yanlış metni okumaya
  // devam etmesin.
  if (typeof stopChapterTts === 'function' && ttsState.playing) stopChapterTts();
  // Ayrılınan bölüm "kirliyse" (bu oturumda paragraf değişikliği olduysa),
  // arka planda sessizce tara - kullanıcının beklemesine gerek yok.
  if (dirtyChapterId && String(dirtyChapterId) !== String(id)) {
    const toScan = dirtyChapterId;
    dirtyChapterId = null;
    runBackgroundChapterScan(toScan);
  }

  // Seçilen bölüm kapalı bir Kısım/Alt Başlık'ın içindeyse önce onu aç -
  // yoksa "aktif" bölüm listede görünmez olurdu (özellikle açılışta
  // varsayılan-daraltık modda ilk bölüm seçilirken).
  expandAncestorsOf(id);

  document.querySelectorAll('.chapter-item').forEach(el => el.classList.toggle('active', el.dataset.id === String(id)));
  const readerPane = document.getElementById('readerPane');
  readerPane.innerHTML = `<div class="empty-state">Yükleniyor…</div>`;
  try {
    const chapter = await api.get(`/chapters/${id}`);
    currentChapter = chapter;
    renderReader(chapter);
    renderAiPanel(chapter);
  } catch (err) {
    readerPane.innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`;
  }
}

async function runBackgroundChapterScan(chapterId) {
  try {
    const [entities, progressions, relationships, events] = await Promise.all([
      api.post(`/chapters/${chapterId}/suggest-entities`, {}).catch(() => []),
      api.post(`/chapters/${chapterId}/suggest-progressions`, {}).catch(() => []),
      api.post(`/chapters/${chapterId}/suggest-relationships`, {}).catch(() => []),
      api.post(`/chapters/${chapterId}/suggest-events`, {}).catch(() => []),
    ]);
    const total = (entities || []).length + (progressions || []).length + (relationships || []).length + (events || []).length;
    if (total > 0) {
      pendingAiSuggestions[chapterId] = {
        entities: entities || [], progressions: progressions || [],
        relationships: relationships || [], events: events || [],
      };
      showToast(`Bölüm için ${total} yeni AI önerisi hazır - bölümü tekrar açınca görebilirsin.`);
      // Sidebardaki fihrist satırına küçük bir rozet ekle, farkında ol diye
      const row = document.querySelector(`.chapter-item[data-id="${chapterId}"]`);
      if (row && !row.querySelector('.pending-ai-badge')) {
        row.insertAdjacentHTML('beforeend', '<span class="pending-ai-badge" title="Bekleyen AI önerisi var">●</span>');
      }
    }
  } catch (err) { /* arka plan işlemi - kullanıcıyı rahatsız etme, sessizce geç */ }
}

function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'ai-toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => { toast.classList.add('ai-toast-hide'); setTimeout(() => toast.remove(), 400); }, 6000);
}

function renderReader(chapter) {
  const readerPane = document.getElementById('readerPane');
  // Bu bölümün fihristteki numarası ("1-2") - paragraf atıf kodunun ön eki.
  // Böylece "1-2P3" gibi tam atıf kodu kullanıcıya gösterilebiliyor.
  loadParaState(chapter.id);           // önceki oturumun işlev/karar kayıtları
  // Bölüm planı, paragraf işlevinin MİRAS kaynağıdır (bkz. effectiveParaPurpose)
  api.get(`/matrix/plan-for-chapter/${chapter.id}`)
    .then(r => {
      const liste = Array.isArray(r) ? r : (r ? [r] : []);
      window.__currentChapterPlan = liste.map(x => (x.content || '').trim()).filter(Boolean).join('\n');
    })
    .catch(() => { window.__currentChapterPlan = ''; });
  const chapterEntryNumber = (buildChapterHierarchy(lastLoadedChapters)
    .find(it => String(it.chapter.id) === String(chapter.id)) || {}).displayNumber || '';
  const paragraphsHtml = chapter.paragraphs.map(p => `
    <div class="paragraph-block" id="para-global-${p.id}">
      <div class="paragraph-number para-ref-code" data-num="${p.number}" data-pnum="${p.number}"
           title="Atıf kodu. Bu bölümdeyken sohbette 'P${p.number}' yeter; başka bir girdiden atıf yaparken '${chapterEntryNumber}P${p.number}' yaz. Tıkla: tam kodu kopyala.">
        <div style="font-size:11px;color:var(--gold,#b08d3f);font-weight:700;cursor:pointer;">P${p.number}</div>
        ${paragraphStatusBadge(p.number)}
      </div>
      <div style="flex:1;">
        <div class="paragraph-text" contenteditable="true" data-number="${p.number}">${escapeHtml(p.text)}</div>
        <div>${(p.mentions || []).map(m => `<span class="mention-chip mention-goto" data-type="${m.entity_type}" data-id="${m.entity_id}" style="cursor:pointer;" title="${escapeHtml(m.entity_name)} kaydına git">${escapeHtml(m.entity_name)}</span>`).join('')}${p.is_style_sample ? '<span class="mention-chip" style="background:#1b2230;color:#fff;">★ stil örneği</span>' : ''}</div>
        <div class="paragraph-toolbar">
        <div class="paragraph-actions">
          <button class="btn btn-sm btn-primary save-para-btn" data-number="${p.number}" disabled title="Değişiklik yapılmadı - paragraf zaten kayıtlı">Kaydet</button>
          <button class="btn btn-sm style-para-btn" data-number="${p.number}">${p.is_style_sample ? 'Stil örneğini kaldır' : 'Stil örneği yap'}</button>
          <button class="btn btn-sm history-para-btn" data-number="${p.number}">Geçmiş</button>
          <button class="btn btn-sm suggest-para-btn" data-number="${p.number}" title="Bu paragrafı bağlama sadık kalarak güçlendirilmiş haliyle yeniden yazdırır - beğenirsen tek tıkla değiştirirsin">✨ Öneri</button>
          <button class="btn btn-sm critique-para-btn" data-number="${p.number}" title="Bu paragrafı editör gözüyle eleştirir - yeniden yazmaz, sadece analiz">🔍 Eleştir</button>
          ${(p.text || '').trim().startsWith('#') ? `<button class="btn btn-sm promote-para-btn" data-number="${p.number}" title="Bu satır içe aktarmadan kalmış bir başlık - gerçek bir Alt Başlık girdisine dönüştür (bölümün önüne taşınır)">↑ Başlığa Dönüştür</button>` : ''}
          <button class="btn btn-sm btn-danger del-para-btn" data-number="${p.number}">Sil</button>
        </div>
        <button class="para-disc-btn" data-number="${p.number}" title="Paragraf işlemleri (aç/kapa)">D</button>
        <span class="para-save-state" data-number="${p.number}"></span>
        </div>
        <div class="paragraph-ai-panel" data-number="${p.number}" style="display:none;margin-top:8px;"></div>
        <div class="paragraph-history-panel" data-number="${p.number}" style="display:none;margin-top:8px;padding-top:8px;border-top:1px dashed var(--border);"></div>
      </div>
    </div>`).join('');

  // Uyarı SADECE gerçek sorun varsa: başlık türünde VE içinde paragraf
  // varken. Ayrıca ✕ ile kapatılırsa bölüm bazında KALICI kapanır (her
  // dönüşte tekrar çıkıp gürültü yapmasın) ve elle 3 adımlı tarif yerine
  // tek tıkla düzelten bir düğme var.
  let kindWarnDismissed = false;
  try {
    kindWarnDismissed = JSON.parse(localStorage.getItem('roman_kindwarn_dismissed') || '[]').includes(chapter.id);
  } catch (e) { /* yoksay */ }
  const kindWarning = (chapter.kind !== 'chapter' && (chapter.paragraphs || []).length > 0 && !kindWarnDismissed)
    ? `<div class="panel" id="kindWarningBanner" style="border-color:var(--danger);background:#fdf1f0;margin-bottom:12px;position:relative;">
        <button id="dismissKindWarningBtn" title="Kapat (bir daha gösterme)" style="position:absolute;top:8px;right:10px;background:none;border:none;cursor:pointer;font-size:15px;color:var(--danger);line-height:1;">✕</button>
        <strong style="font-size:12.5px;color:var(--danger);padding-right:20px;display:block;">⚠ Bu bir ${chapter.kind === 'part' ? 'Kısım' : 'Alt Başlık'} ama içinde metin var.</strong>
        <div style="font-size:12px;margin-top:4px;">Kısım/Alt Başlık bir ayraçtır; metin normalde Bölüm'de durur (fihrist ve AI bağlamı buna göre çalışır).</div>
        <button class="btn btn-sm btn-primary" id="moveParagraphsOutBtn" style="margin-top:8px;">↓ Metni yeni bir Bölüm'e taşı</button>
      </div>`
    : '';

  readerPane.innerHTML = `
    ${kindWarning}
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <h2 style="margin:0;">Bölüm ${chapter.number}${chapter.title ? ' — ' + escapeHtml(stripMarkdownArtifacts(chapter.title)) : ''}</h2>
      <button class="btn btn-sm" id="editTitleBtn">Başlığı düzenle</button>
    </div>
    <div id="chapterHealthStrip" style="margin-top:8px;"></div>
    <!-- ARAÇ ÇUBUĞU: 8 düğme iki satıra yayılıp hangisinin ne işe yaradığı
         belirsizleşmişti. Artık tek birincil eylem (Atölye) + puan şeridi
         görünür; gerisi iki başlık altında toplanıp katlanıyor. -->
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;align-items:center;">
      <button class="btn btn-sm btn-primary" id="workshopBtn" title="Bölümü paragraf paragraf elden geçir: hazırlık → derin analiz → düzeltme">🛠 Bölüm Atölyesi</button>
      ${chapterScoreStrip(chapter.id)}
      <button class="btn btn-sm" id="toolsToggle" title="Diğer araçlar">⋯ Araçlar</button>
    </div>
    <div id="chapterToolsPanel" style="display:none;margin-top:8px;border:1px solid var(--border);border-radius:8px;padding:10px;">
      <div style="font-size:10.5px;color:var(--text-muted);letter-spacing:0.4px;">DENETİM</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px;">
        <button class="btn btn-sm" id="chapterReviewBtn" title="Editör gözü (10 edebî ölçüt) + okur gözü; bulgular paragraf paragraf birleştirilir">🔍 Bölüm İncelemesi</button>
        <button class="btn btn-sm" id="timelineTopBtn" title="Özetteki ZAMAN satırından olayları çıkarıp Zaman Çizelgesi'ne öneri getirir">🕐 Zaman Çizelgesi</button>
        <button class="btn btn-sm" id="finishChapterBtn" title="Özet + Roman Haritası taramasını birlikte çalıştırır - bölümü AI'nın hafızasına işler">✅ Bölümü Kapat</button>
      </div>
      <div style="font-size:10.5px;color:var(--text-muted);letter-spacing:0.4px;margin-top:10px;">OKUMA</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px;">
        <button class="btn btn-sm" id="ttsPlayBtn" title="Bölümü tarayıcının Türkçe sesiyle okur; okunan paragraf vurgulanır">🔊 Sesli Oku</button>
        <button class="btn btn-sm" id="highlightNamesBtn" title="Tanımlı kişi/mekan/nesne isimlerinin altını çizer ve tıklanabilir yapar (okuma moduna alır)">🔎 İsimleri Vurgula</button>
      </div>
    </div>
    <div id="readerTestResult"></div>
    <div class="chapter-summary-box" style="margin-top:10px;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <strong style="font-size:11px;color:var(--text-muted);letter-spacing:0.4px;">FİHRİST ÖZETİ</strong>
        <div>
          <button class="btn btn-sm" id="genSummaryBtn">AI ile özet oluştur</button>
          <button class="btn btn-sm" id="editSummaryBtn">Elle düzenle</button>
        </div>
      </div>
      <div id="summaryPreview" style="font-size:12px;color:var(--text-muted);margin:6px 0 0;${chapter.summary ? '' : 'display:none;'}">
        <button class="btn btn-sm" id="toggleSummaryBtn" style="font-size:11.5px;">▸ Özeti göster</button>
        <span style="margin-left:6px;">${chapter.summary ? escapeHtml(truncate(chapter.summary.replace(/\s+/g, ' '), 90)) : ''}</span>
      </div>
      <p id="chapterSummaryText" style="font-size:13px;color:var(--text-muted);margin:6px 0 0;${chapter.summary ? 'display:none;' : ''}">
        ${chapter.summary ? escapeHtml(chapter.summary) : '<em>Henüz özet yok - romanın fihristinde ve AI bağlamında bu bölüm görünmeyecek.</em>'}
      </p>
      <div id="summaryDateWarning"></div>
      <div style="margin-top:8px;">
        <button class="btn btn-sm" id="timelineFromSummaryBtn" ${(chapter.summary || '').trim() ? '' : 'disabled'} title="${(chapter.summary || '').trim() ? 'Özetteki ZAMAN satırını ve bölüm metnini kullanarak olayları Zaman Çizelgesi\'ne öneri olarak getirir' : 'Önce özet oluştur - zaman bilgisi özetin ZAMAN satırından okunuyor'}">🕐 Zaman Çizelgesini Güncelle</button>
      </div>
      <div id="summaryEventScanResult"></div>
    </div>
    <div id="pendingAiSuggestionsBanner"></div>
    <div class="chapter-summary-box" style="margin-top:10px;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <strong style="font-size:11px;color:var(--text-muted);letter-spacing:0.4px;">ROMAN HARİTASI</strong>
        <button class="btn btn-sm" id="scanProgressionsBtn">AI ile bu bölümü tara</button>
      </div>
      <p style="font-size:12px;color:var(--text-muted);margin:6px 0 0;">Bu bölümde geçen kişi/mekan/olaylar hakkında öğrenilen yeni bilgiyi bulup Gelişim Çizelgesi'ne (haritaya) ekler - böylece ileride yazılacak bölümler bu bilgiyle çelişmez.</p>
      <div id="progressionScanResult"></div>
      <div id="eventScanResult"></div>
    </div>
    <div style="height:16px;"></div>
    ${paragraphsHtml || '<div class="empty-state">Henüz paragraf yok.</div>'}
    <button class="btn" id="addParaBtn">+ Yeni paragraf</button>

    <div class="chapter-summary-box" style="margin-top:20px;">
      <strong style="font-size:11px;color:var(--text-muted);letter-spacing:0.4px;">BÜYÜK METİN YAPIŞTIR</strong>
      <p style="font-size:12px;color:var(--text-muted);margin:6px 0;">Paragraf araları net olmayan (tek blok) bir metni buraya yapıştır - AI, tek kelime değiştirmeden mantıklı paragraflara bölüp ekler.</p>
      <textarea id="pasteBigTextArea" placeholder="Metni buraya yapıştır…" style="width:100%;min-height:100px;"></textarea>
      <div style="display:flex;gap:8px;align-items:center;margin-top:8px;">
        <label style="font-size:12px;display:flex;align-items:center;gap:4px;"><input type="radio" name="splitMode" value="append" checked> Sona ekle</label>
        <label style="font-size:12px;display:flex;align-items:center;gap:4px;"><input type="radio" name="splitMode" value="replace"> Tüm paragrafların yerine geç</label>
        <button class="btn btn-primary btn-sm" id="aiSplitBtn" style="margin-left:auto;">AI ile Böl ve Ekle</button>
      </div>
    </div>`;

  el('aiSplitBtn').addEventListener('click', async () => {
    const textarea = document.getElementById('pasteBigTextArea');
    const text = textarea.value.trim();
    if (!text) return;
    const mode = document.querySelector('input[name="splitMode"]:checked').value;
    if (mode === 'replace' && !confirm('Bu bölümdeki TÜM paragraflar silinip yerine AI’nin böldüğü yeni paragraflar gelecek. Emin misin?')) return;
    const btn = document.getElementById('aiSplitBtn');
    btn.disabled = true;
    btn.textContent = 'Bölünüyor…';
    try {
      await api.post(`/chapters/${chapter.id}/ai-split-paragraphs`, { text, mode });
      dirtyChapterId = chapter.id;
      const refreshed = await api.get(`/chapters/${chapter.id}`);
      currentChapter = refreshed;
      renderReader(refreshed);
      await loadChapterList(chapter.id, true);
    } catch (err) {
      alert(err.message);
      btn.disabled = false;
      btn.textContent = 'AI ile Böl ve Ekle';
    }
  });

  el('scanProgressionsBtn').addEventListener('click', () => runSuggestProgressions(chapter));

  const pending = pendingAiSuggestions[chapter.id];
  if (pending) {
    const total = pending.entities.length + pending.progressions.length + (pending.relationships || []).length + (pending.events || []).length;
    const banner = document.getElementById('pendingAiSuggestionsBanner');
    banner.innerHTML = `
      <div class="panel" style="margin-bottom:12px;border-color:var(--gold);">
        <strong style="font-size:12.5px;">🔔 Bu bölümü ayrıldığında AI arka planda taradı: ${total} öneri bulundu.</strong>
        <button class="btn btn-sm" id="showPendingAiBtn" style="margin-left:8px;">Göster</button>
      </div>`;
    el('showPendingAiBtn').addEventListener('click', () => {
      banner.innerHTML = '';
      if (pending.entities.length) {
        const entPanel = document.createElement('div');
        banner.appendChild(entPanel);
        renderEntitySuggestionsInto(entPanel, chapter.id, pending.entities);
      }
      if (pending.progressions.length) {
        const progPanel = document.createElement('div');
        banner.appendChild(progPanel);
        renderProgressionSuggestionsInto(progPanel, pending.progressions);
      }
      if ((pending.relationships || []).length) {
        const relPanel = document.createElement('div');
        banner.appendChild(relPanel);
        renderRelationshipSuggestionsInto(relPanel, pending.relationships);
      }
      if ((pending.events || []).length) {
        const evtPanel = document.createElement('div');
        banner.appendChild(evtPanel);
        renderEventSuggestionsInto(evtPanel, pending.events);
      }
      delete pendingAiSuggestions[chapter.id];
      const badge = document.querySelector(`.chapter-item[data-id="${chapter.id}"] .pending-ai-badge`);
      if (badge) badge.remove();
    });
  }

  document.getElementById('moveParagraphsOutBtn')?.addEventListener('click', async () => {
    if (!confirm('Bu başlıktaki tüm paragraflar, hemen altına açılacak YENİ bir Bölüm\'e taşınacak. Metin kopyalanmaz, taşınır (geçmiş ve bağlantılar korunur). Devam?')) return;
    const btn = document.getElementById('moveParagraphsOutBtn');
    btn.disabled = true; btn.textContent = 'Taşınıyor…';
    try {
      const created = await api.post(`/chapters/${chapter.id}/move-paragraphs-out`, {});
      await loadChapterList(created.id);
    } catch (err) {
      alert(err.message);
      btn.disabled = false; btn.textContent = '↓ Metni yeni bir Bölüm\'e taşı';
    }
  });
  const dismissKindWarningBtn = document.getElementById('dismissKindWarningBtn');
  if (dismissKindWarningBtn) {
    dismissKindWarningBtn.addEventListener('click', () => {
      try {
        const key = 'roman_kindwarn_dismissed';
        const list = JSON.parse(localStorage.getItem(key) || '[]');
        if (!list.includes(chapter.id)) { list.push(chapter.id); localStorage.setItem(key, JSON.stringify(list)); }
      } catch (e) { /* yoksay */ }
      el('kindWarningBanner').style.display = 'none';
    });
  }
  el('editTitleBtn').addEventListener('click', async () => {
    const newTitle = prompt('Yeni bölüm başlığı:', chapter.title || '');
    if (newTitle === null) return;
    try {
      await api.put(`/chapters/${chapter.id}`, { title: newTitle });
      const refreshed = await api.get(`/chapters/${chapter.id}`);
      currentChapter = refreshed;
      renderReader(refreshed);
      await loadChapterList(chapter.id);
    } catch (err) { alert(err.message); }
  });

  el('editSummaryBtn').addEventListener('click', async () => {
    const newSummary = prompt('Bölüm özeti (fihriste ve AI bağlamına bu şekilde girer):', chapter.summary || '');
    if (newSummary === null) return;
    try {
      await api.put(`/chapters/${chapter.id}`, { summary: newSummary });
      const refreshed = await api.get(`/chapters/${chapter.id}`);
      currentChapter = refreshed;
      renderReader(refreshed);
      await loadChapterList(chapter.id);
    } catch (err) { alert(err.message); }
  });

  renderChapterHealthStrip(chapter);
  // Araçlar paneli aç/kapa - tercih hatırlanır
  const toolsPanel = document.getElementById('chapterToolsPanel');
  if (localStorage.getItem('roman_tools_open') === '1') toolsPanel.style.display = 'block';
  el('toolsToggle').addEventListener('click', (e) => {
    const acik = toolsPanel.style.display !== 'none';
    toolsPanel.style.display = acik ? 'none' : 'block';
    e.target.textContent = acik ? '⋯ Araçlar' : '⋯ Araçları gizle';
    localStorage.setItem('roman_tools_open', acik ? '0' : '1');
  });
  if (toolsPanel.style.display === 'block') el('toolsToggle').textContent = '⋯ Araçları gizle';
  el('highlightNamesBtn').addEventListener('click', () => toggleNameHighlight(chapter));
  readerPane.querySelectorAll('.mention-goto').forEach(el => el.addEventListener('click', () => {
    openEntityFromMention(el.dataset.type, parseInt(el.dataset.id, 10));
  }));
  el('ttsPlayBtn').addEventListener('click', () => openTtsRangePicker(chapter));

  el('workshopBtn').addEventListener('click', () => openChapterWorkshop(chapter));
  el('chapterReviewBtn').addEventListener('click', () => runChapterReview(chapter));
  el('timelineTopBtn').addEventListener('click', () => {
    if (!(currentChapter?.summary || chapter.summary || '').trim()) {
      alert('Önce özet oluştur - zaman bilgisi özetin ZAMAN satırından okunuyor.');
      return;
    }
    runSuggestEvents(chapter, 'readerTestResult');
  });
  el('finishChapterBtn').addEventListener('click', () => finishChapter(chapter));
  // Özette tarih var mı? Zaman çizelgesi bölüm metnindeki tarih/saatten
  // besleniyor; özet tarihsizse çizelge boş kalır ve kronoloji kopar.
  // Özet varsayılan KAPALI: yapılandırılmış özet (ZAMAN/OLAY/MEKAN/ATMOSFER/
  // DUYGU/DEVAMLILIK/KAPANIŞ TONU) uzun olduğu için bölüm açılışında ekranı
  // kaplıyordu. Tek satırlık önizleme + aç/kapa.
  document.getElementById('toggleSummaryBtn')?.addEventListener('click', (e) => {
    const p = document.getElementById('chapterSummaryText');
    const acik = p.style.display !== 'none';
    p.style.display = acik ? 'none' : 'block';
    e.target.textContent = acik ? '▸ Özeti göster' : '▾ Özeti gizle';
    const onizleme = e.target.nextElementSibling;
    if (onizleme) onizleme.style.display = acik ? '' : 'none';
  });
  renderSummaryDateWarning(chapter);
  el('timelineFromSummaryBtn').addEventListener('click', () => {
    runSuggestEvents(chapter, 'summaryEventScanResult');
  });
  el('genSummaryBtn').addEventListener('click', async () => {
    const btn = document.getElementById('genSummaryBtn');
    const summaryText = document.getElementById('chapterSummaryText');
    btn.disabled = true;
    summaryText.innerHTML = '<em>Qwen özet çıkarıyor…</em>';
    try {
      const result = await api.post(`/chapters/${chapter.id}/generate-summary`, {});
      const accept = confirm(`Taslak özet:\n\n${result.generated_summary}\n\nBu özeti kaydetmek istiyor musun?`);
      if (accept) {
        await api.put(`/chapters/${chapter.id}`, { summary: result.generated_summary });
        // Özet kaydedilir kaydedilmez ZAMAN ÇİZELGESİ taraması çalışır:
        // çıkarım artık özetin ZAMAN satırını öncelikli kaynak alıyor.
        chapter.summary = result.generated_summary;
        const tlBtn = document.getElementById('timelineFromSummaryBtn');
        if (tlBtn) { tlBtn.disabled = false; tlBtn.title = 'Özetteki ZAMAN satırını kullanarak olayları getirir'; }
        renderSummaryDateWarning(chapter);
        runSuggestEvents(chapter, 'summaryEventScanResult');
        const refreshed = await api.get(`/chapters/${chapter.id}`);
        currentChapter = refreshed;
        renderReader(refreshed);
        await loadChapterList(chapter.id);
      } else {
        renderReader(chapter);
      }
    } catch (err) {
      alert(err.message);
      renderReader(chapter);
    } finally {
      btn.disabled = false;
    }
  });

  readerPane.querySelectorAll('.suggest-para-btn').forEach(btn => {
    btn.addEventListener('click', () => runParagraphAi(chapter, btn.dataset.number, 'suggest'));
  });
  readerPane.querySelectorAll('.critique-para-btn').forEach(btn => {
    btn.addEventListener('click', () => runParagraphAi(chapter, btn.dataset.number, 'critique'));
  });
  // Okuma sürerken bir paragrafa tıklamak oradan devam ettirir
  readerPane.querySelectorAll('.paragraph-text').forEach(el => el.addEventListener('click', () => {
    if (!ttsState.playing) return;
    const num = parseInt(el.dataset.number, 10);
    const idx = (currentChapter.paragraphs || []).sort((a, b) => a.number - b.number)
      .findIndex(p => p.number === num);
    if (idx >= 0) startChapterTts(currentChapter, idx);
  }));
  readerPane.querySelectorAll('.para-ref-code').forEach(el => el.addEventListener('click', () => {
    const full = `${chapterEntryNumber}P${el.dataset.num}`;
    navigator.clipboard?.writeText(full);
    const num = el.querySelector('div');
    const prev = num.textContent;
    num.textContent = '✓';
    setTimeout(() => { num.textContent = prev; }, 1000);
  }));
  readerPane.querySelectorAll('.promote-para-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Bu paragraf silinip, metni bir ALT BAŞLIK girdisi olarak bu bölümün önüne konacak. Devam?')) return;
      try {
        await api.post(`/chapters/${chapter.id}/promote-paragraph/${btn.dataset.number}?kind=subtitle`, {});
        await loadChapterList({ selectId: chapter.id });
      } catch (err) { alert(err.message); }
    });
  });
  // "D" düğmesi: işlem düğmeleri normalde gizli (dikkat dağıtmasın), tıklayınca
  // sağdan sola kayarak açılır. Aynı anda tek paragrafın menüsü açık kalır.
  readerPane.querySelectorAll('.para-disc-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const toolbar = btn.closest('.paragraph-toolbar');
      const wasOpen = toolbar.classList.contains('open');
      readerPane.querySelectorAll('.paragraph-toolbar.open').forEach(t => t.classList.remove('open'));
      if (!wasOpen) toolbar.classList.add('open');
    });
  });

  // OTOMATİK KAYIT (araştırılan kalıp: dirty-check + blur autosave):
  // - Metin değişmediyse HİÇ istek atılmaz (paragraf zaten kayıtlı).
  // - Değiştiği an Kaydet aktifleşir ve "• kaydedilmedi" işareti çıkar.
  // - Odaktan çıkınca (blur) otomatik kaydedilir; "✓ kaydedildi" görünür.
  // - Kaydetmek tam sayfayı yeniden ÇİZMEZ: sadece mention rozetleri ve
  //   K/M/N balonları tazelenir - böylece yazarken imleç/kaydırma kaybolmaz.
  readerPane.querySelectorAll('.paragraph-text').forEach(el => {
    el.dataset.original = el.innerText.trim();
    const number = el.dataset.number;
    const saveBtn = readerPane.querySelector(`.save-para-btn[data-number="${number}"]`);
    const state = readerPane.querySelector(`.para-save-state[data-number="${number}"]`);
    const setDirty = (dirty) => {
      if (saveBtn) {
        saveBtn.disabled = !dirty;
        saveBtn.title = dirty ? 'Değişiklikleri kaydet' : 'Değişiklik yapılmadı - paragraf zaten kayıtlı';
      }
      if (state) {
        state.textContent = dirty ? '• kaydedilmedi' : '';
        state.style.color = 'var(--danger)';
      }
      el.classList.toggle('dirty', dirty);
    };
    el.addEventListener('input', () => setDirty(el.innerText.trim() !== el.dataset.original));
    el.addEventListener('blur', async () => {
      if (el.innerText.trim() === el.dataset.original) return; // değişmedi -> istek yok
      // Uzunluk kapısı: sınırı aşan paragrafta önce bölme teklif edilir
      const metin = el.innerText.trim();
      if (wordCount(metin) >= PARA_WORD_LIMIT) {
        const devam = await paragraphLengthGate(chapter, parseInt(number, 10), metin, el);
        if (!devam) return;   // bölünerek kaydedildi
      }
      autoSaveParagraph(chapter, parseInt(number, 10), el, state, saveBtn);
    });
  });
  readerPane.querySelectorAll('.save-para-btn').forEach(btn => {
    btn.addEventListener('click', () => saveParagraph(chapter.id, btn.dataset.number));
  });
  readerPane.querySelectorAll('.style-para-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await api.post(`/chapters/${chapter.id}/paragraphs/${btn.dataset.number}/toggle-style-sample`, {});
        const refreshed = await api.get(`/chapters/${chapter.id}`);
        currentChapter = refreshed;
        renderReader(refreshed);
      } catch (err) { alert(err.message); }
    });
  });
  readerPane.querySelectorAll('.history-para-btn').forEach(btn => {
    btn.addEventListener('click', () => toggleParagraphHistory(chapter.id, btn.dataset.number));
  });
  readerPane.querySelectorAll('.del-para-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm(`Paragraf ${btn.dataset.number}'i silmek istediğine emin misin?`)) return;
      try {
        await api.del(`/chapters/${chapter.id}/paragraphs/${btn.dataset.number}`);
        dirtyChapterId = chapter.id;
        const refreshed = await api.get(`/chapters/${chapter.id}`);
        currentChapter = refreshed;
        renderReader(refreshed);
      } catch (err) { alert(err.message); }
    });
  });
  el('addParaBtn').addEventListener('click', () => {
    const nextNumber = chapter.paragraphs.length ? Math.max(...chapter.paragraphs.map(p => p.number)) + 1 : 1;
    addEmptyParagraphBlock(nextNumber);
  });
}

async function toggleParagraphHistory(chapterId, number) {
  const panel = document.querySelector(`.paragraph-history-panel[data-number="${number}"]`);
  if (!panel) return;
  if (panel.style.display !== 'none') { panel.style.display = 'none'; return; }
  panel.style.display = 'block';
  await loadParagraphHistory(chapterId, number);
}

async function loadParagraphHistory(chapterId, number) {
  const panel = document.querySelector(`.paragraph-history-panel[data-number="${number}"]`);
  if (!panel) return;
  panel.innerHTML = '<div class="empty-state">Yükleniyor…</div>';
  try {
    const versions = await api.get(`/chapters/${chapterId}/paragraphs/${number}/history`);
    if (!versions.length) {
      panel.innerHTML = '<div class="empty-state" style="padding:4px 0;">Bu paragrafın henüz eski bir versiyonu yok.</div>';
      return;
    }
    panel.innerHTML = `
      <strong style="font-size:10.5px;color:var(--text-muted);letter-spacing:0.4px;">VERSİYON GEÇMİŞİ (en yeni en üstte)</strong>
      ${versions.map(v => `
        <div style="padding:6px 0;border-bottom:1px solid var(--border);">
          <div style="font-size:11px;color:var(--text-muted);">${new Date(v.saved_at).toLocaleString('tr-TR')}</div>
          <div style="font-size:13px;margin:3px 0;">${escapeHtml(truncate(v.text, 200))}</div>
          <button class="btn btn-sm restore-version-btn" data-version-id="${v.id}">Bu versiyona geri dön</button>
        </div>`).join('')}`;

    panel.querySelectorAll('.restore-version-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Paragrafı bu eski versiyona geri döndürmek istediğine emin misin? (Şu anki hal de geçmişe kaydedilecek, kaybolmayacak.)')) return;
        try {
          await api.post(`/chapters/${chapterId}/paragraphs/${number}/restore/${btn.dataset.versionId}`, {});
          dirtyChapterId = chapterId;
          const refreshed = await api.get(`/chapters/${chapterId}`);
          currentChapter = refreshed;
          renderReader(refreshed);
        } catch (err) { alert(err.message); }
      });
    });
  } catch (err) {
    panel.innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`;
  }
}

function addEmptyParagraphBlock(number) {
  const readerPane = document.getElementById('readerPane');
  const addBtn = document.getElementById('addParaBtn');
  const div = document.createElement('div');
  div.className = 'paragraph-block';
  div.innerHTML = `<div class="paragraph-number">${number}</div>
    <div style="flex:1;">
      <div class="paragraph-text" contenteditable="true" data-number="${number}"></div>
      <div class="paragraph-actions"><button class="btn btn-sm save-para-btn" data-number="${number}">Kaydet</button></div>
    </div>`;
  readerPane.insertBefore(div, addBtn);
  div.querySelector('.save-para-btn').addEventListener('click', () => saveParagraph(currentChapter.id, number));
  div.querySelector('.paragraph-text').focus();
}

// Otomatik kayıt: tam sayfa yenilemeden kaydeder, rozetleri yerinde
// tazeler. Uç, mention'larıyla birlikte paragrafı döndürdüğü için
// kişilerin/mekanların otomatik yakalanması aynen çalışır.
async function autoSaveParagraph(chapter, number, el, state, saveBtn) {
  const text = el.innerText.trim();
  if (!text) { state.textContent = 'boş - kaydedilmedi'; return; }
  if (state) { state.textContent = 'kaydediliyor…'; state.style.color = 'var(--text-muted)'; }
  try {
    const saved = await api.put(`/chapters/${chapter.id}/paragraphs/${number}`, { number, text });
    el.dataset.original = text;
    el.classList.remove('dirty');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.title = 'Değişiklik yapılmadı - paragraf zaten kayıtlı'; }
    if (state) {
      state.textContent = '✓ kaydedildi';
      state.style.color = 'var(--text-muted)';
      setTimeout(() => { if (state.textContent === '✓ kaydedildi') state.textContent = ''; }, 2500);
    }
    dirtyChapterId = chapter.id;
    // Elle düzenleyip kaydettiğin paragraf da "çözüldü" sayılır - incelemede
    // tekrar önerilmesin (kullanıcı zaten kendi eliyle halletti).
    if (typeof resolvedParas !== 'undefined' && !resolvedParas.has(String(number))) {
      resolvedParas.add(String(number));
      saveParaState();
    }
    // Mention rozetlerini YERİNDE güncelle (tam çizim yok - imleç korunur)
    const chipRow = el.nextElementSibling;
    if (chipRow && saved.mentions) {
      chipRow.innerHTML = saved.mentions.map(m => `<span class="mention-chip">${escapeHtml(m.entity_name)}</span>`).join('')
        + (saved.is_style_sample ? '<span class="mention-chip" style="background:#1b2230;color:#fff;">★ stil örneği</span>' : '');
    }
    // Yeni kişi/mekan/nesne balonları
    detectParagraphBalloons(chapter, number, text).catch(() => {});
  } catch (err) {
    if (state) { state.textContent = '✕ kaydedilemedi'; state.style.color = 'var(--danger)'; }
    alert(err.message);
  }
}

async function saveParagraph(chapterId, number) {
  const el = document.querySelector(`.paragraph-text[data-number="${number}"]`);
  const text = el.innerText.trim();
  if (!text) { alert('Paragraf boş olamaz.'); return; }
  // Buton geri bildirimi: kaydederken kilitle, bitince "✓ Kaydedildi" göster.
  // Eskiden buton hep "Kaydet" kalıyordu ve kayıt olup olmadığı belli
  // olmuyordu (renderReader butonu yeniden çizdiği için etiket de sıfırlanıyordu).
  const btn = document.querySelector(`.save-para-btn[data-number="${number}"]`);
  if (btn) { btn.disabled = true; btn.textContent = 'Kaydediliyor…'; }
  try {
    await api.put(`/chapters/${chapterId}/paragraphs/${number}`, { number: parseInt(number, 10), text });
    dirtyChapterId = chapterId;
    const chapter = await api.get(`/chapters/${chapterId}`);
    currentChapter = chapter;
    renderReader(chapter);
    // renderReader butonu yeniden çizdi - onayı YENİ butona bas
    const freshBtn = document.querySelector(`.save-para-btn[data-number="${number}"]`);
    if (freshBtn) {
      freshBtn.textContent = '✓ Kaydedildi';
      freshBtn.disabled = true;
      setTimeout(() => { freshBtn.textContent = 'Kaydet'; freshBtn.disabled = false; }, 2000);
    }
    // Anlık K/M/N tespiti: kayıt sonrası arka planda çalışır, balonları
    // paragrafın altına basar. Hata olursa sessiz - kayıt zaten başarılı.
    detectParagraphBalloons(chapter, parseInt(number, 10), text).catch(() => {});
  } catch (err) {
    alert(err.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Kaydet'; }
  }
}

// ---------------------------------------------------------------------------
// K/M/N BALONLARI: paragraf kaydedilince tek paragraflık anlık tespit.
// K=Kişi, M=Mekan, N=Nesne. Düz balon = yeni kayıt önerisi; "+" işaretli
// balon = MEVCUT kayda yeni bilgi ekleme (derin profil bölümüne). Tıklanınca
// ne ekleneceği gösterilip onay istenir - onaysız hiçbir şey yazılmaz.
// ---------------------------------------------------------------------------
const BALLOON_LETTERS = { character: 'K', place: 'M', object: 'N' };
const BALLOON_COLORS = { character: '#b08d3f', place: '#3f7a4f', object: '#3f5f8d' };

async function detectParagraphBalloons(chapter, number, text) {
  const result = await api.post('/ai/paragraph-entities', { text });
  const sugs = result.suggestions || [];
  if (!sugs.length) return;
  const para = document.querySelector(`.paragraph-text[data-number="${number}"]`);
  if (!para) return; // görünüm değişmiş - sessiz geç
  const chipRow = para.nextElementSibling; // mention chip satırı
  const holder = document.createElement('span');
  chipRow.appendChild(holder);
  holder.innerHTML = sugs.map((s, i) => {
    const letter = BALLOON_LETTERS[s.entity_type] || '?';
    const color = BALLOON_COLORS[s.entity_type] || 'var(--border)';
    const isUpdate = !!s.existing_entity_id;
    const secKeys = Object.keys(s.sections || {});
    const tip = (isUpdate ? 'Mevcut kayda ekle: ' : 'Yeni kayıt öner: ') + s.name
      + (secKeys.length ? ' · ' + secKeys.join(', ') : '')
      + ((s.aliases || []).length ? ' · takma ad: ' + s.aliases.join(', ') : '');
    return `<span class="mention-chip balloon-chip" data-idx="${i}" title="${escapeHtml(tip)}"
      style="cursor:pointer;border:1.5px solid ${color};background:#fff;">
      <b style="color:${color};">${letter}${isUpdate ? '+' : ''}</b> ${escapeHtml(s.name)}
      <span class="balloon-dismiss" data-idx="${i}" title="Yoksay" style="opacity:0.5;margin-left:3px;">✕</span>
    </span>`;
  }).join('');

  holder.querySelectorAll('.balloon-dismiss').forEach(x => x.addEventListener('click', (e) => {
    e.stopPropagation();
    x.closest('.balloon-chip').remove();
  }));
  holder.querySelectorAll('.balloon-chip').forEach(chip => chip.addEventListener('click', async () => {
    const s = sugs[parseInt(chip.dataset.idx, 10)];
    const secText = Object.entries(s.sections || {}).map(([k, v]) => `- ${k}: ${v}`).join('\n');
    const msg = s.existing_entity_id
      ? `"${s.name}" kaydına şu bilgiler EKLENECEK (mevcutlar silinmez):\n${secText || '- (sadece not)'}${(s.aliases || []).length ? '\n- takma ad: ' + s.aliases.join(', ') : ''}\n\nOnaylıyor musun?`
      : `"${s.name}" YENİ ${ENTITY_TYPES[s.entity_type].label} olarak eklenecek:\n${s.description || ''}\n${secText}${(s.aliases || []).length ? '\n- takma ad: ' + s.aliases.join(', ') : ''}\n\nOnaylıyor musun?`;
    if (!confirm(msg)) return;
    try {
      await api.post('/ai/approve-suggestions', { suggestions: [s] });
      // Mention tespitini tazelemek için paragrafı aynı metinle yeniden
      // kaydet - yeni varlık/alias artık rozet olarak yakalanır.
      await api.put(`/chapters/${chapter.id}/paragraphs/${number}`, { number, text });
      const refreshed = await api.get(`/chapters/${chapter.id}`);
      currentChapter = refreshed;
      renderReader(refreshed);
    } catch (err) { alert(err.message); }
  }));
}

// ---------------------------------------------------------------------
// AI yazım destek paneli
// ---------------------------------------------------------------------

const PICKER_TYPES = ['character', 'place', 'event', 'object', 'foreshadowing'];
