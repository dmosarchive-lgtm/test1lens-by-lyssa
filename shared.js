/* Shared by the site and the admin panel. */
const LBL=(()=>{
const DEFAULTS=/*DEFAULTS_JSON*/;
const DEMO_KEY="lbl-demo-content", DEMO_INBOX="lbl-demo-inbox";
const isObj=v=>v&&typeof v==="object"&&!Array.isArray(v);
function withDefaults(saved,def=DEFAULTS){if(!isObj(saved))return structuredClone(def);const out={};for(const k of Object.keys(def)){if(!(k in saved))out[k]=structuredClone(def[k]);else if(isObj(def[k])&&isObj(saved[k]))out[k]=withDefaults(saved[k],def[k]);else out[k]=saved[k]}for(const k of Object.keys(saved))if(!(k in out))out[k]=saved[k];return out}
const ls={get(k){try{return localStorage.getItem(k)}catch(_){return null}},set(k,v){try{localStorage.setItem(k,v);return true}catch(_){return false}},del(k){try{localStorage.removeItem(k)}catch(_){}}};
function demoContent(){try{const s=ls.get(DEMO_KEY);if(s)return withDefaults(JSON.parse(s))}catch(_){}return structuredClone(DEFAULTS)}
function demoInbox(item){try{const a=JSON.parse(ls.get(DEMO_INBOX)||"[]");a.unshift({key:"demo-"+Date.now(),createdAt:new Date().toISOString(),handled:false,...item});ls.set(DEMO_INBOX,JSON.stringify(a.slice(0,50)))}catch(_){}}
const get=(o,p)=>p.split(".").reduce((a,k)=>a==null?a:a[k],o);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const money=n=>{n=Number(n)||0;return Number.isInteger(n)?String(n):n.toFixed(2)};
const isEmail=v=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
// "Portraits · Wild Flower": package names repeat across session types, so show both
const pkgName=(C,p)=>{const c=((C.pricing&&C.pricing.categories)||[]).find(x=>x.id===p.cat);return c?`${c.name} · ${p.name}`:p.name};
const safeUrl=u=>typeof u==="string"&&/^(\/api\/photo\/[A-Za-z0-9-]+|https:\/\/[^\s"'<>]+|data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+)$/.test(u);
const isoDaysFromNow=d=>new Date(Date.now()+d*864e5).toISOString().slice(0,10);
const LOOKS={
  airy:{name:"Light & airy",f:"brightness(1.15) contrast(.85) saturate(.8)"},
  film:{name:"Warm film",f:"sepia(.4) saturate(1.3) contrast(1.05) hue-rotate(-8deg)"},
  moody:{name:"Moody",f:"brightness(.72) contrast(1.25) saturate(.7)"},
  bw:{name:"Black & white",f:"grayscale(1) contrast(1.08) brightness(1.05)"},
  pastel:{name:"Soft pastel",f:"brightness(1.08) contrast(.9) saturate(.7) hue-rotate(-6deg)"},
  vivid:{name:"Bright & vivid",f:"saturate(1.45) contrast(1.08)"},
  none:{name:"No filter",f:"none"}};
function slotsFor(m){const out=[];if(!m||!m.start||!m.end)return out;const step=Math.max(5,Math.min(240,Number(m.interval)||20));const toMin=t=>{const [h,mm]=String(t).split(":").map(Number);return h*60+mm};for(let t=toMin(m.start),end=toMin(m.end);t<=end&&out.length<100;t+=step)out.push(`${Math.floor(t/60)}:${String(t%60).padStart(2,"0")}`);return out}

/* cute placeholder "photos" shown until real ones are uploaded */
const PAL=[["#BFE0F5","#FDF6E3","#FFD86B","#C6E7B8","#9ED08C"],["#F9C6D0","#FFF1E6","#FFB38A","#DCCFF4","#BFAEE6"],["#DCCFF4","#FFEFF3","#FFD86B","#C6E7B8","#A6D69A"],["#FFF1A8","#FFFAF0","#FFA98A","#BFE0F5","#95C7EA"]];
function rnd(seed){let s=seed*9301+49297;return()=>((s=(s*9301+49297)%233280)/233280)}
function person(x,y,s,c){return `<g transform="translate(${x} ${y}) scale(${s})"><rect x="-17" y="-8" width="34" height="62" rx="16" fill="${c}"/><circle cy="-24" r="14" fill="#F2D2BD"/><path d="M-14 -28a14 14 0 0 1 28 0c-6-6-22-6-28 0z" fill="#6E5448"/></g>`}
const _sc={};
const SCENE_OF={portraits:["senior","couple"],groups:["family"],sports:["senior"],milestones:["couple","newborn"]};
function scene(type,seed,w=400,h=500){seed=Math.abs(seed|0);if(SCENE_OF[type]){const o=SCENE_OF[type];type=o[seed%o.length]}const key=type+seed+"x"+w+"x"+h;if(_sc[key])return _sc[key];const r=rnd(seed),p=PAL[seed%PAL.length],sh=["#FFFFFF","#F3E3D3","#E8B7C0","#C9D8EA","#EADFF5","#F9E7B5"],pick=()=>sh[Math.floor(r()*sh.length)],g=h*.66,sx=w*(.2+r()*.6),sy=h*(.18+r()*.15),k=Math.min(w,h*.8)/400;let f="";
if(type==="family"||type==="other"){const n=3+Math.floor(r()*2);for(let i=0;i<n;i++)f+=person(w*(.25+i*(.5/(n-1))),g-(i<2?30:8),(i<2?1.35:.85)*k,pick())}
else if(type==="couple"){f+=person(w*.44,g-26,1.4*k,pick())+person(w*.56,g-30,1.5*k,pick())}
else if(type==="senior"){f+=person(w*.5,g-50,2.2*k,pick())}
else{f+=`<ellipse cx="${w/2}" cy="${g+10}" rx="${w*.3}" ry="${h*.07}" fill="#FFFFFF"/><ellipse cx="${w/2}" cy="${g-4}" rx="${w*.18}" ry="${h*.05}" fill="${p[3]}"/><circle cx="${w*.34}" cy="${g-10}" r="${w*.06}" fill="#F2D2BD"/>`}
let fl="";for(let i=0;i<14;i++)fl+=`<circle cx="${r()*w}" cy="${g+10+r()*(h-g-10)}" r="${2+r()*4}" fill="${["#FFFFFF","#F7B8C2","#FCEFC7"][i%3]}" opacity=".9"/>`;
const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p[0]}"/><stop offset="1" stop-color="${p[1]}"/></linearGradient><radialGradient id="g"><stop offset="0" stop-color="${p[2]}" stop-opacity=".9"/><stop offset="1" stop-color="${p[2]}" stop-opacity="0"/></radialGradient></defs><rect width="${w}" height="${h}" fill="url(#s)"/><circle cx="${sx}" cy="${sy}" r="${w*.35}" fill="url(#g)"/><circle cx="${sx}" cy="${sy}" r="${w*.08}" fill="${p[2]}"/><path d="M0 ${g-40} Q ${w*.3} ${g-90} ${w*.6} ${g-50} T ${w} ${g-60} V ${h} H0Z" fill="${p[3]}"/><path d="M0 ${g} Q ${w*.4} ${g-30} ${w} ${g+5} V ${h} H0Z" fill="${p[4]}"/>${f}${fl}</svg>`;
return _sc[key]="data:image/svg+xml;charset=utf-8,"+encodeURIComponent(svg)}
const photoOr=(photo,kind,seed,w,h)=>safeUrl(photo)?photo:scene(kind||"family",seed,w,h);

/* talking to the site's backend (Netlify Functions) */
class ApiError extends Error{constructor(m,s){super(m);this.status=s}}
async function call(path,{method="GET",body,token,raw,type}={}){
  const ctl=new AbortController();const to=setTimeout(()=>ctl.abort(),method==="GET"?5000:30000);
  try{
    const headers={};if(token)headers.authorization="Bearer "+token;
    if(raw){headers["content-type"]=type}else if(body!==undefined)headers["content-type"]="application/json";
    const r=await fetch(path,{method,headers,body:raw||(body!==undefined?JSON.stringify(body):undefined),cache:"no-store",signal:ctl.signal});
    let data=null;try{data=await r.json()}catch(_){}
    if(!r.ok)throw new ApiError((data&&data.error)||`Something went wrong (${r.status}). Please try again.`,r.status);
    if(data===null)throw new ApiError("The server sent back something unexpected.",r.status);
    return data;
  }catch(e){if(e instanceof ApiError)throw e;throw new ApiError(e.name==="AbortError"?"The connection timed out. Please try again.":"Couldn't reach the server. Check your connection.",0)}
  finally{clearTimeout(to)}}
const api={
  async content(){try{const d=await call("/api/content");return d&&d.live?withDefaults(d.content):null}catch(_){return null}},
  checkout:b=>call("/api/checkout",{method:"POST",body:b}),
  booking:id=>call("/api/booking?id="+encodeURIComponent(id)),
  bookings:token=>call("/api/bookings",{token}),
  bookingCreate:(token,b)=>call("/api/bookings",{method:"POST",body:b,token}),
  bookingPatch:(token,b)=>call("/api/bookings",{method:"PATCH",body:b,token}),
  calendar:(token,test)=>test?call("/api/calendar",{method:"POST",body:{test:true},token}):call("/api/calendar",{token}),
  inquiry:b=>call("/api/inquiry",{method:"POST",body:b}),
  login:pw=>call("/api/login",{method:"POST",body:{password:pw}}),
  save:(token,content)=>call("/api/content",{method:"PUT",body:{content},token}),
  upload:(token,blob)=>call("/api/upload",{method:"POST",raw:blob,type:blob.type||"image/jpeg",token}),
  inbox:token=>call("/api/inbox",{token}),
  inboxPatch:(token,b)=>call("/api/inbox",{method:"PATCH",body:b,token}),
  inboxDelete:(token,b)=>call("/api/inbox",{method:"DELETE",body:b,token}),
};
return{DEFAULTS,DEMO_KEY,DEMO_INBOX,withDefaults,demoContent,demoInbox,ls,get,esc,money,isEmail,safeUrl,pkgName,isoDaysFromNow,LOOKS,slotsFor,scene,photoOr,api,ApiError};
})();
