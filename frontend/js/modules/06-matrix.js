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
        ${list.map((m, i) => {
          // BÖLÜM ARALIĞI elle yazılmaz, hücrelerin bölüm bağlarından
          // türetilir - bağ değişince ad kendiliğinden düzelir.
          // Bağ yoksa bunu açıkça söyle: "hangi bölüm?" sorusu sekmede
          // cevapsız kalmasın.
          const aralik = m.chapter_label
            ? `<b style="color:var(--gold);">${escapeHtml(m.chapter_label)}</b>`
            : '<span style="opacity:0.55;">bölüm bağı yok</span>';
          const secili = currentMatrixId === m.id;
          // Taşıma okları yalnızca AÇIK matriste - her sekmede iki ok
          // olsa şerit okunmaz hale gelirdi.
          const oklar = (secili && list.length > 1)
            ? `<button class="btn-icon-sm m-mat-move" data-id="${m.id}" data-dir="up" title="Sırada bir yukarı taşı" ${i === 0 ? 'disabled' : ''}>◀</button>
               <button class="btn-icon-sm m-mat-move" data-id="${m.id}" data-dir="down" title="Sırada bir aşağı taşı" ${i === list.length - 1 ? 'disabled' : ''}>▶</button>`
            : '';
          return `<span style="display:inline-flex;align-items:center;gap:2px;">
            <button class="btn btn-sm matrix-open ${secili ? 'btn-primary' : ''}" data-id="${m.id}">
              ${aralik} · ${escapeHtml(m.name)}
              <span style="opacity:0.7;">(${m.column_count}×${m.row_count}, ${m.filled_cell_count} dolu)</span>
            </button>${oklar}</span>`;
        }).join('')}
        <button class="btn btn-sm" id="newMatrixBtn">+ Yeni Matris</button>
      </div>`;
    area.querySelectorAll('.matrix-open').forEach(btn => btn.addEventListener('click', () => {
      currentMatrixId = parseInt(btn.dataset.id, 10);
      loadMatrixList();
      loadMatrixGrid();
    }));
    // Taşıma okları: sekmeyi açmasınlar, sadece sırayı değiştirsinler.
    area.querySelectorAll('.m-mat-move').forEach(btn => btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (btn.disabled) return;
      try {
        await api.post(`/matrix/${btn.dataset.id}/move?direction=${btn.dataset.dir}`, {});
        await loadMatrixList();
      } catch (err) { alert(err.message); }
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
        <button class="btn btn-sm" id="mExport" title="Bütün plan matrislerini tek dosyada indir - yapılandırılmış veri, miras alanları, bölüm bağları dahil">⬇ Toplu İndir</button>
        <button class="btn btn-sm" id="mAudit" title="Tamamlanmış planı dışarıdan denetletmek için hazır metin - kopyalayıp Qwen'e yapıştır">🧪 Denetim Promptu</button>
        <button class="btn btn-sm" id="mDelMatrix" style="margin-left:auto;">Matrisi Sil</button>
      </div>
      <div id="matrisSaglik"></div>
      <div style="display:none;">
      </div>
      ${boundChaptersStrip(m)}
      <div style="overflow-x:auto;">
        <table style="border-collapse:collapse;width:max-content;">
          <tr>
            <th style="${th}"></th>
            ${m.columns.map(c => {
              // Katlanmış gruplardaki boş hücreler ızgarada görünmüyor;
              // sayaç onları ele verir. Hiç başlanmamış tur için sayaç
              // gösterilmez - 8 turdan 7'si boşken "0/16" gürültüsü olur.
              const doluSayi = m.cells.filter(x => x.column_id === c.id && (x.content || '').trim()).length;
              const sayac = doluSayi
                ? `<div style="font-weight:400;font-size:10px;color:${doluSayi < m.rows.length ? 'var(--gold)' : 'var(--text-muted)'};" title="${doluSayi} satır dolu, ${m.rows.length - doluSayi} boş">${doluSayi}/${m.rows.length}${doluSayi < m.rows.length ? ' ⚠' : ''}</div>`
                : '';
              return `<th style="${th}">
              <input type="checkbox" class="m-col-check" data-id="${c.id}" title="AI doldurma için bu kolonu seç" style="margin-right:4px;">
              <span class="m-col-edit" data-id="${c.id}" style="cursor:pointer;" title="Adı değiştir">${escapeHtml(c.label)}</span>
              <button class="btn-icon-sm m-col-ins" data-id="${c.id}" title="Bu kolonun SAĞINA yeni kolon ekle">⊕</button>
              <button class="btn-icon-sm m-col-del" data-id="${c.id}" title="Kolonu sil (hücreleriyle)">✕</button>
              ${sayac}
            </th>`;
            }).join('')}
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
              // Yapılandırılmış hücrede ilk satır zaten OLAY - ızgarada
              // sahnenin kimliği görünsün, ham metnin başı değil.
              const ozet = filled
                ? (cell.data && cell.data.olay ? cell.data.olay : cell.content.trim().split('\n')[0])
                : '';
              const preview = filled
                ? escapeHtml(ozet.slice(0, 60)) + (ozet.length > 60 ? '…' : '')
                : '<span style="opacity:0.35;">—</span>';
              const chBadge = cell && cell.chapter_number ? `<span style="font-size:10px;background:var(--paper-dim);border:1px solid var(--border);border-radius:3px;padding:0 4px;" title="Bölüm ${cell.chapter_number}'e bağlı - plan o bölümde AI'ya gider">B${cell.chapter_number}</span>` : '';
              const codeBadge = cell && cell.code ? `<span style="font-size:10px;color:var(--text-muted);" title="Sabit referans kodu - başka bir bölümün talimatında '${cell.code}' yazarsan bu plan kıyas için AI'ya gider">${cell.code}</span>` : '';
              // YAPI KİLİDİ: eksik alanı olan hücre ⚠ ile işaretlenir.
              // Kaydı engellemez - sadece "burada iş var" der, böylece
              // 56 hücreyi tek tek açmadan nerede boşluk kaldığı görünür.
              const uyariSayisi = (cell && cell.warnings) ? cell.warnings.length : 0;
              const warnBadge = uyariSayisi
                ? `<span style="font-size:10px;color:var(--gold);" title="${escapeHtml(cell.warnings.join(' · '))}">⚠${uyariSayisi}</span>`
                : '';
              // HEDEF UZUNLUK harfi: ızgarada görünmezse her hücreyi tek tek
              // açmadan fark edilemez. Aynı satırda farklı harf = paralel
              // sahneler farklı boyda çıkacak demek.
              const uzKisa = { ozet: 'Ö', normal: 'N', uzun: 'U' };
              const uz = (cell && cell.data && cell.data.uzunluk) || null;
              const uzBadge = (filled && uz)
                ? `<span style="font-size:10px;color:var(--text-muted);border:1px solid var(--border);border-radius:3px;padding:0 3px;" title="Hedef uzunluk: ${uz}">${uzKisa[uz] || '?'}</span>`
                : '';
              const badge = [codeBadge, chBadge, uzBadge, warnBadge].filter(Boolean).join(' ');
              return `<td style="${td}${filled ? '' : 'background:transparent;'}" class="m-cell" data-col="${c.id}" data-row="${r.id}">
                <div style="display:flex;justify-content:space-between;gap:4px;">${badge}<span style="opacity:0.5;font-size:10px;">${filled ? '●' : ''}</span></div>
                <div style="white-space:pre-wrap;">${preview}</div>
              </td>`;
            }).join('')}
          </tr>`;
          }).join('')}
        </table>
      </div>`;

    el('mExport').addEventListener('click', () => openMatrixExport(m));
    matrisSagligiGoster(m.id);
    el('mAudit').addEventListener('click', () => openAuditPrompt(m));
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

// ---------------------------------------------------------------------------
// YAPI KİLİDİ v1.0 - hücre formu.
//
// Bir hücre artık serbest metin değil, sabit bir sahne şeması:
//   ÜST  : OLAY · ZAMAN (tarih+saat+tip) · MEKAN · DUYGU
//   YAY  : GİRİŞ · GELİŞME · SONUÇ  (damga kelime SONUÇ'ta asılı kalır)
//   BAĞ  : MP kodları + tür (ayna / ileri / geri)
// MİRAS (tur damgası, parça no/süre) burada YOK - kolon/satır kaydında
// durur, AI'ya oradan canlı gider. Varlıklar (kişi/mekan/nesne) düz metin
// değil, autocomplete ile mevcut kayıtlara ID'yle bağlanır: "aynı varlık =
// aynı ID" kuralı böylece veri düzeyinde kilitlenir.
// ---------------------------------------------------------------------------

// Backend'deki plan_schema.TUR_ALANLARI ile aynı anahtarlar ve sıra.
const TUR_ALANLARI = [
  ['konu', 'Konu', 'Bu turun ekseni'],
  ['suc', 'Suç', 'Turun suçu / iddiası'],
  ['misafir', 'Misafir', 'Bu turun misafiri'],
  ['guven_kelimesi', 'Güven kelimesi', 'Turun güven sözcüğü'],
  ['matematik_cifti', 'Matematik çifti', 'Sayı/oran çifti'],
  ['damga', 'Damga', "SONUÇ beat'inde asılı kalmalı"],
  ['koltugun_alti', 'Koltuğun altı', 'Koltuk altındaki şey'],
  ['ovgu', 'Övgü', 'Turun övgü kalıbı'],
];

// Anahtar ASCII 'SAYAC' olarak saklanır (eski kayıtlar bozulmasın),
// ekranda 'SAYAÇ' yazılır. Açıklama etiketin içinde: kısaltmanın ne
// demek olduğu açılır listeden anlaşılmalı, tahmin ettirmemeli.
// YARDIM BALONLARI - alanın modele giden GERÇEK etkisini anlatır.
// Uydurma bir açıklama yazmak, yazarın bir şey sanıp sistemin başka şey
// yapmasına yol açar; bu yüzden metinler render_cell'in ürettiği kısıtla
// birebir tutulur.
function yardim(metin, hiza) {
  const k = hiza ? ` ${hiza}` : '';
  return `<span class="yardim${k}" tabindex="0">?<span class="balon">${escapeHtml(metin)}</span></span>`;
}

const YARDIM = {
  olay: 'Sahnenin tek cümlelik kimliği: KİM KİME NE YAPAR. Izgarada bu cümle görünür. Uzayıp sahne özetine dönerse uyarı çıkar - burası olay dizisi değil, tek cümle.',
  tarih: '"03,05,27" yazıp alandan çıkarsan "03 Mayıs 2027" olur. Nokta, eğik çizgi, tire de olur. Takvim dışı zaman da yazabilirsin ("üçüncü gün") - dokunulmaz, ama o zaman kronolojik süzmeye girmez.',
  saat: 'Saat yazarsan plana bir KISIT olarak gider: "sahne BU AN\'da geçer, günün saatiyle çelişen ışık ve zaman ifadesi kullanma". 13:30 yazılıyken "akşam" yazılmasını engeller.',
  zamanTip: 'NOKTA: sahne tek bir anda geçer, süre işlemez. ATLAMA: önceki sahneden zaman sıçraması var. SAYAÇ: sahne boyunca işleyen bir süre var (ambulansın yedi dakikası gibi).',
  sayac: 'Tip SAYAÇ ya da ATLAMA ise neyin sayacı / neyden atlandığı yazılmalı. Tek başına "SAYAÇ" modele hiçbir şey söylemez.',
  mekan: 'Kayıtlı bir Mekan seçersen o mekanın PROFİLİ de otomatik olarak bağlama gider. Rozet dolu değilse kayıtta yok demektir - serbest metin kalır, profil gitmez.',
  ortam: 'Mekânın o andaki hâli - kişilerin duygusundan AYRI. Asıl değer aradaki farkta: odada gerilim varken Başkan\'da korku olması, adamın kalabalıktan fazlasını hissettiğini söyler. İkisi birebir aynıysa uyarı çıkar.',
  kisiler: 'Her kişi KENDİ duygu yayını taşır, böylece iki bilinç sahneyi bölmeden aktarılır. Rozet dolu olan kişilerin profili ve KONUŞMA TARZI otomatik olarak bağlama gider - model onları aynı ağızdan yazmasın diye.',
  nesneler: 'Virgülle ayır. Rozet dolu olanların profili bağlama gider. Bir nesneyi kayda geçirmek, romanın her yerinde aynı nesne olarak tanınmasını sağlar.',
  odak: 'Bir İPUCU değil KISIT: plana "betimleme SADECE bunun üzerinde kalacak, başka nesneye geçme" diye gider. NESNELER listesinden tek bir nesne olmalı. Birden çok nesne varken boş bırakırsan uyarı çıkar - dikkat dağılır.',
  uzunluk: 'Etiket değil, somut karşılığı gider: Özet = "1-2 paragraf, sahne AÇILMAZ", Normal = "4-6 paragraf", Uzun = "8+ paragraf, ritim yavaşlar". Uzunluk istiyorsan BEAT SAYISINI artır - modele olay uydurması yasak, beat yetmezse metni derinleştirir.',
  giris: 'Sahne neyle BAŞLIYOR: ilk hareket ya da ilk replik. Bir AN, olay dizisi değil. "+ GİRİŞ" ile birden çok beat ekleyebilirsin (paralel matriste tek beat olmalı).',
  gelisme: 'Sahnenin DÖNDÜĞÜ an: baskı, tehdit, tanıma. Birden çok bağımsız hareket varsa "+ GELİŞME" ile ayrı beat yap - hepsini tek kutuya yazarsan yazana kuracak yer kalmaz.',
  sonuc: 'Sahne neyle KAPANIYOR. Turun damga kelimesi burada asılı kalmalı; geçmiyorsa uyarı çıkar. Kapanış bir eşik bıraksın, sonraki sahnenin hedefini doğursun.',
  baglanti: 'Başka bir hücreye (MP kodu) gönderme. Tür ayna/ileri/geri. Not alanına REFERANS değil EYLEM yaz: "T1\'deki mendil jestini burada raporla tekrarla" gibi. Yalnızca kod yazarsan model ne yapacağını bilmez, uyarı çıkar.',
  bagliBolum: 'Bu plan SADECE seçilen bölüm yazılırken AI\'ya gider. Bağ yoksa plan hiçbir yere gitmez - hücrede durur, kimse okumaz. Alt satırlar bilerek bağsız bırakılır; onlar üstlerindeki bölümün SAHNELERİ olarak gider.',
  turMirasi: 'Bu turun HER hücresine otomatik giden bilgi - hücreye kopyalanmaz. Damgayı değiştirirsen 56 hücreyi yeniden yazman gerekmez. Soyut tema yazma ("görenle görmeyen" gibi), model onu harfiyen okur; somut yaz.',
  parcaMirasi: 'Bu aşamanın no ve süresi - el yazmasındaki "### 1 Hologramdaki ip uçları (5 Dakika)" biçiminin karşılığı. Bütün turlarda aynı konumu işaretler.',
  talimatKasasi: 'Bu aşamanın KALICI yazım kısıtları. Her turda, o aşamanın her hücresinde AI\'ya gider. "İyi talimatı" her seferinde yeniden yazmak zorunda kalmazsın.',
};

if (typeof window !== 'undefined') window.YARDIM = YARDIM;

const ZAMAN_TIPLERI = [
  ['NOKTA', 'NOKTA — tek bir an, süre işlemiyor'],
  ['ATLAMA', 'ATLAMA — önceki sahneden zaman sıçraması'],
  ['SAYAC', 'SAYAÇ — sahne boyunca işleyen süre'],
];

// DUYGU LİSTESİ - temel duygular ve alt tonları, kategori sırasıyla.
// Açılır listede öneri olarak çıkar ama SERBEST METİN engellenmez:
// "tören havası" gibi listede olmayan bir hâli de yazabilmelisin.
const DUYGU_GRUPLARI = [
  ['Mutluluk', ['mutluluk', 'neşe', 'huzur', 'memnuniyet', 'keyif', 'coşku', 'minnettarlık', 'gurur', 'umut']],
  ['Sevgi', ['sevgi', 'şefkat', 'merhamet', 'bağlılık', 'hayranlık', 'koruma içgüdüsü', 'yakınlık']],
  ['Üzüntü', ['üzüntü', 'keder', 'hüzün', 'yalnızlık', 'çaresizlik', 'pişmanlık', 'melankoli', 'yas']],
  ['Korku', ['korku', 'endişe', 'panik', 'tedirginlik', 'güvensizlik', 'dehşet', 'ürkeklik', 'stres', 'gerilim']],
  ['Öfke', ['öfke', 'sinir', 'hiddet', 'kızgınlık', 'hayal kırıklığı', 'tahammülsüzlük', 'intikam arzusu']],
  ['İğrenme', ['iğrenme', 'tiksinti', 'nefret', 'aşağılama']],
  ['Şaşkınlık', ['şaşkınlık', 'hayret', 'afallama', 'merak', 'şok']],
  ['Karmaşık', ['kıskançlık', 'suçluluk', 'utanç', 'heyecan', 'nostalji', 'soğukkanlılık', 'beklenti', 'ilgisizlik']],
];

// Düz liste GRUPLARDAN TÜRETİLİR - iki yerde ayrı ayrı tutulursa
// biri güncellenip öteki unutulur. Yazarken süzme (datalist) bunu kullanır.
const DUYGU_LISTESI = DUYGU_GRUPLARI.flatMap(([, tonlar]) => tonlar);
if (typeof window !== 'undefined') {
  window.DUYGU_LISTESI = DUYGU_LISTESI;
  window.DUYGU_GRUPLARI = DUYGU_GRUPLARI;
}

// GRUPLU DUYGU SEÇİCİ: tek bir kayan pencere, hangi alan tetiklediyse
// ona yazar. Her alan için ayrı pencere kurmak yerine tek pencere -
// kişi satırları yeniden çizildiğinde kaybolmasın diye.
// Masaüstünde grubun üzerine gelince, dokunmatikte tıklayınca açılır.
function duyguSeciciAc(hedefInput, dugme) {
  let pencere = document.getElementById('duyguSecici');
  if (!pencere) {
    pencere = document.createElement('div');
    pencere.id = 'duyguSecici';
    pencere.style.cssText = 'position:absolute;z-index:9999;display:flex;'
      + 'background:var(--paper);border:1px solid var(--border);border-radius:6px;'
      + 'box-shadow:0 4px 16px rgba(0,0,0,0.18);font-size:12px;overflow:hidden;';
    document.body.appendChild(pencere);
  }
  pencere.style.display = 'flex';

  function ciz(acikGrup) {
    pencere.innerHTML = `
      <div style="min-width:120px;border-right:1px solid var(--border);max-height:260px;overflow-y:auto;">
        ${DUYGU_GRUPLARI.map(([ad], i) => `
          <div class="ds-grup" data-i="${i}" style="padding:6px 10px;cursor:pointer;white-space:nowrap;
               ${i === acikGrup ? 'background:var(--paper-dim);font-weight:600;' : ''}">
            ${escapeHtml(ad)} <span style="opacity:0.5;">›</span></div>`).join('')}
      </div>
      <div style="min-width:140px;max-height:260px;overflow-y:auto;">
        ${DUYGU_GRUPLARI[acikGrup][1].map(t => `
          <div class="ds-ton" data-ton="${escapeHtml(t)}" style="padding:6px 10px;cursor:pointer;white-space:nowrap;">
            ${escapeHtml(t)}</div>`).join('')}
      </div>`;
    pencere.querySelectorAll('.ds-grup').forEach(g => {
      g.addEventListener('mouseenter', () => ciz(+g.dataset.i));
      g.addEventListener('click', () => ciz(+g.dataset.i));
    });
    pencere.querySelectorAll('.ds-ton').forEach(t => {
      t.addEventListener('click', () => {
        hedefInput.value = t.dataset.ton;
        hedefInput.dispatchEvent(new Event('input'));
        duyguSeciciKapat();
      });
    });
  }
  ciz(0);

  const r = dugme.getBoundingClientRect ? dugme.getBoundingClientRect() : { bottom: 0, left: 0 };
  pencere.style.top = `${(r.bottom || 0) + (window.scrollY || 0) + 4}px`;
  pencere.style.left = `${Math.max(4, (r.left || 0) + (window.scrollX || 0) - 120)}px`;
}

function duyguSeciciKapat() {
  const p = document.getElementById('duyguSecici');
  if (p) p.style.display = 'none';
}

// TARİH NORMALLEŞTİRME: "03,05,27" -> "03 Mayıs 2027".
// Ayraç olarak virgül, nokta, eğik çizgi, tire ve boşluk kabul edilir.
// TANINMAYAN metin OLDUĞU GİBİ kalır - romanda "üçüncü gün" ya da
// "kapanıştan iki hafta sonra" yazabilmelisin, biçim dayatılmamalı.
const AYLAR_TR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
                  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

function normalizeTarih(metin) {
  const ham = (metin || '').trim();
  const m = ham.match(/^(\d{1,2})\s*[,./\-\s]\s*(\d{1,2})\s*[,./\-\s]\s*(\d{2,4})$/);
  if (!m) return ham;
  const gun = parseInt(m[1], 10);
  const ay = parseInt(m[2], 10);
  let yil = parseInt(m[3], 10);
  if (gun < 1 || gun > 31 || ay < 1 || ay > 12) return ham;  // tarih değil, dokunma
  if (m[3].length <= 2) yil += 2000;   // "27" -> 2027
  return `${String(gun).padStart(2, '0')} ${AYLAR_TR[ay - 1]} ${yil}`;
}

// Backend'deki plan_schema.UZUNLUK_SEVIYELERI ile aynı anahtarlar.
// Somut karşılık AI'ya backend'den gider; buradaki kısa açıklama sadece
// yazarken hangi ölçüyü seçtiğini hatırlatmak için.
const UZUNLUK_SEVIYELERI = [
  ['ozet', 'Özet', '1-2 paragraf, sahne açılmaz'],
  ['normal', 'Normal', '4-6 paragraf, sahne tam açılır'],
  ['uzun', 'Uzun metin', '8+ paragraf, ritim yavaşlar'],
];
const BAGLANTI_TURLERI = ['ayna', 'ileri', 'geri'];

// Varlık listeleri hücreden hücreye değişmiyor - bir kez çekilip saklanır
// (8x7'lik matriste her hücre açılışında üç istek atmanın anlamı yok).
let _varlikOnbellek = null;
async function loadVarliklar() {
  if (_varlikOnbellek) return _varlikOnbellek;
  const cek = async (yol) => { try { return await api.get(yol); } catch (e) { return []; } };
  const [kisiler, mekanlar, nesneler] = await Promise.all([
    cek('/characters/'), cek('/places/'), cek('/objects/'),
  ]);
  _varlikOnbellek = { kisiler, mekanlar, nesneler };
  return _varlikOnbellek;
}
function invalidateVarlikCache() { _varlikOnbellek = null; }

function _datalistSecenekleri(kayitlar) {
  return kayitlar.map(k => `<option value="${escapeHtml(k.name)}"></option>`).join('');
}

// Yazılan adı kayıt listesinde arar (birebir, büyük/küçük harf duyarsız).
// Bulursa ID'yi de taşır - bulamazsa serbest metin olarak kalır, çünkü
// yazarken henüz açılmamış bir varlığı yazabilmek engellenmemeli.
function _varlikEslestir(ad, kayitlar) {
  const temiz = (ad || '').trim();
  if (!temiz) return null;
  const hedef = _trLowerJs(temiz);
  const bulunan = kayitlar.find(k => _trLowerJs(k.name || '') === hedef);
  return { id: bulunan ? bulunan.id : null, ad: temiz };
}

// ÇOKLU ALAN AUTOCOMPLETE: tarayıcının <datalist>'i alanın TAMAMINI
// eşleştirir - "Vicdan, Pal" yazınca hiçbir öneri çıkmaz, yani ilk
// isimden sonra öneri ölür. Bu yüzden virgülle çoklu giriş alan
// alanlarda (KİŞİLER, NESNELER) son virgülden sonraki parçaya bakan
// kendi öneri listemizi kullanıyoruz. Dokunmatikte de çalışsın diye
// öneriler tıklanabilir düğmeler.
function wireMultiAutocomplete(inputId, kayitlar) {
  const girdi = document.getElementById(inputId);
  if (!girdi || !girdi.parentElement) return;
  const kutu = document.createElement('div');
  kutu.style.cssText = 'display:none;flex-wrap:wrap;gap:4px;margin-top:4px;';
  girdi.parentElement.appendChild(kutu);

  const sonParca = () => {
    const p = girdi.value.split(',');
    return { onceki: p.slice(0, -1), aranan: p[p.length - 1].trim() };
  };

  function ciz() {
    const { aranan } = sonParca();
    if (!aranan) { kutu.style.display = 'none'; return; }
    const hedef = _trLowerJs(aranan);
    // Zaten yazılmış olanları önerme.
    const secili = new Set(girdi.value.split(',').slice(0, -1).map(x => _trLowerJs(x.trim())));
    const eslesen = kayitlar
      .filter(k => _trLowerJs(k.name || '').includes(hedef) && !secili.has(_trLowerJs(k.name || '')))
      .slice(0, 8);
    if (!eslesen.length) { kutu.style.display = 'none'; return; }
    kutu.style.display = 'flex';
    kutu.innerHTML = eslesen.map(k =>
      `<button type="button" class="btn btn-sm ac-oner" data-ad="${escapeHtml(k.name)}" style="padding:2px 8px;font-size:11.5px;">${escapeHtml(k.name)}</button>`
    ).join('');
    kutu.querySelectorAll('.ac-oner').forEach(b => b.addEventListener('click', () => {
      const { onceki } = sonParca();
      girdi.value = onceki.concat(b.dataset.ad).map(x => x.trim()).filter(Boolean).join(', ') + ', ';
      girdi.focus();
      ciz();
      girdi.dispatchEvent(new Event('change'));
    }));
  }

  // EŞLEŞME SATIRI: yazılan her ad kayıtlı bir varlıkla tutuyor mu?
  // Dolu yaldız = veri bağı kuruldu (aynı varlık = aynı ID). Kesikli
  // soluk = kayıtta yok, serbest metin olarak gidecek - yanlış yazım mı,
  // yoksa henüz açılmamış bir varlık mı, orada görünür.
  const durum = document.createElement('div');
  durum.className = 'eslesme-satiri';
  girdi.parentElement.appendChild(durum);

  function durumCiz() {
    const adlar = girdi.value.split(',').map(x => x.trim()).filter(Boolean);
    if (!adlar.length) { durum.innerHTML = ''; return; }
    durum.innerHTML = adlar.map(ad => {
      const esti = kayitlar.some(k => _trLowerJs(k.name || '') === _trLowerJs(ad));
      return `<span class="eslesme-rozet${esti ? '' : ' yok'}" title="${esti ? 'Kayıtlı varlık - ID ile bağlanacak' : 'Kayıtta yok - serbest metin olarak gidecek'}">${escapeHtml(ad)}${esti ? '' : ' ?'}</span>`;
    }).join('');
  }

  girdi.addEventListener('input', () => { ciz(); durumCiz(); });
  girdi.addEventListener('change', durumCiz);
  girdi.addEventListener('focus', ciz);
  durumCiz();
  // Alan dışına tıklanınca kapansın - listenin kendisine tıklama sayılmaz.
  girdi.addEventListener('blur', () => setTimeout(() => { kutu.style.display = 'none'; }, 180));
}

// Tek değerli alanlar için aynı gösterge: alanın altında tek rozet.
function wireSingleMatch(inputId, kayitlar) {
  const girdi = document.getElementById(inputId);
  if (!girdi || !girdi.parentElement) return;
  const durum = document.createElement('div');
  durum.className = 'eslesme-satiri';
  girdi.parentElement.appendChild(durum);
  const ciz = () => {
    const ad = (girdi.value || '').trim();
    if (!ad) { durum.innerHTML = ''; return; }
    const esti = kayitlar.some(k => _trLowerJs(k.name || '') === _trLowerJs(ad));
    durum.innerHTML = `<span class="eslesme-rozet${esti ? '' : ' yok'}" title="${esti ? 'Kayıtlı varlık - ID ile bağlanacak' : 'Kayıtta yok - serbest metin olarak gidecek'}">${escapeHtml(ad)}${esti ? '' : ' ?'}</span>`;
  };
  girdi.addEventListener('input', ciz);
  girdi.addEventListener('change', ciz);
  ciz();
}

// VARLIK TANIMA: yazılan metinde geçen kayıtlı Kişi/Mekan/Nesne'leri bulur.
// Açılır liste yerine TANIMA tercih edildi: yazarken her kelimede liste
// açmak cümle kurmayı böler, üstelik listeden kelime seçerek cümle
// kurulmuyor. Rozet ise yazmayı kesmez ve iki işe birden yarar -
// "Genç Mühendüs" yazarsan rozet çıkmaz (yazım hatası görünür), çıkan
// rozete dokununca varlık doğrudan hücrenin listesine eklenir.
// Takma adlar da taranır: "usta" yazınca İhtiyar Teknisyen yakalanır.
function taraVarliklar(metin, kayitlar) {
  const hedef = _trLowerJs(metin || '');
  if (hedef.length < 2) return [];
  const bulunan = [];
  for (const k of kayitlar) {
    const adaylar = [k.name, ...(Array.isArray(k.aliases) ? k.aliases : [])]
      .filter(x => x && String(x).trim().length >= 3);
    for (const aday of adaylar) {
      const a = _trLowerJs(String(aday));
      // Kelime sınırı: "usta" kelimesi "ustalık" içinde eşleşmesin.
      const kalip = new RegExp(`(^|[^\\p{L}\\p{N}])${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\p{L}\\p{N}]|$)`, 'u');
      if (kalip.test(hedef)) { bulunan.push({ id: k.id, ad: k.name, gecen: String(aday) }); break; }
    }
  }
  return bulunan;
}

function _adListesi(items) {
  return (items || []).map(x => x.ad).join(', ');
}
function _adlariAyristir(metin, kayitlar) {
  return (metin || '').split(',').map(s => s.trim()).filter(Boolean)
    .map(ad => _varlikEslestir(ad, kayitlar)).filter(Boolean);
}

async function openMatrixCellEditor(m, colId, rowId, cellMap) {
  const editor = document.getElementById('matrixCellEditor');
  const col = m.columns.find(c => c.id === colId);
  const row = m.rows.find(r => r.id === rowId);
  const cell = cellMap[`${colId}:${rowId}`] || null;
  const d = (cell && cell.data) ? cell.data : {};
  const zaman = d.zaman || {};
  const duygu = d.duygu || {};
  const ortam = d.ortam || {};
  const tur = (col && col.tur_data) || {};

  editor.innerHTML = '<div class="empty-state">Yükleniyor…</div>';
  const varliklar = await loadVarliklar();

  let chapters = [];
  try {
    const tumu = await api.get('/chapters/');
    chapters = buildChapterHierarchy(tumu).map(it => ({
      id: it.chapter.id, kind: it.chapter.kind, displayNumber: it.displayNumber,
      // GERÇEK numara ayrıca tutulur: displayNumber görüntü içindir ("1.2"),
      // API ise bölümün tam sayı numarasını bekler.
      number: it.chapter.number,
      title: it.chapter.title, paragraphCount: it.chapter.paragraph_count || 0,
    }));
  } catch (e) { /* seçici olmadan devam */ }

  // Turun mirası formun tepesinde HATIRLATMA olarak durur - hücreye
  // kopyalanmaz, sadece yazarken görünür (özellikle damga kelimesi).
  const mirasSatiri = [
    tur.damga ? `damga: <b>${escapeHtml(tur.damga)}</b>` : '',
    tur.guven_kelimesi ? `güven: ${escapeHtml(tur.guven_kelimesi)}` : '',
    tur.suc ? `suç: ${escapeHtml(tur.suc)}` : '',
    tur.matematik_cifti ? `matematik: ${escapeHtml(tur.matematik_cifti)}` : '',
  ].filter(Boolean).join(' · ');

  // etiket artık HTML içerebilir (yardım balonu) - escapeHtml UYGULANMAZ.
  // Sadece bu dosyadaki sabit metinlerle çağrılıyor, kullanıcı girdisi girmiyor.
  const alan = (id, etiket, deger, ipucu, satir) => `
    <div class="field">
      <label>${etiket}${ipucu ? ` <span style="font-weight:400;color:var(--text-muted);">${ipucu}</span>` : ''}</label>
      <textarea id="${id}" style="min-height:${satir || 54}px;">${escapeHtml(deger || '')}</textarea>
    </div>`;

  editor.innerHTML = `
    <div class="panel matrix-cell-editor">
      <b>${escapeHtml(col.label)} × ${escapeHtml(row.label)}</b>
      ${cell && cell.code ? `<span style="margin-left:8px;font-size:12px;color:var(--text-muted);">Kod: <b>${cell.code}</b></span>` : ''}
      ${mirasSatiri ? `<div style="margin-top:6px;font-size:11.5px;color:var(--text-muted);background:var(--paper-dim);border:1px solid var(--border);border-radius:4px;padding:4px 8px;">TUR MİRASI — ${mirasSatiri}</div>` : ''}

      <div class="mce-grid">
        <div class="mce-col">
          <div class="mce-section-title">ÜST — SAHNE KİMLİĞİ</div>
          ${alan('mcOlay', 'OLAY' + yardim(YARDIM.olay, 'sol'), d.olay, '', 44)}
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <div class="field" style="flex:1;min-width:110px;"><label>Tarih${yardim(YARDIM.tarih, 'sol')}</label>
              <input type="text" id="mcTarih" value="${escapeHtml(zaman.tarih || '')}" placeholder="03,05,27 → 03 Mayıs 2027" title="03,05,27 yazarsan 03 Mayıs 2027 olur. Nokta, eğik çizgi, tire de olur. 'üçüncü gün' gibi serbest metin de yazabilirsin - dokunulmaz."></div>
            <div class="field" style="flex:1;min-width:90px;"><label>Saat${yardim(YARDIM.saat)}</label>
              <input type="text" id="mcSaat" value="${escapeHtml(zaman.saat || '')}" placeholder="21:40"></div>
            <div class="field" style="flex:1;min-width:110px;"><label>Tip${yardim(YARDIM.zamanTip, 'sag')}</label>
              <select id="mcZamanTip">
                <option value="">(seç)</option>
                ${ZAMAN_TIPLERI.map(([k, e]) => `<option value="${k}" ${zaman.tip === k ? 'selected' : ''}>${e}</option>`).join('')}
              </select></div>
          </div>
          <div class="field" id="mcSayacKutu"><label id="mcSayacEtiket">Neyin sayacı / atlaması</label>${yardim(YARDIM.sayac, 'sol')}
            <input type="text" id="mcSayac" value="${escapeHtml(zaman.sayac || '')}" placeholder="ambulans bekleme süresi"></div>
          <div class="field"><label>MEKAN${yardim(YARDIM.mekan, 'sol')}</label>
            <input type="text" id="mcMekan" list="mcMekanList" value="${escapeHtml(d.mekan || '')}" placeholder="VIP Salonu">
            <datalist id="mcMekanList">${_datalistSecenekleri(varliklar.mekanlar)}</datalist></div>
          <datalist id="mcDuyguList">${DUYGU_LISTESI.map(x => `<option value="${escapeHtml(x)}"></option>`).join('')}</datalist>
          <div style="display:flex;gap:6px;">
            <div class="field" style="flex:1;"><label>ORTAM <span style="font-weight:400;color:var(--text-muted);">(odanın hâli)</span>${yardim(YARDIM.ortam, 'sol')}</label>
              <div style="display:flex;gap:2px;">
                <input type="text" id="mcOrtamA" list="mcDuyguList" value="${escapeHtml(ortam.baslangic || '')}" placeholder="endişe" autocomplete="off" style="flex:1;min-width:0;">
                <button type="button" class="duygu-sec" data-hedef="mcOrtamA" title="Duygu listesinden seç">▾</button>
              </div></div>
            <div class="field" style="flex:1;"><label>→ (dönüyorsa)</label>
              <div style="display:flex;gap:2px;">
                <input type="text" id="mcOrtamB" list="mcDuyguList" value="${escapeHtml(ortam.bitis || '')}" placeholder="korku" autocomplete="off" style="flex:1;min-width:0;">
                <button type="button" class="duygu-sec" data-hedef="mcOrtamB" title="Duygu listesinden seç">▾</button>
              </div></div>
          </div>
          <div class="mce-section-title">KİŞİLER${yardim(YARDIM.kisiler, 'sol')}</div>
          <div id="mcKisiListe"></div>
          <button class="btn btn-sm" id="mcKisiEkle" style="margin-top:4px;">+ Kişi</button>
          <datalist id="mcKisiList">${_datalistSecenekleri(varliklar.kisiler)}</datalist>
          <div class="field"><label>NESNELER <span style="font-weight:400;color:var(--text-muted);">(virgülle)</span>${yardim(YARDIM.nesneler, 'sol')}</label>
            <input type="text" id="mcNesneler" value="${escapeHtml(_adListesi(d.nesneler))}" placeholder="mendil, şişe" autocomplete="off">
            <datalist id="mcNesneList">${_datalistSecenekleri(varliklar.nesneler)}</datalist></div>
          <div class="field"><label>ODAK${yardim(YARDIM.odak, 'sol')}</label>
            <input type="text" id="mcOdak" list="mcOdakList" value="${escapeHtml(d.odak || '')}" placeholder="Tetraoksin-7 şişesi" autocomplete="off">
            <datalist id="mcOdakList"></datalist></div>
          <div class="field" style="margin-top:12px;">
            <label>HEDEF UZUNLUK${yardim(YARDIM.uzunluk, 'sol')}</label>
            <select id="mcUzunluk">
              ${UZUNLUK_SEVIYELERI.map(([k, e, a]) => `<option value="${k}" ${(d.uzunluk || 'normal') === k ? 'selected' : ''}>${e} — ${a}</option>`).join('')}
            </select>
          </div>
        </div>

        <div class="mce-col">
          <div class="mce-section-title">ALT — YAY</div>
          <div id="mcYay"></div>

          <div class="mce-section-title">BAĞLANTI${yardim(YARDIM.baglanti, 'sol')}</div>
          <div id="mcBagListe"></div>
          <button class="btn btn-sm" id="mcBagEkle" style="margin-top:4px;">+ Bağlantı</button>

          <div class="field" style="margin-top:12px;">
            <label>Bağlı bölüm${yardim(YARDIM.bagliBolum, 'sol')}</label>
            <select id="mCellChapter">
              <option value="">(bağlı değil)</option>
              ${chapters.map(c => {
                const t = c.kind === 'part' ? 'ÜST' : (c.kind === 'subtitle' ? 'ARA' : 'metin');
                const par = c.paragraphCount ? `, ${c.paragraphCount} par.` : '';
                return `<option value="${c.id}" ${cell && cell.chapter_id === c.id ? 'selected' : ''}>#${c.displayNumber} [${t}${par}] ${escapeHtml(stripMarkdownArtifacts(c.title) || '(başlıksız)')}</option>`;
              }).join('')}
            </select>
          </div>
        </div>
      </div>

      <div id="mcUyari"></div>
      <div class="form-actions">
        <button class="btn btn-primary" id="mCellSave">Kaydet</button>
        <button class="btn" id="mcOnizle" title="Bu hücrenin plan metni - sadece PLAN katmanı">Plan metni</button>
        <button class="btn" id="mcTamOnizle" title="Qwen'e giden isteğin TAMAMI: sistem yönergesi + bütün bağlam katmanları (kişi/mekan profilleri, kurallar, fihrist, üslup) + talimat">AI'ya giden tam prompt</button>
        <button class="btn" id="mCellCancel">Kapat</button>
      </div>
      <div id="mCellError" class="error-text"></div>
    </div>`;
  editor.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  // --- Bağlantı satırları (dinamik) ---
  let baglar = Array.isArray(d.baglantilar) ? d.baglantilar.slice() : [];
  function cizBaglar() {
    const kutu = document.getElementById('mcBagListe');
    if (!baglar.length) { kutu.innerHTML = '<div style="font-size:11.5px;color:var(--text-muted);">(yok)</div>'; return; }
    kutu.innerHTML = baglar.map((b, i) => `
      <div style="display:flex;gap:4px;align-items:center;margin-bottom:4px;">
        <input type="text" class="mc-bag-kod" data-i="${i}" value="${escapeHtml(b.kod || '')}" placeholder="MP7" style="width:70px;">
        <select class="mc-bag-tur" data-i="${i}" style="width:88px;">
          <option value="">(tür)</option>
          ${BAGLANTI_TURLERI.map(t => `<option value="${t}" ${b.tur === t ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
        <input type="text" class="mc-bag-not" data-i="${i}" value="${escapeHtml(b.not || '')}" placeholder="ne yapılacak: MP7'deki ayna imgesini mendille yansıt" style="flex:1;" title="Referans değil EYLEM yaz - 'T1·G1 karşılığı' yazarsan AI ne yapacağını bilmez">
        <button class="btn-icon-sm mc-bag-sil" data-i="${i}" title="Kaldır">✕</button>
      </div>`).join('');
    kutu.querySelectorAll('.mc-bag-kod').forEach(x => x.addEventListener('input', () => { baglar[+x.dataset.i].kod = x.value; }));
    kutu.querySelectorAll('.mc-bag-tur').forEach(x => x.addEventListener('change', () => { baglar[+x.dataset.i].tur = x.value; }));
    kutu.querySelectorAll('.mc-bag-not').forEach(x => x.addEventListener('input', () => { baglar[+x.dataset.i].not = x.value; }));
    kutu.querySelectorAll('.mc-bag-sil').forEach(x => x.addEventListener('click', () => { baglar.splice(+x.dataset.i, 1); cizBaglar(); }));
  }
  cizBaglar();
  el('mcBagEkle').addEventListener('click', () => { baglar.push({ kod: '', tur: '', not: '' }); cizBaglar(); });

  // ---- VARLIK TANIMA ŞERİDİ ----
  // OLAY ve her beat'in altında, o metinde geçen kayıtlı varlıklar
  // rozet olarak belirir. Hücrenin listesinde OLMAYAN bir varlık
  // "+ ekle" olarak çıkar - tek dokunuşla listeye girer, böylece
  // beat'te adı geçen ama listeye yazılmayı unutulan kişi kaçmaz.
  function tanimaSeridi(hedefEl, metin) {
    // GİRİŞ/GELİŞME/SONUÇ kutuları yatay (flex) bir satırda (mc-beat-row):
    // kutu + sıra no + sil düğmesi. Rozet şeridini o satırın İÇİNE
    // eklersek kutuyla yer paylaşıp kutuyu daraltıyordu (bkz. ekran
    // görüntüsü). Bu durumda şerit satırın kendisinden SONRAYA, tam
    // genişlikte bir blok olarak ekleniyor - kutu asla daralmaz. OLAY
    // alanı gibi düz (block) kapsayıcılarda eskisi gibi hemen altına gider.
    const satirIcinde = hedefEl.parentElement.classList.contains('mc-beat-row');
    const kapsayici = satirIcinde ? hedefEl.parentElement.parentElement : hedefEl.parentElement;
    const capa = satirIcinde ? hedefEl.parentElement : hedefEl;
    let serit = capa.nextElementSibling;
    if (!serit || !serit.classList || !serit.classList.contains('varlik-serit')) {
      serit = document.createElement('div');
      serit.className = 'varlik-serit eslesme-satiri';
      kapsayici.insertBefore(serit, capa.nextSibling);
    }
    const k = taraVarliklar(metin, varliklar.kisiler);
    const y = taraVarliklar(metin, varliklar.mekanlar);
    const n = taraVarliklar(metin, varliklar.nesneler);
    if (!k.length && !y.length && !n.length) { serit.innerHTML = ''; return; }

    const parcalar = [];
    for (const x of k) {
      const zaten = kisiler.some(z => _trLowerJs(z.ad) === _trLowerJs(x.ad));
      parcalar.push(`<span class="eslesme-rozet${zaten ? '' : ' yok'} vs-kisi" data-ad="${escapeHtml(x.ad)}" style="cursor:${zaten ? 'default' : 'pointer'};" title="${zaten ? 'Kişiler listesinde' : 'Dokun: Kişiler listesine ekle'}">${escapeHtml(x.ad)}${zaten ? '' : ' +'}</span>`);
    }
    for (const x of n) {
      const zaten = el('mcNesneler').value.split(',').some(z => _trLowerJs(z.trim()) === _trLowerJs(x.ad));
      parcalar.push(`<span class="eslesme-rozet${zaten ? '' : ' yok'} vs-nesne" data-ad="${escapeHtml(x.ad)}" style="cursor:${zaten ? 'default' : 'pointer'};" title="${zaten ? 'Nesneler listesinde' : 'Dokun: Nesneler listesine ekle'}">${escapeHtml(x.ad)}${zaten ? '' : ' +'}</span>`);
    }
    for (const x of y) {
      const zaten = _trLowerJs(el('mcMekan').value.trim()) === _trLowerJs(x.ad);
      parcalar.push(`<span class="eslesme-rozet${zaten ? '' : ' yok'} vs-mekan" data-ad="${escapeHtml(x.ad)}" style="cursor:${zaten ? 'default' : 'pointer'};" title="${zaten ? 'Mekan olarak seçili' : 'Dokun: MEKAN alanına yaz'}">${escapeHtml(x.ad)}${zaten ? '' : ' +'}</span>`);
    }
    serit.innerHTML = parcalar.join('');

    serit.querySelectorAll('.vs-kisi').forEach(b => b.addEventListener('click', () => {
      const ad = b.dataset.ad;
      if (kisiler.some(z => _trLowerJs(z.ad) === _trLowerJs(ad))) return;
      kisiler.push({ id: null, ad, duygu: { baslangic: '', bitis: '' } });
      cizKisiler();
      tumTanimalariTazele();
    }));
    serit.querySelectorAll('.vs-nesne').forEach(b => b.addEventListener('click', () => {
      const mevcut = el('mcNesneler').value.split(',').map(x => x.trim()).filter(Boolean);
      if (mevcut.some(z => _trLowerJs(z) === _trLowerJs(b.dataset.ad))) return;
      mevcut.push(b.dataset.ad);
      el('mcNesneler').value = mevcut.join(', ');
      el('mcNesneler').dispatchEvent(new Event('input'));
      tumTanimalariTazele();
    }));
    serit.querySelectorAll('.vs-mekan').forEach(b => b.addEventListener('click', () => {
      el('mcMekan').value = b.dataset.ad;
      el('mcMekan').dispatchEvent(new Event('input'));
      tumTanimalariTazele();
    }));
  }

  function tumTanimalariTazele() {
    const olayEl = el('mcOlay');
    if (olayEl && olayEl.parentElement) tanimaSeridi(olayEl, olayEl.value);
    document.querySelectorAll('.mc-beat').forEach(t => tanimaSeridi(t, t.value));
  }

  // ---- KİŞİLER: her biri kendi duygu yayıyla ----
  // Tek bir duygu alanı varken iki kişilik sahnede ikinci kişinin yayı
  // kaydedilemiyor, sahneyi bölmek gerekiyordu. Kişi başına yay, iki
  // bilinci sahneyi parçalamadan taşır.
  let kisiler = Array.isArray(d.kisiler) ? d.kisiler.map(k => ({
    id: k.id || null, ad: k.ad || '',
    duygu: { baslangic: (k.duygu || {}).baslangic || '', bitis: (k.duygu || {}).bitis || '' },
  })) : [];

  function cizKisiler() {
    const kutu = document.getElementById('mcKisiListe');
    if (!kutu) return;
    if (!kisiler.length) { kutu.innerHTML = '<div style="font-size:11.5px;color:var(--text-muted);">(kişi yok - sahneyi kim taşıyor?)</div>'; return; }
    // Rozet ad kutusunun YANINA girer, altına değil: alta düşünce o sütun
    // uzuyor ve duygu kutuları bir satır aşağı kaymış gibi görünüyordu.
    // Sütun başlıkları bir kez yazılır, her satırda tekrarlanmaz.
    kutu.innerHTML = `
      <div style="display:flex;gap:4px;font-size:10.5px;color:var(--text-muted);margin-bottom:2px;">
        <div style="flex:2;min-width:120px;">Kişi</div>
        <div style="flex:1;min-width:90px;">Başlangıç</div>
        <div style="flex:1;min-width:90px;">→ Bitiş (yay ise)</div>
        <div style="width:24px;"></div>
      </div>` + kisiler.map((k, i) => {
      const esti = varliklar.kisiler.some(x => _trLowerJs(x.name || '') === _trLowerJs(k.ad));
      const rozet = (k.ad || '').trim()
        ? `<span class="eslesme-rozet${esti ? '' : ' yok'}" style="font-size:10px;flex:0 0 auto;" title="${esti ? 'Kayıtlı kişi - ID ile bağlanacak' : 'Kayıtta yok - serbest metin olarak gidecek'}">${esti ? '✓' : '?'}</span>`
        : '';
      return `
      <div style="display:flex;gap:4px;align-items:center;margin-bottom:4px;">
        <div style="flex:2;min-width:120px;display:flex;align-items:center;gap:4px;">
          <input type="text" class="mc-k-ad" data-i="${i}" list="mcKisiList" value="${escapeHtml(k.ad)}" placeholder="Genç Mühendis" autocomplete="off" style="flex:1;min-width:0;">
          ${rozet}
        </div>
        <div style="flex:1;min-width:90px;display:flex;gap:2px;">
          <input type="text" class="mc-k-a" data-i="${i}" list="mcDuyguList" value="${escapeHtml(k.duygu.baslangic)}" placeholder="umut" autocomplete="off" style="flex:1;min-width:0;">
          <button type="button" class="duygu-sec" data-hedef=".mc-k-a[data-i='${i}']" title="Duygu listesinden seç">▾</button>
        </div>
        <div style="flex:1;min-width:90px;display:flex;gap:2px;">
          <input type="text" class="mc-k-b" data-i="${i}" list="mcDuyguList" value="${escapeHtml(k.duygu.bitis)}" placeholder="gurur" autocomplete="off" style="flex:1;min-width:0;">
          <button type="button" class="duygu-sec" data-hedef=".mc-k-b[data-i='${i}']" title="Duygu listesinden seç">▾</button>
        </div>
        <button class="btn-icon-sm mc-k-sil" data-i="${i}" title="Kişiyi çıkar" style="flex:0 0 auto;">✕</button>
      </div>`;
    }).join('');
    kutu.querySelectorAll('.mc-k-ad').forEach(x => x.addEventListener('input', () => { kisiler[+x.dataset.i].ad = x.value; }));
    kutu.querySelectorAll('.mc-k-ad').forEach(x => x.addEventListener('change', () => { kisiler[+x.dataset.i].ad = x.value; cizKisiler(); }));
    kutu.querySelectorAll('.mc-k-a').forEach(x => x.addEventListener('input', () => { kisiler[+x.dataset.i].duygu.baslangic = x.value; }));
    kutu.querySelectorAll('.mc-k-b').forEach(x => x.addEventListener('input', () => { kisiler[+x.dataset.i].duygu.bitis = x.value; }));
    kutu.querySelectorAll('.mc-k-sil').forEach(x => x.addEventListener('click', () => { kisiler.splice(+x.dataset.i, 1); cizKisiler(); }));
  }
  cizKisiler();
  el('mcKisiEkle').addEventListener('click', () => {
    kisiler.push({ id: null, ad: '', duygu: { baslangic: '', bitis: '' } });
    cizKisiler();
  });

  // ---- YAY: aşama başına birden çok beat ----
  // Tekli bölümlerde bir aşamada birden çok bağımsız hareket olabilir
  // (ihtiyar mendilini siler, genç twit atar). Paralel matriste tek beat
  // kalmalı - kaydedince uyarı çıkar, engellenmez.
  const YAY = [
    ['giris', 'GİRİŞ', "açılış beat'i", YARDIM.giris],
    ['gelisme', 'GELİŞME', "dönme beat'i", YARDIM.gelisme],
    ['sonuc', 'SONUÇ', tur.damga ? `"${tur.damga}" burada asılı kalmalı` : "kapanış beat'i", YARDIM.sonuc],
  ];
  const beatler = {};
  YAY.forEach(([k]) => {
    const v = d[k];
    beatler[k] = Array.isArray(v) ? v.slice() : (v ? [v] : ['']);
    if (!beatler[k].length) beatler[k] = [''];
  });

  function cizYay() {
    const kutu = document.getElementById('mcYay');
    if (!kutu) return;
    kutu.innerHTML = YAY.map(([k, etiket, ipucu, yardimMetni]) => `
      <div style="margin-bottom:8px;">
        <label style="font-size:12px;font-weight:600;">${etiket}
          <span style="font-weight:400;color:var(--text-muted);">(${escapeHtml(ipucu)})</span>${yardim(yardimMetni, 'sol')}</label>
        ${beatler[k].map((b, i) => `
          <div class="mc-beat-row" style="display:flex;gap:4px;align-items:flex-start;margin-top:3px;">
            ${beatler[k].length > 1 ? `<span style="font-size:11px;color:var(--text-muted);padding-top:8px;min-width:14px;">${i + 1}</span>` : ''}
            <textarea class="mc-beat" data-k="${k}" data-i="${i}" style="min-height:48px;flex:1;">${escapeHtml(b)}</textarea>
            ${beatler[k].length > 1 ? `<button class="btn-icon-sm mc-beat-sil" data-k="${k}" data-i="${i}" title="Bu beat'i kaldır">✕</button>` : ''}
          </div>
          <div class="mc-beat-sayac" data-k="${k}" data-i="${i}" style="font-size:10.5px;text-align:right;"></div>`).join('')}
        <button class="btn btn-sm mc-beat-ekle" data-k="${k}" style="margin-top:2px;">+ ${etiket}</button>
      </div>`).join('');

    const sayacGuncelle = (t) => {
      const n = t.value.length;
      const s = kutu.querySelector(`.mc-beat-sayac[data-k="${t.dataset.k}"][data-i="${t.dataset.i}"]`);
      if (!s) return;
      s.textContent = n > 160 ? `${n}/160 — beat değil olay dizisi` : `${n}/160`;
      s.style.color = n > 160 ? 'var(--gold)' : 'var(--text-muted)';
    };
    kutu.querySelectorAll('.mc-beat').forEach(t => {
      sayacGuncelle(t);
      t.addEventListener('input', () => {
        beatler[t.dataset.k][+t.dataset.i] = t.value;
        sayacGuncelle(t);
        tanimaSeridi(t, t.value);
      });
      tanimaSeridi(t, t.value);
    });
    kutu.querySelectorAll('.mc-beat-ekle').forEach(b => b.addEventListener('click', () => {
      beatler[b.dataset.k].push(''); cizYay();
    }));
    kutu.querySelectorAll('.mc-beat-sil').forEach(b => b.addEventListener('click', () => {
      beatler[b.dataset.k].splice(+b.dataset.i, 1); cizYay();
    }));
  }
  cizYay();
  tumTanimalariTazele();

  // Duygu seçici düğmeleri OLAY YAKALAMA ile bağlanır: kişi satırları
  // yeniden çizildiğinde düğmeler de yenileniyor, tek tek bağlamak
  // her çizimde unutulmaya açık olurdu.
  editor.addEventListener('click', (e) => {
    const dugme = e.target.closest ? e.target.closest('.duygu-sec') : null;
    if (!dugme) { duyguSeciciKapat(); return; }
    e.preventDefault();
    e.stopPropagation();
    const sec = dugme.dataset.hedef;
    const hedef = sec.startsWith('.') ? editor.querySelector(sec) : document.getElementById(sec);
    if (hedef) duyguSeciciAc(hedef, dugme);
  });
  // Pencere dışına tıklanınca kapansın.
  document.addEventListener('click', (e) => {
    const p = document.getElementById('duyguSecici');
    if (!p || p.style.display === 'none') return;
    if (p.contains && p.contains(e.target)) return;
    if (e.target.closest && e.target.closest('.duygu-sec')) return;
    duyguSeciciKapat();
  });

  // Sayaç alanı yalnızca ATLAMA/SAYAÇ için anlamlı; NOKTA seçiliyse
  // gizlenir. Boş bir alanın orada durması "burayı da doldurmam mı
  // gerekiyor" sorusunu doğuruyordu.
  function sayacAlaniniAyarla() {
    const tip = el('mcZamanTip').value;
    const kutu = document.getElementById('mcSayacKutu');
    const etiket = document.getElementById('mcSayacEtiket');
    if (!kutu) return;
    if (tip === 'SAYAC') {
      kutu.style.display = '';
      etiket.textContent = 'Neyin sayacı?';
      el('mcSayac').placeholder = 'ambulansın geliş süresi';
    } else if (tip === 'ATLAMA') {
      kutu.style.display = '';
      etiket.textContent = 'Neyden ne kadar atlandı?';
      el('mcSayac').placeholder = 'önceki sahneden üç gün sonra';
    } else {
      kutu.style.display = 'none';
    }
  }
  // Tarih alanı odaktan çıkınca normalleşir: "03,05,27" -> "03 Mayıs 2027".
  el('mcTarih').addEventListener('blur', () => {
    el('mcTarih').value = normalizeTarih(el('mcTarih').value);
  });
  el('mcZamanTip').addEventListener('change', sayacAlaniniAyarla);
  sayacAlaniniAyarla();

  // Kişi/nesne alanları çoklu - kendi öneri listesi. Mekan ve duygu
  // sahibi tek değerli olduğu için tarayıcının datalist'i orada yeterli.
  wireMultiAutocomplete('mcNesneler', varliklar.nesneler);
  wireSingleMatch('mcMekan', varliklar.mekanlar);

  // ODAK yalnızca BU hücreye yazılmış nesneler arasından seçilmeli -
  // sahnede olmayan bir nesneye odaklanmak anlamsız. Liste, NESNELER
  // alanı değiştikçe tazelenir.
  function odakListesiniTazele() {
    const dl = document.getElementById('mcOdakList');
    if (!dl) return;
    dl.innerHTML = el('mcNesneler').value.split(',').map(x => x.trim()).filter(Boolean)
      .map(ad => `<option value="${escapeHtml(ad)}"></option>`).join('');
  }
  el('mcNesneler').addEventListener('input', odakListesiniTazele);
  el('mcNesneler').addEventListener('change', odakListesiniTazele);
  odakListesiniTazele();

  // BEAT SAYACI: şema GİRİŞ/GELİŞME/SONUÇ'u birer AN olarak tanımlar.
  // Buraya olay dizisi yazıldığında yazan model sahneyi kurmaz, verileni
  // doldurur - sınır aşılınca alan uyarı rengine döner (backend'deki
  // BEAT_SINIRI ile aynı: 160, OLAY için 120).
  el('mcOlay').addEventListener('input', () => tanimaSeridi(el('mcOlay'), el('mcOlay').value));
  [['mcOlay', 120]].forEach(([id, sinir]) => {
    const alanEl = el(id);
    if (!alanEl || !alanEl.parentElement) return;
    const sayac = document.createElement('div');
    sayac.style.cssText = 'font-size:10.5px;text-align:right;margin-top:-4px;';
    const guncelle = () => {
      const n = alanEl.value.length;
      sayac.textContent = n > sinir ? `${n}/${sinir} — beat değil olay dizisi` : `${n}/${sinir}`;
      sayac.style.color = n > sinir ? 'var(--gold)' : 'var(--text-muted)';
    };
    alanEl.parentElement.appendChild(sayac);
    alanEl.addEventListener('input', guncelle);
    guncelle();
  });

  function formuTopla() {
    return {
      olay: el('mcOlay').value,
      zaman: { tarih: normalizeTarih(el('mcTarih').value), saat: el('mcSaat').value, tip: el('mcZamanTip').value, sayac: el('mcSayac').value },
      mekan: el('mcMekan').value,
      mekan_id: (_varlikEslestir(el('mcMekan').value, varliklar.mekanlar) || {}).id || null,
      ortam: { baslangic: el('mcOrtamA').value, bitis: el('mcOrtamB').value },
      kisiler: kisiler.filter(k => (k.ad || '').trim()).map(k => {
        const es = _varlikEslestir(k.ad, varliklar.kisiler) || {};
        return { id: es.id || null, ad: k.ad.trim(), duygu: k.duygu };
      }),
      nesneler: _adlariAyristir(el('mcNesneler').value, varliklar.nesneler),
      odak: el('mcOdak').value,
      uzunluk: el('mcUzunluk').value,
      giris: beatler.giris.map(x => x.trim()).filter(Boolean),
      gelisme: beatler.gelisme.map(x => x.trim()).filter(Boolean),
      sonuc: beatler.sonuc.map(x => x.trim()).filter(Boolean),
      baglantilar: baglar.filter(b => (b.kod || '').trim()),
    };
  }

  el('mcOnizle').addEventListener('click', () => {
    const v = formuTopla();
    const satir = [];
    if (v.olay) satir.push(`OLAY: ${v.olay}`);
    const z = [v.zaman.tarih, v.zaman.saat].filter(Boolean).join(' ');
    if (z || v.zaman.tip) {
      const tipGorunen = { NOKTA: 'NOKTA', ATLAMA: 'ATLAMA', SAYAC: 'SAYAÇ' }[v.zaman.tip] || v.zaman.tip;
      const tipMetin = v.zaman.tip ? ` (${tipGorunen}${v.zaman.sayac ? `: ${v.zaman.sayac}` : ''})` : '';
      satir.push(`ZAMAN: ${z || '—'}${tipMetin}`);
    }
    if (v.mekan) satir.push(`MEKAN: ${v.mekan}`);
    if (v.ortam.baslangic || v.ortam.bitis) satir.push(`ORTAM: ${[v.ortam.baslangic, v.ortam.bitis].filter(Boolean).join(' → ')}`);
    if (v.kisiler.length) satir.push('KİŞİLER: ' + v.kisiler.map(k => {
      const y = [k.duygu.baslangic, k.duygu.bitis].filter(Boolean).join(' → ');
      return y ? `${k.ad} (${y})` : k.ad;
    }).join(', '));
    if (v.nesneler.length) satir.push(`NESNELER: ${_adListesi(v.nesneler)}`);
    if (v.odak) satir.push(`ODAK: ${v.odak} (dikkat bu nesnede toplanır)`);
    ['giris', 'gelisme', 'sonuc'].forEach((k, i) => {
      const etiket = ['GİRİŞ', 'GELİŞME', 'SONUÇ'][i];
      v[k].forEach((b, j) => satir.push(`${etiket}${v[k].length > 1 ? ` ${j + 1}` : ''}: ${b}`));
    });
    const uzTarif = { ozet: 'ÖZET — 1-2 paragraf', normal: 'NORMAL — 4-6 paragraf', uzun: 'UZUN METİN — 8+ paragraf' }[v.uzunluk];
    if (uzTarif) satir.push(`HEDEF UZUNLUK: ${uzTarif}…`);
    if (v.baglantilar.length) satir.push('BAĞLANTI: ' + v.baglantilar.map(b => `${b.kod}${b.tur ? ` (${b.tur})` : ''}${b.not ? ` → ${b.not}` : ''}`).join(' · '));
    document.getElementById('mcUyari').innerHTML =
      `<div style="font-size:11px;color:var(--text-muted);margin-top:8px;">Bu SADECE plan katmanı. Kişi/mekan profilleri, kurallar ve fihrist ayrı katmanlardan gider - onları görmek için "AI'ya gidecek tam bağlam".</div>
       <pre style="white-space:pre-wrap;font-size:11.5px;background:var(--paper-dim);border:1px solid var(--border);border-radius:4px;padding:8px;margin-top:4px;">${escapeHtml(satir.join('\n')) || '(boş)'}</pre>`;
  });

  // TAM BAĞLAM: sunucudan, /ai/context-preview ile. Hücrenin plan metni
  // bağlamın SADECE BİR KATMANI - kişi/mekan profilleri, kurallar, fihrist,
  // üslup uyarıları ayrı katmanlardan geliyor. "Neden mekan detayı yok"
  // sorusunun cevabı buydu: yerel önizleme onları hiç görmüyor.
  el('mcTamOnizle').addEventListener('click', async () => {
    const kutu = document.getElementById('mcUyari');
    const chapterVal = el('mCellChapter').value;
    if (!chapterVal) {
      kutu.innerHTML = '<div style="margin-top:8px;font-size:11.5px;color:var(--gold);">Bu hücre bir bölüme bağlı değil. Tam bağlam bölüm bazında oluşuyor - önce aşağıdan bölüm seç ve kaydet.</div>';
      return;
    }
    const secili = chapters.find(c => c.id === parseInt(chapterVal, 10));
    kutu.innerHTML = '<div class="empty-state">Bağlam oluşturuluyor…</div>';
    try {
      const r = await api.post('/ai/context-preview', {
        selected_entities: [],
        chapter_number: secili ? secili.number : null,
        instruction: '', include_hidden: false,
        include_chapter_text: false, text_scope: 'none',
        include_own_summary: false,
      });
      // full_prompt = sistem yönergesi + bağlam + talimat, yani Qwen'e
      // giden isteğin TAMAMI. Eski sürümlerde alan yoksa bağlama düşer.
      const metin = r.full_prompt || r.context || '(boş)';
      const katmanlar = (r.breakdown || [])
        .map(b => `${escapeHtml(b.name || b.ad || '')}: ${b.char_count || b.chars || 0}`)
        .join(' · ');
      kutu.innerHTML = `
        <div style="font-size:11px;color:var(--text-muted);margin-top:8px;">
          ${metin.length} karakter · ~${r.approx_tokens || 0} token · Qwen'e istek atılmadı, ücretsiz.
          ${katmanlar ? `<div style="margin-top:2px;">${katmanlar}</div>` : ''}
        </div>
        <div style="margin-top:4px;"><button class="btn btn-sm" id="mcPromptKopya">Kopyala</button></div>
        <pre style="white-space:pre-wrap;font-size:11px;background:var(--paper-dim);border:1px solid var(--border);border-radius:4px;padding:8px;margin-top:4px;max-height:400px;overflow-y:auto;">${escapeHtml(metin)}</pre>`;
      el('mcPromptKopya').addEventListener('click', async () => {
        const b = el('mcPromptKopya');
        try { await navigator.clipboard.writeText(metin); b.textContent = 'Kopyalandı ✓'; }
        catch (e) { b.textContent = 'Kopyalanamadı'; }
        setTimeout(() => { b.textContent = 'Kopyala'; }, 2000);
      });
    } catch (err) {
      kutu.innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`;
    }
  });

  el('mCellCancel').addEventListener('click', () => { editor.innerHTML = ''; });
  el('mCellSave').addEventListener('click', async () => {
    const chapterVal = el('mCellChapter').value;
    try {
      const kayit = await api.put(`/matrix/${m.id}/cells`, {
        column_id: colId, row_id: rowId,
        data: formuTopla(),
        chapter_id: chapterVal ? parseInt(chapterVal, 10) : null,
      });
      // Uyarılar kaydı ENGELLEMEZ - kaydedilir, sonra gösterilir.
      if (kayit.warnings && kayit.warnings.length) {
        document.getElementById('mcUyari').innerHTML =
          `<div style="margin-top:8px;font-size:11.5px;color:var(--gold);border:1px solid var(--border);border-radius:4px;padding:6px 8px;">
             ⚠ Kaydedildi, eksikler: ${kayit.warnings.map(escapeHtml).join(' · ')}</div>`;
        await loadMatrixGrid();
        return;
      }
      editor.innerHTML = '';
      await loadMatrixGrid();
    } catch (err) { el('mCellError').textContent = err.message; }
  });
}

// MATRİS SAĞLIK ŞERİDİ: yapısal kusurlar matrisi açar açmaz görünsün.
// Denetim promptuna gitmeden - orası planın TAMAMI bittiğinde kullanılıyor,
// oysa bağsız plan ya da kayıp MP referansı doldururken fark edilmeli.
async function matrisSagligiGoster(matrisId) {
  const kutu = document.getElementById('matrisSaglik');
  if (!kutu) return;
  try {
    const r = await api.get(`/matrix/${matrisId}/health`);
    const b = r.bulgular || [];
    if (!b.length && !r.uyarili_hucre) { kutu.innerHTML = ''; return; }
    const hucreNotu = r.uyarili_hucre
      ? `<span style="color:var(--text-muted);">· ${r.uyarili_hucre} hücrede eksik alan (⚠ rozetleri)</span>` : '';
    kutu.innerHTML = b.length
      ? `<div style="border:1px solid var(--gold);border-radius:6px;padding:6px 10px;margin:6px 0;font-size:11.5px;background:var(--paper-dim);">
           <b style="color:var(--gold);">⚠ ${b.length} yapısal bulgu</b> ${hucreNotu}
           ${b.map(x => `<div style="margin-top:2px;">• ${escapeHtml(x)}</div>`).join('')}
         </div>`
      : `<div style="font-size:11.5px;color:var(--text-muted);margin:6px 0;">✓ Yapısal kusur yok ${hucreNotu}</div>`;
  } catch (e) { kutu.innerHTML = ''; }
}

// ---------------------------------------------------------------------------
// TOPLU İNDİRME: bütün plan matrisleri tek dosyada.
//   json -> yapılandırılmış tam döküm (hücre verisi, miras alanları, bölüm
//           bağları, uyarılar). Yedek ve taşıma için.
//   md   -> okunur döküm. Yazdırmak ya da başka bir modele vermek için.
// İndirme api yardımcısıyla değil DOĞRUDAN fetch ile yapılır: yanıt JSON
// değil dosya gövdesi, api.get onu ayrıştırmaya çalışıp bozardı.
// ---------------------------------------------------------------------------
async function openMatrixExport(m) {
  const editor = document.getElementById('matrixCellEditor');
  editor.innerHTML = `
    <div class="panel">
      <b>⬇ Plan Matrislerini İndir</b>
      <div class="field" style="margin-top:8px;">
        <label>Kapsam</label>
        <select id="mExpScope">
          <option value="">Bütün matrisler</option>
          <option value="${m.id}">Sadece: ${escapeHtml(m.name)}</option>
        </select>
      </div>
      <div class="field">
        <label>Biçim</label>
        <select id="mExpFormat">
          <option value="json">JSON — tam veri (yedek, taşıma)</option>
          <option value="md">Markdown — okunur döküm</option>
          <option value="docx">Word — yazdırmak, paylaşmak, not almak</option>
        </select>
      </div>
      <div class="form-actions">
        <button class="btn btn-primary btn-sm" id="mExpGo">İndir</button>
        <button class="btn btn-sm" id="mExpClose">Kapat</button>
      </div>
      <div id="mExpState" style="font-size:12px;color:var(--text-muted);"></div>

      <hr style="border:none;border-top:1px solid var(--border);margin:14px 0;">
      <b>⬆ İçe Aktar (JSON)</b>
      <div style="font-size:11.5px;color:var(--text-muted);margin:4px 0 8px;">
        Dışa aktarılmış bir JSON dosyasını geri yükler. Mevcut matrislerin
        ÜZERİNE YAZMAZ - yeni matris olarak eklenir. Kişi/mekan/nesne bağları
        bu kitabın evreninde <b>adla</b> yeniden kurulur; bulunamayan adlar
        serbest metin kalır.
      </div>
      <input type="file" id="mImpFile" accept=".json,application/json">
      <div class="form-actions"><button class="btn btn-sm" id="mImpGo">Yükle</button></div>
      <div id="mImpState" style="font-size:12px;"></div>
    </div>`;
  editor.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  el('mExpClose').addEventListener('click', () => { editor.innerHTML = ''; });

  el('mImpGo').addEventListener('click', async () => {
    const durum = document.getElementById('mImpState');
    const dosya = document.getElementById('mImpFile').files[0];
    if (!dosya) { durum.textContent = 'Önce bir JSON dosyası seç.'; return; }
    durum.textContent = 'Okunuyor…';
    try {
      const metin = await dosya.text();
      let veri;
      try { veri = JSON.parse(metin); }
      catch (e) { throw new Error('Dosya geçerli JSON değil.'); }
      const r = await api.post('/matrix/import', veri);
      const uyari = (r.uyarilar || []).length
        ? `<div style="margin-top:4px;color:var(--gold);">${r.uyarilar.map(escapeHtml).join('<br>')}</div>`
        : '';
      durum.innerHTML = `<span style="color:var(--text-muted);">
        ✓ ${r.matris} matris · ${r.kolon} tur · ${r.satir} aşama · ${r.hucre} hücre ·
        ${r.baglanan} bölüm bağı${r.baglanamayan ? ` (${r.baglanamayan} bağlanamadı)` : ''} ·
        ${r.cozulen} varlık eşleşti${r.cozulemeyen ? `, ${r.cozulemeyen} eşleşmedi` : ''}
        </span>${uyari}`;
      await loadMatrixList();
    } catch (err) {
      durum.innerHTML = `<span class="error-text">✕ ${escapeHtml(err.message)}</span>`;
    }
  });
  el('mExpGo').addEventListener('click', async () => {
    const durum = el('mExpState');
    const bicim = el('mExpFormat').value;
    const scope = el('mExpScope').value;
    durum.textContent = 'Hazırlanıyor…';
    try {
      let yol = `/matrix/export?format=${bicim}`;
      if (scope) yol += `&matrix_id=${scope}`;
      const res = await fetch(yol, {
        headers: {
          'Authorization': `Bearer ${getToken()}`,
          'X-Novel-Id': String(getNovelId() || ''),
        },
      });
      if (!res.ok) throw new Error(`İndirilemedi (${res.status})`);
      const blob = await res.blob();
      const damga = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `plan-matrisleri-${damga}.${bicim}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
      durum.textContent = '✓ indirildi';
    } catch (err) { durum.textContent = '✕ ' + err.message; }
  });
}

// ---------------------------------------------------------------------------
// DENETİM PROMPTU: planı dışarıdaki bir modele denetletmek için hazır metin.
// Sayılabilir kusurlar (bağsız plan, kayıp MP referansı, çift bağ...) metnin
// başına deterministik olarak yazılır - onları modele sormak para yakar ve
// yanıltır. AI çağrısı YAPILMAZ, sadece kopyalanacak metin üretilir.
// ---------------------------------------------------------------------------
async function openAuditPrompt(m) {
  const editor = document.getElementById('matrixCellEditor');
  editor.innerHTML = `
    <div class="panel">
      <b>🧪 Denetim Promptu</b>
      <div class="field" style="margin-top:8px;">
        <label>Kapsam <span style="font-weight:400;color:var(--text-muted);">(8×7'lik bir plan tek isteğe sığmaz - tur tur denetlemek daha isabetli)</span></label>
        <select id="mAuditScope">
          <option value="">Tüm matris</option>
          ${m.columns.map(c => `<option value="${c.id}">Sadece: ${escapeHtml(c.label)}</option>`).join('')}
        </select>
      </div>
      <button class="btn btn-primary btn-sm" id="mAuditGen">Metni Üret</button>
      <div id="mAuditOut"></div>
    </div>`;
  editor.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  el('mAuditGen').addEventListener('click', async () => {
    const kutu = document.getElementById('mAuditOut');
    const scope = el('mAuditScope').value;
    kutu.innerHTML = '<div class="empty-state">Hazırlanıyor…</div>';
    try {
      // Sorgu dizesi AYRI kurulur: yolu iç içe şablonla yazınca hem
      // okunmuyor hem de uç denetleyicisi ({} normalize eden test)
      // ayrıştıramıyor - gerçek eksik uçlar o gürültünün altında kaybolur.
      const sorgu = scope ? `?column_id=${scope}` : '';
      const r = await api.get(`/matrix/${m.id}/audit-prompt` + sorgu);
      const o = r.summary;
      kutu.innerHTML = `
        <div style="font-size:12px;color:var(--text-muted);margin:8px 0;">
          ${o.kolon_sayisi} tur × ${o.satir_sayisi} aşama · ${o.dolu_hucre} dolu hücre ·
          <b style="color:${o.yapisal_bulgu ? 'var(--gold)' : 'inherit'};">${o.yapisal_bulgu} yapısal bulgu</b> ·
          ${o.uyarili_hucre} eksikli hücre
        </div>
        <textarea id="mAuditText" style="min-height:260px;font-size:11.5px;" readonly></textarea>
        <div class="form-actions">
          <button class="btn btn-primary btn-sm" id="mAuditCopy">Kopyala</button>
          <button class="btn btn-sm" id="mAuditClose">Kapat</button>
        </div>`;
      el('mAuditText').value = r.prompt;
      el('mAuditClose').addEventListener('click', () => { editor.innerHTML = ''; });
      el('mAuditCopy').addEventListener('click', async () => {
        const btn = el('mAuditCopy');
        try {
          await navigator.clipboard.writeText(r.prompt);
          btn.textContent = 'Kopyalandı ✓';
        } catch (e) {
          // Panoya erişim yoksa (bazı tarayıcı/izin durumları) elle seçtir.
          el('mAuditText').select();
          btn.textContent = 'Seçildi - kopyala';
        }
        setTimeout(() => { btn.textContent = 'Kopyala'; }, 2000);
      });
    } catch (err) { kutu.innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`; }
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
// TASLAK BAŞLIĞI: hücrenin ZAMAN alanından, AI'DAN BAĞIMSIZ tek satır.
// AI'ya "taslağın başına tarihi yaz" dedirtmek güvenilmez değildi ama
// tutarsızdı - bazen unutur, bazen biçimi bozar, bazen tarihi kendi
// üslubuyla yeniden yazar. Bunun yerine kod, hücrenin ZATEN sakladığı
// tarih/saati (plan-for-chapter'dan gelen zaman_tarih/zaman_saat) hiç
// AI'ya sormadan taslağın başına ekler - hep aynı biçim, hiç unutmaz.
function _planDraftZamanBasligi(planCells) {
  const adaylar = (planCells || []).filter(c => c && c.zaman_tarih);
  if (!adaylar.length) return null;
  // Bölüme birden çok hücre bağlıysa EN ERKEN zaman alınır - bölüm o anda
  // başlıyor demektir (bkz. backend story_time.bolum_zamanlari, aynı kural).
  // Sıralanabilir değeri olmayanlar (göreli tarih, "üçüncü gün" gibi) sona
  // atılır ama yine de aday kalır - hiç göstermemekten iyidir.
  adaylar.sort((a, b) => {
    if (a.zaman_sira == null && b.zaman_sira == null) return 0;
    if (a.zaman_sira == null) return 1;
    if (b.zaman_sira == null) return -1;
    return a.zaman_sira - b.zaman_sira;
  });
  const c = adaylar[0];
  return c.zaman_saat ? `${c.zaman_tarih}, ${c.zaman_saat}` : c.zaman_tarih;
}

// planCells: yazılacak plan hücreleri. Bölümün TAMAMI için hepsi, tek bir
// sahne için sadece o hücre verilir. Bir bölüme birden çok hücre bağlıysa
// (olayın devamı olan sahneler) tek tek yazdırmak, hepsini bir hamlede
// yazdırmaktan daha iyi sonuç veriyor: okuyup onaylayıp devam ediyorsun.
async function runPlanDraft(chapter, planCells, tekSahne) {
  const box = document.getElementById('planDraftResult');
  const hasParagraphs = (chapter.paragraphs || []).length > 0;
  if (hasParagraphs && !confirm('Bu bölümde zaten paragraf var - taslak, mevcut metnin SONUNA eklenecek. Devam?')) return;
  const selected = Array.from(document.querySelectorAll('.entity-check:checked')).map(cb => ({
    entity_type: cb.dataset.type, entity_id: parseInt(cb.dataset.id, 10),
  }));
  const zamanBasligi = _planDraftZamanBasligi(planCells);
  box.innerHTML = '<div class="empty-state">Plan işleniyor, taslak yazılıyor…</div>';
  try {
    const result = await api.post('/ai/assist', {
      chapter_number: chapter.number,
      // Tek sahne YA DA tek bir matrisin birden çok sahnesi yazdırılıyorsa
      // talimat DARALTILIR: bağlamda bölümün bütün planları var (devamlılık
      // için gerekli, farklı matrislerden gelenler dahil), ama model
      // yalnızca seçilenleri yazmalı - yoksa hepsini birden yazmaya kalkıyor.
      instruction: (Array.isArray(tekSahne)
        ? `BÖLÜM PLANI'nda birden fazla FARKLI plan matrisinden gelen sahneler var. `
          + `YALNIZCA şu sahneleri, bu sırayla yaz: ${tekSahne.map(s => `"${s}"`).join(', ')}; `
          + 'diğer matrislerdeki sahneleri YAZMA, onlar ayrıca yazılacak - ama devamlılık için '
          + 'onları bilerek yaz (öncekiler olmuş, sonrakiler henüz olmamıştır). '
        : tekSahne
        ? `BÖLÜM PLANI'nda birden çok sahne var. YALNIZCA "${tekSahne}" sahnesini yaz; `
          + 'diğer sahneleri YAZMA, onlar ayrıca yazılacak - ama devamlılık için '
          + 'onları bilerek yaz (öncekiler olmuş, sonrakiler henüz olmamıştır). '
        : 'BÖLÜM PLANI\'ndaki maddelerin TAMAMINI sırasıyla işleyerek bu bölümün tam taslağını yaz. ')
        + 'Metni boş satırlarla paragraflara ayır. Plandaki hiçbir maddeyi atlama; planda olmayan büyük olay ya da karakter ekleme. '
        + 'Emin olmadığın özel detayı köşeli parantezle işaretle.',
      selected_entities: selected,
      existing_text: null,
    });
    const paras = (result.generated_text || '').split(/\n\s*\n/).map(t => t.trim()).filter(Boolean);
    if (!paras.length) { box.innerHTML = '<div class="error-text">Taslak boş döndü.</div>'; return; }
    // Başlık paragrafı listenin en başına eklenir - kaydedilince Paragraf 1
    // olur, "en üstte" tam olarak burası. AI'nın ürettiği metne KARIŞMAZ,
    // ayrı bir paragraf olarak eklenir; istenirse sonradan tek başına
    // düzenlenebilir ya da silinebilir.
    const kaydedilecekParagraflar = zamanBasligi ? [`— ${zamanBasligi} —`, ...paras] : paras;
    box.innerHTML = `
      <div class="panel" style="margin-top:8px;border-color:var(--gold);">
        <strong style="font-size:11px;color:var(--text-muted);">TASLAK (${paras.length} paragraf) - onaylamadan kaydedilmez</strong>
        ${zamanBasligi ? `<div style="font-size:11px;color:var(--text-muted);margin-top:4px;">🕐 Başa eklenecek tarih satırı: <strong>${escapeHtml(zamanBasligi)}</strong></div>` : ''}
        <div style="white-space:pre-wrap;font-size:12.5px;max-height:260px;overflow-y:auto;margin:6px 0;">${escapeHtml(result.generated_text)}</div>
        ${result.consistency_notes && result.consistency_notes.length
          ? `<div style="font-size:12px;color:var(--danger);">⚠ ${result.consistency_notes.map(escapeHtml).join(' · ')}</div>` : ''}
        <div id="draftCheckBox" style="font-size:12px;margin:6px 0;"></div>
        <div class="form-actions">
          <button class="btn btn-primary btn-sm" id="planDraftAcceptBtn">Paragraflara Böl ve Ekle</button>
          <button class="btn btn-sm" id="planDraftDiscardBtn">Vazgeç</button>
        </div>
      </div>`;
    // ONAY ÖNCESİ DENETİM: dört deterministik kontrol, AI çağrısı yok.
    // Onayı ENGELLEMEZ - kararı sen verirsin, ama neyi onayladığını
    // bilerek verirsin.
    (async () => {
      const dk = document.getElementById('draftCheckBox');
      if (!dk) return;
      dk.innerHTML = '<span style="color:var(--text-muted);">Denetleniyor…</span>';
      try {
        const d = await api.post('/ai/draft-check', {
          chapter_id: chapter.id, text: result.generated_text,
        });
        if (!d.bulgular || !d.bulgular.length) {
          dk.innerHTML = `<span style="color:var(--text-muted);">✓ ${d.denetim_sayisi} denetim temiz (plana sadakat · zaman · beat kapsama · tekrar)</span>`;
          return;
        }
        const hata = d.bulgular.filter(b => b.tur === 'hata');
        const uyari = d.bulgular.filter(b => b.tur !== 'hata');
        dk.innerHTML = [
          hata.length ? `<div style="color:var(--danger);font-weight:600;">⛔ ${hata.length} hata</div>` : '',
          ...hata.map(b => `<div style="color:var(--danger);">• <b>${escapeHtml(b.denetim)}:</b> ${escapeHtml(b.mesaj)}</div>`),
          uyari.length ? `<div style="color:var(--gold);font-weight:600;margin-top:4px;">⚠ ${uyari.length} uyarı</div>` : '',
          ...uyari.map(b => `<div style="color:var(--gold);">• <b>${escapeHtml(b.denetim)}:</b> ${escapeHtml(b.mesaj)}</div>`),
        ].join('');
      } catch (e) {
        dk.innerHTML = '<span style="color:var(--text-muted);">Denetim çalıştırılamadı.</span>';
      }
    })();

    el('planDraftDiscardBtn').addEventListener('click', () => { box.innerHTML = ''; });
    el('planDraftAcceptBtn').addEventListener('click', async () => {
      const btn = document.getElementById('planDraftAcceptBtn');
      btn.disabled = true; btn.textContent = 'Ekleniyor…';
      try {
        let nextNumber = Math.max(0, ...(chapter.paragraphs || []).map(p => p.number)) + 1;
        for (const text of kaydedilecekParagraflar) {
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
      <div style="font-size:11px;letter-spacing:0.4px;color:var(--text-muted);font-weight:700;margin-top:10px;">TUR MİRASI${yardim(YARDIM.turMirasi, 'sol')}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        ${TUR_ALANLARI.map(([anahtar, etiket, ipucu]) => `
          <div class="field" style="flex:1;min-width:140px;">
            <label title="${escapeHtml(ipucu)}">${escapeHtml(etiket)}</label>
            <input type="text" id="mTur_${anahtar}" value="${escapeHtml((col.tur_data || {})[anahtar] || '')}" placeholder="${escapeHtml(ipucu)}">
          </div>`).join('')}
      </div>
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
      const turData = {};
      TUR_ALANLARI.forEach(([anahtar]) => { turData[anahtar] = el(`mTur_${anahtar}`).value; });
      await api.put(`/matrix/${m.id}/columns/${colId}`, {
        label, character_id: charVal ? parseInt(charVal, 10) : null,
        tur_data: turData,
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
      <div style="font-size:11px;letter-spacing:0.4px;color:var(--text-muted);font-weight:700;margin-top:6px;">PARÇA MİRASI${yardim(YARDIM.parcaMirasi, 'sol')}</div>
      <div style="display:flex;gap:6px;">
        <div class="field" style="flex:1;"><label>Parça no</label>
          <input type="text" id="mRowNo" value="${escapeHtml((row.parca_data || {}).no || '')}" placeholder="3 veya 5a"></div>
        <div class="field" style="flex:1;"><label>Süre</label>
          <input type="text" id="mRowSure" value="${escapeHtml((row.parca_data || {}).sure || '')}" placeholder="20 dk"></div>
      </div>
      <div class="field">
        <label>📌 Talimat Kasası${yardim(YARDIM.talimatKasasi, 'sol')}</label>
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
        parca_data: { no: el('mRowNo').value, sure: el('mRowSure').value },
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
