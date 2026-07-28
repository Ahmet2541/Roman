const ENTITY_TYPES = {
  character: { endpoint: '/characters/', label: 'Kişi', plural: 'Kişiler', hasStatus: true, statusOptions: ['aktif', 'pasif', 'öldü'], isRule: false },
  place: { endpoint: '/places/', label: 'Mekan', plural: 'Mekanlar', hasStatus: false, isRule: false },
  event: { endpoint: '/events/', label: 'Olay', plural: 'Olaylar', hasStatus: false, isRule: false, isCustom: true },
  object: { endpoint: '/objects/', label: 'Nesne', plural: 'Nesneler', hasStatus: false, isRule: false },
  foreshadowing: { endpoint: '/foreshadowings/', label: 'İpucu', plural: 'İpuçları', hasStatus: true, statusOptions: ['açık', 'kapandı'], isRule: false },
  term: { endpoint: '/glossary/', label: 'Terim', plural: 'Terimler', hasStatus: false, isRule: false },
  rule: { endpoint: '/rules/', label: 'Kural', plural: 'Roman Kuralları', hasStatus: false, isRule: true },
};

const main = () => document.getElementById('mainContent');

function escapeHtml(str) {
  if (str === undefined || str === null) return '';
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function truncate(str, n) { return str && str.length > n ? str.slice(0, n) + '…' : (str || ''); }

// ---------------------------------------------------------------------
// Görünüm değiştirme
// ---------------------------------------------------------------------

async function switchView(view) {
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.view === view));
  if (view === 'roman') return renderRomanView();
  if (view === 'import') return renderImportView();
  if (view === 'event') return renderEventsView();
  if (view === 'relationships') return renderRelationshipsView();
  if (view === 'fullscan') return renderFullScanView();
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
        <button class="btn btn-sm btn-danger del-btn" data-id="${item.id}">Sil</button>
      </div>
      ${progressionPanel}
    </div>`;
  }).join('');

  listEl.querySelectorAll('.progression-btn').forEach(btn => {
    btn.addEventListener('click', () => toggleProgressionPanel(type, btn.dataset.id));
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
      const chapterNumber = prompt('Hangi bölümden itibaren geçerli? (boş bırakılabilir)');
      if (chapterNumber === null) return;
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

function showEntityForm(type, item) {
  const cfg = ENTITY_TYPES[type];
  const container = document.getElementById('formContainer');
  const isEdit = !!item;
  const titleValue = isEdit ? (cfg.isRule ? item.title : item.name) : '';
  const descValue = isEdit ? item.description : '';
  const notesValue = isEdit ? (item.notes || '') : '';
  const statusValue = isEdit ? item.status : (cfg.statusOptions ? cfg.statusOptions[0] : '');

  container.innerHTML = `
    <div class="panel">
      <div class="field">
        <label>${cfg.isRule ? 'Başlık' : 'İsim'}</label>
        <input type="text" id="f_title" value="${escapeHtml(titleValue)}">
      </div>
      <div class="field">
        <label>Açıklama</label>
        <textarea id="f_desc">${escapeHtml(descValue)}</textarea>
      </div>
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

    if (!payload[titleField]) {
      document.getElementById('formError').textContent = 'İsim/başlık boş olamaz.';
      return;
    }
    try {
      if (isEdit) await api.put(`${cfg.endpoint}${item.id}`, payload);
      else await api.post(cfg.endpoint, payload);
      container.innerHTML = '';
      renderEntityView(type);
    } catch (err) {
      document.getElementById('formError').textContent = err.message;
    }
  });
}

// ---------------------------------------------------------------------
// Roman görünümü: bölüm listesi + okuma/yazma paneli + AI paneli
// ---------------------------------------------------------------------

let currentChapter = null;

async function renderRomanView() {
  main().innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:baseline;">
      <h1 class="view-title">Roman</h1>
      <span id="wordCountBadge" style="font-size:12.5px;color:var(--text-muted);"></span>
    </div>
    <div class="toolbar">
      <div></div>
      <button class="btn btn-primary" id="newChapterBtn">+ Yeni Bölüm</button>
    </div>
    <div class="roman-layout">
      <div class="chapter-list" id="chapterList"><div class="empty-state">Yükleniyor…</div></div>
      <div class="reader" id="readerPane"><div class="empty-state">Bir bölüm seç ya da yeni oluştur.</div></div>
      <div class="side-panel" id="aiPanel"></div>
    </div>`;

  document.getElementById('newChapterBtn').addEventListener('click', createChapterPrompt);
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

async function loadChapterList(selectId) {
  const listEl = document.getElementById('chapterList');
  try {
    const chapters = await api.get('/chapters/');
    if (!chapters.length) {
      listEl.innerHTML = `<div class="empty-state">Henüz bölüm yok.</div>`;
      renderAiPanel(null);
      return;
    }
    listEl.innerHTML = chapters.map(c => {
      const preview = c.summary ? c.summary.slice(0, 80) + (c.summary.length > 80 ? '…' : '') : '';
      return `<div class="chapter-item" data-id="${c.id}" title="${escapeHtml(c.summary || 'Henüz özet yok')}">
        <div style="flex:1;min-width:0;">
          <span>Bölüm ${c.number}${c.title ? ' — ' + escapeHtml(c.title) : ''}</span>
          ${preview ? `<div style="font-size:11px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(preview)}</div>` : ''}
        </div>
        <button class="btn-icon-sm del-chapter-btn" data-id="${c.id}" title="Bölümü sil">✕</button>
      </div>`;
    }).join('');
    listEl.querySelectorAll('.chapter-item').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.del-chapter-btn')) return;
        selectChapter(el.dataset.id);
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
    selectChapter(selectId || chapters[0].id);
  } catch (err) {
    listEl.innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`;
  }
}

async function createChapterPrompt() {
  const number = prompt('Bölüm numarası:');
  if (!number) return;
  const title = prompt('Bölüm başlığı (opsiyonel):') || '';
  try {
    const chapter = await api.post('/chapters/', { number: parseInt(number, 10), title });
    await loadChapterList(chapter.id);
  } catch (err) { alert(err.message); }
}

async function selectChapter(id) {
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

function renderReader(chapter) {
  const readerPane = document.getElementById('readerPane');
  const paragraphsHtml = chapter.paragraphs.map(p => `
    <div class="paragraph-block">
      <div class="paragraph-number">${p.number}</div>
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
    <div style="height:16px;"></div>
    ${paragraphsHtml || '<div class="empty-state">Henüz paragraf yok.</div>'}
    <button class="btn" id="addParaBtn">+ Yeni paragraf</button>`;

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
    const pickerHtml = PICKER_TYPES.map((t, idx) => {
      const items = lists[idx];
      if (!items.length) return '';
      return `<div style="margin-bottom:8px;">
        <strong style="font-size:10.5px;color:var(--text-muted);letter-spacing:0.4px;">${ENTITY_TYPES[t].plural.toUpperCase()}</strong><br>
        ${items.map(i => `<label><input type="checkbox" class="entity-check" data-type="${t}" data-id="${i.id}"> ${escapeHtml(i.name)}</label>`).join('')}
      </div>`;
    }).join('');

    panel.innerHTML = `
      <h3>AI Yazım Desteği</h3>
      <div class="entity-picker">${pickerHtml || '<div class="empty-state">Henüz kayıt yok</div>'}</div>
      <div class="field"><label>Talimat</label><textarea id="aiInstruction" placeholder="Örn: Ahmet'in limana varışını anlatan bir paragraf yaz"></textarea></div>
      <button class="btn btn-primary" id="aiAssistBtn" style="width:100%;">Oluştur / Düzenle</button>
      <button class="btn btn-sm" id="previewContextBtn" style="width:100%;margin-top:6px;">Bağlamı Önizle (AI'ya ne gidiyor?)</button>
      <div id="contextPreviewContainer"></div>
      <div id="aiResultContainer"></div>`;

    document.getElementById('aiAssistBtn').addEventListener('click', () => runAiAssist(chapter));
    document.getElementById('previewContextBtn').addEventListener('click', () => runContextPreview(chapter));
  } catch (err) {
    panel.innerHTML = `<h3>AI Yazım Desteği</h3><div class="error-text">${escapeHtml(err.message)}</div>`;
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
    const formData = new FormData();
    formData.append('file', fileInput.files[0]);
    const resultEl = document.getElementById('importResult');
    resultEl.innerHTML = '<div class="empty-state">Yükleniyor…</div>';
    try {
      const res = await fetch('/chapters/import', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${getToken()}` },
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
  } catch (err) {
    panel.innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`;
  }
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

if (!getToken()) {
  window.location.href = '/app/login.html';
} else {
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
      renderSearchResults(e.target.value.trim());
    }
  });
  switchView('roman');
}
