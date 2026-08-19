// ===========================================================================
// 10-knowledge.js — Bilgi/İfşa Haritası, tur değerlendirmesi, yapısal akış
// Bu dosya app.js'in bölünmesiyle oluştu. Tüm tanımlar GLOBAL kapsamda
// kalır (modül sistemi yok); index.html'de SIRAYLA yüklenir.
// ===========================================================================

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
    <div class="toolbar">
      <button class="btn" id="scanKnowledgeBtn" title="Bölüm özetlerini tarayıp bilgi haritasını önerir ve tutarsızlıkları bildirir">🔎 Bölümleri tara ve öner</button>
      <button class="btn btn-primary" id="addFactBtn">+ Yeni Bilgi</button>
    </div>
    <div id="knowledgeScanBox"></div>
    <div id="factForm"></div>
    <div id="factList"><div class="empty-state">Yükleniyor…</div></div>`;
  el('addFactBtn').addEventListener('click', () => showFactForm(null));
  el('scanKnowledgeBtn').addEventListener('click', runKnowledgeScan);
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
  el('fk_cancel').addEventListener('click', () => { kap.innerHTML = ''; });
  el('fk_save').addEventListener('click', async () => {
    const bilgi = el('fk_info').value.trim();
    if (!bilgi) { el('fk_err').textContent = 'Bilgi metni gerekli.'; return; }
    const veri = {
      information: bilgi,
      known_by_characters: Array.from(document.querySelectorAll('.fk-char:checked')).map(x => parseInt(x.value, 10)),
      reader_state: el('fk_reader').value,
      introduced_chapter: parseInt(el('fk_intro').value, 10) || null,
      reveal_chapter: parseInt(el('fk_reveal').value, 10) || null,
      reveal_method: el('fk_method').value.trim(),
      planned_payoff: el('fk_payoff').value.trim(),
    };
    try {
      if (fact) await api.put(`/knowledge/${fact.id}`, veri);
      else await api.post('/knowledge/', veri);
      kap.innerHTML = '';
      await loadFactList();
    } catch (err) { el('fk_err').textContent = err.message; }
  });
}

// ---------------------------------------------------------------------------
// İNCELEME ÖZETİ: hem taze analiz sonrasında hem ÖNBELLEKTEN çağrılır.
// Önbellek sayesinde atölyeyi kapatıp açtığında analiz baştan çalışmaz.
// ---------------------------------------------------------------------------
function renderWorkshopReviewSummary(literary, motif, onbellekten, gunFarki) {
  const renk = (p) => p <= 2 ? 'var(--danger)' : (p === 3 ? '#b08d3f' : '#3f7a4f');
  // GÜVENLİ GÖVDE ERİŞİMİ: bu zincir kopunca fonksiyonun GERİ KALANI hiç
  // çalışmıyor - düğme dinleyicileri bağlanmıyor ve "düğme çalışmıyor"
  // olarak görünüyordu. Kaplama ya da gövde yoksa sessizce çık.
  const _ov = document.getElementById('workshopOverlay');
  const _govde = _ov && _ov.querySelector ? _ov.querySelector('.workshop-body') : null;
  if (!_govde) return;
  _govde.innerHTML = `
    <div style="text-align:center;padding:10px 0;">
      <div style="font-size:30px;font-weight:700;color:${renk(Math.round(literary.average))}">${literary.average}<span style="font-size:16px;color:var(--text-muted);">/5</span></div>
      <div style="font-size:12px;color:var(--text-muted);">edebî ortalama</div>
    </div>
    ${literary.strongest ? `<div style="font-size:12.5px;padding:8px;background:var(--paper-dim);border-radius:6px;">💪 ${escapeHtml(literary.strongest)}</div>` : ''}
    <div style="font-size:12.5px;color:var(--text-muted);margin-top:10px;">
      Kapsama: ${literary.total || 0} paragrafın ${literary.scanned || 0}'i tarandı${literary.chunks > 1 ? ` (${literary.chunks} parça)` : ''}.
    </div>
    <div style="font-size:13.5px;margin-top:10px;"><b>${workshopState.order.length}</b> paragrafta bulgu var.</div>
    ${workshopState.voice?.contract?.narrator ? `
      <div style="font-size:12px;color:var(--text-muted);margin-top:8px;padding:6px 8px;background:var(--paper-dim);border-radius:6px;">
        🗣 <b>Anlatıcı:</b> ${escapeHtml(workshopState.voice.contract.narrator)}${workshopState.voice.contract.focal ? ' · odak: ' + escapeHtml(workshopState.voice.contract.focal) : ''}${workshopState.voice.contract.distance ? ' · mesafe: ' + escapeHtml(workshopState.voice.contract.distance) : ''}
        ${(workshopState.voice.violations || []).filter(v => v.certainty === 'kesin').length ? '<span style="color:var(--danger);"> · ' + (workshopState.voice.violations || []).filter(v => v.certainty === 'kesin').length + ' ihlal</span>' : ''}
      </div>` : ''}
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
      ${Object.keys(paraPurposes).length ? `
        <details style="margin-top:8px;">
          <summary style="cursor:pointer;font-size:12px;color:var(--text-muted);">🎯 İşlev haritası (${Object.keys(paraPurposes).length} paragrafın görevi)</summary>
          <div style="max-height:220px;overflow-y:auto;margin-top:4px;">
            ${Object.keys(paraPurposes).map(Number).sort((a, b) => a - b).map(n => `
              <div style="font-size:12px;padding:3px 0;border-bottom:1px solid var(--border);">
                <b style="color:var(--gold);">P${n}</b>
                ${(workshopState.roleKinds || {})[n] ? `<span style="font-size:10px;color:var(--text-muted);">[${escapeHtml(workshopState.roleKinds[n])}]</span>` : ''}
                ${escapeHtml(paraPurposes[n])}
              </div>`).join('')}
          </div>
        </details>` : ''}
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
  el('wsBackPrep').addEventListener('click', renderWorkshopPrep);
  el('wsToParas').addEventListener('click', () => {
    if (el('wsSweep').checked) {
      // Tüm paragraflar sırayla; bulgusu olanlar zaten işaretli görünür
      workshopState.order = (workshopState.chapter.paragraphs || [])
        .filter(p => (p.text || '').trim()).map(p => p.number).sort((a, b) => a - b);
    }
    if (!workshopState.order.length) { alert('Gezilecek paragraf yok.'); return; }
    renderWorkshopParagraph(0);
  });

  // TAM TUR: dinleyiciler bağlandıktan SONRA otomatik geç. Eskiden bu blok
  // wsToParas dinleyicisinden ÖNCE çalışıyordu - tıklama boşa gidiyordu.
  if (workshopState.autoSweep) {
    workshopState.autoSweep = false;
    const sweepEl = document.getElementById('wsSweep');
    if (sweepEl) sweepEl.checked = true;
    setTimeout(() => document.getElementById('wsToParas')?.click(), 300);
  }

  // Önbellekten geldiyse tazeleme seçeneği sun
  if (onbellekten) {
    const govdeEl = _govde;
    govdeEl.insertAdjacentHTML('afterbegin', `
      <div style="font-size:11.5px;color:var(--text-muted);background:var(--paper-dim);padding:6px 8px;border-radius:6px;margin-bottom:8px;">
        📦 Kayıtlı inceleme gösteriliyor${gunFarki > 0 ? ` (${gunFarki} gün önce)` : ' (bugün)'} - analiz yeniden çalıştırılmadı.
        <button class="btn btn-sm" id="wsRescan" style="font-size:11px;margin-left:6px;">🔄 Yeniden incele</button>
      </div>`);
    el('wsRescan').addEventListener('click', () => {
      workshopState.forceRescan = true;
      renderWorkshopReview();
    });
  }
}

// İnceleme önbelleği (bölüm bazlı, tarayıcıda)
// ---------------------------------------------------------------------------
// ROMAN GENELİ TARAMA HAFIZASI: tutarlılık, üslup ve yapısal akış sonuçları
// da saklanır. Bölüm değerlendirmeleri zaten kaydediliyordu; bunlar her
// seferinde baştan çalışıyor ve önceki sonuç kayboluyordu - oysa uzun
// romanda bu taramalar dakikalar sürüyor ve karşılaştırma değerli.
// ---------------------------------------------------------------------------
function saveGlobalScan(tur, veri) {
  try {
    const novelId = getNovelId() || 0;
    localStorage.setItem(`roman_scan_${tur}_${novelId}`, JSON.stringify({ at: Date.now(), veri }));
  } catch (e) { /* depolama dolu - sessiz geç */ }
}
function loadGlobalScan(tur) {
  try {
    const novelId = getNovelId() || 0;
    const raw = localStorage.getItem(`roman_scan_${tur}_${novelId}`);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}
function scanAgeLabel(kayit) {
  if (!kayit) return '';
  const dk = Math.floor((Date.now() - kayit.at) / 60000);
  if (dk < 60) return `${dk} dakika önce`;
  const saat = Math.floor(dk / 60);
  if (saat < 24) return `${saat} saat önce`;
  return `${Math.floor(saat / 24)} gün önce`;
}

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
  return `<div class="para-score" style="font-size:9px;margin-top:2px;color:${renk};font-weight:700;"
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
    el('wsMicroGo').addEventListener('click', async (e) => {
      const b = e.target; b.disabled = true; b.textContent = 'Alternatifler…';
      kutu.dataset.mode = 'micro';
      kutu.innerHTML = '<div class="empty-state">Sadece seçili parça için alternatifler…</div>';
      try {
        const r = await api.post('/ai/micro-edit', {
          paragraph_text: metinEl.innerText.trim(),
          target: secim,
          request: el('wsMicroReq').value.trim(),
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
          // Mikro düzenleme küçük ama kontrolsüz değil: seçilen ifade bir
          // sayı ya da kanonik isim taşıyorsa sessizce düşebilir.
          const eskiMetin = metinEl.innerText.trim();
          const uyarilar = quickFactCheck(eskiMetin, o.preview);
          if (uyarilar.length && !confirm(
            `Bu değişiklik veri kaybına yol açıyor:\n\n${uyarilar.join('\n')}\n\nYine de uygulansın mı?`)) return;
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

// Paragrafta GEÇEN varlıklar (mention'lardan): profilleri bağlama girsin.
// Vicdan'ın konuşma tarzını, mekânın kurallarını bilmeden o paragrafı
// yeniden yazmak körlemesine iş - eskiden boş liste gidiyordu.
function paragraphEntities(para) {
  if (!para || !para.mentions) return [];
  const gorulen = new Set();
  const out = [];
  para.mentions.forEach(m => {
    const anahtar = `${m.entity_type}:${m.entity_id}`;
    if (gorulen.has(anahtar)) return;
    gorulen.add(anahtar);
    out.push({ entity_type: m.entity_type, entity_id: m.entity_id });
  });
  return out.slice(0, 8);   // bağlamı şişirmesin
}

// ---------------------------------------------------------------------------
// UZUNLUK KONTROLÜ (ayrı menü): bölümdeki SINIRI AŞAN paragrafları tek
// ekranda listeler ve tek tek bölmeyi sunar. Atölyeyle karıştırmamak için
// ayrıldı - bu tamamen mekanik bir iş, edebî değerlendirmeyle ilgisi yok.
// ---------------------------------------------------------------------------
async function renderLengthCheckView(kapsayici) {
  kapsayici.innerHTML = '<div class="empty-state">Fihrist yükleniyor…</div>';
  try {
    const tumu = await api.get('/chapters/');
    const hiyerarsi = buildChapterHierarchy(tumu);
    const metinliler = hiyerarsi.filter(it => (it.chapter.paragraph_count || 0) > 0);
    if (!metinliler.length) {
      kapsayici.innerHTML = '<div class="empty-state">Henüz metin yazılmış bölüm yok.</div>';
      return;
    }
    kapsayici.innerHTML = `
      <p style="font-size:12.5px;color:var(--text-muted);max-width:680px;margin-top:0;">
        Sınır: <b>${PARA_WORD_LIMIT} kelime</b>. Uzun paragraf okuma temposunu düşürür ve düzenlemesi zorlaşır.
        Bölmede metnin kendisi <b>değişmez</b>; yalnızca nereye paragraf arası konacağına karar verilir ve
        parçalar önce gösterilir.
      </p>
      <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;margin-bottom:10px;">
        <div class="field" style="margin:0;min-width:260px;flex:1;">
          <label>Bölüm</label>
          <select id="lcChapter">
            ${metinliler.map(it => `<option value="${it.chapter.id}">#${it.displayNumber} ${escapeHtml(stripMarkdownArtifacts(it.chapter.title) || '(başlıksız)')} · ${it.chapter.paragraph_count} paragraf</option>`).join('')}
          </select>
        </div>
        <button class="btn btn-primary" id="lcScan">Uzun paragrafları bul</button>
      </div>
      <div id="lcResult"></div>`;
    el('lcScan').addEventListener('click', () => runLengthScan());
  } catch (err) {
    kapsayici.innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`;
  }
}

async function runLengthScan() {
  const kutu = document.getElementById('lcResult');
  const chapterId = parseInt(el('lcChapter').value, 10);
  kutu.innerHTML = '<div class="empty-state">Taranıyor…</div>';
  try {
    const ch = await api.get(`/chapters/${chapterId}`);
    const uzunlar = (ch.paragraphs || [])
      .filter(p => wordCount(p.text) >= PARA_WORD_LIMIT)
      .sort((a, b) => wordCount(b.text) - wordCount(a.text));
    const toplam = (ch.paragraphs || []).length;
    if (!uzunlar.length) {
      kutu.innerHTML = `<div class="panel" style="border-left:3px solid #3f7a4f;">
        <b style="color:#3f7a4f;">✓ Temiz</b> — ${toplam} paragrafın hiçbiri ${PARA_WORD_LIMIT} kelimeyi aşmıyor.</div>`;
      return;
    }
    kutu.innerHTML = `
      <div class="panel">
        <div style="font-size:13px;"><b>${uzunlar.length}</b> paragraf sınırı aşıyor (${toplam} paragraf içinde).
          En uzunu <b>${wordCount(uzunlar[0].text)}</b> kelime.</div>
        <div style="font-size:11.5px;color:var(--text-muted);margin-top:4px;">Her biri için bölme önerisi ayrı ayrı gösterilir - onaysız değişmez.</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0;">
        <button class="btn btn-primary" id="lcSplitAll">✂ Tümünü böl ve yeniden sırala (${uzunlar.length})</button>
      </div>
      <div id="lcAllBox"></div>
      ${uzunlar.map(p => `
        <div class="entity-row lc-row" data-num="${p.number}" style="flex-wrap:wrap;">
          <div style="flex:1;min-width:240px;">
            <div class="name">P${p.number} <span style="color:var(--danger);font-size:12px;">${wordCount(p.text)} kelime</span></div>
            <div class="desc">${escapeHtml(truncate(p.text, 150))}</div>
          </div>
          <div class="actions"><button class="btn btn-sm btn-primary lc-split" data-num="${p.number}">✂ Böl</button></div>
          <div class="lc-box" data-num="${p.number}" style="width:100%;"></div>
        </div>`).join('')}`;

    // TOPLU BÖLME: her paragrafın önerisi tek tek alınır, hepsi ÖNCE
    // gösterilir, onaydan sonra SONDAN BAŞA uygulanır (numara çakışması
    // olmasın) ve numaralar otomatik yeniden sıralanır.
    el('lcSplitAll').addEventListener('click', async (e) => {
      const b = e.target, box = document.getElementById('lcAllBox');
      b.disabled = true;
      const plan = [];
      for (let i = 0; i < uzunlar.length; i++) {
        b.textContent = `Öneriler alınıyor… ${i + 1}/${uzunlar.length}`;
        try {
          const r = await api.post(`/chapters/${chapterId}/split-preview`, { text: uzunlar[i].text });
          const parcalar = (r.paragraphs || []).map(x => x.text).filter(Boolean);
          if (parcalar.length > 1) plan.push({ number: uzunlar[i].number, parcalar });
        } catch (err) { /* bu paragraf atlanır */ }
      }
      b.disabled = false;
      b.textContent = `✂ Tümünü böl ve yeniden sırala (${uzunlar.length})`;
      if (!plan.length) {
        box.innerHTML = '<div class="panel" style="font-size:12.5px;color:var(--text-muted);">Hiçbirinde bölünecek doğal bir yer bulunamadı.</div>';
        return;
      }
      const yeniToplam = toplam + plan.reduce((t, x) => t + x.parcalar.length - 1, 0);
      box.innerHTML = `
        <div class="panel" style="border-left:3px solid var(--gold);">
          <div style="font-size:13px;"><b>${plan.length}</b> paragraf bölünecek →
            toplam <b>${toplam}</b> paragraf <b>${yeniToplam}</b> olacak. Metin DEĞİŞMEZ, numaralar yeniden sıralanır.</div>
          <div style="max-height:300px;overflow-y:auto;margin-top:8px;">
            ${plan.map(x => `
              <div style="font-size:12.5px;margin-top:8px;padding-top:6px;border-top:1px dashed var(--border);">
                <b style="color:var(--gold);">P${x.number}</b> → ${x.parcalar.length} parça
                ${x.parcalar.map((t, i) => `<div style="margin-top:3px;">${i + 1}. ${escapeHtml(truncate(t, 90))} <span style="color:var(--text-muted);">(${wordCount(t)} kelime)</span></div>`).join('')}
              </div>`).join('')}
          </div>
          <div class="form-actions">
            <button class="btn btn-primary" id="lcAllApply">Hepsini uygula</button>
            <button class="btn" id="lcAllCancel">Vazgeç</button>
          </div>
          <div id="lcAllProgress" style="font-size:12px;color:var(--text-muted);"></div>
        </div>`;
      el('lcAllCancel').addEventListener('click', () => { box.innerHTML = ''; });
      el('lcAllApply').addEventListener('click', async (e2) => {
        const ab = e2.target, ilerleme = document.getElementById('lcAllProgress');
        ab.disabled = true;
        // SONDAN BAŞA: önce büyük numaralar bölünür, böylece daha küçük
        // numaralı paragrafların konumu bozulmaz
        const sirali = plan.slice().sort((a, c) => c.number - a.number);
        let guncelBolum = await api.get(`/chapters/${chapterId}`);
        for (let i = 0; i < sirali.length; i++) {
          ilerleme.textContent = `Uygulanıyor… ${i + 1}/${sirali.length} (P${sirali[i].number})`;
          try {
            await applyParagraphSplit(guncelBolum, sirali[i].number, sirali[i].parcalar);
            guncelBolum = await api.get(`/chapters/${chapterId}`);
          } catch (err) {
            ilerleme.innerHTML = `<span class="error-text">P${sirali[i].number} bölünemedi: ${escapeHtml(err.message)}</span>`;
            ab.disabled = false;
            return;
          }
        }
        box.innerHTML = `<div class="panel" style="border-left:3px solid #3f7a4f;">
          <b style="color:#3f7a4f;">✓ ${sirali.length} paragraf bölündü</b>
          <div style="font-size:12px;color:var(--text-muted);">Numaralar yeniden sıralandı. Toplam ${guncelBolum.paragraphs.length} paragraf.</div>
          <button class="btn btn-sm" id="lcRescan" style="margin-top:8px;">Yeniden tara</button></div>`;
        el('lcRescan').addEventListener('click', () => runLengthScan());
      });
    });

    kutu.querySelectorAll('.lc-split').forEach(b => b.addEventListener('click', async () => {
      const num = parseInt(b.dataset.num, 10);
      const para = ch.paragraphs.find(x => x.number === num);
      const box = kutu.querySelector(`.lc-box[data-num="${num}"]`);
      b.disabled = true; b.textContent = 'Bölünüyor…';
      try {
        const r = await api.post(`/chapters/${chapterId}/split-preview`, { text: para.text });
        const parcalar = (r.paragraphs || []).map(x => x.text).filter(Boolean);
        if (parcalar.length < 2) {
          box.innerHTML = '<div style="font-size:12px;color:var(--text-muted);margin-top:6px;">Bölünecek doğal bir yer bulunamadı.</div>';
        } else {
          box.innerHTML = `
            <div class="panel" style="margin-top:8px;border-left:3px solid var(--gold);">
              <div style="font-size:10.5px;color:var(--text-muted);letter-spacing:0.4px;">${parcalar.length} PARÇA - metin değişmedi</div>
              ${parcalar.map((x, i) => `<div style="font-size:12.5px;margin-top:6px;padding-top:6px;border-top:1px dashed var(--border);"><b>${i + 1}.</b> ${escapeHtml(x)} <span style="color:var(--text-muted);">(${wordCount(x)} kelime)</span></div>`).join('')}
              <div class="form-actions">
                <button class="btn btn-sm btn-primary lc-apply">Böl ve kaydet</button>
                <button class="btn btn-sm lc-cancel">Vazgeç</button>
              </div>
            </div>`;
          box.querySelector('.lc-cancel').addEventListener('click', () => { box.innerHTML = ''; });
          box.querySelector('.lc-apply').addEventListener('click', async () => {
            try {
              await applyParagraphSplit(ch, num, parcalar);
              box.innerHTML = '<div style="font-size:12px;color:#3f7a4f;margin-top:6px;">✓ Bölündü. Listeyi tazelemek için tekrar tara.</div>';
              b.remove();
            } catch (err) { alert(err.message); }
          });
        }
      } catch (err) {
        box.innerHTML = `<div class="error-text" style="font-size:12px;">${escapeHtml(err.message)}</div>`;
      }
      b.disabled = false; b.textContent = '✂ Böl';
    }));
  } catch (err) {
    kutu.innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`;
  }
}

// Bilgi haritası otomatik taraması: özetlerden bilgi önerir, tutarsızlıkları
// bildirir. Öneriler ONAYSIZ kaydedilmez - her biri tek tek eklenir.
async function runKnowledgeScan() {
  const kutu = document.getElementById('knowledgeScanBox');
  kutu.innerHTML = '<div class="empty-state">Bölüm özetleri taranıyor…</div>';
  try {
    const r = await api.post('/ai/knowledge-scan', {});
    if (r.note) { kutu.innerHTML = `<div class="panel" style="font-size:12.5px;">${escapeHtml(r.note)}</div>`; return; }
    const turEtiket = {
      bilgi_sizmasi: '🚨 Bilgi sızması', erken_ifsa: '⚠ Erken ifşa',
      odenmemis_kurulum: '🔓 Ödenmemiş kurulum', celiski: '⚡ Çelişki',
    };
    const okurEtiket = { hayir: '🔒 bilmiyor', sezdirildi: '🔎 sezdirildi', evet: '👁 biliyor' };
    kutu.innerHTML = `
      ${r.issues.length ? `
        <div class="panel" style="border-left:3px solid var(--danger);">
          <div style="font-size:11px;color:var(--text-muted);letter-spacing:0.4px;">TUTARSIZLIKLAR (${r.issues.length})</div>
          ${r.issues.map(i => `
            <div style="font-size:12.5px;margin-top:8px;border-left:2px solid var(--border);padding-left:8px;">
              <b>${turEtiket[i.type] || i.type}</b>${i.chapters.length ? ` <span style="color:var(--text-muted);">Bölüm ${i.chapters.join(', ')}</span>` : ''}
              ${i.information ? `<div style="font-style:italic;">"${escapeHtml(i.information)}"</div>` : ''}
              <div style="color:var(--text-muted);">${escapeHtml(i.problem)}</div>
              ${i.fix ? `<div>→ ${escapeHtml(i.fix)}</div>` : ''}
            </div>`).join('')}
        </div>` : '<div class="panel" style="border-left:3px solid #3f7a4f;font-size:12.5px;"><b style="color:#3f7a4f;">✓ Tutarsızlık bulunamadı</b></div>'}
      ${r.facts.length ? `
        <div class="panel" style="margin-top:10px;">
          <div style="font-size:11px;color:var(--text-muted);letter-spacing:0.4px;">ÖNERİLEN BİLGİLER (${r.facts.length}) - onaysız kaydedilmez</div>
          ${r.facts.map((f, i) => `
            <div class="entity-row" style="flex-wrap:wrap;">
              <div style="flex:1;min-width:220px;">
                <div class="name">${escapeHtml(f.information)}</div>
                <div class="desc" style="display:flex;gap:10px;flex-wrap:wrap;font-size:11.5px;">
                  <span>${okurEtiket[f.reader_state]}</span>
                  ${f.character_names.length ? `<span>👤 ${f.character_names.map(escapeHtml).join(', ')}</span>` : ''}
                  ${f.introduced_chapter ? `<span>giriş: B${f.introduced_chapter}</span>` : ''}
                  ${f.reveal_chapter ? `<span>ifşa: B${f.reveal_chapter}</span>` : '<span style="color:var(--danger);">ifşa planlanmamış</span>'}
                </div>
                ${f.evidence ? `<div class="desc" style="font-style:italic;">kanıt: ${escapeHtml(f.evidence)}</div>` : ''}
              </div>
              <div class="actions"><button class="btn btn-sm btn-primary kfact-add" data-idx="${i}">+ Ekle</button></div>
            </div>`).join('')}
          <button class="btn btn-sm" id="kfactAddAll" style="margin-top:8px;">Hepsini ekle (${r.facts.length})</button>
        </div>` : ''}`;

    const ekle = async (f) => api.post('/knowledge/', {
      information: f.information, introduced_chapter: f.introduced_chapter,
      reveal_chapter: f.reveal_chapter, known_by_characters: f.known_by_characters,
      reader_state: f.reader_state, reveal_method: f.reveal_method,
      planned_payoff: f.planned_payoff,
    });
    kutu.querySelectorAll('.kfact-add').forEach(b => b.addEventListener('click', async () => {
      b.disabled = true; b.textContent = 'Ekleniyor…';
      try { await ekle(r.facts[parseInt(b.dataset.idx, 10)]); b.textContent = '✓ Eklendi'; await loadFactList(); }
      catch (err) { b.disabled = false; b.textContent = '+ Ekle'; alert(err.message); }
    }));
    document.getElementById('kfactAddAll')?.addEventListener('click', async (e) => {
      e.target.disabled = true;
      for (let i = 0; i < r.facts.length; i++) {
        e.target.textContent = `Ekleniyor… ${i + 1}/${r.facts.length}`;
        try { await ekle(r.facts[i]); } catch (err) { /* atla */ }
      }
      e.target.textContent = '✓ Hepsi eklendi';
      await loadFactList();
    });
  } catch (err) {
    kutu.innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`;
  }
}

// Tutarlılık tarama sonucunu çizer - hem taze hem KAYITLI sonuç için.
function renderScanIssues(result) {
  let html = '';
  if (result.summary) html += `<div class="panel">${escapeHtml(result.summary)}</div>`;
  if (!result.issues || !result.issues.length) {
    return html + '<div class="success-text" style="margin-top:12px;">Herhangi bir tutarsızlık bulunamadı.</div>';
  }
  const severityColor = { 'yüksek': 'var(--danger)', 'orta': '#a67c1e', 'düşük': 'var(--text-muted)' };
  html += result.issues.map(issue => `
    <div class="panel" style="margin-top:10px;border-left:4px solid ${severityColor[issue.severity] || 'var(--border)'};">
      <strong style="text-transform:uppercase;font-size:11px;color:${severityColor[issue.severity] || 'var(--text-muted)'};">${escapeHtml(issue.severity)}</strong>
      ${issue.chapter_number ? ` · Bölüm ${issue.chapter_number}${issue.paragraph_number ? ', Paragraf ' + issue.paragraph_number : ''}` : ''}
      <div style="margin-top:6px;font-size:13.5px;">${escapeHtml(issue.description)}</div>
    </div>`).join('');
  return html;
}

// ---------------------------------------------------------------------------
// BAĞLI BÖLÜM LİSTESİ: bir matrisin hücreleri farklı bölümlere bağlı olur;
// hangi bölümlerle çalıştığı ızgaraya bakarak anlaşılmıyordu. Üstte tek
// şeritte toplanır, tıklayınca o bölüme gidilir.
// ---------------------------------------------------------------------------
function boundChaptersStrip(m) {
  const bagli = new Map();
  (m.cells || []).forEach(c => {
    if (c.chapter_number) {
      if (!bagli.has(c.chapter_number)) bagli.set(c.chapter_number, []);
      if (c.code) bagli.get(c.chapter_number).push(c.code);
    }
  });
  const bosHucre = (m.cells || []).filter(c => !c.chapter_number && (c.content || '').trim()).length;
  if (!bagli.size && !bosHucre) return '';
  const sirali = [...bagli.entries()].sort((a, b) => a[0] - b[0]);
  return `
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0;padding:6px 10px;
      background:var(--paper-dim);border-radius:6px;font-size:12px;">
      <b style="font-size:10.5px;color:var(--text-muted);letter-spacing:0.4px;">BAĞLI BÖLÜMLER (${sirali.length})</b>
      ${sirali.map(([no, kodlar]) => `
        <button class="btn btn-sm mx-goto-ch" data-num="${no}" style="font-size:11px;padding:1px 8px;"
          title="${kodlar.length} plan hücresi: ${kodlar.join(', ')}">B${no}${kodlar.length > 1 ? ` ·${kodlar.length}` : ''}</button>`).join('')}
      ${bosHucre ? `<span style="color:var(--danger);font-size:11.5px;" title="Plan yazılmış ama hiçbir bölüme bağlanmamış - bu planlar AI'ya GİTMEZ">⚠ ${bosHucre} hücre bölüme bağlı değil</span>` : ''}
    </div>`;
}

// ---------------------------------------------------------------------------
// BÖLÜMDEN SATIR OLUŞTUR: bir bölümün yapısını satırlara çevirir. İki
// kaynak: (a) fihristteki ALT GİRDİLERİ (kısımlar), (b) bölümün PLANI
// (madde madde). Elle 20 satır yazmak yerine var olan yapıyı kullanır.
// ---------------------------------------------------------------------------
async function openRowsFromChapterDialog(m) {
  const editor = document.getElementById('matrixCellEditor');
  editor.innerHTML = '<div class="empty-state">Fihrist yükleniyor…</div>';
  editor.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  try {
    const tree = await api.get('/matrix/outline-tree');
    editor.innerHTML = `
      <div class="panel">
        <b>⚡ Bölümden satır oluştur</b>
        <div style="font-size:12px;color:var(--text-muted);margin-top:4px;">
          Bir bölümün yapısı satırlara çevrilir. <b>Alt girdiler</b> = fihristteki kısımlar,
          <b>plan maddeleri</b> = o bölümün planındaki satırlar. Mevcut satırların sonuna eklenir.
        </div>
        <div class="field" style="margin-top:8px;"><label>Bölüm</label>
          <select id="rfcChapter">
            ${tree.map(t => `<option value="${t.id}" data-child="${t.child_count}">${'—'.repeat(t.level)} #${t.display} ${escapeHtml(t.title || '(başlıksız)')}${t.child_count ? ` · ${t.child_count} alt girdi` : ''}</option>`).join('')}
          </select></div>
        <div class="field"><label>Kaynak</label>
          <select id="rfcSource">
            <option value="children">Alt girdiler (fihrist kısımları)</option>
            <option value="plan">Plan maddeleri</option>
          </select></div>
        <div class="form-actions">
          <button class="btn btn-primary" id="rfcGo">Önizle</button>
          <button class="btn" id="rfcCancel">Kapat</button>
        </div>
        <div id="rfcResult"></div>
      </div>`;
    el('rfcCancel').addEventListener('click', () => { editor.innerHTML = ''; });
    el('rfcGo').addEventListener('click', async () => {
      const chapterId = parseInt(el('rfcChapter').value, 10);
      const kaynak = el('rfcSource').value;
      const kutu = document.getElementById('rfcResult');
      kutu.innerHTML = '<div class="empty-state">Hazırlanıyor…</div>';
      let etiketler = [];
      try {
        if (kaynak === 'children') {
          const alt = tree.filter(t => t.parent_id === chapterId);
          if (alt.length) {
            etiketler = alt.map(t => t.title || `#${t.display}`);
          } else {
            // parent_id yoksa numaraya göre türet: seçilenin altındaki bir üst seviye
            const secilen = tree.find(t => t.id === chapterId);
            etiketler = tree.filter(t => t.display.startsWith(secilen.display + '-') &&
              t.display.split('-').length === secilen.display.split('-').length + 1)
              .map(t => t.title || `#${t.display}`);
          }
        } else {
          const plan = await api.get(`/matrix/plan-for-chapter/${chapterId}`);
          const liste = Array.isArray(plan) ? plan : (plan ? [plan] : []);
          etiketler = liste.map(x => (x.content || '').split('\n'))
            .flat().map(l => l.replace(/^[-*•]\s*/, '').trim()).filter(Boolean);
        }
      } catch (err) { kutu.innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`; return; }

      if (!etiketler.length) {
        kutu.innerHTML = '<div style="font-size:12.5px;color:var(--text-muted);margin-top:8px;">Bu kaynakta satır bulunamadı - diğer kaynağı dene.</div>';
        return;
      }
      kutu.innerHTML = `
        <div style="margin-top:10px;border-top:1px dashed var(--border);padding-top:8px;">
          <div style="font-size:12.5px;"><b>${etiketler.length}</b> satır eklenecek (mevcut ${m.rows.length} satırın sonuna):</div>
          <div style="max-height:220px;overflow-y:auto;margin-top:6px;">
            ${etiketler.map((t, i) => `<div style="font-size:12px;padding:2px 0;"><b style="color:var(--text-muted);">${m.rows.length + i + 1}.</b> ${escapeHtml(truncate(t, 80))}</div>`).join('')}
          </div>
          <button class="btn btn-sm btn-primary" id="rfcApply" style="margin-top:8px;">Satırları ekle</button>
        </div>`;
      el('rfcApply').addEventListener('click', async (e) => {
        const b = e.target; b.disabled = true;
        for (let i = 0; i < etiketler.length; i++) {
          b.textContent = `Ekleniyor… ${i + 1}/${etiketler.length}`;
          try { await api.post(`/matrix/${m.id}/rows`, { label: etiketler[i].slice(0, 120) }); }
          catch (err) { /* atla */ }
        }
        editor.innerHTML = '';
        await loadMatrixGrid();
      });
    });
  } catch (err) {
    editor.innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`;
  }
}

// Matriste kapalı bölüm satırları (kalıcı): 8 tur x 10 satırlık ızgarada
// gezinmek için bölümler katlanabilir olmalı.
const collapsedMatrixRows = new Set(
  (() => { try { return JSON.parse(localStorage.getItem('roman_matrix_collapsed') || '[]'); } catch (e) { return []; } })()
);
function saveCollapsedMatrixRows() {
  try { localStorage.setItem('roman_matrix_collapsed', JSON.stringify([...collapsedMatrixRows])); }
  catch (e) { /* yoksay */ }
}

// ---------------------------------------------------------------------------
// TUR DEĞERLENDİRMESİ: bir üst başlık altındaki sahneleri bütün olarak
// denetler. Bölüm incelemesi tek girdiye, yapısal tarama roman geneline
// bakıyordu - kullanıcının yapısında asıl anlamlı birim (bir TUR) arada
// denetimsiz kalıyordu.
// ---------------------------------------------------------------------------
async function runArcReview(chapterId) {
  const overlay = ensureModalOverlay();
  overlay.innerHTML = '<div class="panel" style="max-width:560px;width:92%;"><div class="empty-state">Tur bütün olarak değerlendiriliyor…</div></div>';
  overlay.style.display = 'flex';
  try {
    const r = await api.post(`/ai/arc-review/${chapterId}`, {});
    const yayRenk = { yukseliyor: '#3f7a4f', duz: '#b08d3f', dusuyor: 'var(--danger)' }[r.arc];
    const yayEtiket = { yukseliyor: '↗ Yükseliyor', duz: '→ Düz', dusuyor: '↘ Düşüyor' }[r.arc];
    const enUzun = Math.max(1, ...(r.scenes || []).map(s => s.paragraphs));
    overlay.innerHTML = `
      <div class="panel" style="max-width:560px;width:92%;max-height:88vh;overflow-y:auto;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <b>📈 Tur Değerlendirmesi</b>
          <button class="btn btn-sm" id="arcClose">✕</button>
        </div>
        ${r.summary ? `<div style="font-size:13px;margin-top:8px;">${escapeHtml(r.summary)}</div>` : ''}
        <div style="font-size:13px;margin-top:10px;">
          <b style="color:${yayRenk};">${yayEtiket}</b>
          ${r.arc_note ? `<span style="color:var(--text-muted);"> — ${escapeHtml(r.arc_note)}</span>` : ''}
        </div>

        ${(r.scenes || []).length ? `
          <div style="margin-top:10px;">
            <div style="font-size:10.5px;color:var(--text-muted);letter-spacing:0.4px;">HACİM DAĞILIMI</div>
            ${r.scenes.map(sc => `
              <div style="display:flex;align-items:center;gap:6px;font-size:12px;margin-top:3px;">
                <span style="min-width:44px;color:var(--gold);font-weight:600;">${escapeHtml(sc.display)}</span>
                <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(sc.title)}</span>
                <span style="width:${Math.round((sc.paragraphs / enUzun) * 90)}px;height:7px;background:var(--gold);opacity:0.7;border-radius:3px;"></span>
                <span style="color:var(--text-muted);min-width:34px;text-align:right;">${sc.paragraphs}</span>
              </div>`).join('')}
            ${r.volume_note ? `<div style="font-size:12px;color:var(--text-muted);margin-top:6px;">${escapeHtml(r.volume_note)}</div>` : ''}
          </div>` : ''}

        ${r.rhythm.length ? `
          <div style="margin-top:12px;">
            <div style="font-size:10.5px;color:var(--text-muted);letter-spacing:0.4px;">RİTİM SORUNLARI</div>
            ${r.rhythm.map(x => `
              <div style="font-size:12.5px;margin-top:6px;border-left:3px solid #b08d3f;padding-left:8px;">
                <b>${escapeHtml(x.scene)}</b>
                <div style="color:var(--text-muted);">${escapeHtml(x.issue)}</div>
                ${x.fix ? `<div>→ ${escapeHtml(x.fix)}</div>` : ''}
              </div>`).join('')}
          </div>` : ''}

        ${r.repeats.length ? `
          <div style="margin-top:12px;">
            <div style="font-size:10.5px;color:var(--text-muted);letter-spacing:0.4px;">SAHNELER ARASI TEKRAR</div>
            ${r.repeats.map(x => `<div style="font-size:12.5px;margin-top:4px;border-left:3px solid var(--danger);padding-left:8px;">${escapeHtml(x)}</div>`).join('')}
          </div>` : ''}

        ${r.closing ? `<div style="margin-top:12px;font-size:12.5px;"><b>Kapanış:</b> <span style="color:var(--text-muted);">${escapeHtml(r.closing)}</span></div>` : ''}
      </div>`;
    el('arcClose').addEventListener('click', () => {
      overlay.style.display = 'none'; overlay.innerHTML = '';
    });
  } catch (err) {
    overlay.innerHTML = `<div class="panel" style="max-width:480px;width:92%;">
      <div class="error-text">${escapeHtml(err.message)}</div>
      <button class="btn btn-sm" onclick="el('createItemModalOverlay').style.display='none'" style="margin-top:8px;">Kapat</button></div>`;
  }
}

// Bulgusu OLAN sıradaki paragrafın indeksi (yön: +1 ileri, -1 geri).
// Yoksa null döner. "Sadece bulgulu" modunda gezinme bunu kullanır.
function nextFlaggedIndex(mevcut, yon) {
  const sira = workshopState.order || [];
  for (let i = mevcut + yon; i >= 0 && i < sira.length; i += yon) {
    const num = sira[i];
    // Bulgusu olan AMA henüz çözülmemiş paragraflar. Çözülmüşleri de
    // atlamak gerekiyordu - yoksa düzelttiğin paragrafta tekrar duruyordu.
    if ((workshopState.findings[num] || []).length && !resolvedParas.has(String(num))) return i;
  }
  return null;
}

// Sohbette varılan kararlar: kullanıcının kendi mesajları + "yeni versiyon"
// üretimine yol açan talimatlar. Kontrol bunları BİLEREK YAPILMIŞ sayar.
function acceptedChangesFor(number) {
  const gecmis = paraChatHistories[number] || [];
  return gecmis
    .filter(m => m.role === 'user')
    .map(m => (m.content || '').replace(/\s+/g, ' ').trim())
    // Otomatik çerçeve mesajını DIŞLA: içinde kontrol uyarıları var ve
    // onları "kabul edilen değişiklik" saymak kontrolü kendi uyarılarıyla
    // besleyip döngüyü büyütüyordu.
    .filter(t => !/^P\d+ için seçtiğim versiyon/.test(t) && !/Kontrol şu uyarıları verdi/.test(t))
    .filter(t => t && t.length < 400)
    .slice(-4)
    .join(' | ')
    .slice(0, 600);
}
