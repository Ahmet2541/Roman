// ===========================================================================
// 02-entities.js — Görünüm geçişi, varlık listeleri/formları, mekan ağacı
// Bu dosya app.js'in bölünmesiyle oluştu. Tüm tanımlar GLOBAL kapsamda
// kalır (modül sistemi yok); index.html'de SIRAYLA yüklenir.
// ===========================================================================

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

  el('addBtn').addEventListener('click', () => showEntityForm(type, null));

  try {
    const items = await api.get(cfg.endpoint);
    renderEntityList(type, items);
  } catch (err) {
    el('entityList').innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`;
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

  el('addBtn').addEventListener('click', () => showEntityForm('place', null));

  try {
    const places = await api.get('/places/');
    renderPlaceTree(places);
  } catch (err) {
    el('placeTree').innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`;
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
  var_olus: 'Varoluş başlangıcı', yok_olus: 'Varoluş sonu',
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

    // KRONOLOJİK SIRA: önce hikâye tarihi, sonra bölüm numarası, en sonda
    // zamansız notlar. Yazar araya not eklerken doğru yeri görmeli -
    // "üstüne mi altına mı" sorusu ancak sıralı listede cevaplanır.
    const sirali = items.slice().sort((a, b) => {
      const ta = normalizeTarihSirasi(a.story_date), tb = normalizeTarihSirasi(b.story_date);
      if (ta !== null && tb !== null) return ta - tb;
      if (ta !== null) return -1;
      if (tb !== null) return 1;
      return a.id - b.id;   // ikisi de zamansız: eklenme sırası
    });

    // Her notun yanında: ▲+ üste ekle · ▼+ alta ekle · ✎ düzenle · ✕ sil.
    // Ekleme düğmeleri tarih alanını KOMŞU NOTUN tarihiyle doldurur -
    // sıralama tarihe göre olduğu için "araya koymak" demek, aradaki bir
    // tarihi yazmak demektir; en zahmetli kısım o tarihi hatırlamaktı.
    const rows = sirali.map((p, i) => {
      const tarih = (p.story_date || '').trim();
      const damga = tarih || 'zamansız';
      const oncekiTarih = i > 0 ? (sirali[i - 1].story_date || '') : '';
      return `
      <div class="prog-satir" data-id="${p.id}" style="border-bottom:1px dotted var(--border);padding:5px 0;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px;font-size:12.5px;">
          <span style="flex:1;"><strong style="color:var(--gold);">${escapeHtml(damga)}</strong> — ${escapeHtml(p.note)}</span>
          <span style="flex:0 0 auto;white-space:nowrap;">
            <button class="btn-icon-sm prog-ust" data-i="${i}" data-tarih="${escapeHtml(oncekiTarih)}" title="Bunun ÜSTÜNE not ekle">▲+</button>
            <button class="btn-icon-sm prog-alt" data-i="${i}" data-tarih="${escapeHtml(tarih)}" title="Bunun ALTINA not ekle">▼+</button>
            <button class="btn-icon-sm prog-duzenle" data-id="${p.id}" data-tarih="${escapeHtml(tarih)}" data-not="${escapeHtml(p.note)}" title="Düzenle">✎</button>
            <button class="btn-icon-sm del-progression-btn" data-id="${p.id}" title="Sil">✕</button>
          </span>
        </div>
        <div class="prog-duzenle-kutu" style="display:none;gap:4px;margin-top:4px;flex-wrap:wrap;"></div>
      </div>`;
    }).join('');

    // İÇERİĞİ ÖNCE YAZ, olayları SONRA bağla. Bu satır kesme sırasında
    // düşmüştü: düğmeler henüz var olmayan elemanlara bağlanmaya çalışılıyor,
    // hata yakalanıyor ama panel "Yükleniyor"da kalıyordu.
    panel.innerHTML = `
      <strong style="font-size:10.5px;color:var(--text-muted);letter-spacing:0.4px;">KRONOLOJİ / GELİŞİM ÇİZELGESİ</strong>
      <div style="font-size:11px;color:var(--text-muted);margin:2px 0 6px;">
        Bu kaydın zaman içindeki değişimi. Bir sahne yazılırken SADECE o ana kadar
        olan notlar AI'ya gider - sonraki notlar gönderilmez. Süzme SADECE tarihe
        göre yapılır; tarih yazmazsan not zamansız kabul edilir ve her zaman gider.
      </div>
      ${rows || '<div class="empty-state" style="padding:4px 0;">Henüz not yok.</div>'}
      <div style="display:flex;gap:4px;margin-top:8px;flex-wrap:wrap;">
        <input type="text" id="progDate_${entityId}" placeholder="28 Haziran 2030 21:00" style="flex:2;min-width:160px;">
        <input type="text" id="progNote_${entityId}" placeholder="Ne değişti?" style="flex:3;min-width:180px;">
        <button class="btn btn-sm" id="addProgressionBtn">+ Ekle</button>
      </div>
      <div id="progErr_${entityId}" class="error-text" style="font-size:11.5px;"></div>`;

    // ▲+ / ▼+ : ekleme alanına odaklan ve tarihi komşudan doldur.
    const tarihAlani = () => document.getElementById(`progDate_${entityId}`);
    const notAlani = () => document.getElementById(`progNote_${entityId}`);
    panel.querySelectorAll('.prog-ust, .prog-alt').forEach(btn => {
      btn.addEventListener('click', () => {
        tarihAlani().value = btn.dataset.tarih || '';
        notAlani().value = '';
        tarihAlani().focus();
        tarihAlani().select();
      });
    });

    // ✎ : satırın altında yerinde düzenleme. Ayrı bir ekran açmak yerine
    // burada, çünkü düzeltilen şey çoğunlukla tek bir tarih ya da kelime.
    panel.querySelectorAll('.prog-duzenle').forEach(btn => {
      btn.addEventListener('click', () => {
        const satir = btn.closest('.prog-satir');
        const kutu = satir.querySelector('.prog-duzenle-kutu');
        if (kutu.style.display !== 'none') { kutu.style.display = 'none'; return; }
        kutu.style.display = 'flex';
        kutu.innerHTML = `
          <input type="text" class="pd-tarih" value="${escapeHtml(btn.dataset.tarih)}" placeholder="28 Haziran 2030 21:00" style="flex:2;min-width:150px;">
          <input type="text" class="pd-not" value="${escapeHtml(btn.dataset.not)}" style="flex:3;min-width:180px;">
          <button class="btn btn-sm pd-kaydet">Kaydet</button>
          <button class="btn btn-sm pd-vazgec">Vazgeç</button>`;
        kutu.querySelector('.pd-vazgec').addEventListener('click', () => { kutu.style.display = 'none'; });
        kutu.querySelector('.pd-kaydet').addEventListener('click', async () => {
          const t = kutu.querySelector('.pd-tarih').value.trim();
          const n = kutu.querySelector('.pd-not').value.trim();
          if (!n) { alert('Not boş olamaz.'); return; }
          try {
            await api.put(`/progressions/${btn.dataset.id}`, {
              story_date: normalizeTarih ? normalizeTarih(t) : t, note: n,
            });
            loadProgressionPanel(entityType, entityId);
          } catch (err) { alert(err.message); }
        });
      });
    });

    panel.querySelectorAll('.del-progression-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await api.del(`/progressions/${btn.dataset.id}`);
          loadProgressionPanel(entityType, entityId);
        } catch (err) { alert(err.message); }
      });
    });

    // Prompt() yerine ALAN: prompt sırayla iki pencere açıyordu, tarih
    // eklenince üç olacaktı - üstelik yazdığını göremiyordun.
    // el() KULLANMA: o yardımcı başka bir modülde tanımlı ve yükleme
    // sırasına bağlı olarak burada tanımsız olabiliyor - panel sessizce
    // "Yükleniyor"da kalıyordu. Panelin kendi içinde sorgula.
    panel.querySelector('#addProgressionBtn').addEventListener('click', async () => {
      const hata = document.getElementById(`progErr_${entityId}`);
      const tarih = document.getElementById(`progDate_${entityId}`).value.trim();
      const note = document.getElementById(`progNote_${entityId}`).value.trim();
      hata.textContent = '';
      if (!note) { hata.textContent = 'Ne değiştiğini yaz.'; return; }
      try {
        await api.post('/progressions/', {
          entity_type: entityType, entity_id: parseInt(entityId, 10),
          // BÖLÜM NO KALDIRILDI: iki ayrı zaman ölçüsü tutmak, hangisinin
          // geçerli olduğu sorusunu doğuruyordu. Tek ölçü TARİH.
          story_date: normalizeTarih ? normalizeTarih(tarih) : tarih,
          note,
        });
        loadProgressionPanel(entityType, entityId);
      } catch (err) { hata.textContent = err.message; }
    });
  } catch (err) {
    panel.innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`;
  }
}

// Sıralama için tarihi sayıya çevirir (06-matrix.js'teki normalizeTarih ile
// aynı biçimleri anlar). Çözülemezse null - o not bölüm numarasına düşer.
function normalizeTarihSirasi(ham) {
  const metin = (ham || '').trim();
  if (!metin) return null;
  const AYLAR = ['ocak','şubat','mart','nisan','mayıs','haziran','temmuz',
                 'ağustos','eylül','ekim','kasım','aralık'];
  const kucuk = metin.replace(/İ/g, 'i').replace(/I/g, 'ı').toLowerCase();
  let g = null, a = null, y = null;
  let m = kucuk.match(/(\d{1,2})\s+([a-zçğıöşü]+)\s*(\d{4})?/);
  if (m && AYLAR.indexOf(m[2]) >= 0) {
    g = parseInt(m[1], 10); a = AYLAR.indexOf(m[2]) + 1;
    y = m[3] ? parseInt(m[3], 10) : 0;
  } else {
    m = kucuk.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
    if (!m) return null;
    g = parseInt(m[1], 10); a = parseInt(m[2], 10); y = parseInt(m[3], 10);
    if (y < 100) y += 2000;
  }
  if (!(g >= 1 && g <= 31 && a >= 1 && a <= 12)) return null;
  const sa = kucuk.match(/(\d{1,2})[:.](\d{2})/);
  const dk = sa ? parseInt(sa[1], 10) * 100 + parseInt(sa[2], 10) : 0;
  return ((y * 100 + a) * 100 + g) * 10000 + dk;
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
      ${cfg.hasLifespan ? `<div style="display:flex;gap:6px;margin-top:10px;">
        <div class="field" style="flex:1;margin:0;"><label>${cfg.lifespanLabels[0]}
          <span style="font-weight:400;color:var(--text-muted);font-size:11.5px;">(kronoloji denetimi)</span></label>
          <input type="text" id="f_var_olus" value="${escapeHtml(isEdit ? (item.var_olus || '') : '')}" placeholder="28 Haziran 2030"></div>
        <div class="field" style="flex:1;margin:0;"><label>${cfg.lifespanLabels[1]}</label>
          <input type="text" id="f_yok_olus" value="${escapeHtml(isEdit ? (item.yok_olus || '') : '')}" placeholder="(boşsa hâlâ var)"></div>
      </div>
      <div style="font-size:11.5px;color:var(--text-muted);margin-top:2px;">Sahne bu aralığın dışındaysa AI'ya "bu sahnede henüz yok / artık yok" uyarısı gider. Çözülemeyen ifadeler ("yedi yıl önce") denetime girmez.</div>` : ''}
      ${cfg.isRule ? '' : `<div class="field" style="margin-top:10px;"><label>Notlar <span style="font-weight:400;color:var(--text-muted);font-size:11.5px;">(serbest not - kişi seçiliyken AI'ya gider)</span></label><textarea id="f_notes">${escapeHtml(notesValue)}</textarea></div>`}
      ${(isEdit && cfg.hasLifespan) ? `
      <hr style="border:none;border-top:1px solid var(--border);margin:14px 0;">
      <div class="progression-panel" data-id="${item.id}"></div>` : ''}
      <div class="form-actions">
        <button class="btn btn-primary" id="saveBtn">${isEdit ? 'Güncelle' : 'Kaydet'}</button>
        <button class="btn" id="cancelBtn">Vazgeç</button>
      </div>
      <div id="formError" class="error-text"></div>
    </div>`;

  // KRONOLOJİ DÜZENLEME EKRANINDA: eskiden listede ayrı bir "Gelişim"
  // düğmesindeydi, yani kaydı düzenlerken kronolojisini göremiyordun -
  // yeni notu nereye ekleyeceğini kestiremiyordun. Artık formun içinde,
  // kronolojik sırayla.
  if (isEdit && cfg.hasLifespan) loadProgressionPanel(type, item.id);

  el('cancelBtn').addEventListener('click', () => { container.innerHTML = ''; });
  if (supportsRules) {
    loadEntityRules(type, item.id);
    el('entityRuleAddBtn').addEventListener('click', async () => {
      const title = el('entityRuleTitle').value.trim();
      if (!title) return;
      try {
        await api.post('/rules/', { title, entity_type: type, entity_id: item.id });
        el('entityRuleTitle').value = '';
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
  el('saveBtn').addEventListener('click', async () => {
    const titleField = cfg.isRule ? 'title' : 'name';
    const payload = {};
    payload[titleField] = el('f_title').value.trim();
    payload.description = el('f_desc').value;
    if (!cfg.isRule) payload.notes = el('f_notes').value;
    if (cfg.hasLifespan) {
      payload.var_olus = el('f_var_olus').value.trim();
      payload.yok_olus = el('f_yok_olus').value.trim();
    }
    if (cfg.hasStatus) payload.status = el('f_status').value;
    if (cfg.hasAliases) {
      payload.aliases = el('f_aliases').value.split(',').map(s => s.trim()).filter(Boolean);
    }
    if (cfg.hasTags) {
      payload.tags = el('f_tags').value.split(',').map(s => s.trim()).filter(Boolean);
    }
    if (type === 'place') {
      const parentVal = el('f_parent_place').value;
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
      el('formError').textContent = 'İsim/başlık boş olamaz.';
      return;
    }
    try {
      if (isEdit) await api.put(`${cfg.endpoint}${item.id}`, payload);
      else await api.post(cfg.endpoint, payload);
      container.innerHTML = '';
      if (type === 'place') renderPlacesView();
      else renderEntityView(type);
    } catch (err) {
      el('formError').textContent = err.message;
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
