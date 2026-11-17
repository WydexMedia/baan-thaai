/* Baan Thai — shared helpers for the guest page and the staff page. */
"use strict";
const ASSET_BASE = new URL(".", document.currentScript.src).href;
const STATUS_LABEL = {confirmed:"Booked", checked_in:"Arrived", no_show:"No-show", cancelled:"Cancelled"};
const SRC_LABEL = {online:"Online", phone:"Phone call", walkin:"Walk-in"};
const CODES = ["+91","+971","+966","+974","+965","+968","+973","+44","+1","+66","+65","+60","+61","+49","+33"];

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function toast(msg){const t=$("#toast");if(!t)return;t.textContent=msg;t.hidden=false;clearTimeout(toast._t);toast._t=setTimeout(()=>t.hidden=true,3600)}
function lsGet(k,d){try{const v=localStorage.getItem(k);return v?JSON.parse(v):d}catch(e){return d}}
function lsSet(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}
function lsDel(k){try{localStorage.removeItem(k)}catch(e){}}

/* ---------- talking to the Google Sheet backend ---------- */
function apiReady(){const u=window.BAAN_THAI_API||"";return /^https:\/\/script\.google(usercontent)?\.com\//.test(u)||/^\/|^http:\/\/localhost/.test(u)}
async function api(action, data){
  if(!apiReady()) throw Object.assign(new Error("Online booking isn't switched on yet. Please call the cafe to book."),{code:"setup"});
  let res, j;
  try{ res = await fetch(window.BAAN_THAI_API, {method:"POST", body:JSON.stringify(Object.assign({action}, data||{})), redirect:"follow"}); }
  catch(e){ throw Object.assign(new Error("Can't reach the booking system. Check your internet connection and try again."),{code:"network"}); }
  try{ j = await res.json(); }
  catch(e){ throw Object.assign(new Error("The booking system sent an unexpected reply. Please try again in a minute."),{code:"server"}); }
  if(!j.ok) throw Object.assign(new Error(j.error||"Something went wrong. Please try again."),{code:j.code});
  return j;
}

/* ---------- time: always India time (IST) ---------- */
function istNow(){
  const p={};new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date()).forEach(x=>p[x.type]=x.value);
  return {date:`${p.year}-${p.month}-${p.day}`, min:(+p.hour)*60+(+p.minute)};
}
function addDays(d,n){const [y,m,dd]=d.split("-").map(Number);return new Date(Date.UTC(y,m-1,dd+n)).toISOString().slice(0,10)}
function dParts(d){const [y,m,dd]=d.split("-").map(Number);const t=new Date(Date.UTC(y,m-1,dd));
  return {wd:t.toLocaleDateString("en-GB",{weekday:"short",timeZone:"UTC"}),day:String(dd).padStart(2,"0"),mon:t.toLocaleDateString("en-GB",{month:"short",timeZone:"UTC"}),yr:y,
    long:t.toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"long",year:"numeric",timeZone:"UTC"})}}
function toMin(t){const [h,m]=t.split(":").map(Number);return h*60+m}
function hhmm(m){return String(Math.floor(m/60)).padStart(2,"0")+":"+String(m%60).padStart(2,"0")}
function t12(t){let [h,m]=t.split(":").map(Number);const ap=h<12?"AM":"PM";h=h%12||12;return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")} ${ap}`}
function relDay(d){const n=istNow().date;return d===n?"Today":d===addDays(n,1)?"Tomorrow":d===addDays(n,-1)?"Yesterday":""}
function dayLabel(d){return relDay(d)||dParts(d).wd}
function guestsText(b){return `${b.adults} adult${b.adults>1?"s":""}${b.kids?` · ${b.kids} kid${b.kids>1?"s":""}`:""}`}
function fmtStamp(s){if(!s)return "—";const m=/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})$/.exec(s);if(!m)return s;const p=dParts(m[1]);return `${+p.day} ${p.mon}, ${t12(m[2])}`}
function copyText(s){try{navigator.clipboard.writeText(s).then(()=>toast("Copied "+s),()=>toast(s))}catch(e){toast(s)}}

/* ---------- the boarding-pass ticket ---------- */
let tplImg=null;
function loadTpl(){return tplImg?Promise.resolve(tplImg):new Promise((r,j)=>{const i=new Image();i.onload=()=>{tplImg=i;r(i)};i.onerror=j;i.src=ASSET_BASE+"ticket-template.jpg"})}
async function fontsReady(){try{await Promise.all([document.fonts.load("600 40px Saira"),document.fonts.load("400 24px Saira")])}catch(e){}}
function qrPayload(b){return `BAANTHAI|${b.code}|${b.key}`}
function drawQR(ctx,text,x,y,size){
  const q=qrcode(0,"M");q.addData(text);q.make();const n=q.getModuleCount();const cell=size/(n+2);
  ctx.fillStyle="#fff";ctx.fillRect(x,y,size,size);ctx.fillStyle="#170f19";
  for(let r=0;r<n;r++)for(let c=0;c<n;c++)if(q.isDark(r,c))ctx.fillRect(Math.round(x+(c+1)*cell),Math.round(y+(r+1)*cell),Math.ceil(cell),Math.ceil(cell));
}
async function paintTicket(b,cv){
  if(!cv)return;await Promise.all([loadTpl(),fontsReady()]);
  const K=4,ctx=cv.getContext("2d"),BASE=1.1;
  ctx.drawImage(tplImg,0,0,1728,864);
  const T=(txt,x,top,size,w,o={})=>{let s=size;ctx.font=`${w} ${s*K}px Saira, "Arial Narrow", sans-serif`;
    if(o.max){while(ctx.measureText(txt).width>o.max*K&&s>4){s-=.25;ctx.font=`${w} ${s*K}px Saira, "Arial Narrow", sans-serif`}}
    ctx.fillStyle=o.color||"#ffffff";ctx.textAlign=o.align||"left";ctx.textBaseline="alphabetic";
    ctx.fillText(txt,x*K,(top+size*BASE+(size-s)*0.5)*K)};
  const p=dParts(b.date),name=b.name.toUpperCase(),gs=`${b.guests} PAX`;
  T("BOARDING PASS",166,32.5,12,600,{align:"center"});
  T("PASSENGER NAME",20,91,6,400);T(name,19,97,12,600,{max:215});
  T("FROM",20,123,6,400);T("CALICUT",19,128,10,600);
  T("TO",146,123,6,400);T("BANGKOK",146,128,10,600);
  T("BOOKING",20,153,6,400);T(b.code,19,159,10,600,{max:64});
  T("DATE",87,153,6,400);T(`${p.day} ${p.mon.toUpperCase()} ${String(p.yr).slice(2)}`,87,159,10,600,{max:56});
  T("TIME",148,153,6,400);T(b.time,148,159,10,600);
  T("GUESTS",189,153,6,400);T(gs,189,159,10,600,{max:44});
  T("SEAT",237,153,6,400);T(b.table?String(b.table).toUpperCase():"OPEN",236,159,10,600,{max:60});
  T("Reserved - Valid for fine dining",166,190,10,400,{align:"center"});
  T("PASSENGER NAME",332,72,5,400);T(name,331,77,10,600,{max:55});
  [["FROM","CALICUT"],["TO","BANGKOK"],["BOOKING",b.code],["DATE",`${p.day} ${p.mon.toUpperCase()} ${p.yr}`],["TIME",t12(b.time)],["GUESTS",gs]]
    .forEach((r,i)=>{T(r[0],331,99+i*10,5,400);T(r[1],365,99+i*10,6,600,{max:60})});
  T("SEAT",331,159,5,400);T(b.table?String(b.table).toUpperCase():"OPEN",365,157,9,600,{max:50});
  T("Reserved - Valid for",375.5,188,6.6,400,{align:"center"});T("fine dining",375.5,196,6.6,400,{align:"center"});
  drawQR(ctx,qrPayload(b),250.05*K,88.2*K,52.11*K);
  drawQR(ctx,qrPayload(b),388.8*K,60.87*K,28.1*K);
  if(b.status==="cancelled"){ctx.save();ctx.translate(864,432);ctx.rotate(-.18);ctx.font="600 150px Saira, sans-serif";ctx.textAlign="center";ctx.fillStyle="rgba(238,46,72,.75)";ctx.fillText("CANCELLED",0,50);ctx.restore()}
}
async function ticketCanvas(b){const cv=document.createElement("canvas");cv.width=1728;cv.height=864;await paintTicket(b,cv);return cv}
async function downloadPdf(b){
  const cv=await ticketCanvas(b);
  const doc=new jspdf.jsPDF({orientation:"landscape",unit:"pt",format:[432,216]});
  doc.addImage(cv.toDataURL("image/jpeg",0.93),"JPEG",0,0,432,216);
  doc.setProperties({title:`Baan Thai reservation ${b.code}`,subject:"Table reservation",author:"Baan Thai Kitchen & Cafe"});
  doc.save(`BaanThai-${b.code}.pdf`);
}
async function downloadImage(b){
  const cv=await ticketCanvas(b);
  cv.toBlob(bl=>{const a=document.createElement("a");a.href=URL.createObjectURL(bl);a.download=`BaanThai-${b.code}.jpg`;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},2000)},"image/jpeg",0.92);
}
