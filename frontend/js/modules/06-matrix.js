// ===========================================================================
// 06-matrix.js — Plan Matrisi: ızgara, hücreler, fihrist eşleştirme
// Bu dosya app.js'in bölünmesiyle oluştu. Tüm tanımlar GLOBAL kapsamda
// kalır (modül sistemi yok); index.html'de SIRAYLA yüklenir.
// ===========================================================================

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
    el('newMatrixBtn').addEventListener('click', openNewMatrixDialog);
    if (currentMatrixId && list.some(m => m.id === currentMatrixId)) await loadMatrixGrid();
    else if (list.length === 1) { currentMatrixId = list[0].id; await loadMatrixList(); }
    else if (!list.length) el('matrixGridArea').innerHTML = `<div class="empty-state">Henüz matris yok - "+ Yeni Matris" ile başla, sonra kolon ve satırları ekle.</div>`;
  } catch (err) {
    area.innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`;
  }
}

async function loadMatrixGrid() {
  const area = document.getElementById('matrixGridArea');
  el('matrixCellEditor').innerHTML = '';
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
        <button class="btn btn-sm" id="mCollapseAll" title="Bölüm satırlarını kapat - uzun listede gezinmeyi kolaylaştırır">⊟ Tümünü daralt</button>
        <button class="btn btn-sm" id="mFromChapter" title="Bir bölümün yapısından (alt girdileri ya da planı) satırları otomatik oluştur">⚡ Bölümden satır oluştur</button>
        <button class="btn btn-sm btn-primary" id="mGenChapters" title="Her kolon bir Kısım, her hücre bir Bölüm olur - fihristin sonuna eklenir, hücreler otomatik bağlanır">⚡ Fihristi Oluştur</button>
        <button class="btn btn-sm" id="mAiFill" title="Üstte işaretlediğin kolonların BOŞ hücrelerini, dolu hücrelerdeki kalıbı izleyerek AI taslaklar - hiçbiri onaysız kaydedilmez">🤖 Seçili Kolonların Eksiklerini AI Doldursun</button>
        <button class="btn btn-sm" id="mImport" title="Satır satır 'Aşama adı: içerik' formatında yapıştırılan metni, seçtiğin kolonun hücrelerine dağıtır">📥 Metinden Doldur</button>
        <button class="btn btn-sm" id="mDelMatrix" style="margin-left:auto;">Matrisi Sil</button>
      </div>
      ${boundChaptersStrip(m)}
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
          ${m.rows.map((r, ri) => {
            // GRUPLAMA: bağlı hücresi olan satır bir BÖLÜM başlığıdır;
            // ondan sonraki bağsız satırlar o bölümün sahneleridir ve
            // katlanabilir. 8 tur x 10 satır = çok uzun liste oluyordu.
            const bagliMi = (m.cells || []).some(c => c.row_id === r.id && c.chapter_id);
            let ustBolum = null;
            for (let k = ri; k >= 0; k--) {
              if ((m.cells || []).some(c => c.row_id === m.rows[k].id && c.chapter_id)) { ustBolum = m.rows[k].id; break; }
            }
            const gizli = !bagliMi && ustBolum && collapsedMatrixRows.has(String(ustBolum));
            const altSayisi = bagliMi ? m.rows.slice(ri + 1).findIndex(x => (m.cells || []).some(c => c.row_id === x.id && c.chapter_id)) : 0;
            const gercekAlt = bagliMi ? (altSayisi === -1 ? m.rows.length - ri - 1 : altSayisi) : 0;
            return `<tr data-row-id="${r.id}" style="${gizli ? 'display:none;' : ''}${bagliMi ? 'background:var(--paper-dim);' : ''}">
            <th style="${th}${r.kind === 'sub' ? 'font-style:italic;font-weight:400;padding-left:22px;' : ''}">
              ${bagliMi && gercekAlt > 0 ? `<button class="btn-icon-sm m-row-collapse" data-id="${r.id}" title="${gercekAlt} sahneyi göster/gizle">${collapsedMatrixRows.has(String(r.id)) ? '▸' : '▾'}</button>` : ''}
              <span style="font-size:10px;color:var(--text-muted);font-weight:700;margin-right:4px;" title="Satır sırası">${ri + 1}</span>
              <span class="m-row-edit" data-id="${r.id}" style="cursor:pointer;" title="Adı, türü ve TALİMAT KASASI'nı düzenle">${r.kind === 'sub' ? '↳ ' : ''}${escapeHtml(r.label)}</span>${(r.instructions || '').trim() ? ` <span style="font-size:10px;color:var(--gold);" title="Bu aşamanın yazım kısıtları kayıtlı - bölümlere otomatik gider">📌</span>` : ''}
              <button class="btn-icon-sm m-row-ins" data-id="${r.id}" title="Bu satırın ALTINA yeni satır ekle">⊕</button>
              <button class="btn-icon-sm m-row-del" data-id="${r.id}" title="Satırı sil (hücreleriyle)">✕</button>
              ${bagliMi && gercekAlt > 0 ? `<span style="font-size:10px;color:var(--text-muted);">${gercekAlt} sahne</span>` : ''}
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
          </tr>`;
          }).join('')}
        </table>
      </div>`;

    el('mAddCol').addEventListener('click', () => addMatrixColumn(m, null));
    area.querySelectorAll('.m-col-ins').forEach(btn => btn.addEventListener('click', (e) => {
      e.stopPropagation();
      addMatrixColumn(m, parseInt(btn.dataset.id, 10));
    }));
    el('mAddRow').addEventListener('click', () => addMatrixRow(m, null));
    el('mGenChapters').addEventListener('click', async () => {
      if (!confirm(`${m.columns.length} Kısım + ${m.columns.length * m.rows.length} Bölüm fihristin SONUNA eklenecek ve hücreler bağlanacak. Devam?`)) return;
      try {
        const r = await api.post(`/matrix/${m.id}/generate-chapters`, {});
        alert(`Oluşturuldu: ${r.created_parts} kısım, ${r.created_chapters} bölüm. ${r.linked_cells} hücre bağlandı.`);
        await loadMatrixGrid();
      } catch (err) { alert(err.message); }
    });
    el('mAiFill').addEventListener('click', async () => {
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
    el('mBulkAdd').addEventListener('click', () => openBulkAddDialog(m));
    el('mFromChapter').addEventListener('click', () => openRowsFromChapterDialog(m));
    document.querySelectorAll('.m-row-collapse').forEach(b => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = String(b.dataset.id);
      if (collapsedMatrixRows.has(id)) collapsedMatrixRows.delete(id); else collapsedMatrixRows.add(id);
      saveCollapsedMatrixRows();
      loadMatrixGrid();
    }));
    el('mCollapseAll').addEventListener('click', () => {
      const bolumSatirlari = m.rows.filter(r => (m.cells || []).some(c => c.row_id === r.id && c.chapter_id));
      const hepsiKapali = bolumSatirlari.every(r => collapsedMatrixRows.has(String(r.id)));
      bolumSatirlari.forEach(r => {
        if (hepsiKapali) collapsedMatrixRows.delete(String(r.id));
        else collapsedMatrixRows.add(String(r.id));
      });
      saveCollapsedMatrixRows();
      loadMatrixGrid();
    });
    // Bağlı bölüm rozetleri: tıklayınca o bölüme git
    document.querySelectorAll('.mx-goto-ch').forEach(b => b.addEventListener('click', async () => {
      const no = parseInt(b.dataset.num, 10);
      try {
        const tumu = await api.get('/chapters/');
        const hedef = tumu.find(c => c.number === no);
        if (hedef) { switchView('roman'); setTimeout(() => loadChapterList(hedef.id), 200); }
      } catch (err) { alert(err.message); }
    }));
    el('mImport').addEventListener('click', () => openMatrixImporter(m));
    el('mDelMatrix').addEventListener('click', async () => {
      if (!confirm('Matris ve TÜM hücre planları silinecek (bölümlere dokunulmaz). Emin misin?')) return;
      try { await api.del(`/matrix/${m.id}`); currentMatrixId = null; await loadMatrixList(); el('matrixGridArea').innerHTML = ''; }
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

  el('mCellCancel').addEventListener('click', () => { editor.innerHTML = ''; });
  el('mCellSave').addEventListener('click', async () => {
    const chapterVal = el('mCellChapter').value;
    try {
      await api.put(`/matrix/${m.id}/cells`, {
        column_id: colId, row_id: rowId,
        content: el('mCellContent').value,
        chapter_id: chapterVal ? parseInt(chapterVal, 10) : null,
      });
      editor.innerHTML = '';
      await loadMatrixGrid();
    } catch (err) { el('mCellError').textContent = err.message; }
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
    catch (err) { el('aiFillError').textContent = err.message; }
  }));
  editor.querySelectorAll('.ai-fill-skip').forEach(btn => btn.addEventListener('click', () => {
    editor.querySelector(`[data-idx="${btn.dataset.idx}"]`)?.remove();
  }));
  el('aiFillSaveAll').addEventListener('click', async () => {
    try {
      const remaining = Array.from(editor.querySelectorAll('#aiFillItems [data-idx]')).map(el => parseInt(el.dataset.idx, 10));
      for (const idx of remaining) await saveOne(idx);
      editor.innerHTML = '';
      await loadMatrixGrid();
    } catch (err) { el('aiFillError').textContent = err.message; }
  });
  el('aiFillClose').addEventListener('click', () => { editor.innerHTML = ''; });
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
    el('planDraftDiscardBtn').addEventListener('click', () => { box.innerHTML = ''; });
    el('planDraftAcceptBtn').addEventListener('click', async () => {
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
  el('quickPlanCancel').addEventListener('click', () => { box.innerHTML = ''; });
  el('quickPlanSave').addEventListener('click', async () => {
    const content = el('quickPlanText').value.trim();
    if (!content) {
      el('quickPlanError').textContent =
        'Kutu boş - gri yazı sadece örnek biçimdir, kaydedilmez. Bu bölümde ne olacağını madde madde yaz.';
      return;
    }
    try {
      await api.post('/matrix/quick-plan', { chapter_id: chapter.id, content });
      box.innerHTML = '';
      // Plan kutusu + taslak düğmesi + şerit tazelensin
      renderChapterHealthStrip(chapter);
      renderAiPanel(chapter);
    } catch (err) { el('quickPlanError').textContent = err.message; }
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
  el('mColCancel').addEventListener('click', () => { editor.innerHTML = ''; });

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

  el('mColBind').addEventListener('click', async () => {
    const parentId = el('mColParent').value;
    const box = document.getElementById('mColBindResult');
    if (!parentId) { box.innerHTML = '<div class="error-text">Önce bir üst girdi seç.</div>'; return; }
    box.innerHTML = '<div class="empty-state">Eşleştiriliyor…</div>';
    try {
      const r = await api.post(`/matrix/${m.id}/columns/${colId}/bind-outline`, {
        parent_chapter_id: parseInt(parentId, 10),
        overwrite: el('mColOverwrite').checked,
      });
      box.innerHTML = `
        <div style="font-size:12.5px;margin-top:8px;">
          ${r.linked.length ? `<div style="color:var(--text-ink);"><b>${r.linked.length} satır eşleşti:</b><br>${r.linked.map(escapeHtml).join('<br>')}</div>` : ''}
          ${r.skipped.length ? `<div style="color:var(--text-muted);margin-top:6px;"><b>Atlananlar:</b><br>${r.skipped.map(escapeHtml).join('<br>')}</div>` : ''}
        </div>`;
      await loadMatrixGrid();
    } catch (err) { box.innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`; }
  });
  el('mColSave').addEventListener('click', async () => {
    const label = el('mColLabel').value.trim();
    if (!label) { el('mColError').textContent = 'Ad boş olamaz.'; return; }
    const charVal = el('mColChar').value;
    try {
      await api.put(`/matrix/${m.id}/columns/${colId}`, {
        label, character_id: charVal ? parseInt(charVal, 10) : null,
      });
      editor.innerHTML = '';
      await loadMatrixGrid();
    } catch (err) { el('mColError').textContent = err.message; }
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
  el('mImpCancel').addEventListener('click', () => { editor.innerHTML = ''; });

  el('mImpPreview').addEventListener('click', async () => {
    const colId = parseInt(el('mImpCol').value, 10);
    const lines = el('mImpText').value.split('\n').map(l => l.trim()).filter(Boolean);
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
    el('mImpApply').addEventListener('click', async () => {
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
      selected_entities: selected.length ? selected : paragraphEntities(
        (chapter.paragraphs || []).find(x => x.number === parseInt(number, 10))),
      existing_text: text, include_own_summary: true,
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
            <div style="display:flex;gap:6px;">
              <input type="text" class="para-purpose" data-number="${number}" value="${escapeHtml(paraPurposes[number] || '')}" placeholder="ör. Yangın yerini masum göstermek" style="flex:1;font-size:12.5px;">
              <button class="btn btn-sm find-purpose" data-number="${number}" style="font-size:11px;white-space:nowrap;" title="Bölüm özeti ve planından bu paragrafın görevini çıkar">🎯 İşlevi bul</button>
            </div>
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
    // İŞLEVİ BUL: atölyeden geçmemiş bölümlerde de tek paragrafın görevini
    // çıkarabilmek için. Bölümün TAMAMI taranır ama sadece bu paragrafın
    // sonucu alınır - özet+plan bağlamı olduğu için isabet yüksek.
    panel.querySelector('.find-purpose')?.addEventListener('click', async (e) => {
      const b = e.target;
      b.disabled = true; b.textContent = 'Bulunuyor…';
      try {
        const r = await api.post(`/ai/paragraph-roles/${chapter.id}`, {});
        const benimki = (r.roles || []).find(x => x.p === parseInt(number, 10));
        (r.roles || []).forEach(x => { if (!paraPurposes[x.p]) paraPurposes[x.p] = x.role; });
        saveParaState();
        if (benimki) {
          paraPurposes[number] = benimki.role;
          panel.querySelector('.para-purpose').value = benimki.role;
          saveParaState();
        } else {
          b.textContent = 'Bulunamadı';
        }
      } catch (err) { alert(err.message); }
      b.disabled = false;
      if (b.textContent === 'Bulunuyor…') b.textContent = '🎯 İşlevi bul';
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
    // TEK HUNİ: metne yazan her yol buradan geçer. Karşılaştırma temeli
    // burada güncellenir - eskiden 11 uygulama noktasının yalnızca 4'ünde
    // güncelleniyordu ve sohbet/mikro düzenleme/elle kayıt sonrası kontrol
    // BAYAT metinle kıyaslıyordu. Geri alma da otomatik olarak temeli
    // eski metne çeker (o da bu fonksiyondan geçiyor).
    setVerifyBaseline(number, text);
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
    // Paragraf ekranda yoksa bellekteki bölümü tazele. Okuyucuyu YALNIZCA
    // gerçekten varsa yeniden çiz: atölye Denetim menüsünden açıldığında
    // Roman görünümü hiç oluşturulmamış olur ve renderReader "Cannot set
    // properties of null" ile patlıyordu.
    if (!el) {
      const refreshed = await api.get(`/chapters/${chapterId}`);
      currentChapter = refreshed;
      if (workshopState && workshopState.chapter && workshopState.chapter.id === chapterId) {
        workshopState.chapter = refreshed;   // atölye kendi kopyasını taze tutar
      }
      if (document.getElementById('readerPane')) renderReader(refreshed);
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
  el('mRowCancel').addEventListener('click', () => { editor.innerHTML = ''; });
  el('mRowSave').addEventListener('click', async () => {
    const label = el('mRowLabel').value.trim();
    if (!label) { el('mRowError').textContent = 'Ad boş olamaz.'; return; }
    try {
      await api.put(`/matrix/${m.id}/rows/${rowId}`, {
        label,
        kind: el('mRowKind').value,
        instructions: el('mRowInstructions').value,
      });
      editor.innerHTML = '';
      await loadMatrixGrid();
    } catch (err) { el('mRowError').textContent = err.message; }
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
    + '\nİKİ MOD VAR, KULLANICININ MESAJINA GÖRE SEÇ:\n'
    + '(A) TARTIŞMA - kullanıcı soru soruyor ya da fikir istiyorsa: fikrini söyle, sorunu '
    + 'göster, gerekirse TEK soru sor. Metin üretme.\n'
    + '(B) UYGULAMA - kullanıcı KENDİ CÜMLESİNİ yazdıysa, somut bir öneri sunduysa ya da '
    + 'yeniden yazım istediyse ("şöyle dese", "şunu ekle", "böyle olsun"): TARTIŞMA. '
    + 'Öneriyi paragrafa UYGULA ve yeni hâli set_draft_result ile ver.\n'
    + 'ASLA: alternatif metinleri sohbet cevabının İÇİNE yazma. Metin üreteceksen taslak '
    + 'aracıyla ver - sohbete gömülen metin kullanıcı tarafından uygulanamaz, boşa gider.\n'
    + 'ASLA: "hangisini tercih edersin?", "üçüncüsünü de hazırlayabilirim" deme. Tek en iyi '
    + 'hâli üret; kullanıcı beğenmezse yönlendirir.\n'
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
    let taslak = (result.draft_result || '').trim();
    // KURTARMA: model kurala rağmen metni sohbete gömdüyse, tırnak içindeki
    // ya da numaralı alternatif olarak yazdığı en uzun bloğu taslak say -
    // yoksa kullanıcının önerisi uygulanamadan kayboluyor.
    if (!taslak && yorum) {
      const adaylar = [...yorum.matchAll(/[“"']([^”"']{60,600})[”"']/g)].map(m => m[1].trim());
      if (adaylar.length) taslak = adaylar.sort((a, b) => b.length - a.length)[0];
    }
    if (taslak) {
      paraChatHistories[number].push({ role: 'assistant', content: taslak, isVersion: true });
      // Temel BURADA ilerlemez: taslak henüz uygulanmadı. Eskiden burada
      // güncelleniyordu ve kontrol, taslağı KENDİSİYLE karşılaştırıp
      // "birebir aynı, öneri başarıyla uygulanmış" diyordu - hiçbir şey
      // doğrulanmıyordu. Temel yalnızca metin gerçekten yazıldığında
      // (replaceParagraphText) ilerler.
    }
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

// Sesli okuma başlangıç seçici: hangi paragraftan başlanacağı ve nerede
// biteceği. 224 paragraflık bir bölümde baştan dinlemek zorunda kalmak
// kullanışsızdı; artık aralık verip sadece o kısmı dinleyebiliyorsun.
function openTtsRangePicker(chapter) {
  const paras = (chapter.paragraphs || []).slice().sort((a, b) => a.number - b.number)
    .filter(p => (p.text || '').trim());
  if (!paras.length) { alert('Okunacak metin yok.'); return; }
  if (paras.length <= 5) { startChapterTts(chapter, 0); return; }   // kısa bölümde soru sorma

  const overlay = ensureModalOverlay();
  const ilk = paras[0].number, son = paras[paras.length - 1].number;
  overlay.innerHTML = `
    <div class="panel" style="max-width:420px;width:92%;">
      <b>🔊 Sesli Oku</b>
      <div style="font-size:12.5px;color:var(--text-muted);margin-top:4px;">
        ${paras.length} paragraf (P${ilk}–P${son}). Aralık seçebilirsin.
      </div>
      <div style="display:flex;gap:10px;margin-top:8px;">
        <div class="field" style="flex:1;"><label>Başlangıç</label>
          <input type="number" id="ttsFrom" value="${ilk}" min="${ilk}" max="${son}"></div>
        <div class="field" style="flex:1;"><label>Bitiş</label>
          <input type="number" id="ttsTo" value="${son}" min="${ilk}" max="${son}"></div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        <button class="btn btn-sm" id="ttsPresetAll" style="font-size:11.5px;">Tümü</button>
        <button class="btn btn-sm" id="ttsPresetFirst" style="font-size:11.5px;">İlk 10</button>
        <button class="btn btn-sm" id="ttsPresetLast" style="font-size:11.5px;">Son 10</button>
        <button class="btn btn-sm" id="ttsPresetFlagged" style="font-size:11.5px;" title="İncelemede bulgu çıkan paragraflar">⚑ Bulgulular</button>
      </div>
      <div class="form-actions">
        <button class="btn btn-primary" id="ttsStart">Oku</button>
        <button class="btn" id="ttsCancel">Vazgeç</button>
      </div>
    </div>`;
  overlay.style.display = 'flex';
  const kapat = () => { overlay.style.display = 'none'; overlay.innerHTML = ''; };
  el('ttsCancel').addEventListener('click', kapat);
  el('ttsPresetAll').addEventListener('click', () => {
    el('ttsFrom').value = ilk; el('ttsTo').value = son;
  });
  el('ttsPresetFirst').addEventListener('click', () => {
    el('ttsFrom').value = ilk;
    el('ttsTo').value = paras[Math.min(9, paras.length - 1)].number;
  });
  el('ttsPresetLast').addEventListener('click', () => {
    el('ttsFrom').value = paras[Math.max(0, paras.length - 10)].number;
    el('ttsTo').value = son;
  });
  el('ttsPresetFlagged').addEventListener('click', () => {
    const c = loadReviewCache(chapter.id);
    const numaralar = Object.keys(c?.findings || {}).map(Number).sort((a, b) => a - b);
    if (!numaralar.length) { alert('Bu bölümde işaretli bulgu yok - önce incele.'); return; }
    kapat();
    startChapterTts(chapter, 0, numaralar);
  });
  el('ttsStart').addEventListener('click', () => {
    const bas = parseInt(el('ttsFrom').value, 10) || ilk;
    const bit = parseInt(el('ttsTo').value, 10) || son;
    const secili = paras.filter(p => p.number >= Math.min(bas, bit) && p.number <= Math.max(bas, bit))
      .map(p => p.number);
    kapat();
    startChapterTts(chapter, 0, secili);
  });
}

function startChapterTts(chapter, startIndex = 0, onlyNumbers = null) {
  if (!window.speechSynthesis) {
    alert('Tarayıcın sesli okumayı desteklemiyor. Chrome, Edge ya da Safari dene.');
    return;
  }
  window.speechSynthesis.cancel();
  ttsState.paragraphs = (chapter.paragraphs || []).slice().sort((a, b) => a.number - b.number)
    .filter(p => (p.text || '').trim())
    .filter(p => !onlyNumbers || onlyNumbers.includes(p.number));
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
  el('nmCancel').addEventListener('click', close);
  el('nmCreate').addEventListener('click', async () => {
    const name = el('nmName').value.trim();
    if (!name) { el('nmError').textContent = 'Matris adı gerekli.'; return; }
    const nCols = Math.max(0, Math.min(50, parseInt(el('nmCols').value, 10) || 0));
    const nRows = Math.max(0, Math.min(50, parseInt(el('nmRows').value, 10) || 0));
    const cp = el('nmColPrefix').value.trim() || 'Kolon';
    const rp = el('nmRowPrefix').value.trim() || 'Satır';
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
    } catch (err) { el('nmError').textContent = err.message; }
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
  el('baCancel').addEventListener('click', () => { editor.innerHTML = ''; });
  el('baApply').addEventListener('click', async () => {
    const nCols = Math.max(0, Math.min(50, parseInt(el('baCols').value, 10) || 0));
    const nRows = Math.max(0, Math.min(50, parseInt(el('baRows').value, 10) || 0));
    if (!nCols && !nRows) { el('baError').textContent = 'En az bir sayı gir.'; return; }
    const cp = el('baColPrefix').value.trim() || 'Kolon';
    const rp = el('baRowPrefix').value.trim() || 'Satır';
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
      el('matrixCellEditor').innerHTML = '';
      await loadMatrixGrid();
    } catch (err) {
      el('baError').textContent = err.message;
      btn.disabled = false; btn.textContent = 'Ekle';
    }
  });
}
