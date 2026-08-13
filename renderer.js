const { ipcRenderer } = require('electron');
const path = require('path');
const runningFromElectronDevFolder = process.resourcesPath.includes(`${path.sep}node_modules${path.sep}electron${path.sep}`);
const pdfjsRoot = runningFromElectronDevFolder ? path.join(__dirname, 'node_modules', 'pdfjs-dist', 'legacy', 'build') : path.join(process.resourcesPath, 'pdfjs');
const pdfjsLib = require(path.join(pdfjsRoot, 'pdf.js'));
pdfjsLib.GlobalWorkerOptions.workerSrc = path.join(pdfjsRoot, 'pdf.worker.js');

const $ = (s) => document.querySelector(s);
let pages = $('#pages'); const viewer = $('#viewer'), tabs = $('#tabs');
let color = '#59a7ff', size = 4, tool = 'pen', history = new Map(), activePage = 0, zoom = 1;
let pdfDocument, sourcePath, activeDocument, documentId = 0;
const documents = [];

function toast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 2200); }
function setZoom(nextZoom) { zoom = Math.min(2.5, Math.max(.5, Math.round(nextZoom * 10) / 10)); pages.style.zoom = zoom; $('#zoomValue').textContent = `${Math.round(zoom * 100)}%`; if(activeDocument) activeDocument.zoom = zoom; queueVirtualPages?.(); }
const brushCursor=Object.assign(document.createElement('div'),{className:'brush-cursor'});Object.assign(brushCursor.style,{position:'fixed',zIndex:99,pointerEvents:'none',display:'none',border:'1px solid #59a7ff',borderRadius:'50%',transform:'translate(-50%,-50%)',boxSizing:'border-box'});document.body.append(brushCursor);
function showBrushCursor(event){if(event.pointerType==='mouse'||event.pointerType==='pen'){brushCursor.style.display='block';brushCursor.style.left=`${event.clientX}px`;brushCursor.style.top=`${event.clientY}px`;brushCursor.style.width=`${size}px`;brushCursor.style.height=`${size}px`;brushCursor.style.borderColor=color;}}
function hideBrushCursor(){brushCursor.style.display='none';}
function inkStyle(ctx) { ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = color; ctx.lineWidth = size; ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; }
function pushHistory(canvas) { const state = history.get(canvas) || { undo: [], redo: [] }; state.undo.push(canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height)); if(state.undo.length > 8) state.undo.shift(); state.redo = []; history.set(canvas,state); }
function undo(canvas) { const state = history.get(canvas); if(!canvas || !state?.undo.length) return; state.redo.push(canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height)); canvas.getContext('2d').putImageData(state.undo.pop(),0,0); }
function redo(canvas) { const state = history.get(canvas); if(!canvas || !state?.redo.length) return; state.undo.push(canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height)); canvas.getContext('2d').putImageData(state.redo.pop(),0,0); }

function pointsBox(points) { const xs=points.map(p=>p.x), ys=points.map(p=>p.y); return {x:Math.min(...xs),y:Math.min(...ys),w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys)}; }
function dist(a,b) { return Math.hypot(a.x-b.x,a.y-b.y); }
function pointSegmentDistance(point,start,end){const dx=end.x-start.x,dy=end.y-start.y;if(!dx&&!dy)return dist(point,start);const t=Math.max(0,Math.min(1,((point.x-start.x)*dx+(point.y-start.y)*dy)/(dx*dx+dy*dy)));return Math.hypot(point.x-(start.x+t*dx),point.y-(start.y+t*dy));}
function simplified(points,epsilon=11){if(points.length<3)return points;let max=0,index=0;for(let i=1;i<points.length-1;i++){const d=pointSegmentDistance(points[i],points[0],points.at(-1));if(d>max){max=d;index=i}}if(max>epsilon){const left=simplified(points.slice(0,index+1),epsilon),right=simplified(points.slice(index),epsilon);return [...left.slice(0,-1),...right]}return [points[0],points.at(-1)];}
function recognize(points) {
  if (points.length < 7) return null;
  const b=pointsBox(points), first=points[0], last=points.at(-1), closed=dist(first,last)<Math.max(18,Math.min(b.w,b.h)*.24);
  if (!closed && dist(first,last)>45 && b.w+b.h>60) return 'line';
  if (!closed || b.w<22 || b.h<22) return null;
  let simple=simplified(points.slice(0,-1)).filter((p,i,list)=>i===0||dist(p,list[i-1])>5);if(simple.length>2&&dist(simple[0],simple.at(-1))<20)simple=simple.slice(0,-1);const ratio=b.w/b.h, center={x:b.x+b.w/2,y:b.y+b.h/2};
  if (simple.length===4 && ratio>.72 && ratio<1.38) return 'square';
  const radii=points.map(p=>dist(p,center)), average=radii.reduce((a,v)=>a+v,0)/radii.length;
  const variation=Math.sqrt(radii.reduce((a,v)=>a+(v-average)**2,0)/radii.length)/average;
  if (variation < .22 && ratio>.68 && ratio<1.45) return 'circle';
  return null;
}
function angleFrom(pivot,point){return Math.atan2(point.y-pivot.y,point.x-pivot.x)}
function normalizedAngle(angle){while(angle>Math.PI)angle-=Math.PI*2;while(angle<-Math.PI)angle+=Math.PI*2;return angle}
function makeShape(type,points){const box=pointsBox(points),last=points.at(-1);if(type==='line'){const pivot=points[0],end=last;return{type,pivot,length:dist(pivot,end),baseAngle:angleFrom(pivot,end),rotation:0}}if(type==='circle'){const pivot={x:box.x+box.w/2,y:box.y+box.h/2},rx=Math.max(11,box.w/2),ry=Math.max(11,box.h/2);return{type,pivot,rx,ry,baseRx:rx,baseRy:ry,startRadius:Math.max(1,dist(pivot,last))}}const side=Math.max(22,box.w,box.h);return{type:'square',pivot:{x:box.x,y:box.y+box.h},side,xSign:1,ySign:-1}}
function drawShape(ctx,shape){inkStyle(ctx);ctx.save();ctx.translate(shape.pivot.x,shape.pivot.y);ctx.beginPath();if(shape.type==='line'){ctx.rotate(shape.baseAngle+shape.rotation);ctx.moveTo(0,0);ctx.lineTo(shape.length,0)}else if(shape.type==='circle'){ctx.ellipse(0,0,shape.rx,shape.ry,0,0,Math.PI*2)}else if(shape.type==='square'){ctx.rect(0,shape.ySign<0?-shape.side:0,shape.xSign*shape.side,shape.side)}ctx.stroke();ctx.restore();}
function setupInk(canvas,index) {
  canvas.style.cursor='none';const ctx=canvas.getContext('2d'); let drawing=false, pts=[], holdTimer, editableShape, before, lastMotion, filteredPoint, lastRawPoint;
  const point=(event)=>{const r=canvas.getBoundingClientRect(); return {x:(event.clientX-r.left)*canvas.width/r.width,y:(event.clientY-r.top)*canvas.height/r.height,pressure:event.pressure||.5};};
  const restore=()=>{ if(before)ctx.putImageData(before,0,0); };
  const armRecognition=()=>{clearTimeout(holdTimer);if(!drawing||tool!=='pen'||editableShape)return;holdTimer=setTimeout(()=>{const type=recognize(pts);if(!type)return;editableShape=makeShape(type,pts);editableShape.lastPointerAngle=angleFrom(editableShape.pivot,pts.at(-1));restore();drawShape(ctx,editableShape);toast(editableShape.type==='line'?'Линия распознана — не отпуская перо, поверните её':'Фигура распознана — не отпуская перо, измените размер');},2000);};
  const editShape=(p)=>{if(editableShape.type==='line'){const currentAngle=angleFrom(editableShape.pivot,p);editableShape.rotation+=normalizedAngle(currentAngle-editableShape.lastPointerAngle);editableShape.lastPointerAngle=currentAngle}else if(editableShape.type==='circle'){const scale=Math.max(.15,dist(editableShape.pivot,p)/editableShape.startRadius);editableShape.rx=Math.max(11,editableShape.baseRx*scale);editableShape.ry=Math.max(11,editableShape.baseRy*scale)}else{const dx=p.x-editableShape.pivot.x,dy=p.y-editableShape.pivot.y;editableShape.side=Math.max(18,Math.abs(dx),Math.abs(dy));if(Math.abs(dx)>2)editableShape.xSign=Math.sign(dx);if(Math.abs(dy)>2)editableShape.ySign=Math.sign(dy)}restore();drawShape(ctx,editableShape);};
  canvas.addEventListener('pointerdown', e=>{ drawing=true; canvas.setPointerCapture(e.pointerId); pushHistory(canvas); before=history.get(canvas).undo.at(-1); activePage=index; if(tool==='eraser'){eraseAt(e);return} pts=[point(e)];lastMotion=pts[0];filteredPoint=pts[0];lastRawPoint=pts[0]; inkStyle(ctx);ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y); });
  canvas.addEventListener('pointermove', e=>{showBrushCursor(e);if(!drawing)return;if(tool==='eraser'){eraseAt(e);return}const raw=point(e);if(editableShape){editShape(raw);return}if(dist(raw,lastRawPoint)<1.2)return;lastRawPoint=raw;const p={x:filteredPoint.x+(raw.x-filteredPoint.x)*.38,y:filteredPoint.y+(raw.y-filteredPoint.y)*.38,pressure:filteredPoint.pressure+(raw.pressure-filteredPoint.pressure)*.3};filteredPoint=p;const prev=pts.at(-1);pts.push(p);inkStyle(ctx);ctx.lineWidth=size*(.86+Math.min(.24,p.pressure*.24));ctx.beginPath();ctx.moveTo(prev.x,prev.y);ctx.lineTo(p.x,p.y);ctx.stroke();if(dist(p,lastMotion)>7){lastMotion=p;armRecognition()}});
  canvas.addEventListener('pointerup', ()=>{if(!drawing)return;clearTimeout(holdTimer);drawing=false;canvas.closest('.pdf-page').dataset.hasInk='true';editableShape=null;before=null;});
  canvas.addEventListener('pointerenter',showBrushCursor);canvas.addEventListener('pointerleave',hideBrushCursor);
  function eraseAt(e){const p=point(e);ctx.save();ctx.globalCompositeOperation='destination-out';ctx.beginPath();ctx.arc(p.x,p.y,Math.max(18,size*4),0,Math.PI*2);ctx.fill();ctx.restore();}
}
async function openPdf() {
  const selected=await ipcRenderer.invoke('open-pdf'); if(selected) await loadPdf(selected.path, selected.name);
}
Object.assign(tabs.style,{display:'flex',alignItems:'center',gap:'6px',maxWidth:'38vw',overflowX:'auto',padding:'5px',WebkitAppRegion:'no-drag'});
function renderTabs(){tabs.replaceChildren(...documents.map(doc=>{const tab=document.createElement('button');tab.textContent=`${doc.name}  ×`;Object.assign(tab.style,{border:'1px solid '+(doc===activeDocument?'#4a9fff':'#294968'),background:doc===activeDocument?'#12365f':'#0b1d33',color:'#d7ebff',borderRadius:'7px',padding:'7px 10px',fontSize:'11px',whiteSpace:'nowrap',cursor:'pointer'});tab.onclick=(event)=>{if(event.target===tab&&event.offsetX>tab.clientWidth-24){closeDocument(doc);return}activateDocument(doc)};return tab}));}
function activateDocument(doc){if(activeDocument)activeDocument.scrollTop=viewer.scrollTop;documents.forEach(d=>{d.pagesElement.style.display='none';if(d!==doc)d.slots?.forEach(releasePage)});activeDocument=doc;pages=doc.pagesElement;pages.style.display='flex';pdfDocument=doc.pdf;sourcePath=doc.path;history=doc.history;zoom=doc.zoom||1;setZoom(zoom);viewer.scrollTop=doc.scrollTop||0;$('#documentName').textContent=doc.name;$('#pageTotal').textContent=pdfDocument.numPages;$('#pageCurrent').textContent=doc.activePage||1;renderTabs();setTimeout(updateVisiblePages,0);}
function closeDocument(doc){const index=documents.indexOf(doc);if(index<0)return;documents.splice(index,1);if(!documents.length){activeDocument=null;pages=doc.pagesElement;pages.replaceChildren();pages.style.display='flex';$('#emptyState').style.display='flex';$('#documentName').textContent='Документ не выбран';$('#pageCurrent').textContent='—';$('#pageTotal').textContent='—';tabs.replaceChildren();return}doc.pagesElement.remove();activateDocument(documents[Math.max(0,index-1)]);}
async function loadPdf(filePath, name) {
  const existing=documents.find(doc=>doc.path===filePath);if(existing){activateDocument(existing);return}
  try { const bytes=await ipcRenderer.invoke('read-pdf', filePath);const pagesElement=documents.length?Object.assign(document.createElement('div'),{className:'pages'}):pages;if(documents.length)viewer.append(pagesElement);const doc={id:++documentId,name,path:filePath,pdf:await pdfjsLib.getDocument({data:new Uint8Array(bytes)}).promise,pagesElement,history:new Map(),zoom:1,activePage:1,scrollTop:0,slots:[]};documents.push(doc);$('#emptyState').style.display='none';activateDocument(doc);pages.replaceChildren();for(let i=1;i<=pdfDocument.numPages;i++)createPageSlot(doc,i);await updateVisiblePages();toast(`Открыт файл: ${name}`); } catch(e){ console.error(e); toast('Не удалось открыть PDF'); }
}
async function savePdf(){ if(!sourcePath)return toast('Сначала откройте PDF'); const annotations=[...pages.querySelectorAll('.ink')].map(canvas=>({page:Number(canvas.closest('.pdf-page').dataset.page),png:canvas.toDataURL('image/png')})); const saved=await ipcRenderer.invoke('save-pdf',{sourcePath,annotations}); if(saved)toast(`Сохранено: ${saved}`); }
function createPageSlot(doc,pageNumber){const slot=document.createElement('article');slot.className='pdf-page';slot.dataset.page=pageNumber;slot.style.width=`${Math.max(420,viewer.clientWidth-180)}px`;slot.style.height=`${Math.round(Math.max(420,viewer.clientWidth-180)*1.414)}px`;slot.style.background='#f7f9fc';slot.innerHTML='<div style="color:#6b7f98;padding:20px;font:12px Segoe UI">Страница загружается…</div>';doc.pagesElement.append(slot);doc.slots.push(slot);}
async function ensurePageRendered(slot,doc=activeDocument){if(!doc||slot.dataset.rendered==='true'||slot.dataset.rendering==='true')return;slot.dataset.rendering='true';try{const page=await doc.pdf.getPage(Number(slot.dataset.page));const viewport=page.getViewport({scale:Math.min(1.15,Math.max(.65,(viewer.clientWidth-180)/700))});slot.style.width=`${Math.ceil(viewport.width)}px`;slot.style.height=`${Math.ceil(viewport.height)}px`;const pdfCanvas=document.createElement('canvas');pdfCanvas.width=Math.ceil(viewport.width);pdfCanvas.height=Math.ceil(viewport.height);const ink=document.createElement('canvas');ink.className='ink';ink.width=pdfCanvas.width;ink.height=pdfCanvas.height;slot.replaceChildren(pdfCanvas,ink);await page.render({canvasContext:pdfCanvas.getContext('2d'),viewport}).promise;setupInk(ink,Number(slot.dataset.page));slot.dataset.rendered='true';}catch(error){slot.textContent='Не удалось отрисовать страницу';console.error(error)}finally{delete slot.dataset.rendering;}}
function releasePage(slot){if(slot.dataset.hasInk==='true'||slot.dataset.rendering==='true'||slot.dataset.rendered!=='true')return;const ink=slot.querySelector('.ink');history.delete(ink);slot.replaceChildren(Object.assign(document.createElement('div'),{textContent:'Страница выгружена для экономии памяти'}));slot.dataset.rendered='false';}
let virtualUpdateQueued=false;function queueVirtualPages(){if(virtualUpdateQueued)return;virtualUpdateQueued=true;requestAnimationFrame(()=>{virtualUpdateQueued=false;updateVisiblePages()})}
async function updateVisiblePages(){if(!activeDocument)return;const view=viewer.getBoundingClientRect(),margin=viewer.clientHeight*1.25;for(const slot of activeDocument.slots){const rect=slot.getBoundingClientRect(),near=rect.bottom>view.top-margin&&rect.top<view.bottom+margin;if(near)ensurePageRendered(slot,activeDocument);else releasePage(slot);}}

$('#openButton').addEventListener('click',openPdf); $('#emptyOpenButton').addEventListener('click',openPdf);
$('#saveButton').addEventListener('click',savePdf);
ipcRenderer.on('open-file',(_,filePath)=>loadPdf(filePath, filePath.split(/[\\/]/).pop())); ipcRenderer.on('request-open',openPdf); ipcRenderer.on('request-save',savePdf);
document.querySelectorAll('[data-tool]').forEach(b=>b.addEventListener('click',()=>{tool=b.dataset.tool;document.querySelectorAll('[data-tool]').forEach(x=>x.classList.toggle('active',x===b));}));
document.querySelectorAll('.swatch').forEach(b=>b.addEventListener('click',()=>{color=b.dataset.color;document.querySelectorAll('.swatch').forEach(x=>x.classList.toggle('active',x===b));}));
document.querySelectorAll('.swatch').forEach(b=>b.style.boxShadow='none');
$('#sizeRange').addEventListener('input',e=>{$('#sizeValue').textContent=`${size=e.target.value} px`;});
const activeCanvas=()=>pages.querySelector(`.pdf-page[data-page="${activePage}"] .ink`);
$('#undoButton').addEventListener('click',()=>undo(activeCanvas()));
$('#clearButton').addEventListener('click',()=>{const canvas=activeCanvas();if(canvas){pushHistory(canvas);canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);toast('Пометки на странице очищены')}});
viewer.addEventListener('scroll',()=>{if(activeDocument)activeDocument.scrollTop=viewer.scrollTop;const items=[...pages.querySelectorAll('.pdf-page')];const center=viewer.scrollTop+viewer.clientHeight/2;const found=items.findIndex(p=>p.offsetTop<=center&&p.offsetTop+p.offsetHeight>=center);if(found>=0){activePage=found+1;if(activeDocument)activeDocument.activePage=activePage;$('#pageCurrent').textContent=activePage;}queueVirtualPages();});
document.addEventListener('keydown',(event)=>{if(!event.ctrlKey)return;if(event.key==='+'||event.key==='='){event.preventDefault();setZoom(zoom+.1)}else if(event.key==='-'){event.preventDefault();setZoom(zoom-.1)}else if(event.key==='0'){event.preventDefault();setZoom(1)}else if(event.code==='KeyZ'||event.key.toLowerCase()==='z'||event.key.toLowerCase()==='я'){event.preventDefault();undo(activeCanvas())}else if(event.code==='KeyY'||event.key.toLowerCase()==='y'||event.key.toLowerCase()==='н'){event.preventDefault();redo(activeCanvas())}});
