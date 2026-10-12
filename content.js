const books = [
    ["Genesis", 50], ["Exodus", 40], ["Leviticus", 27], ["Numbers", 36], ["Deuteronomy", 34],
    ["Joshua", 24], ["Judges", 21], ["Ruth", 4], ["1 Samuel", 31], ["2 Samuel", 24],
    ["1 Kings", 22], ["2 Kings", 25], ["1 Chronicles", 29], ["2 Chronicles", 36], ["Ezra", 10],
    ["Nehemiah", 13], ["Esther", 10], ["Job", 42], ["Psalms", 150], ["Proverbs", 31],
    ["Ecclesiastes", 12], ["Song of Solomon", 8], ["Isaiah", 66], ["Jeremiah", 52], ["Lamentations", 5],
    ["Ezekiel", 48], ["Daniel", 12], ["Hosea", 14], ["Joel", 3], ["Amos", 9],
    ["Obadiah", 1], ["Jonah", 4], ["Micah", 7], ["Nahum", 3], ["Habakkuk", 3],
    ["Zephaniah", 3], ["Haggai", 2], ["Zechariah", 14], ["Malachi", 4], ["Matthew", 28],
    ["Mark", 16], ["Luke", 24], ["John", 21], ["Acts", 28], ["Romans", 16],
    ["1 Corinthians", 16], ["2 Corinthians", 13], ["Galatians", 6], ["Ephesians", 6], ["Philippians", 4],
    ["Colossians", 4], ["1 Thessalonians", 5], ["2 Thessalonians", 3], ["1 Timothy", 6], ["2 Timothy", 4],
    ["Titus", 3], ["Philemon", 1], ["Hebrews", 13], ["James", 5], ["1 Peter", 5],
    ["2 Peter", 3], ["1 John", 5], ["2 John", 1], ["3 John", 1], ["Jude", 1], ["Revelation", 22]
];

const dailyList = [
    "John 3:16", "Psalm 23:1", "Romans 8:28", "Philippians 4:13", "Proverbs 3:5-6",
    "Isaiah 41:10", "Jeremiah 29:11", "Joshua 1:9", "Matthew 11:28", "Psalm 46:1",
    "Romans 12:2", "Galatians 2:20", "Ephesians 2:8-9", "Hebrews 11:1", "2 Timothy 1:7",
    "Psalm 119:105", "Matthew 6:33", "Isaiah 40:31", "1 Corinthians 13:4-7", "Psalm 27:1",
    "Romans 5:8", "James 1:5", "1 John 4:19", "Micah 6:8", "Lamentations 3:22-23",
    "Psalm 121:1-2", "Colossians 3:23", "Matthew 5:16", "1 Peter 5:7", "Deuteronomy 31:6",
    "Psalm 34:8"
];

const themes = ["night", "parchment", "ink"];

const $ = (id) => document.getElementById(id);

function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
}

function load(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
        return fallback;
    }
}

function save(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {}
}

const settings = Object.assign(
    { translation: "web", fontSize: 17, theme: "night", view: "scroll", last: null },
    load("bb_settings", {})
);
let saved = load("bb_saved", []);
let recent = load("bb_recent", []);

let passage = null;
let focusIndex = 0;
let picked = new Set();
let loadId = 0;
let dailyId = 0;
let dailyRef = "";
let suggestions = [];
let active = -1;
let toastTimer = null;
const cache = new Map();

function findBook(text) {
    const t = text.toLowerCase().replace(/\./g, "").replace(/\s+/g, " ").trim();
    if (!t) return -1;
    if (t === "song of songs" || t === "songs") return 21;
    if (t === "psalm") return 18;
    const names = books.map((b) => b[0].toLowerCase());
    let i = names.indexOf(t);
    if (i > -1) return i;
    i = names.findIndex((n) => n.startsWith(t));
    if (i > -1) return i;
    i = names.findIndex((n) => t.startsWith(n));
    if (i > -1) return i;
    const squashed = t.replace(/ /g, "");
    return names.findIndex((n) => n.replace(/ /g, "").startsWith(squashed));
}

function parseRef(text) {
    const m = text.trim().match(/^(\d?\s*[a-zA-Z][a-zA-Z.\s]*?)\s*(?:(\d+)(?:\s*[:.]\s*(\d+))?(?:\s*[-–]\s*(\d+))?)?$/);
    if (!m) return null;
    const idx = findBook(m[1]);
    if (idx < 0) return null;

    const total = books[idx][1];
    let chapter = m[2] ? parseInt(m[2], 10) : 1;
    let from = m[3] ? parseInt(m[3], 10) : null;
    let to = m[4] ? parseInt(m[4], 10) : null;

    if (total === 1 && m[2] && !m[3]) {
        from = chapter;
        chapter = 1;
    }
    if (!from) to = null;
    if (from && to && to < from) [from, to] = [to, from];
    if (to === from) to = null;

    if (chapter < 1 || chapter > total) {
        return { error: `${books[idx][0]} has ${total} chapter${total > 1 ? "s" : ""}.` };
    }
    return { idx, chapter, from, to };
}

function buildRef(idx, chapter, from, to) {
    let ref = `${books[idx][0]} ${chapter}`;
    if (from) ref += `:${from}`;
    if (from && to) ref += `-${to}`;
    return ref;
}

async function fetchPassage(ref, translation) {
    const key = `${translation}|${ref}`;
    if (cache.has(key)) return cache.get(key);
    const resp = await fetch(`https://bible-api.com/${ref.replace(/ /g, "+")}?translation=${translation}`);
    if (!resp.ok) throw new Error("notfound");
    const data = await resp.json();
    if (!Array.isArray(data.verses) || !data.verses.length) throw new Error("notfound");
    cache.set(key, data);
    return data;
}

function clean(text) {
    return text.replace(/\s+/g, " ").trim();
}

function setReadView(view, text) {
    $("daily").hidden = view !== "daily";
    $("reader").hidden = view !== "reader";
    $("message").hidden = view !== "message";
    if (text) $("message").textContent = text;
}

function showTab(name) {
    document.querySelectorAll(".tabs button").forEach((b) => {
        b.classList.toggle("on", b.dataset.tab === name);
    });
    ["read", "saved", "recent"].forEach((n) => {
        $(n + "Pane").hidden = n !== name;
    });
    $("content").scrollTop = 0;
}

function toast(text) {
    const box = $("toast");
    box.textContent = text;
    box.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => box.classList.remove("show"), 1600);
}

async function openPassage(idx, chapter, from, to) {
    const ref = buildRef(idx, chapter, from, to);
    const myId = ++loadId;
    showTab("read");

    if (settings.translation === "cherokee" && idx < 39) {
        setReadView("message", "The Cherokee translation only includes the New Testament.");
        return;
    }

    setReadView("message", "Loading...");

    try {
        const data = await fetchPassage(ref, settings.translation);
        if (myId !== loadId) return;

        passage = {
            idx,
            chapter,
            from,
            to,
            ref,
            translation: settings.translation,
            translationName: data.translation_name || settings.translation.toUpperCase(),
            whole: !from,
            verses: data.verses.map((v) => ({ verse: v.verse, text: clean(v.text) }))
        };
        picked.clear();
        focusIndex = 0;

        settings.last = ref;
        save("bb_settings", settings);
        addRecent(entryFrom(passage));
        renderReader();
        updateResume();
    } catch (err) {
        if (myId !== loadId) return;
        if (err.message === "notfound") {
            setReadView("message", "Couldn't find that passage. Check the verse numbers and try again.");
        } else {
            setReadView("message", "Couldn't reach the Bible service. Check your connection and try again.");
        }
    }
}

function entryFrom(p) {
    const first = p.verses[0].text;
    return {
        ref: p.ref,
        translation: p.translation,
        idx: p.idx,
        chapter: p.chapter,
        from: p.from,
        to: p.to,
        preview: first.length > 110 ? first.slice(0, 110) + "…" : first
    };
}

function renderReader() {
    setReadView("reader");
    $("title").textContent = passage.ref;
    $("versionName").textContent = passage.translationName;
    $("chapterBtn").hidden = passage.whole;
    $("viewBtn").hidden = passage.verses.length < 2;
    $("prevCh").disabled = passage.idx === 0 && passage.chapter === 1;
    $("nextCh").disabled = passage.idx === books.length - 1 && passage.chapter === books[passage.idx][1];
    $("saveBtn").classList.toggle("on", isSaved());
    renderText();
    $("content").scrollTop = 0;
}

function renderText() {
    const box = $("text");
    box.innerHTML = "";
    const focus = settings.view === "focus";
    $("focusNav").hidden = !focus;
    $("viewBtn").textContent = focus ? "Show all" : "One at a time";

    if (focus) {
        const v = passage.verses[focusIndex];
        const wrap = el("div", "focus-verse");
        wrap.append(
            el("p", "text", v.text),
            el("p", "num", `${books[passage.idx][0]} ${passage.chapter}:${v.verse}`)
        );
        box.append(wrap);
        $("focusCount").textContent = `${focusIndex + 1} of ${passage.verses.length}`;
        $("focusPrev").disabled = focusIndex === 0;
        $("focusNext").disabled = focusIndex === passage.verses.length - 1;
        return;
    }

    const p = el("p", "passage");
    passage.verses.forEach((v, i) => {
        const span = el("span", "verse");
        span.dataset.i = i;
        if (picked.has(i)) span.classList.add("on");
        span.append(el("sup", null, String(v.verse)), document.createTextNode(v.text + " "));
        p.append(span);
    });
    box.append(p);
}

function compress(nums) {
    const out = [];
    let start = nums[0];
    let prev = nums[0];
    for (let i = 1; i <= nums.length; i++) {
        const n = nums[i];
        if (n === prev + 1) {
            prev = n;
            continue;
        }
        out.push(start === prev ? `${start}` : `${start}-${prev}`);
        start = n;
        prev = n;
    }
    return out.join(",");
}

function currentText() {
    const partial = settings.view === "focus" || picked.size > 0;
    let list = passage.verses;
    if (settings.view === "focus") {
        list = [passage.verses[focusIndex]];
    } else if (picked.size) {
        list = [...picked].sort((a, b) => a - b).map((i) => passage.verses[i]);
    }
    const label = partial
        ? `${books[passage.idx][0]} ${passage.chapter}:${compress(list.map((v) => v.verse))}`
        : passage.ref;
    const body = list.map((v) => v.text).join(" ");
    return `${body}\n${label} (${passage.translation.toUpperCase()})`;
}

function isSaved() {
    return saved.some((s) => s.ref === passage.ref && s.translation === passage.translation);
}

function toggleSave() {
    if (isSaved()) {
        saved = saved.filter((s) => !(s.ref === passage.ref && s.translation === passage.translation));
        toast("Removed from Saved");
    } else {
        saved.unshift(entryFrom(passage));
        toast("Saved");
    }
    save("bb_saved", saved);
    $("saveBtn").classList.toggle("on", isSaved());
    renderSaved();
}

function addRecent(entry) {
    recent = recent.filter((r) => !(r.ref === entry.ref && r.translation === entry.translation));
    recent.unshift(entry);
    recent = recent.slice(0, 12);
    save("bb_recent", recent);
    renderRecent();
}

function openEntry(entry) {
    settings.translation = entry.translation;
    $("chosenBible").value = entry.translation;
    save("bb_settings", settings);
    openPassage(entry.idx, entry.chapter, entry.from, entry.to);
}

function itemNode(entry, onRemove) {
    const li = el("li", "item");
    const body = el("div", "body");
    const name = el("div", "name", entry.ref);
    name.append(el("span", null, entry.translation.toUpperCase()));
    body.append(name);
    if (entry.preview) body.append(el("p", "preview", entry.preview));
    body.addEventListener("click", () => openEntry(entry));
    li.append(body);
    if (onRemove) {
        const btn = el("button", "icon-btn", "×");
        btn.title = "Remove";
        btn.setAttribute("aria-label", "Remove");
        btn.addEventListener("click", onRemove);
        li.append(btn);
    }
    return li;
}

function renderSaved() {
    const list = $("savedList");
    list.innerHTML = "";
    if (!saved.length) {
        list.append(el("li", "note", "Nothing saved yet. Tap the bookmark while reading to keep a passage here."));
        return;
    }
    saved.forEach((entry) => {
        list.append(itemNode(entry, () => {
            saved = saved.filter((s) => s !== entry);
            save("bb_saved", saved);
            renderSaved();
            if (passage) $("saveBtn").classList.toggle("on", isSaved());
        }));
    });
}

function renderRecent() {
    const list = $("recentList");
    list.innerHTML = "";
    $("clearRecent").hidden = !recent.length;
    if (!recent.length) {
        list.append(el("li", "note", "Passages you open will show up here."));
        return;
    }
    recent.forEach((entry) => list.append(itemNode(entry)));
}

function updateResume() {
    if (!settings.last) return;
    const btn = $("resume");
    btn.textContent = `Continue with ${settings.last}`;
    btn.hidden = false;
}

async function loadDaily(random) {
    const pool = dailyList.filter((r) => settings.translation !== "cherokee" || parseRef(r).idx >= 39);
    if (random) {
        const others = pool.filter((r) => r !== dailyRef);
        dailyRef = others[Math.floor(Math.random() * others.length)];
    } else {
        const start = new Date(new Date().getFullYear(), 0, 0);
        const day = Math.floor((Date.now() - start) / 86400000);
        dailyRef = pool[day % pool.length];
    }

    $("dailyLabel").textContent = random ? "Another verse" : "Verse for today";
    $("dailyText").textContent = "Loading...";
    $("dailyRef").textContent = dailyRef;

    const myId = ++dailyId;
    const p = parseRef(dailyRef);
    try {
        const data = await fetchPassage(buildRef(p.idx, p.chapter, p.from, p.to), settings.translation);
        if (myId !== dailyId) return;
        $("dailyText").textContent = `“${data.verses.map((v) => clean(v.text)).join(" ")}”`;
    } catch (err) {
        if (myId !== dailyId) return;
        $("dailyText").textContent = "Couldn't load a verse right now. Check your connection.";
    }
}

function stepChapter(dir) {
    let idx = passage.idx;
    let ch = passage.chapter + dir;
    if (ch < 1) {
        idx -= 1;
        if (idx < 0) return;
        ch = books[idx][1];
    } else if (ch > books[idx][1]) {
        idx += 1;
        if (idx >= books.length) return;
        ch = 1;
    }
    openPassage(idx, ch, null, null);
}

function submitSearch() {
    const text = $("ref").value;
    if (!text.trim()) {
        $("ref").focus();
        return;
    }
    const parsed = parseRef(text);
    if (!parsed) {
        showTab("read");
        setReadView("message", "Couldn't read that reference. Try something like John 3:16 or Psalm 23.");
        return;
    }
    if (parsed.error) {
        showTab("read");
        setReadView("message", parsed.error);
        return;
    }
    openPassage(parsed.idx, parsed.chapter, parsed.from, parsed.to);
}

function hideSuggest() {
    $("suggest").hidden = true;
    suggestions = [];
    active = -1;
}

function pickBook(i) {
    $("ref").value = books[i][0] + " ";
    hideSuggest();
    $("ref").focus();
}

function updateSuggest() {
    const value = $("ref").value;
    if (!/^\s*\d?\s*[a-zA-Z][a-zA-Z.\s]*$/.test(value)) return hideSuggest();

    const key = value.toLowerCase().replace(/[.\s]/g, "");
    suggestions = [];
    books.forEach((b, i) => {
        if (b[0].toLowerCase().replace(/\s/g, "").startsWith(key)) suggestions.push(i);
    });
    suggestions = suggestions.slice(0, 6);

    const exact = suggestions.length === 1 && books[suggestions[0]][0].toLowerCase() === value.trim().toLowerCase();
    if (!suggestions.length || exact) return hideSuggest();

    active = -1;
    const list = $("suggest");
    list.innerHTML = "";
    suggestions.forEach((bi) => {
        const li = el("li", null, books[bi][0]);
        li.addEventListener("mousedown", (e) => {
            e.preventDefault();
            pickBook(bi);
        });
        list.append(li);
    });
    list.hidden = false;
}

function applyTheme() {
    document.body.dataset.theme = settings.theme;
}

function applyFont() {
    document.documentElement.style.setProperty("--read-size", settings.fontSize + "px");
}

$("searchForm").addEventListener("submit", (e) => {
    e.preventDefault();
    hideSuggest();
    submitSearch();
});

$("ref").addEventListener("input", updateSuggest);
$("ref").addEventListener("blur", hideSuggest);
$("ref").addEventListener("keydown", (e) => {
    const list = $("suggest");
    if (list.hidden) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const n = suggestions.length;
        if (e.key === "ArrowDown") {
            active = (active + 1) % n;
        } else {
            active = active <= 0 ? n - 1 : active - 1;
        }
        [...list.children].forEach((li, i) => li.classList.toggle("active", i === active));
    } else if (e.key === "Enter" && active > -1) {
        e.preventDefault();
        pickBook(suggestions[active]);
    } else if (e.key === "Escape") {
        hideSuggest();
    }
});

$("chosenBible").addEventListener("change", () => {
    settings.translation = $("chosenBible").value;
    save("bb_settings", settings);
    if (passage && !$("reader").hidden) {
        openPassage(passage.idx, passage.chapter, passage.from, passage.to);
    } else if (!$("daily").hidden) {
        loadDaily(false);
    }
});

document.querySelectorAll(".tabs button").forEach((b) => {
    b.addEventListener("click", () => showTab(b.dataset.tab));
});

$("themeBtn").addEventListener("click", () => {
    settings.theme = themes[(themes.indexOf(settings.theme) + 1) % themes.length];
    save("bb_settings", settings);
    applyTheme();
});

$("smaller").addEventListener("click", () => {
    settings.fontSize = Math.max(13, settings.fontSize - 1);
    save("bb_settings", settings);
    applyFont();
});

$("larger").addEventListener("click", () => {
    settings.fontSize = Math.min(24, settings.fontSize + 1);
    save("bb_settings", settings);
    applyFont();
});

$("dailyOpen").addEventListener("click", () => {
    const p = parseRef(dailyRef);
    if (p && !p.error) openPassage(p.idx, p.chapter, null, null);
});

$("dailyShuffle").addEventListener("click", () => loadDaily(true));

$("resume").addEventListener("click", () => {
    const p = parseRef(settings.last);
    if (p && !p.error) openPassage(p.idx, p.chapter, p.from, p.to);
});

$("prevCh").addEventListener("click", () => stepChapter(-1));
$("nextCh").addEventListener("click", () => stepChapter(1));

$("chapterBtn").addEventListener("click", () => {
    openPassage(passage.idx, passage.chapter, null, null);
});

$("viewBtn").addEventListener("click", () => {
    settings.view = settings.view === "focus" ? "scroll" : "focus";
    save("bb_settings", settings);
    renderText();
});

$("focusPrev").addEventListener("click", () => {
    if (focusIndex > 0) {
        focusIndex--;
        renderText();
    }
});

$("focusNext").addEventListener("click", () => {
    if (focusIndex < passage.verses.length - 1) {
        focusIndex++;
        renderText();
    }
});

$("text").addEventListener("click", (e) => {
    const verse = e.target.closest(".verse");
    if (!verse) return;
    const i = Number(verse.dataset.i);
    if (picked.has(i)) {
        picked.delete(i);
    } else {
        picked.add(i);
    }
    verse.classList.toggle("on");
});

$("copyBtn").addEventListener("click", () => {
    navigator.clipboard.writeText(currentText())
        .then(() => toast("Copied"))
        .catch(() => toast("Couldn't copy"));
});

$("saveBtn").addEventListener("click", toggleSave);

$("clearRecent").addEventListener("click", () => {
    recent = [];
    save("bb_recent", recent);
    renderRecent();
});

document.addEventListener("keydown", (e) => {
    if (e.target.matches("input, select")) return;
    if (!passage || $("reader").hidden || settings.view !== "focus") return;
    if (e.key === "ArrowRight") $("focusNext").click();
    if (e.key === "ArrowLeft") $("focusPrev").click();
});

$("chosenBible").value = settings.translation;
applyTheme();
applyFont();
renderSaved();
renderRecent();
updateResume();
loadDaily(false);