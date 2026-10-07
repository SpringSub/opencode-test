// vocaby 英単語アプリ
// ストレージ層は将来 Firestore に置き換え可能な Repository パターン。
// 現在は LocalStorageAdapter を使用。
// Firestore移行案:
//   users/{uid}/wordbooks/{bookId} {title, desc, icon, updatedAt}
//   users/{uid}/wordbooks/{bookId}/chapters/{chapterId} {title, order}
//   users/{uid}/wordbooks/{bookId}/words/{wordId} {en, ja, chapterId, createdAt}
//   users/{uid}/records/{recordId} {date, bookId, chapterId, total, correct, mode}
// 現状の Store.* と同じ入出力に FirestoreAdapter を実装すれば移行可能。

const LS_BOOKS = 'vocaby_wordbooks_v1';
const LS_RECORDS = 'vocaby_records_v1';
// Tango時代のキーから移行（初回のみ）
function migrateKey(newKey, oldKey) {
  try {
    if (!localStorage.getItem(newKey) && localStorage.getItem(oldKey)) {
      localStorage.setItem(newKey, localStorage.getItem(oldKey));
    }
  } catch (e) { console.warn(e); }
}
migrateKey(LS_BOOKS, 'tango_app_wordbooks_v1');
migrateKey(LS_RECORDS, 'tango_app_records_v1');

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
// 「未分類」は実体のない仮想チャプターとして扱う（chapterId=null の単語群）
const UNCAT = '__uncategorized__';

const Store = {
  loadBooks() {
    try {
      const raw = localStorage.getItem(LS_BOOKS);
      if (raw) return JSON.parse(raw);
    } catch (e) { console.warn(e); }
    // 初期サンプル
    const ch1 = uid(), ch2 = uid();
    const sample = [
      { id: uid(), title: 'サンプル: 基礎英単語', desc: '最初に試せる10語', icon: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        chapters: [
          { id: ch1, title: '第1章' },
          { id: ch2, title: '第2章' },
        ], words: [
        { id: uid(), en: 'apple', ja: 'りんご', chapterId: ch1 },
        { id: uid(), en: 'book', ja: '本', chapterId: ch1 },
        { id: uid(), en: 'challenge', ja: '挑戦', chapterId: ch1 },
        { id: uid(), en: 'effort', ja: '努力', chapterId: ch1 },
        { id: uid(), en: 'improve', ja: '改善する', chapterId: ch1 },
        { id: uid(), en: 'knowledge', ja: '知識', chapterId: ch2 },
        { id: uid(), en: 'language', ja: '言語', chapterId: ch2 },
        { id: uid(), en: 'memory', ja: '記憶', chapterId: ch2 },
        { id: uid(), en: 'opportunity', ja: '機会', chapterId: ch2 },
        { id: uid(), en: 'practice', ja: '練習', chapterId: ch2 },
      ]},
    ];
    localStorage.setItem(LS_BOOKS, JSON.stringify(sample));
    return sample;
  },
  saveBooks(books) {
    localStorage.setItem(LS_BOOKS, JSON.stringify(books));
  },
  loadRecords() {
    try {
      return JSON.parse(localStorage.getItem(LS_RECORDS) || '[]');
    } catch (e) { return []; }
  },
  saveRecords(records) {
    localStorage.setItem(LS_RECORDS, JSON.stringify(records));
  },
};

let books = Store.loadBooks();
let records = Store.loadRecords();

// 旧データの形を current に揃える（chapters / chapterId 付与）
function ensureBookShape(b) {
  if (!Array.isArray(b.chapters)) b.chapters = [];
  b.words.forEach(w => {
    if (!('chapterId' in w)) w.chapterId = null;
    if (w.chapterId && !b.chapters.some(c => c.id === w.chapterId)) w.chapterId = null;
  });
  return b;
}
books.forEach(ensureBookShape);

let editingBookId = null;
let detailBookId = null;
let editingWordId = null; // 編集モーダルで編集中の単語ID（null=新規追加）
let editChapterId = null; // 編集モーダルで選択中のチャプターID
let pendingIconData = null; // book-editorで選択中のアイコン画像(dataURL or null)

function bookIconHtml(b, cls) {
  const inner = b.icon
    ? `<img src="${b.icon}" alt="">`
    : '📚';
  return `<div class="${cls}">${inner}</div>`;
}

// ---------- 画面遷移 ----------
const views = ['view-home', 'view-books', 'view-quiz', 'view-records'];
function showView(id) {
  views.forEach(v => document.getElementById(v).classList.toggle('active', v === id));
  document.querySelectorAll('.bottom-nav button').forEach(b =>
    b.classList.toggle('active', b.dataset.view === id));
  if (id === 'view-home') renderHome();
  if (id === 'view-books') renderBooks();
  if (id === 'view-records') renderRecords();
  window.scrollTo(0, 0);
}
document.querySelectorAll('.bottom-nav button').forEach(b =>
  b.addEventListener('click', () => showView(b.dataset.view)));

// ---------- ホーム ----------
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function renderHome() {
  const grid = document.getElementById('home-book-grid');
  grid.innerHTML = books.map(b => `
    <button class="book-tile" data-book="${b.id}">
      ${bookIconHtml(b, 'book-icon')}
      <span class="book-name">${escapeHtml(b.title)}</span>
      <span class="book-count">${b.words.length}語</span>
    </button>`).join('') + `
    <button class="book-tile" id="home-new-tile">
      <div class="book-icon">＋</div>
      <span class="book-name">新規作成</span>
      <span class="book-count">　</span>
    </button>`;
  // アイコンタップ → その単語帳の画面（チャプター一覧）に遷移
  grid.querySelectorAll('[data-book]').forEach(el =>
    el.addEventListener('click', () => {
      showView('view-books');
      openDetail(el.dataset.book);
    }));
  document.getElementById('home-new-tile').addEventListener('click', () => {
  document.getElementById('newbook-modal').classList.remove('hidden');
});
  renderStats();
}
// 今日の学習・累計（記録ページに表示）
function renderStats() {
  const today = records.filter(r => (r.date || '').slice(0, 10) === todayStr());
  const tQ = today.reduce((s, r) => s + r.total, 0);
  const tC = today.reduce((s, r) => s + r.correct, 0);
  document.getElementById('home-today').innerHTML = `
    <div class="stat"><b>${tQ}</b><span>今日の問題数</span></div>
    <div class="stat"><b>${tQ ? Math.round(tC / tQ * 100) : 0}%</b><span>今日の正答率</span></div>
    <div class="stat"><b>${books.reduce((s, b) => s + b.words.length, 0)}</b><span>登録単語数</span></div>`;

  const aQ = records.reduce((s, r) => s + r.total, 0);
  const aC = records.reduce((s, r) => s + r.correct, 0);
  document.getElementById('home-total').innerHTML = `
    <div class="stat"><b>${records.length}</b><span>クイズ回数</span></div>
    <div class="stat"><b>${aQ}</b><span>累計問題数</span></div>
    <div class="stat"><b>${aQ ? Math.round(aC / aQ * 100) : 0}%</b><span>平均正答率</span></div>`;
}
document.getElementById('quiz-setup-start').addEventListener('click', () => {
  showView('view-home');
});

// ---------- 単語帳（選択はホームからのみ。一覧は表示しない） ----------
function hideEditors() {
  ['book-editor'].forEach(id =>
    document.getElementById(id)?.classList.add('hidden'));
}
function renderBooks() {
  hideEditors();
  // 削除済みの選択はリセット
  if (detailBookId && !books.some(b => b.id === detailBookId)) detailBookId = null;
  const empty = !detailBookId;
  document.getElementById('books-empty').classList.toggle('hidden', !empty);
  document.getElementById('word-detail').classList.toggle('hidden', empty);
  if (detailBookId) renderDetail();
}
document.getElementById('books-to-home-btn').addEventListener('click', () => showView('view-home'));

function openNewBook() {
  editingBookId = null;
  detailBookId = null;
  showView('view-books');
  document.getElementById('books-empty').classList.add('hidden');
  document.getElementById('book-editor-title').textContent = '新規単語帳';
  document.getElementById('book-title-input').value = '';
  document.getElementById('book-desc-input').value = '';
  setIconPreview(null);
  document.getElementById('book-editor').classList.remove('hidden');
  document.getElementById('book-editor').scrollIntoView({ behavior: 'smooth' });
}
document.getElementById('book-cancel-btn').addEventListener('click', () => {
  document.getElementById('book-editor').classList.add('hidden');
  renderBooks();
});

// ---------- 単語帳の共有（エクスポート / インポート） ----------
// 形式: { app: 'vocaby', version: 1, exportedAt, book: { title, desc, icon, chapters, words } }
// アイコン画像・チャプター・単語を一冊まるごとJSONファイル化する
document.getElementById('newbook-create-btn').addEventListener('click', () => {
  document.getElementById('newbook-modal').classList.add('hidden');
  openNewBook();
});
document.getElementById('newbook-cancel-btn').addEventListener('click', () => {
  document.getElementById('newbook-modal').classList.add('hidden');
});
document.getElementById('newbook-modal').addEventListener('click', e => {
  if (e.target.id === 'newbook-modal') e.target.classList.add('hidden');
});
document.getElementById('newbook-import-btn').addEventListener('click', () => {
  document.getElementById('import-file-input').click();
});
document.getElementById('import-file-input').addEventListener('change', e => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const nb = buildImportedBook(JSON.parse(reader.result));
      // 同名があれば連番を付与
      const base = nb.title;
      let n = 2;
      while (books.some(b => b.title === nb.title)) nb.title = `${base} ${n++}`;
      books.unshift(nb);
      Store.saveBooks(books);
      document.getElementById('newbook-modal').classList.add('hidden');
      showView('view-books');
      openDetail(nb.id);
      alert(`「${nb.title}」をインポートしました（${nb.words.length}語・${nb.chapters.length}チャプター）`);
    } catch (err) {
      alert('インポートできませんでした。正しい単語帳ファイルを選んでください。');
    }
  };
  reader.onerror = () => alert('ファイルを読み込めませんでした');
  reader.readAsText(file);
});
function buildImportedBook(data) {
  const src = data && data.book ? data.book : data;
  if (!src || typeof src.title !== 'string' || !src.title.trim() || !Array.isArray(src.words)) {
    throw new Error('bad format');
  }
  const chapMap = {};
  const chapters = (Array.isArray(src.chapters) ? src.chapters : [])
    .filter(c => c && typeof c.title === 'string' && c.title.trim())
    .map(c => {
      const nid = uid();
      chapMap[c.id] = nid;
      return { id: nid, title: String(c.title).trim().slice(0, 50) };
    });
  const words = src.words
    .filter(w => w && w.en != null && w.ja != null && String(w.en).trim() && String(w.ja).trim())
    .map(w => ({
      id: uid(),
      en: String(w.en).trim().slice(0, 100),
      ja: String(w.ja).trim().slice(0, 100),
      chapterId: chapMap[w.chapterId] || null,
    }));
  const now = new Date().toISOString();
  return {
    id: uid(),
    title: String(src.title).trim().slice(0, 50),
    desc: typeof src.desc === 'string' ? src.desc.slice(0, 100) : '',
    icon: (typeof src.icon === 'string' && src.icon.startsWith('data:image')) ? src.icon : null,
    chapters,
    words,
    createdAt: now,
    updatedAt: now,
  };
}
document.getElementById('book-share-btn').addEventListener('click', () => {
  const b = books.find(x => x.id === detailBookId);
  if (!b) return;
  const payload = {
    app: 'vocaby',
    version: 1,
    exportedAt: new Date().toISOString(),
    book: { title: b.title, desc: b.desc || '', icon: b.icon || null, chapters: b.chapters || [], words: b.words },
  };
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'vocaby-' + (b.title || 'book').replace(/[\\/:*?"<>|]/g, '_').slice(0, 40) + '.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
document.getElementById('book-save-btn').addEventListener('click', () => {
  const title = document.getElementById('book-title-input').value.trim();
  const desc = document.getElementById('book-desc-input').value.trim();
  if (!title) { alert('タイトルを入力してください'); return; }
  if (editingBookId) {
    const b = books.find(x => x.id === editingBookId);
    b.title = title; b.desc = desc; b.icon = pendingIconData; b.updatedAt = new Date().toISOString();
    detailBookId = b.id;
  } else {
    const nb = { id: uid(), title, desc, icon: pendingIconData, chapters: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), words: [] };
    books.unshift(nb);
    detailBookId = nb.id;
  }
  Store.saveBooks(books);
  document.getElementById('book-editor').classList.add('hidden');
  renderBooks(); renderHome();
});

// ---------- 単語帳アイコン（画像アップロード） ----------
// 画像は長辺1024pxに縮小してdataURL保存（バナー表示でも荒くならない解像度を確保）
function readDownscaledImage(file, cb) {
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const MAX = 1024;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      cb(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => alert('画像を読み込めませんでした');
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}
function setIconPreview(dataUrl) {
  pendingIconData = dataUrl || null;
  const img = document.getElementById('book-icon-preview');
  const clearBtn = document.getElementById('book-icon-clear-btn');
  const fileInput = document.getElementById('book-icon-input');
  if (pendingIconData) {
    img.src = pendingIconData;
    img.classList.remove('hidden');
    clearBtn.classList.remove('hidden');
  } else {
    img.removeAttribute('src');
    img.classList.add('hidden');
    clearBtn.classList.add('hidden');
    if (fileInput) fileInput.value = '';
  }
}
document.getElementById('book-icon-input').addEventListener('change', e => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { alert('画像ファイルを選んでください'); return; }
  readDownscaledImage(file, setIconPreview);
});
document.getElementById('book-icon-clear-btn').addEventListener('click', () => setIconPreview(null));

function openDetail(id) {
  detailBookId = id;
  hideEditors();
  document.getElementById('books-empty').classList.add('hidden');
  document.getElementById('word-detail').classList.remove('hidden');
  renderDetail();
  document.getElementById('word-detail').scrollIntoView({ behavior: 'smooth' });
}
function chapterOf(b, id) {
  return (b.chapters || []).find(c => c.id === id) || null;
}
function chapterWords(b, chapterId) {
  if (!chapterId) return [...b.words];
  if (chapterId === UNCAT) return b.words.filter(w => !w.chapterId || !chapterOf(b, w.chapterId));
  return b.words.filter(w => w.chapterId === chapterId);
}
function uncatWords(b) {
  return chapterWords(b, UNCAT);
}
function renderChapters() {
  const b = books.find(x => x.id === detailBookId);
  if (!b) return;
  const el = document.getElementById('chapter-list');
  const rowHtml = (key, title, words) => `
    <div class="list-item word-row chapter-row" data-chquiz="${key}">
      <div class="w"><div class="title">${title}</div></div>
      <div class="chap-actions"><button class="count-btn" data-chwords="${key}">${words.length}語</button></div>
    </div>`;
  el.innerHTML = rowHtml('', '📖 すべて', b.words) +
    (b.chapters || []).map(c => rowHtml(c.id, escapeHtml(c.title), b.words.filter(w => w.chapterId === c.id))).join('') +
    rowHtml(UNCAT, '未分類', uncatWords(b));
  // 行タップ → 出題設定モーダル
  el.querySelectorAll('[data-chquiz]').forEach(node =>
    node.addEventListener('click', e => {
      e.stopPropagation();
      openQuizModal(detailBookId, node.dataset.chquiz || null);
    }));
  // 語数ボタンタップ → 単語一覧モーダル
  el.querySelectorAll('[data-chwords]').forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation();
    openWordsModal(btn.dataset.chwords || null);
  }));
}
// 単語一覧モーダル（表示専用）
function openWordsModal(chapterId) {
  const b = books.find(x => x.id === detailBookId);
  if (!b) return;
  const cid = chapterId || null;
  const isUncat = cid === UNCAT;
  const ch = (!isUncat && cid) ? chapterOf(b, cid) : null;
  const words = cid ? chapterWords(b, cid) : [...b.words];
  document.getElementById('words-modal-title').textContent = isUncat ? '未分類' : (ch ? ch.title : `${b.title}（すべて）`);
  document.getElementById('words-modal-sub').textContent = `${words.length}語`;
  document.getElementById('words-modal-list').innerHTML = words.map(w => `
    <div class="list-item"><div class="en">${escapeHtml(w.en)}</div><div class="ja">${escapeHtml(w.ja)}</div></div>`).join('')
    || '<p class="muted">単語がありません。</p>';
  document.getElementById('words-modal').classList.remove('hidden');
}
document.getElementById('words-modal-close-btn').addEventListener('click', () => {
  document.getElementById('words-modal').classList.add('hidden');
});
document.getElementById('words-modal').addEventListener('click', e => {
  if (e.target.id === 'words-modal') e.target.classList.add('hidden');
});
function renderDetail() {
  const b = books.find(x => x.id === detailBookId);
  if (!b) { document.getElementById('word-detail').classList.add('hidden'); return; }
  ensureBookShape(b);
  document.getElementById('word-detail-title').textContent = b.title;
  document.getElementById('word-detail-desc').textContent = `${b.desc || ''}（${b.words.length}語・${(b.chapters || []).length}チャプター）`;
  const banner = document.getElementById('word-detail-banner');
  if (b.icon) {
    document.getElementById('word-detail-banner-img').src = b.icon;
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }
  renderChapters();
}
document.getElementById('edit-book-delete-btn').addEventListener('click', () => {
  const b = books.find(x => x.id === detailBookId);
  if (!b) return;
  if (!confirm(`「${b.title}」を削除しますか？`)) return;
  books = books.filter(x => x.id !== detailBookId);
  Store.saveBooks(books);
  detailBookId = null;
  document.getElementById('edit-modal').classList.add('hidden');
  renderBooks();
  renderHome();
});
// ---------- 編集モーダル ----------
// 構成: 単語帳設定 → チャプター一覧 → チャプター詳細（名前・単語の編集）。
// 単語の編集・削除はすべてこのモーダル内で行う。
function showEditView(id) {
  ['edit-view-main', 'edit-view-chapter', 'edit-view-bulk'].forEach(s =>
    document.getElementById(s).classList.toggle('hidden', s !== id));
}
function openEditModal() {
  const b = books.find(x => x.id === detailBookId);
  if (!b) return;
  document.getElementById('edit-book-title').value = b.title;
  document.getElementById('edit-book-desc').value = b.desc || '';
  setEditIconPreview(b.icon || null);
  renderEditChapterList();
  showEditView('edit-view-main');
  document.getElementById('edit-modal').classList.remove('hidden');
}
function closeEditModal() {
  document.getElementById('edit-modal').classList.add('hidden');
  renderDetail();
}
document.getElementById('word-edit-btn').addEventListener('click', openEditModal);
document.getElementById('edit-modal-close-btn').addEventListener('click', closeEditModal);
document.getElementById('edit-modal').addEventListener('click', e => {
  if (e.target.id === 'edit-modal') closeEditModal();
});

// 単語帳設定（名前・説明・表紙画像）
let editIconData = null;
function setEditIconPreview(dataUrl) {
  editIconData = dataUrl || null;
  const img = document.getElementById('edit-book-icon-preview');
  const clearBtn = document.getElementById('edit-book-icon-clear-btn');
  const fileInput = document.getElementById('edit-book-icon-input');
  if (editIconData) {
    img.src = editIconData;
    img.classList.remove('hidden');
    clearBtn.classList.remove('hidden');
  } else {
    img.removeAttribute('src');
    img.classList.add('hidden');
    clearBtn.classList.add('hidden');
    if (fileInput) fileInput.value = '';
  }
}
document.getElementById('edit-book-icon-input').addEventListener('change', e => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { alert('画像ファイルを選んでください'); return; }
  readDownscaledImage(file, setEditIconPreview);
});
document.getElementById('edit-book-icon-clear-btn').addEventListener('click', () => setEditIconPreview(null));
document.getElementById('edit-book-save-btn').addEventListener('click', () => {
  const b = books.find(x => x.id === detailBookId);
  if (!b) return;
  const title = document.getElementById('edit-book-title').value.trim();
  if (!title) { alert('単語帳名を入力してください'); return; }
  b.title = title;
  b.desc = document.getElementById('edit-book-desc').value.trim();
  b.icon = editIconData;
  b.updatedAt = new Date().toISOString();
  Store.saveBooks(books);
  renderDetail();
  alert('保存しました');
});

// チャプター一覧（モーダル内。タップで詳細へ）
function renderEditChapterList() {
  const b = books.find(x => x.id === detailBookId);
  if (!b) return;
  const el = document.getElementById('edit-chapter-list');
  el.innerHTML = (b.chapters || []).map(c => {
    const n = b.words.filter(w => w.chapterId === c.id).length;
    return `<div class="list-item word-row chapter-row" data-ec="${c.id}">
      <div class="w">
        <div class="title">${escapeHtml(c.title)}</div>
        <div><span class="chap-count">${n}語</span></div>
      </div>
      <span class="muted">›</span>
    </div>`;
  }).join('') + `<div class="list-item word-row chapter-row" data-ec="${UNCAT}">
      <div class="w">
        <div class="title">未分類</div>
        <div><span class="chap-count">${uncatWords(b).length}語</span></div>
      </div>
      <span class="muted">›</span>
    </div>`;
  el.querySelectorAll('[data-ec]').forEach(node =>
    node.addEventListener('click', () => openEditChapter(node.dataset.ec)));
}
document.getElementById('edit-chapter-new-btn').addEventListener('click', () => {
  const b = books.find(x => x.id === detailBookId);
  if (!b) return;
  const nc = { id: uid(), title: '新しいチャプター' };
  b.chapters.push(nc);
  b.updatedAt = new Date().toISOString();
  Store.saveBooks(books);
  renderDetail();
  openEditChapter(nc.id);
});

// チャプター詳細（名前編集＋単語の編集・追加・削除）
function openEditChapter(cid) {
  const b = books.find(x => x.id === detailBookId);
  if (!b) return;
  const isUncat = cid === UNCAT;
  const c = isUncat ? null : chapterOf(b, cid);
  if (!isUncat && !c) return;
  editChapterId = cid;
  resetEditWordForm();
  document.getElementById('edit-chapter-name-input').value = isUncat ? '未分類' : c.title;
  document.getElementById('edit-chapter-name-input').disabled = isUncat;
  document.getElementById('edit-chapter-name-save-row').classList.toggle('hidden', isUncat);
  document.getElementById('edit-chapter-delete-row').classList.toggle('hidden', isUncat);
  refreshMoveSelect();
  renderEditWordList();
  showEditView('edit-view-chapter');
}
document.getElementById('edit-chapter-back-btn').addEventListener('click', () => {
  renderEditChapterList();
  showEditView('edit-view-main');
  renderDetail();
});
document.getElementById('edit-chapter-name-save-btn').addEventListener('click', () => {
  const b = books.find(x => x.id === detailBookId);
  const c = b && chapterOf(b, editChapterId);
  if (!c) return;
  const title = document.getElementById('edit-chapter-name-input').value.trim();
  if (!title) { alert('チャプター名を入力してください'); return; }
  c.title = title;
  b.updatedAt = new Date().toISOString();
  Store.saveBooks(books);
  renderDetail();
  refreshMoveSelect();
});
function resetEditWordForm() {
  editingWordId = null;
  document.getElementById('edit-word-en').value = '';
  document.getElementById('edit-word-ja').value = '';
  document.getElementById('edit-word-save-btn').textContent = '追加';
  document.getElementById('edit-word-form').classList.add('hidden');
}
document.getElementById('edit-word-new-btn').addEventListener('click', () => {
  resetEditWordForm();
  document.getElementById('edit-word-form').classList.remove('hidden');
  setTimeout(() => document.getElementById('edit-word-en').focus(), 50);
});
function renderEditWordList() {
  const b = books.find(x => x.id === detailBookId);
  if (!b) return;
  const words = chapterWords(b, editChapterId);
  const el = document.getElementById('edit-word-list');
  el.innerHTML = words.map(w => `
    <div class="list-item word-row">
      <input type="checkbox" class="word-check" value="${w.id}" aria-label="選択">
      <div class="w"><div class="en">${escapeHtml(w.en)}</div><div class="ja">${escapeHtml(w.ja)}</div></div>
      <button class="icon-btn" data-ewedit="${w.id}" aria-label="編集">✏️</button>
      <button class="icon-btn del" data-ewdel="${w.id}" aria-label="削除">🗑️</button>
    </div>`).join('') || '<p class="muted">単語がありません。下のフォームから追加してください。</p>';
  el.querySelectorAll('[data-ewdel]').forEach(node => node.addEventListener('click', () => {
    if (!confirm('削除しますか？')) return;
    b.words = b.words.filter(w => w.id !== node.dataset.ewdel);
    if (editingWordId === node.dataset.ewdel) resetEditWordForm();
    b.updatedAt = new Date().toISOString();
    Store.saveBooks(books);
    renderDetail();
    renderEditWordList();
  }));
  el.querySelectorAll('[data-ewedit]').forEach(node => node.addEventListener('click', () => {
    const w = b.words.find(x => x.id === node.dataset.ewedit);
    editingWordId = w.id;
    document.getElementById('edit-word-en').value = w.en;
    document.getElementById('edit-word-ja').value = w.ja;
    document.getElementById('edit-word-save-btn').textContent = '保存';
    document.getElementById('edit-word-form').classList.remove('hidden');
  }));
  refreshMoveBox();
}
function refreshMoveBox() {
  const n = document.querySelectorAll('#edit-word-list .word-check:checked').length;
  document.getElementById('edit-move-box').classList.toggle('hidden', n === 0);
}
document.getElementById('edit-word-list').addEventListener('change', e => {
  if (e.target.classList && e.target.classList.contains('word-check')) refreshMoveBox();
});
document.getElementById('edit-word-save-btn').addEventListener('click', () => {
  const b = books.find(x => x.id === detailBookId);
  if (!b) return;
  const en = document.getElementById('edit-word-en').value.trim();
  const ja = document.getElementById('edit-word-ja').value.trim();
  if (!en || !ja) { alert('英語と日本語の両方を入力してください'); return; }
  if (editingWordId) {
    const w = b.words.find(x => x.id === editingWordId);
    w.en = en; w.ja = ja;
  } else {
    b.words.push({ id: uid(), en, ja, chapterId: editChapterId === UNCAT ? null : editChapterId });
  }
  b.updatedAt = new Date().toISOString();
  Store.saveBooks(books);
  renderDetail();
  renderEditWordList();
  resetEditWordForm();
});
// 選択した単語を他のチャプターへ移動
function refreshMoveSelect() {
  const b = books.find(x => x.id === detailBookId);
  if (!b) return;
  const sel = document.getElementById('edit-move-select');
  const cur = sel.value;
  sel.innerHTML = (b.chapters || []).map(c => `<option value="${c.id}">${escapeHtml(c.title)}</option>`).join('')
    + `<option value="${UNCAT}">未分類</option>`;
  if ([...sel.options].some(o => o.value === cur)) sel.value = cur;
}
document.getElementById('edit-move-btn').addEventListener('click', () => {
  const b = books.find(x => x.id === detailBookId);
  if (!b) return;
  const checked = [...document.querySelectorAll('#edit-word-list .word-check:checked')].map(cb => cb.value);
  if (!checked.length) { alert('移動する単語にチェックを入れてください'); return; }
  const dest = document.getElementById('edit-move-select').value;
  const destId = dest === UNCAT ? null : dest;
  b.words.forEach(w => { if (checked.includes(w.id)) w.chapterId = destId; });
  b.updatedAt = new Date().toISOString();
  Store.saveBooks(books);
  resetEditWordForm();
  renderDetail();
  renderEditWordList();
});
document.getElementById('edit-chapter-delete-btn').addEventListener('click', () => {
  const b = books.find(x => x.id === detailBookId);
  const c = b && chapterOf(b, editChapterId);
  if (!c) return;
  if (!confirm(`「${c.title}」を削除しますか？中の単語は「未分類」に移動します。`)) return;
  b.words.forEach(w => { if (w.chapterId === c.id) w.chapterId = null; });
  b.chapters = b.chapters.filter(x => x.id !== c.id);
  b.updatedAt = new Date().toISOString();
  Store.saveBooks(books);
  renderDetail();
  renderEditChapterList();
  showEditView('edit-view-main');
});
document.getElementById('edit-bulk-go-btn').addEventListener('click', () => {
  document.getElementById('edit-bulk-text').value = '';
  document.getElementById('edit-bulk-preview').textContent = '';
  showEditView('edit-view-bulk');
});
document.getElementById('edit-bulk-text').addEventListener('input', e => {
  const { ok, ng } = parseBulkText(e.target.value);
  document.getElementById('edit-bulk-preview').textContent =
    `${ok.length}件 取り込み可能` + (ng.length ? ` ／ ${ng.length}行 解析不可` : '');
});
document.getElementById('edit-bulk-add-btn').addEventListener('click', () => {
  const b = books.find(x => x.id === detailBookId);
  if (!b) return;
  const { ok, ng } = parseBulkText(document.getElementById('edit-bulk-text').value);
  if (!ok.length) { alert('取り込める行がありません。形式を確認してください。'); return; }
  ok.forEach(w => { w.chapterId = null; }); // 一括追加は未分類へ
  const existing = new Set(b.words.map(w => w.en.trim().toLowerCase()));
  const seen = new Set();
  const fresh = ok.filter(w => {
    const k = w.en.trim().toLowerCase();
    if (existing.has(k) || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const skipped = ok.length - fresh.length;
  const CHUNK = 1000;
  for (let i = 0; i < fresh.length; i += CHUNK) {
    b.words.push(...fresh.slice(i, i + CHUNK));
  }
  b.updatedAt = new Date().toISOString();
  Store.saveBooks(books);
  document.getElementById('edit-bulk-text').value = '';
  document.getElementById('edit-bulk-preview').textContent = '';
  renderDetail();
  alert(`${fresh.length}件 追加しました（未分類）` +
    (skipped ? `（重複 ${skipped}件スキップ）` : '') +
    (ng.length ? `（解析不可 ${ng.length}行あり）` : ''));
});
document.getElementById('edit-bulk-back-btn').addEventListener('click', () => {
  renderEditChapterList();
  showEditView('edit-view-main');
});

// ---------- 一括追加（コピペ・数千語対応） ----------
// 対応形式（1行1語、区切り自動判定）:
//   TAB / カンマ / セミコロン / ":" / "=" / "|" / 全角スペース・半角スペース
// 例: "apple\tりんご" / "book,本" / "run 走る"
// Firestore移行時は 500件ずつ writeBatch で分割書き込みすること（上限対策）。
function parseBulkText(text) {
  const lines = String(text || '').split(/\r?\n/);
  const ok = [];
  const ng = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/^#/.test(line)) continue; // コメント行
    let en = '', ja = '';
    let parts = null;
    if (line.includes('\t')) parts = line.split('\t');
    else if (line.includes(',')) parts = line.split(',');
    else if (line.includes(';')) parts = line.split(';');
    else if (line.includes('：') || line.includes(':')) parts = line.split(/[:：]/);
    else if (line.includes('=')) parts = line.split('=');
    else if (line.includes('|')) parts = line.split('|');
    else if (line.includes('　')) parts = line.split('　');
    if (parts && parts.length >= 2) {
      en = parts[0].trim();
      ja = parts.slice(1).join(' ').trim();
    } else {
      // スペース区切り: 先頭の英字トークンを英語、残りを日本語とみなす
      const m = line.match(/^([A-Za-z][A-Za-z\-' ]*?)\s+(.+)$/);
      if (m) { en = m[1].trim(); ja = m[2].trim(); }
    }
    // 前後のクォート除去
    en = en.replace(/^["「']|["」']$/g, '').trim();
    ja = ja.replace(/^["「']|["」']$/g, '').trim();
    if (en && ja) ok.push({ id: uid(), en, ja });
    else ng.push(raw);
  }
  return { ok, ng };
}

// ---------- 出題設定モーダル（チャプター選択後に中央表示） ----------
let quizTarget = { bookId: null, chapterId: null };
function openQuizModal(bookId, chapterId) {
  const b = books.find(x => x.id === bookId);
  if (!b) return;
  const cid = chapterId || null;
  const isUncat = cid === UNCAT;
  const ch = (!isUncat && cid) ? chapterOf(b, cid) : null;
  const title = isUncat ? '未分類' : (ch ? ch.title : null);
  const n = chapterWords(b, cid).length;
  if (!n) {
    alert(title ? 'このチャプターに単語がありません' : 'この単語帳に単語がありません');
    return;
  }
  quizTarget = { bookId, chapterId: cid };
  document.getElementById('quiz-modal-title').textContent = title || `${b.title}（すべて）`;
  document.getElementById('quiz-modal-sub').textContent = `${b.title}・${n}語`;
  document.getElementById('quiz-modal').classList.remove('hidden');
}
function closeQuizModal() {
  document.getElementById('quiz-modal').classList.add('hidden');
}
document.getElementById('qs-cancel-btn').addEventListener('click', closeQuizModal);
document.getElementById('quiz-modal').addEventListener('click', e => {
  if (e.target.id === 'quiz-modal') closeQuizModal();
});
document.getElementById('qs-start-btn').addEventListener('click', () => {
  const mode = document.getElementById('qs-mode-select').value;
  const format = document.getElementById('qs-format-select').value;
  const count = parseInt(document.getElementById('qs-count-select').value, 10);
  const shuffle = document.getElementById('qs-shuffle-check').checked;
  closeQuizModal();
  startQuiz(quizTarget.bookId, { chapterId: quizTarget.chapterId, mode, format, count, shuffle });
});

// ---------- クイズ（一問一答 / 4択） ----------
let quiz = null;

function shuffleArr(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function normalizeEn(s) { return (s || '').trim().toLowerCase(); }
function normalizeJa(s) { return (s || '').trim().replace(/\s+/g, ''); }

function startQuiz(bookId, { chapterId = null, mode = 'en-ja', format = 'input', count = 10, shuffle = true } = {}) {
  const b = books.find(x => x.id === bookId);
  if (!b) { alert('単語帳を選択してください'); return; }
  const isUncat = chapterId === UNCAT;
  const ch = (!isUncat && chapterId) ? chapterOf(b, chapterId) : null;
  const chapterTitle = isUncat ? '未分類' : (ch ? ch.title : null);
  let words = chapterWords(b, chapterId);
  if (!words.length) { alert(chapterTitle ? 'このチャプターに単語がありません' : 'この単語帳に単語がありません'); return; }
  if (format === 'choice' && words.length < 2 && b.words.length < 2) { alert('4択には2語以上必要です'); return; }
  if (shuffle) words = shuffleArr([...words]);
  if (count > 0) words = words.slice(0, count);
  // 4択の誤答候補は出題範囲優先、足りなければ帳全体→全帳から補充
  const pool = words.length >= 4 ? words
    : b.words.length >= 4 ? b.words
    : [...b.words, ...books.flatMap(x => x.id === b.id ? [] : x.words)];
  quiz = {
    bookId: b.id, bookTitle: b.title, chapterId, chapterTitle, mode, format,
    questions: words.map(w => {
      let dir = mode;
      if (mode === 'random') dir = Math.random() < 0.5 ? 'en-ja' : 'ja-en';
      const q = { wordId: w.id, dir, en: w.en, ja: w.ja, user: '', correct: false, gaveUp: false, choices: [], answerIndex: 0 };
      if (format === 'choice') {
        const correctText = dir === 'en-ja' ? w.ja : w.en;
        const distract = shuffleArr(pool.filter(x => (dir === 'en-ja' ? x.ja : x.en) !== correctText))
          .slice(0, 3).map(x => (dir === 'en-ja' ? x.ja : x.en));
        // プール不足時は「(選択肢不足)」で埋めず、重複なしの範囲で出題
        const set = [correctText, ...distract];
        q.choices = shuffleArr([...new Set(set)]);
        q.answerIndex = q.choices.indexOf(correctText);
      }
      return q;
    }),
    index: 0,
  };
  showView('view-quiz');
  document.getElementById('quiz-setup').classList.add('hidden');
  document.getElementById('quiz-result').classList.add('hidden');
  document.getElementById('quiz-play').classList.remove('hidden');
  renderQuestion();
  setTimeout(() => document.getElementById('quiz-answer-input').focus(), 100);
}

function currentQ() { return quiz.questions[quiz.index]; }

function renderQuestion() {
  const q = currentQ();
  document.getElementById('quiz-progress-text').textContent = `${quiz.index + 1} / ${quiz.questions.length}`;
  document.getElementById('quiz-progress-bar').style.width = `${quiz.index / quiz.questions.length * 100}%`;
  document.getElementById('quiz-book-name').textContent =
    `${quiz.bookTitle}${quiz.chapterTitle ? ' / ' + quiz.chapterTitle : ''}・${quiz.format === 'choice' ? '4択' : '入力'}`;
  const isEnJa = q.dir === 'en-ja';
  document.getElementById('quiz-question').textContent = isEnJa ? q.en : q.ja;
  document.getElementById('quiz-hint').textContent = isEnJa ? '日本語で答えてください' : '英語で答えてください';

  const inputArea = document.getElementById('quiz-input-area');
  const choiceArea = document.getElementById('quiz-choice-area');
  const isChoice = quiz.format === 'choice';
  inputArea.classList.toggle('hidden', isChoice);
  choiceArea.classList.toggle('hidden', !isChoice);

  document.getElementById('quiz-feedback').classList.add('hidden');
  document.getElementById('quiz-next-btn').classList.add('hidden');

  if (isChoice) {
    choiceArea.innerHTML = q.choices.map((c, i) =>
      `<button class="choice-btn" data-i="${i}"><span class="num">${i + 1}</span><span>${escapeHtml(c)}</span></button>`).join('');
    choiceArea.querySelectorAll('.choice-btn').forEach(btn =>
      btn.addEventListener('click', () => answerChoice(parseInt(btn.dataset.i, 10))));
  } else {
    document.getElementById('quiz-answer-input').placeholder = isEnJa ? '日本語で入力' : '英語で入力';
    document.getElementById('quiz-answer-input').value = '';
    document.getElementById('quiz-answer-btn').classList.remove('hidden');
  }
}

function judge(q, userInput) {
  if (q.dir === 'en-ja') return normalizeJa(userInput) === normalizeJa(q.ja);
  return normalizeEn(userInput) === normalizeEn(q.en);
}
function answerCurrent(gaveUp = false) {
  const q = currentQ();
  const input = document.getElementById('quiz-answer-input').value;
  q.user = input;
  q.gaveUp = gaveUp;
  q.correct = !gaveUp && judge(q, input);
  showFeedback(q);
  document.getElementById('quiz-answer-btn').classList.add('hidden');
}
function showFeedback(q) {
  const fb = document.getElementById('quiz-feedback');
  const correctAns = q.dir === 'en-ja' ? q.ja : q.en;
  fb.classList.remove('hidden', 'ok', 'ng');
  fb.classList.add(q.correct ? 'ok' : 'ng');
  fb.innerHTML = q.correct
    ? `⭕ 正解！`
    : `❌ 不正解… 正解は <span class="answer">${escapeHtml(correctAns)}</span>${q.user ? `<br>あなたの回答: ${escapeHtml(q.user)}` : ''}`;
  document.getElementById('quiz-next-btn').textContent =
    quiz.index + 1 >= quiz.questions.length ? '結果を見る' : '次の問題へ';
  document.getElementById('quiz-next-btn').classList.remove('hidden');
}
function answerChoice(i) {
  const q = currentQ();
  q.user = q.choices[i] ?? '';
  q.correct = i === q.answerIndex;
  q.gaveUp = false;
  document.querySelectorAll('#quiz-choice-area .choice-btn').forEach((btn, bi) => {
    btn.disabled = true;
    if (bi === q.answerIndex) btn.classList.add('correct');
    else if (bi === i) btn.classList.add('wrong');
  });
  showFeedback(q);
}
document.getElementById('quiz-answer-btn').addEventListener('click', () => answerCurrent(false));
document.getElementById('quiz-giveup-btn').addEventListener('click', () => answerCurrent(true));
document.getElementById('quiz-answer-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    if (!document.getElementById('quiz-answer-btn').classList.contains('hidden')) answerCurrent(false);
    else document.getElementById('quiz-next-btn').click();
  }
});
document.getElementById('quiz-next-btn').addEventListener('click', () => {
  quiz.index++;
  if (quiz.index >= quiz.questions.length) finishQuiz();
  else renderQuestion();
});
document.getElementById('quiz-quit-btn').addEventListener('click', () => {
  if (!confirm('クイズを中断しますか？記録は保存されません。')) return;
  quiz = null;
  document.getElementById('quiz-play').classList.add('hidden');
  document.getElementById('quiz-setup').classList.remove('hidden');
  showView('view-home');
});

function finishQuiz() {
  const correct = quiz.questions.filter(q => q.correct).length;
  const total = quiz.questions.length;
  const rec = {
    id: uid(),
    date: new Date().toISOString(),
    wordbookId: quiz.bookId,
    wordbookTitle: quiz.bookTitle,
    chapterId: quiz.chapterId,
    chapterTitle: quiz.chapterTitle,
    mode: quiz.mode,
    format: quiz.format,
    total, correct,
    accuracy: total ? Math.round(correct / total * 100) : 0,
  };
  records.unshift(rec);
  Store.saveRecords(records);

  document.getElementById('quiz-play').classList.add('hidden');
  const res = document.getElementById('quiz-result');
  res.classList.remove('hidden');
  document.getElementById('quiz-result-summary').innerHTML = `
    <div class="stat"><b>${correct}/${total}</b><span>正解数</span></div>
    <div class="stat"><b>${rec.accuracy}%</b><span>正答率</span></div>
    <div class="stat"><b>${escapeHtml(quiz.chapterTitle || quiz.bookTitle)}</b><span>範囲</span></div>`;
  document.getElementById('quiz-result-list').innerHTML = quiz.questions.map(q => `
    <div class="list-item">
      <span class="${q.correct ? 'result-ok' : 'result-ng'}">${q.correct ? '⭕' : '❌'}</span>
      <b>${escapeHtml(q.en)}</b> — ${escapeHtml(q.ja)}
      ${q.correct ? '' : `<br><span class="muted">回答: ${escapeHtml(q.user || '(無回答/ギブアップ)')}</span>`}
    </div>`).join('');
  document.getElementById('quiz-progress-bar').style.width = '100%';
}
document.getElementById('quiz-retry-btn').addEventListener('click', () => {
  if (quiz) startQuiz(quiz.bookId, { chapterId: quiz.chapterId, mode: quiz.mode, format: quiz.format, count: quiz.questions.length, shuffle: true });
});
document.getElementById('quiz-to-home-btn').addEventListener('click', () => {
  document.getElementById('quiz-result').classList.add('hidden');
  document.getElementById('quiz-setup').classList.remove('hidden');
  showView('view-home');
});

// ---------- 記録 ----------
function localDayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function last7Days() {
  const days = [];
  const today = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    days.push({ key: localDayKey(d), label: `${d.getMonth() + 1}/${d.getDate()}`, isToday: i === 0 });
  }
  return days;
}
// 縦軸最大値を記録の最大値に合わせてキリよく切り上げ
function niceCeil(v) {
  if (v <= 5) return v;
  if (v <= 10) return 10;
  if (v <= 20) return Math.ceil(v / 5) * 5;
  if (v <= 100) return Math.ceil(v / 10) * 10;
  return Math.ceil(v / 50) * 50;
}
function drawWeekChart() {
  const canvas = document.getElementById('week-chart');
  if (!canvas) return;
  const days = last7Days();
  const byDay = {};
  records.forEach(r => {
    const k = localDayKey(new Date(r.date));
    byDay[k] = (byDay[k] || 0) + (r.total || 0);
  });
  const values = days.map(d => byDay[d.key] || 0);
  const maxVal = Math.max(...values, 0);
  const yMax = maxVal <= 0 ? 10 : niceCeil(maxVal); // 記録なし時は既定10、あれば最大値に追従

  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || canvas.parentElement.clientWidth || 320;
  const H = 200;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  const padL = 32, padR = 8, padT = 18, padB = 28;
  const cw = W - padL - padR, ch = H - padT - padB;
  const STEPS = 4;

  ctx.font = '11px sans-serif';
  // グリッド＋Y軸
  for (let i = 0; i <= STEPS; i++) {
    const v = Math.round(yMax * i / STEPS);
    const y = padT + ch - (ch * i / STEPS);
    ctx.strokeStyle = '#e2e8f0';
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
    ctx.fillStyle = '#64748b';
    ctx.textAlign = 'right';
    ctx.fillText(String(v), padL - 4, y + 4);
  }
  // バー
  const slot = cw / 7;
  const barW = Math.min(34, slot * 0.55);
  values.forEach((v, i) => {
    const x = padL + slot * i + (slot - barW) / 2;
    const h = yMax > 0 ? Math.round(ch * v / yMax) : 0;
    const y = padT + ch - h;
    ctx.fillStyle = days[i].isToday ? '#4f46e5' : '#93a4f5';
    if (h > 0) {
      if (ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(x, y, barW, h, [4, 4, 0, 0]);
        ctx.fill();
      } else {
        ctx.fillRect(x, y, barW, h);
      }
      ctx.fillStyle = '#1e293b';
      ctx.textAlign = 'center';
      ctx.fillText(String(v), x + barW / 2, y - 4);
    }
    ctx.fillStyle = days[i].isToday ? '#4f46e5' : '#64748b';
    ctx.textAlign = 'center';
    ctx.fillText(days[i].label + (days[i].isToday ? '(今)' : ''), padL + slot * i + slot / 2, H - 10);
  });

  document.getElementById('week-chart-note').textContent =
    maxVal <= 0 ? 'まだ記録がありません。クイズを解くとここに表示されます。'
    : `最大 ${maxVal}問/日（縦軸は最大値に自動調整: 0〜${yMax}）`;
}
let _chartTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(_chartTimer);
  _chartTimer = setTimeout(() => {
    if (document.getElementById('view-records').classList.contains('active')) drawWeekChart();
  }, 150);
});
function renderRecords() {
  const sum = document.getElementById('records-summary');
  const total = records.reduce((s, r) => s + r.total, 0);
  const correct = records.reduce((s, r) => s + r.correct, 0);
  sum.innerHTML = `<b>${records.length}回</b> のクイズ ・ <b>${total}問</b> 中 <b>${correct}問</b> 正解（平均 ${total ? Math.round(correct / total * 100) : 0}%）`;
  const list = document.getElementById('records-list');
  const modeLabel = m => m === 'en-ja' ? '英→日' : m === 'ja-en' ? '日→英' : 'ランダム';
  const fmtLabel = f => f === 'choice' ? '4択' : f === 'input' ? '入力' : '';
  list.innerHTML = records.map(r => `
    <div class="list-item">
      <div class="title">${escapeHtml(r.wordbookTitle)}${r.chapterTitle ? ' / ' + escapeHtml(r.chapterTitle) : ''} <span class="muted">${modeLabel(r.mode)} ${fmtLabel(r.format)}</span></div>
      <div>${r.correct}/${r.total}（${r.accuracy}%）</div>
      <div class="muted">${new Date(r.date).toLocaleString('ja-JP')}</div>
    </div>`).join('') || '<p class="muted">まだ記録がありません。</p>';
  renderStats();
  drawWeekChart();
}
document.getElementById('records-clear-btn').addEventListener('click', () => {
  if (!confirm('全ての学習記録を削除しますか？')) return;
  records = [];
  Store.saveRecords(records);
  renderRecords(); renderHome();
});

// ---------- util ----------
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// init
renderHome();
renderBooks();
renderRecords();
