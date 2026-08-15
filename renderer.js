const { ipcRenderer } = require('electron');
const path = require('path');
const runningFromElectronDevFolder = process.resourcesPath.includes(`${path.sep}node_modules${path.sep}electron${path.sep}`);
const pdfjsRoot = runningFromElectronDevFolder ? path.join(__dirname, 'node_modules', 'pdfjs-dist', 'legacy', 'build') : path.join(process.resourcesPath, 'pdfjs');
const pdfjsLib = require(path.join(pdfjsRoot, 'pdf.js'));
pdfjsLib.GlobalWorkerOptions.workerSrc = path.join(pdfjsRoot, 'pdf.worker.js');

const $ = (selector) => document.querySelector(selector);
const viewer = $('#viewer');
const tabs = $('#tabs');
let pages = $('#pages');
let color = '#1677ff';
let size = 3;
let tool = 'pen';
const toolColors = { pen: '#1677ff', highlighter: '#fbe888' };
let history = new Map();
let activePage = 0;
let zoom = 1;
let pdfDocument;
let sourcePath;
let activeDocument;
let documentId = 0;
let virtualUpdateQueued = false;
let scrollPageBadgeTimer;
const documents = [];

const translations = {
  ru: {
    file: 'Файл', drawing: 'Рисование', settings: 'Настройки', openPdf: 'Открыть PDF', saveFile: 'Сохранить файл',
    pen: 'Перо', highlighter: 'Выделитель', eraser: 'Ластик', undo: 'Отменить', clear: 'Очистить страницу',
    color: 'Цвет', penColor: 'Цвет пера', highlighterColor: 'Цвет выделителя', drawingMode: 'Инструмент рисования', drawingTools: 'Инструменты рисования', blue: 'Синий', purple: 'Фиолетовый', teal: 'Бирюзовый', pink: 'Розовый', orange: 'Оранжевый', black: 'Чёрный', softYellow: 'Нежный жёлтый', softGreen: 'Нежный зелёный', softBlue: 'Нежный голубой', softLilac: 'Нежный лиловый', softPink: 'Нежный розовый', softPeach: 'Нежный персиковый', thickness: 'Толщина',
    openDocuments: 'Открытые документы', noDocument: 'Документ не выбран', pagePosition: 'Текущая страница', zoom: 'Масштаб', zoomOut: 'Уменьшить масштаб', zoomIn: 'Увеличить масштаб', resetZoom: 'Сбросить масштаб',
    emptyTitle: 'Ваш PDF — в фокусе', emptyText: 'Откройте файл, чтобы читать, выделять важное и делать пометки стилусом.', choosePdf: 'Выбрать PDF',
    emptyHint: 'Удерживайте перо 1,2 секунды после рисунка, чтобы превратить линию, круг или квадрат в аккуратную фигуру.',
    preferences: 'Предпочтения', theme: 'Тема', themeHint: 'Выберите оформление приложения', light: 'Светлая', dark: 'Тёмная', language: 'Язык', languageHint: 'Язык интерфейса', close: 'Закрыть', minimize: 'Свернуть', maximize: 'Развернуть', windowControls: 'Управление окном',
    opened: 'Открыт файл: {name}', openFailed: 'Не удалось открыть PDF', openFirst: 'Сначала откройте PDF', saved: 'Сохранено: {path}', cleared: 'Пометки на странице очищены',
    recognizedLine: 'Линия распознана — не отпуская перо, поверните её или измените длину', recognizedShape: 'Фигура распознана — не отпуская перо, измените размер',
    pageLoading: 'Страница загружается…', pageUnavailable: 'Не удалось отрисовать страницу', pageReleased: 'Страница выгружена для экономии памяти', closeDocument: 'Закрыть {name}'
  },
  en: {
    file: 'File', drawing: 'Drawing', settings: 'Settings', openPdf: 'Open PDF', saveFile: 'Save file',
    pen: 'Pen', highlighter: 'Highlighter', eraser: 'Eraser', undo: 'Undo', clear: 'Clear page', color: 'Color', penColor: 'Pen color', highlighterColor: 'Highlighter color', drawingMode: 'Drawing tool', drawingTools: 'Drawing tools', blue: 'Blue', purple: 'Purple', teal: 'Teal', pink: 'Pink', orange: 'Orange', black: 'Black', softYellow: 'Soft yellow', softGreen: 'Soft green', softBlue: 'Soft blue', softLilac: 'Soft lilac', softPink: 'Soft pink', softPeach: 'Soft peach', thickness: 'Thickness',
    openDocuments: 'Open documents', noDocument: 'No document selected', pagePosition: 'Current page', zoom: 'Zoom', zoomOut: 'Zoom out', zoomIn: 'Zoom in', resetZoom: 'Reset zoom',
    emptyTitle: 'Your PDF, in focus', emptyText: 'Open a file to read, highlight important details, and annotate it with your stylus.', choosePdf: 'Choose PDF',
    emptyHint: 'Hold the pen for 1.2 seconds after drawing to turn a line, circle, or square into a clean shape.',
    preferences: 'Preferences', theme: 'Appearance', themeHint: 'Choose how the app looks', light: 'Light', dark: 'Dark', language: 'Language', languageHint: 'Interface language', close: 'Close', minimize: 'Minimize', maximize: 'Maximize', windowControls: 'Window controls',
    opened: 'Opened: {name}', openFailed: 'Could not open the PDF', openFirst: 'Open a PDF first', saved: 'Saved: {path}', cleared: 'Page annotations cleared',
    recognizedLine: 'Line recognized — keep holding to rotate or resize it', recognizedShape: 'Shape recognized — keep holding to resize it',
    pageLoading: 'Loading page…', pageUnavailable: 'Could not render the page', pageReleased: 'Page unloaded to save memory', closeDocument: 'Close {name}'
  }
};

const savedPreferences = JSON.parse(localStorage.getItem('neon-pdf-preferences') || '{}');
const preferences = { theme: savedPreferences.theme === 'dark' ? 'dark' : 'light', language: savedPreferences.language === 'en' ? 'en' : 'ru' };
const t = (key, values = {}) => (translations[preferences.language][key] || key).replace(/\{(\w+)\}/g, (_, name) => values[name] ?? '');

function savePreferences() { localStorage.setItem('neon-pdf-preferences', JSON.stringify(preferences)); }
function applyPreferences() {
  document.documentElement.dataset.theme = preferences.theme;
  document.documentElement.lang = preferences.language;
  document.title = 'Neon PDF';
  ipcRenderer.send('set-theme', preferences.theme);
  document.querySelectorAll('[data-i18n]').forEach(element => { element.textContent = t(element.dataset.i18n); });
  document.querySelectorAll('[data-i18n-title]').forEach(element => { element.title = t(element.dataset.i18nTitle); });
  document.querySelectorAll('[data-i18n-aria]').forEach(element => { element.setAttribute('aria-label', t(element.dataset.i18nAria)); });
  document.querySelectorAll('[data-theme-choice]').forEach(button => button.classList.toggle('active', button.dataset.themeChoice === preferences.theme));
  document.querySelectorAll('[data-language-choice]').forEach(button => button.classList.toggle('active', button.dataset.languageChoice === preferences.language));
  renderTabs();
}

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove('show'), 2200);
}

function setRangeProgress() {
  const range = $('#sizeRange');
  const progress = ((Number(range.value) - Number(range.min)) / (Number(range.max) - Number(range.min))) * 100;
  range.style.setProperty('--range-progress', `${progress}%`);
}

function updateZoomAvailability() {
  const enabled = Boolean(activeDocument);
  $('#zoomControls').classList.toggle('is-disabled', !enabled);
  $('#pageReadout').classList.toggle('is-disabled', !enabled);
  ['#zoomIn', '#zoomOut', '#zoomReset', '#saveButton'].forEach(selector => { $(selector).disabled = !enabled; });
}

function updatePageDisplay({ showOnScrollbar = false } = {}) {
  if (!activeDocument) return;
  const total = activeDocument.pdf?.numPages || 1;
  const current = Math.min(total, Math.max(1, activePage || activeDocument.activePage || 1));
  activePage = current;
  activeDocument.activePage = current;
  $('#pageValue').textContent = `${current} / ${total}`;
  $('#scrollPageBadge').textContent = String(current);
  if (!showOnScrollbar) return;
  viewer.classList.add('is-page-scrolling');
  clearTimeout(scrollPageBadgeTimer);
  scrollPageBadgeTimer = setTimeout(() => viewer.classList.remove('is-page-scrolling'), 850);
}

function setZoom(nextZoom) {
  if (!activeDocument) return;
  zoom = Math.min(2.5, Math.max(.5, Math.round(nextZoom * 10) / 10));
  pages.style.zoom = zoom;
  $('#zoomValue').textContent = `${Math.round(zoom * 100)}%`;
  activeDocument.zoom = zoom;
  queueVirtualPages();
}

function closeAllPopovers(except, keepDrawing = false) {
  [['fileMenuButton', 'fileMenu'], ['drawingMenuButton', 'drawingPanel']].forEach(([buttonId, panelId]) => {
    if (panelId === except || (keepDrawing && panelId === 'drawingPanel')) return;
    $(`#${panelId}`).classList.remove('is-open');
    $(`#${buttonId}`).setAttribute('aria-expanded', 'false');
  });
}

function togglePopover(buttonId, panelId, { keepDrawing = false } = {}) {
  const panel = $(`#${panelId}`);
  const willOpen = !panel.classList.contains('is-open');
  closeAllPopovers(willOpen ? panelId : undefined, keepDrawing);
  panel.classList.toggle('is-open', willOpen);
  $(`#${buttonId}`).setAttribute('aria-expanded', String(willOpen));
}

const brushCursor = Object.assign(document.createElement('div'), { className: 'brush-cursor' });
Object.assign(brushCursor.style, { position: 'fixed', zIndex: 99, pointerEvents: 'none', display: 'none', border: '1px solid #1677ff', borderRadius: '50%', transform: 'translate(-50%,-50%)', boxSizing: 'border-box' });
document.body.append(brushCursor);
function showBrushCursor(event) {
  if (event.pointerType === 'mouse' || event.pointerType === 'pen') {
    const cursorSize = tool === 'highlighter' ? Math.max(13, size * 4) : size;
    brushCursor.style.display = 'block';
    brushCursor.style.left = `${event.clientX}px`;
    brushCursor.style.top = `${event.clientY}px`;
    brushCursor.style.width = `${cursorSize}px`;
    brushCursor.style.height = `${cursorSize}px`;
    brushCursor.style.borderColor = color;
  }
}
function hideBrushCursor() { brushCursor.style.display = 'none'; }
function inkStyle(context) { context.globalCompositeOperation = 'source-over'; context.globalAlpha = tool === 'highlighter' ? .46 : 1; context.lineCap = 'round'; context.lineJoin = 'round'; context.strokeStyle = color; context.lineWidth = tool === 'highlighter' ? Math.max(13, size * 4) : size; context.shadowColor = 'transparent'; context.shadowBlur = 0; }
function pushHistory(canvas) { const state = history.get(canvas) || { undo: [], redo: [] }; state.undo.push(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)); if (state.undo.length > 8) state.undo.shift(); state.redo = []; history.set(canvas, state); }
function undo(canvas) { const state = history.get(canvas); if (!canvas || !state?.undo.length) return; state.redo.push(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)); canvas.getContext('2d').putImageData(state.undo.pop(), 0, 0); }
function redo(canvas) { const state = history.get(canvas); if (!canvas || !state?.redo.length) return; state.undo.push(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)); canvas.getContext('2d').putImageData(state.redo.pop(), 0, 0); }

function pointsBox(points) { const xs = points.map(point => point.x); const ys = points.map(point => point.y); return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }; }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function pointSegmentDistance(point, start, end) { const dx = end.x - start.x; const dy = end.y - start.y; if (!dx && !dy) return dist(point, start); const factor = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy))); return Math.hypot(point.x - (start.x + factor * dx), point.y - (start.y + factor * dy)); }
function simplified(points, epsilon = 11) { if (points.length < 3) return points; let max = 0; let index = 0; for (let i = 1; i < points.length - 1; i++) { const distance = pointSegmentDistance(points[i], points[0], points.at(-1)); if (distance > max) { max = distance; index = i; } } if (max > epsilon) { const left = simplified(points.slice(0, index + 1), epsilon); const right = simplified(points.slice(index), epsilon); return [...left.slice(0, -1), ...right]; } return [points[0], points.at(-1)]; }
function recognize(points) {
  if (points.length < 7) return null;
  const box = pointsBox(points); const first = points[0]; const last = points.at(-1); const closed = dist(first, last) < Math.max(18, Math.min(box.w, box.h) * .24);
  if (!closed && isStraightStroke(points)) return 'line';
  if (!closed || box.w < 22 || box.h < 22) return null;
  let simple = simplified(points.slice(0, -1)).filter((point, index, list) => index === 0 || dist(point, list[index - 1]) > 5);
  if (simple.length > 2 && dist(simple[0], simple.at(-1)) < 20) simple = simple.slice(0, -1);
  const ratio = box.w / box.h; const center = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  if (simple.length === 4 && ratio > .72 && ratio < 1.38) return 'square';
  const radii = points.map(point => dist(point, center)); const average = radii.reduce((sum, value) => sum + value, 0) / radii.length;
  const variation = Math.sqrt(radii.reduce((sum, value) => sum + (value - average) ** 2, 0) / radii.length) / average;
  return variation < .22 && ratio > .68 && ratio < 1.45 ? 'circle' : null;
}
function isStraightStroke(points) {
  if (points.length < 5) return false;
  const start = points[0]; const end = points.at(-1); const length = dist(start, end);
  if (length < 38) return false;
  const maxDeviation = Math.max(...points.map(point => pointSegmentDistance(point, start, end)));
  return maxDeviation <= Math.max(4.5, length * .055);
}
function angleFrom(pivot, point) { return Math.atan2(point.y - pivot.y, point.x - pivot.x); }
function normalizedAngle(angle) { while (angle > Math.PI) angle -= Math.PI * 2; while (angle < -Math.PI) angle += Math.PI * 2; return angle; }
function makeShape(type, points) { const box = pointsBox(points); const last = points.at(-1); if (type === 'line') { const pivot = points[0]; return { type, pivot, length: dist(pivot, last), baseAngle: angleFrom(pivot, last), rotation: 0 }; } if (type === 'circle') { const pivot = { x: box.x + box.w / 2, y: box.y + box.h / 2 }; const rx = Math.max(11, box.w / 2); const ry = Math.max(11, box.h / 2); return { type, pivot, rx, ry, baseRx: rx, baseRy: ry, startRadius: Math.max(1, dist(pivot, last)) }; } const side = Math.max(22, box.w, box.h); return { type: 'square', pivot: { x: box.x, y: box.y + box.h }, side, xSign: 1, ySign: -1 }; }
function drawShape(context, shape) { inkStyle(context); context.save(); context.translate(shape.pivot.x, shape.pivot.y); context.beginPath(); if (shape.type === 'line') { context.rotate(shape.baseAngle + shape.rotation); context.moveTo(0, 0); context.lineTo(shape.length, 0); } else if (shape.type === 'circle') context.ellipse(0, 0, shape.rx, shape.ry, 0, 0, Math.PI * 2); else context.rect(0, shape.ySign < 0 ? -shape.side : 0, shape.xSign * shape.side, shape.side); context.stroke(); context.restore(); }
function drawFreeStroke(context, strokePoints) {
  if (strokePoints.length < 2) return;
  inkStyle(context);
  for (let index = 1; index < strokePoints.length; index++) {
    const previous = strokePoints[index - 1]; const next = strokePoints[index];
    context.lineWidth = tool === 'highlighter' ? Math.max(13, size * 4) : size * (.86 + Math.min(.24, next.pressure * .24));
    context.beginPath(); context.moveTo(previous.x, previous.y); context.lineTo(next.x, next.y); context.stroke();
  }
}
function drawAssistedLine(context, start, end, pressure) {
  inkStyle(context);
  context.lineWidth = size * (.9 + Math.min(.18, pressure * .18));
  context.beginPath(); context.moveTo(start.x, start.y); context.lineTo(end.x, end.y); context.stroke();
}

function setupInk(canvas, index) {
  canvas.style.cursor = 'none';
  const context = canvas.getContext('2d');
  let drawing = false; let points = []; let holdTimer; let editableShape; let before; let lastMotion; let filteredPoint; let lastRawPoint; let lineAssist = false; let assistedEnd;
  const point = event => { const rect = canvas.getBoundingClientRect(); return { x: (event.clientX - rect.left) * canvas.width / rect.width, y: (event.clientY - rect.top) * canvas.height / rect.height, pressure: event.pressure || .5 }; };
  const restore = () => { if (before) context.putImageData(before, 0, 0); };
  const armRecognition = () => { clearTimeout(holdTimer); if (!drawing || tool !== 'pen' || editableShape) return; holdTimer = setTimeout(() => { const type = recognize(points); if (!type) return; editableShape = makeShape(type, points); restore(); drawShape(context, editableShape); toast(t(editableShape.type === 'line' ? 'recognizedLine' : 'recognizedShape')); }, 1200); };
  const editShape = nextPoint => { if (editableShape.type === 'line') { const targetAngle = angleFrom(editableShape.pivot, nextPoint); const currentAngle = editableShape.baseAngle + editableShape.rotation; editableShape.rotation += normalizedAngle(targetAngle - currentAngle) * .46; const targetLength = Math.max(14, dist(editableShape.pivot, nextPoint)); editableShape.length += (targetLength - editableShape.length) * .46; } else if (editableShape.type === 'circle') { const scale = Math.max(.15, dist(editableShape.pivot, nextPoint) / editableShape.startRadius); editableShape.rx = Math.max(11, editableShape.baseRx * scale); editableShape.ry = Math.max(11, editableShape.baseRy * scale); } else { const dx = nextPoint.x - editableShape.pivot.x; const dy = nextPoint.y - editableShape.pivot.y; editableShape.side = Math.max(18, Math.abs(dx), Math.abs(dy)); if (Math.abs(dx) > 2) editableShape.xSign = Math.sign(dx); if (Math.abs(dy) > 2) editableShape.ySign = Math.sign(dy); } restore(); drawShape(context, editableShape); };
  const redrawFreeStroke = () => { restore(); drawFreeStroke(context, points); };
  canvas.addEventListener('pointerdown', event => { drawing = true; canvas.setPointerCapture(event.pointerId); pushHistory(canvas); before = history.get(canvas).undo.at(-1); activePage = index; updatePageDisplay(); if (tool === 'eraser') { eraseAt(event); return; } points = [point(event)]; lastMotion = points[0]; filteredPoint = points[0]; lastRawPoint = points[0]; lineAssist = false; assistedEnd = null; inkStyle(context); context.beginPath(); context.moveTo(points[0].x, points[0].y); });
  canvas.addEventListener('pointermove', event => { showBrushCursor(event); if (!drawing) return; if (tool === 'eraser') { eraseAt(event); return; } const raw = point(event); if (editableShape) { editShape(raw); return; } if (dist(raw, lastRawPoint) < 1.2) return; lastRawPoint = raw; const nextPoint = { x: filteredPoint.x + (raw.x - filteredPoint.x) * .38, y: filteredPoint.y + (raw.y - filteredPoint.y) * .38, pressure: filteredPoint.pressure + (raw.pressure - filteredPoint.pressure) * .3 }; filteredPoint = nextPoint; const previous = points.at(-1); points.push(nextPoint); if (tool === 'pen' && (lineAssist || isStraightStroke(points))) { if (!isStraightStroke(points)) { lineAssist = false; assistedEnd = null; redrawFreeStroke(); } else { lineAssist = true; const priorEnd = assistedEnd || nextPoint; assistedEnd = { x: priorEnd.x + (nextPoint.x - priorEnd.x) * .52, y: priorEnd.y + (nextPoint.y - priorEnd.y) * .52, pressure: priorEnd.pressure + (nextPoint.pressure - priorEnd.pressure) * .52 }; restore(); drawAssistedLine(context, points[0], assistedEnd, assistedEnd.pressure); } } else { inkStyle(context); context.lineWidth = tool === 'highlighter' ? Math.max(13, size * 4) : size * (.86 + Math.min(.24, nextPoint.pressure * .24)); context.beginPath(); context.moveTo(previous.x, previous.y); context.lineTo(nextPoint.x, nextPoint.y); context.stroke(); } if (tool === 'pen' && dist(nextPoint, lastMotion) > 7) { lastMotion = nextPoint; armRecognition(); } });
  canvas.addEventListener('pointerup', () => { if (!drawing) return; clearTimeout(holdTimer); drawing = false; canvas.closest('.pdf-page').dataset.hasInk = 'true'; editableShape = null; before = null; lineAssist = false; assistedEnd = null; });
  canvas.addEventListener('pointerenter', showBrushCursor); canvas.addEventListener('pointerleave', hideBrushCursor);
  function eraseAt(event) { const current = point(event); context.save(); context.globalAlpha = 1; context.globalCompositeOperation = 'destination-out'; context.beginPath(); context.arc(current.x, current.y, Math.max(18, size * 4), 0, Math.PI * 2); context.fill(); context.restore(); }
}

async function openPdf() { const selected = await ipcRenderer.invoke('open-pdf'); if (selected) await loadPdf(selected.path, selected.name); }
function renderTabs() {
  const isEmpty = documents.length === 0;
  $('#tabBar').classList.toggle('is-empty', isEmpty);
  document.querySelector('.topbar').classList.toggle('no-tabs', isEmpty);
  tabs.replaceChildren(...documents.map(documentItem => {
    const tab = document.createElement('button'); tab.className = `document-tab${documentItem === activeDocument ? ' active' : ''}`; tab.type = 'button'; tab.title = documentItem.name;
    const label = document.createElement('span'); label.className = 'tab-label'; label.textContent = documentItem.name;
    const close = document.createElement('button'); close.className = 'tab-close'; close.type = 'button'; close.title = t('closeDocument', { name: documentItem.name }); close.setAttribute('aria-label', t('closeDocument', { name: documentItem.name })); close.textContent = '×';
    close.addEventListener('click', event => { event.stopPropagation(); closeDocument(documentItem); }); tab.addEventListener('click', () => activateDocument(documentItem)); tab.append(label, close); return tab;
  }));
}
function activateDocument(documentItem) {
  if (activeDocument) activeDocument.scrollTop = viewer.scrollTop;
  documents.forEach(item => { item.pagesElement.style.display = 'none'; if (item !== documentItem) item.slots?.forEach(releasePage); });
  activeDocument = documentItem; pages = documentItem.pagesElement; pages.style.display = 'flex'; pdfDocument = documentItem.pdf; sourcePath = documentItem.path; history = documentItem.history; activePage = documentItem.activePage || 1; zoom = documentItem.zoom || 1; setZoom(zoom); viewer.scrollTop = documentItem.scrollTop || 0; renderTabs(); updateZoomAvailability(); updatePageDisplay(); setTimeout(updateVisiblePages, 0);
}
function closeDocument(documentItem) {
  const index = documents.indexOf(documentItem); if (index < 0) return; documents.splice(index, 1);
  if (!documents.length) { activeDocument = null; activePage = 0; pages = documentItem.pagesElement; pages.replaceChildren(); pages.style.display = 'flex'; $('#emptyState').style.display = 'grid'; tabs.replaceChildren(); renderTabs(); updateZoomAvailability(); viewer.classList.remove('is-page-scrolling'); return; }
  documentItem.pagesElement.remove(); activateDocument(documents[Math.max(0, index - 1)]);
}
async function loadPdf(filePath, name) {
  const existing = documents.find(documentItem => documentItem.path === filePath); if (existing) { activateDocument(existing); return; }
  try {
    const bytes = await ipcRenderer.invoke('read-pdf', filePath);
    const pagesElement = documents.length ? Object.assign(document.createElement('div'), { className: 'pages' }) : pages;
    if (documents.length) viewer.append(pagesElement);
    const documentItem = { id: ++documentId, name, path: filePath, pdf: await pdfjsLib.getDocument({ data: new Uint8Array(bytes) }).promise, pagesElement, history: new Map(), zoom: 1, activePage: 1, scrollTop: 0, slots: [] };
    documents.push(documentItem); $('#emptyState').style.display = 'none'; activateDocument(documentItem); pages.replaceChildren(); for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber++) createPageSlot(documentItem, pageNumber); await updateVisiblePages(); toast(t('opened', { name }));
  } catch (error) { console.error(error); toast(t('openFailed')); }
}
async function savePdf() { if (!sourcePath) return toast(t('openFirst')); const annotations = [...pages.querySelectorAll('.ink')].map(canvas => ({ page: Number(canvas.closest('.pdf-page').dataset.page), png: canvas.toDataURL('image/png') })); const saved = await ipcRenderer.invoke('save-pdf', { sourcePath, annotations }); if (saved) toast(t('saved', { path: saved })); }
function createPageSlot(documentItem, pageNumber) { const slot = document.createElement('article'); slot.className = 'pdf-page'; slot.dataset.page = pageNumber; slot.style.width = `${Math.max(420, viewer.clientWidth - 120)}px`; slot.style.height = `${Math.round(Math.max(420, viewer.clientWidth - 120) * 1.414)}px`; slot.style.background = '#f7f9fc'; slot.innerHTML = `<div style="color:#6b7f98;padding:20px;font:12px Segoe UI">${t('pageLoading')}</div>`; documentItem.pagesElement.append(slot); documentItem.slots.push(slot); }
async function ensurePageRendered(slot, documentItem = activeDocument) { if (!documentItem || slot.dataset.rendered === 'true' || slot.dataset.rendering === 'true') return; slot.dataset.rendering = 'true'; try { const page = await documentItem.pdf.getPage(Number(slot.dataset.page)); const viewport = page.getViewport({ scale: Math.min(1.15, Math.max(.65, (viewer.clientWidth - 120) / 700)) }); slot.style.width = `${Math.ceil(viewport.width)}px`; slot.style.height = `${Math.ceil(viewport.height)}px`; const pdfCanvas = document.createElement('canvas'); pdfCanvas.width = Math.ceil(viewport.width); pdfCanvas.height = Math.ceil(viewport.height); const ink = document.createElement('canvas'); ink.className = 'ink'; ink.width = pdfCanvas.width; ink.height = pdfCanvas.height; slot.replaceChildren(pdfCanvas, ink); await page.render({ canvasContext: pdfCanvas.getContext('2d'), viewport }).promise; setupInk(ink, Number(slot.dataset.page)); slot.dataset.rendered = 'true'; } catch (error) { slot.textContent = t('pageUnavailable'); console.error(error); } finally { delete slot.dataset.rendering; } }
function releasePage(slot) { if (slot.dataset.hasInk === 'true' || slot.dataset.rendering === 'true' || slot.dataset.rendered !== 'true') return; const ink = slot.querySelector('.ink'); history.delete(ink); slot.replaceChildren(Object.assign(document.createElement('div'), { textContent: t('pageReleased') })); slot.dataset.rendered = 'false'; }
function queueVirtualPages() { if (virtualUpdateQueued) return; virtualUpdateQueued = true; requestAnimationFrame(() => { virtualUpdateQueued = false; updateVisiblePages(); }); }
async function updateVisiblePages() { if (!activeDocument) return; const view = viewer.getBoundingClientRect(); const margin = viewer.clientHeight * 1.25; for (const slot of activeDocument.slots) { const rect = slot.getBoundingClientRect(); const near = rect.bottom > view.top - margin && rect.top < view.bottom + margin; if (near) ensurePageRendered(slot, activeDocument); else releasePage(slot); } }

$('#fileMenuButton').addEventListener('click', () => togglePopover('fileMenuButton', 'fileMenu', { keepDrawing: true }));
$('#drawingMenuButton').addEventListener('click', () => togglePopover('drawingMenuButton', 'drawingPanel'));
$('#settingsButton').addEventListener('click', () => { closeAllPopovers(undefined, true); $('#settingsModal').classList.add('is-open'); $('#settingsModal').setAttribute('aria-hidden', 'false'); });
$('#closeSettingsButton').addEventListener('click', () => { $('#settingsModal').classList.remove('is-open'); $('#settingsModal').setAttribute('aria-hidden', 'true'); });
$('#settingsModal').addEventListener('click', event => { if (event.target === $('#settingsModal')) $('#closeSettingsButton').click(); });
document.addEventListener('click', event => { if (!event.target.closest('.menu-group')) closeAllPopovers(undefined, true); });

$('#openButton').addEventListener('click', () => { closeAllPopovers(undefined, true); openPdf(); });
$('#emptyOpenButton').addEventListener('click', openPdf);
$('#saveButton').addEventListener('click', () => { closeAllPopovers(undefined, true); savePdf(); });
$('#zoomIn').addEventListener('click', () => setZoom(zoom + .1));
$('#zoomOut').addEventListener('click', () => setZoom(zoom - .1));
$('#zoomReset').addEventListener('click', () => setZoom(1));
$('#minimizeButton').addEventListener('click', () => ipcRenderer.send('window-minimize'));
$('#maximizeButton').addEventListener('click', () => ipcRenderer.send('window-toggle-maximize'));
$('#closeWindowButton').addEventListener('click', () => ipcRenderer.send('window-close'));
ipcRenderer.on('open-file', (_, filePath) => loadPdf(filePath, filePath.split(/[\\/]/).pop()));
ipcRenderer.on('request-open', openPdf); ipcRenderer.on('request-save', savePdf);

function setDrawingTool(nextTool) {
  tool = nextTool;
  if (toolColors[nextTool]) color = toolColors[nextTool];
  $('#drawingPanel').dataset.activeTool = nextTool;
  document.querySelectorAll('[data-tool]').forEach(item => item.classList.toggle('active', item.dataset.tool === nextTool));
}
document.querySelectorAll('[data-tool]').forEach(button => button.addEventListener('click', () => setDrawingTool(button.dataset.tool)));
document.querySelectorAll('.swatch').forEach(button => button.addEventListener('click', () => {
  const palette = button.closest('.colors');
  color = button.dataset.color;
  if (palette.id === 'highlighterColors') toolColors.highlighter = color;
  else toolColors.pen = color;
  palette.querySelectorAll('.swatch').forEach(item => item.classList.toggle('active', item === button));
}));
$('#sizeRange').addEventListener('input', event => { size = Number(event.target.value); $('#sizeValue').textContent = `${size} px`; setRangeProgress(); });
$('#undoButton').addEventListener('click', () => undo(pages.querySelector(`.pdf-page[data-page="${activePage}"] .ink`)));
$('#clearButton').addEventListener('click', () => { const canvas = pages.querySelector(`.pdf-page[data-page="${activePage}"] .ink`); if (canvas) { pushHistory(canvas); canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height); toast(t('cleared')); } });
document.querySelectorAll('[data-theme-choice]').forEach(button => button.addEventListener('click', () => { preferences.theme = button.dataset.themeChoice; savePreferences(); applyPreferences(); }));
document.querySelectorAll('[data-language-choice]').forEach(button => button.addEventListener('click', () => { preferences.language = button.dataset.languageChoice; savePreferences(); applyPreferences(); }));

viewer.addEventListener('scroll', () => { if (activeDocument) activeDocument.scrollTop = viewer.scrollTop; const items = [...pages.querySelectorAll('.pdf-page')]; const center = viewer.scrollTop + viewer.clientHeight / 2; const found = items.findIndex(page => page.offsetTop <= center && page.offsetTop + page.offsetHeight >= center); if (found >= 0) { activePage = found + 1; updatePageDisplay({ showOnScrollbar: true }); } queueVirtualPages(); });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') { closeAllPopovers(); if ($('#settingsModal').classList.contains('is-open')) $('#closeSettingsButton').click(); }
  if (!event.ctrlKey) return;
  if (event.key === '+' || event.key === '=') { event.preventDefault(); setZoom(zoom + .1); }
  else if (event.key === '-') { event.preventDefault(); setZoom(zoom - .1); }
  else if (event.key === '0') { event.preventDefault(); setZoom(1); }
  else if (event.code === 'KeyZ' || event.key.toLowerCase() === 'z' || event.key.toLowerCase() === 'я') { event.preventDefault(); undo(pages.querySelector(`.pdf-page[data-page="${activePage}"] .ink`)); }
  else if (event.code === 'KeyY' || event.key.toLowerCase() === 'y' || event.key.toLowerCase() === 'н') { event.preventDefault(); redo(pages.querySelector(`.pdf-page[data-page="${activePage}"] .ink`)); }
});

setRangeProgress();
setDrawingTool('pen');
applyPreferences();
updateZoomAvailability();
