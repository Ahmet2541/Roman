// ===========================================================================
// 07-tools.js — Gruplar, sesli okuma, isim vurgulama, zaman çizelgesi
// Bu dosya app.js'in bölünmesiyle oluştu. Tüm tanımlar GLOBAL kapsamda
// kalır (modül sistemi yok); index.html'de SIRAYLA yüklenir.
// ===========================================================================

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
      selected_entities: selected.length ? selected : paragraphEntities(hedef),
      existing_text: hedef.text, include_own_summary: true,
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

  // Bölüm İncelemesi de ÖNBELLEĞE yazar - puan rozetleri (fihrist, bölüm
  // şeridi, paragraf kenarı) bu önbellekten okunuyor. Eskiden yalnızca
  // Atölye yazıyordu, bu yüzden incelemeden sonra puanlar görünmüyordu.
  saveReviewCache(chapter.id, {
    at: Date.now(), literary, findings: byPara, motif: workshopState.motif || {},
    order: paraNumaralari,
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
    label: '🛠 Bölüm Değerlendirme',
    hint: 'Bir bölüm seç, elden geçir: hazırlık → derin analiz (edebî + okur + imge) → paragraf paragraf düzeltme.',
    render: (el) => renderWorkshopPicker(el),
  },
  length: {
    label: '📏 Uzunluk Kontrolü',
    hint: 'Sınırı aşan paragrafları bulur ve böler. Metin DEĞİŞMEZ - sadece nereye paragraf arası konacağına karar verilir.',
    render: (el) => renderLengthCheckView(el),
  },
  health: {
    label: '🩺 Sistem Sağlığı',
    hint: 'Arayüzde oluşan hataları gösterir. Bir şey çalışmadığında burada kaydı olur - ekran görüntüsü almana gerek kalmaz.',
    render: (el) => renderHealthView(el),
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
