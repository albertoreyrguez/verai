import { useState, useEffect, useRef, useCallback } from "react";

const STYLES_LIST = ["Cultura","Gastronomía","Aventura","Relax","Fiesta","Naturaleza","Budget"];
const LOAD_STEPS = ["Analizando destino","Buscando hoteles reales","Comparando transporte","Generando itinerario","Preparando tu plan"];
const INSPIRE_STEPS = ["Procesando tu perfil","Buscando destinos","Calculando presupuestos","Comparando opciones"];
const TI = { flight:"✈️", train:"🚄", bus:"🚌", ferry:"⛴️" };
const TL = { flight:"Vuelo", train:"Tren", bus:"Autobús", ferry:"Ferry" };
const PICON = { morning:"🌅", afternoon:"☀️", evening:"🌙" };
const PLBL = { morning:"Mañana", afternoon:"Tarde", evening:"Noche" };
const SR = "verai:result-v3", SC = "verai:cart-v3";

function extractJSON(t) {
  if (!t) throw new Error("Texto vacío");
  try { return JSON.parse(t); } catch {}
  const s = t.replace(/```json\s*/gi,"").replace(/```\s*/gi,"").trim();
  try { return JSON.parse(s); } catch {}
  let best = null;
  for (let i = 0; i < t.length; i++) {
    if (t[i] !== "{") continue;
    let depth = 0;
    for (let j = i; j < t.length; j++) {
      if (t[j] === "{") depth++;
      else if (t[j] === "}") {
        depth--;
        if (depth === 0) {
          try {
            const r = JSON.parse(t.slice(i, j+1));
            if (!best || (j-i) > best.len) best = { r, len: j-i };
          } catch {}
          break;
        }
      }
    }
  }
  if (best) return best.r;
  throw new Error("No se pudo leer la respuesta");
}

const calcNights = (ci, co) => (!ci||!co) ? 0 : Math.max(1, Math.round((new Date(co)-new Date(ci))/86400000));
const pct = (a, b) => (!b||b<=0) ? 0 : Math.min(100, Math.round(a/b*100));
const enc = s => encodeURIComponent(s||"");

const hotelLinks = (dest, ci, co, t=1) => [
  { l:"Booking.com", url:`https://www.booking.com/searchresults.html?ss=${enc(dest)}&checkin=${ci||""}&checkout=${co||""}&group_adults=${t}`, c:"#003580" },
  { l:"Airbnb", url:`https://www.airbnb.com/s/${enc(dest)}/homes?checkin=${ci||""}&checkout=${co||""}&adults=${t}`, c:"#FF5A5F" },
  { l:"Hotels.com", url:`https://hotels.com/search.do?q-destination=${enc(dest)}&q-check-in=${ci||""}&q-check-out=${co||""}&q-room-0-adults=${t}`, c:"#C00" },
];
const flightLinks = (o, dest, date, t=1) => [
  { l:"Google Flights", url:`https://www.google.com/travel/flights?q=flights+from+${enc(o)}+to+${enc(dest)}`, c:"#4285F4" },
  { l:"Skyscanner", url:`https://www.skyscanner.net/transport/flights/${enc(o)}/${enc(dest)}/${date||""}`, c:"#00A698" },
  { l:"Kayak", url:`https://www.kayak.es/vuelos/${enc(o)}-${enc(dest)}/${date||""}/${t}adultos`, c:"#FF690F" },
];
const trainLinks = (o, dest) => [
  { l:"Trainline", url:"https://www.thetrainline.com/es", c:"#2D9B71" },
  { l:"BlaBlaCar", url:`https://www.blablacar.es/search?fn=${enc(o)}&tn=${enc(dest)}`, c:"#00B2EE" },
  { l:"Rome2rio", url:`https://www.rome2rio.com/map/${enc(o)}/${enc(dest)}`, c:"#FF6E42" },
];
const activityLinks = dest => [
  { l:"GetYourGuide", url:`https://www.getyourguide.com/s/?q=${enc(dest)}`, c:"#FF6B35" },
  { l:"Viator", url:`https://www.viator.com/search/${enc(dest)}`, c:"#1D9BF0" },
  { l:"TripAdvisor", url:`https://www.tripadvisor.com/Search?q=${enc(dest)}`, c:"#00AA6C" },
];
function getTransportLinks(type, origin, dest, date, travelers) {
  if (type === "flight") return flightLinks(origin, dest, date, travelers);
  if (type === "train") return trainLinks(origin, dest);
  if (type === "bus") return [{ l:"FlixBus", url:"https://www.flixbus.es", c:"#73D700" }, { l:"BlaBlaCar", url:`https://www.blablacar.es/search?fn=${enc(origin)}&tn=${enc(dest)}`, c:"#00B2EE" }];
  return trainLinks(origin, dest);
}
function shareText(result, cart, nightsN, cartSpent) {
  const lines = [
    `🌍 Viaje a ${result.destination} — planificado con verai`, "",
    `⭐ Puntuación: ${result.score}/10`,
    `👥 ${result.travelers} viajero(s) · ${nightsN} noches`,
    cart.hotel ? `🏨 ${cart.hotel.name} — ${cart.hotel.price_per_night * nightsN}€` : null,
    cart.transport ? `${TI[cart.transport.type]||"🚗"} ${cart.transport.label} — ${cart.transport.price_pp * result.travelers}€` : null,
    cartSpent > 0 ? `💰 Total estimado: ${cartSpent}€` : null,
    "", result.honest_take,
  ].filter(x => x !== null);
  return lines.join("\n");
}

let gmapsLoaderPromise = null;
function loadGoogleMaps(key) {
  if (window.google?.maps) return Promise.resolve(window.google.maps);
  if (gmapsLoaderPromise) return gmapsLoaderPromise;
  gmapsLoaderPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${key}`;
    s.async = true;
    s.onload = () => resolve(window.google.maps);
    s.onerror = () => { gmapsLoaderPromise = null; reject(new Error("Error al cargar Google Maps")); };
    document.head.appendChild(s);
  });
  return gmapsLoaderPromise;
}

function useIsMobile(bp=768) {
  const [m, setM] = useState(window.innerWidth < bp);
  useEffect(() => {
    const h = () => setM(window.innerWidth < bp);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, [bp]);
  return m;
}
function useToast() {
  const [toasts, setToasts] = useState([]);
  const show = useCallback((msg, color="#222") => {
    const id = Date.now();
    setToasts(t => [...t, {id, msg, color}]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 2400);
  }, []);
  return { toasts, show };
}

function ToastContainer({ toasts }) {
  if (!toasts.length) return null;
  return (
    <div style={{ position:"fixed", top:58, left:0, right:0, zIndex:600, display:"flex", flexDirection:"column", alignItems:"center", gap:6, pointerEvents:"none", padding:"0 16px" }}>
      {toasts.map(t => <div key={t.id} style={{ background:t.color, color:"#fff", padding:"9px 20px", borderRadius:100, fontSize:13, fontWeight:600, boxShadow:"0 4px 14px rgba(0,0,0,.25)" }}>{t.msg}</div>)}
    </div>
  );
}
function Bar({ value, color="#FF385C" }) {
  return <div style={{ height:4, borderRadius:2, background:"#E5E5E5", overflow:"hidden" }}><div style={{ height:"100%", width:Math.min(100,value)+"%", background:color, borderRadius:2, transition:"width .6s ease" }}/></div>;
}
function Badge({ color="gray", children }) {
  const cl = { amber:{bg:"#FFF3E0",c:"#C96A00"}, green:{bg:"#EDFAEE",c:"#008A05"}, red:{bg:"#FFF0F3",c:"#FF385C"}, gray:{bg:"#F0F0F0",c:"#717171"} }[color]||{bg:"#F0F0F0",c:"#717171"};
  return <span style={{ display:"inline-block", padding:"2px 10px", borderRadius:100, fontSize:11, fontWeight:600, background:cl.bg, color:cl.c }}>{children}</span>;
}
function Stepper({ value, onChange, min=1 }) {
  const bs = { width:28, height:28, borderRadius:8, border:"1px solid #DDD", background:"none", fontSize:16, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"inherit" };
  return <div style={{ display:"flex", alignItems:"center", gap:8 }}><button style={bs} onClick={()=>onChange(Math.max(min,value-1))}>−</button><span style={{ fontWeight:700, fontSize:16, minWidth:20, textAlign:"center" }}>{value}</span><button style={bs} onClick={()=>onChange(value+1)}>+</button></div>;
}
function EmptyState({ icon="🗺️", title, sub }) {
  return <div style={{ textAlign:"center", padding:"36px 20px", background:"#FFF", borderRadius:16, border:"1px solid #DDD" }}><div style={{ fontSize:36, marginBottom:10 }}>{icon}</div><div style={{ fontWeight:700, fontSize:15, marginBottom:6 }}>{title}</div>{sub&&<div style={{ fontSize:12, color:"#717171", lineHeight:1.6 }}>{sub}</div>}</div>;
}
function LinkPills({ links }) {
  return (
    <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginTop:10 }}>
      {links.map((lk,i) => (
        <a key={i} href={lk.url} target="_blank" rel="noopener noreferrer"
          style={{ padding:"5px 12px", borderRadius:100, fontSize:11, fontWeight:700, textDecoration:"none", color:"#fff", background:lk.c, display:"inline-block" }}>
          {lk.l} ↗
        </a>
      ))}
    </div>
  );
}

function HotelCard({ hotel, swipeDir, dragX=0, mobile }) {
  const [imgOk, setImgOk] = useState(true);
  const skipOp = dragX < -30 ? Math.min(1,(Math.abs(dragX)-30)/60) : 0;
  const saveOp = dragX > 30 ? Math.min(1,(dragX-30)/60) : 0;
  return (
    <div style={{ position:"absolute", inset:0, background:"#FFF", borderRadius:20, overflow:"hidden", boxShadow:"0 8px 30px rgba(0,0,0,.14)", transform:swipeDir==="left"?"translateX(-130%) rotate(-18deg)":swipeDir==="right"?"translateX(130%) rotate(18deg)":dragX!==0?`translateX(${dragX}px) rotate(${dragX*.04}deg)`:"none", opacity:swipeDir?0:1, transition:swipeDir?"transform .38s cubic-bezier(.4,0,.2,1), opacity .38s":dragX!==0?"none":"transform .15s ease", cursor:"grab", userSelect:"none" }}>
      <div style={{ position:"absolute", top:20, left:16, zIndex:10, opacity:skipOp, background:"#FF385C", color:"#fff", fontWeight:800, fontSize:15, padding:"5px 12px", borderRadius:8, letterSpacing:1 }}>SKIP</div>
      <div style={{ position:"absolute", top:20, right:16, zIndex:10, opacity:saveOp, background:"#008A05", color:"#fff", fontWeight:800, fontSize:15, padding:"5px 12px", borderRadius:8, letterSpacing:1 }}>SAVE</div>
      <div style={{ height:mobile?170:200, background:"#E8E8E8", position:"relative", overflow:"hidden" }}>
        {imgOk ? <img src={`https://picsum.photos/seed/${enc(hotel.name)}/600/400`} alt={hotel.name} onError={()=>setImgOk(false)} style={{ width:"100%", height:"100%", objectFit:"cover" }}/>
          : <div style={{ width:"100%", height:"100%", background:"linear-gradient(135deg,#e8e4dc,#d0cbbe)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:40 }}>🏨</div>}
        <div style={{ position:"absolute", inset:"auto 0 0", background:"linear-gradient(transparent,rgba(0,0,0,.65))", padding:"18px 14px 10px", display:"flex", justifyContent:"space-between", alignItems:"flex-end" }}>
          <div style={{ display:"flex", gap:6, alignItems:"center" }}>
            <span style={{ color:"#F5C518", fontSize:11 }}>{"★".repeat(Math.min(5,hotel.stars||3))}</span>
            {hotel.verified&&<span style={{ background:"rgba(0,138,5,.8)", borderRadius:6, padding:"2px 7px", fontSize:9, fontWeight:700, color:"#fff" }}>✓ Real</span>}
          </div>
          <div style={{ color:"#fff", fontWeight:800, fontSize:20 }}>{hotel.price_per_night}€<span style={{ fontWeight:400, fontSize:11, opacity:.8 }}>/n</span></div>
        </div>
      </div>
      <div style={{ padding:"12px 14px 16px" }}>
        <div style={{ fontWeight:700, fontSize:mobile?15:17, marginBottom:2 }}>{hotel.name}</div>
        <div style={{ fontSize:12, color:"#717171", marginBottom:8 }}>{hotel.area} · {hotel.distance_center}</div>
        <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
          {(hotel.pros||[]).slice(0,2).map((p,i)=><span key={i} style={{ padding:"2px 8px", borderRadius:100, fontSize:10, fontWeight:600, background:"#EDFAEE", color:"#008A05" }}>{p}</span>)}
          {hotel.con&&<span style={{ padding:"2px 8px", borderRadius:100, fontSize:10, fontWeight:600, background:"#FFF0F3", color:"#FF385C" }}>{hotel.con}</span>}
        </div>
        {hotel.vibe&&<div style={{ fontSize:11, color:"#717171", fontStyle:"italic", marginTop:6 }}>"{hotel.vibe}"</div>}
      </div>
    </div>
  );
}

function HotelCompare({ hotels, cart, nightsN, onSelect, result, mobile }) {
  const [sort, setSort] = useState("price");
  const sorted = [...hotels].sort((a,b) => sort==="price" ? a.price_per_night-b.price_per_night : b.stars-a.stars);
  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12, flexWrap:"wrap", gap:8 }}>
        <span style={{ fontWeight:700, fontSize:15 }}>Comparar hoteles</span>
        <div style={{ display:"flex", gap:4 }}>
          {[{k:"price",l:"Precio"},{k:"stars",l:"Estrellas"}].map(s=>(
            <button key={s.k} onClick={()=>setSort(s.k)} style={{ padding:"5px 12px", borderRadius:100, border:"none", fontSize:11, fontWeight:600, cursor:"pointer", fontFamily:"inherit", background:sort===s.k?"#222":"#F0F0F0", color:sort===s.k?"#fff":"#717171" }}>{s.l}</button>
          ))}
        </div>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:mobile?"1fr":"1fr 1fr", gap:10 }}>
        {sorted.map((h,i) => {
          const sel = cart.hotel?.name===h.name;
          return (
            <div key={i} style={{ background:"#FFF", border:"2px solid "+(sel?"#008A05":"#DDD"), borderRadius:16, padding:"14px 16px", boxShadow:"0 2px 8px rgba(0,0,0,.08)" }}>
              <div style={{ display:"flex", justifyContent:"space-between", gap:8 }}>
                <div style={{ flex:1 }}>
                  <div style={{ display:"flex", gap:5, alignItems:"center", flexWrap:"wrap", marginBottom:4 }}>
                    <span style={{ fontWeight:700, fontSize:14 }}>{h.name}</span>
                    {h.verified&&<span style={{ fontSize:9, fontWeight:700, background:"#EDFAEE", color:"#008A05", padding:"1px 6px", borderRadius:100 }}>✓</span>}
                    {sel&&<Badge color="green">En cesta</Badge>}
                  </div>
                  <div style={{ fontSize:11, color:"#717171" }}>{h.area} · {h.distance_center}</div>
                  <div style={{ color:"#F5C518", fontSize:10, marginTop:4 }}>{"★".repeat(h.stars||3)}</div>
                </div>
                <div style={{ textAlign:"right", flexShrink:0 }}>
                  <div style={{ fontWeight:800, fontSize:18 }}>{h.price_per_night}€</div>
                  <div style={{ fontSize:9, color:"#717171" }}>noche</div>
                  <div style={{ fontWeight:600, fontSize:12, color:"#717171" }}>{h.price_per_night*nightsN}€ total</div>
                </div>
              </div>
              <div style={{ display:"flex", gap:5, marginTop:10 }}>
                <button onClick={()=>onSelect(h)} style={{ flex:1, padding:"7px", borderRadius:10, border:"none", fontSize:11, fontWeight:700, cursor:"pointer", fontFamily:"inherit", background:sel?"#EDFAEE":"#222", color:sel?"#008A05":"#fff" }}>{sel?"Seleccionado":"Seleccionar"}</button>
              </div>
              {sel && <LinkPills links={hotelLinks(result.destination, result.checkIn, result.checkOut, result.travelers)} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HotelMap({ hotels, cart, onSelect, mobile }) {
  const mapDivRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const infoWinRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState(null);
  const onSelectRef = useRef(onSelect);
  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);

  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  const hotelsWithCoords = hotels.filter(h => h.lat != null && h.lng != null);

  useEffect(() => {
    if (!apiKey || !hotelsWithCoords.length || !mapDivRef.current || mapRef.current) return;
    const avgLat = hotelsWithCoords.reduce((s, h) => s + h.lat, 0) / hotelsWithCoords.length;
    const avgLng = hotelsWithCoords.reduce((s, h) => s + h.lng, 0) / hotelsWithCoords.length;
    loadGoogleMaps(apiKey).then(G => {
      if (!mapDivRef.current || mapRef.current) return;
      mapRef.current = new G.Map(mapDivRef.current, {
        center: { lat: avgLat, lng: avgLng },
        zoom: 13,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
      });
      infoWinRef.current = new G.InfoWindow();
      setMapReady(true);
    }).catch(() => setMapError("No se pudo cargar Google Maps"));
  }, [apiKey]);

  useEffect(() => {
    if (!mapReady || !window.google?.maps) return;
    const G = window.google.maps;
    markersRef.current.forEach(m => m.setMap(null));
    markersRef.current = [];
    markersRef.current = hotelsWithCoords.map(hotel => {
      const isSel = cart.hotel?.name === hotel.name;
      const marker = new G.Marker({
        position: { lat: hotel.lat, lng: hotel.lng },
        map: mapRef.current,
        title: hotel.name,
        label: { text: `${hotel.price_per_night}€`, color: "#fff", fontSize: "10px", fontWeight: "700", fontFamily: "system-ui,sans-serif" },
        icon: { path: G.SymbolPath.CIRCLE, scale: 20, fillColor: isSel ? "#008A05" : "#FF385C", fillOpacity: 1, strokeColor: "#fff", strokeWeight: 2 },
      });
      marker.addListener("click", () => {
        infoWinRef.current.setContent(
          `<div style="font-family:system-ui,sans-serif;padding:4px;max-width:190px">` +
          `<div style="font-weight:700;font-size:13px;margin-bottom:2px">${hotel.name}</div>` +
          `<div style="font-size:11px;color:#717171;margin-bottom:4px">${hotel.area} · ${hotel.distance_center}</div>` +
          `<div style="color:#F5C518;font-size:11px">${"★".repeat(Math.min(5, hotel.stars || 3))}</div>` +
          `<div style="font-weight:700;font-size:14px;margin-top:4px">${hotel.price_per_night}€<span style="font-weight:400;font-size:10px;color:#717171">/noche</span></div>` +
          `</div>`
        );
        infoWinRef.current.open(mapRef.current, marker);
        onSelectRef.current(hotel);
      });
      return marker;
    });
  }, [mapReady, hotels, cart.hotel?.name]);

  if (!apiKey) return <EmptyState icon="🗺️" title="API Key no configurada" sub="Añade VITE_GOOGLE_MAPS_API_KEY en tu archivo .env y reinicia el servidor."/>;
  if (mapError) return <EmptyState icon="🗺️" title="Error cargando el mapa" sub={mapError}/>;
  if (!hotelsWithCoords.length) return <EmptyState icon="🗺️" title="Sin coordenadas" sub="Genera un nuevo plan para ver los hoteles en el mapa."/>;

  return (
    <div style={{ borderRadius:16, overflow:"hidden", border:"1px solid #DDD", boxShadow:"0 2px 8px rgba(0,0,0,.08)" }}>
      <div ref={mapDivRef} style={{ width:"100%", height: mobile ? 340 : 440, background:"#E8E8E8" }}/>
      <div style={{ background:"#FFF", padding:"10px 12px" }}>
        <div style={{ fontSize:10, fontWeight:700, color:"#717171", textTransform:"uppercase", letterSpacing:.5, marginBottom:6 }}>Toca un marcador para ver detalles</div>
        <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
          {hotelsWithCoords.map((h, i) => {
            const sel = cart.hotel?.name === h.name;
            return (
              <button key={i} onClick={() => { mapRef.current?.panTo({lat:h.lat,lng:h.lng}); onSelectRef.current(h); }}
                style={{ padding:"4px 10px", borderRadius:100, fontSize:10, fontWeight:600, cursor:"pointer", border:"none", fontFamily:"inherit", background: sel ? "#008A05" : "#F0F0F0", color: sel ? "#fff" : "#222" }}>
                {h.name.split(" ").slice(0,3).join(" ")} · {h.price_per_night}€
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function DateWindowPicker({ windows, selected, onSelect }) {
  if (!windows?.length) return null;
  const priceBadge = f => f==="barato"?"green":f==="caro"?"red":"gray";
  return (
    <div style={{ marginBottom:12 }}>
      <div style={{ fontSize:11, fontWeight:700, color:"#717171", textTransform:"uppercase", letterSpacing:.4, marginBottom:8 }}>Elige tu ventana de fechas</div>
      <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
        {windows.map((w,i) => {
          const sel = selected?.start===w.start;
          const nights = calcNights(w.start, w.end);
          return (
            <div key={i} onClick={()=>onSelect(sel?null:w)} style={{ background:"#FFF", border:"2px solid "+(sel?"#222":"#DDD"), borderRadius:12, padding:"10px 14px", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, flexWrap:"wrap", boxShadow:"0 2px 6px rgba(0,0,0,.06)" }}>
              <div>
                <div style={{ fontWeight:700, fontSize:13 }}>{w.start} → {w.end}</div>
                <div style={{ fontSize:11, color:"#717171", marginTop:2 }}>{w.reason}</div>
              </div>
              <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                <Badge color="gray">{nights} noches</Badge>
                {w.price_factor && <Badge color={priceBadge(w.price_factor)}>{w.price_factor}</Badge>}
                {sel && <Badge color="green">✓ Seleccionada</Badge>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ItineraryTab({ itinerary }) {
  const [open, setOpen] = useState(0);
  if (!itinerary?.length) return <EmptyState icon="📅" title="Sin itinerario disponible" sub="Vuelve a buscar el destino para generar el plan diario."/>;
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
      {itinerary.map((day,i) => {
        const isOpen = open===i;
        return (
          <div key={i} style={{ background:"#FFF", border:"1px solid "+(isOpen?"#222":"#DDD"), borderRadius:16, overflow:"hidden", boxShadow:"0 2px 8px rgba(0,0,0,.08)" }}>
            <button onClick={()=>setOpen(isOpen?-1:i)} style={{ width:"100%", display:"flex", alignItems:"center", justifyContent:"space-between", padding:"14px 16px", background:"none", border:"none", cursor:"pointer", fontFamily:"inherit", textAlign:"left" }}>
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                <div style={{ width:30, height:30, borderRadius:"50%", background:isOpen?"#222":"#F0F0F0", color:isOpen?"#fff":"#222", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:800, fontSize:13, flexShrink:0 }}>{day.day}</div>
                <span style={{ fontWeight:700, fontSize:14 }}>{day.title}</span>
              </div>
              <span style={{ fontSize:12, color:"#717171", transform:isOpen?"rotate(180deg)":"none", transition:"transform .2s", display:"inline-block" }}>▾</span>
            </button>
            {isOpen && (
              <div style={{ borderTop:"1px solid #F0F0F0" }}>
                {["morning","afternoon","evening"].map(p => {
                  const d = day[p]; if (!d?.activity) return null;
                  return (
                    <div key={p} style={{ display:"flex", gap:12, padding:"12px 16px", borderBottom:"1px solid #F7F7F7" }}>
                      <div style={{ fontSize:20, flexShrink:0, marginTop:1 }}>{PICON[p]}</div>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:10, fontWeight:700, color:"#717171", textTransform:"uppercase", letterSpacing:.4, marginBottom:3 }}>{PLBL[p]}</div>
                        <div style={{ fontWeight:600, fontSize:13, marginBottom:d.tip?4:0 }}>{d.activity}</div>
                        {d.tip&&<div style={{ fontSize:11, color:"#717171", background:"#F7F7F7", borderRadius:8, padding:"4px 10px", display:"inline-block" }}>💡 {d.tip}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function DiscoverTab({ result, cart, addExtra, mobile }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
      <div style={{ fontSize:10, fontWeight:700, color:"#717171", textTransform:"uppercase", letterSpacing:.5, paddingLeft:2 }}>📖 Sobre el destino</div>
      <div style={{ display:"grid", gridTemplateColumns:mobile?"1fr":"1fr 1fr", gap:8 }}>
        {[{l:"Cuándo ir",t:result.best_time,icon:"🗓"},{l:"Qué evitar",t:result.skip_this,icon:"⚠️"}].map(c=>(
          <div key={c.l} style={{ background:"#FFF", border:"1px solid #DDD", borderRadius:14, padding:"14px 16px", boxShadow:"0 2px 8px rgba(0,0,0,.08)" }}>
            <div style={{ fontSize:10, fontWeight:700, color:"#717171", textTransform:"uppercase", letterSpacing:.5, marginBottom:6 }}>{c.icon} {c.l}</div>
            <div style={{ fontSize:13, lineHeight:1.6 }}>{c.t}</div>
          </div>
        ))}
      </div>
      {result.hidden_gem&&(
        <div style={{ background:"#FFF3E0", border:"1px solid rgba(201,106,0,.15)", borderRadius:14, padding:"14px 16px" }}>
          <div style={{ fontSize:10, fontWeight:700, color:"#C96A00", textTransform:"uppercase", letterSpacing:.5, marginBottom:6 }}>✨ Joya oculta</div>
          <div style={{ fontSize:13, lineHeight:1.6 }}>{result.hidden_gem}</div>
        </div>
      )}
      <div style={{ fontSize:10, fontWeight:700, color:"#717171", textTransform:"uppercase", letterSpacing:.5, paddingLeft:2, marginTop:4 }}>🎟 Actividades y restaurantes</div>
      {result.recs?.length > 0 && (
        <div style={{ background:"#FFF", border:"1px solid #DDD", borderRadius:14, overflow:"hidden", boxShadow:"0 2px 8px rgba(0,0,0,.08)" }}>
          {result.recs.map((r,i) => {
            const inC = cart.extras.find(e=>e.name===r.name);
            return (
              <div key={i}>
                <div style={{ padding:"10px 14px", display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                  <div style={{ flex:1, minWidth:110 }}>
                    <div style={{ fontWeight:600, fontSize:12 }}>{r.name}</div>
                    <div style={{ fontSize:10, color:"#717171" }}>{r.type}</div>
                  </div>
                  <div style={{ display:"flex", alignItems:"center", gap:5, flexShrink:0 }}>
                    <span style={{ fontWeight:700, fontSize:12, color:r.price_pp===0?"#008A05":undefined }}>{r.price_pp===0?"Gratis":"~"+r.price_pp+"€"}</span>
                    <button onClick={()=>!inC&&addExtra(r)} style={{ padding:"4px 8px", borderRadius:8, fontSize:10, fontWeight:700, border:"none", cursor:inC?"default":"pointer", fontFamily:"inherit", background:inC?"#EDFAEE":"#FF385C", color:inC?"#008A05":"#fff" }}>{inC?"✓":"+"}</button>
                  </div>
                </div>
                {i<result.recs.length-1&&<div style={{ height:1, background:"#DDD" }}/>}
              </div>
            );
          })}
        </div>
      )}
      <div style={{ fontSize:10, fontWeight:700, color:"#717171", textTransform:"uppercase", letterSpacing:.5, paddingLeft:2, marginTop:4 }}>🔗 Reservar actividades online</div>
      <div style={{ background:"#FFF", border:"1px solid #DDD", borderRadius:14, padding:"14px 16px", boxShadow:"0 2px 8px rgba(0,0,0,.08)" }}>
        <div style={{ fontSize:12, color:"#717171", marginBottom:8 }}>Busca tours y experiencias en {result.destination}:</div>
        <LinkPills links={activityLinks(result.destination)} />
      </div>
    </div>
  );
}

function InspireResults({ suggestions, onPick, onBack }) {
  const PRICE_FMT = n => n < 600 ? "Económico" : n < 1200 ? "Moderado" : "Premium";
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
        <div style={{ fontWeight:800, fontSize:18 }}>Te proponemos 3 destinos</div>
        <button onClick={onBack} style={{ background:"none", border:"1px solid #DDD", borderRadius:100, padding:"5px 12px", fontSize:11, fontWeight:600, cursor:"pointer", fontFamily:"inherit" }}>← Volver</button>
      </div>
      {suggestions.map((s,i) => (
        <div key={i} style={{ background:"#FFF", border:"1px solid #DDD", borderRadius:16, overflow:"hidden", boxShadow:"0 4px 14px rgba(0,0,0,.1)" }}>
          <div style={{ background:`linear-gradient(135deg, hsl(${i*60+10},70%,45%), hsl(${i*60+40},70%,35%))`, padding:"16px 20px", color:"#fff" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
              <div>
                <div style={{ fontWeight:800, fontSize:20 }}>{s.destination}</div>
                <div style={{ fontSize:12, opacity:.9, marginTop:2 }}>{s.tagline}</div>
              </div>
              <div style={{ width:38, height:38, borderRadius:"50%", background:"rgba(255,255,255,.2)", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:800, fontSize:16 }}>{s.score}</div>
            </div>
          </div>
          <div style={{ padding:"14px 20px" }}>
            <div style={{ fontSize:13, lineHeight:1.6, color:"#444", marginBottom:10 }}>{s.why_fits}</div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:12 }}>
              <Badge color="gray">🗓 {s.best_months}</Badge>
              <Badge color={s.estimated_total<600?"green":s.estimated_total<1200?"amber":"red"}>💰 ~{s.estimated_total}€ · {PRICE_FMT(s.estimated_total)}</Badge>
            </div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:5, marginBottom:12 }}>
              {(s.highlights||[]).map((h,j)=><span key={j} style={{ padding:"3px 10px", borderRadius:100, fontSize:11, fontWeight:500, background:"#F7F7F7", border:"1px solid #EEE" }}>✦ {h}</span>)}
            </div>
            <button onClick={()=>onPick(s.destination)} style={{ width:"100%", padding:"10px", borderRadius:12, border:"none", background:"#222", color:"#fff", fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>Explorar {s.destination} →</button>
          </div>
        </div>
      ))}
    </div>
  );
}

function ShareModal({ result, cart, nightsN, cartSpent, onClose }) {
  const [copied, setCopied] = useState(false);
  const txt = shareText(result, cart, nightsN, cartSpent);
  function copy() {
    navigator.clipboard.writeText(txt).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),2000);}).catch(()=>{});
  }
  return (
    <div style={{ position:"fixed", inset:0, zIndex:500, display:"flex", alignItems:"flex-end" }}>
      <div onClick={onClose} style={{ position:"absolute", inset:0, background:"rgba(0,0,0,.4)" }}/>
      <div style={{ position:"relative", width:"100%", background:"#FFF", borderRadius:"20px 20px 0 0", padding:"24px 20px 40px" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
          <span style={{ fontWeight:800, fontSize:17 }}>Compartir plan</span>
          <button onClick={onClose} style={{ background:"#F0F0F0", border:"none", borderRadius:"50%", width:32, height:32, cursor:"pointer", fontSize:16 }}>×</button>
        </div>
        <pre style={{ background:"#F7F7F7", borderRadius:12, padding:"12px 14px", fontSize:12, lineHeight:1.7, whiteSpace:"pre-wrap", wordBreak:"break-word", border:"1px solid #DDD", maxHeight:200, overflowY:"auto", fontFamily:"monospace" }}>{txt}</pre>
        <div style={{ display:"flex", gap:8, marginTop:12 }}>
          <button onClick={copy} style={{ flex:1, padding:"11px", borderRadius:12, border:"1px solid #DDD", background:copied?"#EDFAEE":"#FFF", color:copied?"#008A05":"#222", fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>{copied?"✓ Copiado!":"Copiar texto"}</button>
          {navigator.share&&<button onClick={()=>navigator.share({title:`Viaje a ${result.destination}`,text:txt}).catch(()=>{})} style={{ flex:1, padding:"11px", borderRadius:12, border:"none", background:"#222", color:"#fff", fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>Compartir ↗</button>}
        </div>
      </div>
    </div>
  );
}

function BudgetStrip({ budget, setBudget, spent, onOpen, mobile }) {
  const total = parseFloat(budget)||0, free = Math.max(0,total-spent);
  return (
    <div style={{ position:"fixed", bottom:0, left:0, right:0, zIndex:300, background:"rgba(255,255,255,.97)", backdropFilter:"blur(10px)", borderTop:"1px solid #DDD", padding:mobile?"10px 16px":"10px 32px", display:"flex", alignItems:"center", gap:10 }}>
      <div style={{ flex:1, display:"flex", alignItems:"center", gap:8 }}>
        <span style={{ fontSize:12, fontWeight:700, color:"#717171", whiteSpace:"nowrap" }}>€ Total</span>
        <input value={budget} onChange={e=>setBudget(e.target.value)} placeholder="0" style={{ width:80, border:"1px solid #DDD", borderRadius:8, padding:"5px 8px", fontSize:13, fontWeight:700, outline:"none", fontFamily:"inherit" }}/>
        {total>0&&<span style={{ fontSize:11, fontWeight:600, color:free<=0?"#FF385C":"#008A05" }}>{free<=0?"−"+Math.abs(free):"+"+free}€ libre</span>}
      </div>
      <button onClick={onOpen} style={{ padding:"8px 16px", borderRadius:100, border:"none", background:spent>0?"#222":"#F0F0F0", color:spent>0?"#fff":"#717171", fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit", whiteSpace:"nowrap" }}>Cesta{spent>0?" · "+spent+"€":""}</button>
    </div>
  );
}

function CartDrawer({ cart, result, budget, nightsN, onRemove, onClose, mobile }) {
  const hT = cart.hotel?cart.hotel.price_per_night*nightsN:0;
  const tT = cart.transport?cart.transport.price_pp*(result?.travelers||1):0;
  const eT = (cart.extras||[]).reduce((s,e)=>s+(e.price_pp||0)*(result?.travelers||1),0);
  const total = hT+tT+eT, bud = parseFloat(budget)||0, empty = !cart.hotel&&!cart.transport&&!cart.extras?.length;
  return (
    <div style={{ position:"fixed", inset:0, zIndex:400, display:"flex", alignItems:"flex-end" }}>
      <div onClick={onClose} style={{ position:"absolute", inset:0, background:"rgba(0,0,0,.4)" }}/>
      <div style={{ position:"relative", width:"100%", maxHeight:"80vh", overflowY:"auto", background:"#FFF", borderRadius:"20px 20px 0 0", padding:mobile?"20px 16px 32px":"24px 32px 40px" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:18 }}>
          <span style={{ fontWeight:800, fontSize:18 }}>Tu cesta</span>
          <button onClick={onClose} style={{ background:"#F0F0F0", border:"none", borderRadius:"50%", width:32, height:32, cursor:"pointer", fontSize:16 }}>×</button>
        </div>
        {empty&&<div style={{ textAlign:"center", padding:"24px 0", color:"#717171", fontSize:13 }}>Todavía no has guardado nada.<br/>Selecciona hotel y transporte en las tabs.</div>}
        {cart.hotel&&<CartRow label="🏨 Alojamiento" name={cart.hotel.name} detail={cart.hotel.price_per_night+"€/n × "+nightsN} total={hT} onRemove={()=>onRemove("hotel")}/>}
        {cart.transport&&<CartRow label={TI[cart.transport.type]+" Transporte"} name={cart.transport.label} detail={cart.transport.price_pp+"€/p × "+(result?.travelers||1)} total={tT} onRemove={()=>onRemove("transport")}/>}
        {(cart.extras||[]).map((e,i)=><CartRow key={i} label="🎟 Extra" name={e.name} detail={(e.price_pp||0)+"€/p × "+(result?.travelers||1)} total={(e.price_pp||0)*(result?.travelers||1)} onRemove={()=>onRemove("extra",i)}/>)}
        {total>0&&(
          <div style={{ borderTop:"2px solid #222", marginTop:12, paddingTop:12, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <span style={{ fontWeight:800, fontSize:16 }}>Total estimado</span>
            <div style={{ textAlign:"right" }}>
              <div style={{ fontWeight:800, fontSize:22 }}>{total}€</div>
              {bud>0&&<div style={{ fontSize:11, fontWeight:600, color:total>bud?"#FF385C":"#008A05" }}>{total>bud?"+"+(total-bud)+"€ sobre presupuesto":(bud-total)+"€ restantes"}</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
function CartRow({ label, name, detail, total, onRemove }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 0", borderBottom:"1px solid #F0F0F0" }}>
      <div style={{ flex:1 }}>
        <div style={{ fontSize:10, fontWeight:700, color:"#717171", textTransform:"uppercase" }}>{label}</div>
        <div style={{ fontWeight:600, fontSize:13 }}>{name}</div>
        <div style={{ fontSize:11, color:"#717171" }}>{detail}</div>
      </div>
      <div style={{ fontWeight:800, fontSize:15 }}>{total}€</div>
      <button onClick={onRemove} style={{ background:"#FFF0F3", border:"none", borderRadius:8, width:28, height:28, cursor:"pointer", color:"#FF385C", fontWeight:700, fontSize:14, display:"flex", alignItems:"center", justifyContent:"center" }}>×</button>
    </div>
  );
}
function BudgetLine({ label, detail, amount, total }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:10, padding:"11px 16px", borderBottom:"1px solid #F0F0F0" }}>
      <div style={{ flex:1 }}><div style={{ fontSize:11, fontWeight:700 }}>{label}</div><div style={{ fontSize:10, color:"#717171" }}>{detail}</div></div>
      <div style={{ fontWeight:700, fontSize:14 }}>{amount}€</div>
      {total>0&&<div style={{ fontSize:10, color:"#717171", minWidth:32, textAlign:"right" }}>{pct(amount,total)}%</div>}
    </div>
  );
}

export default function App() {
  const mobile = useIsMobile();
  const { toasts, show: toast } = useToast();

  const [screen, setScreen] = useState("form");
  const [inspireMode, setInspireMode] = useState(false);
  const [inspireSuggestions, setInspireSuggestions] = useState(null);
  const [savedResult, setSavedResult] = useState(null);
  const [form, setForm] = useState({ destination:"", origin:"", checkIn:"", checkOut:"", nights:7, budget:"", travelers:2, style:[], flexDates:false });
  const [loadStep, setLoadStep] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("hotels");
  const [hotelView, setHotelView] = useState("swipe");
  const [hotelIdx, setHotelIdx] = useState(0);
  const [swipeDir, setSwipeDir] = useState(null);
  const [dragX, setDragX] = useState(0);
  const [hotelHistory, setHotelHistory] = useState([]);
  const [cart, setCart] = useState({ hotel:null, transport:null, extras:[] });
  const [cartOpen, setCartOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [budget, setBudget] = useState("");
  const [heroUrl, setHeroUrl] = useState("");
  const [selDateWindow, setSelDateWindow] = useState(null);

  const dragStartRef = useRef(null);
  const isDragging = useRef(false);

  useEffect(() => { window.storage.get(SR).then(r=>{ if(r?.value) setSavedResult(JSON.parse(r.value)); }).catch(()=>{}); }, []);
  useEffect(() => { if(result) window.storage.set(SR, JSON.stringify(result)).catch(()=>{}); }, [result]);
  useEffect(() => { window.storage.set(SC, JSON.stringify(cart)).catch(()=>{}); }, [cart]);

  useEffect(() => {
    if (screen!=="results"||!result?.destination) return;
    setHeroUrl(`https://picsum.photos/seed/${enc(result.destination+"travel")}/1400/700`);
    fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${enc(result.destination)}`)
      .then(r=>r.json()).then(d=>{ const u=d?.originalimage?.source||d?.thumbnail?.source; if(u) setHeroUrl(u); }).catch(()=>{});
  }, [screen, result?.destination]);

  const nightsN = selDateWindow ? calcNights(selDateWindow.start, selDateWindow.end) : result?.flexDates ? (result?.nights||7) : calcNights(result?.checkIn, result?.checkOut);
  const cartHT = cart.hotel ? cart.hotel.price_per_night*nightsN : 0;
  const cartTT = cart.transport ? cart.transport.price_pp*(result?.travelers||1) : 0;
  const cartET = (cart.extras||[]).reduce((s,e)=>s+(e.price_pp||0)*(result?.travelers||1),0);
  const cartSpent = cartHT+cartTT+cartET;

  const addExtra = item => { if(cart.extras.find(e=>e.name===item.name)) return; setCart(c=>({...c,extras:[...c.extras,item]})); toast("✓ "+item.name+" añadido","#008A05"); };
  const removeFromCart = (type,idx) => { if(type==="hotel") setCart(c=>({...c,hotel:null})); else if(type==="transport") setCart(c=>({...c,transport:null})); else setCart(c=>({...c,extras:c.extras.filter((_,i)=>i!==idx)})); };
  const restoreSaved = () => { setResult(savedResult); setBudget(savedResult?.budget||""); setHotelIdx(0); setHotelHistory([]); setCart({hotel:null,transport:null,extras:[]}); setHeroUrl(""); setHotelView("swipe"); setTab("hotels"); setSelDateWindow(null); window.storage.get(SC).then(r=>{if(r?.value)setCart(JSON.parse(r.value));}).catch(()=>{}); setScreen("results"); };

  function onDragStart(cx) { dragStartRef.current=cx; isDragging.current=true; }
  function onDragMove(cx) { if(!isDragging.current||dragStartRef.current===null) return; setDragX(cx-dragStartRef.current); }
  function onDragEnd() { if(!isDragging.current) return; isDragging.current=false; if(Math.abs(dragX)>70) doSwipe(dragX>0?"right":"left"); setDragX(0); dragStartRef.current=null; }

  async function callAPI(prompt, steps, onStep) {
    const si = setInterval(()=>onStep(s=>Math.min(s+1,steps.length-1)), 2800);
    const res = await fetch("/api/anthropic/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": import.meta.env.VITE_ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 4096,
        system: "Eres un planificador de viajes experto. IMPORTANTE: Responde ÚNICA Y EXCLUSIVAMENTE con un objeto JSON válido. No escribas texto antes ni después del JSON. No uses bloques de código markdown. Empieza directamente con { y termina con }.",
        messages: [{ role:"user", content:prompt }]
      })
    });
    clearInterval(si);
    if(!res.ok) { const e=await res.json().catch(()=>({})); throw new Error(e?.error?.message||"Error "+res.status); }
    const data = await res.json();
    const textBlocks = (data.content||[]).filter(i=>i.type==="text").map(i=>i.text||"").filter(Boolean);
    if(!textBlocks.length) throw new Error("Respuesta vacía del modelo");
    for (const block of [...textBlocks].reverse()) {
      try { const r = extractJSON(block); if(r && typeof r==="object") return r; } catch {}
    }
    try { return extractJSON(textBlocks.join("\n")); } catch {}
    throw new Error("No se pudo leer la respuesta");
  }

  async function submit() {
    if(!form.destination.trim()) return;
    setScreen("loading"); setError(null); setResult(null); setLoadStep(0);
    setHotelIdx(0); setHotelHistory([]); setCart({hotel:null,transport:null,extras:[]}); setHeroUrl(""); setHotelView("swipe"); setTab("hotels"); setDragX(0); setSelDateWindow(null);
    const n = form.flexDates ? form.nights : Math.max(1, calcNights(form.checkIn, form.checkOut)) || 7;
    const prompt = `Planifica un viaje a ${form.destination} desde ${form.origin||"España"}.
Duración: ${n} noches. Viajeros: ${form.travelers}. Presupuesto: ${form.budget||"sin límite"}€. Estilo: ${form.style.join(", ")||"general"}.

Devuelve SOLO este JSON, sin texto adicional, sin markdown:
{
  "verdict_title": "título corto y honesto",
  "honest_take": "valoración honesta en 2 frases",
  "score": 7,
  "budget_analysis": { "feasibility": "ok", "verdict": "frase", "alternative": "alternativa si es justo" },
  "date_windows": [{ "start": "2025-09-01", "end": "2025-09-08", "reason": "por qué es buena fecha", "price_factor": "barato" }],
  "hotels": [
    { "name": "Nombre real del hotel", "area": "barrio", "stars": 4, "price_per_night": 80, "verified": true, "vibe": "ambiente en 4 palabras", "pros": ["ventaja 1", "ventaja 2"], "con": "inconveniente", "distance_center": "10 min a pie", "lat": 48.8566, "lng": 2.3522 }
  ],
  "transport_options": [
    { "type": "flight", "label": "Vuelo directo", "price_pp": 120, "duration": "2h30", "tip": "consejo" }
  ],
  "daily_itinerary": [
    { "day": 1, "title": "Llegada y primer contacto", "morning": { "activity": "actividad", "tip": "consejo práctico" }, "afternoon": { "activity": "actividad", "tip": "consejo" }, "evening": { "activity": "actividad", "tip": "consejo" } }
  ],
  "recs": [{ "name": "Nombre real", "type": "Restaurante", "price_pp": 20 }],
  "skip_this": "qué evitar",
  "hidden_gem": "joya oculta",
  "best_time": "mejor época"
}
Incluye 5 hoteles reales, 2-3 transportes, ${n} días de itinerario y 5 recomendaciones. Empieza con { directamente.`;
    try {
      const parsed = await callAPI(prompt, LOAD_STEPS, setLoadStep);
      if(!parsed||typeof parsed!=="object") throw new Error("Respuesta inválida");
      parsed.hotels = parsed.hotels||[];
      parsed.transport_options = parsed.transport_options||[];
      parsed.daily_itinerary = parsed.daily_itinerary||[];
      parsed.recs = parsed.recs||[];
      parsed.date_windows = parsed.date_windows||[];
      const full = {...parsed,...form};
      setResult(full); setBudget(form.budget||""); setSavedResult(full); setScreen("results");
    } catch(e) { setError(e.message||"Error desconocido"); setScreen("form"); }
  }

  async function runInspire() {
    setScreen("inspire-loading"); setLoadStep(0); setError(null);
    const prompt = `Sugiere 3 destinos perfectos: Origen:${form.origin||"España"} | Días:${form.nights} | Presupuesto:${form.budget||"libre"}€ | Viajeros:${form.travelers} | Estilo:${form.style.join(",")||"general"}
SOLO JSON: {"suggestions":[{"destination":"Ciudad, País","tagline":"frase corta","score":9,"why_fits":"2 frases","estimated_total":800,"best_months":"Abr-Jun","highlights":["cosa1","cosa2","cosa3"]}]}
3 sugerencias muy diferentes. Empieza con { directamente.`;
    try {
      const parsed = await callAPI(prompt, INSPIRE_STEPS, setLoadStep);
      if(!parsed.suggestions?.length) throw new Error("Sin sugerencias");
      setInspireSuggestions(parsed.suggestions);
      setScreen("inspire-results");
    } catch(e) { setError(e.message||"Error"); setScreen("form"); }
  }

  function pickInspire(destination) {
    setInspireMode(false); setInspireSuggestions(null);
    setForm(f=>({...f, destination}));
    setScreen("form");
  }

  function doSwipe(dir) {
    if(swipeDir) return;
    setSwipeDir(dir); setDragX(0);
    const cur = result.hotels[hotelIdx];
    setTimeout(()=>{
      setHotelHistory(h=>[...h,{idx:hotelIdx,hotel:cur,wasRight:dir==="right"}]);
      if(dir==="right") { setCart(c=>({...c,hotel:cur})); toast("♥ "+cur.name+" guardado","#008A05"); }
      setHotelIdx(i=>i+1); setSwipeDir(null);
    }, 420);
  }
  function undoSwipe() {
    if(!hotelHistory.length) return;
    const last = hotelHistory[hotelHistory.length-1];
    setHotelHistory(h=>h.slice(0,-1)); setHotelIdx(last.idx);
    if(last.wasRight) setCart(c=>({...c,hotel:null}));
  }

  if (screen==="inspire-loading") {
    return (
      <div style={{ minHeight:"100vh", background:"#FFF", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"0 24px", fontFamily:"system-ui,sans-serif" }}>
        <div style={{ fontWeight:800, fontSize:22, color:"#FF385C", marginBottom:40 }}>verai</div>
        <div style={{ textAlign:"center", maxWidth:340 }}>
          <div style={{ fontSize:20, fontWeight:700, marginBottom:28 }}>Buscando tu destino ideal...</div>
          {INSPIRE_STEPS.map((s,i)=>(
            <div key={s} style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 14px", background:i===loadStep?"#F7F7F7":"transparent", borderRadius:10 }}>
              <div style={{ width:18, height:18, borderRadius:"50%", flexShrink:0, background:i<loadStep?"#222":i===loadStep?"#FF385C":"#DDD", display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, color:"#fff", fontWeight:700 }}>{i<loadStep?"✓":""}</div>
              <span style={{ fontSize:13, fontWeight:i===loadStep?600:400, color:i<=loadStep?"#222":"#717171" }}>{s}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (screen==="inspire-results") {
    return (
      <div style={{ minHeight:"100vh", background:"#F7F7F7", fontFamily:"system-ui,sans-serif" }}>
        <nav style={{ padding:mobile?"0 16px":"0 32px", height:56, display:"flex", alignItems:"center", borderBottom:"1px solid #DDD", background:"#FFF", position:"sticky", top:0, zIndex:100 }}>
          <div style={{ fontWeight:800, fontSize:20, color:"#FF385C" }}>verai</div>
        </nav>
        <div style={{ maxWidth:600, margin:"0 auto", padding:mobile?"16px 14px":"32px 24px" }}>
          <InspireResults suggestions={inspireSuggestions} onPick={pickInspire} onBack={()=>setScreen("form")}/>
        </div>
      </div>
    );
  }

  if (screen==="form") {
    const iStyle = { border:"none", outline:"none", fontSize:15, fontWeight:500, background:"transparent", width:"100%", marginTop:4, fontFamily:"inherit" };
    const lStyle = { fontSize:11, fontWeight:700, letterSpacing:.3, color:"#222" };
    const sStyle = { padding:mobile?"12px 16px":"14px 24px", borderBottom:mobile?"1px solid #DDD":undefined };
    return (
      <div style={{ minHeight:"100vh", background:"#FFF", fontFamily:"system-ui,sans-serif" }}>
        <nav style={{ padding:mobile?"0 16px":"0 32px", height:60, display:"flex", alignItems:"center", borderBottom:"1px solid #DDD", position:"sticky", top:0, zIndex:100, background:"#FFF" }}>
          <div style={{ fontWeight:800, fontSize:20, color:"#FF385C" }}>verai</div>
        </nav>
        <div style={{ maxWidth:900, margin:mobile?"24px auto 60px":"40px auto 80px", padding:mobile?"0 16px":"0 24px" }}>
          <div style={{ display:"flex", gap:4, marginBottom:16, background:"#F7F7F7", borderRadius:12, padding:4 }}>
            <button onClick={()=>setInspireMode(false)} style={{ flex:1, padding:"9px", borderRadius:9, border:"none", fontWeight:600, fontSize:12, cursor:"pointer", fontFamily:"inherit", background:!inspireMode?"#FFF":"transparent", color:!inspireMode?"#222":"#717171", boxShadow:!inspireMode?"0 1px 4px rgba(0,0,0,.12)":"none" }}>Ya sé adónde voy</button>
            <button onClick={()=>setInspireMode(true)} style={{ flex:1, padding:"9px", borderRadius:9, border:"none", fontWeight:600, fontSize:12, cursor:"pointer", fontFamily:"inherit", background:inspireMode?"#FF385C":"transparent", color:inspireMode?"#fff":"#717171" }}>✨ Sorpréndeme</button>
          </div>
          {savedResult && (
            <div style={{ background:"#F7F7F7", border:"1px solid #DDD", borderRadius:14, padding:"12px 16px", marginBottom:16, display:"flex", justifyContent:"space-between", alignItems:"center", gap:10, flexWrap:"wrap" }}>
              <div><div style={{ fontWeight:700, fontSize:13 }}>Continuar búsqueda guardada</div><div style={{ fontSize:11, color:"#717171" }}>{savedResult.destination} · {savedResult.travelers} viajero{savedResult.travelers>1?"s":""}</div></div>
              <button onClick={restoreSaved} style={{ padding:"8px 16px", borderRadius:100, border:"none", background:"#222", color:"#fff", fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>Retomar →</button>
            </div>
          )}
          {error&&<div style={{ background:"#FFF0F3", border:"1px solid rgba(255,56,92,.2)", borderRadius:14, padding:"12px 16px", marginBottom:16 }}><div style={{ fontWeight:600, color:"#FF385C", fontSize:13 }}>{error}</div></div>}
          <div style={{ background:"#FFF", border:"1px solid #DDD", borderRadius:mobile?20:32, boxShadow:"0 6px 20px rgba(0,0,0,.12)", display:"flex", flexDirection:mobile?"column":"row", overflow:"hidden" }}>
            {!inspireMode && (
              <>
                <div style={{ ...sStyle, flex:2 }}>
                  <div style={lStyle}>¿A dónde?</div>
                  <input style={iStyle} placeholder="Destino..." value={form.destination} onChange={e=>setForm(f=>({...f,destination:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&submit()}/>
                </div>
                {!mobile&&<div style={{ width:1, background:"#DDD" }}/>}
              </>
            )}
            <div style={{ ...sStyle, flex:2 }}>
              <div style={lStyle}>¿Desde dónde?</div>
              <input style={iStyle} placeholder="Tu ciudad..." value={form.origin} onChange={e=>setForm(f=>({...f,origin:e.target.value}))}/>
            </div>
            {!mobile&&<div style={{ width:1, background:"#DDD" }}/>}
            <div style={{ ...sStyle, flex:2 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <div style={lStyle}>{(form.flexDates||inspireMode)?"Duración":"Fechas"}</div>
                {!inspireMode&&<div onClick={()=>setForm(f=>({...f,flexDates:!f.flexDates}))} style={{ cursor:"pointer", display:"flex", alignItems:"center", gap:5 }}>
                  <div style={{ width:28, height:16, borderRadius:8, background:form.flexDates?"#222":"#DDD", position:"relative" }}><div style={{ position:"absolute", width:12, height:12, background:"#fff", borderRadius:"50%", top:2, left:form.flexDates?14:2, transition:"left .2s" }}/></div>
                  <span style={{ fontSize:10, color:"#717171" }}>Flex</span>
                </div>}
              </div>
              {(form.flexDates||inspireMode) ? (
                <div style={{ marginTop:6, display:"flex", alignItems:"center", gap:8 }}><Stepper value={form.nights} onChange={v=>setForm(f=>({...f,nights:v}))}/><span style={{ fontSize:12, color:"#717171" }}>noches</span></div>
              ) : (
                <div style={{ display:"flex", gap:8, marginTop:6 }}>
                  <input type="date" value={form.checkIn} onChange={e=>setForm(f=>({...f,checkIn:e.target.value}))} style={{ ...iStyle, fontSize:13, flex:1 }}/>
                  <span style={{ color:"#717171" }}>→</span>
                  <input type="date" value={form.checkOut} onChange={e=>setForm(f=>({...f,checkOut:e.target.value}))} style={{ ...iStyle, fontSize:13, flex:1 }}/>
                </div>
              )}
            </div>
            {!mobile&&<div style={{ width:1, background:"#DDD" }}/>}
            <div style={{ display:"flex", borderBottom:mobile?"1px solid #DDD":undefined }}>
              <div style={{ flex:1, padding:mobile?"12px 16px":"14px 16px" }}>
                <div style={lStyle}>Viajeros</div>
                <div style={{ marginTop:4 }}><Stepper value={form.travelers} onChange={v=>setForm(f=>({...f,travelers:v}))}/></div>
              </div>
              <div style={{ width:1, background:"#DDD" }}/>
              <div style={{ flex:1, padding:mobile?"12px 16px":"14px 16px" }}>
                <div style={lStyle}>Presupuesto</div>
                <input style={{ ...iStyle, fontSize:14, fontWeight:600 }} placeholder="€ total" value={form.budget} onChange={e=>setForm(f=>({...f,budget:e.target.value}))}/>
              </div>
            </div>
          </div>
          <div style={{ marginTop:18, display:"flex", gap:8, flexWrap:"wrap" }}>
            {STYLES_LIST.map(s=><button key={s} onClick={()=>setForm(f=>({...f,style:f.style.includes(s)?f.style.filter(x=>x!==s):[...f.style,s]}))} style={{ padding:"9px 18px", borderRadius:100, fontSize:12, fontWeight:500, background:form.style.includes(s)?"#222":"#FFF", color:form.style.includes(s)?"#fff":"#222", border:"1px solid "+(form.style.includes(s)?"#222":"#DDD"), cursor:"pointer", fontFamily:"inherit" }}>{s}</button>)}
          </div>
          <button onClick={inspireMode?runInspire:submit} style={{ marginTop:28, width:"100%", padding:"16px 24px", borderRadius:16, border:"none", background:"linear-gradient(135deg,#FF385C,#E31C5F)", color:"#fff", fontSize:16, fontWeight:700, fontFamily:"inherit", cursor:"pointer", boxShadow:"0 4px 16px rgba(255,56,92,.35)" }}>
            {inspireMode?"✨ Inspírame":(form.destination.trim()?"Analizar viaje a "+form.destination:"Introduce un destino")}
          </button>
        </div>
      </div>
    );
  }

  if (screen==="loading") {
    return (
      <div style={{ minHeight:"100vh", background:"#FFF", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"0 24px", fontFamily:"system-ui,sans-serif" }}>
        <div style={{ fontWeight:800, fontSize:22, color:"#FF385C", marginBottom:40 }}>verai</div>
        <div style={{ textAlign:"center", maxWidth:340 }}>
          <div style={{ fontSize:20, fontWeight:700, marginBottom:28 }}>Analizando {form.destination}...</div>
          {LOAD_STEPS.map((s,i)=>(
            <div key={s} style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 14px", background:i===loadStep?"#F7F7F7":"transparent", borderRadius:10 }}>
              <div style={{ width:18, height:18, borderRadius:"50%", flexShrink:0, background:i<loadStep?"#222":i===loadStep?"#FF385C":"#DDD", display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, color:"#fff", fontWeight:700 }}>{i<loadStep?"✓":""}</div>
              <span style={{ fontSize:13, fontWeight:i===loadStep?600:400, color:i<=loadStep?"#222":"#717171" }}>{s}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (screen!=="results"||!result) return null;
  const hotelsDone = hotelIdx>=(result.hotels?.length||0);
  const fc = result.budget_analysis?.feasibility;
  const tabBtn = (k,l) => <button key={k} onClick={()=>setTab(k)} style={{ padding:"7px 2px", borderRadius:10, border:"none", background:tab===k?"#222":"transparent", color:tab===k?"#fff":"#717171", fontWeight:600, fontSize:mobile?9:11, cursor:"pointer", fontFamily:"inherit" }}>{l}</button>;

  return (
    <div style={{ minHeight:"100vh", background:"#F7F7F7", paddingBottom:70, fontFamily:"system-ui,sans-serif" }}>
      <ToastContainer toasts={toasts}/>
      <nav style={{ position:"sticky", top:0, zIndex:200, background:"rgba(255,255,255,.92)", backdropFilter:"blur(10px)", borderBottom:"1px solid #DDD", padding:mobile?"0 16px":"0 32px", height:52, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div style={{ fontWeight:800, fontSize:18, color:"#FF385C" }}>verai</div>
        <div style={{ display:"flex", gap:6 }}>
          <button onClick={()=>setShareOpen(true)} style={{ background:"none", border:"1px solid #DDD", borderRadius:100, padding:"6px 12px", fontWeight:600, fontSize:11, cursor:"pointer", fontFamily:"inherit" }}>Compartir ↗</button>
          <button onClick={()=>setScreen("form")} style={{ background:"none", border:"1px solid #DDD", borderRadius:100, padding:"6px 12px", fontWeight:600, fontSize:11, cursor:"pointer", fontFamily:"inherit" }}>Nueva</button>
        </div>
      </nav>
      <div style={{ position:"relative", height:mobile?"35vh":"50vh", minHeight:250, maxHeight:450, background:"#ccc", overflow:"hidden" }}>
        {heroUrl&&<img src={heroUrl} alt={result.destination} style={{ width:"100%", height:"100%", objectFit:"cover" }}/>}
        <div style={{ position:"absolute", inset:0, background:"linear-gradient(to bottom,rgba(0,0,0,.05),rgba(0,0,0,.65))" }}/>
        <div style={{ position:"absolute", bottom:0, left:0, right:0, padding:mobile?"0 18px 20px":"0 40px 32px" }}>
          <div style={{ maxWidth:720, margin:"0 auto", color:"#fff" }}>
            <div style={{ display:"inline-flex", alignItems:"center", gap:6, background:"rgba(255,255,255,.15)", backdropFilter:"blur(8px)", borderRadius:100, padding:"4px 12px 4px 4px", marginBottom:10 }}>
              <div style={{ width:28, height:28, borderRadius:14, background:result.score>=7?"#008A05":"#FF385C", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:800, fontSize:13 }}>{result.score}</div>
              <span style={{ fontWeight:600, fontSize:12 }}>{result.score>=8?"Muy recomendable":result.score>=6?"Vale la pena":"Con matices"}</span>
            </div>
            <h1 style={{ fontSize:mobile?28:42, fontWeight:800, lineHeight:1.1, marginBottom:6 }}>{result.destination}</h1>
            <p style={{ fontSize:mobile?12:14, lineHeight:1.6, opacity:.9, maxWidth:500 }}>{result.honest_take}</p>
          </div>
        </div>
      </div>
      <div style={{ maxWidth:760, margin:"0 auto", padding:mobile?"14px 14px 0":"24px 24px 0" }}>
        {result.budget&&(
          <div style={{ background:"#FFF", borderRadius:14, padding:"12px 16px", marginBottom:10, display:"flex", alignItems:"center", gap:10, border:"1px solid #DDD", boxShadow:"0 2px 8px rgba(0,0,0,.08)", flexWrap:"wrap" }}>
            <div style={{ flex:1, minWidth:150 }}><div style={{ fontWeight:600, fontSize:13 }}>{result.budget_analysis?.verdict}</div>{result.budget_analysis?.alternative&&<div style={{ fontSize:11, color:"#717171", marginTop:2 }}>{result.budget_analysis.alternative}</div>}</div>
            <Badge color={fc==="ok"?"green":fc==="tight"?"amber":"red"}>{fc==="ok"?"OK":fc==="tight"?"Justo":"Insuficiente"}</Badge>
          </div>
        )}
        {result.flexDates&&result.date_windows?.length>0&&(
          <DateWindowPicker windows={result.date_windows} selected={selDateWindow} onSelect={setSelDateWindow}/>
        )}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:2, background:"#FFF", border:"1px solid #DDD", borderRadius:14, padding:3, marginBottom:12, boxShadow:"0 2px 8px rgba(0,0,0,.08)" }}>
          {tabBtn("hotels","🏨 Hotel")}
          {tabBtn("transport","✈️ Ruta")}
          {tabBtn("itinerary","📅 Plan")}
          {tabBtn("budget","💰 Budget")}
          {tabBtn("discover","🔍 Discover")}
        </div>

        {tab==="hotels"&&(
          <div>
            {cart.hotel&&(
              <div style={{ background:"#EDFAEE", border:"1px solid rgba(0,138,5,.2)", borderRadius:14, padding:"10px 14px", marginBottom:10, display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:8, flexWrap:"wrap" }}>
                <div>
                  <div style={{ fontSize:10, fontWeight:700, color:"#008A05" }}>EN CESTA</div>
                  <div style={{ fontWeight:700, fontSize:13 }}>{cart.hotel.name}</div>
                  <div style={{ fontSize:11, color:"#717171" }}>{cart.hotel.price_per_night}€/n × {nightsN} = <b>{cart.hotel.price_per_night*nightsN}€</b></div>
                  <LinkPills links={hotelLinks(result.destination, result.checkIn||selDateWindow?.start, result.checkOut||selDateWindow?.end, result.travelers)}/>
                </div>
                <button onClick={()=>{setCart(c=>({...c,hotel:null}));setHotelIdx(0);setHotelHistory([]);setHotelView("swipe");}} style={{ padding:"6px 10px", border:"1px solid #DDD", borderRadius:10, fontSize:10, fontWeight:600, cursor:"pointer", background:"none", fontFamily:"inherit", flexShrink:0 }}>Cambiar</button>
              </div>
            )}
            <div style={{ display:"flex", gap:4, marginBottom:10 }}>
              {[{k:"swipe",l:"Swipe"},{k:"compare",l:"Comparar"},{k:"mapa",l:"🗺️ Mapa"}].map(v=><button key={v.k} onClick={()=>setHotelView(v.k)} style={{ flex:1, padding:"7px", borderRadius:10, fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:"inherit", background:hotelView===v.k?"#222":"#FFF", color:hotelView===v.k?"#fff":"#717171", border:"1px solid "+(hotelView===v.k?"#222":"#DDD") }}>{v.l}</button>)}
            </div>
            {hotelView==="swipe"&&(
              <>
                {!hotelsDone?(
                  <div style={{ background:"#FFF", border:"1px solid #DDD", borderRadius:20, padding:mobile?"12px 12px 18px":"18px 18px 22px", boxShadow:"0 2px 8px rgba(0,0,0,.08)" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:10, fontSize:11, color:"#717171", fontWeight:500 }}>
                      <span>{hotelIdx+1} de {result.hotels.length}</span>
                      <span style={{ fontSize:10 }}>← SKIP · SAVE →</span>
                    </div>
                    <div style={{ position:"relative", height:mobile?320:380, marginBottom:14, touchAction:"none" }}
                      onMouseDown={e=>onDragStart(e.clientX)} onMouseMove={e=>{if(isDragging.current)onDragMove(e.clientX);}} onMouseUp={onDragEnd} onMouseLeave={onDragEnd}
                      onTouchStart={e=>onDragStart(e.touches[0].clientX)} onTouchMove={e=>onDragMove(e.touches[0].clientX)} onTouchEnd={onDragEnd}>
                      {result.hotels.slice(hotelIdx,hotelIdx+3).map((h,i)=>(
                        <div key={h.name+hotelIdx+i} style={{ position:"absolute", inset:0, zIndex:3-i, transform:`scale(${i===0?1:i===1?.95:.90}) translateY(${i===0?0:i===1?10:20}px)`, transformOrigin:"bottom center", transition:i===0&&swipeDir?"none":"transform .3s ease" }}>
                          <HotelCard hotel={h} swipeDir={i===0?swipeDir:null} dragX={i===0?dragX:0} mobile={mobile}/>
                        </div>
                      ))}
                    </div>
                    <div style={{ display:"flex", gap:12, justifyContent:"center" }}>
                      <button onClick={undoSwipe} style={{ width:38, height:38, borderRadius:"50%", border:"1px solid #DDD", background:"none", fontSize:14, cursor:"pointer" }}>↩</button>
                      <button onClick={()=>doSwipe("left")} style={{ width:52, height:52, borderRadius:"50%", border:"2px solid rgba(255,56,92,.25)", background:"rgba(255,56,92,.06)", fontSize:18, cursor:"pointer" }}>✕</button>
                      <button onClick={()=>doSwipe("right")} style={{ width:52, height:52, borderRadius:"50%", border:"2px solid rgba(0,138,5,.25)", background:"rgba(0,138,5,.06)", fontSize:18, cursor:"pointer" }}>♥</button>
                    </div>
                  </div>
                ) : !cart.hotel ? (
                  <div style={{ textAlign:"center", padding:32, background:"#FFF", borderRadius:20, border:"1px solid #DDD" }}>
                    <div style={{ fontWeight:700, fontSize:15, marginBottom:8 }}>Has visto todos</div>
                    <div style={{ display:"flex", gap:8, justifyContent:"center" }}>
                      <button onClick={()=>{setHotelIdx(0);setHotelHistory([]);}} style={{ padding:"9px 18px", borderRadius:100, border:"1px solid #DDD", background:"none", fontWeight:600, cursor:"pointer", fontSize:12, fontFamily:"inherit" }}>Repetir</button>
                      <button onClick={()=>setHotelView("compare")} style={{ padding:"9px 18px", borderRadius:100, border:"none", background:"#222", color:"#fff", fontWeight:600, cursor:"pointer", fontSize:12, fontFamily:"inherit" }}>Comparar</button>
                    </div>
                  </div>
                ) : null}
              </>
            )}
            {hotelView==="compare"&&<HotelCompare hotels={result.hotels} cart={cart} nightsN={nightsN} onSelect={h=>{const sel=cart.hotel?.name===h.name;setCart(c=>({...c,hotel:sel?null:h}));if(!sel)toast("♥ "+h.name+" guardado","#008A05");}} result={result} mobile={mobile}/>}
            {hotelView==="mapa"&&<HotelMap hotels={result.hotels} cart={cart} onSelect={h=>{const sel=cart.hotel?.name===h.name;setCart(c=>({...c,hotel:sel?null:h}));if(!sel)toast("♥ "+h.name+" guardado","#008A05");}} mobile={mobile}/>}
          </div>
        )}

        {tab==="transport"&&(
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {(result.transport_options||[]).map((t,i)=>{
              const sel = cart.transport?.label===t.label;
              const tLinks = getTransportLinks(t.type, result.origin, result.destination, result.checkIn||selDateWindow?.start, result.travelers);
              return (
                <div key={i} style={{ background:"#FFF", border:"2px solid "+(sel?"#222":"#DDD"), borderRadius:14, padding:"14px 16px", cursor:"pointer", boxShadow:"0 2px 8px rgba(0,0,0,.08)" }}>
                  <div onClick={()=>{const was=sel;setCart(c=>({...c,transport:was?null:{...t}}));if(!was)toast((TI[t.type]||"🚗")+" "+t.label+" añadido","#222");}} style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:10, flexWrap:"wrap" }}>
                    <div style={{ flex:1, minWidth:140 }}>
                      <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:4, flexWrap:"wrap" }}>
                        <span style={{ fontSize:18 }}>{TI[t.type]||"🚗"}</span>
                        <span style={{ fontWeight:700, fontSize:14 }}>{t.label}</span>
                        {t.duration&&<Badge color="gray">{t.duration}</Badge>}
                        {sel&&<Badge color="green">En cesta</Badge>}
                      </div>
                      <div style={{ fontSize:11, color:"#717171", background:"#F7F7F7", borderRadius:8, padding:"5px 10px", display:"inline-block" }}>{t.tip}</div>
                    </div>
                    <div style={{ textAlign:"right", flexShrink:0 }}>
                      <div style={{ fontWeight:800, fontSize:20 }}>{t.price_pp}€</div>
                      <div style={{ fontSize:10, color:"#717171" }}>por persona</div>
                      {result.travelers>1&&<div style={{ fontWeight:700, fontSize:12, marginTop:1 }}>{t.price_pp*result.travelers}€ total</div>}
                    </div>
                  </div>
                  {sel&&<LinkPills links={tLinks}/>}
                </div>
              );
            })}
          </div>
        )}

        {tab==="itinerary"&&<ItineraryTab itinerary={result.daily_itinerary}/>}

        {tab==="budget"&&(()=>{
          const total = parseFloat(budget)||0;
          if(!cart.hotel&&!cart.transport&&!cart.extras?.length) return <EmptyState icon="💰" title="Tu presupuesto te espera" sub="Selecciona un hotel y transporte para ver aquí el desglose completo."/>;
          const free = Math.max(0,total-cartSpent), perDay = nightsN>0?Math.round(free/nightsN):free;
          return (
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {total>0&&(
                <div style={{ background:"#FFF", border:"1px solid #DDD", borderRadius:14, overflow:"hidden", boxShadow:"0 2px 8px rgba(0,0,0,.08)" }}>
                  <div style={{ padding:"14px 16px" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8 }}><span style={{ fontWeight:700, fontSize:14 }}>Presupuesto</span><span style={{ fontWeight:800, fontSize:17 }}>{total}€</span></div>
                    <Bar value={pct(cartSpent,total)} color={pct(cartSpent,total)>90?"#FF385C":"#008A05"}/>
                    <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", marginTop:12 }}>
                      <div><div style={{ fontWeight:700, fontSize:15 }}>{cartSpent}€</div><div style={{ fontSize:10, color:"#717171" }}>Comprometido</div></div>
                      <div style={{ textAlign:"center" }}><div style={{ fontWeight:700, fontSize:15, color:free<=0?"#FF385C":"#008A05" }}>{free}€</div><div style={{ fontSize:10, color:"#717171" }}>Libre</div></div>
                      <div style={{ textAlign:"right" }}><div style={{ fontWeight:700, fontSize:15 }}>{perDay>0?perDay+"€":"—"}</div><div style={{ fontSize:10, color:"#717171" }}>Por día</div></div>
                    </div>
                  </div>
                </div>
              )}
              <div style={{ background:"#FFF", border:"1px solid #DDD", borderRadius:14, overflow:"hidden", boxShadow:"0 2px 8px rgba(0,0,0,.08)" }}>
                {cart.hotel&&<BudgetLine label="🏨 Alojamiento" detail={cart.hotel.name} amount={cartHT} total={total}/>}
                {cart.transport&&<BudgetLine label={(TI[cart.transport.type]||"🚗")+" Transporte"} detail={cart.transport.label} amount={cartTT} total={total}/>}
                {(cart.extras||[]).map((e,i)=><BudgetLine key={i} label="🎟 Extra" detail={e.name} amount={(e.price_pp||0)*(result.travelers||1)} total={total}/>)}
                <div style={{ padding:"12px 16px", display:"flex", justifyContent:"space-between", fontWeight:800, fontSize:15, background:"#F7F7F7" }}><span>Total</span><span>{cartSpent}€</span></div>
              </div>
            </div>
          );
        })()}

        {tab==="discover"&&<DiscoverTab result={result} cart={cart} addExtra={addExtra} mobile={mobile}/>}
      </div>

      <BudgetStrip budget={budget} setBudget={setBudget} spent={cartSpent} onOpen={()=>setCartOpen(true)} mobile={mobile}/>
      {cartOpen&&<CartDrawer cart={cart} result={result} budget={budget} nightsN={nightsN} onRemove={removeFromCart} onClose={()=>setCartOpen(false)} mobile={mobile}/>}
      {shareOpen&&<ShareModal result={result} cart={cart} nightsN={nightsN} cartSpent={cartSpent} onClose={()=>setShareOpen(false)}/>}
    </div>
  );
}