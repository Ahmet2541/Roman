const ENTITY_TYPES = {
  character: { endpoint: '/characters/', label: 'Kişi', plural: 'Kişiler', hasStatus: true, statusOptions: ['aktif', 'pasif', 'öldü'], isRule: false, hasAliases: true },
  place: { endpoint: '/places/', label: 'Mekan', plural: 'Mekanlar', hasStatus: false, isRule: false, hasAliases: true },
  event: { endpoint: '/events/', label: 'Olay', plural: 'Olaylar', hasStatus: false, isRule: false, isCustom: true },
  object: { endpoint: '/objects/', label: 'Nesne', plural: 'Nesneler', hasStatus: false, isRule: false },
  foreshadowing: { endpoint: '/foreshadowings/', label: 'İpucu', plural: 'İpuçları', hasStatus: true, statusOptions: ['açık', 'kapandı'], isRule: false },
  term: { endpoint: '/glossary/', label: 'Terim', plural: 'Terimler', hasStatus: false, isRule: false },
  rule: { endpoint: '/rules/', label: 'Kural', plural: 'Roman Kuralları', hasStatus: false, isRule: true, hasTags: true },
  faction: { endpoint: '/factions/', label: 'Faksiyon', plural: 'Faksiyonlar', hasStatus: false, isRule: false },
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
  if (view === 'fullscan') return renderFullScanView();
  if (view === 'place') return renderPlacesView();
  return renderEntityView(view);
}

// ---------------------------------------------------------------------
// Ortak menü görünümü (Kişiler, Mekanlar, Olaylar, Nesneler, İpuçları, Terimler, Kurallar)
// ---------------------------------------------------------------------

async function renderEntityView(type) {
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
  listEl.innerHTML = items.map(item => {
    const title = cfg.isRule ? item.title : item.name;
    const statusBadge = cfg.hasStatus ? ` · ${item.status}` : '';
    const notesLine = (!cfg.isRule && item.notes) ? `<div class="desc" style="font-style:italic;margin-top:2px;">${escapeHtml(truncate(item.notes, 140))}</div>` : '';
    const progressionBtn = cfg.isRule ? '' : `<button class="btn btn-sm progression-btn" data-id="${item.id}">Gelişim</button>`;
    const progressionPanel = cfg.isRule ? '' : `<div class="progression-panel" data-id="${item.id}" style="display:none;width:100%;margin-top:8px;padding-top:8px;border-top:1px dashed var(--border);"></div>`;
    return `<div class="entity-row" style="${cfg.isRule ? '' : 'flex-wrap:wrap;'}">
      <div>
        <div class="name">${escapeHtml(title)}${statusBadge}</div>
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
        renderEntityView(type);
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
        <label>Açıklama</label>
        <textarea id="f_desc">${escapeHtml(descValue)}</textarea>
      </div>
      ${cfg.hasTags ? `<div class="field">
        <label>Etiketler <span style="font-weight:400;color:var(--text-muted);">(virgülle ayır - boş bırakırsan her zaman dahil edilir)</span></label>
        <input type="text" id="f_tags" value="${escapeHtml(tagsValue)}" placeholder="buyu, kuzey-hanesi">
      </div>` : ''}
      ${cfg.isRule ? '' : `<div class="field"><label>Notlar</label><textarea id="f_notes">${escapeHtml(notesValue)}</textarea></div>`}
      ${cfg.hasStatus ? `<div class="field"><label>Durum</label>
        <select id="f_status">
          ${cfg.statusOptions.map(opt => `<option value="${opt}" ${statusValue === opt ? 'selected' : ''}>${opt.charAt(0).toUpperCase() + opt.slice(1)}</option>`).join('')}
        </select></div>` : ''}
      <div class="form-actions">
        <button class="btn btn-primary" id="saveBtn">${isEdit ? 'Güncelle' : 'Kaydet'}</button>
        <button class="btn" id="cancelBtn">Vazgeç</button>
      </div>
      <div id="formError" class="error-text"></div>
    </div>`;

  document.getElementById('cancelBtn').addEventListener('click', () => { container.innerHTML = ''; });
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

function buildChapterHierarchy(chapters) {
  const items = [];
  let currentPartId = null;
  let currentSubtitleId = null;
  // Klasik taslak (outline) numaralaması: Kısım 1 -> "1", altındaki Alt
  // Başlık/Bölüm -> "1-1", onun altındaki Bölüm -> "1-1-1". Her seviyenin
  // kendi sayacı var; bir üst seviye ilerleyince alt seviyelerin sayaçları
  // sıfırlanır (yeni bir Kısım başlayınca alt numaralama 1'den başlar).
  const counters = [0, 0, 0];
  for (const c of chapters) {
    const id = String(c.id);
    let level, ancestorIds;
    if (c.kind === 'part') {
      ancestorIds = [];
      level = 0;
      currentPartId = id;
      currentSubtitleId = null;
    } else if (c.kind === 'subtitle') {
      ancestorIds = currentPartId ? [currentPartId] : [];
      level = ancestorIds.length;
      currentSubtitleId = id;
    } else {
      ancestorIds = [];
      if (currentPartId) ancestorIds.push(currentPartId);
      if (currentSubtitleId) ancestorIds.push(currentSubtitleId);
      level = ancestorIds.length;
    }
    counters[level] = (counters[level] || 0) + 1;
    for (let l = level + 1; l < counters.length; l++) counters[l] = 0;
    const displayNumber = counters.slice(0, level + 1).join('-');
    items.push({ chapter: c, level, ancestorIds, displayNumber });
  }
  items.forEach((item, idx) => {
    if (item.chapter.kind === 'chapter') { item.hasChildren = false; return; }
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

  listEl.innerHTML = hierarchy.map(item => {
    const c = item.chapter;
    const hidden = item.ancestorIds.some(id => collapsedGroups.has(id));
    if (hidden) return '';
    const indent = item.level * 18;
    const cleanTitle = stripMarkdownArtifacts(c.title);

    if (c.kind === 'part' || c.kind === 'subtitle') {
      const isCollapsed = collapsedGroups.has(String(c.id));
      const toggle = item.hasChildren
        ? `<button class="chapter-toggle" data-id="${c.id}" title="${isCollapsed ? 'Genişlet' : 'Daralt'}">${isCollapsed ? '▸' : '▾'}</button>`
        : `<span class="chapter-toggle" style="visibility:hidden;">▸</span>`;
      const isPart = c.kind === 'part';
      const bulkScanBtn = isPart
        ? `<button class="btn-icon-sm bulk-scan-btn" data-id="${c.id}" title="Bu Kısımdaki TÜM bölümleri tara - yeni varlık ve gelişim notu önerileri">🔍</button>`
        : '';
      return `<div class="chapter-item ${isPart ? 'chapter-part-divider' : 'chapter-subtitle-divider'}" data-id="${c.id}" style="cursor:default;padding-left:${14 + indent}px;${isPart ? 'background:var(--paper-dim);' : ''}">
        ${toggle}
        <div class="chapter-label-edit" data-id="${c.id}" style="flex:1;cursor:pointer;${isPart ? 'font-weight:700;letter-spacing:0.5px;text-transform:uppercase;font-size:12.5px;' : 'font-style:italic;font-size:12.5px;color:var(--text-muted);'}" title="Bu kısımdaki ilk bölüme git">
          <span style="opacity:0.6;font-weight:600;">${item.displayNumber}</span> ${escapeHtml(cleanTitle) || '<span style=\"opacity:0.5;\">(başlıksız)</span>'}
        </div>
        ${bulkScanBtn}
        <button class="btn-icon-sm edit-chapter-btn" data-id="${c.id}" title="Metni düzenle">✎</button>
        <button class="btn-icon-sm del-chapter-btn" data-id="${c.id}" title="Sil">✕</button>
      </div>`;
    }

    const cleanSummary = stripMarkdownArtifacts(c.summary);
    const isDuplicateOfTitle = cleanTitle && cleanSummary &&
      cleanSummary.toLowerCase().startsWith(cleanTitle.toLowerCase().slice(0, 40));
    const preview = (cleanSummary && !isDuplicateOfTitle)
      ? cleanSummary.slice(0, 80) + (cleanSummary.length > 80 ? '…' : '')
      : '';
    return `<div class="chapter-item${currentChapter && String(currentChapter.id) === String(c.id) ? ' active' : ''}" data-id="${c.id}" style="padding-left:${14 + indent}px;" title="${escapeHtml(c.summary || 'Henüz özet yok')}">
      <div style="flex:1;min-width:0;">
        <span>${item.displayNumber}${cleanTitle ? ' — ' + escapeHtml(cleanTitle) : ''}</span>
        ${preview ? `<div style="font-size:11px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(preview)}</div>` : ''}
      </div>
      <button class="btn-icon-sm del-chapter-btn" data-id="${c.id}" title="Bölümü sil">✕</button>
    </div>`;
  }).join('');

  // Gerçek bölümler (kind === 'chapter') tıklanınca seçilir/okunur.
  listEl.querySelectorAll('.chapter-item').forEach(el => {
    const c = chapters.find(x => String(x.id) === el.dataset.id);
    if (c && c.kind !== 'chapter') return; // part/subtitle satırları bu genel handler'a girmez
    el.addEventListener('click', (e) => {
      if (e.target.closest('.del-chapter-btn')) return;
      selectChapter(el.dataset.id);
    });
  });
  // Kısım/Alt Başlık metnine tıklamak artık DÜZENLEME AÇMIYOR - liste
  // uzadıkça (12.000 sayfalık bir seri gibi) asıl ihtiyaç o bölgeye HIZLICA
  // GİTMEK, her tıklamanın bir düzenleme penceresi açması değil. Tıklamak,
  // o Kısım/Alt Başlık'ın altındaki İLK gerçek bölümü seçip okuyucuya
  // açar (daraltılmış olsa bile). Metni değiştirmek için ayrı, açık bir
  // ✎ butonu var - kazara tıklayıp yazı kaybetme riski yok.
  listEl.querySelectorAll('.chapter-label-edit').forEach(el => {
    el.addEventListener('click', () => {
      const target = findFirstChapterUnder(el.dataset.id);
      if (target) selectChapter(target.id);
      else alert('Bu kısımda henüz bölüm yok. Metni değiştirmek için ✎ simgesine tıkla.');
    });
  });
  listEl.querySelectorAll('.chapter-toggle').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      if (collapsedGroups.has(id)) collapsedGroups.delete(id); else collapsedGroups.add(id);
      renderChapterListDOM();
    });
  });
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

function openChapterEditPrompt(id) {
  const c = lastLoadedChapters.find(x => String(x.id) === String(id));
  if (!c) return;
  const newTitle = prompt('Metni düzenle:', stripMarkdownArtifacts(c.title));
  if (newTitle === null || !newTitle.trim()) return;
  api.put(`/chapters/${c.id}`, { title: stripMarkdownArtifacts(newTitle.trim()) })
    .then(() => loadChapterList(currentChapter ? currentChapter.id : undefined, true))
    .catch(err => alert(err.message));
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

  const overlay = document.getElementById('createItemModalOverlay');
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
  // Ayrılınan bölüm "kirliyse" (bu oturumda paragraf değişikliği olduysa),
  // arka planda sessizce tara - kullanıcının beklemesine gerek yok.
  if (dirtyChapterId && String(dirtyChapterId) !== String(id)) {
    const toScan = dirtyChapterId;
    dirtyChapterId = null;
    runBackgroundChapterScan(toScan);
  }

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
  const paragraphsHtml = chapter.paragraphs.map(p => `
    <div class="paragraph-block" id="para-global-${p.id}">
      <div class="paragraph-number" title="Bu paragrafın romandaki kalıcı numarası - AI sohbetinde 'P${p.id} ...' diyerek doğrudan bu paragrafa atıfta bulunabilirsin">
        <div style="font-size:10px;color:var(--gold,#b08d3f);font-weight:700;">P${p.id}</div>
        ${p.number}
      </div>
      <div style="flex:1;">
        <div class="paragraph-text" contenteditable="true" data-number="${p.number}">${escapeHtml(p.text)}</div>
        <div>${(p.mentions || []).map(m => `<span class="mention-chip">${escapeHtml(m.entity_name)}</span>`).join('')}${p.is_style_sample ? '<span class="mention-chip" style="background:#1b2230;color:#fff;">★ stil örneği</span>' : ''}</div>
        <div class="paragraph-actions">
          <button class="btn btn-sm save-para-btn" data-number="${p.number}">Kaydet</button>
          <button class="btn btn-sm style-para-btn" data-number="${p.number}">${p.is_style_sample ? 'Stil örneğini kaldır' : 'Stil örneği yap'}</button>
          <button class="btn btn-sm history-para-btn" data-number="${p.number}">Geçmiş</button>
          <button class="btn btn-sm btn-danger del-para-btn" data-number="${p.number}">Sil</button>
        </div>
        <div class="paragraph-history-panel" data-number="${p.number}" style="display:none;margin-top:8px;padding-top:8px;border-top:1px dashed var(--border);"></div>
      </div>
    </div>`).join('');

  readerPane.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <h2 style="margin:0;">Bölüm ${chapter.number}${chapter.title ? ' — ' + escapeHtml(chapter.title) : ''}</h2>
      <button class="btn btn-sm" id="editTitleBtn">Başlığı düzenle</button>
    </div>
    <div class="chapter-summary-box" style="margin-top:10px;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <strong style="font-size:11px;color:var(--text-muted);letter-spacing:0.4px;">FİHRİST ÖZETİ</strong>
        <div>
          <button class="btn btn-sm" id="genSummaryBtn">AI ile özet oluştur</button>
          <button class="btn btn-sm" id="editSummaryBtn">Elle düzenle</button>
        </div>
      </div>
      <p id="chapterSummaryText" style="font-size:13px;color:var(--text-muted);margin:6px 0 0;">
        ${chapter.summary ? escapeHtml(chapter.summary) : '<em>Henüz özet yok - romanın fihristinde ve AI bağlamında bu bölüm görünmeyecek.</em>'}
      </p>
    </div>
    <div id="pendingAiSuggestionsBanner"></div>
    <div class="chapter-summary-box" style="margin-top:10px;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <strong style="font-size:11px;color:var(--text-muted);letter-spacing:0.4px;">ROMAN HARİTASI</strong>
        <button class="btn btn-sm" id="scanProgressionsBtn">AI ile bu bölümü tara</button>
      </div>
      <p style="font-size:12px;color:var(--text-muted);margin:6px 0 0;">Bu bölümde geçen kişi/mekan/olaylar hakkında öğrenilen yeni bilgiyi bulup Gelişim Çizelgesi'ne (haritaya) ekler - böylece ileride yazılacak bölümler bu bilgiyle çelişmez.</p>
      <div id="progressionScanResult"></div>
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

async function saveParagraph(chapterId, number) {
  const el = document.querySelector(`.paragraph-text[data-number="${number}"]`);
  const text = el.innerText.trim();
  if (!text) { alert('Paragraf boş olamaz.'); return; }
  try {
    await api.put(`/chapters/${chapterId}/paragraphs/${number}`, { number: parseInt(number, 10), text });
    dirtyChapterId = chapterId;
    const chapter = await api.get(`/chapters/${chapterId}`);
    currentChapter = chapter;
    renderReader(chapter);
  } catch (err) { alert(err.message); }
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
    // Bu bölümde zaten geçen (mentions'tan) varlıkları otomatik işaretle -
    // her seferinde elle tek tek tıklamana gerek kalmasın.
    const mentionedKeys = new Set();
    (chapter.paragraphs || []).forEach(p => {
      (p.mentions || []).forEach(m => mentionedKeys.add(`${m.entity_type}:${m.entity_id}`));
    });

    const pickerHtml = PICKER_TYPES.map((t, idx) => {
      const items = lists[idx];
      if (!items.length) return '';
      return `<div class="entity-picker-group" style="margin-bottom:8px;">
        <strong style="font-size:10.5px;color:var(--text-muted);letter-spacing:0.4px;">${ENTITY_TYPES[t].plural.toUpperCase()}</strong><br>
        ${items.map(i => {
          const isMentioned = mentionedKeys.has(`${t}:${i.id}`);
          return `<label class="entity-picker-label" data-name="${escapeHtml(i.name.toLowerCase())}"><input type="checkbox" class="entity-check" data-type="${t}" data-id="${i.id}" ${isMentioned ? 'checked' : ''}> ${escapeHtml(i.name)}${isMentioned ? ' <span style="color:var(--gold);font-size:11px;" title="Bu bölümde geçiyor">●</span>' : ''}</label>`;
        }).join('')}
      </div>`;
    }).join('');

    panel.innerHTML = `
      <h3>AI Yazım Desteği</h3>
      <input type="text" id="entityPickerSearch" placeholder="Kişi/mekan/olay ara…" style="width:100%;margin-bottom:8px;">
      <div class="entity-picker">${pickerHtml || '<div class="empty-state">Henüz kayıt yok</div>'}</div>

      <div class="ai-mode-tabs" style="display:flex;gap:6px;margin:10px 0 8px;">
        <button class="btn btn-sm ai-mode-btn active" data-mode="chat">Sohbet</button>
        <button class="btn btn-sm ai-mode-btn" data-mode="instruct">Talimat</button>
      </div>

      <div id="aiChatMode">
        <div id="aiChatMessages" class="ai-chat-messages"></div>
        <div style="display:flex;gap:6px;">
          <textarea id="aiChatInput" placeholder="Ör: Ahmet için bir sahne fikrin var mı?" style="flex:1;min-height:44px;"></textarea>
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

    aiChatMessages = [];
    renderChatMessages();

    panel.querySelectorAll('.ai-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        panel.querySelectorAll('.ai-mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('aiChatMode').style.display = btn.dataset.mode === 'chat' ? 'block' : 'none';
        document.getElementById('aiInstructMode').style.display = btn.dataset.mode === 'instruct' ? 'block' : 'none';
      });
    });

    document.getElementById('aiChatSendBtn').addEventListener('click', () => sendChatMessage(chapter));
    document.getElementById('aiChatInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(chapter); }
    });
    document.getElementById('clearChatBtn').addEventListener('click', () => {
      aiChatMessages = [];
      renderChatMessages();
    });
    document.getElementById('aiAssistBtn').addEventListener('click', () => runAiAssist(chapter));
    document.getElementById('previewContextBtn').addEventListener('click', () => runContextPreview(chapter));
  } catch (err) {
    panel.innerHTML = `<h3>AI Yazım Desteği</h3><div class="error-text">${escapeHtml(err.message)}</div>`;
  }
}

let aiChatMessages = [];

function getSelectedEntities() {
  return Array.from(document.querySelectorAll('.entity-check:checked')).map(cb => ({
    entity_type: cb.dataset.type, entity_id: parseInt(cb.dataset.id, 10),
  }));
}

function renderChatMessages() {
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
      ${m.role === 'assistant' ? `<button class="btn btn-sm insert-to-paragraph-btn" data-idx="${i}" style="margin-top:6px;">Bölüme paragraf olarak ekle</button>` : ''}
      ${(m.pendingUpdates || []).map((p, pIdx) => renderEntityUpdateProposalCard(i, pIdx, p)).join('')}
    </div>`).join('');
  el.querySelectorAll('.insert-to-paragraph-btn').forEach(btn => {
    btn.addEventListener('click', () => insertChatReplyAsParagraph(aiChatMessages[parseInt(btn.dataset.idx, 10)].content));
  });
  wireEntityUpdateProposalButtons();
  el.scrollTop = el.scrollHeight;
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
    const payload = {
      chapter_number: chapter ? chapter.number : 0,
      selected_entities: selected,
      messages: aiChatMessages,
    };
    const result = await api.post('/ai/chat', payload);
    aiChatMessages.push({
      role: 'assistant', content: result.reply, actions: result.actions_taken || [],
      pendingUpdates: (result.pending_entity_updates || []).map(p => ({ ...p, resolved: false })),
    });
    renderChatMessages();
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
    const payload = { chapter_number: chapter ? chapter.number : 0, selected_entities: selected };
    const result = await api.post('/ai/context-preview', payload);
    container.innerHTML = `
      <div class="ai-result" style="white-space:pre-wrap;font-size:12px;max-height:260px;overflow:auto;">${escapeHtml(result.context) || '<em>Bu seçimle context boş olacak.</em>'}</div>
      <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">${result.char_count} karakter, ~${result.approx_tokens} token (kaba tahmin)</div>`;
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
    };
    const result = await api.post('/ai/assist', payload);
    let html = `<div class="ai-result">${escapeHtml(result.generated_text)}</div>`;

    if (result.consistency_notes && result.consistency_notes.length) {
      html += `<div style="margin-top:10px;"><strong style="font-size:12px;">Tutarlılık notları:</strong>
        <ul style="font-size:12.5px;margin:6px 0 0 16px;">${result.consistency_notes.map(n => `<li>${escapeHtml(n)}</li>`).join('')}</ul></div>`;
    }
    if (result.new_entity_suggestions && result.new_entity_suggestions.length) {
      html += `<div style="margin-top:10px;"><strong style="font-size:12px;">Yeni öneriler:</strong>` +
        result.new_entity_suggestions.map((s, idx) => `
          <div class="suggestion-item">
            <label><input type="checkbox" class="suggestion-check" data-idx="${idx}"> ${escapeHtml(s.entity_type)}: ${escapeHtml(s.name)}</label>
          </div>`).join('') +
        `<button class="btn btn-sm" id="approveBtn" style="margin-top:8px;">Seçilenleri onayla</button></div>`;
    }
    resultContainer.innerHTML = html;
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
    <h1 class="view-title">İçe Aktar</h1>
    <div class="panel">
      <p style="font-size:13.5px;color:var(--text-muted);">Elinde zaten yazılmış bir .txt dosyası varsa yükle — "Bölüm N" başlıklarına göre otomatik olarak bölüm/paragraf oluşturur ve mevcut menülerdeki isimleri paragraflarda arar. İçe aktarma otomatik olarak yeni karakter/mekan oluşturmaz; her bölüm için "AI ile varlık öner" ile Qwen'e henüz kayıtlı olmayan adayları buldurup onaylayarak ekleyebilirsin.</p>
      <div class="field"><input type="file" id="importFile" accept=".txt"></div>
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
      <button class="btn" id="checkConflictsBtn">Çakışma kontrolü yap</button>
      <button class="btn btn-primary" id="addEventBtn">+ Yeni Olay</button>
    </div>
    <div id="conflictsBox"></div>
    <div class="entity-list" id="eventList"><div class="empty-state">Yükleniyor…</div></div>
    <div id="eventFormContainer"></div>`;

  document.getElementById('addEventBtn').addEventListener('click', () => showEventForm(null));
  document.getElementById('checkConflictsBtn').addEventListener('click', checkEventConflicts);
  await loadEventList();
}

async function loadEventList() {
  const listEl = document.getElementById('eventList');
  try {
    const events = await api.get('/events/');
    if (!events.length) {
      listEl.innerHTML = `<div class="empty-state">Henüz olay yok.</div>`;
      return;
    }
    listEl.innerHTML = events.map(ev => `
      <div class="entity-row" style="flex-wrap:wrap;">
        <div>
          <div class="name">${escapeHtml(ev.name)}${ev.story_order !== null && ev.story_order !== undefined ? ` <span style="color:var(--text-muted);font-weight:400;">· sıra ${ev.story_order}</span>` : ''}</div>
          <div class="desc">${ev.story_date ? escapeHtml(ev.story_date) + ' · ' : ''}${ev.place_name ? '📍 ' + escapeHtml(ev.place_name) : ''}${ev.character_names.length ? ' · ' + ev.character_names.map(escapeHtml).join(', ') : ''}</div>
          <div class="desc">${escapeHtml(truncate(ev.description, 100))}</div>
        </div>
        <div class="actions">
          <button class="btn btn-sm edit-event-btn" data-id="${ev.id}">Düzenle</button>
          <button class="btn btn-sm progression-btn" data-id="${ev.id}">Gelişim</button>
          <button class="btn btn-sm btn-danger del-event-btn" data-id="${ev.id}">Sil</button>
        </div>
        <div class="progression-panel" data-id="${ev.id}" style="display:none;width:100%;margin-top:8px;padding-top:8px;border-top:1px dashed var(--border);"></div>
      </div>`).join('');

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
        <div class="field"><label>Kronolojik sıra (sayı - zaman çizelgesinde sıralamak için)</label><input type="number" id="ev_order" value="${isEdit && event.story_order !== null ? event.story_order : ''}"></div>
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

function renderFullScanView() {
  main().innerHTML = `
    <h1 class="view-title">Tutarlılık Taraması</h1>
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
  document.getElementById('switchNovelBtn').addEventListener('click', () => {
    clearNovelId();
    window.location.reload();
  });

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
