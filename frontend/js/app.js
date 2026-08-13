// ---------------------------------------------------------------------------
// AI ODALARI: aynı motor, beş ön ayar. Her oda bağlam kapsamını, hangi
// araçların görüneceğini ve sohbetin çerçevesini belirler - ama DUVAR
// değildir: @isim ile her odada dışarıdan varlık çağırabilirsin. Her odanın
// kendi sohbet geçmişi vardır (karakter tartışması, bölüm tartışmasını
// kirletmesin diye).
// ---------------------------------------------------------------------------
const AI_ROOMS = {
  chapter: {
    icon: '📖', label: 'Bu Bölüm', scope: 'chapter', showPlan: true, showPicker: true, short: 'Bölüm',
    hint: 'Bölümün metni, planı ve özeti AI\'ya gider - sahne yazma, tartışma, devam ettirme.',
    frame: 'Bu sohbette ÜZERİNDE ÇALIŞILAN BÖLÜM konuşulacak: metni, planı, akışı ve sahneleri. Kısa ve somut konuş.',
    starters: ['Bu bölüm önceki bölümle bağlanıyor mu?', 'Bu bölümde tempo nerede düşüyor?', 'Plandaki hangi madde henüz işlenmemiş?'],
  },
  people: {
    icon: '👤', label: 'Kişiler', scope: 'none', showPlan: false, showPicker: true, short: 'Kişi',
    hint: 'Bölüm metni GİTMEZ - sadece seçili kişilerin profilleri. Karakter tutarlılığı ve ses için.',
    frame: 'Bu sohbette KARAKTERLER konuşulacak: profilleri, sesleri, tutarlılıkları, ilişkileri. Bölüm metni verilmedi; gerekirse sor.',
    starters: ['Bu karakterin sesi tutarlı mı?', 'Profilinde eksik ne var?', 'Bu karakteri diğerlerinden ne ayırıyor?'],
  },
  world: {
    icon: '📍', label: 'Mekân & Nesne', scope: 'none', showPlan: false, showPicker: true, short: 'Mekân',
    hint: 'Seçili mekan/nesnelerin profilleri gider. Dünya tutarlılığı ve atmosfer için.',
    frame: 'Bu sohbette MEKANLAR ve NESNELER konuşulacak: fiziksel yapı, atmosfer, kurallar, işlev. Bölüm metni verilmedi.',
    starters: ['Bu mekanın atmosferi nasıl güçlenir?', 'Bu nesnenin kuralları çelişiyor mu?', 'Mekan profilinde ne eksik?'],
  },
  paragraph: {
    icon: '✍️', label: 'Paragraf', scope: 'chapter', showPlan: false, showPicker: true, short: 'Paragraf',
    hint: 'Bölüm metni gider; "P12" gibi numarayla nokta atışı çalışırsın. Yanıt beğenilirse tek tıkla paragrafın yerine geçer.',
    frame: 'Bu sohbette TEK TEK PARAGRAFLAR üzerinde çalışılacak. Kullanıcı "P12" gibi numaralarla atıf yapar; yanıtların doğrudan o paragrafın yerine geçebilecek nitelikte, temiz metin olsun (açıklama ekleme).',
    starters: ['P1\'i daha gergin bir tonda yaz', 'Bu paragrafta hangi kelimeler fazla?', 'P2 ile P3 arasındaki geçiş pürüzlü mü?'],
  },
  novel: {
    icon: '🌍', label: 'Roman Geneli', scope: 'novel', showPlan: false, showPicker: false, short: 'Roman',
    hint: 'TÜM KİTABIN metni gider (pahalı) - tutarlılık, yapı, tekrar ve sonuç soruları için.',
    frame: 'Bu sohbette ROMANIN TAMAMI konuşulacak: yapı, tutarlılık, tekrarlar, karakter yayları, açık kalan ipuçları. Bulgularını bölüm numaralarıyla göster.',
    starters: ['Açık kalan ipuçları hangileri?', 'Hangi bölümler birbirini tekrar ediyor?', 'Karakter yayları tutarlı mı?'],
  },
};
let currentAiRoom = 'chapter';
const aiRoomHistories = {};

// Derin profil bölüm tanımları - backend'deki app/sections.py ile senkron
// tutulmalı (anahtarlar birebir aynı olmak ZORUNDA, backend bilinmeyen
// anahtarı 422 ile reddeder). "meta" AI'ya asla gönderilmez - formda da
// öyle etiketlenir. AI'ya açık 5 başlık + meta = 6.
const ENTITY_SECTIONS = {
  character: [
    { key: 'fiziksel_yapi', label: 'Fiziksel Yapı', hint: 'görünüş, boy/kilo/saç/göz, ayırt edici özellikler, giyim' },
    { key: 'duygusal_yapi', label: 'Kişilik & İç Dünya', hint: 'kişilik tipi, güçlü/zayıf yanlar, korkular, arzular, iç çatışma, karakter arc\'ı' },
    { key: 'gecmis', label: 'Geçmiş & Köken', hint: 'nereli, ait olduğu grup, meslek/kariyer, sırlar, travmalar, dönüm noktaları' },
    { key: 'iliskiler', label: 'İlişkiler', hint: 'aile/dost/düşman/aşk üzerine öznel notlar (harita için İlişkiler menüsü ayrı)' },
    { key: 'konusma_tarzi', label: 'Konuşma Tarzı', hint: 'üslup, sık kullandığı sözler, ses tonu, beden dili' },
    { key: 'gizli', label: '🔒 Gizli Katman', hint: 'sonraki kitapların sırrı: gizli bağlantılar, açığa çıkmamış motivasyonlar - AI\'ya normalde GİTMEZ, alt-metin moduyla sızdırmama direktifiyle verilir', isHidden: true },
    { key: 'meta', label: 'Meta (yazar notu)', hint: 'sembolizm, roman içindeki işlevi - AI\'ya ASLA gönderilmez', isMeta: true },
  ],
  place: [
    { key: 'fiziksel_yapi', label: 'Fiziksel Yapı', hint: 'mimari, boyut, düzen, malzeme, renk paleti, ayırt edici detaylar' },
    { key: 'atmosfer', label: 'Atmosfer & Zamansal Değişim', hint: 'ışık, ses, koku, his; saate/mevsime/olaylara göre değişim' },
    { key: 'gecmis', label: 'Geçmiş & Sırlar', hint: 'tarih, efsaneler, sahiplik, gizli alanlar, saklı sırlar' },
    { key: 'kurallar', label: 'Kurallar & Dinamikler', hint: 'kanunlar, yasaklar, güç yapısı, ritüeller, tehlikeler' },
    { key: 'baglantilar', label: 'Bağlantılar', hint: 'yakın mekanlar, ulaşım, sınırlar, sakinler' },
    { key: 'gizli', label: '🔒 Gizli Katman', hint: 'mekanın açığa çıkmamış sırrı - AI\'ya normalde gitmez', isHidden: true },
    { key: 'meta', label: 'Meta (yazar notu)', hint: 'sembolizm, roman içindeki işlevi - AI\'ya ASLA gönderilmez', isMeta: true },
  ],
  object: [
    { key: 'fiziksel_yapi', label: 'Fiziksel Yapı', hint: 'görünüm, malzeme, boyut/ağırlık, işçilik, yıpranma/hasar' },
    { key: 'gecmis', label: 'Köken & Geçmiş', hint: 'kim/ne zaman yaptı, önceki sahipler, efsanesi, sırları' },
    { key: 'islev', label: 'İşlev & Güçler', hint: 'ne işe yarar, güçleri, sınırları/bedeli, kullanım kuralları' },
    { key: 'sahiplik', label: 'Sahiplik & Konum', hint: 'şu an kimde, nerede duruyor, kimler biliyor' },
    { key: 'gizli', label: '🔒 Gizli Katman', hint: 'nesnenin açığa çıkmamış gerçek doğası - AI\'ya normalde gitmez', isHidden: true },
    { key: 'meta', label: 'Meta (yazar notu)', hint: 'sembolizm, olay örgüsündeki rolü - AI\'ya ASLA gönderilmez', isMeta: true },
  ],
};

const ENTITY_TYPES = {
  character: { endpoint: '/characters/', label: 'Kişi', plural: 'Kişiler', hasStatus: true, statusOptions: ['aktif', 'pasif', 'öldü'], isRule: false, hasAliases: true },
  place: { endpoint: '/places/', label: 'Mekan', plural: 'Mekanlar', hasStatus: false, isRule: false, hasAliases: true },
  event: { endpoint: '/events/', label: 'Olay', plural: 'Olaylar', hasStatus: false, isRule: false, isCustom: true },
  object: { endpoint: '/objects/', label: 'Nesne', plural: 'Nesneler', hasStatus: false, isRule: false, hasAliases: true },
  foreshadowing: { endpoint: '/foreshadowings/', label: 'İpucu', plural: 'İpuçları', hasStatus: true, statusOptions: ['açık', 'kapandı'], isRule: false },
  term: { endpoint: '/glossary/', label: 'Terim', plural: 'Terimler', hasStatus: false, isRule: false },
  rule: { endpoint: '/rules/', label: 'Kural', plural: 'Roman Kuralları', hasStatus: false, isRule: true, hasTags: true },
  faction: { endpoint: '/factions/', label: 'Grup / Kurum', plural: 'Gruplar & Kurumlar', hasStatus: false, isRule: false },
};

const main = () => document.getElementById('mainContent');

function escapeHtml(str) {
  if (str === undefined || str === null) return '';
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function truncate(str, n) { return str && str.length > n ? str.slice(0, n) + '…' : (str || ''); }

// Bölüm/Başlık/Alt Başlık metinleri bazen bir AI sohbetinden ya da başka bir
// yerden kopyala-yapıştır ile geliyor ve markdown işaretlerini ("> alıntı",
// "**kalın**" vb.) ham haliyle taşıyor. Fihriste bunlar olduğu gibi
// göründüğünde çirkin duruyor (ör. "> **DİJİTAL DOĞUMUN SANCILARI.**").
// Bu fonksiyon hem yeni girilen metni temizlemek hem de daha önce böyle
// kaydedilmiş eski verileri EKRANDA düzgün göstermek için kullanılır -
// veritabanındaki veriyi değiştirmez, sadece görüntüyü/yeni girdiyi temizler.
function stripMarkdownArtifacts(str) {
  if (!str) return str || '';
  let s = String(str).trim();
  // Başındaki "> " / ">> " gibi alıntı (blockquote) işaretlerini temizle
  s = s.replace(/^>+\s*/, '');
  // Başındaki "#", "##" başlık işaretleri (boşluksuz "#BİRİNCİ" dahil) -
  // içe aktarılan el yazmalarında başlıklar markdown # ile gelebiliyor
  s = s.replace(/^#+\s*/, '');
  // **kalın** ve __kalın__
  s = s.replace(/\*\*(.+?)\*\*/g, '$1');
  s = s.replace(/__(.+?)__/g, '$1');
  // *italik* ve _italik_ (kelime ortasındaki tekil * / _ karakterlerine dokunma)
  s = s.replace(/(^|\s)\*(\S.*?\S|\S)\*(?=\s|$)/g, '$1$2');
  s = s.replace(/(^|\s)_(\S.*?\S|\S)_(?=\s|$)/g, '$1$2');
  return s.replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------
// Görünüm değiştirme
// ---------------------------------------------------------------------

async function switchView(view) {
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.view === view));
  if (view !== 'roman' && dirtyChapterId) {
    const toScan = dirtyChapterId;
    dirtyChapterId = null;
    runBackgroundChapterScan(toScan);
  }
  if (view === 'roman') return renderRomanView();
  if (view === 'import') return renderImportView();
  if (view === 'event') return renderEventsView();
  if (view === 'relationships') return renderRelationshipsView();
  if (view === 'knowledge') return renderKnowledgeView();
  if (view === 'fullscan' || view === 'stylescan' || view === 'denetim') return renderDenetimView(view);
  if (view === 'matrix') return renderMatrixView();
  if (view === 'faction') return renderFactionView();
  if (view === 'place') return renderPlacesView();
  return renderEntityView(view);
}

// ---------------------------------------------------------------------
// Ortak menü görünümü (Kişiler, Mekanlar, Olaylar, Nesneler, İpuçları, Terimler, Kurallar)
// ---------------------------------------------------------------------

async function renderEntityView(type) {
  if (type === 'rule') {
    // Kapsam rozetleri için isim haritası - üç liste tek seferde çekilir
    // ve yalnızca kural görünümüne girildiğinde (maliyet önemsiz).
    try {
      const [chars, places, objects] = await Promise.all([
        api.get('/characters/'), api.get('/places/'), api.get('/objects/'),
      ]);
      window.__ruleScopeNames = {};
      chars.forEach(c => { window.__ruleScopeNames[`character:${c.id}`] = c.name; });
      places.forEach(p => { window.__ruleScopeNames[`place:${p.id}`] = p.name; });
      objects.forEach(o => { window.__ruleScopeNames[`object:${o.id}`] = o.name; });
    } catch (e) { window.__ruleScopeNames = {}; }
  }
  const cfg = ENTITY_TYPES[type];
  main().innerHTML = `
    <h1 class="view-title">${cfg.plural}</h1>
    <div class="toolbar">
      <div></div>
      <button class="btn btn-primary" id="addBtn">+ Yeni ${cfg.label}</button>
    </div>
    <div class="entity-list" id="entityList"><div class="empty-state">Yükleniyor…</div></div>
    <div id="formContainer"></div>`;

  document.getElementById('addBtn').addEventListener('click', () => showEntityForm(type, null));

  try {
    const items = await api.get(cfg.endpoint);
    renderEntityList(type, items);
  } catch (err) {
    document.getElementById('entityList').innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`;
  }
}

function renderEntityList(type, items) {
  const cfg = ENTITY_TYPES[type];
  const listEl = document.getElementById('entityList');
  if (!items.length) {
    listEl.innerHTML = `<div class="empty-state">Henüz kayıt yok.</div>`;
    return;
  }
  // Kapsamlı kurallar için varlık adlarını çöz (id -> isim) - rozette
  // "Kişi #12" yerine "Kişi: Vicdan" görünsün. Global harita renderEntityView
  // tarafından doldurulur (aşağıda), yoksa tip etiketiyle yetinilir.
  const scopeBadge = (item) => {
    if (!cfg.isRule || !item.entity_id) return '';
    const typeLabel = (ENTITY_TYPES[item.entity_type] || {}).label || item.entity_type;
    const nm = (window.__ruleScopeNames || {})[`${item.entity_type}:${item.entity_id}`];
    return ` <span style="font-size:10.5px;background:var(--paper-dim);border:1px solid var(--border);border-radius:3px;padding:0 5px;" title="Bu kural sadece bu kayıt sahnedeyken AI'ya gider">🔗 ${typeLabel}${nm ? ': ' + escapeHtml(nm) : ''}</span>`;
  };
  listEl.innerHTML = items.map(item => {
    // Rozet HTML'dir - başlık metnine EKLENMEZ, çünkü başlık escapeHtml'den
    // geçiyor ve etiket düz metin olarak yazılıyordu. Ayrı tutulur.
    const title = cfg.isRule ? item.title : item.name;
    const ruleScopeBadge = cfg.isRule ? scopeBadge(item) : '';
    const statusBadge = cfg.hasStatus ? ` · ${item.status}` : '';
    const notesLine = (!cfg.isRule && item.notes) ? `<div class="desc" style="font-style:italic;margin-top:2px;">${escapeHtml(truncate(item.notes, 140))}</div>` : '';
    const progressionBtn = cfg.isRule ? '' : `<button class="btn btn-sm progression-btn" data-id="${item.id}">Gelişim</button>`;
    const progressionPanel = cfg.isRule ? '' : `<div class="progression-panel" data-id="${item.id}" style="display:none;width:100%;margin-top:8px;padding-top:8px;border-top:1px dashed var(--border);"></div>`;
    return `<div class="entity-row" style="${cfg.isRule ? '' : 'flex-wrap:wrap;'}">
      <div>
        <div class="name">${escapeHtml(title)}${ruleScopeBadge}${statusBadge}</div>
        <div class="desc">${escapeHtml(truncate(item.description, 120))}</div>
        ${notesLine}
      </div>
      <div class="actions">
        <button class="btn btn-sm edit-btn" data-id="${item.id}">Düzenle</button>
        ${progressionBtn}
        <button class="btn btn-sm history-btn" data-id="${item.id}" title="Bu kayıtta neler değişti, gerekirse eskiye dön">Geçmiş</button>
        <button class="btn btn-sm btn-danger del-btn" data-id="${item.id}">Sil</button>
      </div>
      ${progressionPanel}
      <div class="history-panel" data-id="${item.id}" style="display:none;width:100%;margin-top:8px;padding-top:8px;border-top:1px dashed var(--border);"></div>
    </div>`;
  }).join('');

  listEl.querySelectorAll('.progression-btn').forEach(btn => {
    btn.addEventListener('click', () => toggleProgressionPanel(type, btn.dataset.id));
  });
  listEl.querySelectorAll('.history-btn').forEach(btn => {
    btn.addEventListener('click', () => toggleHistoryPanel(type, btn.dataset.id));
  });

  listEl.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = items.find(i => String(i.id) === btn.dataset.id);
      showEntityForm(type, item);
    });
  });
  listEl.querySelectorAll('.del-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Bu kaydı silmek istediğine emin misin?')) return;
      try {
        await api.del(`${cfg.endpoint}${btn.dataset.id}`);
        if (type === 'faction') renderFactionView(); else renderEntityView(type);
      } catch (err) { alert(err.message); }
    });
  });
}

// ---------------------------------------------------------------------
// Mekanlar - iç içe (hiyerarşik) görünüm. Bir mekan başka bir mekanın
// İÇİNDE olabilir (parent_place_id) - sınır yok, istediğin kadar iç içe
// geçebilir (bkz. proje sohbet geçmişi). Bölüm fihristindeki açılır/
// kapanır Kısım mantığıyla AYNI görsel dil kullanılıyor (chapter-toggle
// class'ı ortak) - kullanıcı zaten o etkileşimi biliyor.
// ---------------------------------------------------------------------

const collapsedPlaceGroups = new Set();

async function renderPlacesView() {
  main().innerHTML = `
    <h1 class="view-title">Mekanlar</h1>
    <div class="toolbar">
      <div></div>
      <button class="btn btn-primary" id="addBtn">+ Yeni Mekan</button>
    </div>
    <div class="entity-list" id="placeTree"><div class="empty-state">Yükleniyor…</div></div>
    <div id="formContainer"></div>`;

  document.getElementById('addBtn').addEventListener('click', () => showEntityForm('place', null));

  try {
    const places = await api.get('/places/');
    renderPlaceTree(places);
  } catch (err) {
    document.getElementById('placeTree').innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`;
  }
}

function renderPlaceTree(places) {
  const el = document.getElementById('placeTree');
  if (!places.length) {
    el.innerHTML = '<div class="empty-state">Henüz mekan yok.</div>';
    return;
  }

  const byParent = new Map();
  places.forEach(p => {
    const key = p.parent_place_id != null ? String(p.parent_place_id) : 'root';
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(p);
  });
  byParent.forEach(list => list.sort((a, b) => a.name.localeCompare(b.name, 'tr')));

  const rows = [];
  // Döngüsel/hatalı veriye (A'nın üstü B, B'nin üstü A) karşı basit bir
  // güvenlik ağı - derinlik sınırı olmasa da (kullanıcı isteği) sonsuz
  // döngüye girmemek için bir üst sınır koyuyoruz.
  function walk(parentKey, level, hiddenByAncestor) {
    if (level > 100) return;
    const children = byParent.get(parentKey) || [];
    children.forEach(p => {
      const hasChildren = byParent.has(String(p.id));
      rows.push({ place: p, level, hasChildren, hidden: hiddenByAncestor });
      const nowHidden = hiddenByAncestor || collapsedPlaceGroups.has(String(p.id));
      walk(String(p.id), level + 1, nowHidden);
    });
  }
  walk('root', 0, false);

  el.innerHTML = rows.filter(r => !r.hidden).map(r => {
    const p = r.place;
    const indent = r.level * 18;
    const isCollapsed = collapsedPlaceGroups.has(String(p.id));
    const toggle = r.hasChildren
      ? `<button class="chapter-toggle" data-id="${p.id}" title="${isCollapsed ? 'Genişlet' : 'Daralt'}">${isCollapsed ? '▸' : '▾'}</button>`
      : `<span class="chapter-toggle" style="visibility:hidden;">▸</span>`;
    const notesLine = p.notes ? `<div class="desc" style="font-style:italic;margin-top:2px;">${escapeHtml(truncate(p.notes, 140))}</div>` : '';
    return `<div class="entity-row" style="padding-left:${14 + indent}px;flex-wrap:wrap;">
      ${toggle}
      <div style="flex:1;min-width:180px;">
        <div class="name">${escapeHtml(p.name)}</div>
        <div class="desc">${escapeHtml(truncate(p.description, 120))}</div>
        ${notesLine}
      </div>
      <div class="actions">
        <button class="btn btn-sm edit-place-btn" data-id="${p.id}">Düzenle</button>
        <button class="btn btn-sm progression-btn" data-id="${p.id}">Gelişim</button>
        <button class="btn btn-sm history-btn" data-id="${p.id}" title="Bu kayıtta neler değişti, gerekirse eskiye dön">Geçmiş</button>
        <button class="btn btn-sm btn-danger del-place-btn" data-id="${p.id}">Sil</button>
      </div>
      <div class="progression-panel" data-id="${p.id}" style="display:none;width:100%;margin-top:8px;padding-top:8px;border-top:1px dashed var(--border);"></div>
      <div class="history-panel" data-id="${p.id}" style="display:none;width:100%;margin-top:8px;padding-top:8px;border-top:1px dashed var(--border);"></div>
    </div>`;
  }).join('');

  el.querySelectorAll('.chapter-toggle[data-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      if (collapsedPlaceGroups.has(id)) collapsedPlaceGroups.delete(id); else collapsedPlaceGroups.add(id);
      renderPlaceTree(places);
    });
  });
  el.querySelectorAll('.edit-place-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = places.find(x => String(x.id) === btn.dataset.id);
      showEntityForm('place', p);
    });
  });
  el.querySelectorAll('.del-place-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Bu mekanı silmek istediğine emin misin? (Altındaki mekanlar varsa siLİNMEZ, sadece üst mekanları boşa düşer)')) return;
      try {
        await api.del(`/places/${btn.dataset.id}`);
        renderPlacesView();
      } catch (err) { alert(err.message); }
    });
  });
  el.querySelectorAll('.progression-btn').forEach(btn => {
    btn.addEventListener('click', () => toggleProgressionPanel('place', btn.dataset.id));
  });
  el.querySelectorAll('.history-btn').forEach(btn => {
    btn.addEventListener('click', () => toggleHistoryPanel('place', btn.dataset.id));
  });
}

// ---------------------------------------------------------------------
// Gelişim çizelgesi (Progressions): bir kaydın zaman içinde değişen
// bilgisini kronolojik olarak gösterir/düzenler.
// ---------------------------------------------------------------------

async function toggleProgressionPanel(entityType, entityId) {
  const panel = document.querySelector(`.progression-panel[data-id="${entityId}"]`);
  if (!panel) return;
  if (panel.style.display !== 'none') { panel.style.display = 'none'; return; }
  panel.style.display = 'block';
  await loadProgressionPanel(entityType, entityId);
}

// ---------------------------------------------------------------------
// Değişiklik geçmişi: description/notes/sections/aliases/tags/status gibi
// alanlardan biri PUT ile değiştiğinde eski hali otomatik kaydediliyor
// (bkz. backend generic_crud.py) - bu panel o geçmişi gösterip istenirse
// eski hale geri döndürüyor. Paragraf metninde zaten var olan "eski
// versiyona dön" mantığının menü verisi karşılığı.
// ---------------------------------------------------------------------

const FIELD_LABELS_TR = {
  title: 'Başlık', description: 'Açıklama', notes: 'Notlar', sections: 'Derin Profil',
  aliases: 'Alternatif İsimler', tags: 'Etiketler', status: 'Durum',
};

function formatHistoryValue(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.join(', ');
  if (value && typeof value === 'object') {
    return Object.entries(value).map(([k, v]) => `${k}: ${v}`).join(' · ');
  }
  return String(value);
}

async function toggleHistoryPanel(entityType, entityId) {
  const panel = document.querySelector(`.history-panel[data-id="${entityId}"]`);
  if (!panel) return;
  if (panel.style.display !== 'none') { panel.style.display = 'none'; return; }
  panel.style.display = 'block';
  panel.innerHTML = '<div class="empty-state">Yükleniyor…</div>';
  try {
    const history = await api.get(`/entity-history/${entityType}/${entityId}`);
    renderHistoryPanel(panel, entityType, entityId, history);
  } catch (err) {
    panel.innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`;
  }
}

function renderHistoryPanel(panel, entityType, entityId, history) {
  if (!history.length) {
    panel.innerHTML = '<div class="empty-state" style="text-align:left;padding:6px 0;">Bu kayıt için henüz değişiklik geçmişi yok.</div>';
    return;
  }
  panel.innerHTML = `
    <strong style="font-size:11px;color:var(--text-muted);letter-spacing:0.4px;">DEĞİŞİKLİK GEÇMİŞİ</strong>
    ${history.map(h => `
      <div style="padding:6px 0;border-bottom:1px solid var(--border);font-size:12.5px;">
        <div><strong>${escapeHtml(FIELD_LABELS_TR[h.field_name] || h.field_name)}</strong> — <span style="color:var(--text-muted);">${new Date(h.saved_at).toLocaleString('tr-TR')}</span></div>
        <div style="margin:3px 0;color:var(--text-muted);font-style:italic;">"${escapeHtml(truncate(formatHistoryValue(h.old_value), 150))}"</div>
        <button class="btn btn-sm restore-history-btn" data-snapshot-id="${h.id}">Bu Haline Geri Dön</button>
      </div>`).join('')}`;

  panel.querySelectorAll('.restore-history-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Bu alanı gösterilen eski haline geri döndürmek istediğine emin misin?\n\n(Şu anki hali de ayrıca kaydedilecek - istersen bu geri dönüşü de sonra geri alabilirsin.)')) return;
      try {
        await api.post(`/entity-history/${btn.dataset.snapshotId}/restore`, {});
        if (entityType === 'place') renderPlacesView(); else renderEntityView(entityType);
      } catch (err) { alert(err.message); }
    });
  });
}

async function loadProgressionPanel(entityType, entityId) {
  const panel = document.querySelector(`.progression-panel[data-id="${entityId}"]`);
  if (!panel) return;
  panel.innerHTML = '<div class="empty-state">Yükleniyor…</div>';
  try {
    const items = await api.get(`/progressions/?entity_type=${entityType}&entity_id=${entityId}`);
    const rows = items.map(p => `
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:12.5px;padding:4px 0;">
        <span><strong>${p.chapter_number ? 'Bölüm ' + p.chapter_number : 'Bölüm belirtilmemiş'}:</strong> ${escapeHtml(p.note)}</span>
        <button class="btn-icon-sm del-progression-btn" data-id="${p.id}" title="Sil">✕</button>
      </div>`).join('');
    panel.innerHTML = `
      <strong style="font-size:10.5px;color:var(--text-muted);letter-spacing:0.4px;">GELİŞİM ÇİZELGESİ</strong>
      ${rows || '<div class="empty-state" style="padding:4px 0;">Henüz gelişim notu yok.</div>'}
      <button class="btn btn-sm" id="addProgressionBtn" style="margin-top:6px;">+ Yeni gelişim notu</button>`;

    panel.querySelectorAll('.del-progression-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await api.del(`/progressions/${btn.dataset.id}`);
          loadProgressionPanel(entityType, entityId);
        } catch (err) { alert(err.message); }
      });
    });
    document.getElementById('addProgressionBtn').addEventListener('click', async () => {
      const chapterNumber = prompt('Hangi bölümden itibaren geçerli? Bir SAYI gir (ör. 3), boş da bırakabilirsin:');
      if (chapterNumber === null) return;
      if (chapterNumber.trim() && Number.isNaN(parseInt(chapterNumber.trim(), 10))) {
        alert(`"${chapterNumber}" bir sayı değil - bölüm numarasını rakamla yaz (ör. 3) ya da boş bırak.`);
        return;
      }
      const note = prompt('Ne değişti? (ör: "Bacağından yaralandı")');
      if (!note) return;
      try {
        await api.post('/progressions/', {
          entity_type: entityType, entity_id: parseInt(entityId, 10),
          chapter_number: chapterNumber.trim() ? parseInt(chapterNumber.trim(), 10) : null,
          note,
        });
        loadProgressionPanel(entityType, entityId);
      } catch (err) { alert(err.message); }
    });
  } catch (err) {
    panel.innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`;
  }
}

async function showEntityForm(type, item) {
  const cfg = ENTITY_TYPES[type];
  const container = document.getElementById('formContainer');
  const isEdit = !!item;
  const titleValue = isEdit ? (cfg.isRule ? item.title : item.name) : '';
  const descValue = isEdit ? item.description : '';
  const notesValue = isEdit ? (item.notes || '') : '';
  const statusValue = isEdit ? item.status : (cfg.statusOptions ? cfg.statusOptions[0] : '');
  const aliasesValue = isEdit ? (item.aliases || []).join(', ') : '';
  const tagsValue = isEdit ? (item.tags || []).join(', ') : '';

  // Mekanlar için "Üst Mekan" seçici - kendi kendinin/altsoyunun üst
  // mekanı olmasını önlemek için basit bir döngü koruması var (kendi id'si
  // ve BFS ile bulunan tüm altsoyu seçilemez listesine alınır).
  let parentSelectHtml = '';
  if (type === 'place') {
    let allPlaces = [];
    try { allPlaces = await api.get('/places/'); } catch (e) { /* seçici olmadan devam - kritik değil */ }
    const excludeIds = new Set();
    if (isEdit) {
      excludeIds.add(item.id);
      let frontier = [item.id];
      while (frontier.length) {
        const next = allPlaces.filter(p => frontier.includes(p.parent_place_id)).map(p => p.id);
        next.forEach(id => excludeIds.add(id));
        frontier = next;
      }
    }
    const selectable = allPlaces.filter(p => !excludeIds.has(p.id));
    parentSelectHtml = `<div class="field">
      <label>Üst Mekan <span style="font-weight:400;color:var(--text-muted);">(bu mekan başka bir mekanın içindeyse)</span></label>
      <select id="f_parent_place">
        <option value="">(yok - en üst seviye)</option>
        ${selectable.map(p => `<option value="${p.id}" ${isEdit && item.parent_place_id === p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
      </select>
    </div>`;
  }

  // --- Derin Profil (sadece Kişi/Mekan): 6 başlık, açılır-kapanır. -----
  // Temel form kısa kalır ("tekdüze" ama hızlı); derinleşmek isteyen bu
  // bloğu açar. Dolu başlık sayısı düğmede görünür - "bilgi girildikçe"
  // ilerleme hissi verir. Her başlığın altında ne yazılacağını anlatan
  // gri bir ipucu var; meta başlığı "AI'ya gönderilmez" diye işaretli.
  // --- Kayda özel kurallar kutusu (sadece Kişi/Mekan/Nesne + düzenleme
  // modunda: yeni kayıtta henüz id yok). Kural burada eklenir ama Kurallar
  // menüsündeki ana listede de kapsam rozetiyle görünür - menü liste
  // görevini korur, ekleme yerinde yapılır.
  const supportsRules = ['character', 'place', 'object'].includes(type) && isEdit;
  // Yeni kayıtta kural kutusu YOK (kural bir kayda bağlanır, henüz id yok) -
  // ama kullanıcı "kutular değişmemiş" sanmasın diye nedeni yazılır.
  const rulesHintHtml = (!isEdit && ['character', 'place', 'object'].includes(type)) ? `
    <div style="font-size:11.5px;color:var(--text-muted);margin:8px 0 0;">
      Kayda özel kurallar ("Vicdan yargıç değil" gibi) kaydettikten sonra,
      bu kaydı ✎ ile açtığında eklenir.
    </div>` : '';
  const entityRulesHtml = supportsRules ? `
    <div style="margin:10px 0 4px;">
      <strong style="font-size:11px;color:var(--text-muted);letter-spacing:0.4px;">BU KAYDA ÖZEL KURALLAR</strong>
      <span style="font-size:11px;color:var(--text-muted);"> - sadece bu kayıt sahnedeyken AI'ya gider</span>
    </div>
    <div id="entityRulesList" style="border-left:3px solid var(--border);padding-left:10px;"></div>
    <div style="display:flex;gap:6px;margin-top:6px;">
      <input type="text" id="entityRuleTitle" placeholder="ör. Vicdan yargıç değil - hüküm vermez" style="flex:1;">
      <button type="button" class="btn btn-sm" id="entityRuleAddBtn">+ Kural</button>
    </div>` : '';

  const sectionDefs = ENTITY_SECTIONS[type] || null;
  let sectionsHtml = '';
  if (sectionDefs) {
    // Yeni kayıtta da profil kutuları görünür (create sections'ı destekliyor) -
    // kişiyi eklerken görünüşünü/konuşma tarzını aynı anda yazabilmek için.
    const savedSections = (isEdit && item.sections) ? item.sections : {};
    const filledCount = sectionDefs.filter(d => (savedSections[d.key] || '').trim()).length;
    // Varsayılan AÇIK: kutuların kapalı gelmesi "menü eksik" hissi veriyordu.
    // Kullanıcı isterse başlığa basıp kapatabilir.
    const startOpen = true;
    sectionsHtml = `
      <div style="margin:14px 0 4px;">
        <button type="button" class="btn btn-sm" id="toggleSectionsBtn" title="Gizlemek için tıkla">${startOpen ? '▾' : '▸'} Derin Profil <span style="color:var(--text-muted);font-weight:400;">(${filledCount}/${sectionDefs.length} dolu)</span></button>
      </div>
      <div id="sectionsBlock" style="${startOpen ? '' : 'display:none;'}border-left:3px solid var(--border);padding-left:12px;margin-bottom:6px;">
        <p style="font-size:12px;color:var(--text-muted);margin:6px 0 10px;">Bu bölümlerin TAMAMI her AI isteğinde gönderilmez - talimatla ilgili olan otomatik seçilir, gerisi sadece isim olarak listelenir. Meta hiç gönderilmez.</p>
        ${sectionDefs.map(d => `
          <div class="field">
            <label>${d.label} <span style="font-weight:400;color:var(--text-muted);font-size:11.5px;">(${d.hint})</span></label>
            <textarea id="f_section_${d.key}" ${d.isMeta || d.isHidden ? 'style="border-style:dashed;"' : ''}>${escapeHtml(savedSections[d.key] || '')}</textarea>
          </div>`).join('')}
      </div>`;
  }

  container.innerHTML = `
    <div class="panel">
      <div class="field">
        <label>${cfg.isRule ? 'Başlık' : 'İsim'}</label>
        <input type="text" id="f_title" value="${escapeHtml(titleValue)}">
      </div>
      ${cfg.hasAliases ? `<div class="field">
        <label>Alternatif isimler / unvanlar <span style="font-weight:400;color:var(--text-muted);">(virgülle ayır - ör. "Kral, Majesteleri")</span></label>
        <input type="text" id="f_aliases" value="${escapeHtml(aliasesValue)}" placeholder="Kral, Majesteleri">
      </div>` : ''}
      ${parentSelectHtml}
      <div class="field">
        <label>${cfg.isRule ? 'Açıklama' : 'Kısa tanım'} ${cfg.isRule ? '' : `<span style="font-weight:400;color:var(--text-muted);font-size:11.5px;">(tek cümle - fihriste ve HER AI isteğine giden özet; uzun bilgi aşağıdaki Derin Profil'e)</span>`}</label>
        <textarea id="f_desc" ${cfg.isRule ? '' : 'style="min-height:52px;"'}>${escapeHtml(descValue)}</textarea>
      </div>
      ${cfg.hasTags ? `<div class="field">
        <label>Etiketler <span style="font-weight:400;color:var(--text-muted);">(virgülle ayır - boş bırakırsan her zaman dahil edilir)</span></label>
        <input type="text" id="f_tags" value="${escapeHtml(tagsValue)}" placeholder="buyu, kuzey-hanesi">
      </div>` : ''}
      ${cfg.hasStatus ? `<div class="field"><label>Durum</label>
        <select id="f_status">
          ${cfg.statusOptions.map(opt => `<option value="${opt}" ${statusValue === opt ? 'selected' : ''}>${opt.charAt(0).toUpperCase() + opt.slice(1)}</option>`).join('')}
        </select></div>` : ''}
      ${sectionsHtml}
      ${entityRulesHtml}${rulesHintHtml}
      ${cfg.isRule ? '' : `<div class="field" style="margin-top:10px;"><label>Notlar <span style="font-weight:400;color:var(--text-muted);font-size:11.5px;">(serbest not - kişi seçiliyken AI'ya gider)</span></label><textarea id="f_notes">${escapeHtml(notesValue)}</textarea></div>`}
      <div class="form-actions">
        <button class="btn btn-primary" id="saveBtn">${isEdit ? 'Güncelle' : 'Kaydet'}</button>
        <button class="btn" id="cancelBtn">Vazgeç</button>
      </div>
      <div id="formError" class="error-text"></div>
    </div>`;

  document.getElementById('cancelBtn').addEventListener('click', () => { container.innerHTML = ''; });
  if (supportsRules) {
    loadEntityRules(type, item.id);
    document.getElementById('entityRuleAddBtn').addEventListener('click', async () => {
      const title = document.getElementById('entityRuleTitle').value.trim();
      if (!title) return;
      try {
        await api.post('/rules/', { title, entity_type: type, entity_id: item.id });
        document.getElementById('entityRuleTitle').value = '';
        loadEntityRules(type, item.id);
      } catch (err) { alert(err.message); }
    });
  }
  const toggleSectionsBtn = document.getElementById('toggleSectionsBtn');
  if (toggleSectionsBtn) {
    toggleSectionsBtn.addEventListener('click', () => {
      const block = document.getElementById('sectionsBlock');
      const isHidden = block.style.display === 'none';
      block.style.display = isHidden ? '' : 'none';
      toggleSectionsBtn.innerHTML = toggleSectionsBtn.innerHTML.replace(isHidden ? '▸' : '▾', isHidden ? '▾' : '▸');
    });
  }
  document.getElementById('saveBtn').addEventListener('click', async () => {
    const titleField = cfg.isRule ? 'title' : 'name';
    const payload = {};
    payload[titleField] = document.getElementById('f_title').value.trim();
    payload.description = document.getElementById('f_desc').value;
    if (!cfg.isRule) payload.notes = document.getElementById('f_notes').value;
    if (cfg.hasStatus) payload.status = document.getElementById('f_status').value;
    if (cfg.hasAliases) {
      payload.aliases = document.getElementById('f_aliases').value.split(',').map(s => s.trim()).filter(Boolean);
    }
    if (cfg.hasTags) {
      payload.tags = document.getElementById('f_tags').value.split(',').map(s => s.trim()).filter(Boolean);
    }
    if (type === 'place') {
      const parentVal = document.getElementById('f_parent_place').value;
      payload.parent_place_id = parentVal ? parseInt(parentVal, 10) : null;
    }
    if (sectionDefs) {
      // Tüm anahtarlar her zaman gönderilir (boşlar dahil) - "gördüğün ne
      // ise kaydedilen o" davranışı: bir alanı boşaltmak onu gerçekten
      // temizler (backend merge'i, gönderilen anahtarı olduğu gibi yazar).
      payload.sections = {};
      sectionDefs.forEach(d => {
        payload.sections[d.key] = document.getElementById(`f_section_${d.key}`).value;
      });
    }

    if (!payload[titleField]) {
      document.getElementById('formError').textContent = 'İsim/başlık boş olamaz.';
      return;
    }
    try {
      if (isEdit) await api.put(`${cfg.endpoint}${item.id}`, payload);
      else await api.post(cfg.endpoint, payload);
      container.innerHTML = '';
      if (type === 'place') renderPlacesView();
      else renderEntityView(type);
    } catch (err) {
      document.getElementById('formError').textContent = err.message;
    }
  });
}

// ---------------------------------------------------------------------
// Roman görünümü: bölüm listesi + okuma/yazma paneli + AI paneli
// ---------------------------------------------------------------------

let currentChapter = null;
// Bir bölümde paragraf değişikliği olduğunda o bölümün id'si buraya yazılır.
// Kullanıcı BAŞKA bir bölüme geçtiğinde, bu "kirli" bölüm arka planda
// otomatik olarak taranır (yeni varlık + gelişim notu için) - yazarken
// her kaydette AI'yı tetiklemek yerine, bölümü bitirip ayrılınca tetiklemek
// hem daha ucuz hem daha az rahatsız edici.
let dirtyChapterId = null;
// chapterId -> {entities: [...], progressions: [...]} - arka plan
// taramasının sonucu, kullanıcı o bölümü tekrar açana kadar burada bekler.
const pendingAiSuggestions = {};

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

  document.getElementById('newChapterBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    const menu = document.getElementById('newChapterMenu');
    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
  });
  document.querySelectorAll('#newChapterMenu button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('newChapterMenu').style.display = 'none';
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
  document.getElementById('editChapterCancel').addEventListener('click', close);
  document.getElementById('editChapterSave').addEventListener('click', async () => {
    const title = document.getElementById('editChapterTitle').value.trim();
    const kind = document.getElementById('editChapterKind').value;
    if (!title && kind !== 'chapter') {
      document.getElementById('editChapterError').textContent = 'Kısım/Alt Başlık için başlık zorunlu.';
      return;
    }
    try {
      await api.put(`/chapters/${c.id}`, { title: stripMarkdownArtifacts(title), kind });
      close();
      await loadChapterList(currentChapter ? currentChapter.id : undefined, true);
    } catch (err) { document.getElementById('editChapterError').textContent = err.message; }
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

  document.getElementById('closeBulkScanBtn').addEventListener('click', () => {
    panel.style.display = 'none';
    panel.innerHTML = '';
  });
  document.getElementById('runBulkScanBtn').addEventListener('click', async (e) => {
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

  document.getElementById('createItemCancelBtn').addEventListener('click', () => { overlay.style.display = 'none'; });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.style.display = 'none'; }, { once: true });

  document.getElementById('createItemConfirmBtn').addEventListener('click', async (e) => {
    const rawTitle = document.getElementById('createItemTitle').value;
    if (kind !== 'chapter' && !rawTitle.trim()) {
      document.getElementById('createItemError').textContent = `${kindLabel} için bir metin gerekli.`;
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
      document.getElementById('createItemError').textContent = err.message;
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
    .then(r => { window.__currentChapterPlan = (r && r.content) || ''; })
    .catch(() => { window.__currentChapterPlan = ''; });
  const chapterEntryNumber = (buildChapterHierarchy(lastLoadedChapters)
    .find(it => String(it.chapter.id) === String(chapter.id)) || {}).displayNumber || '';
  const paragraphsHtml = chapter.paragraphs.map(p => `
    <div class="paragraph-block" id="para-global-${p.id}">
      <div class="paragraph-number para-ref-code" data-num="${p.number}"
           title="Atıf kodu. Bu bölümdeyken sohbette 'P${p.number}' yeter; başka bir girdiden atıf yaparken '${chapterEntryNumber}P${p.number}' yaz. Tıkla: tam kodu kopyala.">
        <div style="font-size:11px;color:var(--gold,#b08d3f);font-weight:700;cursor:pointer;">P${p.number}</div>
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
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">
      <button class="btn btn-sm" id="highlightNamesBtn" title="Metinde tanımlı kişi/mekan/nesne isimlerinin altını çizer ve tıklanabilir yapar. Bu moda geçince paragraflar okuma moduna alınır (metin bozulmasın diye) - kapatınca yazmaya devam edersin.">🔎 İsimleri Vurgula</button>
      <button class="btn btn-sm" id="ttsPlayBtn" title="Bölümü sesli okur (tarayıcının Türkçe sesi - ücretsiz, metin dışarı çıkmaz). Okunan paragraf vurgulanır; bir paragrafa tıklayıp oradan devam edebilirsin.">🔊 Sesli Oku</button>

      ${chapterScoreStrip(chapter.id)}
      <button class="btn btn-sm btn-primary" id="workshopBtn" title="Bölümü paragraf paragraf, tek ekranda düzenle. Önce hazırlık (özet, zaman çizelgesi, plan) kontrol edilir, sonra inceleme çalışır, sonra her paragraf sırayla ele alınır. Mobilde tam ekran.">🛠 Bölüm Atölyesi</button>
      <button class="btn btn-sm" id="chapterReviewBtn" title="İKİ AŞAMALI İNCELEME: önce editör gözüyle 10 edebî ölçüt, sonra okur gözüyle düşürücü noktalar. Bulgular paragraf paragraf birleştirilir; her paragrafı AI ile konuşarak karara bağlarsın.">🔍 Bölüm İncelemesi</button>
      <button class="btn btn-sm" id="timelineTopBtn" title="Özetteki ZAMAN satırından olayları çıkarıp Zaman Çizelgesi'ne öneri getirir">🕐 Zaman Çizelgesi</button>
      <button class="btn btn-sm" id="finishChapterBtn" title="Özet + Roman Haritası taramasını birlikte çalıştırır - bölümü AI'nın hafızasına işler">✅ Bölümü Kapat</button>
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

  document.getElementById('aiSplitBtn').addEventListener('click', async () => {
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

  document.getElementById('scanProgressionsBtn').addEventListener('click', () => runSuggestProgressions(chapter));

  const pending = pendingAiSuggestions[chapter.id];
  if (pending) {
    const total = pending.entities.length + pending.progressions.length + (pending.relationships || []).length + (pending.events || []).length;
    const banner = document.getElementById('pendingAiSuggestionsBanner');
    banner.innerHTML = `
      <div class="panel" style="margin-bottom:12px;border-color:var(--gold);">
        <strong style="font-size:12.5px;">🔔 Bu bölümü ayrıldığında AI arka planda taradı: ${total} öneri bulundu.</strong>
        <button class="btn btn-sm" id="showPendingAiBtn" style="margin-left:8px;">Göster</button>
      </div>`;
    document.getElementById('showPendingAiBtn').addEventListener('click', () => {
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
      document.getElementById('kindWarningBanner').style.display = 'none';
    });
  }
  document.getElementById('editTitleBtn').addEventListener('click', async () => {
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

  document.getElementById('editSummaryBtn').addEventListener('click', async () => {
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
  document.getElementById('highlightNamesBtn').addEventListener('click', () => toggleNameHighlight(chapter));
  readerPane.querySelectorAll('.mention-goto').forEach(el => el.addEventListener('click', () => {
    openEntityFromMention(el.dataset.type, parseInt(el.dataset.id, 10));
  }));
  document.getElementById('ttsPlayBtn').addEventListener('click', () => startChapterTts(chapter));

  document.getElementById('workshopBtn').addEventListener('click', () => openChapterWorkshop(chapter));
  document.getElementById('chapterReviewBtn').addEventListener('click', () => runChapterReview(chapter));
  document.getElementById('timelineTopBtn').addEventListener('click', () => {
    if (!(currentChapter?.summary || chapter.summary || '').trim()) {
      alert('Önce özet oluştur - zaman bilgisi özetin ZAMAN satırından okunuyor.');
      return;
    }
    runSuggestEvents(chapter, 'readerTestResult');
  });
  document.getElementById('finishChapterBtn').addEventListener('click', () => finishChapter(chapter));
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
  document.getElementById('timelineFromSummaryBtn').addEventListener('click', () => {
    runSuggestEvents(chapter, 'summaryEventScanResult');
  });
  document.getElementById('genSummaryBtn').addEventListener('click', async () => {
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
    el.addEventListener('blur', () => {
      if (el.innerText.trim() === el.dataset.original) return; // değişmedi -> istek yok
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
  document.getElementById('addParaBtn').addEventListener('click', () => {
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

async function renderAiPanel(chapter) {
  const panel = document.getElementById('aiPanel');
  panel.innerHTML = `<h3>AI Yazım Desteği</h3><div class="empty-state">Yükleniyor…</div>`;
  try {
    const lists = await Promise.all(PICKER_TYPES.map(t => api.get(ENTITY_TYPES[t].endpoint)));
    // Bölüme bağlı Plan Matrisi hücresi varsa yazara da göster - AI'ya
    // zaten otomatik gidiyor ama yazarın matris ekranına dönmeden planını
    // görebilmesi gerek. Hata olursa sessiz geç (plan kutusu olmadan devam).
    let planCells = [];
    try { planCells = await api.get(`/matrix/plan-for-chapter/${chapter.id}`); } catch (e) { /* yoksay */ }
    // Bu bölümde zaten geçen (mentions'tan) varlıkları otomatik işaretle -
    // her seferinde elle tek tek tıklamana gerek kalmasın.
    const mentionedKeys = new Set();
    (chapter.paragraphs || []).forEach(p => {
      (p.mentions || []).forEach(m => mentionedKeys.add(`${m.entity_type}:${m.entity_id}`));
    });

    // Her varlık türü KENDİ açılır bölümünde: başlıkta toplam ve seçili
    // sayısı, içinde liste + o menüye gidip düzenleme kısayolu. Tek yığın
    // halinde 30-40 kayıt paneli kullanılmaz hale getiriyordu.
    const TYPE_ICONS = { character: '👤', place: '📍', event: '📅', object: '🔹', foreshadowing: '🔮' };
    const pickerHtml = PICKER_TYPES.map((t, idx) => {
      const items = lists[idx];
      const selectedCount = items.filter(i => mentionedKeys.has(`${t}:${i.id}`)).length;
      const cfgLabel = ENTITY_TYPES[t].plural.toUpperCase();
      if (!items.length) {
        return `<div class="entity-type-group" data-type="${t}" style="border-top:1px solid var(--border);padding:6px 0;">
          <div style="display:flex;justify-content:space-between;align-items:center;font-size:11.5px;color:var(--text-muted);">
            <span>${TYPE_ICONS[t] || ''} ${cfgLabel} <span style="opacity:0.6;">(kayıt yok)</span></span>
            <button class="btn btn-sm goto-menu-btn" data-type="${t}" title="${cfgLabel} menüsüne git ve ekle">+ ekle</button>
          </div>
        </div>`;
      }
      return `<div class="entity-type-group" data-type="${t}" style="border-top:1px solid var(--border);padding:6px 0;">
        <div class="entity-type-header" data-type="${t}" style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;">
          <strong style="font-size:11.5px;letter-spacing:0.3px;">
            <span class="type-caret" data-type="${t}" style="color:var(--text-muted);">${(t === 'character' || t === 'place') ? '▾' : '▸'}</span>
            ${TYPE_ICONS[t] || ''} ${cfgLabel}
            <span style="font-weight:400;color:var(--text-muted);">(${items.length})</span>
            <span class="type-selected-count" data-type="${t}" style="font-weight:400;color:var(--gold);">${selectedCount ? '· ' + selectedCount + ' seçili' : ''}</span>
          </strong>
          <button class="btn btn-sm goto-menu-btn" data-type="${t}" title="${cfgLabel} menüsünde düzenle/ekle">✎</button>
        </div>
        <div class="entity-type-body" data-type="${t}" style="display:${(t === 'character' || t === 'place') ? '' : 'none'};margin-top:4px;max-height:200px;overflow-y:auto;">
          ${items.map(i => {
            const isMentioned = mentionedKeys.has(`${t}:${i.id}`);
            return `<label class="entity-picker-label" data-name="${escapeHtml(i.name.toLowerCase())}"><input type="checkbox" class="entity-check" data-type="${t}" data-id="${i.id}" ${isMentioned ? 'checked' : ''}> ${escapeHtml(i.name)}${isMentioned ? ' <span style="color:var(--gold);font-size:11px;" title="Bu bölümde geçiyor">●</span>' : ''}</label>`;
          }).join('')}
        </div>
      </div>`;
    }).join('');

    const planHtml = planCells.length ? `
      <div class="panel" style="border-left:3px solid var(--gold);margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;align-items:baseline;cursor:pointer;" id="chapterPlanToggle">
          <strong style="font-size:11px;letter-spacing:0.4px;">📋 BÖLÜM PLANI ${planCells.map(p => p.code ? `<span style="color:var(--text-muted);font-weight:400;">${escapeHtml(p.code)}</span>` : '').join(' ')}</strong>
          <span style="font-size:11px;color:var(--text-muted);">▾</span>
        </div>
        <div id="chapterPlanBody" style="margin-top:6px;">
          ${planCells.map(p => `
            <div style="font-size:12px;color:var(--text-muted);">${escapeHtml(p.column_label)} × ${escapeHtml(p.row_label)}</div>
            <div style="white-space:pre-wrap;font-size:12.5px;margin:4px 0 8px;">${escapeHtml(p.content)}</div>`).join('')}
          <div style="font-size:11px;color:var(--text-muted);">Bu plan, bu bölümdeki her AI isteğine otomatik gider.</div>
          <div style="display:flex;gap:6px;margin-top:8px;">
            <button class="btn btn-sm btn-primary" id="draftFromPlanBtn" style="flex:1;">📝 Plandan Bölüm Taslağı Oluştur</button>
            <button class="btn btn-sm" id="editPlanBtn" title="Planı buradan düzenle - matrise gitmeye gerek yok">✎</button>
          </div>
          <div id="planDraftResult"></div>
        </div>
      </div>` : '';

    panel.innerHTML = `
      <h3>AI Yazım Desteği</h3>
      <!-- ODA ŞERİDİ: tek satır, ikon odaklı. Birincil eylem bu. -->
      <div id="aiRoomTabs" style="display:flex;gap:3px;margin-bottom:6px;">
        ${Object.entries(AI_ROOMS).map(([key, r]) => `
          <button class="btn btn-sm ai-room-btn${key === currentAiRoom ? ' btn-primary' : ''}" data-room="${key}"
            style="flex:1;padding:4px 2px;font-size:11px;min-width:0;" title="${escapeHtml(r.label)} - ${escapeHtml(r.hint)}">
            ${r.icon}<span class="room-label" style="display:block;font-size:9.5px;overflow:hidden;text-overflow:ellipsis;">${r.short}</span>
          </button>`).join('')}
      </div>
      <div id="aiRoomHint" style="font-size:11px;color:var(--text-muted);margin-bottom:6px;line-height:1.35;"></div>
      ${planHtml}
      <div id="selectedEntityChips" style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px;"></div>

      <!-- İKİNCİL: bağlam ayarları ve listeler tek düğmenin arkasında.
           Araştırma: kullanıcıların çoğu ayarlara hiç girmez; varsayılanlar
           doğru olduğu sürece bunları göstermek sadece gürültü yapar. -->
      <button type="button" class="btn btn-sm" id="toggleContextTools" style="width:100%;margin-bottom:6px;font-size:11.5px;">
        ⚙ Bağlam ve listeler <span id="contextToolsSummary" style="color:var(--text-muted);font-weight:400;"></span>
      </button>
      <div id="contextToolsBox" style="display:none;border:1px solid var(--border);border-radius:8px;padding:8px;margin-bottom:8px;">
        <div style="display:flex;align-items:center;gap:6px;font-size:11.5px;margin-bottom:6px;flex-wrap:wrap;">
          <span style="color:var(--text-muted);">AI neyi okusun:</span>
          <select id="textScopeSelect" style="flex:1;min-width:150px;" title="Bölüm metninin AI'ya ne kadarının gideceği - maliyeti ve isabeti doğrudan etkiler">
            <option value="chapter">Bu bölümün metni</option>
            <option value="none">Metin gönderme (ucuz)</option>
            <option value="novel">Tüm kitap (pahalı)</option>
          </select>
        </div>
        <label style="display:flex;align-items:center;gap:6px;font-size:11.5px;margin-bottom:6px;cursor:pointer;" title="Seçili varlıkların 🔒 Gizli Katmanı 'BİL ama ASLA açıkça yazma' direktifiyle gider.">
          <input type="checkbox" id="includeHiddenChk"> 🔒 Gizli katmanı alt-metin olarak ver
        </label>
        <input type="text" id="entityPickerSearch" placeholder="Kişi/mekan/olay ara…" style="width:100%;margin-bottom:6px;">
        <div class="entity-picker" id="entityPickerBox">${pickerHtml || '<div class="empty-state">Henüz kayıt yok</div>'}</div>
      </div>

      <div class="ai-mode-tabs" style="display:flex;gap:6px;margin:0 0 6px;">
        <button class="btn btn-sm ai-mode-btn active" data-mode="chat">Sohbet</button>
        <button class="btn btn-sm ai-mode-btn" data-mode="instruct">Talimat</button>
      </div>

      <div id="aiResultBox" style="display:none;margin-bottom:10px;">
        <div class="panel" style="border-color:var(--gold);background:var(--gold-dim);">
          <strong style="font-size:11px;color:var(--text-muted);letter-spacing:0.4px;">SONUÇ - PARAGRAFA HAZIR METİN</strong>
          <div id="aiResultText" style="white-space:pre-wrap;margin:8px 0;font-size:13.5px;"></div>
          <div id="aiResultExtra"></div>
          <div style="display:flex;gap:6px;margin-top:6px;">
            <button class="btn btn-primary btn-sm" id="resultInsertBtn">Paragrafa Ekle</button>
            <button class="btn btn-sm" id="resultCopyBtn">Kopyala</button>
            <button class="btn btn-sm" id="resultClearBtn">Temizle</button>
          </div>
        </div>
      </div>

      <div id="aiChatMode">
        <div id="aiChatMessages" class="ai-chat-messages"></div>
        <div class="chat-input-row" style="display:flex;gap:6px;">
          <textarea id="aiChatInput" placeholder="Sorunu yaz… ( / hazır sorular · @ kişi/mekan çağır )" style="flex:1;min-height:44px;box-sizing:border-box;max-width:100%;"></textarea>
          <button class="btn btn-primary" id="aiChatSendBtn">Gönder</button>
        </div>
        <button class="btn btn-sm" id="clearChatBtn" style="margin-top:6px;">Sohbeti temizle</button>
      </div>

      <div id="aiInstructMode" style="display:none;">
        <div class="field"><label>Talimat</label><textarea id="aiInstruction" placeholder="Örn: Ahmet'in limana varışını anlatan bir paragraf yaz"></textarea></div>
        <button class="btn btn-primary" id="aiAssistBtn" style="width:100%;">Oluştur / Düzenle</button>
        <div id="aiResultContainer"></div>
      </div>

      <button class="btn btn-sm" id="previewContextBtn" style="width:100%;margin-top:10px;">Bağlamı Önizle (AI'ya ne gidiyor?)</button>
      <div id="contextPreviewContainer"></div>`;

    const draftBtn = document.getElementById('draftFromPlanBtn');
    if (draftBtn) draftBtn.addEventListener('click', () => runPlanDraft(chapter));
    const editPlanBtn = document.getElementById('editPlanBtn');
    if (editPlanBtn) {
      editPlanBtn.addEventListener('click', () => {
        if (planCells.length > 1) { alert('Bu bölüme birden fazla plan hücresi bağlı - Plan Matrisi ekranından düzenle.'); return; }
        openQuickPlanEditor(chapter, planCells[0] ? planCells[0].content : '');
      });
    }
    const planToggle = document.getElementById('chapterPlanToggle');
    if (planToggle) {
      planToggle.addEventListener('click', () => {
        const body = document.getElementById('chapterPlanBody');
        const hidden = body.style.display === 'none';
        body.style.display = hidden ? '' : 'none';
        planToggle.querySelector('span:last-child').textContent = hidden ? '▾' : '▸';
      });
    }
    // Liste varsayılan KAPALI: 30-40 karakterli seride onay kutusu yığını
    // paneli boğuyordu. Seçilenler üstte rozet olarak görünür; seçim ya
    // aramayla ya da metinde @isim yazarak yapılır.
    // Tür başlıkları: aç/kapa
    panel.querySelectorAll('.entity-type-header').forEach(h => h.addEventListener('click', (e) => {
      if (e.target.closest('.goto-menu-btn')) return;
      const t = h.dataset.type;
      const body = panel.querySelector(`.entity-type-body[data-type="${t}"]`);
      const caret = panel.querySelector(`.type-caret[data-type="${t}"]`);
      const hidden = body.style.display === 'none';
      body.style.display = hidden ? '' : 'none';
      if (caret) caret.textContent = hidden ? '▾' : '▸';
    }));
    // "✎ / + ekle": ilgili menüye geç (kayıt orada düzenlenir)
    panel.querySelectorAll('.goto-menu-btn').forEach(b => b.addEventListener('click', (e) => {
      e.stopPropagation();
      switchView(b.dataset.type);
    }));


    // Bölümde geçen varlıklar otomatik işaretli geliyor - kullanıcı en az
    // bir seçimle karşılaşırsa listeyi açmasına gerek kalmasın diye rozetler.
    renderSelectedEntityChips();
    panel.querySelectorAll('.entity-check').forEach(cb =>
      cb.addEventListener('change', () => { renderSelectedEntityChips(); updateTypeCounts(); updateContextToolsSummary(); }));
    updateTypeCounts();

    document.getElementById('entityPickerSearch').addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      panel.querySelectorAll('.entity-picker-label').forEach(label => {
        label.style.display = !q || label.dataset.name.includes(q) ? '' : 'none';
      });
      panel.querySelectorAll('.entity-picker-group').forEach(group => {
        const anyVisible = Array.from(group.querySelectorAll('.entity-picker-label')).some(l => l.style.display !== 'none');
        group.style.display = anyVisible ? '' : 'none';
      });
    });

    // Oda geçmişleri AYRI: karakter tartışırken bölüm konuşmasının artıkları
    // bağlamı kirletmesin. Oda değişince o odanın geçmişi yüklenir.
    aiChatMessages = aiRoomHistories[currentAiRoom] || [];
    renderChatMessages();
    applyAiRoom(currentAiRoom, chapter);

    panel.querySelectorAll('.ai-room-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        aiRoomHistories[currentAiRoom] = aiChatMessages;   // mevcut odayı sakla
        currentAiRoom = btn.dataset.room;
        panel.querySelectorAll('.ai-room-btn').forEach(b => b.classList.remove('btn-primary'));
        btn.classList.add('btn-primary');
        aiChatMessages = aiRoomHistories[currentAiRoom] || [];
        renderChatMessages();
        applyAiRoom(currentAiRoom, chapter);
      });
    });

    // Bağlam araçları: kapalı başlar, tek tıkla açılır (progressive disclosure)
    document.getElementById('toggleContextTools').addEventListener('click', () => {
      const box = document.getElementById('contextToolsBox');
      box.style.display = box.style.display === 'none' ? '' : 'none';
    });
    document.getElementById('textScopeSelect').addEventListener('change', updateContextToolsSummary);

    panel.querySelectorAll('.ai-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        panel.querySelectorAll('.ai-mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('aiChatMode').style.display = btn.dataset.mode === 'chat' ? 'block' : 'none';
        document.getElementById('aiInstructMode').style.display = btn.dataset.mode === 'instruct' ? 'block' : 'none';
      });
    });

    document.getElementById('aiChatSendBtn').addEventListener('click', () => sendChatMessage(chapter));
    // @isim yazımı: hem sohbet hem talimat kutusunda çalışır
    ['aiChatInput', 'aiInstruction'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', () => {
        handleMentionTyping(el);
        if (el.id === 'aiChatInput') handleStarterTyping(el);
      });
      if (el.id === 'aiChatInput') {
        el.addEventListener('focus', () => handleStarterTyping(el));
      }
      // capture=true: öneri kutusu açıkken Enter'ı ÖNCE burası yakalasın,
      // mesaj gönderilmesin (kutu kapalıysa hiçbir şeye karışmaz).
      el.addEventListener('keydown', (e) => {
        if (handleMentionKeydown(e) || handleStarterKeydown(e)) e.stopPropagation();
      }, true);
      el.addEventListener('blur', () => {
        setTimeout(() => {
          document.getElementById('mentionSuggestBox')?.remove();
          document.getElementById('starterSuggestBox')?.remove();
        }, 150);
      });
    });
    document.getElementById('aiChatInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(chapter); }
    });
    document.getElementById('clearChatBtn').addEventListener('click', () => {
      aiChatMessages = [];
      aiRoomHistories[currentAiRoom] = [];   // sadece AKTİF odayı temizle
      renderChatMessages();
    });
    document.getElementById('aiAssistBtn').addEventListener('click', () => runAiAssist(chapter));
    document.getElementById('previewContextBtn').addEventListener('click', () => runContextPreview(chapter));

    document.getElementById('resultInsertBtn').addEventListener('click', () => {
      insertChatReplyAsParagraph(document.getElementById('aiResultText').textContent);
    });
    document.getElementById('resultCopyBtn').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(document.getElementById('aiResultText').textContent);
      } catch (e) { /* pano izni yoksa sessizce geç - kritik değil */ }
    });
    document.getElementById('resultClearBtn').addEventListener('click', () => clearResult());
  } catch (err) {
    panel.innerHTML = `<h3>AI Yazım Desteği</h3><div class="error-text">${escapeHtml(err.message)}</div>`;
  }
}

// SONUÇ kutusu: sohbet (alt) ile asıl kullanılabilir metni (üst) birbirinden
// AYIRAN kalıcı panel. Sohbet doğası gereği konuşma/soru/yorum içerebilir -
// bunların hiçbiri yanlışlıkla "paragrafa ekle" ile romana karışmasın diye,
// paragrafa eklenecek metin HER ZAMAN önce bu kutuya taşınır (kullanıcı
// kendi seçer - hangi mesajın gerçek "sonuç" olduğuna dair kör bir metin
// analizi yapmıyoruz, çünkü bu dil bağımlı ve kırılgan olurdu).
function showResult(text, extraHtml) {
  const box = document.getElementById('aiResultBox');
  if (!box) return;
  box.style.display = 'block';
  document.getElementById('aiResultText').textContent = text;
  document.getElementById('aiResultExtra').innerHTML = extraHtml || '';
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function clearResult() {
  const box = document.getElementById('aiResultBox');
  if (!box) return;
  box.style.display = 'none';
  document.getElementById('aiResultText').textContent = '';
  document.getElementById('aiResultExtra').innerHTML = '';
}

let aiChatMessages = [];

function getSelectedEntities() {
  return Array.from(document.querySelectorAll('.entity-check:checked')).map(cb => ({
    entity_type: cb.dataset.type, entity_id: parseInt(cb.dataset.id, 10),
  }));
}

function renderChatMessages(scrollTo = 'last') {
  const el = document.getElementById('aiChatMessages');
  if (!el) return;
  if (!aiChatMessages.length) {
    el.innerHTML = '<div class="empty-state" style="padding:10px 0;">Bölümle ilgili ne konuşmak istersin? Fikir sorabilir, bir sahne yazmasını isteyebilir ya da yazdığın bir kısmı tartışabilirsin.</div>';
    return;
  }
  el.innerHTML = aiChatMessages.map((m, i) => `
    <div class="ai-chat-bubble ${m.role}">
      ${m.actions && m.actions.length ? `<div style="font-size:11px;color:#2f6b3a;background:#eef7ef;border-radius:6px;padding:4px 6px;margin-bottom:6px;">✓ ${m.actions.map(escapeHtml).join(' · ')}</div>` : ''}
      <div style="white-space:pre-wrap;">${escapeHtml(m.content)}</div>
      ${m.role === 'assistant' ? `<button class="btn btn-sm move-to-result-btn" data-idx="${i}" style="margin-top:6px;" title="Bu mesajın metnini yukarıdaki SONUÇ kutusuna taşı">⬆ Sonuca Taşı</button>${chatReplaceButtons(i)}` : ''}
      ${(m.pendingUpdates || []).map((p, pIdx) => renderEntityUpdateProposalCard(i, pIdx, p)).join('')}
    </div>`).join('');
  el.querySelectorAll('.move-to-result-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      showResult(aiChatMessages[parseInt(btn.dataset.idx, 10)].content);
    });
  });
  el.querySelectorAll('.chat-replace-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      chatReplaceParagraph(parseInt(btn.dataset.idx, 10), parseInt(btn.dataset.pid, 10));
    });
  });
  wireEntityUpdateProposalButtons();
  // Kaydırma: yeni yanıt gelince mesajın SONUNA değil BAŞINA git - uzun bir
  // cevapta kullanıcı en alta düşüp yukarı tırmanmak zorunda kalmasın.
  // Son mesaj kutuya sığıyorsa zaten hepsi görünür.
  const bubbles = el.querySelectorAll('.ai-chat-bubble, [data-msg-idx]');
  const last = bubbles[bubbles.length - 1];
  if (scrollTo === 'last' && last) {
    el.scrollTop = Math.max(0, last.offsetTop - el.offsetTop - 8);
  } else {
    el.scrollTop = el.scrollHeight;
  }
}

// AI'nın sohbet sırasında önerdiği ama HENÜZ KAYDEDİLMEMİŞ bir varlık
// güncellemesi (bkz. backend: propose_entity_update / pending_entity_updates).
// Çelişki yoksa tek bir "Ekle" butonu (sonuna ekler, hiçbir şeyi silmez);
// çelişki VARSA bunun yerine iki seçenek gösterilir - kullanıcı BİLEREK
// "üzerine yaz" (mode=replace) ya da "yine de sonuna ekle" (mode=append,
// ör. karakter zamanla değişmiş olabilir) seçer.
function renderEntityUpdateProposalCard(msgIdx, propIdx, p) {
  const key = `${msgIdx}-${propIdx}`;
  if (p.resolved) {
    return `<div class="entity-update-proposal resolved" style="margin-top:8px;font-size:12px;color:var(--text-muted);">✓ ${escapeHtml(p.entity_name)} - ${escapeHtml(p.section)} güncellendi (${p.resolvedMode === 'replace' ? 'üzerine yazıldı' : 'sonuna eklendi'})</div>`;
  }
  const sectionLabel = escapeHtml(p.section === 'notes' ? 'Notlar' : p.section);
  const conflictBlock = p.conflicts_with_existing ? `
    <div style="font-size:12px;color:#8a5a00;background:#fff6e0;border-radius:6px;padding:6px 8px;margin:6px 0;">
      ⚠️ Mevcut bilgiyle çelişiyor olabilir: ${escapeHtml(p.conflict_note || '')}
      ${p.existing_text ? `<div style="margin-top:4px;color:var(--text-muted);"><em>Mevcut (${sectionLabel}):</em> "${escapeHtml(truncate(p.existing_text, 120))}"</div>` : ''}
    </div>` : '';
  const buttons = p.conflicts_with_existing
    ? `<button class="btn btn-sm entity-update-approve-btn" data-key="${key}" data-mode="append">Yine de sonuna ekle</button>
       <button class="btn btn-sm btn-danger entity-update-approve-btn" data-key="${key}" data-mode="replace">Üzerine yaz</button>`
    : `<button class="btn btn-sm btn-primary entity-update-approve-btn" data-key="${key}" data-mode="append">Ekle</button>`;
  return `<div class="entity-update-proposal" data-key="${key}" style="margin-top:8px;border:1px solid var(--border);border-radius:8px;padding:8px;background:var(--paper-dim);">
    <div style="font-size:11.5px;color:var(--text-muted);letter-spacing:0.3px;">${escapeHtml(p.entity_name)} · ${sectionLabel}</div>
    <div style="font-size:13px;margin:4px 0;">${escapeHtml(p.content)}</div>
    ${conflictBlock}
    <div style="display:flex;gap:6px;">${buttons}<button class="btn btn-sm entity-update-dismiss-btn" data-key="${key}">Yok say</button></div>
  </div>`;
}

function findProposal(key) {
  const [msgIdx, propIdx] = key.split('-').map(s => parseInt(s, 10));
  const msg = aiChatMessages[msgIdx];
  return msg && msg.pendingUpdates ? { msg, prop: msg.pendingUpdates[propIdx] } : null;
}

function wireEntityUpdateProposalButtons() {
  document.querySelectorAll('.entity-update-approve-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const found = findProposal(btn.dataset.key);
      if (!found) return;
      const { prop } = found;
      btn.closest('.entity-update-proposal').style.opacity = '0.6';
      try {
        await api.post('/ai/approve-entity-update', {
          entity_type: prop.entity_type, entity_id: prop.entity_id,
          section: prop.section, content: prop.content, mode: btn.dataset.mode,
        });
        prop.resolved = true;
        prop.resolvedMode = btn.dataset.mode;
        renderChatMessages();
      } catch (err) { alert(err.message); btn.closest('.entity-update-proposal').style.opacity = '1'; }
    });
  });
  document.querySelectorAll('.entity-update-dismiss-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const found = findProposal(btn.dataset.key);
      if (!found) return;
      const { msg, prop } = found;
      msg.pendingUpdates = msg.pendingUpdates.filter(p => p !== prop);
      renderChatMessages();
    });
  });
}

function insertChatReplyAsParagraph(text) {
  if (!currentChapter) { alert('Önce sol taraftan bir bölüm seç.'); return; }
  // AI bazen (özellikle "geliştir/yeniden yaz" gibi isteklerde) asıl metni
  // yazmak yerine soru sorup oyalanabiliyor - bu durumda "Ne dersin?",
  // "İstersen..." gibi bir sohbet cevabı OLDUĞU GİBİ paragrafa gömülürse
  // roman metnine karışır. Buraya kör bir "içerik analizi" koymak yerine
  // (dil bağımlı, kırılgan) basit bir önizleme + onay adımı koyuyoruz -
  // karar hep kullanıcıda kalıyor, ama en azından GÖRMEDEN eklenmiyor.
  const preview = text.length > 220 ? text.slice(0, 220) + '…' : text;
  const confirmed = confirm(`Bu metin paragraf olarak eklenecek:\n\n"${preview}"\n\nEklemek istediğine emin misin? (Bu bir sohbet cevabıysa - soru/açıklama içeriyorsa - "İptal"e basıp sadece asıl anlatım kısmını elle kopyalayabilirsin.)`);
  if (!confirmed) return;
  const nextNumber = currentChapter.paragraphs.length ? Math.max(...currentChapter.paragraphs.map(p => p.number)) + 1 : 1;
  addEmptyParagraphBlock(nextNumber);
  const el = document.querySelector(`.paragraph-text[data-number="${nextNumber}"]`);
  if (el) el.innerText = text;
}

async function sendChatMessage(chapter) {
  const input = document.getElementById('aiChatInput');
  const text = input.value.trim();
  if (!text) return;
  const selected = getSelectedEntities();

  aiChatMessages.push({ role: 'user', content: text });
  input.value = '';
  renderChatMessages();

  const messagesEl = document.getElementById('aiChatMessages');
  const thinking = document.createElement('div');
  thinking.className = 'empty-state';
  thinking.id = 'chatThinking';
  thinking.textContent = 'Yazıyor…';
  messagesEl.appendChild(thinking);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  document.getElementById('aiChatSendBtn').disabled = true;

  try {
    const resultBox = document.getElementById('aiResultBox');
    const currentResult = (resultBox && resultBox.style.display !== 'none')
      ? document.getElementById('aiResultText').textContent
      : null;
    const payload = {
      chapter_number: chapter ? chapter.number : 0,
      selected_entities: selected,
      messages: aiChatMessages,
      current_result: currentResult,
      include_hidden: !!document.getElementById('includeHiddenChk')?.checked,
      text_scope: document.getElementById('textScopeSelect')?.value || 'chapter',
    };
    // Oda çerçevesi: AI'ya bu odanın amacını söyler (ilk mesaja iliştirilir)
    if (aiChatMessages.length === 1 && AI_ROOMS[currentAiRoom]?.frame) {
      payload.messages = [
        { role: 'user', content: AI_ROOMS[currentAiRoom].frame },
        ...payload.messages,
      ];
    }
    const result = await api.post('/ai/chat', payload);
    aiChatMessages.push({
      role: 'assistant', content: result.reply, actions: result.actions_taken || [],
      pendingUpdates: (result.pending_entity_updates || []).map(p => ({ ...p, resolved: false })),
    });
    renderChatMessages();
    // Qwen set_draft_result aracını çağırdıysa (bkz. backend), SONUÇ
    // kutusunu OTOMATİK dolduruyoruz - kullanıcının elle "Sonuca Taşı"
    // demesine gerek yok. "ev değil bina yap" gibi bir düzenleme isteğinde
    // de aynı şekilde kutu GÜNCELLENMİŞ tam metinle otomatik yenilenir.
    if (result.draft_result) {
      showResult(result.draft_result);
    }
    if (result.actions_taken && result.actions_taken.length) {
      if (currentChapter) dirtyChapterId = currentChapter.id;
      await refreshAfterChatActions();
    }
  } catch (err) {
    document.getElementById('chatThinking')?.remove();
    alert(err.message);
  } finally {
    document.getElementById('aiChatSendBtn').disabled = false;
  }
}

async function runContextPreview(chapter) {
  const selected = Array.from(document.querySelectorAll('.entity-check:checked')).map(cb => ({
    entity_type: cb.dataset.type, entity_id: parseInt(cb.dataset.id, 10),
  }));
  const container = document.getElementById('contextPreviewContainer');
  container.innerHTML = '<div class="empty-state">Bağlam oluşturuluyor…</div>';
  try {
    // Talimat kutusu doluysa önizlemeye de gönder - böylece önizleme,
    // /ai/assist'in GERÇEKTE kuracağı context'le birebir aynı olur (talimata
    // göre otomatik seçilen derin profil bölümleri dahil).
    const instructionEl = document.getElementById('aiInstruction');
    const payload = {
      chapter_number: chapter ? chapter.number : 0,
      selected_entities: selected,
      instruction: instructionEl ? instructionEl.value.trim() : '',
      include_hidden: !!document.getElementById('includeHiddenChk')?.checked,
      text_scope: document.getElementById('textScopeSelect')?.value || 'chapter',
      include_chapter_text: true,  // önizleme sohbetle AYNI bağlamı göstermeli
    };
    const result = await api.post('/ai/context-preview', payload);
    // BAĞLAM ŞEFFAFLIĞI: sadece "ne gidiyor" değil "ne kadar" ve "hangi
    // katman ne kadar yer kaplıyor". Maliyeti ve şişkinliği görünür kılar.
    const tokens = result.approx_tokens;
    const level = tokens > 60000 ? 'var(--danger)' : (tokens > 25000 ? '#b08d3f' : 'var(--text-muted)');
    const bar = (result.breakdown || []).map(b => {
      const pct = result.char_count ? Math.round(b.char_count / result.char_count * 100) : 0;
      return `<div style="display:flex;justify-content:space-between;gap:8px;font-size:11px;color:var(--text-muted);">
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(b.name)}</span>
        <span style="white-space:nowrap;">~${b.approx_tokens} tk · %${pct}</span>
      </div>`;
    }).join('');
    container.innerHTML = `
      <div style="font-size:12px;color:${level};margin-bottom:4px;font-weight:600;">
        ${result.char_count.toLocaleString('tr-TR')} karakter · ~${tokens.toLocaleString('tr-TR')} token
        ${tokens > 60000 ? '(çok büyük - kapsamı daralt)' : (tokens > 25000 ? '(büyük)' : '')}
      </div>
      ${bar ? `<div style="border:1px solid var(--border);border-radius:6px;padding:6px;margin-bottom:6px;">${bar}</div>` : ''}
      <div class="ai-result" style="white-space:pre-wrap;font-size:12px;max-height:260px;overflow:auto;">${escapeHtml(result.context) || '<em>Bu seçimle context boş olacak.</em>'}</div>`;
  } catch (err) {
    container.innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`;
  }
}

async function runAiAssist(chapter) {
  const instruction = document.getElementById('aiInstruction').value.trim();
  if (!instruction) { alert('Bir talimat yaz.'); return; }
  const selected = Array.from(document.querySelectorAll('.entity-check:checked')).map(cb => ({
    entity_type: cb.dataset.type, entity_id: parseInt(cb.dataset.id, 10),
  }));
  const resultContainer = document.getElementById('aiResultContainer');
  resultContainer.innerHTML = '<div class="empty-state">Qwen yanıtlıyor…</div>';
  try {
    const payload = {
      chapter_number: chapter ? chapter.number : 0,
      instruction,
      selected_entities: selected,
      existing_text: null,
      include_hidden: !!document.getElementById('includeHiddenChk')?.checked,
    };
    const result = await api.post('/ai/assist', payload);
    let extraHtml = '';

    if (result.consistency_notes && result.consistency_notes.length) {
      extraHtml += `<div style="margin-top:8px;"><strong style="font-size:12px;">Tutarlılık notları:</strong>
        <ul style="font-size:12.5px;margin:6px 0 0 16px;">${result.consistency_notes.map(n => `<li>${escapeHtml(n)}</li>`).join('')}</ul></div>`;
    }
    if (result.new_entity_suggestions && result.new_entity_suggestions.length) {
      extraHtml += `<div style="margin-top:8px;"><strong style="font-size:12px;">Yeni öneriler:</strong>` +
        result.new_entity_suggestions.map((s, idx) => `
          <div class="suggestion-item">
            <label><input type="checkbox" class="suggestion-check" data-idx="${idx}"> ${escapeHtml(s.entity_type)}: ${escapeHtml(s.name)}</label>
          </div>`).join('') +
        `<button class="btn btn-sm" id="approveBtn" style="margin-top:8px;">Seçilenleri onayla</button></div>`;
    }
    resultContainer.innerHTML = '';
    showResult(result.generated_text, extraHtml);
    window.__lastAiSuggestions = result.new_entity_suggestions || [];

    const approveBtn = document.getElementById('approveBtn');
    if (approveBtn) {
      approveBtn.addEventListener('click', async () => {
        const checked = Array.from(document.querySelectorAll('.suggestion-check:checked'))
          .map(cb => window.__lastAiSuggestions[parseInt(cb.dataset.idx, 10)]);
        if (!checked.length) return;
        try {
          await api.post('/ai/approve-suggestions', { suggestions: checked });
          alert('Onaylanan öneriler ilgili menülere eklendi.');
        } catch (err) { alert(err.message); }
      });
    }
  } catch (err) {
    resultContainer.innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`;
  }
}

// ---------------------------------------------------------------------
// İçe aktarma görünümü
// ---------------------------------------------------------------------

function renderImportView() {
  main().innerHTML = `
    <h1 class="view-title">Yedekle & İçe Aktar</h1>
    <div class="panel" style="border-left:3px solid var(--gold);margin-bottom:14px;">
      <strong style="font-size:12px;letter-spacing:0.4px;">💾 YEDEK AL (JSON)</strong>
      <p style="font-size:13px;color:var(--text-muted);margin:6px 0;">
        Aktif kitabın tüm bölüm/paragrafları + evrenin paylaşılan verisi (kişiler,
        mekanlar, nesneler, kurallar, olaylar, ilişkiler) tek JSON dosyası olarak iner.
        Dosya <b>şifresizdir</b> - romanın düz metin okunabilir, güvenli bir yerde sakla.
      </p>
      <button class="btn btn-primary" id="exportBackupBtn">Yedeği İndir</button>
      <span id="exportBackupState" style="font-size:12px;color:var(--text-muted);margin-left:8px;"></span>
      <hr style="border:none;border-top:1px solid var(--border);margin:12px 0;">
      <strong style="font-size:12px;letter-spacing:0.4px;">♻ YEDEKTEN GERİ YÜKLE</strong>
      <p style="font-size:12.5px;color:var(--text-muted);margin:6px 0;">
        <b>Ekle</b>: yedektekiler yeni kayıt olarak eklenir. <b>Sıfırla</b>: bu kitabın
        TÜM bölüm/paragrafları önce silinir (kişi/mekan gibi evren verisi hiçbir modda silinmez).
      </p>
      <div class="field"><input type="file" id="restoreFile" accept=".json"></div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <select id="restoreMode" style="max-width:230px;">
          <option value="merge">Ekle (güvenli)</option>
          <option value="wipe">Sıfırla ve yaz (bölümleri siler)</option>
        </select>
        <button class="btn" id="restoreBackupBtn">Geri Yükle</button>
        <span id="restoreState" style="font-size:12px;color:var(--text-muted);"></span>
      </div>
    </div>
    <h2 style="font-size:16px;margin:0 0 6px;">Metin Dosyası İçe Aktar (.txt)</h2>
    <div class="panel">
      <p style="font-size:13.5px;color:var(--text-muted);">Elinde zaten yazılmış bir .txt dosyası varsa yükle — "Bölüm N" başlıklarına göre otomatik olarak bölüm/paragraf oluşturur ve mevcut menülerdeki isimleri paragraflarda arar. İçe aktarma otomatik olarak yeni karakter/mekan oluşturmaz; her bölüm için "AI ile varlık öner" ile Qwen'e henüz kayıtlı olmayan adayları buldurup onaylayarak ekleyebilirsin.</p>
      <div class="field"><input type="file" id="importFile" accept=".txt,.json"></div>
      <label style="font-size:13px;display:flex;align-items:center;gap:6px;margin:8px 0;">
        <input type="checkbox" id="aiSplitImportCheck">
        Paragraf araları net değilse (boş satır yoksa) AI ile böl - daha yavaş ama düzensiz yapıştırılmış metinlerde çok daha iyi sonuç verir
      </label>
      <button class="btn btn-primary" id="importBtn">Yükle ve İçe Aktar</button>
      <div id="importResult"></div>
      <hr style="margin:22px 0;border:none;border-top:1px solid var(--border);">
      <p style="font-size:13.5px;color:var(--text-muted);">Yeni bir karakter/mekan ekledikten sonra, geçmiş bölümlerdeki izlerini bulmak için romanı yeniden tara:</p>
      <button class="btn" id="reindexBtn">Tüm romanı yeniden tara</button>
      <div id="reindexResult"></div>
    </div>`;

  // Yedeği indir: api.js JSON parse ettiği için burada doğrudan fetch -
  // yanıt blob olarak alınıp tarayıcıya indirtilir.
  document.getElementById('restoreBackupBtn').addEventListener('click', async () => {
    const fileInput = document.getElementById('restoreFile');
    const mode = document.getElementById('restoreMode').value;
    const state = document.getElementById('restoreState');
    if (!fileInput.files.length) { alert('Önce bir .json yedek dosyası seç.'); return; }
    if (!confirm(mode === 'wipe'
      ? 'DİKKAT: Bu kitabın TÜM bölüm ve paragrafları SİLİNİP yedekteki hâliyle değiştirilecek. Devam?'
      : 'Yedekteki içerik mevcut kayıtlara EKLENECEK. Devam?')) return;
    const btn = document.getElementById('restoreBackupBtn');
    btn.disabled = true; state.textContent = 'Geri yükleniyor…';
    try {
      const formData = new FormData();
      formData.append('file', fileInput.files[0]);
      const res = await fetch(`/admin/import?mode=${mode}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${getToken()}`, 'X-Novel-Id': String(getNovelId() || '') },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || `Geri yükleme başarısız (${res.status})`);
      alert('Yedek geri yüklendi. Sayfa yenileniyor.');
      window.location.reload();
    } catch (err) {
      state.textContent = '✕ ' + err.message;
    } finally { btn.disabled = false; }
  });

  document.getElementById('exportBackupBtn').addEventListener('click', async () => {
    const btn = document.getElementById('exportBackupBtn');
    const state = document.getElementById('exportBackupState');
    btn.disabled = true; state.textContent = 'Hazırlanıyor…';
    try {
      const res = await fetch('/admin/export', {
        headers: {
          'Authorization': `Bearer ${getToken()}`,
          'X-Novel-Id': String(getNovelId() || ''),
        },
      });
      if (!res.ok) throw new Error(`Yedek alınamadı (${res.status})`);
      const blob = await res.blob();
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `roman-yedek-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
      state.textContent = '✓ indirildi';
      setTimeout(() => { state.textContent = ''; }, 4000);
    } catch (err) {
      state.textContent = '✕ ' + err.message;
    } finally { btn.disabled = false; }
  });

  document.getElementById('importBtn').addEventListener('click', async () => {
    const fileInput = document.getElementById('importFile');
    if (!fileInput.files.length) { alert('Bir dosya seç.'); return; }
    const aiSplit = document.getElementById('aiSplitImportCheck').checked;
    const formData = new FormData();
    formData.append('file', fileInput.files[0]);
    const resultEl = document.getElementById('importResult');
    resultEl.innerHTML = aiSplit
      ? '<div class="empty-state">Yükleniyor - AI paragraf ayracı kullanılıyor, biraz sürebilir…</div>'
      : '<div class="empty-state">Yükleniyor…</div>';
    try {
      const res = await fetch(`/chapters/import?ai_split_long_chapters=${aiSplit}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${getToken()}`, 'X-Novel-Id': getNovelId() },
        body: formData,
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.detail || 'Yükleme başarısız'); }
      const data = await res.json();
      resultEl.innerHTML = `<div class="success-text">${data.imported_chapters.length} bölüm içe aktarıldı.</div>
        <div style="margin-top:10px;">
          ${data.imported_chapters.map(c => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border);">
              <span style="font-size:13px;">Bölüm ${c.chapter_number}${c.title ? ' — ' + escapeHtml(c.title) : ''} (${c.paragraph_count} paragraf)</span>
              <button class="btn btn-sm suggest-entities-btn" data-chapter-id="${c.chapter_id}">AI ile varlık öner</button>
            </div>
            <div class="suggest-entities-panel" data-chapter-id="${c.chapter_id}"></div>
          `).join('')}
        </div>`;
      resultEl.querySelectorAll('.suggest-entities-btn').forEach(btn => {
        btn.addEventListener('click', () => runSuggestEntities(btn.dataset.chapterId));
      });
    } catch (err) {
      resultEl.innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`;
    }
  });

  document.getElementById('reindexBtn').addEventListener('click', async () => {
    const resultEl = document.getElementById('reindexResult');
    resultEl.innerHTML = '<div class="empty-state">Taranıyor…</div>';
    try {
      const data = await api.post('/chapters/reindex-mentions', {});
      resultEl.innerHTML = `<div class="success-text">${data.reindexed_paragraphs} paragraf yeniden tarandı.</div>`;
    } catch (err) {
      resultEl.innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`;
    }
  });
}

async function runSuggestEntities(chapterId) {
  const panel = document.querySelector(`.suggest-entities-panel[data-chapter-id="${chapterId}"]`);
  if (!panel) return;
  panel.innerHTML = '<div class="empty-state">Bölüm taranıyor, yeni varlıklar aranıyor…</div>';
  try {
    const suggestions = await api.post(`/chapters/${chapterId}/suggest-entities`, {});
    renderEntitySuggestionsInto(panel, chapterId, suggestions);
  } catch (err) {
    panel.innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`;
  }
}

function renderEntitySuggestionsInto(panel, chapterId, suggestions) {
  if (!suggestions.length) {
    panel.innerHTML = '<div class="empty-state" style="text-align:left;padding:6px 0;">Bu bölümde menülerde kayıtlı olmayan yeni bir varlık bulunamadı.</div>';
    return;
  }
  panel.innerHTML = `
    <div class="panel" style="margin:8px 0;">
      <strong style="font-size:11px;color:var(--text-muted);letter-spacing:0.4px;">ÖNERİLEN YENİ VARLIKLAR</strong>
      ${suggestions.map((s, i) => `
        <label style="display:flex;gap:8px;align-items:flex-start;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px;">
          <input type="checkbox" class="suggestion-check" data-idx="${i}" checked style="margin-top:3px;">
          <span><strong>[${escapeHtml((ENTITY_TYPES[s.entity_type] || {}).label || s.entity_type)}] ${escapeHtml(s.name)}</strong><br>
          <span style="color:var(--text-muted);">${escapeHtml(s.description)}</span></span>
        </label>`).join('')}
      <button class="btn btn-primary btn-sm" id="approveSuggestionsBtn-${chapterId}" style="margin-top:8px;">Seçilenleri Ekle</button>
    </div>`;

  panel.querySelector(`#approveSuggestionsBtn-${chapterId}`).addEventListener('click', async () => {
    const checks = panel.querySelectorAll('.suggestion-check:checked');
    const chosen = Array.from(checks).map(cb => suggestions[parseInt(cb.dataset.idx, 10)]);
    if (!chosen.length) { alert('Hiç seçim yapılmadı.'); return; }
    try {
      const result = await api.post('/ai/approve-suggestions', { suggestions: chosen });
      panel.innerHTML = `<div class="success-text">${result.created.length} yeni kayıt eklendi.</div>`;
    } catch (err) { alert(err.message); }
  });
}

async function runSuggestProgressions(chapter) {
  const container = document.getElementById('progressionScanResult');
  if (!container) return;
  container.innerHTML = '<div class="empty-state">Bölüm taranıyor, yeni/değişen bilgi aranıyor…</div>';
  try {
    const suggestions = await api.post(`/chapters/${chapter.id}/suggest-progressions`, {});
    renderProgressionSuggestionsInto(container, suggestions);
  } catch (err) {
    container.innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`;
  }
}

function renderProgressionSuggestionsInto(container, suggestions) {
  if (!suggestions.length) {
    container.innerHTML = '<div class="empty-state" style="text-align:left;padding:6px 0;">Bu bölümde, geçen kayıtlar hakkında zaten bilinenin ötesinde yeni bir bilgi bulunamadı.</div>';
    return;
  }
  container.innerHTML = `
    <div class="panel" style="margin:8px 0;">
      <strong style="font-size:11px;color:var(--text-muted);letter-spacing:0.4px;">ÖNERİLEN GELİŞİM NOTLARI</strong>
      ${suggestions.map((s, i) => `
        <label style="display:flex;gap:8px;align-items:flex-start;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px;">
          <input type="checkbox" class="progression-suggestion-check" data-idx="${i}" checked style="margin-top:3px;">
          <span><strong>${escapeHtml(s.entity_name)}</strong> (Bölüm ${s.chapter_number}): ${escapeHtml(s.note)}</span>
        </label>`).join('')}
      <button class="btn btn-primary btn-sm" id="approveProgressionsBtn" style="margin-top:8px;">Seçilenleri Haritaya Ekle</button>
    </div>`;

  container.querySelector('#approveProgressionsBtn').addEventListener('click', async (e) => {
    const checks = container.querySelectorAll('.progression-suggestion-check:checked');
    const chosen = Array.from(checks).map(cb => suggestions[parseInt(cb.dataset.idx, 10)]);
    if (!chosen.length) { alert('Hiç seçim yapılmadı.'); return; }
    e.target.disabled = true;
    try {
      for (const s of chosen) {
        await api.post('/progressions/', {
          entity_type: s.entity_type, entity_id: s.entity_id,
          chapter_number: s.chapter_number, note: s.note,
        });
      }
      container.innerHTML = `<div class="success-text">${chosen.length} gelişim notu haritaya eklendi.</div>`;
    } catch (err) { alert(err.message); e.target.disabled = false; }
  });
}

function renderRelationshipSuggestionsInto(container, suggestions) {
  if (!suggestions.length) {
    container.innerHTML = '<div class="empty-state" style="text-align:left;padding:6px 0;">Yeni bir karakter ilişkisi bulunamadı.</div>';
    return;
  }
  container.innerHTML = `
    <div class="panel" style="margin:8px 0;">
      <strong style="font-size:11px;color:var(--text-muted);letter-spacing:0.4px;">ÖNERİLEN İLİŞKİLER</strong>
      ${suggestions.map((s, i) => `
        <label style="display:flex;gap:8px;align-items:flex-start;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px;">
          <input type="checkbox" class="relationship-suggestion-check" data-idx="${i}" checked style="margin-top:3px;">
          <span><strong>${escapeHtml(s.character_a_name)}</strong> — ${escapeHtml(s.label)} — <strong>${escapeHtml(s.character_b_name)}</strong>
          ${s.notes ? `<br><span style="color:var(--text-muted);">${escapeHtml(s.notes)}</span>` : ''}</span>
        </label>`).join('')}
      <button class="btn btn-primary btn-sm" id="approveRelationshipsBtn" style="margin-top:8px;">Seçilenleri Haritaya Ekle</button>
    </div>`;

  container.querySelector('#approveRelationshipsBtn').addEventListener('click', async (e) => {
    const checks = container.querySelectorAll('.relationship-suggestion-check:checked');
    const chosen = Array.from(checks).map(cb => suggestions[parseInt(cb.dataset.idx, 10)]);
    if (!chosen.length) { alert('Hiç seçim yapılmadı.'); return; }
    e.target.disabled = true;
    try {
      for (const s of chosen) {
        await api.post('/relationships/', {
          character_a_id: s.character_a_id, character_b_id: s.character_b_id,
          label: s.label, notes: s.notes || '',
        });
      }
      container.innerHTML = `<div class="success-text">${chosen.length} ilişki İlişki Haritası'na eklendi.</div>`;
    } catch (err) { alert(err.message); e.target.disabled = false; }
  });
}

function renderEventSuggestionsInto(container, suggestions) {
  if (!suggestions.length) {
    container.innerHTML = '<div class="empty-state" style="text-align:left;padding:6px 0;">Zaman çizelgesine eklenmeye değer yeni bir olay bulunamadı.</div>';
    return;
  }
  container.innerHTML = `
    <div class="panel" style="margin:8px 0;">
      <strong style="font-size:11px;color:var(--text-muted);letter-spacing:0.4px;">ÖNERİLEN OLAYLAR</strong>
      ${suggestions.map((s, i) => `
        <label style="display:flex;gap:8px;align-items:flex-start;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px;">
          <input type="checkbox" class="event-suggestion-check" data-idx="${i}" checked style="margin-top:3px;">
          <span><strong>${escapeHtml(s.name)}</strong> (Bölüm ${s.chapter_number}${s.place_name ? ' — ' + escapeHtml(s.place_name) : ''})
          ${s.character_names.length ? `<br><span style="color:var(--text-muted);">Kişiler: ${escapeHtml(s.character_names.join(', '))}</span>` : ''}
          ${s.description ? `<br><span style="color:var(--text-muted);">${escapeHtml(s.description)}</span>` : ''}</span>
        </label>`).join('')}
      <button class="btn btn-primary btn-sm" id="approveEventsBtn" style="margin-top:8px;">Seçilenleri Zaman Çizelgesine Ekle</button>
    </div>`;

  container.querySelector('#approveEventsBtn').addEventListener('click', async (e) => {
    const checks = container.querySelectorAll('.event-suggestion-check:checked');
    const chosen = Array.from(checks).map(cb => suggestions[parseInt(cb.dataset.idx, 10)]);
    if (!chosen.length) { alert('Hiç seçim yapılmadı.'); return; }
    e.target.disabled = true;
    try {
      for (const s of chosen) {
        await api.post('/events/', {
          name: s.name, description: s.description, place_id: s.place_id,
          story_order: s.story_order, character_ids: s.character_ids,
        });
      }
      container.innerHTML = `<div class="success-text">${chosen.length} olay Zaman Çizelgesine eklendi.</div>`;
    } catch (err) { alert(err.message); e.target.disabled = false; }
  });
}

// ---------------------------------------------------------------------
// Olaylar / Zaman Çizelgesi (özel görünüm - mekan, hikaye içi tarih,
// katılımcı karakterler ve çakışma kontrolü içerir)
// ---------------------------------------------------------------------

async function renderEventsView() {
  main().innerHTML = `
    <h1 class="view-title">Olaylar / Zaman Çizelgesi</h1>
    <div class="toolbar">
      <button class="btn" id="scanAllEventsBtn" title="Özeti olan TÜM bölümleri tarayıp zaman çizelgesine eklenecek olayları önerir">🕐 Bölümlerden Güncelle</button>
      <button class="btn" id="checkConflictsBtn">Çakışma kontrolü yap</button>
      <button class="btn btn-primary" id="addEventBtn">+ Yeni Olay</button>
    </div>
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:6px 0 10px;">
      <label style="font-size:12.5px;">Sırala:
        <select id="eventSortSelect" style="max-width:220px;">
          <option value="occurred">Gerçekleşme zamanı (kronoloji)</option>
          <option value="story">Anlatı sırası (romanda)</option>
        </select>
      </label>
      <input type="text" id="eventDateFilter" placeholder="Tarihe göre süz: 2030 / 2030-06 / 2023" style="max-width:260px;">
      <label style="font-size:12.5px;display:flex;align-items:center;gap:4px;">
        <input type="checkbox" id="eventMissingOnly"> Sadece tarihi eksik olanlar
      </label>
      <span id="eventDateStats" style="font-size:12px;color:var(--text-muted);"></span>
    </div>
    <div id="conflictsBox"></div>
    <div id="bulkEventScanResult"></div>
    <div class="entity-list" id="eventList"><div class="empty-state">Yükleniyor…</div></div>
    <div id="eventFormContainer"></div>`;

  document.getElementById('addEventBtn').addEventListener('click', () => showEventForm(null));
  document.getElementById('checkConflictsBtn').addEventListener('click', checkEventConflicts);
  document.getElementById('scanAllEventsBtn').addEventListener('click', runBulkEventScan);
  ['eventSortSelect', 'eventDateFilter', 'eventMissingOnly'].forEach(id =>
    document.getElementById(id).addEventListener('input', loadEventList));
  await loadEventList();
}

async function loadEventList() {
  const listEl = document.getElementById('eventList');
  try {
    const sort = document.getElementById('eventSortSelect')?.value || 'occurred';
    const dateFilter = (document.getElementById('eventDateFilter')?.value || '').trim();
    const missingOnly = document.getElementById('eventMissingOnly')?.checked;
    let events = await api.get(`/events/?sort=${sort}`);

    // Tarih eksiği istatistiği: kurguda zaman hatası olmaması için önce
    // KAÇ olayın tarihsiz olduğu görünür olmalı.
    const missingCount = events.filter(e => !(e.occurred_at || '').trim()).length;
    const stats = document.getElementById('eventDateStats');
    if (stats) {
      stats.innerHTML = missingCount
        ? `<span style="color:var(--danger);">${missingCount} olayın gerçekleşme zamanı yok</span> · toplam ${events.length}`
        : `Tüm olayların zamanı tanımlı · toplam ${events.length}`;
    }
    if (missingOnly) events = events.filter(e => !(e.occurred_at || '').trim());
    if (dateFilter) events = events.filter(e => (e.occurred_at || '').startsWith(dateFilter));

    if (!events.length) {
      listEl.innerHTML = `<div class="empty-state">${missingOnly || dateFilter ? 'Bu süzgece uyan olay yok.' : 'Henüz olay yok.'}</div>`;
      return;
    }
    listEl.innerHTML = events.map(ev => {
      const hasDate = (ev.occurred_at || '').trim();
      const dateChip = hasDate
        ? `<span style="font-size:11.5px;background:var(--paper-dim);border:1px solid var(--border);border-radius:4px;padding:1px 6px;" title="Gerçekleşme zamanı (sıralama bu değere göre)">🕐 ${escapeHtml(ev.occurred_at)}</span>`
        : `<span style="font-size:11.5px;color:var(--danger);border:1px solid var(--danger);border-radius:4px;padding:1px 6px;" title="Bu olay kronolojide sıralanamaz">🕐 tarih yok</span>`;
      return `
      <div class="entity-row" style="flex-wrap:wrap;">
        <div>
          <div class="name">${escapeHtml(ev.name)}${formatStoryOrder(ev.story_order)}</div>
          <div class="desc" style="margin:3px 0;">${dateChip}${ev.story_date ? ' <span style="font-size:12px;">' + escapeHtml(ev.story_date) + '</span>' : ''}</div>
          <div class="desc">${ev.place_name ? '📍 ' + escapeHtml(ev.place_name) : ''}${ev.character_names.length ? (ev.place_name ? ' · ' : '') + ev.character_names.map(escapeHtml).join(', ') : ''}</div>
          <div class="desc">${escapeHtml(truncate(ev.description, 100))}</div>
        </div>
        <div class="actions">
          ${hasDate ? '' : `<button class="btn btn-sm infer-date-btn" data-id="${ev.id}" title="Anlatıldığı bölümün özetinden gerçekleşme zamanını çıkar">🕐 AI ile tarih bul</button>`}
          <button class="btn btn-sm edit-event-btn" data-id="${ev.id}">Düzenle</button>
          <button class="btn btn-sm progression-btn" data-id="${ev.id}">Gelişim</button>
          <button class="btn btn-sm btn-danger del-event-btn" data-id="${ev.id}">Sil</button>
        </div>
        <div class="date-suggest-panel" data-id="${ev.id}" style="display:none;width:100%;margin-top:6px;"></div>
        <div class="progression-panel" data-id="${ev.id}" style="display:none;width:100%;margin-top:8px;padding-top:8px;border-top:1px dashed var(--border);"></div>
      </div>`;
    }).join('');

    listEl.querySelectorAll('.infer-date-btn').forEach(btn =>
      btn.addEventListener('click', () => runInferEventDate(parseInt(btn.dataset.id, 10))));

    listEl.querySelectorAll('.progression-btn').forEach(btn => {
      btn.addEventListener('click', () => toggleProgressionPanel('event', btn.dataset.id));
    });

    listEl.querySelectorAll('.edit-event-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const ev = events.find(e => String(e.id) === btn.dataset.id);
        showEventForm(ev);
      });
    });
    listEl.querySelectorAll('.del-event-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Bu olayı silmek istediğine emin misin?')) return;
        try { await api.del(`/events/${btn.dataset.id}`); await loadEventList(); }
        catch (err) { alert(err.message); }
      });
    });
  } catch (err) {
    listEl.innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`;
  }
}

async function showEventForm(event) {
  const container = document.getElementById('eventFormContainer');
  const isEdit = !!event;
  container.innerHTML = `<div class="panel"><div class="empty-state">Yükleniyor…</div></div>`;

  try {
    const [places, characters] = await Promise.all([api.get('/places/'), api.get('/characters/')]);
    const selectedCharIds = isEdit ? event.character_ids : [];

    container.innerHTML = `
      <div class="panel" style="max-width:640px;">
        <div class="field"><label>Olay adı</label><input type="text" id="ev_name" value="${escapeHtml(isEdit ? event.name : '')}"></div>
        <div class="field"><label>Açıklama</label><textarea id="ev_desc">${escapeHtml(isEdit ? event.description : '')}</textarea></div>
        <div class="field"><label>Notlar</label><textarea id="ev_notes">${escapeHtml(isEdit ? event.notes : '')}</textarea></div>
        <div class="field"><label>Mekan</label>
          <select id="ev_place">
            <option value="">— seçilmedi —</option>
            ${places.map(p => `<option value="${p.id}" ${isEdit && event.place_id === p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>Hikaye içi tarih (serbest metin, ör. "3. gün")</label><input type="text" id="ev_date" value="${escapeHtml(isEdit ? event.story_date : '')}"></div>
        <div class="field">
          <label>🕐 Gerçekleşme zamanı <span style="font-weight:400;color:var(--text-muted);font-size:11.5px;">(SIRALANABİLİR biçim - kronoloji buna göre kurulur. Tam: 2030-06-28T21:00 · Gün: 2030-06-28 · Ay: 2023-02 · Yıl: 2023)</span></label>
          <input type="text" id="ev_occurred" placeholder="2030-06-28T21:00" value="${isEdit ? escapeHtml(event.occurred_at || '') : ''}">
        </div>
        <div class="field">
          <label>Anlatı sırası <span style="font-weight:400;color:var(--text-muted);font-size:11.5px;">(olayın ROMANDA anlatıldığı sıra - takvim sırası değil. Otomatik: bölüm no × 1000 + o bölümdeki kaçıncı olay)</span></label>
          <input type="number" id="ev_order" value="${isEdit && event.story_order !== null ? event.story_order : ''}">
        </div>
        <div class="field"><label>Katılan karakterler</label>
          <div class="entity-picker">
            ${characters.length ? characters.map(c => `<label><input type="checkbox" class="ev-char-check" value="${c.id}" ${selectedCharIds.includes(c.id) ? 'checked' : ''}> ${escapeHtml(c.name)}</label>`).join('') : '<div class="empty-state">Henüz karakter yok</div>'}
          </div>
        </div>
        <div class="form-actions">
          <button class="btn btn-primary" id="saveEventBtn">${isEdit ? 'Güncelle' : 'Kaydet'}</button>
          <button class="btn" id="cancelEventBtn">Vazgeç</button>
        </div>
        <div id="eventFormError" class="error-text"></div>
      </div>`;

    document.getElementById('cancelEventBtn').addEventListener('click', () => { container.innerHTML = ''; });
    document.getElementById('saveEventBtn').addEventListener('click', async () => {
      const name = document.getElementById('ev_name').value.trim();
      if (!name) { document.getElementById('eventFormError').textContent = 'Olay adı boş olamaz.'; return; }
      const placeVal = document.getElementById('ev_place').value;
      const orderVal = document.getElementById('ev_order').value;
      const payload = {
        name,
        description: document.getElementById('ev_desc').value,
        notes: document.getElementById('ev_notes').value,
        place_id: placeVal ? parseInt(placeVal, 10) : null,
        story_date: document.getElementById('ev_date').value,
        story_order: orderVal !== '' ? parseInt(orderVal, 10) : null,
        occurred_at: document.getElementById('ev_occurred').value.trim(),
        character_ids: Array.from(document.querySelectorAll('.ev-char-check:checked')).map(cb => parseInt(cb.value, 10)),
      };
      try {
        if (isEdit) await api.put(`/events/${event.id}`, payload);
        else await api.post('/events/', payload);
        container.innerHTML = '';
        await loadEventList();
      } catch (err) {
        document.getElementById('eventFormError').textContent = err.message;
      }
    });
  } catch (err) {
    container.innerHTML = `<div class="panel error-text">${escapeHtml(err.message)}</div>`;
  }
}

async function checkEventConflicts() {
  const box = document.getElementById('conflictsBox');
  box.innerHTML = `<div class="empty-state">Kontrol ediliyor…</div>`;
  try {
    const conflicts = await api.get('/events/conflicts');
    if (!conflicts.length) {
      box.innerHTML = `<div class="success-text" style="margin-bottom:12px;">Çakışma bulunamadı.</div>`;
      return;
    }
    box.innerHTML = conflicts.map(c => `
      <div class="panel" style="border-color:var(--danger);margin-top:0;margin-bottom:10px;">
        <strong style="color:var(--danger);">Çakışma</strong> — "${escapeHtml(c.event_a)}" ve "${escapeHtml(c.event_b)}" olayları aynı zamanda (${escapeHtml(c.story_key)}) gerçekleşiyor ama farklı mekanlarda; ortak karakter(ler): ${c.shared_characters.map(escapeHtml).join(', ')}
      </div>`).join('');
  } catch (err) {
    box.innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`;
  }
}

// ---------------------------------------------------------------------
// İlişki Haritası
// ---------------------------------------------------------------------

async function renderRelationshipsView() {
  main().innerHTML = `
    <h1 class="view-title">İlişki Haritası</h1>
    <div class="toolbar"><div></div><button class="btn btn-primary" id="addRelBtn">+ Yeni İlişki</button></div>
    <div id="relGraph" style="margin-bottom:20px;"></div>
    <div class="entity-list" id="relList"><div class="empty-state">Yükleniyor…</div></div>
    <div id="relFormContainer"></div>`;

  document.getElementById('addRelBtn').addEventListener('click', showRelationshipForm);
  await loadRelationships();
}

async function loadRelationships() {
  const listEl = document.getElementById('relList');
  const graphEl = document.getElementById('relGraph');
  try {
    const rels = await api.get('/relationships/');
    if (!rels.length) {
      listEl.innerHTML = `<div class="empty-state">Henüz ilişki eklenmedi.</div>`;
      graphEl.innerHTML = '';
      return;
    }
    graphEl.innerHTML = buildRelationshipGraphSvg(rels);
    listEl.innerHTML = rels.map(r => `
      <div class="entity-row">
        <div>
          <div class="name">${escapeHtml(r.character_a_name)} — ${escapeHtml(r.label)} — ${escapeHtml(r.character_b_name)}</div>
          <div class="desc">${escapeHtml(truncate(r.notes, 100))}</div>
        </div>
        <div class="actions"><button class="btn btn-sm btn-danger del-rel-btn" data-id="${r.id}">Sil</button></div>
      </div>`).join('');
    listEl.querySelectorAll('.del-rel-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Bu ilişkiyi silmek istediğine emin misin?')) return;
        try { await api.del(`/relationships/${btn.dataset.id}`); await loadRelationships(); }
        catch (err) { alert(err.message); }
      });
    });
  } catch (err) {
    listEl.innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`;
  }
}

function buildRelationshipGraphSvg(rels) {
  const names = [];
  rels.forEach(r => {
    if (!names.includes(r.character_a_name)) names.push(r.character_a_name);
    if (!names.includes(r.character_b_name)) names.push(r.character_b_name);
  });
  const w = 640, h = 320, cx = w / 2, cy = h / 2, radius = Math.min(w, h) / 2 - 60;
  const positions = {};
  names.forEach((name, i) => {
    const angle = (2 * Math.PI * i) / names.length - Math.PI / 2;
    positions[name] = { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
  });

  let svg = `<svg viewBox="0 0 ${w} ${h}" style="width:100%;max-width:${w}px;background:#fff;border:1px solid var(--border);border-radius:8px;">`;
  rels.forEach(r => {
    const a = positions[r.character_a_name], b = positions[r.character_b_name];
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    svg += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#c9a227" stroke-width="1.5" />`;
    svg += `<text x="${mx}" y="${my}" font-size="10.5" fill="#746b5c" text-anchor="middle" font-family="Inter,sans-serif">${escapeHtml(r.label)}</text>`;
  });
  names.forEach(name => {
    const p = positions[name];
    svg += `<circle cx="${p.x}" cy="${p.y}" r="26" fill="#1b2230" />`;
    svg += `<text x="${p.x}" y="${p.y}" font-size="11" fill="#fff" text-anchor="middle" dominant-baseline="central" font-family="Inter,sans-serif">${escapeHtml(truncate(name, 10))}</text>`;
  });
  svg += `</svg>`;
  return svg;
}

async function showRelationshipForm() {
  const container = document.getElementById('relFormContainer');
  container.innerHTML = `<div class="panel"><div class="empty-state">Yükleniyor…</div></div>`;
  try {
    const characters = await api.get('/characters/');
    if (characters.length < 2) {
      container.innerHTML = `<div class="panel">İlişki kurabilmek için en az 2 karakter olmalı.</div>`;
      return;
    }
    container.innerHTML = `
      <div class="panel">
        <div class="field"><label>Karakter A</label>
          <select id="rel_a">${characters.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')}</select>
        </div>
        <div class="field"><label>Karakter B</label>
          <select id="rel_b">${characters.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')}</select>
        </div>
        <div class="field"><label>İlişki (ör. kız kardeşi, düşmanı)</label><input type="text" id="rel_label"></div>
        <div class="field"><label>Notlar</label><textarea id="rel_notes"></textarea></div>
        <div class="form-actions">
          <button class="btn btn-primary" id="saveRelBtn">Kaydet</button>
          <button class="btn" id="cancelRelBtn">Vazgeç</button>
        </div>
        <div id="relFormError" class="error-text"></div>
      </div>`;

    document.getElementById('cancelRelBtn').addEventListener('click', () => { container.innerHTML = ''; });
    document.getElementById('saveRelBtn').addEventListener('click', async () => {
      const label = document.getElementById('rel_label').value.trim();
      if (!label) { document.getElementById('relFormError').textContent = 'İlişki tanımı boş olamaz.'; return; }
      const payload = {
        character_a_id: parseInt(document.getElementById('rel_a').value, 10),
        character_b_id: parseInt(document.getElementById('rel_b').value, 10),
        label,
        notes: document.getElementById('rel_notes').value,
      };
      try {
        await api.post('/relationships/', payload);
        container.innerHTML = '';
        await loadRelationships();
      } catch (err) {
        document.getElementById('relFormError').textContent = err.message;
      }
    });
  } catch (err) {
    container.innerHTML = `<div class="panel error-text">${escapeHtml(err.message)}</div>`;
  }
}

// ---------------------------------------------------------------------
// Tüm Roman Tutarlılık Taraması
// ---------------------------------------------------------------------

function renderFullScanView(container) {
  (container || main()).innerHTML = `
    <p style="color:var(--text-muted);font-size:13.5px;max-width:600px;">Yazılmış tüm bölümleri tek seferde Qwen'e gönderip roman geneli tutarsızlıkları arar (karakter bilgisi çelişkileri, zaman çizelgesi hataları, kural ihlalleri). Uzun romanlarda biraz sürebilir.</p>
    <button class="btn btn-primary" id="startScanBtn">Taramayı Başlat</button>
    <div id="scanResult" style="margin-top:20px;"></div>`;

  document.getElementById('startScanBtn').addEventListener('click', async () => {
    const resultEl = document.getElementById('scanResult');
    resultEl.innerHTML = `<div class="empty-state">Qwen tüm romanı okuyor, bu biraz sürebilir…</div>`;
    try {
      const result = await api.post('/ai/full-scan', {});
      let html = '';
      if (result.summary) html += `<div class="panel">${escapeHtml(result.summary)}</div>`;
      if (!result.issues.length) {
        html += `<div class="success-text" style="margin-top:12px;">Herhangi bir tutarsızlık bulunamadı.</div>`;
      } else {
        const severityColor = { 'yüksek': 'var(--danger)', 'orta': '#a67c1e', 'düşük': 'var(--text-muted)' };
        html += result.issues.map(issue => `
          <div class="panel" style="margin-top:10px;border-left:4px solid ${severityColor[issue.severity] || 'var(--border)'};">
            <strong style="text-transform:uppercase;font-size:11px;color:${severityColor[issue.severity] || 'var(--text-muted)'};">${escapeHtml(issue.severity)}</strong>
            ${issue.chapter_number ? ` · Bölüm ${issue.chapter_number}${issue.paragraph_number ? ', Paragraf ' + issue.paragraph_number : ''}` : ''}
            <div style="margin-top:6px;font-size:13.5px;">${escapeHtml(issue.description)}</div>
          </div>`).join('');
      }
      resultEl.innerHTML = html;
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
    document.getElementById('searchResults').innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`;
    return;
  }

  function draw() {
    const filterType = document.getElementById('typeFilter').value;
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
  document.getElementById('novelSelectOverlay').style.display = 'flex';
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

  document.getElementById('activeNovelName').textContent = activeNovel.name;
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
    closeBtn.onclick = () => { document.getElementById('novelSelectOverlay').style.display = 'none'; };
    document.getElementById('novelSelectOverlay').style.display = 'flex';
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
        name: document.getElementById('sp_name').value.trim(),
        pattern: document.getElementById('sp_pattern').value.trim(),
        threshold_per_1000: parseFloat(document.getElementById('sp_threshold').value) || 0,
        min_count: parseInt(document.getElementById('sp_mincount').value, 10) || 0,
        is_refrain: document.getElementById('sp_refrain').checked,
      });
      document.getElementById('sp_name').value = '';
      document.getElementById('sp_pattern').value = '';
      await loadStylePatterns();
    } catch (err) { errEl.textContent = err.message; }
  });

  // Açılışta: önbellekteki son rapor + kalıp listesi (ikisi de ucuz GET)
  (async () => {
    try {
      const report = await api.get('/style/report');
      if (report.scanned) renderStyleReport(report);
      else document.getElementById('styleReport').innerHTML =
        `<div class="empty-state">Henüz tarama yapılmadı - "Taramayı Başlat"a bas.</div>`;
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

async function renderMatrixView() {
  main().innerHTML = `
    <h1 class="view-title">Plan Matrisi</h1>
    <p style="color:var(--text-muted);font-size:13.5px;max-width:680px;">
      Kolonlar = kişiler/turlar (üstte), satırlar = aşamalar. Her hücre o kesişimin
      madde madde planı. Bir hücre bir bölüme bağlıysa (<b>B5</b> gibi rozet), o bölüm
      yazılırken plan AI'ya <b>otomatik</b> gider - başka hiçbir bölümde gitmez.</p>
    <div id="matrixListArea"></div>
    <div id="matrixGridArea" style="margin-top:16px;"></div>
    <div id="matrixCellEditor" style="margin-top:16px;"></div>`;
  await loadMatrixList();
}

async function loadMatrixList() {
  const area = document.getElementById('matrixListArea');
  try {
    const list = await api.get('/matrix/');
    area.innerHTML = `
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        ${list.map(m => `<button class="btn btn-sm matrix-open ${currentMatrixId === m.id ? 'btn-primary' : ''}" data-id="${m.id}">${escapeHtml(m.name)} <span style="opacity:0.7;">(${m.column_count}×${m.row_count}, ${m.filled_cell_count} dolu)</span></button>`).join('')}
        <button class="btn btn-sm" id="newMatrixBtn">+ Yeni Matris</button>
      </div>`;
    area.querySelectorAll('.matrix-open').forEach(btn => btn.addEventListener('click', () => {
      currentMatrixId = parseInt(btn.dataset.id, 10);
      loadMatrixList();
      loadMatrixGrid();
    }));
    document.getElementById('newMatrixBtn').addEventListener('click', openNewMatrixDialog);
    if (currentMatrixId && list.some(m => m.id === currentMatrixId)) await loadMatrixGrid();
    else if (list.length === 1) { currentMatrixId = list[0].id; await loadMatrixList(); }
    else if (!list.length) document.getElementById('matrixGridArea').innerHTML = `<div class="empty-state">Henüz matris yok - "+ Yeni Matris" ile başla, sonra kolon ve satırları ekle.</div>`;
  } catch (err) {
    area.innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`;
  }
}

async function loadMatrixGrid() {
  const area = document.getElementById('matrixGridArea');
  document.getElementById('matrixCellEditor').innerHTML = '';
  try {
    const m = await api.get(`/matrix/${currentMatrixId}`);
    const cellMap = {};
    m.cells.forEach(c => { cellMap[`${c.column_id}:${c.row_id}`] = c; });

    const th = 'padding:6px 8px;border:1px solid var(--border);font-size:12px;background:var(--paper-dim);text-align:left;vertical-align:top;';
    const td = 'padding:6px 8px;border:1px solid var(--border);font-size:12px;cursor:pointer;min-width:120px;max-width:200px;vertical-align:top;';

    area.innerHTML = `
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;">
        <button class="btn btn-sm" id="mAddCol">+ Kolon</button>
        <button class="btn btn-sm" id="mAddRow">+ Satır</button>
        <button class="btn btn-sm" id="mBulkAdd" title="Tek seferde birden çok kolon/satır ekle">⊞ Toplu ekle</button>
        <button class="btn btn-sm btn-primary" id="mGenChapters" title="Her kolon bir Kısım, her hücre bir Bölüm olur - fihristin sonuna eklenir, hücreler otomatik bağlanır">⚡ Fihristi Oluştur</button>
        <button class="btn btn-sm" id="mAiFill" title="Üstte işaretlediğin kolonların BOŞ hücrelerini, dolu hücrelerdeki kalıbı izleyerek AI taslaklar - hiçbiri onaysız kaydedilmez">🤖 Seçili Kolonların Eksiklerini AI Doldursun</button>
        <button class="btn btn-sm" id="mImport" title="Satır satır 'Aşama adı: içerik' formatında yapıştırılan metni, seçtiğin kolonun hücrelerine dağıtır">📥 Metinden Doldur</button>
        <button class="btn btn-sm" id="mDelMatrix" style="margin-left:auto;">Matrisi Sil</button>
      </div>
      <div style="overflow-x:auto;">
        <table style="border-collapse:collapse;width:max-content;">
          <tr>
            <th style="${th}"></th>
            ${m.columns.map(c => `<th style="${th}">
              <input type="checkbox" class="m-col-check" data-id="${c.id}" title="AI doldurma için bu kolonu seç" style="margin-right:4px;">
              <span class="m-col-edit" data-id="${c.id}" style="cursor:pointer;" title="Adı değiştir">${escapeHtml(c.label)}</span>
              <button class="btn-icon-sm m-col-ins" data-id="${c.id}" title="Bu kolonun SAĞINA yeni kolon ekle">⊕</button>
              <button class="btn-icon-sm m-col-del" data-id="${c.id}" title="Kolonu sil (hücreleriyle)">✕</button>
            </th>`).join('')}
          </tr>
          ${m.rows.map(r => `<tr>
            <th style="${th}${r.kind === 'sub' ? 'font-style:italic;font-weight:400;padding-left:22px;' : ''}">
              <span class="m-row-edit" data-id="${r.id}" style="cursor:pointer;" title="Adı, türü ve TALİMAT KASASI'nı düzenle">${r.kind === 'sub' ? '↳ ' : ''}${escapeHtml(r.label)}</span>${(r.instructions || '').trim() ? ` <span style="font-size:10px;color:var(--gold);" title="Bu aşamanın yazım kısıtları kayıtlı - bölümlere otomatik gider">📌</span>` : ''}
              <button class="btn-icon-sm m-row-ins" data-id="${r.id}" title="Bu satırın ALTINA yeni satır ekle">⊕</button>
              <button class="btn-icon-sm m-row-del" data-id="${r.id}" title="Satırı sil (hücreleriyle)">✕</button>
            </th>
            ${m.columns.map(c => {
              const cell = cellMap[`${c.id}:${r.id}`];
              const filled = cell && (cell.content || '').trim();
              const preview = filled ? escapeHtml(cell.content.trim().slice(0, 60)) + (cell.content.length > 60 ? '…' : '') : '<span style="opacity:0.35;">—</span>';
              const chBadge = cell && cell.chapter_number ? `<span style="font-size:10px;background:var(--paper-dim);border:1px solid var(--border);border-radius:3px;padding:0 4px;" title="Bölüm ${cell.chapter_number}'e bağlı - plan o bölümde AI'ya gider">B${cell.chapter_number}</span>` : '';
              const codeBadge = cell && cell.code ? `<span style="font-size:10px;color:var(--text-muted);" title="Sabit referans kodu - başka bir bölümün talimatında '${cell.code}' yazarsan bu plan kıyas için AI'ya gider">${cell.code}</span>` : '';
              const badge = codeBadge + (codeBadge && chBadge ? ' ' : '') + chBadge;
              return `<td style="${td}${filled ? '' : 'background:transparent;'}" class="m-cell" data-col="${c.id}" data-row="${r.id}">
                <div style="display:flex;justify-content:space-between;gap:4px;">${badge}<span style="opacity:0.5;font-size:10px;">${filled ? '●' : ''}</span></div>
                <div style="white-space:pre-wrap;">${preview}</div>
              </td>`;
            }).join('')}
          </tr>`).join('')}
        </table>
      </div>`;

    document.getElementById('mAddCol').addEventListener('click', () => addMatrixColumn(m, null));
    area.querySelectorAll('.m-col-ins').forEach(btn => btn.addEventListener('click', (e) => {
      e.stopPropagation();
      addMatrixColumn(m, parseInt(btn.dataset.id, 10));
    }));
    document.getElementById('mAddRow').addEventListener('click', () => addMatrixRow(m, null));
    document.getElementById('mGenChapters').addEventListener('click', async () => {
      if (!confirm(`${m.columns.length} Kısım + ${m.columns.length * m.rows.length} Bölüm fihristin SONUNA eklenecek ve hücreler bağlanacak. Devam?`)) return;
      try {
        const r = await api.post(`/matrix/${m.id}/generate-chapters`, {});
        alert(`Oluşturuldu: ${r.created_parts} kısım, ${r.created_chapters} bölüm. ${r.linked_cells} hücre bağlandı.`);
        await loadMatrixGrid();
      } catch (err) { alert(err.message); }
    });
    document.getElementById('mAiFill').addEventListener('click', async () => {
      const selected = Array.from(area.querySelectorAll('.m-col-check:checked')).map(cb => parseInt(cb.dataset.id, 10));
      if (!selected.length) { alert('Önce kolon başlıklarındaki kutulardan en az bir tur seç.'); return; }
      if (!confirm(`${selected.length} kolonun boş hücreleri için AI taslak üretecek (kolon başına 1 AI isteği). Hiçbiri onaysız kaydedilmez. Devam?`)) return;
      const editor = document.getElementById('matrixCellEditor');
      editor.innerHTML = '<div class="empty-state">AI, dolu hücrelerdeki kalıbı izleyerek taslak üretiyor…</div>';
      try {
        const result = await api.post(`/matrix/${m.id}/ai-fill`, { column_ids: selected });
        renderAiFillReview(m, result);
      } catch (err) { editor.innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`; }
    });
    document.getElementById('mBulkAdd').addEventListener('click', () => openBulkAddDialog(m));
    document.getElementById('mImport').addEventListener('click', () => openMatrixImporter(m));
    document.getElementById('mDelMatrix').addEventListener('click', async () => {
      if (!confirm('Matris ve TÜM hücre planları silinecek (bölümlere dokunulmaz). Emin misin?')) return;
      try { await api.del(`/matrix/${m.id}`); currentMatrixId = null; await loadMatrixList(); document.getElementById('matrixGridArea').innerHTML = ''; }
      catch (err) { alert(err.message); }
    });
    area.querySelectorAll('.m-col-edit').forEach(el => el.addEventListener('click', () => {
      openMatrixColumnEditor(m, parseInt(el.dataset.id, 10));
    }));
    area.querySelectorAll('.m-row-ins').forEach(btn => btn.addEventListener('click', (e) => {
      e.stopPropagation();
      addMatrixRow(m, parseInt(btn.dataset.id, 10));
    }));
    area.querySelectorAll('.m-row-edit').forEach(el => el.addEventListener('click', () => {
      openMatrixRowEditor(m, parseInt(el.dataset.id, 10));
    }));
    area.querySelectorAll('.m-col-del').forEach(btn => btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Kolon ve hücreleri silinecek. Emin misin?')) return;
      try { await api.del(`/matrix/${m.id}/columns/${btn.dataset.id}`); await loadMatrixGrid(); } catch (err) { alert(err.message); }
    }));
    area.querySelectorAll('.m-row-del').forEach(btn => btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Satır ve hücreleri silinecek. Emin misin?')) return;
      try { await api.del(`/matrix/${m.id}/rows/${btn.dataset.id}`); await loadMatrixGrid(); } catch (err) { alert(err.message); }
    }));
    area.querySelectorAll('.m-cell').forEach(el => el.addEventListener('click', () => {
      openMatrixCellEditor(m, parseInt(el.dataset.col, 10), parseInt(el.dataset.row, 10), cellMap);
    }));
  } catch (err) {
    area.innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`;
  }
}

async function addMatrixColumn(m, afterColumnId) {
  // afterColumnId null -> en sağa; doluysa o kolonun hemen SAĞINA girer.
  const label = prompt(afterColumnId ? 'Araya eklenecek kolonun adı:' : 'Kolon adı (ör. "TUR 3: MÜHENDİS"):');
  if (!label || !label.trim()) return;
  try {
    await api.post(`/matrix/${m.id}/columns`, { label: label.trim(), after_column_id: afterColumnId });
    await loadMatrixGrid();
  } catch (err) { alert(err.message); }
}

async function addMatrixRow(m, afterRowId) {
  // afterRowId null -> sona ekler; doluysa o satırın hemen ALTINA girer.
  const label = prompt(afterRowId ? 'Araya eklenecek satırın adı:' : 'Satır adı (ör. "5. Sorgu (20 dk)"):');
  if (!label || !label.trim()) return;
  const isSub = confirm('ARA başlık olarak mı eklensin? (girintili/italik görünür)\n\nTamam = Ara başlık, İptal = Ana başlık');
  try {
    await api.post(`/matrix/${m.id}/rows`, {
      label: label.trim(), kind: isSub ? 'sub' : 'main', after_row_id: afterRowId,
    });
    await loadMatrixGrid();
  } catch (err) { alert(err.message); }
}

async function openMatrixCellEditor(m, colId, rowId, cellMap) {
  const editor = document.getElementById('matrixCellEditor');
  const col = m.columns.find(c => c.id === colId);
  const row = m.rows.find(r => r.id === rowId);
  const cell = cellMap[`${colId}:${rowId}`] || null;
  let chapters = [];
  // Tür filtresi YOK: kullanıcının metni Kısım/Alt Başlık girdilerinde de
  // durabiliyor; filtre yüzünden liste boş görünüyordu ("bağlı değil"den
  // başka seçenek çıkmıyordu). Hiyerarşik numarayla listelenir.
  try {
    const tumu = await api.get('/chapters/');
    const hiyerarsi = buildChapterHierarchy(tumu);
    chapters = hiyerarsi.map(it => ({
      id: it.chapter.id,
      number: it.chapter.number,
      kind: it.chapter.kind,
      displayNumber: it.displayNumber,
      title: it.chapter.title,
      paragraphCount: it.chapter.paragraph_count || 0,
    }));
  } catch (e) { /* seçici olmadan devam */ }

  editor.innerHTML = `
    <div class="panel">
      <b>${escapeHtml(col.label)} × ${escapeHtml(row.label)}</b>
      ${cell && cell.code ? `<span style="margin-left:8px;font-size:12px;color:var(--text-muted);">Kod: <b>${cell.code}</b> - başka bir bölümün talimatında bu kodu yazarsan plan kıyas için AI'ya gider</span>` : ''}
      <div class="field" style="margin-top:8px;">
        <label>Plan (madde madde - bu bölümde ne OLACAK)</label>
        <textarea id="mCellContent" style="min-height:140px;">${escapeHtml(cell ? cell.content : '')}</textarea>
      </div>
      <div class="field">
        <label>Bağlı bölüm <span style="font-weight:400;color:var(--text-muted);">(plan SADECE bu bölüm yazılırken AI'ya gider)</span></label>
        <select id="mCellChapter">
          <option value="">(bağlı değil)</option>
          ${chapters.map(c => {
            const tur = c.kind === 'part' ? 'ÜST' : (c.kind === 'subtitle' ? 'ARA' : 'metin');
            const par = c.paragraphCount ? `, ${c.paragraphCount} par.` : '';
            return `<option value="${c.id}" ${cell && cell.chapter_id === c.id ? 'selected' : ''}>#${c.displayNumber} [${tur}${par}] ${escapeHtml(stripMarkdownArtifacts(c.title) || '(başlıksız)')}</option>`;
          }).join('')}
        </select>
      </div>
      <div class="form-actions">
        <button class="btn btn-primary" id="mCellSave">Kaydet</button>
        <button class="btn" id="mCellCancel">Kapat</button>
      </div>
      <div id="mCellError" class="error-text"></div>
    </div>`;
  editor.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  document.getElementById('mCellCancel').addEventListener('click', () => { editor.innerHTML = ''; });
  document.getElementById('mCellSave').addEventListener('click', async () => {
    const chapterVal = document.getElementById('mCellChapter').value;
    try {
      await api.put(`/matrix/${m.id}/cells`, {
        column_id: colId, row_id: rowId,
        content: document.getElementById('mCellContent').value,
        chapter_id: chapterVal ? parseInt(chapterVal, 10) : null,
      });
      editor.innerHTML = '';
      await loadMatrixGrid();
    } catch (err) { document.getElementById('mCellError').textContent = err.message; }
  });
}

// AI doldurma önerilerinin gözden geçirme paneli: her öneri düzenlenebilir,
// tek tek ya da toplu kaydedilir. Kaydetme normal hücre PUT'undan geçer -
// mevcut bölüm bağı korunur, yeni hücre MP kodunu orada alır.
function renderAiFillReview(m, result) {
  const editor = document.getElementById('matrixCellEditor');
  if (!result.proposals.length) {
    editor.innerHTML = `<div class="empty-state">Öneri üretilemedi${result.skipped_columns.length ? ' - seçili kolonlarda boş hücre yoktu: ' + result.skipped_columns.map(escapeHtml).join(', ') : ''}.</div>`;
    return;
  }
  editor.innerHTML = `
    <div class="panel">
      <b>AI Taslakları (${result.proposals.length})</b>
      <span style="font-size:12px;color:var(--text-muted);"> - düzenleyip onayla; onaylanmayan hiçbir şey kaydedilmez</span>
      ${result.skipped_columns.length ? `<div style="font-size:12px;color:var(--text-muted);margin-top:4px;">Atlanan (zaten dolu): ${result.skipped_columns.map(escapeHtml).join(', ')}</div>` : ''}
      <div id="aiFillItems">
        ${result.proposals.map((p, i) => `
          <div class="panel" style="margin-top:10px;" data-idx="${i}">
            <b style="font-size:13px;">${escapeHtml(p.column_label)} × ${escapeHtml(p.row_label)}</b>
            <textarea class="ai-fill-content" style="min-height:110px;margin-top:6px;">${escapeHtml(p.content)}</textarea>
            <div class="form-actions">
              <button class="btn btn-sm btn-primary ai-fill-save" data-idx="${i}">Onayla ve Kaydet</button>
              <button class="btn btn-sm ai-fill-skip" data-idx="${i}">Atla</button>
            </div>
          </div>`).join('')}
      </div>
      <div class="form-actions" style="margin-top:12px;">
        <button class="btn btn-primary" id="aiFillSaveAll">Kalanların Tümünü Onayla ve Kaydet</button>
        <button class="btn" id="aiFillClose">Kapat</button>
      </div>
      <div id="aiFillError" class="error-text"></div>
    </div>`;

  async function saveOne(idx) {
    const p = result.proposals[idx];
    const item = editor.querySelector(`[data-idx="${idx}"]`);
    if (!item) return;
    const content = item.querySelector('.ai-fill-content').value;
    // Mevcut hücreyi (bölüm bağı!) koruyarak kaydet
    const full = await api.get(`/matrix/${m.id}`);
    const existing = full.cells.find(c => c.column_id === p.column_id && c.row_id === p.row_id);
    await api.put(`/matrix/${m.id}/cells`, {
      column_id: p.column_id, row_id: p.row_id, content,
      chapter_id: existing ? existing.chapter_id : null,
    });
    item.remove();
  }

  editor.querySelectorAll('.ai-fill-save').forEach(btn => btn.addEventListener('click', async () => {
    try { await saveOne(parseInt(btn.dataset.idx, 10)); await loadMatrixGrid(); }
    catch (err) { document.getElementById('aiFillError').textContent = err.message; }
  }));
  editor.querySelectorAll('.ai-fill-skip').forEach(btn => btn.addEventListener('click', () => {
    editor.querySelector(`[data-idx="${btn.dataset.idx}"]`)?.remove();
  }));
  document.getElementById('aiFillSaveAll').addEventListener('click', async () => {
    try {
      const remaining = Array.from(editor.querySelectorAll('#aiFillItems [data-idx]')).map(el => parseInt(el.dataset.idx, 10));
      for (const idx of remaining) await saveOne(idx);
      editor.innerHTML = '';
      await loadMatrixGrid();
    } catch (err) { document.getElementById('aiFillError').textContent = err.message; }
  });
  document.getElementById('aiFillClose').addEventListener('click', () => { editor.innerHTML = ''; });
}

// ---------------------------------------------------------------------------
// PLANDAN TAM TASLAK: "özet(plan) yaz -> sistem bölümün tamamını yazsın ->
// paragraf paragraf düzelt" akışının eksik halkası. /ai/assist'e hazır bir
// talimatla gider - plan zaten build_plan_layer ile otomatik context'te.
// Üretilen taslak ONAYSIZ kaydedilmez: önce gösterilir, "Böl ve Ekle"
// dersen boş satırlardan paragraflara bölünüp bölüme eklenir - sonrasında
// her paragraf normal araçlarla (Kaydet/Geçmiş/AI) tek tek işlenir.
// ---------------------------------------------------------------------------
async function runPlanDraft(chapter) {
  const box = document.getElementById('planDraftResult');
  const hasParagraphs = (chapter.paragraphs || []).length > 0;
  if (hasParagraphs && !confirm('Bu bölümde zaten paragraf var - taslak, mevcut metnin SONUNA eklenecek. Devam?')) return;
  const selected = Array.from(document.querySelectorAll('.entity-check:checked')).map(cb => ({
    entity_type: cb.dataset.type, entity_id: parseInt(cb.dataset.id, 10),
  }));
  box.innerHTML = '<div class="empty-state">Plan işleniyor, taslak yazılıyor…</div>';
  try {
    const result = await api.post('/ai/assist', {
      chapter_number: chapter.number,
      instruction: 'BÖLÜM PLANI\'ndaki maddelerin TAMAMINI sırasıyla işleyerek bu bölümün tam taslağını yaz. '
        + 'Metni boş satırlarla paragraflara ayır. Plandaki hiçbir maddeyi atlama; planda olmayan büyük olay ya da karakter ekleme. '
        + 'Emin olmadığın özel detayı köşeli parantezle işaretle.',
      selected_entities: selected,
      existing_text: null,
    });
    const paras = (result.generated_text || '').split(/\n\s*\n/).map(t => t.trim()).filter(Boolean);
    if (!paras.length) { box.innerHTML = '<div class="error-text">Taslak boş döndü.</div>'; return; }
    box.innerHTML = `
      <div class="panel" style="margin-top:8px;border-color:var(--gold);">
        <strong style="font-size:11px;color:var(--text-muted);">TASLAK (${paras.length} paragraf) - onaylamadan kaydedilmez</strong>
        <div style="white-space:pre-wrap;font-size:12.5px;max-height:260px;overflow-y:auto;margin:6px 0;">${escapeHtml(result.generated_text)}</div>
        ${result.consistency_notes && result.consistency_notes.length
          ? `<div style="font-size:12px;color:var(--danger);">⚠ ${result.consistency_notes.map(escapeHtml).join(' · ')}</div>` : ''}
        <div class="form-actions">
          <button class="btn btn-primary btn-sm" id="planDraftAcceptBtn">Paragraflara Böl ve Ekle</button>
          <button class="btn btn-sm" id="planDraftDiscardBtn">Vazgeç</button>
        </div>
      </div>`;
    document.getElementById('planDraftDiscardBtn').addEventListener('click', () => { box.innerHTML = ''; });
    document.getElementById('planDraftAcceptBtn').addEventListener('click', async () => {
      const btn = document.getElementById('planDraftAcceptBtn');
      btn.disabled = true; btn.textContent = 'Ekleniyor…';
      try {
        let nextNumber = Math.max(0, ...(chapter.paragraphs || []).map(p => p.number)) + 1;
        for (const text of paras) {
          await api.put(`/chapters/${chapter.id}/paragraphs/${nextNumber}`, { number: nextNumber, text });
          nextNumber++;
        }
        await selectChapter(chapter.id); // bölümü tazele - paragraf araçları hazır
      } catch (err) { alert('Ekleme sırasında hata: ' + err.message); btn.disabled = false; btn.textContent = 'Paragraflara Böl ve Ekle'; }
    });
  } catch (err) {
    box.innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`;
  }
}

// ---------------------------------------------------------------------------
// BAĞLAM SAĞLIK ŞERİDİ: "kör yazma" riskini görünür kılar - bu bölüm için
// AI'nın elinde ne var, ne eksik? Özet yoksa bölüm fihristte görünmez;
// plan yoksa AI plansız yazar. Sadece bilgilendirir, hiçbir şeyi zorlamaz.
// ---------------------------------------------------------------------------
async function renderChapterHealthStrip(chapter) {
  const strip = document.getElementById('chapterHealthStrip');
  if (!strip) return;
  let planCells = [];
  try { planCells = await api.get(`/matrix/plan-for-chapter/${chapter.id}`); } catch (e) { /* yoksay */ }
  const chip = (ok, labelOk, labelBad, tip, id) =>
    `<span ${id ? `id="${id}"` : ''} title="${tip}" style="display:inline-block;font-size:11px;padding:2px 8px;border-radius:999px;margin-right:6px;border:1px solid ${ok ? 'var(--border)' : 'var(--danger)'};color:${ok ? 'var(--text-muted)' : 'var(--danger)'};${!ok && id ? 'cursor:pointer;' : ''}">${ok ? '✓ ' + labelOk : '✗ ' + labelBad}</span>`;
  const paraCount = (chapter.paragraphs || []).length;
  strip.innerHTML =
    chip(!!(chapter.summary || '').trim(), 'Özet', 'Özet yok', 'Özeti olmayan bölüm fihristte ve diğer bölümlerin AI bağlamında GÖRÜNMEZ. Bölümü yazınca "AI ile özet oluştur"a bas.') +
    chip(planCells.length > 0, 'Plan', 'Plan yok - tıkla, hemen yaz',
      planCells.length ? 'Bu bölüme bağlı plan var - AI ona sadık yazar'
        : 'Bu bölüme bağlı plan hücresi yok: AI plansız yazar. TIKLA - matrise girmeden buradan plan yazabilirsin.', 'healthPlanChip') +
    chip(paraCount > 0, `${paraCount} paragraf`, 'Metin yok', 'Bölümde henüz paragraf yok - planı yazıp "Plandan Bölüm Taslağı Oluştur" kullanabilirsin');
  const planChip = document.getElementById('healthPlanChip');
  if (planChip && !planCells.length) {
    planChip.addEventListener('click', () => openQuickPlanEditor(chapter, ''));
  }
}

// ---------------------------------------------------------------------------
// HIZLI PLAN: matrise hiç girmeden, bölümün içinden plan yazma. Arka planda
// "Hızlı Planlar" matrisine tek hücre olarak kaydedilir - MP kodu, plan
// kutusu, "Plandan Taslak", context enjeksiyonu aynen çalışır; bölüm zaten
// bir matristen bağlıysa O hücre güncellenir (kopya açılmaz).
// ---------------------------------------------------------------------------
function openQuickPlanEditor(chapter, currentText) {
  let box = document.getElementById('quickPlanEditorBox');
  if (!box) {
    box = document.createElement('div');
    box.id = 'quickPlanEditorBox';
    document.getElementById('chapterHealthStrip').after(box);
  }
  box.innerHTML = `
    <div class="panel" style="margin-top:8px;border-left:3px solid var(--gold);">
      <strong style="font-size:11px;letter-spacing:0.4px;">📋 BÖLÜM PLANI${currentText ? ' - DÜZENLE' : ' - YENİ'}</strong>
      <div class="field" style="margin-top:6px;">
        <label>Bu bölümde ne OLACAK? (madde madde - AI buna sadık yazar)</label>
        <textarea id="quickPlanText" style="min-height:120px;" placeholder="Buraya KENDİ planını yaz. Örnek biçim:&#10;- Vicdan salonu tanıtır, kuralları okur&#10;- İlk hologram: yaşlı çift&#10;- Anahtar kelime: ÇÖZÜN">${escapeHtml(currentText)}</textarea>
        <div style="font-size:11.5px;color:var(--text-muted);margin-top:4px;">Gri yazı sadece örnektir - kaydedilmez. Kendi maddelerini yazman gerekir.</div>
      </div>
      <div class="form-actions">
        <button class="btn btn-primary btn-sm" id="quickPlanSave">Kaydet</button>
        <button class="btn btn-sm" id="quickPlanCancel">Vazgeç</button>
      </div>
      <div id="quickPlanError" class="error-text"></div>
    </div>`;
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  document.getElementById('quickPlanCancel').addEventListener('click', () => { box.innerHTML = ''; });
  document.getElementById('quickPlanSave').addEventListener('click', async () => {
    const content = document.getElementById('quickPlanText').value.trim();
    if (!content) {
      document.getElementById('quickPlanError').textContent =
        'Kutu boş - gri yazı sadece örnek biçimdir, kaydedilmez. Bu bölümde ne olacağını madde madde yaz.';
      return;
    }
    try {
      await api.post('/matrix/quick-plan', { chapter_id: chapter.id, content });
      box.innerHTML = '';
      // Plan kutusu + taslak düğmesi + şerit tazelensin
      renderChapterHealthStrip(chapter);
      renderAiPanel(chapter);
    } catch (err) { document.getElementById('quickPlanError').textContent = err.message; }
  });
}

// ---------------------------------------------------------------------------
// OKUR TESTİ: metni okur gözüyle tarayıp okuru düşürecek noktaları listeler.
// ---------------------------------------------------------------------------
const READER_TEST_TYPE_LABELS = {
  diyalog_ses: 'Diyalog: sesler ayrışmıyor',
  diyalog_bilgi: 'Diyalog: bilgi aktarımı',
  diyalog_altmetin: 'Diyalog: alt metin yok',
  tempo: 'Tempo', bilgi_bocasi: 'Bilgi bocası', klise: 'Klişe',
  anlasilirlik: 'Anlaşılırlık', gerilim: 'Gerilim kırılması', inandiricilik: 'İnandırıcılık', diger: 'Diğer',
};

async function runReaderTest(chapter) {
  const box = document.getElementById('readerTestResult');
  if (!(chapter.paragraphs || []).length) { box.innerHTML = '<div class="empty-state">Önce metin gerek.</div>'; return; }
  box.innerHTML = '<div class="empty-state">Metin okur gözüyle taranıyor…</div>';
  try {
    const result = await api.post(`/ai/reader-test/${chapter.id}`, {});
    if (!result.findings.length) {
      box.innerHTML = '<div class="panel" style="margin-top:8px;border-color:var(--border);"><span style="font-size:13px;">✓ Okuru düşürecek belirgin bir nokta bulunamadı.</span></div>';
      return;
    }
    // Bulgular PARAGRAF SIRASINA göre gösterilir - AI'nın döndürdüğü
    // rastgele sırayla metinde ileri geri zıplamak gerekiyordu. Numarası
    // olmayanlar (model konumlayamadı) sona düşer.
    result.findings.sort((a, b) => {
      const x = a.paragraph_number, y = b.paragraph_number;
      if (x === null && y === null) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      return x - y;
    });
    const sevColor = { yuksek: 'var(--danger)', orta: '#b08d3f', dusuk: 'var(--text-muted)' };
    box.innerHTML = `
      <div class="panel" style="margin-top:8px;">
        <strong style="font-size:11px;color:var(--text-muted);letter-spacing:0.4px;">OKUR TESTİ - ${result.findings.length} UYARI (metne dokunulmadı)</strong>
        ${result.findings.map(f => `
          <div style="border-left:3px solid ${sevColor[f.severity] || 'var(--border)'};padding-left:10px;margin-top:10px;">
            <div style="font-size:12px;">
              <b>${READER_TEST_TYPE_LABELS[f.type] || f.type}</b>
              ${f.paragraph_number ? `· <a href="#" class="rt-goto" data-num="${f.paragraph_number}" style="color:inherit;">Paragraf ${f.paragraph_number}</a>` : ''}
              · <span style="color:${sevColor[f.severity]};">${f.severity}</span>
            </div>
            ${f.quote ? `<div style="font-size:12px;font-style:italic;color:var(--text-muted);margin-top:2px;">"${escapeHtml(f.quote)}"</div>` : ''}
            <div style="font-size:12.5px;margin-top:3px;">${escapeHtml(f.reason)}</div>
            ${f.suggestion ? `<div style="font-size:12px;color:var(--text-muted);margin-top:2px;">→ ${escapeHtml(f.suggestion)}</div>` : ''}
            ${f.paragraph_number ? `<button class="btn btn-sm rt-fix" data-num="${f.paragraph_number}" data-issue="${escapeHtml((f.reason || '') + ' ' + (f.suggestion || ''))}" style="margin-top:5px;font-size:11.5px;">✨ Bu uyarıya göre düzelt</button>` : ''}
            <div class="rt-fix-result" data-num="${f.paragraph_number || 0}"></div>
          </div>`).join('')}
      </div>`;
    box.querySelectorAll('.rt-fix').forEach(btn => btn.addEventListener('click', () =>
      runInlineFix(chapter, parseInt(btn.dataset.num, 10), btn.dataset.issue, btn)));
    box.querySelectorAll('.rt-goto').forEach(a => a.addEventListener('click', (e) => {
      e.preventDefault();
      const target = document.querySelector(`.paragraph-text[data-number="${a.dataset.num}"]`);
      if (target) { target.scrollIntoView({ behavior: 'smooth', block: 'center' }); target.focus(); }
    }));
  } catch (err) {
    box.innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`;
  }
}

// ---------------------------------------------------------------------------
// BÖLÜMÜ KAPAT: özet + harita taramasını arka arkaya çalıştırır - bölümü
// AI'nın hafızasına tek dokunuşla işler. Harita önerileri her zamanki onay
// akışına düşer (otomatik yazılmaz).
// ---------------------------------------------------------------------------
async function finishChapter(chapter) {
  const btn = document.getElementById('finishChapterBtn');
  btn.disabled = true; btn.textContent = '1/2 Özet…';
  try {
    const result = await api.post(`/chapters/${chapter.id}/generate-summary`, {});
    const accept = confirm(`Taslak özet:\n\n${result.generated_summary}\n\nKaydedilsin mi? (İptal: özetsiz devam - bölüm fihristte görünmez)`);
    if (accept) {
      await api.put(`/chapters/${chapter.id}`, { summary: result.generated_summary });
      const sumEl = document.getElementById('chapterSummaryText');
      if (sumEl) sumEl.textContent = result.generated_summary;
      chapter.summary = result.generated_summary;
    }
    btn.textContent = '2/3 Harita…';
    await runSuggestProgressions(chapter);
    btn.textContent = '3/3 Zaman çizelgesi…';
    await runSuggestEvents(chapter);
    btn.textContent = '✅ Bölüm kapatıldı';
    renderChapterHealthStrip(chapter);
  } catch (err) {
    alert('Bölüm kapatma sırasında hata: ' + err.message);
    btn.textContent = '✅ Bölümü Kapat';
  } finally {
    btn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// KOLON DÜZENLEME PANELİ: ad + Kişi bağı. Kolon bir karaktere bağlanınca
// AI doldurma o karakterin profilini de görür - taslaklar rolün sesine
// oturur (backend zaten hazırdı, eksik olan bu arayüzdü).
// ---------------------------------------------------------------------------
async function openMatrixColumnEditor(m, colId) {
  const editor = document.getElementById('matrixCellEditor');
  const col = m.columns.find(c => c.id === colId);
  let characters = [];
  try { characters = await api.get('/characters/'); } catch (e) { /* seçici olmadan devam */ }
  editor.innerHTML = `
    <div class="panel">
      <b>Kolonu Düzenle</b>
      <div class="field" style="margin-top:8px;"><label>Kolon adı</label>
        <input type="text" id="mColLabel" value="${escapeHtml(col.label)}"></div>
      <div class="field"><label>Bağlı Kişi <span style="font-weight:400;color:var(--text-muted);">(AI doldurma bu kişinin profilini görür)</span></label>
        <select id="mColChar">
          <option value="">(bağlı değil)</option>
          ${characters.map(c => `<option value="${c.id}" ${col.character_id === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
        </select></div>
      <hr style="border:none;border-top:1px solid var(--border);margin:12px 0;">
      <strong style="font-size:11.5px;letter-spacing:0.3px;">🔗 FİHRİSTLE EŞLEŞTİR</strong>
      <div style="font-size:11.5px;color:var(--text-muted);margin:4px 0 6px;">
        Bu kolonu fihristteki bir <b>bölüme</b> bağla; satırlar o bölümün
        <b>alt girdileriyle SIRAYLA</b> eşleşsin (1. satır → 1. kısım, 2. → 2. ...).
        Tek tek hücre bağlamak yerine tek işlem.
      </div>
      <div class="field">
        <label>Üst girdi (bölüm)</label>
        <select id="mColParent"><option value="">Yükleniyor…</option></select>
      </div>
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;margin-bottom:6px;">
        <input type="checkbox" id="mColOverwrite"> Zaten bağlı hücrelerin bağını da değiştir
      </label>
      <button class="btn btn-sm btn-primary" id="mColBind">Satırları sırayla eşleştir</button>
      <div id="mColBindResult"></div>
      <div class="form-actions">
        <button class="btn btn-primary" id="mColSave">Kaydet</button>
        <button class="btn" id="mColCancel">Kapat</button>
      </div>
      <div id="mColError" class="error-text"></div>
    </div>`;
  editor.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  document.getElementById('mColCancel').addEventListener('click', () => { editor.innerHTML = ''; });

  // Fihrist ağacını yükle: alt girdisi olan girdiler öne çıkarılır
  (async () => {
    const sel = document.getElementById('mColParent');
    try {
      const tree = await api.get('/matrix/outline-tree');
      const uygun = tree.filter(t => t.child_count > 0);
      sel.innerHTML = '<option value="">(seç)</option>'
        + (uygun.length
          ? uygun.map(t => `<option value="${t.id}">${'—'.repeat(t.level)} #${t.display} ${escapeHtml(t.title || '(başlıksız)')} · ${t.child_count} alt girdi</option>`).join('')
          : '<option value="" disabled>Alt girdisi olan bölüm yok - fihristte Kısım/Alt Başlık oluştur</option>');
    } catch (err) { sel.innerHTML = `<option value="">Yüklenemedi: ${escapeHtml(err.message)}</option>`; }
  })();

  document.getElementById('mColBind').addEventListener('click', async () => {
    const parentId = document.getElementById('mColParent').value;
    const box = document.getElementById('mColBindResult');
    if (!parentId) { box.innerHTML = '<div class="error-text">Önce bir üst girdi seç.</div>'; return; }
    box.innerHTML = '<div class="empty-state">Eşleştiriliyor…</div>';
    try {
      const r = await api.post(`/matrix/${m.id}/columns/${colId}/bind-outline`, {
        parent_chapter_id: parseInt(parentId, 10),
        overwrite: document.getElementById('mColOverwrite').checked,
      });
      box.innerHTML = `
        <div style="font-size:12.5px;margin-top:8px;">
          ${r.linked.length ? `<div style="color:var(--text-ink);"><b>${r.linked.length} satır eşleşti:</b><br>${r.linked.map(escapeHtml).join('<br>')}</div>` : ''}
          ${r.skipped.length ? `<div style="color:var(--text-muted);margin-top:6px;"><b>Atlananlar:</b><br>${r.skipped.map(escapeHtml).join('<br>')}</div>` : ''}
        </div>`;
      await loadMatrixGrid();
    } catch (err) { box.innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`; }
  });
  document.getElementById('mColSave').addEventListener('click', async () => {
    const label = document.getElementById('mColLabel').value.trim();
    if (!label) { document.getElementById('mColError').textContent = 'Ad boş olamaz.'; return; }
    const charVal = document.getElementById('mColChar').value;
    try {
      await api.put(`/matrix/${m.id}/columns/${colId}`, {
        label, character_id: charVal ? parseInt(charVal, 10) : null,
      });
      editor.innerHTML = '';
      await loadMatrixGrid();
    } catch (err) { document.getElementById('mColError').textContent = err.message; }
  });
}

// ---------------------------------------------------------------------------
// METİNDEN DOLDUR: "Aşama adı: içerik" satırlarını, satır etiketleriyle
// eşleştirip SEÇİLEN kolonun hücrelerine dağıtır. Belgelerdeki tur
// tablolarını elle hücre hücre taşımamak için. Eşleşme önce ÖNİZLENİR -
// hangi satırın nereye gideceğini görmeden hiçbir şey yazılmaz. Dolu
// hücrenin üzerine yazmadan önce ayrıca sorar.
// ---------------------------------------------------------------------------
function _trLowerJs(s) { return s.replace(/İ/g, 'i').replace(/I/g, 'ı').toLowerCase(); }

async function openMatrixImporter(m) {
  const editor = document.getElementById('matrixCellEditor');
  if (!m.columns.length || !m.rows.length) { alert('Önce kolon ve satırları kur.'); return; }
  editor.innerHTML = `
    <div class="panel">
      <b>📥 Metinden Doldur</b>
      <div class="field" style="margin-top:8px;"><label>Hedef kolon</label>
        <select id="mImpCol">${m.columns.map(c => `<option value="${c.id}">${escapeHtml(c.label)}</option>`).join('')}</select></div>
      <div class="field"><label>Metin - her satır: <code>Aşama adı: içerik</code></label>
        <textarea id="mImpText" style="min-height:160px;" placeholder="1. Hologram: 5 görüntü: Mahalle → Makam → Gece. Anahtar: ÇÖZÜN.\n2. Kamera+Soru: 2 soru: ambulans süresi, duman bilinci."></textarea></div>
      <div class="form-actions">
        <button class="btn btn-primary" id="mImpPreview">Eşleşmeleri Önizle</button>
        <button class="btn" id="mImpCancel">Kapat</button>
      </div>
      <div id="mImpResult"></div>
    </div>`;
  editor.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  document.getElementById('mImpCancel').addEventListener('click', () => { editor.innerHTML = ''; });

  document.getElementById('mImpPreview').addEventListener('click', async () => {
    const colId = parseInt(document.getElementById('mImpCol').value, 10);
    const lines = document.getElementById('mImpText').value.split('\n').map(l => l.trim()).filter(Boolean);
    const matches = [], unmatched = [];
    for (const line of lines) {
      const sep = line.indexOf(':');
      if (sep < 1) { unmatched.push(line); continue; }
      const key = _trLowerJs(line.slice(0, sep).trim());
      const content = line.slice(sep + 1).trim();
      // Satır etiketiyle esnek eşleşme: etiket anahtarı içerir ya da tersi
      const row = m.rows.find(r => {
        const label = _trLowerJs(r.label);
        return label.includes(key) || key.includes(label);
      });
      if (row && content) matches.push({ row, content });
      else unmatched.push(line);
    }
    const box = document.getElementById('mImpResult');
    if (!matches.length) { box.innerHTML = '<div class="error-text">Hiçbir satır eşleşmedi - satır adlarıyla başlamalı.</div>'; return; }
    const full = await api.get(`/matrix/${m.id}`);
    const filled = new Set(full.cells.filter(c => (c.content || '').trim()).map(c => `${c.column_id}:${c.row_id}`));
    box.innerHTML = `
      <div style="margin-top:10px;">
        ${matches.map((x, i) => `<div style="font-size:12.5px;padding:4px 0;border-top:1px solid var(--border);">
          <b>${escapeHtml(x.row.label)}</b> ${filled.has(colId + ':' + x.row.id) ? '<span style="color:var(--danger);font-size:11px;">(dolu - üzerine yazılacak)</span>' : ''}<br>
          <span style="color:var(--text-muted);">${escapeHtml(x.content.slice(0, 100))}${x.content.length > 100 ? '…' : ''}</span>
        </div>`).join('')}
        ${unmatched.length ? `<div style="font-size:12px;color:var(--danger);margin-top:6px;">Eşleşmeyen ${unmatched.length} satır atlanacak.</div>` : ''}
        <button class="btn btn-primary btn-sm" id="mImpApply" style="margin-top:8px;">${matches.length} Hücreyi Yaz</button>
      </div>`;
    document.getElementById('mImpApply').addEventListener('click', async () => {
      const overwrites = matches.filter(x => filled.has(colId + ':' + x.row.id));
      if (overwrites.length && !confirm(`${overwrites.length} dolu hücrenin üzerine yazılacak. Devam?`)) return;
      try {
        const cellMap = {};
        full.cells.forEach(c => { cellMap[`${c.column_id}:${c.row_id}`] = c; });
        for (const x of matches) {
          const existing = cellMap[`${colId}:${x.row.id}`];
          await api.put(`/matrix/${m.id}/cells`, {
            column_id: colId, row_id: x.row.id, content: x.content,
            chapter_id: existing ? existing.chapter_id : null,
          });
        }
        editor.innerHTML = '';
        await loadMatrixGrid();
      } catch (err) { box.innerHTML += `<div class="error-text">${escapeHtml(err.message)}</div>`; }
    });
  });
}

async function loadEntityRules(type, entityId) {
  const listEl = document.getElementById('entityRulesList');
  if (!listEl) return;
  try {
    const rules = (await api.get('/rules/')).filter(r => r.entity_type === type && r.entity_id === entityId);
    listEl.innerHTML = rules.length ? rules.map(r => `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:12.5px;padding:3px 0;">
        <span>${escapeHtml(r.title)}${r.description ? ` <span style="color:var(--text-muted);">- ${escapeHtml(r.description)}</span>` : ''}</span>
        <button class="btn-icon-sm entity-rule-del" data-id="${r.id}" title="Kuralı sil">✕</button>
      </div>`).join('') : '<div style="font-size:12px;color:var(--text-muted);padding:3px 0;">Henüz özel kural yok.</div>';
    listEl.querySelectorAll('.entity-rule-del').forEach(btn => btn.addEventListener('click', async () => {
      if (!confirm('Bu kural silinsin mi?')) return;
      try { await api.del(`/rules/${btn.dataset.id}`); loadEntityRules(type, entityId); }
      catch (err) { alert(err.message); }
    }));
  } catch (err) {
    listEl.innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`;
  }
}

// ---------------------------------------------------------------------------
// PARAGRAF BAZLI AI: ✨ Öneri (güçlendirilmiş yeniden yazım - beğenirsen tek
// tıkla değiştir) ve 🔍 Eleştir (editör analizi - metne dokunmaz). İkisi de
// /ai/assist üzerinden gider: bölüm planı, kurallar, seçili varlıklar, üslup
// uyarıları - tam bağlam paragraf düzeyinde de geçerli. Bölüm genelindeki
// karşılığı zaten var: 🎯 Okur Testi.
// ---------------------------------------------------------------------------
async function runParagraphAi(chapter, number, mode) {
  const panel = document.querySelector(`.paragraph-ai-panel[data-number="${number}"]`);
  const paraEl = document.querySelector(`.paragraph-text[data-number="${number}"]`);
  if (!panel || !paraEl) return;
  const text = paraEl.innerText.trim();
  if (!text) { alert('Paragraf boş.'); return; }
  panel.style.display = '';
  panel.innerHTML = `<div class="empty-state">${mode === 'suggest' ? 'Güçlendirilmiş versiyon yazılıyor…' : 'Editör gözüyle inceleniyor…'}</div>`;
  const selected = Array.from(document.querySelectorAll('.entity-check:checked')).map(cb => ({
    entity_type: cb.dataset.type, entity_id: parseInt(cb.dataset.id, 10),
  }));

  // YEREL BAĞLAM: paragrafın bölümdeki YERİ. Bölüm özeti "ne olduğunu"
  // söylüyor ama paragrafın hemen öncesi/sonrası olmadan AI, önceki
  // cümleyle bağ kuramıyor ve sonraki paragrafta zaten anlatılan bilgiyi
  // tekrar edebiliyor. 4 üst + 4 alt komşu gönderilir; her biri ~500
  // karakterde kırpılır ki token maliyeti kontrollü kalsın.
  const allParas = (chapter.paragraphs || []).slice().sort((a, b) => a.number - b.number);
  const idx = allParas.findIndex(x => String(x.number) === String(number));
  const clip = (t) => {
    const v = (t || '').trim();
    return v.length > 500 ? v.slice(0, 500) + '…' : v;
  };
  const before = idx > 0 ? allParas.slice(Math.max(0, idx - 4), idx) : [];
  const after = idx >= 0 ? allParas.slice(idx + 1, idx + 5) : [];
  let neighborBlock = '';
  if (before.length || after.length) {
    neighborBlock = '\n\nBU PARAGRAFIN BÖLÜMDEKİ YERİ (yalnızca BAĞLAM - bunları yeniden yazma):\n';
    if (before.length) {
      neighborBlock += '--- ÖNCEKİ PARAGRAFLAR ---\n'
        + before.map(pp => `[P${pp.number}] ${clip(pp.text)}`).join('\n') + '\n';
    }
    neighborBlock += `--- ÜZERİNDE ÇALIŞILAN PARAGRAF: P${number} ---\n`;
    if (after.length) {
      neighborBlock += '--- SONRAKİ PARAGRAFLAR ---\n'
        + after.map(pp => `[P${pp.number}] ${clip(pp.text)}`).join('\n') + '\n';
    }
    neighborBlock += 'BAĞLAM KURALLARI: öncekiyle akışı, zamanı ve mekânı tutarlı sürdür; '
      + 'sonraki paragraflarda ZATEN anlatılan bilgiyi burada tekrar etme ya da önden verme; '
      + 'komşu paragraflarda kullanılmış imge, benzetme ve cümle kalıplarını yineleme.';
  }

  // Öneri artık KISALTMIYOR, GÜÇLENDİRİYOR - ve türe göre yön alıyor.
  // Bölümün fihrist özeti + planı zaten context'e gidiyor; model önce
  // sahnenin niteliğini (polisiye/gerilim/dramatik/betimleyici) oradan
  // çıkarıp ona uygun teknikle derinleştirsin diye açıkça isteniyor.
  // Ayrıca somut detaylar (rakam, ölçü, isim) korunmak ZORUNDA - sohbetin
  // başında yaşanan "10 santimetre sessizce kayboldu" hatasının önlemi.
  const zorla = window.__forceStrongRewrite ? (window.__forceStrongRewrite = false, true) : false;
  const zorlaEk = zorla
    ? 'ZORUNLU: Metni AYNEN geri döndürme. En az üç somut değişiklik yap - '
      + 'fiil seçimini güçlendir, en az bir duyusal detay ekle, kalıplaşmış bir '
      + 'ifadeyi kaldır. Sonuç mevcut metinle kelime kelime aynı OLAMAZ.\n'
    : '';
  const instruction = mode === 'suggest'
    ? zorlaEk + (effectiveParaPurpose(number).text ? `BU PARAGRAFIN İŞİ (öncelikli ölçüt - yeni hâli bunu yerine getirmeli, kaynak: ${effectiveParaPurpose(number).source}): ${effectiveParaPurpose(number).text}\n` : '')
      + 'MEVCUT METİN olarak verilen paragrafı GÜÇLENDİRİLMİŞ haliyle yeniden yaz.\n'
      + 'ÖNCE bölümün özetine/planına ve çevresindeki akışa bak, bu sahnenin TÜRÜNÜ belirle '
      + '(polisiye/soruşturma, gerilim, aksiyon, dramatik/duygusal, atmosferik betimleme, diyalog) '
      + 've ona uygun tekniği kullan:\n'
      + '- polisiye/soruşturma: somut kanıt ve gözlem detayı, dedektif bakışı, gereksiz süsten kaçın\n'
      + '- gerilim: kısa ve kesik cümleler, tehdit sezgisi, bilgi saklama\n'
      + '- aksiyon: güçlü fiiller, hız, uzun betimleme yok\n'
      + '- dramatik: iç ses, beden dili, duygunun dolaylı gösterimi\n'
      + '- atmosferik betimleme: duyuları çeşitlendir (koku, ses, sıcaklık, doku), mekanı canlandır\n'
      + 'KURALLAR: (0) EYLEM SIRASINI BOZMA - mevcut metinde tamamlanmış bir eylemi '
      + 'yeniden başlatma. "Mendilini çıkardı" yazıyorsa artık mendil elindedir; onu '
      + '"cebinden çekip" diye TEKRAR çıkarma. Detay eklemek istiyorsan eylemin ÖNCESİNE '
      + '(hazırlık) ya da SONRASINA (sonuç) ekle, ortasına geri dönme. Zaman akışı tek '
      + 'yönlüdür: geçmiş zamanda anlatılan bir eylem tamamlanmıştır. '
      + '(1) KISALTMA - gerekirse metni BÜYÜT, derinleştir; sadece gerçekten boş '
      + 'tekrarları at. (2) Mevcut SOMUT detayları (rakam, ölçü, renk, özel isim) AYNEN KORU, '
      + 'asla düşürme. (3) Olay akışını ve anlamı değiştirme, yeni olay ekleme. '
      + '(4) Üslup uyarılarındaki kalıplardan kaçın.\n'
      + 'SADECE yeni paragraf metnini döndür - açıklama, başlık, tırnak ekleme.'
    : 'MEVCUT METİN olarak verilen paragrafı deneyimli bir editör gözüyle eleştir. '
      + 'Önce bölümün özetine/planına bakıp sahnenin türünü belirle ve eleştiriyi O TÜRÜN '
      + 'ölçütlerine göre yap (polisiye ise ipucu/gözlem, gerilim ise tempo, dramatik ise '
      + 'duygunun inandırıcılığı vb.). '
      + 'Yanıt: güçlü yönler (1-2 madde), zayıf yönler ve her zayıf yön için SOMUT bir öneri. '
      + 'Paragrafı YENİDEN YAZMA - sadece analiz.';
  const fullInstruction = instruction + neighborBlock;
  try {
    const result = await api.post('/ai/assist', {
      chapter_number: chapter.number, instruction: fullInstruction,
      selected_entities: selected, existing_text: text,
    });
    const notes = (result.consistency_notes && result.consistency_notes.length)
      ? `<div style="font-size:12px;color:var(--danger);margin-top:6px;">⚠ ${result.consistency_notes.map(escapeHtml).join(' · ')}</div>` : '';
    // DEĞİŞMEDİ KORUMASI: model bazen metni AYNEN geri döndürüyor (ya da
    // sadece noktalama oynatıyor). Bunu "öneri" diye sunmak kullanıcıyı
    // yanıltıyordu - fark yokken "Paragrafı Değiştir" düğmesi anlamsız.
    // Normalize edilmiş karşılaştırma: boşluk/noktalama farkı sayılmaz.
    const _norm = (t) => (t || '').replace(/\s+/g, ' ').replace(/[.,;:!?—–-]/g, '').trim().toLocaleLowerCase('tr');
    const degismedi = mode === 'suggest' && _norm(result.generated_text) === _norm(text);

    // İKİ SÜTUN: solda öneri metni, sağda sohbet. Yan yana durunca
    // "öneriyi oku → tartış → yeni versiyon" döngüsü tek ekranda dönüyor;
    // eskiden sohbet önerinin ALTINDA açılıyor ve öneri ekrandan kayıyordu.
    // Dar ekranda CSS ile alt alta düşer (bkz. .para-ai-grid).
    panel.innerHTML = `
      <div class="panel para-ai-grid" style="border-left:3px solid ${mode === 'suggest' ? 'var(--gold)' : 'var(--border)'};">
        <div class="para-ai-col-left">
          <div class="field" style="margin:0 0 8px;">
            <label style="font-size:10.5px;letter-spacing:0.4px;color:var(--text-muted);">🎯 BU PARAGRAFIN İŞİ <span style="font-weight:400;text-transform:none;letter-spacing:0;">(bir cümle - yeniden yazımın ölçüsü olur)</span></label>
            <input type="text" class="para-purpose" data-number="${number}" value="${escapeHtml(paraPurposes[number] || '')}" placeholder="ör. Yangın yerini masum göstermek - okur sonradan anlamalı" style="font-size:12.5px;">
          </div>
          <strong style="font-size:11px;color:var(--text-muted);letter-spacing:0.4px;">${mode === 'suggest' ? '✨ ÖNERİLEN VERSİYON - onaysız değişmez' : '🔍 EDİTÖR ELEŞTİRİSİ - metne dokunulmadı'}</strong>
          ${degismedi ? `<div style="margin-top:6px;padding:8px;border:1px solid var(--danger);border-radius:6px;font-size:12.5px;color:var(--danger);">
            ⚠ AI metni <b>değiştirmedi</b> - önerilen versiyon mevcut paragrafla aynı.
            Ya model bu paragrafı yeterli buldu ya da istek yeterince belirgin değildi.
            <div style="margin-top:6px;"><button class="btn btn-sm" id="retryStronger">🔁 Daha zorlayıcı talimatla tekrar dene</button></div>
          </div>` : ''}
          <div style="white-space:pre-wrap;font-size:13px;margin-top:6px;">${escapeHtml(result.generated_text || '')}</div>
          ${notes}
          <div class="form-actions">
            ${mode === 'suggest' ? `<button class="btn btn-primary btn-sm para-ai-replace" data-number="${number}">Paragrafı Değiştir</button>` : ''}
            <button class="btn btn-sm para-ai-close">Kapat</button>
          </div>
        </div>
        <div class="para-ai-col-right">
          <strong style="font-size:11px;color:var(--text-muted);letter-spacing:0.4px;">💬 BU PARAGRAFI KONUŞ</strong>
          <div class="para-chat-box" data-number="${number}" style="margin-top:6px;">
            <div class="para-chat-log" data-number="${number}" style="max-height:260px;overflow-y:auto;font-size:12.5px;"></div>
            <div style="display:flex;gap:6px;margin-top:6px;">
              <textarea class="para-chat-input" data-number="${number}" placeholder="Ör: bu paragraf sence nasıl? / ritmi ağır mı?" style="flex:1;min-height:38px;box-sizing:border-box;font-size:12.5px;"></textarea>
              <button class="btn btn-sm btn-primary para-chat-send" data-number="${number}">Gönder</button>
            </div>
            <button class="btn btn-sm para-chat-write" data-number="${number}" style="margin-top:6px;width:100%;" title="Konuştuklarımızı uygulayan yeni bir paragraf versiyonu üretir">✍️ Konuştuklarımıza göre yeni versiyonu yaz</button>
          </div>
        </div>
      </div>`;
    renderParaChatLog(number);
    panel.querySelector('.para-ai-close').addEventListener('click', () => { panel.style.display = 'none'; panel.innerHTML = ''; });
    // İŞLEV: yazıldıkça saklanır ve TÜM yeniden yazım talimatlarının EN
    // BAŞINA konur. Eksik olan buydu - "ne anlatılıyor" ve "ne bozuk"
    // biliniyordu ama "bu paragraf ne YAPMAK zorunda" hiçbir yerde tanımlı
    // değildi; AI da estetiği optimize edip işlevi ıskalıyordu.
    // "Değişmedi" durumunda daha zorlayıcı talimatla tekrar
    panel.querySelector('#retryStronger')?.addEventListener('click', () => {
      window.__forceStrongRewrite = true;
      runParagraphAi(chapter, number, 'suggest');
    });
    const purposeInput = panel.querySelector('.para-purpose');
    if (purposeInput) purposeInput.addEventListener('input', () => {
      paraPurposes[number] = purposeInput.value;
      saveParaState();
    });
    // Paragraf sohbeti: öneriyi tartışarak iyileştirme. Bağlam SADECE bu
    // paragraf + komşuları + son öneri - tüm bölüm sohbetine karışmaz,
    // kendi geçmişi vardır (paragraf bazlı).

    const sendBtn = panel.querySelector('.para-chat-send');
    if (sendBtn) sendBtn.addEventListener('click', () => sendParagraphChat(chapter, number, neighborBlock, text));
    const writeBtn = panel.querySelector('.para-chat-write');
    if (writeBtn) writeBtn.addEventListener('click', () => writeParagraphVersion(chapter, number, neighborBlock, text));
    const chatInput = panel.querySelector('.para-chat-input');
    if (chatInput) chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendParagraphChat(chapter, number, neighborBlock, text); }
    });
    const replaceBtn = panel.querySelector('.para-ai-replace');
    if (replaceBtn) replaceBtn.addEventListener('click', async () => {
      // KABUL KONTROLÜ önce çalışır: işlev, somut detay kaybı, süreklilik,
      // yasak kalıp. Karar yine kullanıcının - "yine de yaz" seçeneği var.
      const yeniMetin = (result.generated_text || '').trim();
      replaceBtn.closest('.form-actions').insertAdjacentElement('afterend', renderQuickCheck(
        text, yeniMetin,
        async () => {
          await replaceParagraphText(chapter.id, parseInt(number, 10), yeniMetin);
          markParagraphResolved(number);
        },
        () => verifyBeforeApply(chapter.id, parseInt(number, 10), text, yeniMetin),
      ));
    });
  } catch (err) {
    panel.innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`;
  }
}

async function replaceParagraphText(chapterId, number, text) {
  try {
    const saved = await api.put(`/chapters/${chapterId}/paragraphs/${number}`, { number, text });
    dirtyChapterId = chapterId;
    // TAM YENİDEN ÇİZİM YOK: renderReader inceleme panelini de siliyordu -
    // bir paragrafı düzeltince diğer bulgular ekrandan kayboluyordu.
    // Sadece o paragrafın metni ve rozetleri yerinde güncellenir.
    const el = document.querySelector(`.paragraph-text[data-number="${number}"]`);
    if (el) {
      el.textContent = text;
      el.dataset.original = text;
      el.dataset.raw = text;
      el.style.boxShadow = '-3px 0 0 #3f7a4f';        // kısa yeşil işaret
      setTimeout(() => { el.style.boxShadow = ''; }, 1500);
      const chipRow = el.nextElementSibling;
      if (chipRow && saved && saved.mentions) {
        chipRow.innerHTML = saved.mentions.map(m =>
          `<span class="mention-chip mention-goto" data-type="${m.entity_type}" data-id="${m.entity_id}" style="cursor:pointer;">${escapeHtml(m.entity_name)}</span>`).join('');
      }
    }
    // Bellekteki bölüm nesnesini de tazele (sonraki işlemler doğru metni görsün)
    if (currentChapter && currentChapter.id === chapterId) {
      const p = (currentChapter.paragraphs || []).find(x => x.number === number);
      if (p) p.text = text;
    }
    if (!el) {   // paragraf ekranda yoksa (başka bölüm) tam tazele
      const refreshed = await api.get(`/chapters/${chapterId}`);
      currentChapter = refreshed;
      renderReader(refreshed);
    }
  } catch (err) { alert(err.message); }
}

// ---------------------------------------------------------------------------
// SOHBETTE PARAGRAF DEĞİŞTİRME: "P55'i daha öfkeli yaz" -> yanıt gelir ->
// yanıt balonunun altında "P55'i Değiştir" düğmesi. Kullanıcının mesajında
// hangi P-kodları geçiyorsa ve bunlar AÇIK bölümün paragraflarıysa düğme
// çıkar; tıklanınca yanıt metni o paragrafın yerine yazılır (eski hal
// Geçmiş'te). Sohbet geçmişi korunur - konuşmaya kaldığın yerden devam.
// ---------------------------------------------------------------------------
function chatReplaceButtons(assistantIdx) {
  const prev = aiChatMessages[assistantIdx - 1];
  if (!prev || prev.role !== 'user' || !currentChapter) return '';
  // Atıf artık BÖLÜM İÇİ SIRA numarasıyla (AI'ya giden [P{number}] ile aynı).
  // Eskiden veritabanı kimliğine (p.id) bakılıyordu; ekranda "P220" yazıp
  // AI'ya "P1" gitmesi kullanıcıyı da modeli de yanıltıyordu.
  const refs = [...new Set((prev.content.match(/\bP(\d+)\b/gi) || []).map(x => parseInt(x.slice(1), 10)))];
  const valid = refs.filter(num => (currentChapter.paragraphs || []).some(p => p.number === num));
  return valid.map(pid =>
    `<button class="btn btn-sm btn-primary chat-replace-btn" data-idx="${assistantIdx}" data-pid="${pid}" style="margin:6px 0 0 6px;" title="Bu yanıtın metnini P${pid} paragrafının YERİNE yazar - eski hali Geçmiş'te saklanır">↺ P${pid}'i Değiştir</button>`
  ).join('');
}

async function chatReplaceParagraph(assistantIdx, pid) {
  const msg = aiChatMessages[assistantIdx];
  const para = (currentChapter.paragraphs || []).find(p => p.number === pid);
  if (!msg || !para) { alert('Paragraf bu bölümde bulunamadı.'); return; }
  const preview = msg.content.length > 400 ? msg.content.slice(0, 400) + '…' : msg.content;
  if (!confirm(`P${pid} şu metinle DEĞİŞTİRİLECEK:\n\n${preview}\n\nEski hali "Geçmiş"ten geri alınabilir. Devam?`)) return;
  await replaceParagraphText(currentChapter.id, para.number, msg.content);  // sıra numarası
  msg.actions = (msg.actions || []).concat([`P${pid} paragrafı değiştirildi`]);
  renderChatMessages();
}

// Olay/Zaman Çizelgesi çıkarımı: bölüm metnindeki tarih-saat bilgilerinden
// olayları önerir. "AI ile özet oluştur" kabul edilince ve "Bölümü Kapat"ta
// otomatik çalışır; öneriler onaysız KAYDEDİLMEZ (çizelge çöplüğe dönmesin).
async function runSuggestEvents(chapter, containerId = 'eventScanResult') {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '<div class="empty-state">Zaman çizelgesi için olaylar aranıyor…</div>';
  try {
    const suggestions = await api.post(`/chapters/${chapter.id}/suggest-events`, {});
    if (!suggestions.length) {
      container.innerHTML = '<div style="font-size:12px;color:var(--text-muted);padding:4px 0;">Zaman çizelgesine eklenecek yeni olay bulunamadı.</div>';
      return;
    }
    renderEventSuggestionsInto(container, suggestions);
  } catch (err) {
    container.innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`;
  }
}

// TALİMAT KASASI: satır (aşama) düzenleme - ad, tür ve kalıcı yazım kısıtları.
// Buraya yazdığın kısıtlar, bu satıra bağlı HER bölümün AI isteğine plan
// katmanıyla birlikte gider; "iyi talimat"ı her sahnede yeniden yazmak
// gerekmez (ör. "duyguyu adlandırma", "sanık tek cümle konuşur").
async function openMatrixRowEditor(m, rowId) {
  const editor = document.getElementById('matrixCellEditor');
  const row = m.rows.find(r => r.id === rowId);
  editor.innerHTML = `
    <div class="panel">
      <b>Aşamayı Düzenle</b>
      <div class="field" style="margin-top:8px;"><label>Ad</label>
        <input type="text" id="mRowLabel" value="${escapeHtml(row.label)}"></div>
      <div class="field"><label>Tür</label>
        <select id="mRowKind">
          <option value="main" ${row.kind !== 'sub' ? 'selected' : ''}>Ana başlık</option>
          <option value="sub" ${row.kind === 'sub' ? 'selected' : ''}>Ara başlık</option>
        </select></div>
      <div class="field">
        <label>📌 Talimat Kasası <span style="font-weight:400;color:var(--text-muted);font-size:11.5px;">(bu aşamanın KALICI yazım kısıtları - bağlı her bölümde AI'ya gider)</span></label>
        <textarea id="mRowInstructions" style="min-height:110px;" placeholder="Örn:&#10;- Duyguyu ADLANDIRMA: beden, ses, nesne ve sessizlikle göster&#10;- Sanık bu aşamada en fazla tek cümle konuşur&#10;- Şişenin rengini betimlemeye yedir, rapor gibi verme">${escapeHtml(row.instructions || '')}</textarea>
      </div>
      <div class="form-actions">
        <button class="btn btn-primary" id="mRowSave">Kaydet</button>
        <button class="btn" id="mRowCancel">Kapat</button>
      </div>
      <div id="mRowError" class="error-text"></div>
    </div>`;
  editor.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  document.getElementById('mRowCancel').addEventListener('click', () => { editor.innerHTML = ''; });
  document.getElementById('mRowSave').addEventListener('click', async () => {
    const label = document.getElementById('mRowLabel').value.trim();
    if (!label) { document.getElementById('mRowError').textContent = 'Ad boş olamaz.'; return; }
    try {
      await api.put(`/matrix/${m.id}/rows/${rowId}`, {
        label,
        kind: document.getElementById('mRowKind').value,
        instructions: document.getElementById('mRowInstructions').value,
      });
      editor.innerHTML = '';
      await loadMatrixGrid();
    } catch (err) { document.getElementById('mRowError').textContent = err.message; }
  });
}

// ---------------------------------------------------------------------------
// @İSİM ile VARLIK ÇAĞIRMA: uzun kişi listelerinde onay kutusu avlamak yerine
// yazarken "@vicdan" yazıp seçmek. Yazdıkça öneri listesi çıkar; seçilince
// (a) üstteki listede o varlık işaretlenir, (b) metindeki @kısaltma tam ada
// dönüşür. Böylece hem AI'ya doğru varlık gider hem cümle akıcı kalır.
// ---------------------------------------------------------------------------
function renderSelectedEntityChips() {
  const box = document.getElementById('selectedEntityChips');
  if (!box) return;
  const checked = Array.from(document.querySelectorAll('.entity-check:checked'));
  if (!checked.length) {
    box.innerHTML = '<span style="font-size:11.5px;color:var(--text-muted);">Seçili varlık yok - arayarak ya da metinde @isim yazarak seç</span>';
    return;
  }
  box.innerHTML = checked.map(cb => {
    const name = cb.parentElement.textContent.trim().replace(/\s*●$/, '');
    return `<span class="mention-chip" style="cursor:pointer;" data-id="${cb.dataset.id}" data-type="${cb.dataset.type}" title="Seçimden çıkar">${escapeHtml(name)} ✕</span>`;
  }).join('');
  box.querySelectorAll('.mention-chip').forEach(chip => chip.addEventListener('click', () => {
    const cb = document.querySelector(`.entity-check[data-id="${chip.dataset.id}"][data-type="${chip.dataset.type}"]`);
    if (cb) { cb.checked = false; renderSelectedEntityChips(); }
  }));
}

function handleMentionTyping(el) {
  const value = el.value;
  const caret = el.selectionStart;
  const before = value.slice(0, caret);
  // İmleçten geriye doğru en yakın @ ve sonrasındaki kelime parçası
  // @ sonrası tek kelime VE "@Şahin Gö" gibi iki kelimelik isimler de
  // yakalansın diye en fazla bir boşluğa izin verilir.
  const match = before.match(/@([\wçğıöşüÇĞİÖŞÜ]*(?: [\wçğıöşüÇĞİÖŞÜ]*)?)$/);
  let box = document.getElementById('mentionSuggestBox');
  if (!match) { if (box) box.remove(); return; }

  const query = _trLowerJs(match[1]);
  const options = Array.from(document.querySelectorAll('.entity-check')).map(cb => ({
    cb, name: cb.parentElement.textContent.trim().replace(/\s*●$/, ''),
  })).filter(o => !query || _trLowerJs(o.name).includes(query)).slice(0, 6);

  if (!box) {
    box = document.createElement('div');
    box.id = 'mentionSuggestBox';
    box.style.cssText = 'border:1px solid var(--gold);border-radius:8px;background:#fff;margin-top:4px;max-height:200px;overflow-y:auto;box-shadow:0 2px 8px rgba(0,0,0,0.08);';
    // Kutuyu satırın İÇİNE değil ARDINA koy: sohbet giriş satırı flex
    // düzeninde olduğu için içine eklenen kutu Gönder butonunun yanına
    // sıkışıp görünmez oluyordu.
    const anchor = el.closest('.chat-input-row') || el.closest('.field') || el;
    anchor.insertAdjacentElement('afterend', box);
  }
  if (!options.length) {
    box.innerHTML = '<div style="font-size:12px;color:var(--text-muted);padding:6px 8px;">Eşleşen kayıt yok</div>';
    return;
  }
  box.innerHTML = options.map((o, i) => `
    <div class="mention-opt" data-idx="${i}" style="padding:5px 8px;font-size:13px;cursor:pointer;border-bottom:1px solid var(--border);${i === 0 ? 'background:var(--paper-dim);' : ''}">
      ${escapeHtml(o.name)} ${o.cb.checked ? '<span style="color:var(--gold);font-size:11px;">✓ seçili</span>' : ''}
    </div>`).join('');
  box.dataset.active = '0';

  // Seçimi uygulayan ortak fonksiyon (fare ve klavye aynı yolu kullanır)
  const applyOption = (idx) => {
    const o = options[idx];
    if (!o) return;
    o.cb.checked = true;
    renderSelectedEntityChips();
    const start = caret - match[0].length;
    el.value = value.slice(0, start) + o.name + value.slice(caret);
    const pos = start + o.name.length;
    el.focus();
    el.setSelectionRange(pos, pos);
    box.remove();
  };
  box._applyOption = applyOption;
  box._optionCount = options.length;

  box.querySelectorAll('.mention-opt').forEach(opt => {
    opt.addEventListener('mousedown', (e) => {
      e.preventDefault(); // blur olmadan seçilsin
      applyOption(parseInt(opt.dataset.idx, 10));
    });
    opt.addEventListener('mouseenter', () => setMentionActive(box, parseInt(opt.dataset.idx, 10)));
  });
}

// Aktif satırı vurgular ve görünür alana kaydırır
function setMentionActive(box, idx) {
  const opts = box.querySelectorAll('.mention-opt');
  if (!opts.length) return;
  const next = Math.max(0, Math.min(idx, opts.length - 1));
  opts.forEach((o, i) => { o.style.background = i === next ? 'var(--paper-dim)' : ''; });
  box.dataset.active = String(next);
  opts[next].scrollIntoView({ block: 'nearest' });
}

// @ öneri kutusu açıkken klavye: ↓/↑ gez, Enter/Tab seç, Esc kapat.
// Kutu kapalıyken hiçbir tuşa karışmaz - Enter normal davranışını korur.
function handleMentionKeydown(e) {
  const box = document.getElementById('mentionSuggestBox');
  if (!box || !box._optionCount) return false;
  const active = parseInt(box.dataset.active || '0', 10);
  if (e.key === 'ArrowDown') { e.preventDefault(); setMentionActive(box, active + 1); return true; }
  if (e.key === 'ArrowUp') { e.preventDefault(); setMentionActive(box, active - 1); return true; }
  if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); box._applyOption(active); return true; }
  if (e.key === 'Escape') { e.preventDefault(); box.remove(); return true; }
  return false;
}

// Özette/metinde tarih var mı kontrolü. Zaman Çizelgesi bölümdeki tarih ve
// saat bilgisinden besleniyor; ikisi de yoksa olay çıkarımı boş döner ve
// kronoloji sessizce kopar. Bu yüzden erken uyarı veriyoruz.
function renderSummaryDateWarning(chapter) {
  const el = document.getElementById('summaryDateWarning');
  if (!el) return;
  const AYLAR = 'ocak|şubat|mart|nisan|mayıs|haziran|temmuz|ağustos|eylül|ekim|kasım|aralık';
  // Tarih biçimleri: "28 Haziran 2030", "28.06.2030", "2030", saat "21:00".
  // Regex LİTERAL yazılır - new RegExp + şablon dizesi kombinasyonunda
  // ters bölü kaçışları katlanıp desen bozuluyordu (tarihler bulunamıyordu).
  const dateRe = /(\d{1,2}\s*(ocak|şubat|mart|nisan|mayıs|haziran|temmuz|ağustos|eylül|ekim|kasım|aralık))|(\d{1,2}[./]\d{1,2}[./]\d{2,4})|\b(19|20|21)\d{2}\b|\b\d{1,2}:\d{2}\b/i;
  const summary = (chapter.summary || '');
  const body = (chapter.paragraphs || []).map(p => p.text || '').join(' ');
  const inSummary = dateRe.test(summary);
  const inBody = dateRe.test(body);

  if (!summary.trim()) { el.innerHTML = ''; return; }  // özet yoksa ayrı uyarı zaten var
  if (inSummary) { el.innerHTML = ''; return; }

  el.innerHTML = `
    <div style="margin-top:6px;font-size:12px;color:var(--danger);border-left:3px solid var(--danger);padding-left:8px;">
      ⚠ Özette tarih/saat geçmiyor.
      ${inBody
        ? 'Bölüm metninde tarih var ama özete yansımamış - özeti yeniden ürettirir ya da elle eklersen Zaman Çizelgesi doğru kurulur.'
        : 'Bölüm metninde de tarih/saat yok. Zaman Çizelgesi bu bölümü konumlandıramaz; sahnenin ne zaman geçtiğini metne ya da özete ekle.'}
    </div>`;
}

// Olaylar menüsünden TOPLU tarama: özeti olan tüm bölümleri tek seferde
// tarar. Özetsiz bölümler atlanır - zaman bilgisi özetin ZAMAN satırından
// okunuyor, özetsiz bölüm çizelgeye yanlış tarih sokar.
async function runBulkEventScan() {
  const box = document.getElementById('bulkEventScanResult');
  const btn = document.getElementById('scanAllEventsBtn');
  box.innerHTML = '<div class="empty-state">Bölümler taranıyor…</div>';
  btn.disabled = true;
  try {
    // Tür filtresi YOK: kullanıcının fihristinde metin ve özet, Kısım/Alt
    // Başlık türündeki girdilerde de durabiliyor (içe aktarılan romanlarda
    // sık). Ölçüt tek: ÖZETİ olan her girdi taranır.
    const chapters = (await api.get('/chapters/')).filter(c => (c.summary || '').trim());
    if (!chapters.length) {
      box.innerHTML = '<div style="font-size:12.5px;color:var(--danger);padding:6px 0;">Özeti olan bölüm yok. Önce bölümlerin özetini oluştur (Roman menüsü → bölüm → "AI ile özet oluştur").</div>';
      return;
    }
    const suggestions = await api.post('/chapters/suggest-events-bulk', { chapter_ids: chapters.map(c => c.id) });
    if (!suggestions.length) {
      box.innerHTML = `<div style="font-size:12.5px;color:var(--text-muted);padding:6px 0;">
        ${chapters.length} bölüm tarandı - eklenecek <b>yeni</b> olay bulunamadı.
        Olası sebepler: olaylar zaten çizelgede kayıtlı, ya da AI bu bölümde
        "zaman çizelgesine değer" tekil bir olay göremedi. Bölüm bazlı denemek için
        Roman menüsünde ilgili bölümü açıp <b>🕐 Zaman Çizelgesi</b> düğmesini kullan.
      </div>`;
      return;
    }
    box.innerHTML = `<div style="font-size:12px;color:var(--text-muted);margin:6px 0;">${chapters.length} bölüm tarandı, ${suggestions.length} olay önerisi:</div>`;
    renderEventSuggestionsInto(box, suggestions);
  } catch (err) {
    box.innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`;
  } finally { btn.disabled = false; }
}

// story_order ham sayı olarak anlamsız görünüyordu ("· sıra 2000").
// Formül: bölüm no × 1000 + o bölümdeki kaçıncı olay. Buradan geri çevirip
// "Bölüm 2 · 1. olay" diye gösteriyoruz; formüle uymayan (elle girilmiş)
// değerlerde ham sayıya düşülür.
function formatStoryOrder(order) {
  if (order === null || order === undefined) return '';
  const chapter = Math.floor(order / 1000);
  const idx = order % 1000;
  const label = (chapter > 0 && idx < 100)
    ? `Bölüm ${chapter} · ${idx + 1}. olay`
    : `anlatı sırası ${order}`;
  return ` <span style="color:var(--text-muted);font-weight:400;font-size:11.5px;" title="Olayın romanda anlatıldığı sıra (takvim sırası değil)">· ${label}</span>`;
}

// Tür başlıklarındaki "· N seçili" sayaçlarını tazeler.
function updateTypeCounts() {
  document.querySelectorAll('.type-selected-count').forEach(el => {
    const t = el.dataset.type;
    const n = document.querySelectorAll(`.entity-check[data-type="${t}"]:checked`).length;
    el.textContent = n ? `· ${n} seçili` : '';
  });
}

// AI ile olay tarihi çıkarımı: anlatıldığı bölümün özetindeki ZAMAN satırı
// ve geri dönüş bilgilerinden hesaplar. Öneri ONAYSIZ kaydedilmez; gerekçe
// de gösterilir ki uydurma bir tarihi fark edebilesin.
async function runInferEventDate(eventId) {
  const panel = document.querySelector(`.date-suggest-panel[data-id="${eventId}"]`);
  if (!panel) return;
  panel.style.display = '';
  panel.innerHTML = '<div class="empty-state">Bölüm özetinden zaman çıkarılıyor…</div>';
  try {
    const s = await api.post(`/events/${eventId}/infer-date`, {});
    if (!s.occurred_at) {
      panel.innerHTML = `
        <div class="panel" style="border-left:3px solid var(--danger);">
          <b style="font-size:12.5px;">Tarih çıkarılamadı</b>
          <div style="font-size:12px;color:var(--text-muted);margin-top:3px;">${escapeHtml(s.reasoning || 'Yeterli zaman bilgisi yok.')}</div>
          <div style="font-size:12px;margin-top:6px;">Olayın anlatıldığı bölümün özetine ZAMAN bilgisi ekleyip tekrar dene, ya da <b>Düzenle</b> ile elle gir.</div>
        </div>`;
      return;
    }
    panel.innerHTML = `
      <div class="panel" style="border-left:3px solid var(--gold);">
        <b style="font-size:12.5px;">Önerilen zaman: ${escapeHtml(s.occurred_at)}</b>
        ${s.story_date ? `<div style="font-size:12.5px;">Okunur hali: ${escapeHtml(s.story_date)}</div>` : ''}
        ${s.reasoning ? `<div style="font-size:12px;color:var(--text-muted);margin-top:3px;">Gerekçe: ${escapeHtml(s.reasoning)}</div>` : ''}
        <div class="form-actions">
          <button class="btn btn-sm btn-primary" id="acceptDate_${eventId}">Kaydet</button>
          <button class="btn btn-sm" id="rejectDate_${eventId}">Vazgeç</button>
        </div>
      </div>`;
    document.getElementById(`rejectDate_${eventId}`).addEventListener('click', () => {
      panel.style.display = 'none'; panel.innerHTML = '';
    });
    document.getElementById(`acceptDate_${eventId}`).addEventListener('click', async () => {
      try {
        await api.put(`/events/${eventId}`, { occurred_at: s.occurred_at, story_date: s.story_date || undefined });
        await loadEventList();
      } catch (err) { alert(err.message); }
    });
  } catch (err) {
    panel.innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`;
  }
}

// Odanın ön ayarlarını panele uygular: kapsam, görünür araçlar, ipucu ve
// hazır başlangıç soruları.
function applyAiRoom(room, chapter) {
  const cfg = AI_ROOMS[room] || AI_ROOMS.chapter;
  const hintEl = document.getElementById('aiRoomHint');
  if (hintEl) hintEl.textContent = cfg.hint;

  const scopeSel = document.getElementById('textScopeSelect');
  if (scopeSel) scopeSel.value = cfg.scope;

  // Plan kutusu ve varlık listeleri odaya göre gizlenir - ekran sadeleşir
  const planBox = document.querySelector('#aiPanel .panel[style*="var(--gold)"]');
  if (planBox) planBox.style.display = cfg.showPlan ? '' : 'none';
  const picker = document.getElementById('entityPickerBox');
  const search = document.getElementById('entityPickerSearch');
  [picker, search].forEach(el => { if (el) el.style.display = cfg.showPicker ? '' : 'none'; });
  // Oda değişince açık kalan öneri kutuları kapansın (eski odanın soruları
  // yeni odada asılı kalmasın)
  document.getElementById('starterSuggestBox')?.remove();

  // Kişiler/Mekan odalarında sadece ilgili tür açık kalsın
  document.querySelectorAll('.entity-type-group').forEach(g => {
    const t = g.dataset.type;
    let visible = true;
    if (room === 'people') visible = (t === 'character');
    else if (room === 'world') visible = (t === 'place' || t === 'object');
    g.style.display = visible ? '' : 'none';
  });

  // Bağlam düğmesinin yanındaki özet: kapalıyken bile ne gittiğini söyler
  updateContextToolsSummary();
}

// "⚙ Bağlam ve listeler" düğmesinin yanında tek satırlık durum: kapsam +
// seçili varlık sayısı. Araştırmadaki "kapalı hâl bile yeterli bağlam
// versin" ilkesi - kullanıcı açmadan da ne olduğunu bilir.
function updateContextToolsSummary() {
  const el = document.getElementById('contextToolsSummary');
  if (!el) return;
  const scope = document.getElementById('textScopeSelect')?.value || 'chapter';
  const scopeLabel = { chapter: 'bölüm metni', none: 'metin yok', novel: 'tüm kitap' }[scope];
  const n = document.querySelectorAll('.entity-check:checked').length;
  el.textContent = `· ${scopeLabel}${n ? ` · ${n} varlık` : ''}`;
}

// ---------------------------------------------------------------------------
// HAZIR SORULAR ARTIK AUTOCOMPLETE: kutunun üstünde yer kaplayan düğme
// yığını yerine, kutuya odaklanınca (ya da "/" yazınca) açılan bir öneri
// listesi. Yazmaya başlayınca kendiliğinden kayboluyor - alan sohbete kalır.
// @isim önerileriyle aynı klavye mantığını paylaşır (↓/↑, Enter, Esc).
// ---------------------------------------------------------------------------
function handleStarterTyping(el) {
  const value = el.value;
  const cfg = AI_ROOMS[currentAiRoom] || AI_ROOMS.chapter;
  const all = cfg.starters || [];
  let box = document.getElementById('starterSuggestBox');
  const isSlash = value.startsWith('/');
  const query = isSlash ? _trLowerJs(value.slice(1)) : '';

  // Boş kutuda ya da "/" ile açılır; normal yazarken kapanır
  if (!(value.trim() === '' || isSlash) || !all.length) { if (box) box.remove(); return; }
  const options = all.filter(q => !query || _trLowerJs(q).includes(query));
  if (!options.length) { if (box) box.remove(); return; }

  if (!box) {
    box = document.createElement('div');
    box.id = 'starterSuggestBox';
    box.style.cssText = 'border:1px solid var(--border);border-radius:8px;background:#fff;margin-top:4px;max-height:180px;overflow-y:auto;box-shadow:0 2px 8px rgba(0,0,0,0.06);';
    (el.closest('.chat-input-row') || el).insertAdjacentElement('afterend', box);
  }
  box.innerHTML = `<div style="font-size:10.5px;color:var(--text-muted);padding:4px 8px;border-bottom:1px solid var(--border);">${cfg.icon} ${escapeHtml(cfg.label)} - hazır sorular ("/" ile ara)</div>`
    + options.map((q, i) => `<div class="starter-opt" data-idx="${i}" style="padding:5px 8px;font-size:12.5px;cursor:pointer;${i === 0 ? 'background:var(--paper-dim);' : ''}">${escapeHtml(q)}</div>`).join('');
  box.dataset.active = '0';
  box._optionCount = options.length;
  box._applyOption = (idx) => {
    if (!options[idx]) return;
    el.value = options[idx];
    el.focus();
    box.remove();
  };
  box.querySelectorAll('.starter-opt').forEach(opt => {
    opt.addEventListener('mousedown', (e) => { e.preventDefault(); box._applyOption(parseInt(opt.dataset.idx, 10)); });
    opt.addEventListener('mouseenter', () => setStarterActive(box, parseInt(opt.dataset.idx, 10)));
  });
}

function setStarterActive(box, idx) {
  const opts = box.querySelectorAll('.starter-opt');
  if (!opts.length) return;
  const next = Math.max(0, Math.min(idx, opts.length - 1));
  opts.forEach((o, i) => { o.style.background = i === next ? 'var(--paper-dim)' : ''; });
  box.dataset.active = String(next);
  opts[next].scrollIntoView({ block: 'nearest' });
}

// Klavye: @ kutusu yoksa hazır soru kutusuna bak (aynı tuşlar).
function handleStarterKeydown(e) {
  const box = document.getElementById('starterSuggestBox');
  if (!box || !box._optionCount) return false;
  const active = parseInt(box.dataset.active || '0', 10);
  if (e.key === 'ArrowDown') { e.preventDefault(); setStarterActive(box, active + 1); return true; }
  if (e.key === 'ArrowUp') { e.preventDefault(); setStarterActive(box, active - 1); return true; }
  if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); box._applyOption(active); return true; }
  if (e.key === 'Escape') { e.preventDefault(); box.remove(); return true; }
  return false;
}

// ---------------------------------------------------------------------------
// PARAGRAF SOHBETİ: öneri panelinin içinde, SADECE o paragrafa odaklı mini
// sohbet. Kendi geçmişi vardır (paragraf bazlı) ve bağlamı dardır: hedef
// paragraf + komşuları + son üretilen versiyon. Böylece "daha soğuk olsun",
// "mendil detayını çıkar" gibi turlar, bölüm sohbetini kirletmeden döner.
// ---------------------------------------------------------------------------
const paraChatHistories = {};   // { "12": [ {role, content}, ... ] }

function renderParaChatLog(number) {
  const log = document.querySelector(`.para-chat-log[data-number="${number}"]`);
  if (!log) return;
  const msgs = paraChatHistories[number] || [];
  if (!msgs.length) {
    log.innerHTML = '<div style="color:var(--text-muted);font-size:12px;">Bu paragrafı AI ile konuş: fikrini sor, tartış, birlikte karar verin. Hazır olunca aşağıdaki <b>✍️ yeni versiyonu yaz</b> düğmesiyle metni ürettir.</div>';
    return;
  }
  log.innerHTML = msgs.map((m, i) => `
    <div style="margin-bottom:6px;padding:5px 7px;border-radius:6px;background:${m.role === 'user' ? 'var(--paper-dim)' : '#fff'};border:1px solid ${m.isVersion ? 'var(--gold)' : 'var(--border)'};">
      <div style="font-size:10px;color:var(--text-muted);">${m.role === 'user' ? 'Sen' : (m.isVersion ? '✍️ AI - YENİ VERSİYON' : 'AI')}</div>
      <div style="white-space:pre-wrap;">${escapeHtml(m.content)}</div>
      ${m.role === 'assistant' && m.isVersion ? `
        <div style="display:flex;gap:6px;margin-top:5px;flex-wrap:wrap;">
          <button class="btn btn-sm btn-primary para-chat-apply" data-number="${number}" data-idx="${i}" style="font-size:11px;">✓ Bu versiyonu paragrafa yaz</button>
          <button class="btn btn-sm para-chat-copy" data-idx="${i}" data-number="${number}" style="font-size:11px;" title="Panoya kopyala">⧉ Kopyala</button>
        </div>` : ''}
    </div>`).join('');
  log.scrollTop = log.scrollHeight;
  log.querySelectorAll('.para-chat-copy').forEach(btn => btn.addEventListener('click', () => {
    const msg = paraChatHistories[btn.dataset.number][parseInt(btn.dataset.idx, 10)];
    navigator.clipboard?.writeText(msg.content);
    const prev = btn.textContent;
    btn.textContent = '✓ kopyalandı';
    setTimeout(() => { btn.textContent = prev; }, 1200);
  }));
  log.querySelectorAll('.para-chat-apply').forEach(btn => btn.addEventListener('click', async () => {
    const msg = paraChatHistories[number][parseInt(btn.dataset.idx, 10)];
    const mevcut = (currentChapter?.paragraphs || []).find(p => p.number === parseInt(number, 10));
    const eski = mevcut ? mevcut.text : '';
    btn.parentElement.insertAdjacentElement('afterend', renderQuickCheck(
      eski, msg.content,
      async () => {
        await replaceParagraphText(currentChapter.id, parseInt(number, 10), msg.content);
        markParagraphResolved(number);
      },
      () => verifyBeforeApply(currentChapter.id, parseInt(number, 10), eski, msg.content),
    ));
  }));
}

async function sendParagraphChat(chapter, number, neighborBlock, originalText) {
  const input = document.querySelector(`.para-chat-input[data-number="${number}"]`);
  if (!input || !input.value.trim()) return;
  const userMsg = input.value.trim();
  input.value = '';
  paraChatHistories[number] = paraChatHistories[number] || [];
  paraChatHistories[number].push({ role: 'user', content: userMsg });
  renderParaChatLog(number);

  // GERÇEK SOHBET: burada versiyon ÜRETİLMEZ - fikir alışverişi yapılır.
  // Eskiden her mesaj yeniden yazılmış paragraf döndürüyordu; "ne
  // düşünüyorsun" diye sorulduğunda bile metin geliyordu. Yeni versiyon
  // ancak "✍️ yeni versiyonu yaz" düğmesiyle üretilir (bkz.
  // writeParagraphVersion) - önce anlaş, sonra yaz.
  const base = currentParagraphBase(number, originalText);
  const frame =
    `P${number} adlı TEK BİR PARAGRAF üzerinde konuşuyoruz. Şu anki hali:\n"${base}"\n`
    + (neighborBlock || '')
    + '\nBu bir TARTIŞMA: fikrini söyle, sorun varsa göster, alternatif öner, gerekirse TEK soru sor. '
    + 'Paragrafı YENİDEN YAZMA - kullanıcı hazır olduğunda ayrıca isteyecek.\n'
    + 'UZUNLUK SINIRI (kesin): en fazla 6 CÜMLE. Madde işareti kullanma, başlık atma, '
    + 'aynı fikri farklı kelimelerle tekrarlama. Üç ayrı alternatif sıralama - EN İYİ bir ya da '
    + 'iki yolu söyle. Övgüyle başlama, doğrudan konuya gir.\n'
    + 'ÖNEMLİ - VERSİYON ÜRETİMİ: Kullanıcı bir yeniden yazım isterse ("şöyle yaz", '
    + '"dıştan içe ilerlet" gibi), paragrafın yeni halini MUTLAKA set_draft_result aracıyla ver. '
    + 'Metni sohbet cevabının içine gömme, "hazırlayabilirim / eklerim" diye sorma - '
    + 'doğrudan üret. write_paragraph gibi araçlarla paragrafa YAZMA; kullanıcı onaylayacak.';

  const log = document.querySelector(`.para-chat-log[data-number="${number}"]`);
  if (log) log.insertAdjacentHTML('beforeend', '<div class="para-chat-pending" style="color:var(--text-muted);font-size:12px;">düşünüyor…</div>');
  try {
    const result = await api.post('/ai/chat', {
      chapter_number: chapter.number,
      selected_entities: Array.from(document.querySelectorAll('.entity-check:checked')).map(cb => ({
        entity_type: cb.dataset.type, entity_id: parseInt(cb.dataset.id, 10),
      })),
      messages: [{ role: 'user', content: frame }, ...paraChatHistories[number]],
      text_scope: 'none',   // bölüm metni yerine paragraf + komşular yeter
    });
    // Model set_draft_result ile bir VERSİYON ürettiyse onu da kaydet:
    // eskiden yalnızca sohbet metni alınıyordu ve "Güncelledim" denip
    // üretilen taslak yolda kayboluyordu - kullanıcı metni hiç görmüyordu.
    const yorum = (result.reply || '').trim();
    if (yorum) paraChatHistories[number].push({ role: 'assistant', content: yorum, isVersion: false });
    const taslak = (result.draft_result || '').trim();
    if (taslak) paraChatHistories[number].push({ role: 'assistant', content: taslak, isVersion: true });
    renderParaChatLog(number);
  } catch (err) {
    document.querySelector('.para-chat-pending')?.remove();
    if (log) log.insertAdjacentHTML('beforeend', `<div class="error-text" style="font-size:12px;">${escapeHtml(err.message)}</div>`);
  }
}

// Sohbette varılan ortak karara göre YENİ VERSİYON üretir. Ayrı bir eylem
// olması bilinçli: önce anlaş, sonra yaz.
async function writeParagraphVersion(chapter, number, neighborBlock, originalText) {
  const history = paraChatHistories[number] || [];
  const base = currentParagraphBase(number, originalText);
  const konusma = history.map(m => `${m.role === 'user' ? 'Yazar' : 'AI'}: ${m.content}`).join('\n');
  const isTanimi = effectiveParaPurpose(number).text;
  const instruction =
    (isTanimi ? `BU PARAGRAFIN İŞİ (öncelikli ölçüt): ${isTanimi}\n` : '')
    + `P${number} paragrafının YENİ VERSİYONUNU yaz. Aşağıdaki konuşmada varılan kararları uygula.\n`
    + 'KURALLAR: Eylem sırasını bozma (tamamlanmış eylemi yeniden başlatma, zaman tek yönlü). '
    + 'Somut detayları koru. SADECE paragraf metnini döndür - açıklama, başlık, tırnak ekleme.\n'
    + (konusma ? `KONUŞMA:\n${konusma}\n` : '')
    + (neighborBlock || '');
  const log = document.querySelector(`.para-chat-log[data-number="${number}"]`);
  if (log) log.insertAdjacentHTML('beforeend', '<div class="para-chat-pending" style="color:var(--text-muted);font-size:12px;">yeni versiyon yazılıyor…</div>');
  try {
    const result = await api.post('/ai/assist', {
      chapter_number: chapter.number, instruction,
      selected_entities: Array.from(document.querySelectorAll('.entity-check:checked')).map(cb => ({
        entity_type: cb.dataset.type, entity_id: parseInt(cb.dataset.id, 10),
      })),
      existing_text: base,
    });
    paraChatHistories[number] = paraChatHistories[number] || [];
    paraChatHistories[number].push({ role: 'assistant', content: (result.generated_text || '').trim(), isVersion: true });
    renderParaChatLog(number);
  } catch (err) {
    document.querySelector('.para-chat-pending')?.remove();
    if (log) log.insertAdjacentHTML('beforeend', `<div class="error-text" style="font-size:12px;">${escapeHtml(err.message)}</div>`);
  }
}

// Üzerine çalışılacak temel metin: son ÜRETİLMİŞ versiyon varsa o, yoksa
// paragrafın kendisi (sohbet yorumları temel alınmaz).
function currentParagraphBase(number, originalText) {
  const history = paraChatHistories[number] || [];
  const lastVersion = [...history].reverse().find(m => m.role === 'assistant' && m.isVersion);
  return lastVersion ? lastVersion.content : originalText;
}

// ---------------------------------------------------------------------------
// SESLİ OKUMA (tarayıcının Web Speech API'si - ücretsiz, kurulum yok, metin
// sunucuya GİTMEZ). Amaç güzel seslendirme değil: kendi metnini DİNLEMEK,
// tekrarları ve ritim bozukluklarını kulakla yakalamak - üslup taramasının
// kulakla yapılan hâli. Paragraf paragraf okur, okunanı vurgular; ileride
// aynı arayüz sunucu tarafı bir modele bağlanabilir.
// ---------------------------------------------------------------------------
const ttsState = { playing: false, index: 0, paragraphs: [], voice: null };

function pickTurkishVoice() {
  const voices = window.speechSynthesis?.getVoices() || [];
  return voices.find(v => v.lang === 'tr-TR')
      || voices.find(v => (v.lang || '').toLowerCase().startsWith('tr'))
      || null;
}

// Yüzen kontrol çubuğu: ekranın sol üstünde SABİT durur, sayfa kaysa da
// kaybolmaz. Uzun bir bölüm dinlerken metni takip ederken bile duraklat/
// devam/atla erişilebilir olmalı.
function ensureTtsBar(chapter) {
  let bar = document.getElementById('ttsFloatingBar');
  if (bar) return bar;
  bar = document.createElement('div');
  bar.id = 'ttsFloatingBar';
  bar.style.cssText =
    'position:fixed;top:12px;left:76px;z-index:1200;display:flex;align-items:center;gap:6px;'
    + 'background:#fff;border:1px solid var(--border);border-radius:999px;'
    + 'box-shadow:0 3px 12px rgba(0,0,0,0.12);padding:5px 10px;font-size:12px;';
  bar.innerHTML = `
    <span style="font-size:14px;">🔊</span>
    <button class="btn btn-sm" id="ttsPauseBtn" title="Duraklat">⏸</button>
    <button class="btn btn-sm" id="ttsResumeBtn" style="display:none;" title="Devam et">▶</button>
    <button class="btn btn-sm" id="ttsPrevBtn" title="Önceki paragraf">⏮</button>
    <button class="btn btn-sm" id="ttsNextBtn" title="Sonraki paragraf">⏭</button>
    <select id="ttsRate" style="font-size:11.5px;max-width:96px;" title="Okuma hızı">
      <option value="0.85">Yavaş</option>
      <option value="1" selected>Normal</option>
      <option value="1.25">Hızlı</option>
      <option value="1.5">Çok hızlı</option>
    </select>
    <span id="ttsProgress" style="color:var(--text-muted);white-space:nowrap;"></span>
    <button class="btn btn-sm btn-danger" id="ttsStopBtn" title="Durdur ve kapat">✕</button>`;
  document.body.appendChild(bar);

  bar.querySelector('#ttsPauseBtn').addEventListener('click', () => {
    window.speechSynthesis.pause();
    bar.querySelector('#ttsPauseBtn').style.display = 'none';
    bar.querySelector('#ttsResumeBtn').style.display = '';
  });
  bar.querySelector('#ttsResumeBtn').addEventListener('click', () => {
    window.speechSynthesis.resume();
    bar.querySelector('#ttsResumeBtn').style.display = 'none';
    bar.querySelector('#ttsPauseBtn').style.display = '';
  });
  bar.querySelector('#ttsPrevBtn').addEventListener('click', () => {
    startChapterTts(chapter, Math.max(0, ttsState.index - 1));
  });
  bar.querySelector('#ttsNextBtn').addEventListener('click', () => {
    startChapterTts(chapter, Math.min(ttsState.paragraphs.length - 1, ttsState.index + 1));
  });
  bar.querySelector('#ttsRate').addEventListener('change', () => {
    if (ttsState.playing) startChapterTts(chapter, ttsState.index);   // hız anında uygulanır
  });
  bar.querySelector('#ttsStopBtn').addEventListener('click', stopChapterTts);
  return bar;
}

function startChapterTts(chapter, startIndex = 0) {
  if (!window.speechSynthesis) {
    alert('Tarayıcın sesli okumayı desteklemiyor. Chrome, Edge ya da Safari dene.');
    return;
  }
  window.speechSynthesis.cancel();
  ttsState.paragraphs = (chapter.paragraphs || []).slice().sort((a, b) => a.number - b.number)
    .filter(p => (p.text || '').trim());
  if (!ttsState.paragraphs.length) { alert('Okunacak metin yok.'); return; }

  ttsState.voice = pickTurkishVoice();
  if (!ttsState.voice) {
    // Sesler geç yüklenebiliyor - bir kez daha dene, yine yoksa uyar
    setTimeout(() => { ttsState.voice = pickTurkishVoice(); }, 300);
  }
  ttsState.playing = true;
  ttsState.index = Math.max(0, Math.min(startIndex, ttsState.paragraphs.length - 1));
  ensureTtsBar(chapter);
  const playBtn = document.getElementById('ttsPlayBtn');
  if (playBtn) playBtn.style.display = 'none';
  speakCurrentParagraph();
}

function speakCurrentParagraph() {
  if (!ttsState.playing) return;
  const p = ttsState.paragraphs[ttsState.index];
  if (!p) { stopChapterTts(); return; }

  highlightTtsParagraph(p.number);
  const prog = document.getElementById('ttsProgress');
  if (prog) prog.textContent = `P${p.number} · ${ttsState.index + 1}/${ttsState.paragraphs.length}`;
  const u = new SpeechSynthesisUtterance(p.text.trim());
  u.lang = 'tr-TR';
  if (ttsState.voice) u.voice = ttsState.voice;
  u.rate = parseFloat(document.getElementById('ttsRate')?.value || '1');
  u.onend = () => {
    if (!ttsState.playing) return;
    ttsState.index += 1;
    if (ttsState.index >= ttsState.paragraphs.length) { stopChapterTts(); return; }
    speakCurrentParagraph();
  };
  u.onerror = () => stopChapterTts();
  window.speechSynthesis.speak(u);
}

function highlightTtsParagraph(number) {
  document.querySelectorAll('.paragraph-text').forEach(el => {
    const isCurrent = String(el.dataset.number) === String(number);
    el.style.background = isCurrent ? 'var(--paper-dim)' : '';
    el.style.boxShadow = isCurrent ? '-3px 0 0 var(--gold)' : '';
    if (isCurrent) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

function stopChapterTts() {
  ttsState.playing = false;
  window.speechSynthesis?.cancel();
  document.querySelectorAll('.paragraph-text').forEach(el => {
    el.style.background = '';
    el.style.boxShadow = '';
  });
  document.getElementById('ttsFloatingBar')?.remove();
  const play = document.getElementById('ttsPlayBtn');
  if (play) play.style.display = '';
}

// Sesler tarayıcıda gecikmeli yüklenir - hazır olunca seçimi tazele
if (window.speechSynthesis) {
  window.speechSynthesis.onvoiceschanged = () => { ttsState.voice = pickTurkishVoice(); };
}
// Bölüm/görünüm değişince okuma sürmesin
window.addEventListener('beforeunload', () => window.speechSynthesis?.cancel());

// ---------------------------------------------------------------------------
// MATRİS KURULUMU: boyutu baştan ver, isimleri sonra yaz. Tek tek kolon/satır
// eklemek 9x10'luk bir yapıda 19 ayrı diyalog demekti - hem yorucu hem kafa
// karıştırıcı. Artık "9 kolon, 10 satır" deyip ızgarayı bir kerede kuruyorsun;
// başlıklar geçici adlarla ("Tur 1", "Aşama 1") gelir, üstlerine tıklayıp
// gerçek adlarını yazarsın.
// ---------------------------------------------------------------------------
// Modal kapsayıcısı yalnızca Roman görünümü çizilirken oluşturuluyordu;
// Plan Matrisi gibi başka ekranlarda yoktu ve pencereyi açan fonksiyonlar
// sessizce geri dönüyordu ("Yeni Matris" hiçbir şey yapmıyordu). Bu
// yardımcı, kapsayıcı yoksa oluşturur - her ekranda çalışır.
function ensureModalOverlay() {
  let overlay = document.getElementById('createItemModalOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'createItemModalOverlay';
    overlay.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(10,12,20,0.45);z-index:50;align-items:center;justify-content:center;';
    document.body.appendChild(overlay);
  }
  return overlay;
}

function openNewMatrixDialog() {
  const overlay = ensureModalOverlay();
  overlay.innerHTML = `
    <div class="panel" style="max-width:460px;width:92%;">
      <b>Yeni Plan Matrisi</b>
      <div class="field" style="margin-top:8px;"><label>Matris adı</label>
        <input type="text" id="nmName" placeholder="ör. Tur Yapısı" value="Tur Yapısı"></div>
      <div style="display:flex;gap:12px;">
        <div class="field" style="flex:1;"><label>Kolon sayısı <span style="font-weight:400;color:var(--text-muted);font-size:11px;">(kişi/tur)</span></label>
          <input type="number" id="nmCols" min="0" max="50" value="8"></div>
        <div class="field" style="flex:1;"><label>Satır sayısı <span style="font-weight:400;color:var(--text-muted);font-size:11px;">(aşama)</span></label>
          <input type="number" id="nmRows" min="0" max="50" value="7"></div>
      </div>
      <div style="display:flex;gap:12px;">
        <div class="field" style="flex:1;"><label>Kolon ön adı</label>
          <input type="text" id="nmColPrefix" value="Tur"></div>
        <div class="field" style="flex:1;"><label>Satır ön adı</label>
          <input type="text" id="nmRowPrefix" value="Aşama"></div>
      </div>
      <div style="font-size:11.5px;color:var(--text-muted);">
        Başlıklar geçici adlarla oluşur (ör. "Tur 1", "Aşama 1"); ızgarada
        üstlerine tıklayıp gerçek adlarını yazarsın. Sonradan ⊞ ile de ekleyebilirsin.
      </div>
      <div class="form-actions">
        <button class="btn btn-primary" id="nmCreate">Oluştur</button>
        <button class="btn" id="nmCancel">Vazgeç</button>
      </div>
      <div id="nmError" class="error-text"></div>
    </div>`;
  overlay.style.display = 'flex';
  const close = () => { overlay.style.display = 'none'; overlay.innerHTML = ''; };
  document.getElementById('nmCancel').addEventListener('click', close);
  document.getElementById('nmCreate').addEventListener('click', async () => {
    const name = document.getElementById('nmName').value.trim();
    if (!name) { document.getElementById('nmError').textContent = 'Matris adı gerekli.'; return; }
    const nCols = Math.max(0, Math.min(50, parseInt(document.getElementById('nmCols').value, 10) || 0));
    const nRows = Math.max(0, Math.min(50, parseInt(document.getElementById('nmRows').value, 10) || 0));
    const cp = document.getElementById('nmColPrefix').value.trim() || 'Kolon';
    const rp = document.getElementById('nmRowPrefix').value.trim() || 'Satır';
    try {
      const m = await api.post('/matrix/', {
        name,
        columns: Array.from({ length: nCols }, (_, i) => ({ label: `${cp} ${i + 1}` })),
        rows: Array.from({ length: nRows }, (_, i) => ({ label: `${rp} ${i + 1}` })),
      });
      currentMatrixId = m.id;
      close();
      await loadMatrixList();
      await loadMatrixGrid();
    } catch (err) { document.getElementById('nmError').textContent = err.message; }
  });
}

// Var olan matrise TOPLU kolon/satır ekleme (sona eklenir).
function openBulkAddDialog(m) {
  const editor = document.getElementById('matrixCellEditor');
  editor.innerHTML = `
    <div class="panel">
      <b>⊞ Toplu Ekle</b>
      <div style="display:flex;gap:12px;margin-top:8px;">
        <div class="field" style="flex:1;"><label>Kaç kolon eklensin?</label>
          <input type="number" id="baCols" min="0" max="50" value="0"></div>
        <div class="field" style="flex:1;"><label>Kaç satır eklensin?</label>
          <input type="number" id="baRows" min="0" max="50" value="0"></div>
      </div>
      <div style="display:flex;gap:12px;">
        <div class="field" style="flex:1;"><label>Kolon ön adı</label><input type="text" id="baColPrefix" value="Tur"></div>
        <div class="field" style="flex:1;"><label>Satır ön adı</label><input type="text" id="baRowPrefix" value="Aşama"></div>
      </div>
      <div style="font-size:11.5px;color:var(--text-muted);">Numaralandırma mevcut sayının ardından devam eder.</div>
      <div class="form-actions">
        <button class="btn btn-primary" id="baApply">Ekle</button>
        <button class="btn" id="baCancel">Kapat</button>
      </div>
      <div id="baError" class="error-text"></div>
    </div>`;
  editor.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  document.getElementById('baCancel').addEventListener('click', () => { editor.innerHTML = ''; });
  document.getElementById('baApply').addEventListener('click', async () => {
    const nCols = Math.max(0, Math.min(50, parseInt(document.getElementById('baCols').value, 10) || 0));
    const nRows = Math.max(0, Math.min(50, parseInt(document.getElementById('baRows').value, 10) || 0));
    if (!nCols && !nRows) { document.getElementById('baError').textContent = 'En az bir sayı gir.'; return; }
    const cp = document.getElementById('baColPrefix').value.trim() || 'Kolon';
    const rp = document.getElementById('baRowPrefix').value.trim() || 'Satır';
    const btn = document.getElementById('baApply');
    btn.disabled = true; btn.textContent = 'Ekleniyor…';
    try {
      const baseCols = m.columns.length, baseRows = m.rows.length;
      for (let i = 0; i < nCols; i++) {
        await api.post(`/matrix/${m.id}/columns`, { label: `${cp} ${baseCols + i + 1}` });
      }
      for (let i = 0; i < nRows; i++) {
        await api.post(`/matrix/${m.id}/rows`, { label: `${rp} ${baseRows + i + 1}` });
      }
      document.getElementById('matrixCellEditor').innerHTML = '';
      await loadMatrixGrid();
    } catch (err) {
      document.getElementById('baError').textContent = err.message;
      btn.disabled = false; btn.textContent = 'Ekle';
    }
  });
}

// ---------------------------------------------------------------------------
// GRUPLAR & KURUMLAR (faksiyonlar): "şu 15 kişi aynı yapıya bağlı" bilgisi.
// İkili ilişkiler bunu taşıyamaz (15 kişi = 105 ayrı bağ) ve karakterlerin
// kendi 'iliskiler' kutusuna dağıldığında grup TERS SORGULANAMAZ ("LÜMEN'e
// kimler bağlı?"). Bu ekran grubu tek yerde tutar ve üyeleri ROLLERİYLE
// listeler; bilgi AI bağlamına da girer.
// ---------------------------------------------------------------------------
async function renderFactionView() {
  main().innerHTML = `
    <h1 class="view-title">Gruplar & Kurumlar</h1>
    <p style="color:var(--text-muted);font-size:13.5px;max-width:680px;">
      Bir kuruma, aileye, ekibe ya da gizli yapılanmaya bağlı karakterleri tek yerde
      topla (LÜMEN yönetimi, sekiz sanık kurulu, hacker ekibi...). Üyeleri rolleriyle
      eklersin; seçili bir karakter sahnedeyken bağlı olduğu gruplar AI'ya gider.
    </p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0;">
      <button class="btn btn-primary" id="newFactionBtn">+ Yeni Grup</button>
    </div>
    <div id="formContainer"></div>
    <div id="factionList"></div>`;
  document.getElementById('newFactionBtn').addEventListener('click', () => showEntityForm('faction', null));
  await loadFactionList();
}

async function loadFactionList() {
  const listEl = document.getElementById('factionList');
  if (!listEl) return;
  try {
    const [factions, memberships, characters] = await Promise.all([
      api.get('/factions/'), api.get('/faction-memberships/'), api.get('/characters/'),
    ]);
    if (!factions.length) {
      listEl.innerHTML = '<div class="empty-state">Henüz grup yok. LÜMEN, sanıklar kurulu, hacker ekibi gibi yapıları buradan ekleyebilirsin.</div>';
      return;
    }
    listEl.innerHTML = factions.map(f => {
      const uyeler = memberships.filter(m => m.faction_id === f.id);
      return `
        <div class="entity-row" style="flex-wrap:wrap;">
          <div style="flex:1;min-width:220px;">
            <div class="name">${escapeHtml(f.name)} <span style="font-weight:400;color:var(--text-muted);font-size:12px;">${uyeler.length} üye</span></div>
            <div class="desc">${escapeHtml(truncate(f.description, 120))}</div>
            <div style="margin-top:4px;">
              ${uyeler.map(m => `<span class="mention-chip" title="${escapeHtml(m.role || 'rol belirtilmemiş')}">${escapeHtml(m.character_name)}${m.role ? ' · ' + escapeHtml(m.role) : ''}
                <span class="mem-del" data-id="${m.id}" style="cursor:pointer;opacity:0.6;" title="Üyeliği kaldır">✕</span></span>`).join('')
                || '<span style="font-size:12px;color:var(--text-muted);">Henüz üye yok</span>'}
            </div>
          </div>
          <div class="actions">
            <button class="btn btn-sm add-member-btn" data-id="${f.id}">+ Üye ekle</button>
            <button class="btn btn-sm edit-faction-btn" data-id="${f.id}">Düzenle</button>
            <button class="btn btn-sm btn-danger del-faction-btn" data-id="${f.id}">Sil</button>
          </div>
          <div class="member-form" data-id="${f.id}" style="display:none;width:100%;margin-top:8px;padding-top:8px;border-top:1px dashed var(--border);"></div>
        </div>`;
    }).join('');

    listEl.querySelectorAll('.add-member-btn').forEach(btn => btn.addEventListener('click', () => {
      const fid = parseInt(btn.dataset.id, 10);
      const box = listEl.querySelector(`.member-form[data-id="${fid}"]`);
      const mevcut = memberships.filter(m => m.faction_id === fid).map(m => m.character_id);
      const secilebilir = characters.filter(c => !mevcut.includes(c.id));
      if (!secilebilir.length) { box.innerHTML = '<div style="font-size:12.5px;color:var(--text-muted);">Tüm kişiler zaten üye.</div>'; box.style.display = ''; return; }
      box.style.display = '';
      box.innerHTML = `
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;">
          <div class="field" style="flex:1;min-width:160px;margin:0;"><label>Kişi</label>
            <select class="mem-char">${secilebilir.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')}</select></div>
          <div class="field" style="flex:1;min-width:160px;margin:0;"><label>Rol <span style="font-weight:400;color:var(--text-muted);font-size:11px;">(Lider, Muhafız, Sanık...)</span></label>
            <input type="text" class="mem-role" placeholder="ör. Baş Tabip"></div>
          <button class="btn btn-sm btn-primary mem-save" data-id="${fid}">Ekle</button>
        </div>`;
      box.querySelector('.mem-save').addEventListener('click', async () => {
        try {
          await api.post('/faction-memberships/', {
            faction_id: fid,
            character_id: parseInt(box.querySelector('.mem-char').value, 10),
            role: box.querySelector('.mem-role').value.trim(),
          });
          await loadFactionList();
        } catch (err) { alert(err.message); }
      });
    }));
    listEl.querySelectorAll('.mem-del').forEach(el => el.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Bu üyelik kaldırılsın mı? (Karakter silinmez)')) return;
      try { await api.del(`/faction-memberships/${el.dataset.id}`); await loadFactionList(); }
      catch (err) { alert(err.message); }
    }));
    listEl.querySelectorAll('.edit-faction-btn').forEach(btn => btn.addEventListener('click', () => {
      const f = factions.find(x => x.id === parseInt(btn.dataset.id, 10));
      showEntityForm('faction', f);
    }));
    listEl.querySelectorAll('.del-faction-btn').forEach(btn => btn.addEventListener('click', async () => {
      if (!confirm('Grup silinsin mi? (Üyelikler de silinir, karakterler kalır)')) return;
      try { await api.del(`/factions/${btn.dataset.id}`); await loadFactionList(); }
      catch (err) { alert(err.message); }
    }));
  } catch (err) {
    listEl.innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`;
  }
}

// ---------------------------------------------------------------------------
// İSİM VURGULAMA: metinde tanımlı kişi/mekan/nesne isimlerinin altını çizer
// ve tıklanabilir yapar. NEDEN AÇ/KAPA: paragraf metni contenteditable;
// içine <span> gömmek yazarken metni bozar (kaydederken etiketler metne
// karışabilir). Bu yüzden vurgu modunda paragraflar OKUMA moduna alınır,
// mod kapanınca ham metin geri yüklenip düzenleme açılır - metin asla
// HTML'den yeniden üretilmez, orijinali saklanır.
// ---------------------------------------------------------------------------
let nameHighlightOn = false;

function openEntityFromMention(type, id) {
  const cfg = ENTITY_TYPES[type];
  if (!cfg) return;
  // İlgili menüye geç ve kaydı düzenlemeye aç
  switchView(type === 'character' ? 'character' : type);
  setTimeout(async () => {
    try {
      const items = await api.get(cfg.endpoint);
      const item = items.find(x => x.id === id);
      if (item) showEntityForm(type, item);
    } catch (e) { /* menü zaten açıldı, sessiz geç */ }
  }, 250);
}

function toggleNameHighlight(chapter) {
  const btn = document.getElementById('highlightNamesBtn');
  nameHighlightOn = !nameHighlightOn;
  const paras = document.querySelectorAll('.paragraph-text');

  if (!nameHighlightOn) {
    // Ham metni geri yükle - HTML'den değil, sakladığımız orijinalden
    paras.forEach(el => {
      if (el.dataset.raw !== undefined) el.textContent = el.dataset.raw;
      el.setAttribute('contenteditable', 'true');
      el.style.background = '';
    });
    btn.textContent = '🔎 İsimleri Vurgula';
    btn.classList.remove('btn-primary');
    return;
  }

  // Vurgu modu: okuma moduna al, isimleri işaretle
  const mentionsByNumber = {};
  (chapter.paragraphs || []).forEach(p => { mentionsByNumber[p.number] = p.mentions || []; });

  paras.forEach(el => {
    const raw = el.innerText;
    el.dataset.raw = raw;                       // ham metin korunur
    el.setAttribute('contenteditable', 'false');
    const mentions = mentionsByNumber[el.dataset.number] || [];
    if (!mentions.length) { el.textContent = raw; return; }

    // Uzun isimler önce eşleşsin ("Şahin Göz" > "Şahin")
    const uniq = [...new Map(mentions.map(m => [`${m.entity_type}:${m.entity_id}:${m.entity_name}`, m])).values()]
      .sort((a, b) => b.entity_name.length - a.entity_name.length);
    let html = escapeHtml(raw);
    uniq.forEach(m => {
      const safe = escapeHtml(m.entity_name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Zaten işaretlenmiş bölgeleri tekrar sarmamak için negatif kontrol
      const re = new RegExp(`(?![^<]*>)(${safe})`, 'g');
      html = html.replace(re, `<span class="name-mark" data-type="${m.entity_type}" data-id="${m.entity_id}" style="border-bottom:1.5px dotted var(--gold);cursor:pointer;" title="${escapeHtml(m.entity_name)} kaydına git">$1</span>`);
    });
    el.innerHTML = html;
    el.style.background = 'rgba(176,141,63,0.04)';
  });

  document.querySelectorAll('.name-mark').forEach(el => el.addEventListener('click', (e) => {
    e.stopPropagation();
    openEntityFromMention(el.dataset.type, parseInt(el.dataset.id, 10));
  }));
  btn.textContent = '✓ Vurgu açık (kapat)';
  btn.classList.add('btn-primary');
}

// ---------------------------------------------------------------------------
// EDEBÎ DEĞERLENDİRME: 10 ölçüt üzerinden bölüm karnesi. Puan tek başına
// amaç değil - asıl çıktı EN ZAYIF başlıklara verilen somut düzeltmeler.
// Okur Testi'nden farkı: o "okur nerede düşer", bu "edebî olarak nerede
// zayıf" diye sorar.
// ---------------------------------------------------------------------------
async function runLiteraryReview(chapter) {
  const box = document.getElementById('readerTestResult');
  if (!(chapter.paragraphs || []).length) { box.innerHTML = '<div class="empty-state">Önce metin gerek.</div>'; return; }
  box.innerHTML = '<div class="empty-state">Editör gözüyle 10 ölçüt değerlendiriliyor…</div>';
  try {
    const r = await api.post(`/ai/literary-review/${chapter.id}`, {});
    if (!r.scores.length) { box.innerHTML = '<div class="error-text">Değerlendirme üretilemedi.</div>'; return; }
    const renk = (p) => p <= 2 ? 'var(--danger)' : (p === 3 ? '#b08d3f' : '#3f7a4f');
    const bar = (p) => '●'.repeat(p) + '○'.repeat(5 - p);
    box.innerHTML = `
      <div class="panel" style="margin-top:8px;">
        <div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;">
          <strong style="font-size:11px;color:var(--text-muted);letter-spacing:0.4px;">📊 EDEBÎ DEĞERLENDİRME - metne dokunulmadı</strong>
          <span style="font-size:12.5px;color:var(--text-muted);">ortalama <b style="color:${renk(Math.round(r.average))}">${r.average}</b>/5</span>
        </div>
        ${r.strongest ? `<div style="font-size:12.5px;margin:6px 0;padding:6px 8px;background:var(--paper-dim);border-radius:6px;">💪 <b>En güçlü yön:</b> ${escapeHtml(r.strongest)}</div>` : ''}
        <div style="margin-top:6px;">
          ${r.scores.slice().sort((a, b) => a.score - b.score).map(s => `
            <div style="display:flex;gap:8px;align-items:baseline;font-size:12.5px;padding:3px 0;border-bottom:1px solid var(--border);">
              <span style="color:${renk(s.score)};letter-spacing:1px;font-size:11px;">${bar(s.score)}</span>
              <b style="min-width:150px;">${escapeHtml(s.label)}</b>
              <span style="color:var(--text-muted);flex:1;">${escapeHtml(s.reason)}</span>
            </div>`).join('')}
        </div>
        ${r.fixes.length ? `
          <div style="margin-top:10px;">
            <strong style="font-size:11px;color:var(--text-muted);letter-spacing:0.4px;">ÖNCELİKLİ DÜZELTMELER</strong>
            ${r.fixes.map(f => `
              <div style="border-left:3px solid var(--gold);padding-left:10px;margin-top:8px;font-size:12.5px;">
                <b>${escapeHtml(f.criterion)}</b>${f.paragraph ? ` · <a href="#" class="lr-goto" data-num="${f.paragraph}" style="color:inherit;">P${f.paragraph}</a>` : ''}
                <div style="color:var(--text-muted);margin-top:2px;">${escapeHtml(f.problem)}</div>
                <div style="margin-top:2px;">→ ${escapeHtml(f.fix)}</div>
                ${f.paragraph ? `<button class="btn btn-sm rt-fix" data-num="${f.paragraph}" data-issue="${escapeHtml(f.criterion + ': ' + f.problem + ' ' + f.fix)}" style="margin-top:5px;font-size:11.5px;">✨ Bu öneriye göre düzelt</button>` : ''}
                <div class="rt-fix-result" data-num="${f.paragraph || 0}"></div>
              </div>`).join('')}
          </div>` : ''}
      </div>`;
    box.querySelectorAll('.rt-fix').forEach(btn => btn.addEventListener('click', () =>
      runInlineFix(chapter, parseInt(btn.dataset.num, 10), btn.dataset.issue, btn)));
    box.querySelectorAll('.lr-goto').forEach(a => a.addEventListener('click', (e) => {
      e.preventDefault();
      const el = document.querySelector(`.paragraph-text[data-number="${a.dataset.num}"]`);
      if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.focus(); }
    }));
  } catch (err) {
    box.innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`;
  }
}

// ---------------------------------------------------------------------------
// UYARIDAN DOĞRUDAN DÜZELTME: Okur Testi ya da Edebî Değerlendirme bir
// sorun gösterdiğinde, o uyarıyı TALİMAT olarak kullanıp yeni bir paragraf
// versiyonu üretir - kullanıcı metne inip paragrafı bulup ayrıca öneri
// istemek zorunda kalmasın. Sonuç uyarının hemen altında çıkar; onaylanırsa
// paragraf değişir (eski hal Geçmiş'te).
// ---------------------------------------------------------------------------
async function runInlineFix(chapter, paragraphNumber, issue, btn) {
  const box = document.querySelector(`.rt-fix-result[data-num="${paragraphNumber}"]`);
  if (!box) return;
  const paras = (chapter.paragraphs || []).slice().sort((a, b) => a.number - b.number);
  const idx = paras.findIndex(p => p.number === paragraphNumber);
  if (idx < 0) { box.innerHTML = '<div class="error-text">Paragraf bulunamadı.</div>'; return; }
  const hedef = paras[idx];

  // Komşular: düzeltme akışı ve tekrarları bozmasın
  const clip = (t) => { const v = (t || '').trim(); return v.length > 400 ? v.slice(0, 400) + '…' : v; };
  const once = paras.slice(Math.max(0, idx - 2), idx).map(p => `[P${p.number}] ${clip(p.text)}`).join('\n');
  const sonra = paras.slice(idx + 1, idx + 3).map(p => `[P${p.number}] ${clip(p.text)}`).join('\n');

  btn.disabled = true;
  box.innerHTML = '<div style="font-size:12px;color:var(--text-muted);margin-top:4px;">Düzeltilmiş versiyon yazılıyor…</div>';
  const selected = Array.from(document.querySelectorAll('.entity-check:checked')).map(cb => ({
    entity_type: cb.dataset.type, entity_id: parseInt(cb.dataset.id, 10),
  }));
  const isBilgi = effectiveParaPurpose(paragraphNumber).text;
  // ÜÇ SEÇENEK: tek atış çoğu zaman yetersiz kalıyordu ve kullanıcı ya
  // beğenmeden uyguluyor ya da sohbete geçmek zorunda kalıyordu. Üç farklı
  // yaklaşım üretilir; beğenilen uygulanır, hiçbiri tutmazsa sohbet zaten
  // yanında. Ayrıca BETİMLEME MATEMATİĞİ talimata gömüldü.
  const instruction =
    (isBilgi ? `BU PARAGRAFIN İŞİ (öncelikli ölçüt): ${isBilgi}\n` : '')
    + `P${paragraphNumber} paragrafını, aşağıdaki EDİTÖR UYARISINI giderecek şekilde yeniden yaz.\n`
    + `UYARI: ${issue}\n`
    + 'KURALLAR: Sadece bu uyarıyı gider, sahnenin anlamını ve olay akışını DEĞİŞTİRME. '
    + 'Eylem sırasını bozma (tamamlanmış eylemi yeniden başlatma). Somut detayları (rakam, '
    + 'ölçü, özel isim) koru. Komşu paragraflarda geçen imge ve kalıpları tekrarlama.\n'
    + 'BETİMLEME MATEMATİĞİ (betimleme ağırlıklı paragraflarda uygula): '
    + '1) geniş plan - tek cümle, EN FAZLA iki nitelik (sıfat yığma), '
    + '2) orta plan - insan/hareket, 3) MİKRO DETAY - anlamı taşıyan tek somut şey, '
    + '4) bir duyu (görme dışında: ses, koku, doku, sıcaklık), '
    + '5) ANLAMI SÖYLEME - mikro detayda sakla. '
    + 'BÜTÇE: en fazla BİR benzetme; "sanki/gibi/adeta" ile açıklama yok; '
    + 'yargı sıfatı yok ("huzurlu", "sıradan", "unutulmuş", "kasvetli" gibi).\n'
    + 'ÜÇ FARKLI SEÇENEK üret - aynı fikrin üç varyasyonu DEĞİL, üç ayrı yaklaşım '
    + '(ör. biri mikro detaya, biri sese/sessizliğe, biri harekete yaslansın).\n'
    + 'Yanıtın SADECE şu JSON olsun, başka hiçbir şey yazma:\n'
    + '{"options": [{"text": "...", "approach": "hangi yaklaşım - 4 kelime"}]}\n'
    + (once ? `ÖNCEKİ:\n${once}\n` : '') + (sonra ? `SONRAKİ:\n${sonra}\n` : '');
  try {
    const result = await api.post('/ai/assist', {
      chapter_number: chapter.number, instruction,
      selected_entities: selected, existing_text: hedef.text,
    });
    // Yanıt JSON ise üç seçenek, değilse tek metin (geriye dönük uyumlu)
    let secenekler = [];
    const ham = (result.generated_text || '').trim();
    try {
      const temiz = ham.replace(/^```(?:json)?|```$/gm, '').trim();
      const veri = JSON.parse(temiz.slice(temiz.indexOf('{'), temiz.lastIndexOf('}') + 1));
      secenekler = (veri.options || []).filter(o => (o.text || '').trim())
        .map(o => ({ text: o.text.trim(), approach: (o.approach || '').trim() }));
    } catch (e) { /* düz metin gelmiş */ }
    if (!secenekler.length) secenekler = [{ text: ham, approach: '' }];

    // Değişiklik YOK koruması: model metni aynen döndürdüyse söyle
    const aynilar = secenekler.filter(o => o.text.replace(/\s+/g, ' ').trim() === (hedef.text || '').replace(/\s+/g, ' ').trim());
    box.innerHTML = `
      <div class="panel" style="margin-top:6px;border-left:3px solid var(--gold);">
        <strong style="font-size:10.5px;color:var(--text-muted);letter-spacing:0.4px;">
          ${secenekler.length > 1 ? `${secenekler.length} SEÇENEK - onaysız değişmez` : 'DÜZELTİLMİŞ VERSİYON - onaysız değişmez'}
        </strong>
        ${aynilar.length ? `<div style="font-size:12px;color:var(--danger);margin-top:4px;">⚠ ${aynilar.length} seçenek orijinalle AYNI geldi - AI değişiklik önermemiş. "AI ile konuşarak karar ver" ile yönlendirmeyi dene.</div>` : ''}
        ${secenekler.map((o, i) => `
          <div class="fix-option" data-idx="${i}" style="border-top:1px solid var(--border);padding-top:6px;margin-top:6px;">
            <div style="font-size:10.5px;color:var(--gold);font-weight:600;">SEÇENEK ${i + 1}${o.approach ? ' · ' + escapeHtml(o.approach) : ''}</div>
            <div style="white-space:pre-wrap;font-size:12.5px;margin-top:3px;">${escapeHtml(o.text)}</div>
            <div class="form-actions" style="margin-top:4px;">
              <button class="btn btn-sm btn-primary inline-fix-apply" data-idx="${i}" style="font-size:11.5px;">Bunu uygula</button>
            </div>
          </div>`).join('')}
        <div style="margin-top:8px;">
          <button class="btn btn-sm inline-fix-close" style="font-size:11.5px;">Kapat</button>
        </div>
      </div>`;
    box.querySelector('.inline-fix-close').addEventListener('click', () => { box.innerHTML = ''; btn.disabled = false; });
    box.querySelectorAll('.inline-fix-apply').forEach(ab => ab.addEventListener('click', (e) => {
      const secilen = secenekler[parseInt(e.target.dataset.idx, 10)].text;
      e.target.closest('.form-actions').insertAdjacentElement('afterend', renderQuickCheck(
        hedef.text, secilen,
        async () => {
          await replaceParagraphText(chapter.id, paragraphNumber, secilen);
          markParagraphResolved(paragraphNumber);
        },
        () => verifyBeforeApply(chapter.id, paragraphNumber, hedef.text, secilen),
        async (uyarilar) => {
          // Kontrol uyarılarını mevcut bulgulara EKLE ve yeniden üret
          const ek = ' AYRICA şu kontrol uyarılarını da gider: ' + uyarilar.join(' | ');
          await runInlineFix(chapter, paragraphNumber, issue + ek, btn);
        },
      ));
    }));
  } catch (err) {
    box.innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`;
    btn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// BÖLÜM İNCELEMESİ: iki aşamalı, birleşik denetim.
//   1) EDİTÖR gözü (10 edebî ölçüt) - "edebî olarak nerede zayıf"
//   2) OKUR gözü (tempo, bilgi bocası, klişe...) - "okur nerede düşer"
// Sonra bulgular PARAGRAF PARAGRAF birleştirilir: bir paragraf hakkında iki
// farklı bakış aynı satırda görünür. Her paragraf için iki eylem: uyarılara
// göre doğrudan düzeltme, ya da AI ile konuşarak birlikte karar verme.
// Ayrı ayrı çalıştırıp iki listeyi kafada birleştirmek zorunda kalmıyorsun.
// ---------------------------------------------------------------------------
async function runChapterReview(chapter) {
  const box = document.getElementById('readerTestResult');
  if (!(chapter.paragraphs || []).length) { box.innerHTML = '<div class="empty-state">Önce metin gerek.</div>'; return; }
  const btn = document.getElementById('chapterReviewBtn');
  btn.disabled = true;

  box.innerHTML = '<div class="empty-state">1/2 · Editör gözüyle 10 ölçüt değerlendiriliyor…</div>';
  let literary = null, reader = null;
  try {
    literary = await api.post(`/ai/literary-review/${chapter.id}`, {});
    box.innerHTML = '<div class="empty-state">2/2 · Okur gözüyle taranıyor…</div>';
    reader = await api.post(`/ai/reader-test/${chapter.id}`, {});
  } catch (err) {
    box.innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`;
    btn.disabled = false;
    return;
  }
  btn.disabled = false;

  // Bulguları paragraf numarasına göre birleştir
  const byPara = {};
  const genel = [];
  (literary.fixes || []).forEach(f => {
    const kayit = { kaynak: 'editor', baslik: f.criterion || 'Edebî', sorun: f.problem, oneri: f.fix };
    if (f.paragraph) (byPara[f.paragraph] = byPara[f.paragraph] || []).push(kayit);
    else genel.push(kayit);
  });
  (reader.findings || []).forEach(f => {
    const kayit = {
      kaynak: 'okur',
      baslik: (READER_TEST_TYPE_LABELS[f.type] || f.type) + (f.severity ? ` · ${f.severity}` : ''),
      sorun: f.reason, oneri: f.suggestion, alinti: f.quote,
    };
    if (f.paragraph_number) (byPara[f.paragraph_number] = byPara[f.paragraph_number] || []).push(kayit);
    else genel.push(kayit);
  });

  const renk = (p) => p <= 2 ? 'var(--danger)' : (p === 3 ? '#b08d3f' : '#3f7a4f');
  const bar = (p) => '●'.repeat(p) + '○'.repeat(5 - p);
  const zayif = (literary.scores || []).slice().sort((a, b) => a.score - b.score);
  const paraNumaralari = Object.keys(byPara).map(Number).sort((a, b) => a - b);

  box.innerHTML = `
    <div class="panel" style="margin-top:8px;">
      <div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;">
        <strong style="font-size:11px;color:var(--text-muted);letter-spacing:0.4px;">🔍 BÖLÜM İNCELEMESİ - metne dokunulmadı</strong>
        <span style="font-size:12.5px;color:var(--text-muted);">edebî ortalama <b style="color:${renk(Math.round(literary.average))}">${literary.average}</b>/5 · ${paraNumaralari.length} paragrafta bulgu</span>
      </div>
      <div style="font-size:11.5px;color:var(--text-muted);margin-top:2px;">
        Kapsama: ${literary.total || 0} paragrafın <b>${literary.scanned || 0}</b>'i tarandı${literary.chunks > 1 ? ` (${literary.chunks} parça hâlinde)` : ''}.
        Bulgu çıkmayan paragraflar "sorunsuz" değil, sadece <b>işaretlenmemiş</b> demektir.
      </div>
      ${literary.strongest ? `<div style="font-size:12.5px;margin:6px 0;padding:6px 8px;background:var(--paper-dim);border-radius:6px;">💪 <b>En güçlü yön:</b> ${escapeHtml(literary.strongest)}</div>` : ''}

      <details style="margin-top:6px;">
        <summary style="cursor:pointer;font-size:11.5px;color:var(--text-muted);">📊 Edebî karne (10 ölçüt) - aç/kapa</summary>
        <div style="margin-top:4px;">
          ${zayif.map(sc => `
            <div style="display:flex;gap:8px;align-items:baseline;font-size:12.5px;padding:2px 0;">
              <span style="color:${renk(sc.score)};letter-spacing:1px;font-size:11px;">${bar(sc.score)}</span>
              <b style="min-width:150px;">${escapeHtml(sc.label)}</b>
              <span style="color:var(--text-muted);flex:1;">${escapeHtml(sc.reason)}</span>
            </div>`).join('')}
        </div>
      </details>

      <div style="margin-top:10px;">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;">
          <strong style="font-size:11px;color:var(--text-muted);letter-spacing:0.4px;">PARAGRAF PARAGRAF BULGULAR</strong>
          ${paraNumaralari.length > 1 ? `<div style="display:flex;gap:4px;align-items:center;">
            <button class="btn btn-sm" id="findingPrev" title="Önceki bulgu (Alt+←)" style="font-size:11px;padding:2px 8px;">◀</button>
            <span id="findingCounter" style="font-size:11.5px;color:var(--text-muted);">1/${paraNumaralari.length}</span>
            <button class="btn btn-sm" id="findingNext" title="Sonraki bulgu (Alt+→)" style="font-size:11px;padding:2px 8px;">▶</button>
          </div>` : ''}
        </div>
        ${paraNumaralari.length ? paraNumaralari.map(num => {
          const kayitlar = byPara[num];
          const issue = kayitlar.map(k => `${k.baslik}: ${k.sorun} ${k.oneri || ''}`).join(' | ');
          return `
          <div class="finding-card" data-num="${num}" data-resolved="${resolvedParas.has(String(num)) ? '1' : '0'}"
               style="border-left:3px solid ${resolvedParas.has(String(num)) ? '#3f7a4f' : 'var(--gold)'};padding-left:10px;margin-top:10px;opacity:${resolvedParas.has(String(num)) ? '0.5' : '1'};">
            <div style="font-size:12.5px;"><a href="#" class="rt-goto" data-num="${num}" style="color:inherit;"><b>P${num}</b></a>
              <span style="color:var(--text-muted);">· ${kayitlar.length} bulgu</span>
              <span class="finding-status">${resolvedParas.has(String(num)) ? '<span style="color:#3f7a4f;font-weight:600;">✓ düzeltildi</span>' : ''}</span></div>
            ${kayitlar.map(k => `
              <div style="font-size:12.5px;margin-top:4px;">
                <span title="${k.kaynak === 'editor' ? 'Editör gözü (edebî ölçüt)' : 'Okur gözü'}">${k.kaynak === 'editor' ? '📊' : '🎯'}</span>
                <b>${escapeHtml(k.baslik)}</b>
                ${k.alinti ? `<span style="font-style:italic;color:var(--text-muted);">"${escapeHtml(k.alinti)}"</span>` : ''}
                <div style="color:var(--text-muted);">${escapeHtml(k.sorun || '')}</div>
                ${k.oneri ? `<div>→ ${escapeHtml(k.oneri)}</div>` : ''}
              </div>`).join('')}
            <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap;">
              ${resolvedParas.has(String(num)) ? '' : `
                <button class="btn btn-sm rt-fix" data-num="${num}" data-issue="${escapeHtml(issue)}" style="font-size:11.5px;">✨ Bulgulara göre düzelt</button>
                <button class="btn btn-sm review-chat" data-num="${num}" data-issue="${escapeHtml(issue)}" style="font-size:11.5px;">💬 AI ile konuşarak karar ver</button>`}
            </div>
            <div class="rt-fix-result" data-num="${num}"></div>
            <div class="review-chat-box" data-num="${num}"></div>
          </div>`;
        }).join('') : '<div style="font-size:12.5px;color:var(--text-muted);margin-top:6px;">Paragraf düzeyinde bulgu yok.</div>'}
      </div>

      ${genel.length ? `
        <div style="margin-top:10px;">
          <strong style="font-size:11px;color:var(--text-muted);letter-spacing:0.4px;">GENEL BULGULAR (paragrafa bağlanamayan)</strong>
          ${genel.map(k => `<div style="font-size:12.5px;margin-top:4px;">${k.kaynak === 'editor' ? '📊' : '🎯'} <b>${escapeHtml(k.baslik)}</b>
            <div style="color:var(--text-muted);">${escapeHtml(k.sorun || '')}</div>${k.oneri ? `<div>→ ${escapeHtml(k.oneri)}</div>` : ''}</div>`).join('')}
        </div>` : ''}
    </div>`;

  // BULGULAR ARASI GEZİNME: 100 paragraflık bölümde 12 bulgu arasında elle
  // kaydırmak yerine ileri/geri. Alt+ok tuşlarıyla da çalışır.
  let bulguIdx = -1;
  const bulguyaGit = (yon) => {
    if (!paraNumaralari.length) return;
    // ÇÖZÜLMÜŞ bulguları ATLA: düzeltip kaydettiğin paragraf tekrar
    // karşına çıkmasın. Hepsi çözülmüşse haber ver ve dur.
    let deneme = 0;
    do {
      bulguIdx = (bulguIdx + yon + paraNumaralari.length) % paraNumaralari.length;
      deneme += 1;
    } while (resolvedParas.has(String(paraNumaralari[bulguIdx])) && deneme <= paraNumaralari.length);
    if (deneme > paraNumaralari.length) {
      const sayac = document.getElementById('findingCounter');
      if (sayac) sayac.innerHTML = '<span style="color:#3f7a4f;">tümü ✓</span>';
      return;
    }
    const num = paraNumaralari[bulguIdx];
    const kalan = paraNumaralari.filter(n => !resolvedParas.has(String(n))).length;
    const sayac = document.getElementById('findingCounter');
    if (sayac) sayac.textContent = `${bulguIdx + 1}/${paraNumaralari.length} · ${kalan} kaldı`;
    const hedefBulgu = box.querySelector(`.rt-fix[data-num="${num}"]`);
    if (hedefBulgu) hedefBulgu.closest('div[style*="border-left"]').scrollIntoView({ behavior: 'smooth', block: 'center' });
    const paraEl = document.querySelector(`.paragraph-text[data-number="${num}"]`);
    if (paraEl) {
      paraEl.style.background = 'var(--paper-dim)';
      setTimeout(() => { paraEl.style.background = ''; }, 1800);
    }
  };
  window.__gotoNextFinding = () => bulguyaGit(1);   // kaydettikten sonra otomatik ilerleme
  // Açılışta ilk ÇÖZÜLMEMİŞ bulguya konumlan, sayaç doğru başlasın
  const kalanIlk = paraNumaralari.findIndex(n => !resolvedParas.has(String(n)));
  if (kalanIlk >= 0) {
    bulguIdx = kalanIlk - 1;
    const s0 = document.getElementById('findingCounter');
    if (s0) s0.textContent = `${kalanIlk + 1}/${paraNumaralari.length} · ${paraNumaralari.filter(n => !resolvedParas.has(String(n))).length} kaldı`;
  }
  document.getElementById('findingNext')?.addEventListener('click', () => bulguyaGit(1));
  document.getElementById('findingPrev')?.addEventListener('click', () => bulguyaGit(-1));
  if (!window.__findingNavBound) {
    window.__findingNavBound = true;
    document.addEventListener('keydown', (e) => {
      if (!e.altKey) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); document.getElementById('findingNext')?.click(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); document.getElementById('findingPrev')?.click(); }
    });
  }

  // Kullanıcı hangi karta dokunduysa gezinme imleci ORAYA taşınır - yoksa
  // 15. paragrafı düzeltip kaydettiğinde sıradaki olarak 3. paragrafı
  // öneriyordu (imleç listenin başında kalmıştı).
  const imleciAyarla = (num) => {
    const i = paraNumaralari.indexOf(parseInt(num, 10));
    if (i >= 0) bulguIdx = i;
  };
  box.querySelectorAll('.rt-fix').forEach(b => b.addEventListener('click', () => {
    imleciAyarla(b.dataset.num);
    runInlineFix(chapter, parseInt(b.dataset.num, 10), b.dataset.issue, b);
  }));
  box.querySelectorAll('.review-chat').forEach(b => b.addEventListener('click', () => {
    imleciAyarla(b.dataset.num);
    openReviewChat(chapter, parseInt(b.dataset.num, 10), b.dataset.issue);
  }));
  box.querySelectorAll('.rt-goto').forEach(a => a.addEventListener('click', (e) => {
    e.preventDefault();
    const el = document.querySelector(`.paragraph-text[data-number="${a.dataset.num}"]`);
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.focus(); }
  }));
}

// İnceleme bulgularıyla BAŞLAYAN paragraf sohbeti: eleştiriler zaten
// bağlamda olduğu için doğrudan "ne yapalım" diye konuşmaya başlanır.
// Karar verilince "✍️ yeni versiyonu yaz" ile metin üretilir.
function openReviewChat(chapter, number, issue) {
  const box = document.querySelector(`.review-chat-box[data-num="${number}"]`);
  if (!box) return;
  if (box.innerHTML.trim()) { box.innerHTML = ''; return; }   // ikinci tık kapatır
  const para = (chapter.paragraphs || []).find(p => p.number === number);
  if (!para) return;

  // Sohbeti bulgularla tohumla (tek seferlik)
  paraChatHistories[number] = paraChatHistories[number] || [];
  if (!paraChatHistories[number].length) {
    paraChatHistories[number].push({
      role: 'user',
      content: `Bu paragraf hakkında incelemede şu bulgular çıktı: ${issue}\nSence hangileri haklı, hangileri değil? Ne yapmalıyız?`,
    });
  }
  box.innerHTML = `
    <div class="panel" style="margin-top:6px;border-left:3px solid var(--border);">
      <div style="font-size:11px;color:var(--text-muted);letter-spacing:0.4px;">💬 P${number} ÜZERİNE KONUŞMA</div>
      <div style="font-size:12.5px;font-style:italic;color:var(--text-muted);margin:4px 0;">"${escapeHtml(truncate(para.text, 140))}"</div>
      <div class="para-chat-log" data-number="${number}" style="max-height:220px;overflow-y:auto;font-size:12.5px;"></div>
      <div style="display:flex;gap:6px;margin-top:6px;">
        <textarea class="para-chat-input" data-number="${number}" placeholder="Ör: bilgi bocası eleştirisine katılmıyorum, ama ritim haklı" style="flex:1;min-height:38px;box-sizing:border-box;font-size:12.5px;"></textarea>
        <button class="btn btn-sm btn-primary review-send" data-number="${number}">Gönder</button>
      </div>
      <button class="btn btn-sm review-write" data-number="${number}" style="margin-top:6px;width:100%;">✍️ Konuştuklarımıza göre yeni versiyonu yaz</button>
    </div>`;
  renderParaChatLog(number);
  const komsu = '';
  box.querySelector('.review-send').addEventListener('click', () => sendParagraphChat(chapter, number, komsu, para.text));
  box.querySelector('.para-chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendParagraphChat(chapter, number, komsu, para.text); }
  });
  box.querySelector('.review-write').addEventListener('click', () => writeParagraphVersion(chapter, number, komsu, para.text));
  // İlk soruyu otomatik gönder: bulgular zaten yazıldı, cevabı hemen gelsin
  if (paraChatHistories[number].length === 1) {
    const input = box.querySelector('.para-chat-input');
    input.value = paraChatHistories[number][0].content;
    paraChatHistories[number] = [];
    sendParagraphChat(chapter, number, komsu, para.text);
  }
}

// ---------------------------------------------------------------------------
// DENETİM: tüm kontrol araçları TEK menüde, sekmeli. Eskiden Tutarlılık ve
// Üslup sol menüde ayrı ayrı duruyor, Bölüm İncelemesi ise bölümün üstünde
// kalıyordu - aynı aileden üç araç üç farklı yerdeydi ve hangisinin nerede
// olduğu ezberlenmek zorundaydı. Artık "roman geneli" denetimler burada,
// "bu bölüm" denetimi ise doğal yerinde (bölümün üstünde) kalır; buradan
// da nasıl çalıştırılacağı anlatılır.
// ---------------------------------------------------------------------------
const DENETIM_SEKMELERI = {
  fullscan: {
    label: '🧩 Tutarlılık',
    hint: 'Roman geneli çelişkiler: karakter bilgisi, zaman çizelgesi, kural ihlalleri.',
    render: (el) => renderFullScanView(el),
  },
  stylescan: {
    label: '✍️ Üslup',
    hint: 'Aşırı kullanılan kalıplar ve yazım tikleri; eşiği aşanlar AI\'ya "kaçın" uyarısı olarak gider.',
    render: (el) => renderStyleScanView(el),
  },
  workshop: {
    label: '🛠 Atölye',
    hint: 'Bir bölüm ya da kısım seç, paragraf paragraf elden geçir: hazırlık kontrolü → inceleme → düzeltme.',
    render: (el) => renderWorkshopPicker(el),
  },
  structure: {
    label: '🏗️ Yapısal Akış',
    hint: 'Bölümler ARASI denetim: nedensellik ("bu yüzden" mi "ve sonra" mı), tekrar eden çatışma, bahis eğrisi, ölü bölgeler, bölüm kapanışları. Özetlerle çalışır.',
    render: (el) => renderStructureScan(el),
  },
  chapter: {
    label: '🔍 Bölüm İncelemesi',
    hint: 'Tek bir bölümün edebî karnesi + okur gözü bulguları. Bölümün kendi ekranından çalışır.',
    render: (el) => {
      el.innerHTML = `
        <div class="panel">
          <p style="font-size:13.5px;color:var(--text-muted);margin-top:0;">
            Bölüm İncelemesi <b>bölüme özel</b> bir denetimdir - bu yüzden bölümün kendi ekranında durur.
            Önce editör gözüyle 10 edebî ölçüt (betimleme, atmosfer, imgesellik, yapısal akış, alt metin,
            dil ekonomisi, ritim, sembolizm, karakterizasyon, üslup), sonra okur gözüyle düşürücü noktalar
            taranır; bulgular paragraf paragraf birleştirilir ve her paragrafı düzeltebilir ya da AI ile
            konuşarak karara bağlayabilirsin.
          </p>
          <div style="font-size:13px;">Nasıl çalıştırılır: <b>Roman</b> menüsü → bir bölüm seç → üstteki
            <b>🔍 Bölüm İncelemesi</b> düğmesi.</div>
          <button class="btn btn-primary" id="gotoRomanForReview" style="margin-top:10px;">Roman menüsüne git</button>
        </div>`;
      el.querySelector('#gotoRomanForReview').addEventListener('click', () => switchView('roman'));
    },
  },
};
let currentDenetimTab = 'workshop';

function renderDenetimView(view) {
  // Eski menü yolları (fullscan/stylescan) doğrudan ilgili sekmeyi açar
  if (view === 'fullscan' || view === 'stylescan') currentDenetimTab = view;
  main().innerHTML = `
    <h1 class="view-title">Denetim</h1>
    <p style="color:var(--text-muted);font-size:13.5px;max-width:680px;">
      Metni kontrol eden tüm araçlar burada. <b>Tutarlılık</b> ve <b>Üslup</b> roman genelini tarar;
      <b>Bölüm İncelemesi</b> tek bir bölüme odaklanır.
    </p>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin:10px 0;">
      ${Object.entries(DENETIM_SEKMELERI).map(([key, t]) => `
        <button class="btn btn-sm denetim-tab${key === currentDenetimTab ? ' btn-primary' : ''}" data-tab="${key}">${t.label}</button>`).join('')}
    </div>
    <div id="denetimHint" style="font-size:12.5px;color:var(--text-muted);margin-bottom:10px;"></div>
    <div id="denetimBody"></div>`;

  const goster = (key) => {
    currentDenetimTab = key;
    document.querySelectorAll('.denetim-tab').forEach(b => b.classList.toggle('btn-primary', b.dataset.tab === key));
    document.getElementById('denetimHint').textContent = DENETIM_SEKMELERI[key].hint;
    DENETIM_SEKMELERI[key].render(document.getElementById('denetimBody'));
  };
  document.querySelectorAll('.denetim-tab').forEach(b =>
    b.addEventListener('click', () => goster(b.dataset.tab)));
  goster(currentDenetimTab);
}

// ---------------------------------------------------------------------------
// YAPISAL AKIŞ TARAMASI (bölümler arası). Diğer denetimler TEK bölüme ya da
// cümlelere bakar; buradaki sorunlar ancak bölümler ARASI okununca görünür:
// nedensellik kopukluğu ("ve sonra" zinciri), tekrar eden çatışma, sabit
// kalan bahis, ölü bölgeler. Özetlerle çalışır - ucuzdur.
// ---------------------------------------------------------------------------
async function renderStructureScan(el) {
  el.innerHTML = `
    <p style="font-size:13.5px;color:var(--text-muted);max-width:680px;margin-top:0;">
      Editörlerin klasik testleri: her bölümün sonucu bir sonrakinin hedefini doğuruyor mu
      (<b>"bu yüzden"</b> mi, yoksa <b>"ve sonra"</b> mı), aynı çatışma tekrarlanıyor mu,
      bahis yükseliyor mu, çıkarılsa fark edilmeyecek bölüm var mı. Bölüm ÖZETLERİ kullanılır.
    </p>
    <button class="btn btn-primary" id="startStructureScan">Yapısal Taramayı Başlat</button>
    <div id="structureResult" style="margin-top:14px;"></div>`;

  el.querySelector('#startStructureScan').addEventListener('click', async () => {
    const box = el.querySelector('#structureResult');
    box.innerHTML = '<div class="empty-state">Bölüm zinciri inceleniyor…</div>';
    try {
      const r = await api.post('/ai/structure-scan', {});
      const trendRenk = { 'yükseliyor': '#3f7a4f', 'sabit': '#b08d3f', 'düşüyor': 'var(--danger)' }[r.stakes?.trend] || 'var(--text-muted)';
      const blok = (baslik, icerik) => icerik ? `<div style="margin-top:12px;"><strong style="font-size:11px;color:var(--text-muted);letter-spacing:0.4px;">${baslik}</strong>${icerik}</div>` : '';
      box.innerHTML = `
        <div class="panel">
          ${r.summary ? `<div style="font-size:13px;">${escapeHtml(r.summary)}</div>` : ''}
          ${r.missing_summaries.length ? `<div style="font-size:12px;color:var(--danger);margin-top:6px;">⚠ Özeti olmayan ${r.missing_summaries.length} bölüm taramaya girmedi (Bölüm ${r.missing_summaries.join(', ')}). Zincirde kör nokta oluşturur - önce özetle.</div>` : ''}

          ${r.stakes?.trend ? `<div style="margin-top:10px;font-size:13px;">📈 <b>Bahis eğrisi:</b> <span style="color:${trendRenk};font-weight:600;">${escapeHtml(r.stakes.trend)}</span> — ${escapeHtml(r.stakes.comment || '')}</div>` : ''}

          ${blok('NEDENSELLİK ZİNCİRİ ("bu yüzden" testi)', r.causality.map(c => `
            <div style="border-left:3px solid ${c.link && c.link.includes('sonra') ? 'var(--danger)' : 'var(--border)'};padding-left:10px;margin-top:8px;font-size:12.5px;">
              <b>Bölüm ${c.from} → ${c.to}</b> <span style="color:var(--text-muted);">bağ: "${escapeHtml(c.link || '?')}"</span>
              <div style="color:var(--text-muted);">${escapeHtml(c.problem || '')}</div>
              ${c.fix ? `<div>→ ${escapeHtml(c.fix)}</div>` : ''}
            </div>`).join(''))}

          ${blok('TEKRAR EDEN ÇATIŞMA', r.repetition.map(x => `
            <div style="border-left:3px solid var(--gold);padding-left:10px;margin-top:8px;font-size:12.5px;">
              <b>Bölüm ${x.chapters.join(', ')}</b>
              <div style="color:var(--text-muted);">${escapeHtml(x.problem || '')}</div>
              ${x.fix ? `<div>→ ${escapeHtml(x.fix)}</div>` : ''}
            </div>`).join(''))}

          ${blok('ÖLÜ BÖLGELER', r.dead_zones.map(d => `
            <div style="border-left:3px solid var(--danger);padding-left:10px;margin-top:8px;font-size:12.5px;">
              <b>Bölüm ${d.chapter ?? '?'}</b>
              <div style="color:var(--text-muted);">${escapeHtml(d.reason || d.problem || '')}</div>
              ${d.fix ? `<div>→ ${escapeHtml(d.fix)}</div>` : ''}
            </div>`).join(''))}

          ${blok('BÖLÜM KAPANIŞLARI', r.endings.map(e => `
            <div style="border-left:3px solid var(--border);padding-left:10px;margin-top:8px;font-size:12.5px;">
              <b>Bölüm ${e.chapter ?? '?'}</b>
              <div style="color:var(--text-muted);">${escapeHtml(e.problem || e.reason || '')}</div>
              ${e.fix ? `<div>→ ${escapeHtml(e.fix)}</div>` : ''}
            </div>`).join(''))}
        </div>`;
    } catch (err) {
      box.innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`;
    }
  });
}

// Paragraf işlevleri (oturum boyunca bellekte): { "7": "Yangın yerini masum
// göstermek..." }. Yeniden yazımın ÖLÇÜSÜ budur - talimatların en başına
// konur ve kabul kontrolünde "işini yapıyor mu" sorusuna kaynak olur.
const paraPurposes = {};

// İŞLEV MİRASI: 100 paragraflık bölümde her paragrafa elle işlev yazmak
// gerçekçi değil. Paragrafın kendi işlevi boşsa SAHNENİN işlevi (bölüm
// planı) kullanılır - plan zaten "bu bölümde ne olacak" diyor. Sadece
// istisna paragraflarda elle yazılır.
function effectiveParaPurpose(number) {
  const kendi = (paraPurposes[number] || '').trim();
  if (kendi) return { text: kendi, source: 'paragraf' };
  const plan = (window.__currentChapterPlan || '').trim();
  if (plan) return { text: plan, source: 'bölüm planı' };
  return { text: '', source: '' };
}

// Kalıcılık: işlevler ve paragraf kararları tarayıcıda saklanır - sayfa
// yenilenince ya da ertesi gün dönünce kaybolmasın.
// Çözülmüş bulgular: düzeltilip KAYDEDİLEN paragraflar. İncelemede tekrar
// önerilmez, gezinmede atlanır - "bir ileri bir geri" dönmeyi bitirir.
const resolvedParas = new Set();

function markParagraphResolved(number) {
  resolvedParas.add(String(number));
  saveParaState();
  const kart = document.querySelector(`.finding-card[data-num="${number}"]`);
  if (kart) {
    kart.dataset.resolved = '1';
    kart.style.opacity = '0.5';
    kart.style.borderLeftColor = '#3f7a4f';
    const rozet = kart.querySelector('.finding-status');
    if (rozet) rozet.innerHTML = '<span style="color:#3f7a4f;font-weight:600;">✓ düzeltildi</span>';
    kart.querySelectorAll('.rt-fix, .review-chat').forEach(b => b.remove());
  }
  // Sıradaki ÇÖZÜLMEMİŞ bulguya otomatik ilerle
  if (typeof window.__gotoNextFinding === 'function') window.__gotoNextFinding();
}

function saveParaState() {
  try {
    localStorage.setItem(`roman_para_state_${currentChapter?.id || 0}`,
      JSON.stringify({ purposes: paraPurposes, chats: paraChatHistories, resolved: [...resolvedParas] }));
  } catch (e) { /* depolama dolu olabilir - sessiz geç */ }
}
function loadParaState(chapterId) {
  Object.keys(paraPurposes).forEach(k => delete paraPurposes[k]);
  Object.keys(paraChatHistories).forEach(k => delete paraChatHistories[k]);
  resolvedParas.clear();
  try {
    const raw = localStorage.getItem(`roman_para_state_${chapterId}`);
    if (!raw) return;
    const data = JSON.parse(raw);
    Object.assign(paraPurposes, data.purposes || {});
    Object.assign(paraChatHistories, data.chats || {});
    (data.resolved || []).forEach(x => resolvedParas.add(String(x)));
  } catch (e) { /* bozuk kayıt - yoksay */ }
}

// ---------------------------------------------------------------------------
// KABUL KONTROLÜ: yeni versiyon paragrafa YAZILMADAN ÖNCE denetlenir.
// Zincirin son halkasıydı ve yoktu: metin üretiliyor, onaylanıyor, bitiyordu -
// işini yapıyor mu, somut detay düştü mü, komşuyla çelişti mi, yasak kalıp
// girdi mi kimse sormuyordu. Sayı/isim kaybı ve kalıp kontrolü
// deterministiktir (AI'ya sorulmaz).
// ---------------------------------------------------------------------------
// Deterministik ön kontrol (AI'sız, anlık): sayı ve özel isim kaybı.
// 100 paragraflık bölümde her uygulamada AI çağırmak hem pahalı hem yavaş;
// çoğu sorun zaten buradan yakalanıyor. AI kontrolü ancak burada bulgu
// çıkarsa ya da kullanıcı isterse çalışır.
function quickFactCheck(oldText, newText) {
  const sayilar = (t) => new Set((t || '').match(/\b\d+(?:[.,]\d+)?\b/g) || []);
  // İsim kontrolü KANON listesinden: "büyük harfle başlayan her kelime özel
  // isimdir" varsayımı cümle başı kelimeleri ("Ama", "Sonra") isim sanıyor,
  // cümle yapısı değişince haksız "isim düştü" uyarısı üretiyordu.
  const canon = window.__canonNames || [];
  const gecen = (t) => canon.filter(ad => (t || '').includes(ad));
  const kayipSayi = [...sayilar(oldText)].filter(x => !sayilar(newText).has(x));
  const kayipIsim = gecen(oldText).filter(ad => !newText.includes(ad));
  const bulgular = [];
  if (kayipSayi.length) bulgular.push(`Somut sayı düştü: ${kayipSayi.join(', ')}`);
  if (kayipIsim.length) bulgular.push(`Özel isim düştü: ${kayipIsim.join(', ')}`);
  return bulgular;
}

async function verifyBeforeApply(chapterId, number, oldText, newText) {
  const paras = (currentChapter?.paragraphs || []).slice().sort((a, b) => a.number - b.number);
  const idx = paras.findIndex(p => p.number === number);
  const clip = (t) => { const v = (t || '').trim(); return v.length > 300 ? v.slice(0, 300) + '…' : v; };
  const komsular = idx >= 0
    ? [...paras.slice(Math.max(0, idx - 1), idx), ...paras.slice(idx + 1, idx + 2)]
        .map(p => `[P${p.number}] ${clip(p.text)}`).join('\n')
    : '';
  try {
    return await api.post('/ai/verify-rewrite', {
      old_text: oldText, new_text: newText,
      purpose: effectiveParaPurpose(number).text, neighbors: komsular,
      // Önerinin AMACI: "metin değişti mi" değil "hedef gerçekleşti mi"
      proposal_goal: (workshopState.lastGoal && workshopState.lastGoal[number]) || '',
      expected_effect: (workshopState.diagnoses?.[number] || [])
        .filter(d => d.cls === 'hata' || d.cls === 'zayif')
        .map(d => d.title).join(' | '),
    });
  } catch (err) {
    return { verdict: 'kabul', hard_issues: [], issues: [], note: 'Kontrol yapılamadı: ' + err.message };
  }
}

// Kontrol sonucunu gösterir; kullanıcı yine de yazdırabilir (karar onun).
// Kademeli akış: önce ÜCRETSİZ deterministik kontrol gösterilir; temizse
// tek tıkla yazılır. Kullanıcı isterse (ya da bulgu varsa) AI'lı derin
// kontrol çalıştırılır.
function renderQuickCheck(oldText, newText, onApply, onDeep, onDiscuss) {
  const bulgular = quickFactCheck(oldText, newText);
  const temiz = !bulgular.length;
  const div = document.createElement('div');
  div.style.cssText = 'margin-top:8px;border:1px solid var(--border);border-left:3px solid '
    + (temiz ? '#3f7a4f' : 'var(--danger)') + ';border-radius:6px;padding:8px;';
  div.innerHTML = `
    <div style="font-size:12.5px;color:${temiz ? '#3f7a4f' : 'var(--danger)'};font-weight:600;">
      ${temiz ? '✓ Hızlı kontrol temiz (sayı/isim kaybı yok)' : '⚠ Hızlı kontrol uyarıyor'}
    </div>
    ${bulgular.length ? `<ul style="margin:6px 0 0 16px;padding:0;font-size:12px;">${bulgular.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul>` : ''}
    <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;">
      <button class="btn btn-sm ${temiz ? 'btn-primary' : ''} qc-apply" style="font-size:11.5px;">${temiz ? 'Paragrafa yaz' : 'Yine de yaz'}</button>
      <button class="btn btn-sm qc-deep" style="font-size:11.5px;" title="İşlev, süreklilik ve eylem sırası için AI kontrolü (ek istek)">🔎 Derin kontrol</button>
      <button class="btn btn-sm qc-tradeoff" style="font-size:11.5px;" title="Bu öneri ne kazandırıyor, ne kaybettiriyor? Karşı argüman üretir.">⚖ Kazanç-kayıp</button>
      ${onDiscuss ? `<button class="btn btn-sm qc-discuss" style="font-size:11.5px;" title="Bulgular + metin + AI yorumu ile tartış">💬 AI ile sohbet et</button>` : ''}
      <button class="btn btn-sm qc-cancel" style="font-size:11.5px;">Vazgeç</button>
    </div>`;
  div.querySelector('.qc-apply').addEventListener('click', () => { div.remove(); onApply(); });
  div.querySelector('.qc-cancel').addEventListener('click', () => div.remove());
  // TAKILMAYI ÖNLEME: kontrol bir şey söylediğinde tek çıkış "yine de yaz"
  // ya da "vazgeç" olmasın - bulguları hesaba katıp yeniden üretebilmeli.
  // KAZANÇ-KAYIP: öneri sadece kazandırdığını değil KAYBETTİRDİĞİNİ de
  // göstermeli. Net negatifse sistem kendi önerisini reddeder.
  div.querySelector('.qc-tradeoff')?.addEventListener('click', async (e) => {
    const b = e.target;
    b.disabled = true; b.textContent = 'Ölçülüyor…';
    try {
      const t = await api.post('/ai/tradeoff', { old_text: oldText, new_text: newText });
      const renk = { uygula: '#3f7a4f', tartis: '#b08d3f', reddet: 'var(--danger)' }[t.recommend];
      const satir = (x, isaret) => `<div>${isaret} ${escapeHtml(x.dim)} ${x.score > 0 ? '+' : ''}${x.score} — <span style="color:var(--text-muted);">${escapeHtml(x.why)}</span></div>`;
      div.insertAdjacentHTML('beforeend', `
        <div style="margin-top:8px;border-top:1px dashed var(--border);padding-top:6px;font-size:12px;">
          <div style="color:${renk};font-weight:600;">⚖ Net ${t.net > 0 ? '+' : ''}${t.net} · ${escapeHtml(t.recommend)}</div>
          ${t.gains.map(x => satir(x, '↑')).join('')}
          ${t.losses.map(x => satir(x, '↓')).join('')}
          ${t.counter_argument ? `<div style="margin-top:4px;color:var(--text-muted);">🤔 Karşı argüman: ${escapeHtml(t.counter_argument)}</div>` : ''}
        </div>`);
    } catch (err) {
      div.insertAdjacentHTML('beforeend', `<div class="error-text" style="font-size:11.5px;">${escapeHtml(err.message)}</div>`);
    }
    b.disabled = false; b.textContent = '⚖ Kazanç-kayıp';
  });
  div.querySelector('.qc-discuss')?.addEventListener('click', () => {
    onDiscuss(bulgular, '');
    div.remove();
  });
  div.querySelector('.qc-deep').addEventListener('click', async (e) => {
    const b = e.target;
    b.disabled = true; b.textContent = 'Kontrol ediliyor…';
    const v = await onDeep();
    b.disabled = false; b.textContent = '🔎 Derin kontrol';
    div.insertAdjacentElement('afterend', renderVerifyResult(v, () => { div.remove(); onApply(); }, onDiscuss));
    div.querySelector('.qc-deep').remove();
  });
  return div;
}

function renderVerifyResult(v, onApply, onDiscuss) {
  const renk = { kabul: '#3f7a4f', duzelt: '#b08d3f', red: 'var(--danger)' }[v.verdict] || 'var(--text-muted)';
  const etiket = { kabul: '✓ Kabul edilebilir', duzelt: '⚠ Düzeltilmeli', red: '✕ Reddedildi' }[v.verdict] || v.verdict;
  const tumBulgular = [...(v.hard_issues || []), ...(v.issues || [])];
  const div = document.createElement('div');
  div.style.cssText = 'margin-top:8px;border:1px solid var(--border);border-left:3px solid ' + renk + ';border-radius:6px;padding:8px;';
  div.innerHTML = `
    <div style="font-size:12.5px;color:${renk};font-weight:600;">${etiket}</div>
    ${v.note ? `<div style="font-size:12px;color:var(--text-muted);margin-top:2px;">${escapeHtml(v.note)}</div>` : ''}
    ${tumBulgular.length ? `<ul style="margin:6px 0 0 16px;padding:0;font-size:12px;">${tumBulgular.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul>` : ''}
    <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;">
      <button class="btn btn-sm ${v.verdict === 'kabul' ? 'btn-primary' : ''} verify-apply" style="font-size:11.5px;">${v.verdict === 'kabul' ? 'Paragrafa yaz' : 'Yine de yaz'}</button>
      ${onDiscuss && tumBulgular.length ? `<button class="btn btn-sm btn-primary verify-discuss" style="font-size:11.5px;" title="Kontrol uyarıları + seçtiğin metin + AI yorumu ile tartış">💬 AI ile sohbet et</button>` : ''}
      <button class="btn btn-sm verify-cancel" style="font-size:11.5px;">Vazgeç</button>
    </div>`;
  div.querySelector('.verify-apply').addEventListener('click', () => { div.remove(); onApply(); });
  div.querySelector('.verify-cancel').addEventListener('click', () => div.remove());
  // ÇIKMAZ ÖNLEME: "uyarılara göre yeniden yaz" bağa giriyordu (aynı
  // uyarılar tekrar çıkıyor, döngü kapanmıyor). Yerine SOHBET: kontrol
  // uyarıları + seçilen metin + AI'nın kendi yorumu birlikte tartışılıyor -
  // en iyi sonucu bu veriyor, çünkü karar insanla birlikte veriliyor.
  div.querySelector('.verify-discuss')?.addEventListener('click', () => {
    onDiscuss(tumBulgular, v.note || '');
    div.remove();
  });
  return div;
}

// ---------------------------------------------------------------------------
// BÖLÜM ATÖLYESİ: yazılmış bir bölümü profesyonel biçimde elden geçirmek için
// tam ekran, adım adım akış. Mobilde asıl kullanılabilir mod budur - masaüstü
// panelleri küçük ekranda sıkışıyordu.
//   ADIM 1 HAZIRLIK: özet var mı (yoksa üret), zaman çizelgesi işlenmiş mi
//     (yoksa çalıştır), plan bağlı mı. Bunlar incelemenin KALİTESİNİ belirler:
//     özet yoksa AI bölümün ne olduğunu bilmez, plan yoksa işlevini bilmez.
//   ADIM 2 İNCELEME: editör gözü (10 ölçüt) + okur gözü, bulgular paragrafa
//     bağlanır.
//   ADIM 3 PARAGRAF PARAGRAF: tek ekranda tek paragraf - metni, bulguları,
//     3 seçenek, sohbet, kaydet ve ilerle. Çözülenler işaretlenir.
// ---------------------------------------------------------------------------
const workshopState = { chapter: null, findings: {}, order: [], idx: 0, literary: null };

function openChapterWorkshop(chapter) {
  loadBannedPatterns();          // üslup taramasındaki yasak kalıplar (kaçınma listesi)
  loadCanonNames();              // korunması gereken kanonik adlar
  workshopState.chapter = chapter;
  workshopState.findings = {};
  workshopState.order = [];
  workshopState.idx = 0;
  workshopState.literary = null;
  let ov = document.getElementById('workshopOverlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'workshopOverlay';
    ov.className = 'workshop-overlay';
    document.body.appendChild(ov);
  }
  ov.style.display = 'flex';
  renderWorkshopPrep();
}

function closeWorkshop() {
  const ov = document.getElementById('workshopOverlay');
  if (ov) { ov.style.display = 'none'; ov.innerHTML = ''; }
  if (currentChapter) loadChapterList(currentChapter.id);   // değişiklikleri yansıt
}

function workshopShell(baslik, adim, govde) {
  const ch = workshopState.chapter;
  return `
    <div class="workshop-box">
      <div class="workshop-head">
        <div>
          <div style="font-size:11px;color:var(--text-muted);letter-spacing:0.4px;">ADIM ${adim}/3 · BÖLÜM ${ch.number}</div>
          <div style="font-weight:600;font-size:14px;">${escapeHtml(baslik)}</div>
        </div>
        <button class="btn btn-sm workshop-close-btn" id="workshopClose" title="Atölyeyi kapat">✕</button>
      </div>
      <div class="workshop-body">${govde}</div>
    </div>`;
}

// --- ADIM 1: HAZIRLIK ---
async function renderWorkshopPrep() {
  const ov = document.getElementById('workshopOverlay');
  const ch = workshopState.chapter;
  ov.innerHTML = workshopShell('Hazırlık', 1, '<div class="empty-state">Kontrol ediliyor…</div>');
  document.getElementById('workshopClose').addEventListener('click', closeWorkshop);

  const ozetVar = !!(ch.summary || '').trim();
  let planVar = false, olayVar = false;
  try {
    const plan = await api.get(`/matrix/plan-for-chapter/${ch.id}`);
    planVar = !!(plan && (plan.content || '').trim());
  } catch (e) { /* plan yok */ }
  try {
    const olaylar = await api.get('/events/');
    olayVar = olaylar.some(e => (e.story_order || 0) >= ch.number * 1000 && (e.story_order || 0) < (ch.number + 1) * 1000);
  } catch (e) { /* olay yok */ }

  const satir = (tamam, baslik, aciklama, dugmeId, dugmeMetin) => `
    <div style="display:flex;gap:10px;align-items:flex-start;padding:10px 0;border-bottom:1px solid var(--border);">
      <span style="font-size:16px;">${tamam ? '✅' : '⬜'}</span>
      <div style="flex:1;min-width:0;">
        <div style="font-weight:600;font-size:13.5px;">${baslik}</div>
        <div style="font-size:12.5px;color:var(--text-muted);">${aciklama}</div>
        ${tamam ? '' : `<button class="btn btn-sm btn-primary" id="${dugmeId}" style="margin-top:6px;font-size:11.5px;">${dugmeMetin}</button>`}
      </div>
    </div>`;

  ov.innerHTML = workshopShell('Hazırlık', 1, `
    <p style="font-size:12.5px;color:var(--text-muted);margin-top:0;">
      Bunlar incelemenin <b>kalitesini</b> belirler: özet yoksa AI bölümün ne olduğunu,
      plan yoksa ne yapması gerektiğini bilmez.
    </p>
    ${satir(ozetVar, 'Bölüm özeti', ozetVar ? 'Var - ZAMAN/OLAY/MEKAN bilgisi incelemeye gidecek.' : 'Yok. AI bölümü tanımadan inceler; bulgular yüzeysel kalır.', 'wsMakeSummary', 'AI ile özet oluştur')}
    ${satir(olayVar, 'Zaman çizelgesi', olayVar ? 'Bu bölümden olaylar çizelgede işlenmiş.' : 'Bu bölümden çizelgeye olay işlenmemiş. Kronoloji hataları görünmez kalır.', 'wsMakeEvents', '🕐 Zaman çizelgesini güncelle')}
    ${satir(planVar, 'Bölüm planı', planVar ? 'Var - paragrafların işlevi buradan miras alınacak.' : 'Yok. Paragrafların "ne yapması gerektiği" tanımsız kalır.', 'wsMakePlan', '⚡ Metinden plan çıkar')}
    <div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap;">
      <button class="btn btn-primary" id="wsFullPass" style="flex:1;min-width:210px;">🔁 Bölümü tekrar değerlendir ve paragrafları düzenle</button>
      <button class="btn" id="wsToReview" style="flex:1;">Sadece incele →</button>
    </div>
    <div id="wsPrepResult" style="margin-top:10px;"></div>`);
  document.getElementById('workshopClose').addEventListener('click', closeWorkshop);
  document.getElementById('wsToReview').addEventListener('click', renderWorkshopReview);
  // TAM TUR: önbelleği yok sayıp analizi TAZELER, süpürme modunu açar ve
  // doğrudan paragraf paragraf düzenlemeye geçer. Tek düğmeyle uçtan uca.
  document.getElementById('wsFullPass').addEventListener('click', () => {
    workshopState.forceRescan = true;
    workshopState.autoSweep = true;
    renderWorkshopReview();
  });

  document.getElementById('wsMakeSummary')?.addEventListener('click', async (e) => {
    const b = e.target; b.disabled = true; b.textContent = 'Özet yazılıyor…';
    try {
      const r = await api.post(`/chapters/${ch.id}/generate-summary`, {});
      if (confirm(`Taslak özet:\n\n${r.generated_summary}\n\nKaydedilsin mi?`)) {
        await api.put(`/chapters/${ch.id}`, { summary: r.generated_summary });
        ch.summary = r.generated_summary;
      }
    } catch (err) { alert(err.message); }
    renderWorkshopPrep();
  });
  document.getElementById('wsMakeEvents')?.addEventListener('click', async (e) => {
    const b = e.target; b.disabled = true; b.textContent = 'Taranıyor…';
    const box = document.getElementById('wsPrepResult');
    try {
      const öneriler = await api.post(`/chapters/${ch.id}/suggest-events`, {});
      box.innerHTML = öneriler.length
        ? '<div style="font-size:12.5px;">Öneriler Roman menüsündeki 🕐 Zaman Çizelgesi düğmesinden onaylanabilir.</div>'
        : '<div style="font-size:12.5px;color:var(--text-muted);">Yeni olay bulunamadı.</div>';
    } catch (err) { box.innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`; }
    b.disabled = false; b.textContent = '🕐 Zaman çizelgesini güncelle';
  });
  document.getElementById('wsMakePlan')?.addEventListener('click', async (e) => {
    // METİNDEN PLAN: yazılmış bölümden geriye dönük plan çıkarır. Önce
    // yazıp sonra planlayan akışta plan elle yazılmıyordu ve işlev mirası
    // çalışmıyordu.
    const b = e.target, kutu = document.getElementById('wsPrepResult');
    b.disabled = true; b.textContent = 'Metinden çıkarılıyor…';
    try {
      const r = await api.post(`/ai/plan-from-text/${ch.id}`, {});
      kutu.innerHTML = `
        <div class="panel" style="border-left:3px solid var(--gold);">
          <div style="font-size:10.5px;color:var(--text-muted);letter-spacing:0.4px;">METİNDEN ÇIKARILAN PLAN - onaysız kaydedilmez</div>
          <textarea id="wsPlanDraft" style="width:100%;min-height:130px;font-size:12.5px;margin-top:6px;box-sizing:border-box;">${escapeHtml(r.plan)}</textarea>
          <div class="form-actions">
            <button class="btn btn-sm btn-primary" id="wsPlanSave">Planı kaydet</button>
            <button class="btn btn-sm" id="wsPlanCancel">Vazgeç</button>
          </div>
        </div>`;
      document.getElementById('wsPlanCancel').addEventListener('click', () => { kutu.innerHTML = ''; });
      document.getElementById('wsPlanSave').addEventListener('click', async () => {
        try {
          await api.post('/matrix/quick-plan', {
            chapter_id: ch.id, content: document.getElementById('wsPlanDraft').value.trim(),
          });
          renderWorkshopPrep();
        } catch (err) { alert(err.message); }
      });
    } catch (err) { kutu.innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`; }
    b.disabled = false; b.textContent = 'Plan yaz';
  });
}

// --- ADIM 2: İNCELEME ---
async function renderWorkshopReview() {
  const ov = document.getElementById('workshopOverlay');
  const ch = workshopState.chapter;
  // DERİN ANALİZ: üç aşama tek akışta - ayrı düğmeler yok, hepsi burada.
  const asama = (n, metin) => {
    ov.querySelector('.workshop-body').innerHTML = `
      <div class="empty-state">
        <div style="font-size:13px;">${n}/3 · ${metin}</div>
        <div style="font-size:11.5px;color:var(--text-muted);margin-top:6px;">Uzun bölümlerde bir-iki dakika sürebilir.</div>
      </div>`;
  };
  ov.innerHTML = workshopShell('Derin Analiz', 2, '');
  document.getElementById('workshopClose').addEventListener('click', closeWorkshop);

  // Önbellek: daha önce incelenmişse sonuçları geri yükle, yeniden analiz
  // için kullanıcıya sor. Uzun bölümlerde analiz dakikalar sürüyor.
  const onbellek = loadReviewCache(ch.id);
  if (onbellek && !workshopState.forceRescan) {
    const gun = Math.floor((Date.now() - onbellek.at) / 86400000);
    workshopState.literary = onbellek.literary;
    workshopState.findings = onbellek.findings;
    workshopState.order = onbellek.order || [];
    workshopState.roleKinds = onbellek.roleKinds || {};
    renderWorkshopReviewSummary(onbellek.literary, onbellek.motif || {}, true, gun);
    return;
  }
  workshopState.forceRescan = false;
  asama(1, 'Editör gözüyle 10 edebî ölçüt');
  try {
    const literary = await api.post(`/ai/literary-review/${ch.id}`, {});
    workshopState.literary = literary;
    asama(2, 'Okur gözüyle düşürücü noktalar');
    const reader = await api.post(`/ai/reader-test/${ch.id}`, {});
    asama(3, 'Paragraf işlevleri ve imge haritası');
    // PARAGRAF İŞLEVLERİ: her paragrafın sahnedeki görevi ("olay mahalli
    // tanıtılıyor", "dijital doğum hazırlığı"). Özet + paragraf birlikte
    // kullanıldığı için isabet yüksek. Elle yazmak zorunda kalmıyorsun;
    // üzerine yazabilirsin.
    try {
      const roller = await api.post(`/ai/paragraph-roles/${ch.id}`, {});
      (roller.roles || []).forEach(r => {
        if (!paraPurposes[r.p]) paraPurposes[r.p] = r.role;
        workshopState.roleKinds = workshopState.roleKinds || {};
        workshopState.roleKinds[r.p] = r.kind;
      });
      saveParaState();
    } catch (e) { /* işlev çıkarımı başarısız olsa da inceleme sürer */ }
    let motif = { repeats: [], unused_senses: [], summary: '', items: [] };
    try { motif = await api.post(`/ai/motif-map/${ch.id}`, {}); }
    catch (e) { /* imge haritası başarısız olsa da inceleme sürer */ }
    workshopState.motif = motif;

    const byPara = {};
    (literary.fixes || []).forEach(f => {
      if (f.paragraph) (byPara[f.paragraph] = byPara[f.paragraph] || []).push(
        { kaynak: 'editor', baslik: f.criterion || 'Edebî', sorun: f.problem, oneri: f.fix });
    });
    (reader.findings || []).forEach(f => {
      if (f.paragraph_number) (byPara[f.paragraph_number] = byPara[f.paragraph_number] || []).push(
        { kaynak: 'okur', baslik: READER_TEST_TYPE_LABELS[f.type] || f.type, sorun: f.reason, oneri: f.suggestion, alinti: f.quote });
    });
    // İmge tekrarları da paragraf bulgusu olur: hangi paragrafta tekrar
    // ettiği belli olduğu için doğrudan oraya bağlanır (leitmotif'ler
    // bulgu sayılmaz - onlar bilinçli tekrardır).
    // Sadece KANITLI tekrarlar bulgu olur; "belirsiz" ve "leitmotif" olmaz -
    // kanıtsız iddiadan öneri üretmek sistemin en tehlikeli davranışı.
    (motif.repeats || []).filter(x => x.kind === 'tekrar' && (x.confidence ?? 1) >= 0.6).forEach(x => {
      (x.paragraphs || []).forEach(pn => {
        (byPara[pn] = byPara[pn] || []).push({
          kaynak: 'imge',
          baslik: `İmge tekrarı: ${x.image}`,
          sorun: `${x.reason || ''} (P${(x.paragraphs || []).join(', P')} aynı imgeyi taşıyor)`,
          oneri: x.fix || 'Bu paragrafta imgeyi değiştir ya da yeni bir katman ekle.',
        });
      });
    });
    workshopState.findings = byPara;
    workshopState.order = Object.keys(byPara).map(Number).sort((a, b) => a - b);
    workshopState.idx = 0;
    // İNCELEME HAFIZASI: sonuçlar saklanır - atölyeyi kapatıp açtığında
    // ya da ertesi gün döndüğünde analiz baştan çalışmaz (hem zaman hem
    // maliyet). "Yeniden incele" ile bilerek tazelenir.
    saveReviewCache(ch.id, {
      at: Date.now(), literary, findings: byPara, motif,
      order: workshopState.order, roleKinds: workshopState.roleKinds || {},
    });

    renderWorkshopReviewSummary(literary, motif, false, 0);
  } catch (err) {
    ov.querySelector('.workshop-body').innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>
      <button class="btn" id="wsRetry" style="margin-top:10px;">Tekrar dene</button>`;
    document.getElementById('wsRetry').addEventListener('click', renderWorkshopReview);
  }
}

// --- ADIM 3: PARAGRAF PARAGRAF ---
async function renderWorkshopParagraph(idx) {
  const ov = document.getElementById('workshopOverlay');
  const ch = workshopState.chapter;
  const sira = workshopState.order;
  if (!sira.length) { renderWorkshopReview(); return; }
  workshopState.idx = Math.max(0, Math.min(idx, sira.length - 1));
  const num = sira[workshopState.idx];
  const para = (ch.paragraphs || []).find(p => p.number === num);
  const kayitlar = workshopState.findings[num] || [];
  const cozuldu = resolvedParas.has(String(num));
  const kalan = sira.filter(n => !resolvedParas.has(String(n))).length;
  const issue = kayitlar.map(k => `${k.baslik}: ${k.sorun} ${k.oneri || ''}`).join(' | ');

  ov.innerHTML = workshopShell(`P${num} · ${workshopState.idx + 1}/${sira.length}`, 3, `
    <div style="display:flex;justify-content:space-between;align-items:center;font-size:11.5px;color:var(--text-muted);">
      <span>${cozuldu ? '<span style="color:#3f7a4f;font-weight:600;">✓ düzeltildi</span>' : `${kalan} paragraf kaldı`}</span>
      <span>${escapeHtml((effectiveParaPurpose(num).source) ? 'işlev: ' + effectiveParaPurpose(num).source : 'işlev tanımsız')}</span>
    </div>

    <div class="field" style="margin:8px 0;">
      <label style="font-size:10.5px;">🎯 BU PARAGRAFIN İŞİ</label>
      <input type="text" id="wsPurpose" value="${escapeHtml(paraPurposes[num] || '')}" placeholder="${escapeHtml(truncate(effectiveParaPurpose(num).text || 'ör. Yangın yerini masum göstermek', 60))}" style="font-size:12.5px;">
    </div>

    <div id="wsParaText" contenteditable="true" style="border:1px solid var(--border);border-radius:8px;padding:10px;font-size:14px;line-height:1.7;background:#fff;min-height:80px;">${escapeHtml(para ? para.text : '(paragraf bulunamadı)')}</div>
    <div style="display:flex;gap:6px;margin-top:6px;">
      <button class="btn btn-sm" id="wsSaveManual" style="font-size:11.5px;">💾 Elle kaydet</button>
      <span id="wsSaveState" style="font-size:11.5px;color:var(--text-muted);align-self:center;"></span>
    </div>

    ${kayitlar.length ? `
      <div style="margin-top:12px;">
        <div style="display:flex;justify-content:space-between;align-items:baseline;">
          <div style="font-size:10.5px;color:var(--text-muted);letter-spacing:0.4px;">BULGULAR (${kayitlar.length})</div>
          <button class="btn btn-sm" id="wsShowDirectives" style="font-size:10.5px;padding:1px 6px;" title="Bu bulgulardan çıkarılan ve AI'ya giden kural listesi">📋 Direktifler</button>
        </div>
        <div id="wsDirectiveBox"></div>
        <div id="wsDiagnosisBox"></div>
        ${kayitlar.map((k, ki) => `
          <details class="finding-detail" ${ki === 0 ? 'open' : ''} style="margin-top:6px;border-left:3px solid ${k.kaynak === 'editor' ? 'var(--gold)' : (k.kaynak === 'imge' ? '#7a5fb0' : 'var(--danger)')};padding-left:8px;">
            <summary style="cursor:pointer;font-size:12.5px;list-style:none;">
              ${k.kaynak === 'editor' ? '📊' : (k.kaynak === 'imge' ? '🎨' : '🎯')} <b>${escapeHtml(k.baslik)}</b>
              <span style="color:var(--text-muted);font-weight:400;">· ${escapeHtml(truncate((k.sorun || '').replace(/\s+/g, ' '), 40))}</span>
            </summary>
            <div style="font-size:12.5px;padding-top:4px;">
              ${k.alinti ? `<div style="font-style:italic;color:var(--text-muted);">"${escapeHtml(k.alinti)}"</div>` : ''}
              <div style="color:var(--text-muted);">${escapeHtml(k.sorun || '')}</div>
              ${k.oneri ? `<div style="margin-top:2px;">→ ${escapeHtml(k.oneri)}</div>` : ''}
            </div>
          </details>`).join('')}
      </div>` : ''}

    <div style="display:flex;gap:6px;margin-top:12px;flex-wrap:wrap;">
      <button class="btn btn-primary" id="wsFix" style="flex:1;font-size:12px;">✨ 3 öneri getir</button>
      <button class="btn" id="wsChat" style="flex:1;font-size:12px;">💬 Konuş</button>
    </div>
    <div id="wsLongWarn"></div>
    <button class="btn btn-sm" id="wsNecessity" style="width:100%;margin-top:6px;font-size:11.5px;" title="Bu paragraf silinirse ne kaybolur? Edebî kalite ve anlatısal gereklilik ayrı ölçülür.">🧪 Silme testi / gereklilik</button>
    <div id="wsNecessityBox"></div>
    <div id="wsWork" style="margin-top:8px;"></div>

    <div style="display:flex;gap:6px;margin-top:16px;position:sticky;bottom:0;background:var(--paper);padding-top:8px;">
      <button class="btn" id="wsPrev" style="flex:1;" ${workshopState.idx === 0 ? 'disabled' : ''}>← Önceki</button>
      <button class="btn" id="wsSkip" style="flex:1;">Atla</button>
      <button class="btn btn-primary" id="wsNext" style="flex:1;">${workshopState.idx === sira.length - 1 ? 'Bitir ✓' : 'Sonraki →'}</button>
    </div>`);

  document.getElementById('workshopClose').addEventListener('click', closeWorkshop);
  wireMicroEdit(chapter, num);   // metinde ifade seçince mikro düzenleme çubuğu
  wireMicroEdit(chapter, num);   // metinde ifade seçince mikro düzenleme çubuğu
  document.getElementById('wsPurpose').addEventListener('input', (e) => {
    paraPurposes[num] = e.target.value; saveParaState();
  });
  // TEŞHİS FÜZYONU: ham bulguları tek teşhiste birleştirip sınıflandırır.
  // "tercih" sınıfına öneri üretilmez - yazarın bilinçli tercihi olabilir.
  if (kayitlar.length && !workshopState.diagnoses?.[num]) {
    (async () => {
      const kutu = document.getElementById('wsDiagnosisBox');
      if (!kutu) return;
      kutu.innerHTML = '<div style="font-size:11.5px;color:var(--text-muted);">Bulgular birleştiriliyor…</div>';
      try {
        const r = await api.post('/ai/fuse-diagnoses', {
          paragraph_text: para ? para.text : '',
          findings: kayitlar.map(k => ({ source: k.kaynak, title: k.baslik, detail: k.sorun || '' })),
          purpose: effectiveParaPurpose(num).text,
        });
        workshopState.diagnoses = workshopState.diagnoses || {};
        workshopState.diagnoses[num] = r.diagnoses;
        renderDiagnoses(num, r.diagnoses);
      } catch (e) { kutu.innerHTML = ''; }
    })();
  } else if (workshopState.diagnoses?.[num]) {
    renderDiagnoses(num, workshopState.diagnoses[num]);
  }

  document.getElementById('wsShowDirectives')?.addEventListener('click', () => {
    const kutu = document.getElementById('wsDirectiveBox');
    if (kutu.innerHTML) { kutu.innerHTML = ''; return; }
    const d = buildParagraphDirectives(num, kayitlar, para ? para.text : '');
    kutu.innerHTML = `<pre style="white-space:pre-wrap;font-size:11.5px;background:var(--paper-dim);padding:8px;border-radius:6px;margin:6px 0;">${escapeHtml(d)}</pre>`;
  });
  // UZUN PARAGRAF UYARISI: 120+ kelimelik paragraf okuma temposunu düşürür
  // ve düzenlemesi zorlaşır. Bölme önerisi AI ile yapılır - tek kelime bile
  // değişmez, sadece nereye paragraf arası konacağına karar verilir.
  const kelimeSayisi = (para ? para.text : '').split(/\s+/).filter(Boolean).length;
  if (kelimeSayisi >= 120) {
    document.getElementById('wsLongWarn').innerHTML = `
      <div style="font-size:11.5px;color:#b08d3f;border-left:3px solid #b08d3f;padding-left:8px;margin-top:8px;">
        ⚠ Bu paragraf ${kelimeSayisi} kelime - okuma temposunu düşürebilir.
        <button class="btn btn-sm" id="wsSplitPara" style="font-size:11px;margin-top:4px;">✂ Bölmeyi öner</button>
      </div>`;
    document.getElementById('wsSplitPara').addEventListener('click', async (e2) => {
      const b2 = e2.target; b2.disabled = true; b2.textContent = 'Bölünüyor…';
      try {
        const r = await api.post(`/chapters/${chapter.id}/split-preview`, { text: para.text });
        const parcalar = (r.paragraphs || []).map(x => x.text);
        const kutu = document.getElementById('wsLongWarn');
        if (parcalar.length < 2) {
          kutu.innerHTML = '<div style="font-size:11.5px;color:var(--text-muted);">Bölünecek doğal bir yer bulunamadı.</div>';
          return;
        }
        kutu.innerHTML = `
          <div class="panel" style="border-left:3px solid #b08d3f;margin-top:8px;">
            <div style="font-size:10.5px;color:var(--text-muted);letter-spacing:0.4px;">${parcalar.length} PARÇAYA BÖLÜNECEK - metin değişmez</div>
            ${parcalar.map((x, i) => `<div style="font-size:12.5px;margin-top:6px;padding-top:6px;border-top:1px dashed var(--border);"><b>${i + 1}.</b> ${escapeHtml(x)}</div>`).join('')}
            <div class="form-actions">
              <button class="btn btn-sm btn-primary" id="wsSplitApply">Böl ve kaydet</button>
              <button class="btn btn-sm" id="wsSplitCancel">Vazgeç</button>
            </div>
          </div>`;
        document.getElementById('wsSplitCancel').addEventListener('click', () => { kutu.innerHTML = ''; });
        document.getElementById('wsSplitApply').addEventListener('click', async () => {
          try {
            await applyParagraphSplit(chapter, num, parcalar);
            kutu.innerHTML = '<div style="font-size:12px;color:#3f7a4f;">✓ Bölündü.</div>';
          } catch (err) { alert(err.message); }
        });
      } catch (err) {
        document.getElementById('wsLongWarn').innerHTML = `<div class="error-text" style="font-size:11.5px;">${escapeHtml(err.message)}</div>`;
      }
      b2.disabled = false; b2.textContent = '✂ Bölmeyi öner';
    });
  }

  document.getElementById('wsNecessity').addEventListener('click', async (e) => {
    const b = e.target, kutu = document.getElementById('wsNecessityBox');
    b.disabled = true; b.textContent = 'Ölçülüyor…';
    try {
      const n = await api.post(`/ai/necessity/${chapter.id}`, {
        paragraph_text: para ? para.text : '', purpose: effectiveParaPurpose(num).text,
      });
      const kararRenk = { korunmali: '#3f7a4f', guclendirilmeli: '#b08d3f',
                          kisaltilmali: '#b08d3f', silinebilir: 'var(--danger)' }[n.verdict];
      const kararMetin = {
        korunmali: 'Korunmalı - romanın buna ihtiyacı var',
        guclendirilmeli: 'Güçlendirilmeli - SİLME, ifadesini düzelt',
        kisaltilmali: 'Kısaltılmalı - iyi yazılmış ama fazla yer kaplıyor',
        silinebilir: 'Silinebilir - hiçbir şey kaybolmaz',
      }[n.verdict];
      kutu.innerHTML = `
        <div class="panel" style="margin-top:6px;border-left:3px solid ${kararRenk};font-size:12.5px;">
          <div style="display:flex;gap:14px;flex-wrap:wrap;">
            <span>Edebî kalite: <b>${n.literary_quality}</b>/10</span>
            <span>Anlatısal gereklilik: <b>${n.narrative_necessity}</b>/10</span>
          </div>
          <div style="color:${kararRenk};font-weight:600;margin-top:4px;">${kararMetin}</div>
          <div style="color:var(--text-muted);">Silinirse kaybolur: ${n.loses.map(escapeHtml).join(', ')}</div>
          ${n.note ? `<div style="color:var(--text-muted);margin-top:2px;">${escapeHtml(n.note)}</div>` : ''}
        </div>`;
    } catch (err) { kutu.innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`; }
    b.disabled = false; b.textContent = '🧪 Silme testi / gereklilik';
  });
  document.getElementById('wsPrev').addEventListener('click', () => renderWorkshopParagraph(workshopState.idx - 1));
  document.getElementById('wsSkip').addEventListener('click', () => renderWorkshopParagraph(workshopState.idx + 1));
  document.getElementById('wsNext').addEventListener('click', () => {
    if (workshopState.idx === sira.length - 1) { renderWorkshopDone(); return; }
    renderWorkshopParagraph(workshopState.idx + 1);
  });

  // Elle kaydet: atölyede metni doğrudan düzenleyip kaydedebilmek şart -
  // bazen AI'ya hiç gerek olmuyor, tek kelime değişecek.
  document.getElementById('wsSaveManual').addEventListener('click', async () => {
    const yeni = document.getElementById('wsParaText').innerText.trim();
    if (!yeni) return;
    const durum = document.getElementById('wsSaveState');
    durum.textContent = 'kaydediliyor…';
    await replaceParagraphText(ch.id, num, yeni);
    resolvedParas.add(String(num)); saveParaState();
    if (para) para.text = yeni;
    durum.textContent = '✓ kaydedildi';
  });

  document.getElementById('wsFix').addEventListener('click', async (e) => {
    const b = e.target; b.disabled = true; b.textContent = 'Öneriler yazılıyor…';
    await workshopFix(ch, num, issue || 'Bu paragrafı güçlendir.');
    b.disabled = false; b.textContent = '✨ 3 öneri getir';
  });
  document.getElementById('wsChat').addEventListener('click', () => {
    const box = document.getElementById('wsWork');
    if (box.dataset.mode === 'chat') { box.innerHTML = ''; box.dataset.mode = ''; return; }
    box.dataset.mode = 'chat';
    box.innerHTML = `
      <div class="para-chat-log" data-number="${num}" style="max-height:220px;overflow-y:auto;font-size:12.5px;"></div>
      <div style="display:flex;gap:6px;margin-top:6px;">
        <textarea class="para-chat-input" data-number="${num}" placeholder="Ör: hüznü çıkar, masum kalsın" style="flex:1;min-height:38px;box-sizing:border-box;font-size:12.5px;"></textarea>
        <button class="btn btn-sm btn-primary" id="wsChatSend">Gönder</button>
      </div>
      <button class="btn btn-sm" id="wsChatWrite" style="margin-top:6px;width:100%;font-size:11.5px;">✍️ Konuştuklarımıza göre yaz</button>`;
    renderParaChatLog(num);
    document.getElementById('wsChatSend').addEventListener('click', () => sendParagraphChat(ch, num, '', para ? para.text : ''));
    document.getElementById('wsChatWrite').addEventListener('click', () => writeParagraphVersion(ch, num, '', para ? para.text : ''));
  });
}

// ---------------------------------------------------------------------------
// DİREKTİF SENTEZİ: edebî + okur testlerinin bulgularını TEK bir kural
// listesine çevirir. Eksik olan halka buydu - bulgular ham hâlde talimata
// yapıştırılıyordu ve (daha kötüsü) altın kelimeye tıklayıp alternatif
// istendiğinde bu kurallar hiç gitmiyordu; kelime kuralsız değişiyordu.
// Artık hem 3 seçenek hem tek kelime AYNI direktiflere uyar.
// Sentez yereldir (ek AI isteği yok): DEĞİŞTİR / KORU / KAÇIN başlıkları.
// ---------------------------------------------------------------------------
function buildParagraphDirectives(num, kayitlar, paraText) {
  const etiket = { editor: '[editör]', okur: '[okur]', imge: '[imge]' };
  const degistir = (kayitlar || []).map(k =>
    `${etiket[k.kaynak] || '[okur]'} ${k.baslik}: ${k.sorun || ''}${k.oneri ? ' → ' + k.oneri : ''}`);

  // KORU: metindeki somut veriler (kaybolmamalı - kabul kontrolü de bunu arar)
  const sayilar = (paraText.match(/\b\d+(?:[.,]\d+)?\b/g) || []);
  const isimler = (paraText.match(/\b[A-ZÇĞİÖŞÜ][a-zçğıöşü]{2,}\b/g) || []);
  const koru = [...new Set([...sayilar, ...isimler])].slice(0, 12);

  // KAÇIN: üslup taramasında eşiği aşmış kalıplar (varsa)
  const kacin = (window.__styleBanned || []).slice(0, 8);

  const purpose = effectiveParaPurpose(num).text;
  const satirlar = [];
  if (purpose) satirlar.push(`İŞLEV (öncelikli ölçüt): ${purpose}`);
  if (degistir.length) satirlar.push('DEĞİŞTİR (testlerden çıkan bulgular):\n- ' + degistir.join('\n- '));
  if (koru.length) satirlar.push(
    'KORU - bu veriler yeni metinde AYNEN geçmeli (kontrol bunları arar): ' + koru.join(', '));
  if (kacin.length) satirlar.push('KAÇIN (aşırı kullanılmış kalıplar): ' + kacin.join(', '));
  satirlar.push('DAİMA: eylem sırasını bozma, olay akışını ve zamanı koru, '
    + '"sanki/gibi/adeta" ile açıklama yapma, yargı sıfatı kullanma.');
  // ÜRETİM, DENETİMİ ÖNCEDEN BİLSİN: aynı ölçütlerle üretilmeyen metin
  // kontrolde takılıyor ve döngü kuruluyordu. Kontrol listesi burada.
  // EN KÜÇÜK ETKİLİ MÜDAHALE: model "paragrafı baştan yazalım, yeni sembol
  // ekleyelim" eğilimindeydi. Teşhisi giderecek EN AZ değişiklik istenir.
  satirlar.push('MÜDAHALE ÖLÇÜSÜ: teşhisi gideren EN KÜÇÜK ETKİLİ değişikliği yap. '
    + 'Sorun tek bir cümledeyse sadece o cümleyi değiştir; paragrafı baştan yazma. '
    + 'İşe yarayan cümleleri AYNEN koru.');
  // KANON DIŞI EKLEME YASAĞI: model olmayan geçmiş/olay/nesne uyduruyordu
  satirlar.push('YENİ BİLGİ EKLEME YASAĞI: metinde ya da kayıtlarda BULUNMAYAN '
    + 'karakter geçmişi, olay, nesne, ilişki, motivasyon EKLEME. '
    + '("Çocukluğunda babası dövmüştü" gibi uydurma geçmiş yasak.) '
    + 'Önerinin uygulanması mevcut kanondan mümkün olmalı.');
  satirlar.push('YAZDIKTAN SONRA KENDİ METNİNİ ŞU KONTROLDEN GEÇİR (kontrol bunlara bakacak): '
    + '(1) yukarıdaki KORU listesindeki her veri metinde var mı, '
    + '(2) paragrafın işlevi yerine geliyor mu, '
    + '(3) tamamlanmış bir eylemi yeniden başlattın mı, '
    + '(4) komşu paragraflarda geçen bir imgeyi tekrarladın mı. '
    + 'Bir madde bile ihlal ediliyorsa o seçeneği DÜZELT, öyle yaz.');
  return satirlar.join('\n');
}

// Üslup taramasındaki yasak kalıpları bir kez yükle (kaçınma listesi)
// Kayıtlı karakter/mekan/nesne adları: kontrolün "korunmalı" ölçütü.
async function loadCanonNames() {
  try {
    const [k, m, n] = await Promise.all([
      api.get('/characters/'), api.get('/places/'), api.get('/objects/'),
    ]);
    const isimler = [];
    [k, m, n].forEach(liste => (liste || []).forEach(x => {
      if (x.name) isimler.push(x.name);
      (x.aliases || []).forEach(a => a && isimler.push(a));
    }));
    window.__canonNames = [...new Set(isimler)].filter(a => a.length > 2);
  } catch (e) { window.__canonNames = []; }
}

async function loadBannedPatterns() {
  try {
    const rapor = await api.get('/style/report');
    window.__styleBanned = (rapor.patterns || []).filter(p => p.exceeded).map(p => p.name);
  } catch (e) { window.__styleBanned = []; }
}

// Atölyede 3 seçenekli öneri (mobil: tam genişlik kartlar)
async function workshopFix(chapter, num, issue) {
  // SAVUNMA: kapsayıcı yoksa (kullanıcı bu arada başka paragrafa geçtiyse)
  // çökmek yerine sessizce çık. "Cannot set properties of null" hatası
  // buradan geliyordu.
  const box = document.getElementById('wsWork');
  if (!box) return;
  box.dataset.mode = 'fix';
  box.innerHTML = '<div class="empty-state">Üç seçenek hazırlanıyor…</div>';
  const para = (chapter.paragraphs || []).find(p => p.number === num);
  const kayitlar = workshopState.findings[num] || [];
  // Görülen versiyonlar: "farklı 3 öneri" gerçekten farklı gelsin diye
  // önceki turlarda üretilenler talimatta AÇIKÇA dışlanır.
  workshopState.seen = workshopState.seen || {};
  const gorulenler = workshopState.seen[num] || [];
  await loadBannedPatterns();   // kaçınma listesi taze olsun (düzelttikçe değişiyor)
  const direktifler = buildParagraphDirectives(num, kayitlar, para ? para.text : '');
  workshopState.directives = workshopState.directives || {};
  workshopState.directives[num] = direktifler;
  workshopState.lastGoal = workshopState.lastGoal || {};
  workshopState.lastGoal[num] = (kayitlar.map(k => k.baslik).join(', ') || issue).slice(0, 300);   // kelime bazlı istekler de bunu kullanır
  const instruction =
    `P${num} paragrafını aşağıdaki DİREKTİFLERE göre yeniden yaz.\n${direktifler}\n`
    + (issue && !kayitlar.length ? `EK NOT: ${issue}\n` : '')
    + 'BETİMLEME MATEMATİĞİ: geniş plan (en fazla iki nitelik) → orta plan → MİKRO DETAY (anlamı taşısın) '
    + '→ bir duyu (görme dışında) → anlamı SÖYLEME. Bütçe: en fazla bir benzetme, "sanki/gibi/adeta" ile '
    + 'açıklama yok, yargı sıfatı yok.\n'
    + 'ÜÇ FARKLI YAKLAŞIM üret (aynı fikrin varyasyonu DEĞİL): biri mikro detaya, '
    + 'biri sese/sessizliğe, biri harekete yaslansın.\n'
    + (gorulenler.length
        ? 'DAHA ÖNCE ŞU VERSİYONLARI ÜRETTİN - HİÇBİRİNİ TEKRARLAMA, benzerini de yazma:\n'
          + gorulenler.map((t, i) => `(${i + 1}) ${t.slice(0, 180)}`).join('\n')
          + '\nTamamen farklı üç yol dene: farklı giriş cümlesi, farklı odak, farklı duyu.\n'
        : '')
    + `UZUNLUK BÜTÇESİ: mevcut paragraf ${(para ? para.text : '').split(/\s+/).filter(Boolean).length} kelime. `
    + 'Yeni hâli bunun %70-140 aralığında kalsın - her turda uzayıp komşu paragrafların '
    + 'ritmini bozmasın.\n'
    + 'BİÇİM (kesin): her seçeneği şöyle yaz, arada başka hiçbir şey olmasın:\n'
    + '###YAKLAŞIM: mikro detay | NEDEN: tek cümlelik gerekçe\n<paragrafın tam yeni hâli>\n'
    + '###YAKLAŞIM: ses ve sessizlik | NEDEN: ...\n<paragrafın tam yeni hâli>\n'
    + '###YAKLAŞIM: hareket | NEDEN: ...\n<paragrafın tam yeni hâli>\n'
    + 'Açıklama, başlık, tırnak, madde işareti EKLEME. Her seçenek paragrafın '
    + 'TAMAMI olsun - kısmi cümle değil.';
  try {
    const result = await api.post('/ai/assist', {
      chapter_number: chapter.number, instruction,
      selected_entities: [], existing_text: para ? para.text : '',
    });
    const secenekler = parseOptionBlocks(result.generated_text || '');
    // Üretilenleri belleğe al (sonraki turda dışlanacak - son 6 tanesi yeter)
    workshopState.seen[num] = [...gorulenler, ...secenekler.map(o => o.text)].slice(-6);

    // KAYDIRMALI KARTLAR: mobilde üç seçeneği alt alta okumak yorucu;
    // parmakla sağa/sola geçilen tek kart daha doğal. Noktalar hangi
    // seçenekte olduğunu gösterir, klavyeyle de gezilebilir.
    if (!secenekler.length) {
      box.innerHTML = '<div class="error-text" style="font-size:12.5px;">AI boş yanıt döndürdü. Tekrar dene ya da "💬 Konuş" ile yönlendir.</div>';
      return;
    }
    const eskiMetin = para ? para.text : '';
    // ÜRETİLDİĞİ ANDA DENETİM: her seçenek için ücretsiz/anlık kontrol
    // (sayı-isim kaybı) hemen çalışır ve karta rozet olarak basılır. Böylece
    // "uygula -> kontrol -> geri dön -> yeniden yaz" döngüsüne girmeden
    // hangi seçeneğin temiz olduğunu görüp doğrudan seçersin.
    secenekler.forEach(o => { o.quick = quickFactCheck(eskiMetin, o.text); });
    box.innerHTML = `
      <div class="option-swiper" tabindex="0">
        ${secenekler.map((o, i) => `
          <div class="option-card" data-idx="${i}">
            <div style="display:flex;justify-content:space-between;align-items:baseline;gap:6px;">
              <div style="font-size:10.5px;color:var(--gold);font-weight:600;">SEÇENEK ${i + 1}/${secenekler.length}${o.approach ? ' · ' + escapeHtml(o.approach) : ''}</div>
              <div class="opt-badge" data-idx="${i}" style="font-size:10.5px;color:${o.quick.length ? 'var(--danger)' : '#3f7a4f'};white-space:nowrap;">
                ${o.quick.length ? `⚠ ${o.quick.length} uyarı` : '✓ temiz'}
              </div>
            </div>
            ${o.reason ? `<div style="font-size:11.5px;color:var(--text-muted);margin-top:3px;font-style:italic;">${escapeHtml(o.reason)}</div>` : ''}
            ${o.quick.length ? `<div style="font-size:11px;color:var(--danger);margin-top:3px;">${o.quick.map(escapeHtml).join('<br>')}</div>` : ''}
            <div style="white-space:pre-wrap;font-size:13px;margin-top:4px;line-height:1.65;">${highlightDiff(eskiMetin, o.text)}</div>
            <div style="font-size:10.5px;color:var(--text-muted);margin-top:4px;">Altın = değişen, siyah = korunan · altına tıkla: alternatif iste</div>
            <div class="opt-deep" data-idx="${i}"></div>
            <button class="btn btn-sm btn-primary ws-apply" data-idx="${i}" style="margin-top:8px;width:100%;font-size:11.5px;">Bunu uygula</button>
          </div>`).join('')}
      </div>
      <div class="option-dots">
        ${secenekler.map((_, i) => `<span class="option-dot${i === 0 ? ' active' : ''}" data-idx="${i}"></span>`).join('')}
        <span style="font-size:11px;color:var(--text-muted);margin-left:6px;">← kaydır →</span>
      </div>
      <button class="btn btn-sm" id="wsDeepAll" style="width:100%;margin-top:6px;font-size:11.5px;" title="Üç seçeneği de işlev, süreklilik ve eylem sırası açısından denetler">🔎 Üçünü de derin kontrol et</button>
      <button class="btn btn-sm" id="wsMoreOptions" style="width:100%;margin-top:6px;font-size:11.5px;">🔄 Farklı 3 öneri getir</button>
      <div id="wsPhraseBox"></div>`;
    wireOptionSwiper(box);

    // TOPLU DERİN KONTROL: üçünü birden denetler, sonuçları kartlara yazar.
    // Tek tek uygulayıp geri dönmek yerine hepsini önden görürsün.
    document.getElementById('wsDeepAll').addEventListener('click', async (e) => {
      const b = e.target; b.disabled = true; b.textContent = 'Üçü denetleniyor…';
      const sonuclar = await Promise.all(secenekler.map(o =>
        verifyBeforeApply(chapter.id, num, eskiMetin, o.text)));
      sonuclar.forEach((v, i) => {
        secenekler[i].deep = v;
        const renk = { kabul: '#3f7a4f', duzelt: '#b08d3f', red: 'var(--danger)' }[v.verdict] || 'var(--text-muted)';
        const etiket = { kabul: '✓ kabul', duzelt: '⚠ düzeltilmeli', red: '✕ red' }[v.verdict] || v.verdict;
        const rozet = box.querySelector(`.opt-badge[data-idx="${i}"]`);
        if (rozet) { rozet.style.color = renk; rozet.textContent = etiket; }
        const kutu = box.querySelector(`.opt-deep[data-idx="${i}"]`);
        const bulgular = [...(v.hard_issues || []), ...(v.issues || [])];
        if (kutu) kutu.innerHTML = `
          <div style="font-size:11px;color:var(--text-muted);margin-top:6px;border-top:1px dashed var(--border);padding-top:4px;">
            ${v.note ? escapeHtml(v.note) : ''}
            ${bulgular.length ? `<ul style="margin:4px 0 0 14px;padding:0;">${bulgular.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul>` : ''}
          </div>`;
      });
      // En iyi seçeneği işaretle
      const enIyi = sonuclar.findIndex(v => v.verdict === 'kabul');
      if (enIyi >= 0) {
        const kart = box.querySelector(`.option-card[data-idx="${enIyi}"]`);
        if (kart) kart.style.borderColor = '#3f7a4f';
      }
      b.disabled = false; b.textContent = '🔎 Üçünü de derin kontrol et';
    });

    // FARKLI 3 ÖNERİ: önceki yaklaşımları dışlayarak yeniden üret
    document.getElementById('wsMoreOptions').addEventListener('click', async (e) => {
      const b = e.target; b.disabled = true; b.textContent = 'Yeni seçenekler…';
      const oncekiler = secenekler.map(o => o.approach).filter(Boolean).join(', ');
      await workshopFix(chapter, num, issue
        + (oncekiler ? ` ÖNCEKİ YAKLAŞIMLARI TEKRARLAMA (${oncekiler}); tamamen farklı üç yol dene.` : ''));
    });

    // İFADE BAZLI DEĞİŞTİRME: altın bir öbeğe tıkla -> sadece o ifade için
    // alternatifler. Tüm paragrafı yeniden yazdırmadan nokta atışı düzeltme.
    box.querySelectorAll('.diff-clickable').forEach(sp => sp.addEventListener('click', () =>
      openPhraseAlternatives(chapter, num, sp, secenekler)));
    box.querySelectorAll('.ws-apply').forEach(b => b.addEventListener('click', async (e) => {
      const secenek = secenekler[parseInt(e.target.dataset.idx, 10)];
      const secilen = secenek.text;
      const eski = para ? para.text : '';
      // Zaten denetlenmiş ve TEMİZ ise ikinci kez kontrol etme - kullanıcı
      // sonucu görerek seçti, tekrar sormak gereksiz sürtünme.
      if (secenek.deep && secenek.deep.verdict === 'kabul' && !secenek.quick.length) {
        await replaceParagraphText(chapter.id, num, secilen);
        resolvedParas.add(String(num)); saveParaState();
        if (para) para.text = secilen;
        document.getElementById('wsParaText').textContent = secilen;
        box.innerHTML = `
          <div style="font-size:12.5px;color:#3f7a4f;">✓ Kaydedildi (denetimden geçmişti).</div>
          <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;">
            <button class="btn btn-sm" id="wsRefine" style="font-size:11.5px;">✨ Bunu da geliştir</button>
            <button class="btn btn-sm btn-primary" id="wsGoNext" style="font-size:11.5px;">Sonraki paragraf →</button>
          </div>`;
        document.getElementById('wsRefine').addEventListener('click', () =>
          workshopFix(chapter, num, 'Metni bir tur daha güçlendir; aynı yaklaşımları tekrarlama.'));
        document.getElementById('wsGoNext').addEventListener('click', () => {
          const sira = workshopState.order;
          if (workshopState.idx === sira.length - 1) renderWorkshopDone();
          else renderWorkshopParagraph(workshopState.idx + 1);
        });
        return;
      }
      e.target.insertAdjacentElement('afterend', renderQuickCheck(
        eski, secilen,
        async () => {
          await replaceParagraphText(chapter.id, num, secilen);
          resolvedParas.add(String(num)); saveParaState();
          if (para) para.text = secilen;
          document.getElementById('wsParaText').textContent = secilen;
          box.innerHTML = `
            <div style="font-size:12.5px;color:#3f7a4f;">✓ Kaydedildi.</div>
            <div id="wsRetest" style="margin-top:8px;font-size:12.5px;color:var(--text-muted);">Bulgular yeniden sınanıyor…</div>
            <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;">
              <button class="btn btn-sm" id="wsRefine" style="font-size:11.5px;">✨ Bunu da geliştir</button>
              <button class="btn btn-sm" id="wsUndo" style="font-size:11.5px;" title="Bu paragrafı önceki hâline döndür">↩ Geri al</button>
              <button class="btn btn-sm btn-primary" id="wsGoNext" style="font-size:11.5px;">Sonraki paragraf →</button>
            </div>`;
          // GERİ ALMA: uyguladıktan sonra pişman olunca atölyeden çıkmak
          // gerekmesin - eski metin elimizde, tek tıkla geri yazılır.
          document.getElementById('wsUndo').addEventListener('click', async () => {
            await replaceParagraphText(chapter.id, num, eski);
            if (para) para.text = eski;
            document.getElementById('wsParaText').textContent = eski;
            resolvedParas.delete(String(num)); saveParaState();
            box.innerHTML = '<div style="font-size:12.5px;color:var(--text-muted);">↩ Önceki hâline döndürüldü.</div>';
          });
          // YENİDEN TEST: bulgular gerçekten giderildi mi? Kabul kontrolü
          // "detay düştü mü" bakıyordu; bu "klişe kalktı mı" bakıyor.
          runParagraphRetest(num, eski, secilen, kayitlar);
          // Kaydettikten sonra da yol açık: metin üzerinde tekrar çalışılabilir
          document.getElementById('wsRefine').addEventListener('click', () =>
            workshopFix(chapter, num, 'Metni bir tur daha güçlendir; aynı yaklaşımları tekrarlama.'));
          document.getElementById('wsGoNext').addEventListener('click', () => {
            const sira = workshopState.order;
            if (workshopState.idx === sira.length - 1) renderWorkshopDone();
            else renderWorkshopParagraph(workshopState.idx + 1);
          });
        },
        () => verifyBeforeApply(chapter.id, num, eski, secilen),
        (uyarilar, not) => openWorkshopVerifyChat(chapter, num, eski, secilen, uyarilar, not),
      ));
    }));
  } catch (err) {
    box.innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`;
  }
}

function renderWorkshopDone() {
  const ov = document.getElementById('workshopOverlay');
  const sira = workshopState.order;
  const cozulen = sira.filter(n => resolvedParas.has(String(n))).length;
  ov.innerHTML = workshopShell('Tamamlandı', 3, `
    <div style="text-align:center;padding:20px 0;">
      <div style="font-size:40px;">${cozulen === sira.length ? '🎉' : '📝'}</div>
      <div style="font-size:16px;font-weight:600;margin-top:8px;">${cozulen}/${sira.length} paragraf düzeltildi</div>
      <div style="font-size:12.5px;color:var(--text-muted);margin-top:4px;">
        ${cozulen === sira.length ? 'Tüm bulgular ele alındı.' : `${sira.length - cozulen} paragraf atlandı - istediğinde geri dönebilirsin.`}
      </div>
    </div>
    <div style="display:flex;gap:8px;">
      <button class="btn" id="wsAgain" style="flex:1;">Yeniden incele</button>
      <button class="btn btn-primary" id="wsFinish" style="flex:1;">Bitir</button>
    </div>`);
  document.getElementById('workshopClose').addEventListener('click', closeWorkshop);
  document.getElementById('wsAgain').addEventListener('click', renderWorkshopReview);
  document.getElementById('wsFinish').addEventListener('click', closeWorkshop);
}

// ---------------------------------------------------------------------------
// ATÖLYE SEÇİCİ: hangi bölüm/kısım üzerinde çalışılacağını Denetim menüsünden
// seçmek. Atölye eskiden yalnızca AÇIK bölümden başlatılabiliyordu; 56
// bölümlük bir romanda "hangisini elden geçireceğim" sorusu tek yerde
// cevaplanmalı. Liste hiyerarşik numaralarla gelir ve her girdinin DURUMU
// görünür: özet var mı, kaç paragraf, daha önce elden geçirilmiş mi.
// ---------------------------------------------------------------------------
async function renderWorkshopPicker(el) {
  el.innerHTML = '<div class="empty-state">Fihrist yükleniyor…</div>';
  try {
    const tumu = await api.get('/chapters/');
    const hiyerarsi = buildChapterHierarchy(tumu);
    const metinliler = hiyerarsi.filter(it => (it.chapter.paragraph_count || 0) > 0);
    if (!metinliler.length) {
      el.innerHTML = '<div class="empty-state">Henüz metin yazılmış bir bölüm yok.</div>';
      return;
    }

    const durum = (c) => {
      const ozet = (c.summary || '').trim();
      let elden = 0;
      try {
        const raw = localStorage.getItem(`roman_para_state_${c.id}`);
        if (raw) elden = (JSON.parse(raw).resolved || []).length;
      } catch (e) { /* yoksay */ }
      return { ozet: !!ozet, elden };
    };

    el.innerHTML = `
      <p style="font-size:12.5px;color:var(--text-muted);margin-top:0;max-width:680px;">
        Elden geçirilecek girdiyi seç. Atölye üç adımda ilerler: <b>hazırlık</b> (özet,
        zaman çizelgesi, plan) → <b>inceleme</b> (editör + okur gözü) → <b>paragraf paragraf düzeltme</b>.
        Mobilde tam ekran çalışır.
      </p>
      <input type="text" id="wsFilter" placeholder="Başlıkta ara…" style="max-width:280px;margin-bottom:8px;">
      <div id="wsPickerList">
        ${metinliler.map(it => {
          const c = it.chapter;
          const d = durum(c);
          const tur = c.kind === 'part' ? 'ÜST' : (c.kind === 'subtitle' ? 'ARA' : 'metin');
          return `
          <div class="entity-row ws-pick-row" data-title="${escapeHtml((c.title || '').toLowerCase())}" data-id="${c.id}" style="flex-wrap:wrap;">
            <div style="flex:1;min-width:220px;">
              <div class="name">#${it.displayNumber} ${escapeHtml(stripMarkdownArtifacts(c.title) || '(başlıksız)')}</div>
              <div class="desc" style="display:flex;gap:8px;flex-wrap:wrap;font-size:11.5px;">
                <span>${c.paragraph_count} paragraf</span>
                <span style="color:${d.ozet ? '#3f7a4f' : 'var(--danger)'}">${d.ozet ? '✓ özet var' : '✗ özet yok'}</span>
                ${d.elden ? `<span style="color:#3f7a4f;">✓ ${d.elden} paragraf elden geçmiş</span>` : ''}
                <span style="color:var(--text-muted);">[${tur}]</span>
              </div>
            </div>
            <div class="actions">
              <button class="btn btn-sm btn-primary ws-open" data-id="${c.id}">🛠 Atölyeyi aç</button>
              <button class="btn btn-sm ws-goto" data-id="${c.id}">Bölüme git</button>
            </div>
          </div>`;
        }).join('')}
      </div>`;

    el.querySelector('#wsFilter').addEventListener('input', (e) => {
      const q = _trLowerJs(e.target.value.trim());
      el.querySelectorAll('.ws-pick-row').forEach(row => {
        row.style.display = !q || _trLowerJs(row.dataset.title).includes(q) ? '' : 'none';
      });
    });
    el.querySelectorAll('.ws-open').forEach(b => b.addEventListener('click', async () => {
      b.disabled = true; b.textContent = 'Açılıyor…';
      try {
        const ch = await api.get(`/chapters/${b.dataset.id}`);
        currentChapter = ch;                 // atölye içindeki işlemler bunu kullanır
        loadParaState(ch.id);                // o bölümün önceki kararları
        openChapterWorkshop(ch);
      } catch (err) { alert(err.message); }
      b.disabled = false; b.textContent = '🛠 Atölyeyi aç';
    }));
    el.querySelectorAll('.ws-goto').forEach(b => b.addEventListener('click', () => {
      switchView('roman');
      setTimeout(() => loadChapterList(parseInt(b.dataset.id, 10)), 200);
    }));
  } catch (err) {
    el.innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`;
  }
}

// Seçenek kartları arası kaydırma: dokunmatikte parmakla, masaüstünde
// ok tuşları ve noktalarla. scroll-snap sayesinde kart tam ortalanır.
function wireOptionSwiper(box) {
  const swiper = box.querySelector('.option-swiper');
  const dots = box.querySelectorAll('.option-dot');
  if (!swiper) return;
  const guncelle = () => {
    const kartGenislik = swiper.querySelector('.option-card')?.offsetWidth || 1;
    const aktif = Math.round(swiper.scrollLeft / kartGenislik);
    dots.forEach((d, i) => d.classList.toggle('active', i === aktif));
  };
  swiper.addEventListener('scroll', () => { window.requestAnimationFrame(guncelle); });
  dots.forEach(d => d.addEventListener('click', () => {
    const kartGenislik = swiper.querySelector('.option-card')?.offsetWidth || 0;
    swiper.scrollTo({ left: kartGenislik * parseInt(d.dataset.idx, 10), behavior: 'smooth' });
  }));
  swiper.addEventListener('keydown', (e) => {
    const kartGenislik = swiper.querySelector('.option-card')?.offsetWidth || 0;
    if (e.key === 'ArrowRight') { e.preventDefault(); swiper.scrollBy({ left: kartGenislik, behavior: 'smooth' }); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); swiper.scrollBy({ left: -kartGenislik, behavior: 'smooth' }); }
  });
}

// ---------------------------------------------------------------------------
// SEÇENEK AYRIŞTIRMA: "###YAKLAŞIM: x" satırlarıyla ayrılmış blokları okur.
// Neden JSON değil: /ai/assist düz metin üretmeye ayarlı; JSON istendiğinde
// model kimi zaman hiç metin döndürmüyor ve kart BOŞ görünüyordu. Ayraç,
// metin modelleri için çok daha dayanıklı - bozulsa bile ham metin kalır.
// ---------------------------------------------------------------------------
function parseOptionBlocks(raw) {
  const metin = (raw || '').trim();
  if (!metin) return [];
  const parcalar = metin.split(/^###\s*YAKLAŞIM\s*:?\s*/im).filter(x => x.trim());
  if (parcalar.length <= 1) {
    // Ayraç yok - tek seçenek olarak ele al (JSON geldiyse temizle)
    const temiz = metin.replace(/^```(?:json)?|```$/gm, '').trim();
    try {
      const veri = JSON.parse(temiz.slice(temiz.indexOf('{'), temiz.lastIndexOf('}') + 1));
      const opts = (veri.options || []).filter(o => (o.text || '').trim());
      if (opts.length) return opts.map(o => ({ text: o.text.trim(), approach: (o.approach || '').trim() }));
    } catch (e) { /* düz metin */ }
    return [{ text: temiz, approach: '' }];
  }
  return parcalar.map(p => {
    const satirlar = p.split('\n');
    const bas = satirlar[0].trim();
    // "yaklaşım | NEDEN: gerekçe" biçimini ayır
    const m = bas.match(/^(.*?)\s*\|\s*NEDEN\s*:?\s*(.*)$/i);
    const approach = (m ? m[1] : bas).trim().slice(0, 40);
    const reason = (m ? m[2] : '').trim().slice(0, 160);
    const text = satirlar.slice(1).join('\n').trim();
    return { text, approach, reason };
  }).filter(o => o.text);
}

// ---------------------------------------------------------------------------
// FARK VURGULAMA: önerinin DEĞİŞEN kısımları altın, korunan kısımlar siyah.
// Kelime bazlı LCS - "neresi değişmiş" sorusunu okumadan görebilmek için.
// ---------------------------------------------------------------------------
function highlightDiff(eski, yeni) {
  const a = (eski || '').split(/(\s+)/);
  const b = (yeni || '').split(/(\s+)/);
  // LCS tablosu (kelime sayısı makul: paragraf ölçeği)
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  // Ardışık değişen kelimeler TEK öbekte toplanır: "cam kılıf" iki ayrı
  // span değil, tıklanıp topluca değiştirilebilen bir ifade olur.
  let i = 0, j = 0;
  const parcalar = [];   // {changed: bool, text: string}
  const ekle = (changed, text) => {
    const son = parcalar[parcalar.length - 1];
    if (son && son.changed === changed) son.text += text;
    else parcalar.push({ changed, text });
  };
  while (i < n && j < m) {
    if (a[i] === b[j]) { ekle(false, b[j]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { i++; }
    else { ekle(true, b[j]); j++; }
  }
  while (j < m) { ekle(true, b[j]); j++; }

  return parcalar.map((p, idx) => {
    if (!p.changed || !p.text.trim()) return escapeHtml(p.text);
    return `<span class="diff-new diff-clickable" data-phrase="${escapeHtml(p.text.trim())}" data-pi="${idx}" title="Tıkla: bu ifade için alternatif iste">${escapeHtml(p.text)}</span>`;
  }).join('');
}

// ---------------------------------------------------------------------------
// İFADE BAZLI ALTERNATİF: önerideki altın (değişmiş) bir öbeğe tıklayınca
// SADECE o ifade için üç alternatif ister. Tüm paragrafı yeniden yazdırmak
// yerine nokta atışı düzeltme - "cam kılıf yerine başka ne olur?" sorusunun
// doğrudan cevabı. Seçilen alternatif kartın metnine yerinde işlenir.
// ---------------------------------------------------------------------------
async function openPhraseAlternatives(chapter, num, spanEl, secenekler) {
  const box = document.getElementById('wsPhraseBox');
  if (!box) return;
  const ifade = spanEl.dataset.phrase;
  const kart = spanEl.closest('.option-card');
  const idx = parseInt(kart?.dataset.idx || '0', 10);
  const tamMetin = secenekler[idx]?.text || '';

  box.innerHTML = `<div class="panel" style="margin-top:8px;">
    <div style="font-size:12px;">"<b>${escapeHtml(ifade)}</b>" için alternatifler aranıyor…</div></div>`;
  // Kelime bazlı istek de AYNI direktiflere uyar: testlerden çıkan kurallar,
  // korunacak veriler ve kaçınılacak kalıplar burada da geçerli. Eskiden
  // kelime kuralsız değişiyordu ve paragrafın geri kalanıyla çelişebiliyordu.
  const direktifler = (workshopState.directives && workshopState.directives[num])
    || buildParagraphDirectives(num, workshopState.findings[num] || [], tamMetin);
  const instruction =
    `Aşağıdaki paragrafta geçen "${ifade}" ifadesi için ÜÇ ALTERNATİF öner.\n`
    + `UYULACAK DİREKTİFLER (paragrafın tamamı için geçerli):\n${direktifler}\n`
    + 'Kurallar: alternatifler aynı uzunluk mertebesinde olsun, paragrafın akışına ve '
    + 'zamanına uysun, klişe olmasın. Sadece ifadeyi ver, cümleyi yeniden yazma.\n'
    + 'BİÇİM: her satırda tek alternatif, başına "- " koy, başka hiçbir şey yazma.\n'
    + `PARAGRAF:\n${tamMetin}`;
  try {
    const r = await api.post('/ai/assist', {
      chapter_number: chapter.number, instruction, selected_entities: [], existing_text: ifade,
    });
    const alternatifler = (r.generated_text || '').split('\n')
      .map(x => x.replace(/^[-*•]\s*/, '').trim())
      .filter(x => x && x.length < 200).slice(0, 5);
    if (!alternatifler.length) {
      box.innerHTML = '<div class="error-text" style="font-size:12px;">Alternatif üretilemedi.</div>';
      return;
    }
    box.innerHTML = `
      <div class="panel" style="margin-top:8px;">
        <div style="font-size:11px;color:var(--text-muted);letter-spacing:0.4px;">"${escapeHtml(ifade)}" YERİNE</div>
        ${alternatifler.map((a, i) => `
          <button class="btn btn-sm phrase-pick" data-alt="${escapeHtml(a)}" style="display:block;width:100%;text-align:left;margin-top:6px;font-size:12.5px;">${escapeHtml(a)}</button>`).join('')}
        <button class="btn btn-sm" id="phraseClose" style="margin-top:8px;font-size:11.5px;">Kapat</button>
      </div>`;
    document.getElementById('phraseClose').addEventListener('click', () => { box.innerHTML = ''; });
    box.querySelectorAll('.phrase-pick').forEach(b => b.addEventListener('click', () => {
      // Seçilen alternatifi kartın metnine YERİNDE işle
      const yeni = tamMetin.replace(ifade, b.dataset.alt);
      secenekler[idx].text = yeni;
      const govde = kart.querySelector('div[style*="white-space:pre-wrap"]');
      const para = (chapter.paragraphs || []).find(p => p.number === num);
      if (govde) govde.innerHTML = highlightDiff(para ? para.text : '', yeni);
      kart.querySelectorAll('.diff-clickable').forEach(sp => sp.addEventListener('click', () =>
        openPhraseAlternatives(chapter, num, sp, secenekler)));
      box.innerHTML = '<div style="font-size:12px;color:#3f7a4f;margin-top:6px;">✓ İfade değiştirildi - kartta güncellendi.</div>';
    }));
  } catch (err) {
    box.innerHTML = `<div class="error-text" style="font-size:12px;">${escapeHtml(err.message)}</div>`;
  }
}

// Düzeltme sonrası yeniden test: her bulgunun durumu ayrı ayrı gösterilir.
// BULGU BAZLI ÇÖZÜM: paragraf ancak TÜM bulguları giderildiyse "çözüldü"
// sayılır; kısmi kalanlar listede durur (eskiden ilk düzeltmede paragrafın
// tamamı çözülmüş sayılıyor, kalan bulgular gözden kayboluyordu).
async function runParagraphRetest(num, eskiMetin, yeniMetin, kayitlar) {
  const kutu = document.getElementById('wsRetest');
  if (!kutu) return;
  const bulguMetinleri = (kayitlar || []).map(k => `${k.baslik}: ${k.sorun || ''}`);
  if (!bulguMetinleri.length) { kutu.innerHTML = ''; return; }
  try {
    const r = await api.post('/ai/retest-paragraph', {
      old_text: eskiMetin, new_text: yeniMetin, findings: bulguMetinleri,
      proposal_goal: (workshopState.lastGoal && workshopState.lastGoal[num]) || '',
      expected_effect: bulguMetinleri.join(' | '),
    });
    const simge = { giderildi: '✅', kismen: '🟡', giderilmedi: '❌' };
    const kalanlar = r.results.filter(x => x.status !== 'giderildi');
    const yon = { iyilesti: '#3f7a4f', ayni: '#b08d3f', kotulesti: 'var(--danger)' }[r.verdict];
    kutu.innerHTML = `
      <div style="border-left:3px solid ${yon};padding-left:8px;">
        <div style="font-weight:600;color:${yon};">Yeniden test: ${escapeHtml(r.verdict)}</div>
        ${r.results.map(x => `<div>${simge[x.status] || '•'} ${escapeHtml(x.finding)}${x.note ? ` — <span style="color:var(--text-muted);">${escapeHtml(x.note)}</span>` : ''}</div>`).join('')}
        ${r.new_issues.length ? `<div style="color:var(--danger);margin-top:4px;">⚠ Yeni sorun: ${r.new_issues.map(escapeHtml).join('; ')}</div>` : ''}
        ${kalanlar.length ? `<button class="btn btn-sm" id="wsFixRest" style="margin-top:6px;font-size:11.5px;">✨ Kalan ${kalanlar.length} bulguyu da gider</button>` : ''}
      </div>`;
    // Bulgu bazlı çözüm: hepsi giderilmediyse paragraf "çözüldü" sayılmaz
    if (kalanlar.length) {
      resolvedParas.delete(String(num));
      saveParaState();
      document.getElementById('wsFixRest')?.addEventListener('click', () =>
        workshopFix(workshopState.chapter, num,
          'Kalan bulgular: ' + kalanlar.map(x => x.finding).join(' | ')));
    }
  } catch (err) {
    kutu.innerHTML = `<span style="color:var(--danger);">Yeniden test yapılamadı: ${escapeHtml(err.message)}</span>`;
  }
}

// ---------------------------------------------------------------------------
// KONTROL SONRASI SOHBET: derin kontrol bir sorun bulduğunda "uyarılara göre
// yeniden yaz" bağa giriyordu (aynı uyarılar tekrar çıkıyor, döngü
// kapanmıyor). En iyi sonucu şu üçlü veriyor: KONTROL UYARILARI + SEÇİLEN
// METİN + AI'nın kendi yorumu, birlikte tartışılarak. Karar insanla
// birlikte veriliyor; anlaşınca "✍️ yeni versiyonu yaz" ile üretiliyor.
// ---------------------------------------------------------------------------
function openWorkshopVerifyChat(chapter, num, eskiMetin, secilenMetin, uyarilar, aiNotu) {
  const box = document.getElementById('wsWork');
  if (!box) return;
  const para = (chapter.paragraphs || []).find(p => p.number === num);

  // Sohbeti üç bilgiyle tohumla: uyarılar, seçilen metin, AI yorumu
  paraChatHistories[num] = paraChatHistories[num] || [];
  const acilis =
    `P${num} için seçtiğim versiyon şu:\n"${secilenMetin}"\n\n`
    + (uyarilar.length ? `Kontrol şu uyarıları verdi:\n- ${uyarilar.join('\n- ')}\n` : '')
    + (aiNotu ? `Kontrolün notu: ${aiNotu}\n` : '')
    + '\nSence bu uyarılar haklı mı? Hangisini nasıl çözelim - metni bozmadan?';

  box.dataset.mode = 'chat';
  box.innerHTML = `
    <div class="panel" style="margin-top:8px;border-left:3px solid var(--gold);">
      <div style="font-size:10.5px;color:var(--text-muted);letter-spacing:0.4px;">💬 KONTROL SONRASI TARTIŞMA</div>
      <div class="para-chat-log" data-number="${num}" style="max-height:240px;overflow-y:auto;font-size:12.5px;margin-top:6px;"></div>
      <div style="display:flex;gap:6px;margin-top:6px;">
        <textarea class="para-chat-input" data-number="${num}" placeholder="Ör: ilk uyarı haklı, ikincisi değil" style="flex:1;min-height:38px;box-sizing:border-box;font-size:12.5px;"></textarea>
        <button class="btn btn-sm btn-primary" id="wsVcSend">Gönder</button>
      </div>
      <button class="btn btn-sm btn-primary" id="wsVcWrite" style="margin-top:6px;width:100%;font-size:11.5px;">✍️ Konuştuklarımıza göre yeni versiyonu yaz</button>
      <button class="btn btn-sm" id="wsVcKeep" style="margin-top:6px;width:100%;font-size:11.5px;">Yine de seçtiğim metni uygula</button>
    </div>`;

  renderParaChatLog(num);
  // İlk soruyu otomatik gönder - kullanıcı yazmadan tartışma başlasın
  const input = box.querySelector('.para-chat-input');
  input.value = acilis;
  sendParagraphChat(chapter, num, '', para ? para.text : eskiMetin);

  document.getElementById('wsVcSend').addEventListener('click', () =>
    sendParagraphChat(chapter, num, '', para ? para.text : eskiMetin));
  document.getElementById('wsVcWrite').addEventListener('click', () =>
    writeParagraphVersion(chapter, num, '', para ? para.text : eskiMetin));
  document.getElementById('wsVcKeep').addEventListener('click', async () => {
    await replaceParagraphText(chapter.id, num, secilenMetin);
    resolvedParas.add(String(num)); saveParaState();
    if (para) para.text = secilenMetin;
    const el = document.getElementById('wsParaText');
    if (el) el.textContent = secilenMetin;
    box.innerHTML = '<div style="font-size:12.5px;color:#3f7a4f;">✓ Kaydedildi.</div>';
  });
}

// Teşhisleri sınıflarıyla göster. Kritik: "tercih" sınıfı için düzeltme
// düğmesi ÇIKMAZ - bir edebî normdan sapma otomatik olarak hata değildir.
function renderDiagnoses(num, teshisler) {
  const kutu = document.getElementById('wsDiagnosisBox');
  if (!kutu) return;
  if (!teshisler || !teshisler.length) { kutu.innerHTML = ''; return; }
  const stil = {
    hata: { renk: 'var(--danger)', etiket: '⛔ HATA', not: 'Nesnel kusur - düzeltilmeli.' },
    zayif: { renk: '#b08d3f', etiket: '⚠ ZAYIF', not: 'Tartışılabilir zayıflık.' },
    tercih: { renk: '#3f7a4f', etiket: '✎ YAZAR TERCİHİ', not: 'Bilinçli olabilir - öneri üretilmiyor.' },
    belirsiz: { renk: 'var(--text-muted)', etiket: '? BELİRSİZ', not: 'Kanıt yetersiz.' },
  };
  const siraDegeri = { hata: 0, zayif: 1, belirsiz: 2, tercih: 3 };
  const sirali = teshisler.slice().sort((a, b) => (siraDegeri[a.cls] ?? 9) - (siraDegeri[b.cls] ?? 9));
  kutu.innerHTML = `
    <div style="margin-top:8px;">
      <div style="font-size:10.5px;color:var(--text-muted);letter-spacing:0.4px;">TEŞHİS (bulgular birleştirildi)</div>
      ${sirali.map(d => {
        const st = stil[d.cls] || stil.belirsiz;
        return `
        <div style="border-left:3px solid ${st.renk};padding-left:8px;margin-top:6px;font-size:12.5px;">
          <span style="color:${st.renk};font-weight:600;font-size:10.5px;">${st.etiket}</span>
          ${d.sources?.length ? `<span style="font-size:10.5px;color:var(--text-muted);">· ${d.sources.length} test birleşti</span>` : ''}
          ${d.confidence ? `<span style="font-size:10.5px;color:var(--text-muted);">· güven %${Math.round(d.confidence * 100)}</span>` : ''}
          <div><b>${escapeHtml(d.title)}</b></div>
          ${d.evidence ? `<div style="font-style:italic;color:var(--text-muted);">"${escapeHtml(d.evidence)}"</div>` : ''}
          ${d.why ? `<div style="color:var(--text-muted);">${escapeHtml(d.why)}</div>` : ''}
          ${d.cls === 'tercih' && d.intent_note ? `<div style="color:#3f7a4f;">💡 ${escapeHtml(d.intent_note)}</div>` : ''}
          <div style="font-size:10.5px;color:var(--text-muted);">${st.not}</div>
        </div>`;
      }).join('')}
    </div>`;
}

// ---------------------------------------------------------------------------
// BİLGİ / İFŞA HARİTASI: duruşma-gerilim romanında gerilimi olay değil,
// "kim ne biliyor" farkı üretir. Üç eksen ayrı tutulur: karakterler, OKUR
// ve türetilmiş dramatik ironi. Okur bilip hiçbir karakter bilmiyorsa
// dramatik ironi vardır - romanın en güçlü gerilim aracı.
// ---------------------------------------------------------------------------
async function renderKnowledgeView() {
  main().innerHTML = `
    <h1 class="view-title">Bilgi Haritası</h1>
    <p style="color:var(--text-muted);font-size:13.5px;max-width:700px;">
      Gerilimi çoğu zaman olay değil, <b>kim ne biliyor</b> farkı üretir. Her önemli bilgi için
      üç ekseni ayrı tut: hangi karakterler biliyor, <b>okur</b> ne durumda, ne zaman ifşa olacak.
      Okur bilip hiçbir karakterin bilmediği bilgi = <b>dramatik ironi</b>.
    </p>
    <div class="toolbar"><div></div><button class="btn btn-primary" id="addFactBtn">+ Yeni Bilgi</button></div>
    <div id="factForm"></div>
    <div id="factList"><div class="empty-state">Yükleniyor…</div></div>`;
  document.getElementById('addFactBtn').addEventListener('click', () => showFactForm(null));
  await loadFactList();
}

async function loadFactList() {
  const el = document.getElementById('factList');
  try {
    const facts = await api.get('/knowledge/');
    if (!facts.length) {
      el.innerHTML = '<div class="empty-state">Henüz bilgi kaydı yok. "Başkan imzayı attı", "Vicdan yedinci timi göremiyor" gibi kritik bilgileri buraya ekle.</div>';
      return;
    }
    const okurEtiket = { hayir: '🔒 okur bilmiyor', sezdirildi: '🔎 sezdirildi', evet: '👁 okur biliyor' };
    const okurRenk = { hayir: 'var(--text-muted)', sezdirildi: '#b08d3f', evet: '#3f7a4f' };
    el.innerHTML = facts.map(f => `
      <div class="entity-row" style="flex-wrap:wrap;">
        <div style="flex:1;min-width:240px;">
          <div class="name">${escapeHtml(f.information)}
            ${f.dramatic_irony ? '<span style="font-size:10.5px;color:#7a5fb0;border:1px solid #7a5fb0;border-radius:3px;padding:0 4px;" title="Okur biliyor, hiçbir karakter bilmiyor">DRAMATİK İRONİ</span>' : ''}</div>
          <div class="desc" style="display:flex;gap:10px;flex-wrap:wrap;font-size:11.5px;">
            <span style="color:${okurRenk[f.reader_state]};">${okurEtiket[f.reader_state] || ''}</span>
            <span>${f.character_names.length ? '👤 ' + f.character_names.map(escapeHtml).join(', ') : '👤 kimse bilmiyor'}</span>
            ${f.introduced_chapter ? `<span>giriş: B${f.introduced_chapter}</span>` : ''}
            ${f.reveal_chapter ? `<span>ifşa: B${f.reveal_chapter}</span>` : '<span style="color:var(--danger);">ifşa planlanmamış</span>'}
          </div>
          ${f.planned_payoff ? `<div class="desc">🎯 ${escapeHtml(f.planned_payoff)}</div>` : ''}
        </div>
        <div class="actions">
          <button class="btn btn-sm edit-fact-btn" data-id="${f.id}">Düzenle</button>
          <button class="btn btn-sm btn-danger del-fact-btn" data-id="${f.id}">Sil</button>
        </div>
      </div>`).join('');
    el.querySelectorAll('.edit-fact-btn').forEach(b => b.addEventListener('click', () =>
      showFactForm(facts.find(x => x.id === parseInt(b.dataset.id, 10)))));
    el.querySelectorAll('.del-fact-btn').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Bu bilgi kaydı silinsin mi?')) return;
      try { await api.del(`/knowledge/${b.dataset.id}`); await loadFactList(); }
      catch (err) { alert(err.message); }
    }));
  } catch (err) { el.innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`; }
}

async function showFactForm(fact) {
  const kap = document.getElementById('factForm');
  let karakterler = [];
  try { karakterler = await api.get('/characters/'); } catch (e) { /* yoksay */ }
  const secili = fact ? (fact.known_by_characters || []) : [];
  kap.innerHTML = `
    <div class="panel">
      <b>${fact ? 'Bilgiyi Düzenle' : 'Yeni Bilgi'}</b>
      <div class="field" style="margin-top:8px;"><label>Bilgi <span style="font-weight:400;color:var(--text-muted);font-size:11.5px;">(tek cümle - "Başkan imzayı attı")</span></label>
        <input type="text" id="fk_info" value="${fact ? escapeHtml(fact.information) : ''}"></div>
      <div class="field"><label>Bunu bilen karakterler</label>
        <div style="max-height:160px;overflow-y:auto;border:1px solid var(--border);border-radius:6px;padding:6px;">
          ${karakterler.map(c => `<label class="entity-picker-label"><input type="checkbox" class="fk-char" value="${c.id}" ${secili.includes(c.id) ? 'checked' : ''}> ${escapeHtml(c.name)}</label>`).join('') || '<span style="font-size:12px;color:var(--text-muted);">Kayıtlı kişi yok</span>'}
        </div></div>
      <div class="field"><label>Okur ne durumda?</label>
        <select id="fk_reader">
          <option value="hayir" ${!fact || fact.reader_state === 'hayir' ? 'selected' : ''}>🔒 Bilmiyor</option>
          <option value="sezdirildi" ${fact && fact.reader_state === 'sezdirildi' ? 'selected' : ''}>🔎 Sezdirildi</option>
          <option value="evet" ${fact && fact.reader_state === 'evet' ? 'selected' : ''}>👁 Biliyor</option>
        </select></div>
      <div style="display:flex;gap:10px;">
        <div class="field" style="flex:1;"><label>Giriş bölümü</label><input type="number" id="fk_intro" value="${fact && fact.introduced_chapter ? fact.introduced_chapter : ''}"></div>
        <div class="field" style="flex:1;"><label>İfşa bölümü</label><input type="number" id="fk_reveal" value="${fact && fact.reveal_chapter ? fact.reveal_chapter : ''}"></div>
      </div>
      <div class="field"><label>İfşa yöntemi</label><input type="text" id="fk_method" placeholder="ör. Hologram kaydı" value="${fact ? escapeHtml(fact.reveal_method) : ''}"></div>
      <div class="field"><label>Planlanan ödeme (payoff)</label><input type="text" id="fk_payoff" placeholder="ör. Tur 1 kapanışı" value="${fact ? escapeHtml(fact.planned_payoff) : ''}"></div>
      <div class="form-actions">
        <button class="btn btn-primary" id="fk_save">Kaydet</button>
        <button class="btn" id="fk_cancel">Vazgeç</button>
      </div>
      <div id="fk_err" class="error-text"></div>
    </div>`;
  document.getElementById('fk_cancel').addEventListener('click', () => { kap.innerHTML = ''; });
  document.getElementById('fk_save').addEventListener('click', async () => {
    const bilgi = document.getElementById('fk_info').value.trim();
    if (!bilgi) { document.getElementById('fk_err').textContent = 'Bilgi metni gerekli.'; return; }
    const veri = {
      information: bilgi,
      known_by_characters: Array.from(document.querySelectorAll('.fk-char:checked')).map(x => parseInt(x.value, 10)),
      reader_state: document.getElementById('fk_reader').value,
      introduced_chapter: parseInt(document.getElementById('fk_intro').value, 10) || null,
      reveal_chapter: parseInt(document.getElementById('fk_reveal').value, 10) || null,
      reveal_method: document.getElementById('fk_method').value.trim(),
      planned_payoff: document.getElementById('fk_payoff').value.trim(),
    };
    try {
      if (fact) await api.put(`/knowledge/${fact.id}`, veri);
      else await api.post('/knowledge/', veri);
      kap.innerHTML = '';
      await loadFactList();
    } catch (err) { document.getElementById('fk_err').textContent = err.message; }
  });
}

// ---------------------------------------------------------------------------
// İNCELEME ÖZETİ: hem taze analiz sonrasında hem ÖNBELLEKTEN çağrılır.
// Önbellek sayesinde atölyeyi kapatıp açtığında analiz baştan çalışmaz.
// ---------------------------------------------------------------------------
function renderWorkshopReviewSummary(literary, motif, onbellekten, gunFarki) {
  const renk = (p) => p <= 2 ? 'var(--danger)' : (p === 3 ? '#b08d3f' : '#3f7a4f');
  document.getElementById('workshopOverlay').querySelector('.workshop-body').innerHTML = `
    <div style="text-align:center;padding:10px 0;">
      <div style="font-size:30px;font-weight:700;color:${renk(Math.round(literary.average))}">${literary.average}<span style="font-size:16px;color:var(--text-muted);">/5</span></div>
      <div style="font-size:12px;color:var(--text-muted);">edebî ortalama</div>
    </div>
    ${literary.strongest ? `<div style="font-size:12.5px;padding:8px;background:var(--paper-dim);border-radius:6px;">💪 ${escapeHtml(literary.strongest)}</div>` : ''}
    <div style="font-size:12.5px;color:var(--text-muted);margin-top:10px;">
      Kapsama: ${literary.total || 0} paragrafın ${literary.scanned || 0}'i tarandı${literary.chunks > 1 ? ` (${literary.chunks} parça)` : ''}.
    </div>
    <div style="font-size:13.5px;margin-top:10px;"><b>${workshopState.order.length}</b> paragrafta bulgu var.</div>
    ${motif.repeats?.length ? `
      <details style="margin-top:8px;">
        <summary style="cursor:pointer;font-size:12px;color:var(--text-muted);">🎨 İmge haritası (${motif.items?.length || 0} imge tarandı)</summary>
        ${motif.summary ? `<div style="font-size:12.5px;margin-top:4px;">${escapeHtml(motif.summary)}</div>` : ''}
        ${motif.repeats.map(x => `
          <div style="font-size:12.5px;margin-top:6px;border-left:3px solid ${x.kind === 'leitmotif' ? '#3f7a4f' : 'var(--danger)'};padding-left:8px;">
            <b>${escapeHtml(x.image)}</b> <span style="font-size:11px;color:${({leitmotif:'#3f7a4f',tekrar:'var(--danger)',belirsiz:'var(--text-muted)'})[x.kind]};">${({leitmotif:'✓ leitmotif',tekrar:'⚠ tekrar',belirsiz:'? belirsiz'})[x.kind]}${x.confidence ? ' %' + Math.round(x.confidence * 100) : ''}</span>
            <div style="color:var(--text-muted);">P${(x.paragraphs || []).join(', P')} · ${escapeHtml(x.reason || '')}</div>
          </div>`).join('')}
        ${motif.unused_senses?.length ? `<div style="font-size:12px;color:var(--text-muted);margin-top:6px;">Hiç kullanılmayan duyular: ${motif.unused_senses.map(escapeHtml).join(', ')}</div>` : ''}
      </details>` : ''}
    <details style="margin-top:10px;">
      <summary style="cursor:pointer;font-size:12px;color:var(--text-muted);">Edebî karne (10 ölçüt)</summary>
      ${(literary.scores || []).slice().sort((a, b) => a.score - b.score).map(sc => `
        <div style="display:flex;gap:8px;font-size:12.5px;padding:3px 0;">
          <span style="color:${renk(sc.score)};font-size:11px;letter-spacing:1px;">${'●'.repeat(sc.score)}${'○'.repeat(5 - sc.score)}</span>
          <b style="flex:1;">${escapeHtml(sc.label)}</b>
        </div>`).join('')}
    </details>
    <label style="display:flex;align-items:center;gap:6px;font-size:12.5px;margin-top:12px;cursor:pointer;">
      <input type="checkbox" id="wsSweep"> Süpürme modu: <b>tüm</b> paragrafları sırayla gez
    </label>
    <div style="font-size:11.5px;color:var(--text-muted);margin-top:2px;">
      Kapalıyken sadece bulgu çıkan paragraflar gezilir. Bulgu çıkmayan paragraflar
      "sorunsuz" değil, sadece <b>işaretlenmemiş</b> demektir - süpürme modu hepsini gösterir.
    </div>
    <div style="display:flex;gap:8px;margin-top:16px;">
      <button class="btn" id="wsBackPrep" style="flex:1;">← Hazırlık</button>
      <button class="btn btn-primary" id="wsToParas" style="flex:2;">Paragraflara geç →</button>
    </div>`;
  document.getElementById('wsBackPrep').addEventListener('click', renderWorkshopPrep);
  // Tam tur seçildiyse: süpürme modunu işaretle ve beklemeden paragraflara geç
  if (workshopState.autoSweep) {
    workshopState.autoSweep = false;
    const sweepEl = document.getElementById('wsSweep');
    if (sweepEl) sweepEl.checked = true;
    setTimeout(() => document.getElementById('wsToParas')?.click(), 400);
  }
  document.getElementById('wsToParas').addEventListener('click', () => {
    if (document.getElementById('wsSweep').checked) {
      // Tüm paragraflar sırayla; bulgusu olanlar zaten işaretli görünür
      workshopState.order = (workshopState.chapter.paragraphs || [])
        .filter(p => (p.text || '').trim()).map(p => p.number).sort((a, b) => a - b);
    }
    if (!workshopState.order.length) { alert('Gezilecek paragraf yok.'); return; }
    renderWorkshopParagraph(0);
  });

  // Önbellekten geldiyse tazeleme seçeneği sun
  if (onbellekten) {
    const govdeEl = document.getElementById('workshopOverlay').querySelector('.workshop-body');
    govdeEl.insertAdjacentHTML('afterbegin', `
      <div style="font-size:11.5px;color:var(--text-muted);background:var(--paper-dim);padding:6px 8px;border-radius:6px;margin-bottom:8px;">
        📦 Kayıtlı inceleme gösteriliyor${gunFarki > 0 ? ` (${gunFarki} gün önce)` : ' (bugün)'} - analiz yeniden çalıştırılmadı.
        <button class="btn btn-sm" id="wsRescan" style="font-size:11px;margin-left:6px;">🔄 Yeniden incele</button>
      </div>`);
    document.getElementById('wsRescan').addEventListener('click', () => {
      workshopState.forceRescan = true;
      renderWorkshopReview();
    });
  }
}

// İnceleme önbelleği (bölüm bazlı, tarayıcıda)
function saveReviewCache(chapterId, veri) {
  try { localStorage.setItem(`roman_review_${chapterId}`, JSON.stringify(veri)); }
  catch (e) { /* depolama dolu - önbelleksiz devam */ }
}
function loadReviewCache(chapterId) {
  try {
    const raw = localStorage.getItem(`roman_review_${chapterId}`);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

// Paragrafı parçalara böler: ilk parça mevcut numarada kalır, kalanlar
// araya eklenir ve sonraki paragraflar kaydırılır. Metin DEĞİŞMEZ.
async function applyParagraphSplit(chapter, number, parcalar) {
  const hepsi = (chapter.paragraphs || []).slice().sort((a, b) => a.number - b.number);
  const sonrakiler = hepsi.filter(p => p.number > number);
  const kayma = parcalar.length - 1;
  // Sondan başa kaydır (numara çakışması olmasın)
  for (let i = sonrakiler.length - 1; i >= 0; i--) {
    const p = sonrakiler[i];
    await api.put(`/chapters/${chapter.id}/paragraphs/${p.number + kayma}`,
      { number: p.number + kayma, text: p.text });
  }
  for (let i = 0; i < parcalar.length; i++) {
    await api.put(`/chapters/${chapter.id}/paragraphs/${number + i}`,
      { number: number + i, text: parcalar[i] });
  }
  const yeni = await api.get(`/chapters/${chapter.id}`);
  currentChapter = yeni;
  workshopState.chapter = yeni;
}

// ---------------------------------------------------------------------------
// PUAN GÖSTERGELERİ: son incelemenin sonucu fihristte ve paragraf kenarında
// görünür - "hangi bölüm zayıf, hangi paragrafta bulgu var" sorusu ekranı
// açar açmaz cevaplanır. Veriler inceleme önbelleğinden okunur (ek istek yok).
// ---------------------------------------------------------------------------
function reviewScoreBadge(chapterId) {
  const c = loadReviewCache(chapterId);
  if (!c || !c.literary) return '';
  const puan = c.literary.average || 0;
  const renk = puan <= 2.5 ? 'var(--danger)' : (puan < 3.6 ? '#b08d3f' : '#3f7a4f');
  const bulguSayisi = Object.keys(c.findings || {}).length;
  const cozulen = Object.keys(c.findings || {}).filter(n => {
    try {
      const st = JSON.parse(localStorage.getItem(`roman_para_state_${chapterId}`) || '{}');
      return (st.resolved || []).includes(String(n));
    } catch (e) { return false; }
  }).length;
  return ` <span style="font-size:9.5px;color:${renk};font-weight:700;" title="Son inceleme: edebî ortalama ${puan}/5 · ${bulguSayisi} paragrafta bulgu, ${cozulen} çözüldü">${puan}${bulguSayisi ? ` ⚑${bulguSayisi - cozulen}` : ''}</span>`;
}

// Paragraf kenarındaki durum: PUAN + bulgu sayısı. Puan, bulgu sayısı ve
// ağırlığından türetilir (5 = bulgu yok, her bulgu düşürür; "tercih"
// sınıfındaki teşhisler puanı düşürmez - onlar hata değil).
function paragraphScore(number, cache) {
  const bulgular = (cache?.findings || {})[number] || [];
  if (!bulgular.length) return 5;
  const agirlik = { editor: 0.8, okur: 1.0, imge: 0.6 };
  const ceza = bulgular.reduce((t, b) => t + (agirlik[b.kaynak] ?? 0.8), 0);
  return Math.max(1, Math.round((5 - ceza) * 10) / 10);
}

function paragraphStatusBadge(number) {
  if (!currentChapter) return '';
  const c = loadReviewCache(currentChapter.id);
  if (!c || !c.findings) return '';
  const bulgular = c.findings[number] || [];
  const cozuldu = resolvedParas.has(String(number));
  if (!bulgular.length && !cozuldu) return '';
  const puan = cozuldu ? 5 : paragraphScore(number, c);
  const renk = cozuldu ? '#3f7a4f' : (puan <= 2.5 ? 'var(--danger)' : (puan < 4 ? '#b08d3f' : '#3f7a4f'));
  return `<div style="font-size:9px;margin-top:2px;color:${renk};font-weight:700;"
    title="${cozuldu ? 'Düzeltildi' : bulgular.length + ' bulgu: ' + bulgular.map(b => b.baslik).join(', ')}">
    ${cozuldu ? '✓5' : puan}${bulgular.length && !cozuldu ? ' ⚑' + bulgular.length : ''}</div>`;
}

// ---------------------------------------------------------------------------
// BÖLÜM PUAN ŞERİDİ: bölümü açar açmaz genel durum görünür - edebî ortalama,
// kaç paragrafta bulgu var, kaçı çözüldü, en zayıf üç ölçüt. Son incelemenin
// önbelleğinden okunur, ek istek yok.
// ---------------------------------------------------------------------------
function chapterScoreStrip(chapterId) {
  const c = loadReviewCache(chapterId);
  if (!c || !c.literary) {
    return `<span style="font-size:11.5px;color:var(--text-muted);align-self:center;">Henüz incelenmedi</span>`;
  }
  const puan = c.literary.average || 0;
  const renk = puan <= 2.5 ? 'var(--danger)' : (puan < 3.6 ? '#b08d3f' : '#3f7a4f');
  const numaralar = Object.keys(c.findings || {});
  let cozulen = 0;
  try {
    const st = JSON.parse(localStorage.getItem(`roman_para_state_${chapterId}`) || '{}');
    cozulen = numaralar.filter(n => (st.resolved || []).includes(String(n))).length;
  } catch (e) { /* yoksay */ }
  const zayif = (c.literary.scores || []).slice().sort((a, b) => a.score - b.score).slice(0, 3);
  const gun = Math.floor((Date.now() - (c.at || Date.now())) / 86400000);
  return `
    <span class="chapter-score-strip" style="display:inline-flex;align-items:center;gap:8px;font-size:11.5px;
      border:1px solid var(--border);border-radius:999px;padding:2px 10px;align-self:center;"
      title="Son inceleme ${gun > 0 ? gun + ' gün önce' : 'bugün'}${zayif.length ? ' · En zayıf: ' + zayif.map(z => z.label + ' ' + z.score).join(', ') : ''}">
      <b style="color:${renk};font-size:13px;">${puan}</b><span style="color:var(--text-muted);">/5</span>
      ${numaralar.length ? `<span style="color:${cozulen === numaralar.length ? '#3f7a4f' : 'var(--danger)'};">⚑ ${numaralar.length - cozulen}/${numaralar.length}</span>` : ''}
      ${zayif.length ? `<span style="color:var(--text-muted);">zayıf: ${escapeHtml(zayif[0].label)}</span>` : ''}
    </span>`;
}

// ---------------------------------------------------------------------------
// MİKRO DÜZENLEME ARAYÜZÜ: paragraf metninde bir ifadeyi SEÇ, sadece onu
// değiştir. Tüm paragrafı yeniden yazdırmanın iki sakıncası vardı: iyi
// cümleler kayboluyordu ve tek kelimelik bir takıntı için koca bir üretim
// turu gerekiyordu.
// ---------------------------------------------------------------------------
function wireMicroEdit(chapter, num) {
  const metinEl = document.getElementById('wsParaText');
  const kutu = document.getElementById('wsWork');
  if (!metinEl || !kutu) return;
  metinEl.addEventListener('mouseup', () => {
    const secim = (window.getSelection()?.toString() || '').trim();
    if (secim.length < 3 || secim.length > 200) return;
    const mevcut = document.getElementById('wsMicroBar');
    if (mevcut) mevcut.remove();
    const bar = document.createElement('div');
    bar.id = 'wsMicroBar';
    bar.style.cssText = 'margin-top:6px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;font-size:11.5px;';
    bar.innerHTML = `
      <span style="color:var(--text-muted);">Seçili: "<b>${escapeHtml(truncate(secim, 40))}</b>"</span>
      <input type="text" id="wsMicroReq" placeholder="ne olsun? (boş: güçlendir)" style="flex:1;min-width:140px;font-size:11.5px;">
      <button class="btn btn-sm btn-primary" id="wsMicroGo" style="font-size:11.5px;">✂ Sadece bunu değiştir</button>`;
    metinEl.insertAdjacentElement('afterend', bar);
    document.getElementById('wsMicroGo').addEventListener('click', async (e) => {
      const b = e.target; b.disabled = true; b.textContent = 'Alternatifler…';
      kutu.dataset.mode = 'micro';
      kutu.innerHTML = '<div class="empty-state">Sadece seçili parça için alternatifler…</div>';
      try {
        const r = await api.post('/ai/micro-edit', {
          paragraph_text: metinEl.innerText.trim(),
          target: secim,
          request: document.getElementById('wsMicroReq').value.trim(),
          purpose: effectiveParaPurpose(num).text,
        });
        if (!r.options.length) {
          kutu.innerHTML = '<div class="error-text" style="font-size:12px;">Alternatif üretilemedi. Seçimi biraz genişletmeyi dene.</div>';
          return;
        }
        kutu.innerHTML = `
          <div style="font-size:10.5px;color:var(--text-muted);letter-spacing:0.4px;">MİKRO DÜZENLEME - sadece seçili parça değişir</div>
          ${r.options.map((o, i) => `
            <div style="border:1px solid var(--border);border-radius:8px;padding:8px;margin-top:6px;">
              <div style="font-size:13px;"><span style="color:var(--gold);font-weight:600;">${escapeHtml(o.replacement)}</span></div>
              ${o.why ? `<div style="font-size:11.5px;color:var(--text-muted);font-style:italic;margin-top:2px;">${escapeHtml(o.why)}</div>` : ''}
              <button class="btn btn-sm btn-primary micro-apply" data-idx="${i}" style="margin-top:6px;width:100%;font-size:11.5px;">Uygula</button>
            </div>`).join('')}`;
        kutu.querySelectorAll('.micro-apply').forEach(mb => mb.addEventListener('click', async () => {
          const o = r.options[parseInt(mb.dataset.idx, 10)];
          await replaceParagraphText(chapter.id, num, o.preview);
          const para = (chapter.paragraphs || []).find(p => p.number === num);
          if (para) para.text = o.preview;
          metinEl.textContent = o.preview;
          document.getElementById('wsMicroBar')?.remove();
          kutu.innerHTML = '<div style="font-size:12.5px;color:#3f7a4f;">✓ Sadece seçili parça değiştirildi.</div>';
        }));
      } catch (err) {
        kutu.innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`;
      }
      b.disabled = false; b.textContent = '✂ Sadece bunu değiştir';
    });
  });
}
