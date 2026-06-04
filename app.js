let vocabData = [];
let wrongAnswers = [];
let currentQIndex = 0;
let isAnswered = false;
let gameMode = 'quiz';
let currentFile = '';

// ── localStorage：分數 ────────────────────────────────────────

const SCORES_KEY = 'duogerman_scores';
const EDITS_PREFIX = 'duogerman_edits__';

function loadScores() {
    try { return JSON.parse(localStorage.getItem(SCORES_KEY) || '{}'); }
    catch { return {}; }
}

function saveScore(fileName, mode, wrongCount, total) {
    const scores = loadScores();
    scores[`${fileName}__${mode}`] = {
        score: total - wrongCount,
        total,
        date: new Date().toLocaleDateString('zh-TW')
    };
    localStorage.setItem(SCORES_KEY, JSON.stringify(scores));
}

function updateScoreBadges() {
    const scores = loadScores();
    document.querySelectorAll('[data-file]').forEach(el => {
        const record = scores[`${el.dataset.file}__${gameMode}`];
        const badge = el.querySelector('.score-badge');
        if (!badge) return;
        if (record) {
            const pct = Math.round(record.score / record.total * 100);
            badge.textContent = `${record.score}/${record.total}`;
            badge.style.color = pct >= 80 ? 'var(--duo-green-dark)' : pct >= 50 ? '#f5a623' : 'var(--duo-red-dark)';
        } else {
            badge.textContent = '';
        }
    });
}

// ── localStorage：字彙編輯 ────────────────────────────────────

function getStoredVocab(fileName) {
    try {
        const stored = localStorage.getItem(EDITS_PREFIX + fileName);
        return stored ? JSON.parse(stored) : null;
    } catch { return null; }
}

function setStoredVocab(fileName, vocabArray) {
    localStorage.setItem(EDITS_PREFIX + fileName, JSON.stringify(vocabArray));
}

// ── 字彙解析（共用）──────────────────────────────────────────

function parseVocabText(text) {
    return text.replace(/\\/g, '').split('\n')
        .filter(line => line.trim() !== '')
        .map(line => {
            const parts = line.split('\t').map(p => p.trim()).filter(p => p !== '');
            const isNoun = parts.length >= 3 && /^(der|die|das|der\/die)$/i.test(parts[0]);
            if (isNoun) return { art: parts[0].toLowerCase(), de: parts[1], cn: parts[2], type: 'noun' };
            if (parts.length >= 2) return { de: parts[0], cn: parts[1], type: 'other' };
            return null;
        })
        .filter(Boolean);
}

async function fetchVocabFile(fileName) {
    const res = await fetch(`./voc/${fileName}`);
    if (!res.ok) throw new Error('fetch failed');
    return parseVocabText(await res.text());
}

// ── 語音 ──────────────────────────────────────────────────────
// getVoices() 是非同步的，需等 voiceschanged 事件後才有完整清單

let cachedVoices = [];

function initVoices() {
    cachedVoices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
}

if (window.speechSynthesis) {
    window.speechSynthesis.addEventListener('voiceschanged', initVoices);
    initVoices();
}

function speak(text) {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel(); // Chrome stuck bug fix
    const msg = new SpeechSynthesisUtterance(text);
    const germanVoice = cachedVoices.find(v => v.lang.startsWith('de'));
    if (germanVoice) msg.voice = germanVoice;
    msg.lang = 'de-DE';
    msg.rate = 0.9;
    window.speechSynthesis.speak(msg);
}

// ── 模式切換 ──────────────────────────────────────────────────

function setMode(mode) {
    gameMode = mode;
    document.getElementById('mode-quiz').classList.toggle('active', mode === 'quiz');
    document.getElementById('mode-dictation').classList.toggle('active', mode === 'dictation');
    updateScoreBadges();
}

// ── 鍵盤快捷鍵 ────────────────────────────────────────────────

document.addEventListener('keydown', function (event) {
    if (document.activeElement && document.activeElement.id === 'dictation-input') return;

    const bottomSheet = document.getElementById('bottom-sheet');
    if (bottomSheet.classList.contains('show') && event.key === 'Enter') {
        nextQuestion();
        return;
    }

    if (!isAnswered && document.getElementById('game-screen').classList.contains('active')) {
        if (gameMode === 'quiz' && event.key >= '1' && event.key <= '4') {
            const buttons = document.querySelectorAll('.option-btn');
            const btn = buttons[parseInt(event.key) - 1];
            if (btn) btn.click();
        }
    }
});

// ── 選單 ──────────────────────────────────────────────────────

async function initMenu() {
    const listContainer = document.getElementById('vocab-list');
    listContainer.innerHTML = '載入中...';
    try {
        const response = await fetch('./voc/list.json');
        if (!response.ok) throw new Error();
        const vocabFiles = await response.json();
        listContainer.innerHTML = '';
        vocabFiles.forEach(item => {
            const div = document.createElement('div');
            div.className = 'vocab-item';
            div.dataset.file = item.file;
            div.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:8px;';

            const nameArea = document.createElement('span');
            nameArea.textContent = item.name;
            nameArea.style.cssText = 'flex-grow:1;cursor:pointer;';
            nameArea.onclick = () => loadVocabFile(item.file);

            const right = document.createElement('div');
            right.style.cssText = 'display:flex;align-items:center;gap:8px;flex-shrink:0;';

            const badge = document.createElement('span');
            badge.className = 'score-badge';
            badge.style.cssText = 'font-size:0.85rem;font-weight:bold;';

            const listBtn = document.createElement('button');
            listBtn.textContent = '📋';
            listBtn.title = '查看／編輯單字';
            listBtn.style.cssText = 'border:none;background:none;cursor:pointer;font-size:1.1rem;padding:2px 4px;';
            listBtn.onclick = e => { e.stopPropagation(); viewVocabList(item.file, item.name); };

            right.appendChild(badge);
            right.appendChild(listBtn);
            div.appendChild(nameArea);
            div.appendChild(right);
            listContainer.appendChild(div);
        });
        updateScoreBadges();
    } catch {
        listContainer.innerHTML = '無法載入清單。請確認 voc/list.json 格式正確且存在。';
    }
}

function showMenu() { switchScreen('menu-screen'); }

// ── 讀取字彙檔（遊戲用，優先讀 localStorage 編輯版本）────────

async function loadVocabFile(fileName) {
    currentFile = fileName;
    try {
        const stored = getStoredVocab(fileName);
        vocabData = stored ?? await fetchVocabFile(fileName);
        if (vocabData.length === 0) throw new Error('解析失敗');
        startGame();
    } catch (err) {
        console.error(err);
        alert('讀取失敗！請確保檔案中德文與中文之間是用 Tab 分隔。');
    }
}

// ── 遊戲流程 ──────────────────────────────────────────────────

function startGame() {
    vocabData.sort(() => Math.random() - 0.5);
    currentQIndex = 0;
    wrongAnswers = [];
    switchScreen('game-screen');
    loadQuestion();
}

function switchScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}

function loadQuestion() {
    isAnswered = false;
    document.getElementById('bottom-sheet').classList.remove('show');
    const item = vocabData[currentQIndex];
    document.getElementById('progress-bar').style.width = `${(currentQIndex / vocabData.length) * 100}%`;

    if (gameMode === 'dictation') {
        loadDictationQuestion(item);
    } else {
        loadQuizQuestion(item);
    }
}

function nextQuestion() {
    currentQIndex++;
    if (currentQIndex >= vocabData.length) showResults();
    else loadQuestion();
}

function showResults() {
    saveScore(currentFile, gameMode, wrongAnswers.length, vocabData.length);
    switchScreen('result-screen');
    const summary = document.getElementById('result-summary');
    const wrongDisplay = document.getElementById('wrong-answers-display');
    summary.innerHTML = `本次練習共 ${vocabData.length} 題，寫錯 ${wrongAnswers.length} 題。`;
    if (wrongAnswers.length > 0) {
        wrongDisplay.style.display = 'block';
        wrongDisplay.innerHTML = '<strong>需複習單字：</strong><br><br>';
        wrongAnswers.forEach(w => {
            wrongDisplay.innerHTML += `<div class="wrong-item">${w.art ? w.art + ' ' : ''}<strong>${w.de}</strong> : ${w.cn}</div>`;
        });
    } else {
        wrongDisplay.style.display = 'none';
        summary.innerHTML += '<br>🎉 全對！祝你在復旦大學生活順利！';
    }
}

// ── 選擇題模式 ────────────────────────────────────────────────

function loadQuizQuestion(item) {
    speak(item.de);

    const gameArea = document.getElementById('game-area');
    gameArea.innerHTML = '';
    const qType = (item.type === 'noun' && Math.random() > 0.5) ? 0 : 1;

    const h2 = document.createElement('h2');
    h2.textContent = qType === 0 ? '請選擇正確的冠詞' : '選出正確的意思';
    gameArea.appendChild(h2);

    const wordDisplay = document.createElement('div');
    wordDisplay.className = 'word-display';
    wordDisplay.textContent = item.de;
    gameArea.appendChild(wordDisplay);

    const grid = document.createElement('div');
    grid.className = 'options-grid ' + (qType === 0 ? 'articles' : '');

    if (qType === 0) {
        ['der', 'die', 'das'].forEach(art => grid.appendChild(createOptionBtn(art, art === item.art, item)));
    } else {
        const opts = [{ text: item.cn, correct: true }];
        vocabData
            .filter(v => v.cn !== item.cn)
            .sort(() => Math.random() - 0.5)
            .slice(0, 3)
            .forEach(d => opts.push({ text: d.cn, correct: false }));
        opts.sort(() => Math.random() - 0.5).forEach(o => grid.appendChild(createOptionBtn(o.text, o.correct, item)));
    }
    gameArea.appendChild(grid);
}

function createOptionBtn(text, isCorrect, item) {
    const btn = document.createElement('button');
    btn.className = 'option-btn';
    btn.textContent = text;
    btn.onclick = () => {
        if (isAnswered) return;
        isAnswered = true;
        speak(item.art ? `${item.art} ${item.de}` : item.de);

        const sheet = document.getElementById('bottom-sheet');
        if (isCorrect) {
            btn.classList.add('correct');
            sheet.className = 'bottom-sheet show correct';
            document.getElementById('feedback-msg').textContent = '太棒了！';
        } else {
            btn.classList.add('wrong');
            sheet.className = 'bottom-sheet show wrong';
            document.getElementById('feedback-msg').textContent = '正確答案是：';
            if (!wrongAnswers.find(w => w.de === item.de)) wrongAnswers.push(item);
        }
        document.getElementById('feedback-detail').textContent =
            `${item.art ? item.art + ' ' : ''}${item.de} = ${item.cn}`;
    };
    return btn;
}

// ── 聽寫模式 ──────────────────────────────────────────────────

function loadDictationQuestion(item) {
    speak(item.de);

    const gameArea = document.getElementById('game-area');
    gameArea.innerHTML = '';

    const h2 = document.createElement('h2');
    h2.textContent = '聽到了什麼德語單字？';
    gameArea.appendChild(h2);

    const replayBtn = document.createElement('button');
    replayBtn.className = 'replay-btn';
    replayBtn.innerHTML = '🔊 再聽一次';
    replayBtn.onclick = () => speak(item.de);
    gameArea.appendChild(replayBtn);

    const umlauts = document.createElement('div');
    umlauts.className = 'umlaut-helpers';
    ['ä', 'ö', 'ü', 'Ä', 'Ö', 'Ü', 'ß'].forEach(char => {
        const btn = document.createElement('button');
        btn.className = 'umlaut-btn';
        btn.textContent = char;
        btn.type = 'button';
        btn.onclick = () => insertUmlaut(char);
        umlauts.appendChild(btn);
    });
    gameArea.appendChild(umlauts);

    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'dictation-input';
    input.className = 'dictation-input';
    input.placeholder = item.type === 'noun' ? '冠詞 + 單字（如：der Hund）' : '輸入德語單字';
    input.autocomplete = 'off';
    input.autocorrect = 'off';
    input.autocapitalize = 'none';
    input.spellcheck = false;
    input.addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        document.getElementById('bottom-sheet').classList.contains('show')
            ? nextQuestion()
            : checkDictationAnswer();
    });
    gameArea.appendChild(input);

    const submitBtn = document.createElement('button');
    submitBtn.className = 'submit-btn';
    submitBtn.textContent = '確認';
    submitBtn.onclick = checkDictationAnswer;
    gameArea.appendChild(submitBtn);

    setTimeout(() => input.focus(), 100);
}

function insertUmlaut(char) {
    const input = document.getElementById('dictation-input');
    if (!input) return;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    input.value = input.value.substring(0, start) + char + input.value.substring(end);
    input.selectionStart = input.selectionEnd = start + 1;
    input.focus();
}

function checkDictationAnswer() {
    if (isAnswered) return;
    const input = document.getElementById('dictation-input');
    if (!input || !input.value.trim()) return;

    isAnswered = true;
    input.disabled = true;
    input.blur();

    const item = vocabData[currentQIndex];
    const correctAnswer = item.type === 'noun' ? `${item.art} ${item.de}` : item.de;
    const isCorrect = input.value.trim().toLowerCase() === correctAnswer.toLowerCase();

    speak(correctAnswer);

    const sheet = document.getElementById('bottom-sheet');
    if (isCorrect) {
        sheet.className = 'bottom-sheet show correct';
        document.getElementById('feedback-msg').textContent = '太棒了！';
    } else {
        sheet.className = 'bottom-sheet show wrong';
        document.getElementById('feedback-msg').textContent = '正確答案是：';
        if (!wrongAnswers.find(w => w.de === item.de)) wrongAnswers.push(item);
    }
    document.getElementById('feedback-detail').textContent = `${correctAnswer} = ${item.cn}`;
}

// ── 單字列表 ──────────────────────────────────────────────────

let listCurrentFile = '';
let listCurrentName = '';
let listIsEditing = false;
let listVocabData = [];

async function viewVocabList(fileName, name) {
    listCurrentFile = fileName;
    listCurrentName = name;
    listIsEditing = false;

    try {
        listVocabData = getStoredVocab(fileName) ?? await fetchVocabFile(fileName);
    } catch {
        alert('讀取失敗！');
        return;
    }

    document.getElementById('list-title').textContent = name;
    document.getElementById('edit-toggle-btn').textContent = '✏️ 編輯';
    document.getElementById('edit-toggle-btn').classList.remove('active');
    document.getElementById('reset-btn').style.display = 'none';
    switchScreen('list-screen');
    renderList(false);
}

function renderList(editMode) {
    const content = document.getElementById('list-content');
    content.innerHTML = '';

    listVocabData.forEach((word, i) => {
        content.appendChild(editMode ? createEditRow(word) : createViewRow(word, i));
    });

    if (editMode) {
        const addBtn = document.createElement('div');
        addBtn.id = 'add-row-btn';
        addBtn.className = 'add-row-btn';
        addBtn.textContent = '＋ 新增單字';
        addBtn.onclick = addNewRow;
        content.appendChild(addBtn);
    }
}

function createViewRow(word, index) {
    const row = document.createElement('div');
    row.className = 'list-row';

    const num = document.createElement('span');
    num.className = 'list-num';
    num.textContent = index + 1;

    const art = document.createElement('span');
    art.className = 'list-art';
    art.textContent = word.art || '';

    const de = document.createElement('span');
    de.className = 'list-de';
    de.textContent = word.de;

    const cn = document.createElement('span');
    cn.className = 'list-cn';
    cn.textContent = word.cn;

    row.appendChild(num);
    row.appendChild(art);
    row.appendChild(de);
    row.appendChild(cn);
    return row;
}

function createEditRow(word) {
    const row = document.createElement('div');
    row.className = 'list-row edit-row';

    const delBtn = document.createElement('button');
    delBtn.className = 'delete-row-btn';
    delBtn.textContent = '✕';
    delBtn.type = 'button';
    delBtn.onclick = () => row.remove();

    const artSel = document.createElement('select');
    artSel.className = 'list-art-select';
    ['', 'der', 'die', 'das'].forEach(a => {
        const opt = document.createElement('option');
        opt.value = a;
        opt.textContent = a || '—';
        if ((word.art || '') === a) opt.selected = true;
        artSel.appendChild(opt);
    });

    const deInput = document.createElement('input');
    deInput.className = 'list-de-input';
    deInput.value = word.de;
    deInput.placeholder = '德語單字';

    const cnInput = document.createElement('input');
    cnInput.className = 'list-cn-input';
    cnInput.value = word.cn;
    cnInput.placeholder = '中文意思';

    row.appendChild(delBtn);
    row.appendChild(artSel);
    row.appendChild(deInput);
    row.appendChild(cnInput);
    return row;
}

function addNewRow() {
    const addBtn = document.getElementById('add-row-btn');
    const row = createEditRow({ art: '', de: '', cn: '', type: 'other' });
    addBtn.parentNode.insertBefore(row, addBtn);
    row.querySelector('.list-de-input').focus();
}

function collectEditRows() {
    return Array.from(document.querySelectorAll('.edit-row')).map(row => {
        const art = row.querySelector('.list-art-select').value;
        const de = row.querySelector('.list-de-input').value.trim();
        const cn = row.querySelector('.list-cn-input').value.trim();
        if (!de || !cn) return null;
        return art ? { art, de, cn, type: 'noun' } : { de, cn, type: 'other' };
    }).filter(Boolean);
}

function toggleEditMode() {
    const btn = document.getElementById('edit-toggle-btn');
    if (listIsEditing) {
        listVocabData = collectEditRows();
        setStoredVocab(listCurrentFile, listVocabData);
        listIsEditing = false;
        btn.textContent = '✏️ 編輯';
        btn.classList.remove('active');
        document.getElementById('reset-btn').style.display = 'none';
        renderList(false);
    } else {
        listIsEditing = true;
        btn.textContent = '✓ 完成';
        btn.classList.add('active');
        document.getElementById('reset-btn').style.display = '';
        renderList(true);
    }
}

async function resetToOriginal() {
    if (!confirm('確定要重置為原始檔案內容？這將清除所有手動編輯。')) return;
    localStorage.removeItem(EDITS_PREFIX + listCurrentFile);
    listVocabData = await fetchVocabFile(listCurrentFile);
    setStoredVocab(listCurrentFile, listVocabData);
    renderList(listIsEditing);
}

function downloadVocab() {
    const data = listIsEditing ? collectEditRows() : listVocabData;
    const lines = data.map(w => w.type === 'noun' ? `${w.art}\t${w.de}\t${w.cn}` : `${w.de}\t${w.cn}`);
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = listCurrentFile;
    a.click();
    URL.revokeObjectURL(url);
}

// ── 啟動 ──────────────────────────────────────────────────────

initMenu();
