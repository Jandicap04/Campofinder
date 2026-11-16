import React, { createContext, useContext, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import {
  cancelReservation,
  changeAdminUserPassword,
  courtSlots,
  courtImageUrl,
  createAdminUser,
  createReservation,
  deleteAdminUser,
  finishLiveMatch,
  getAdminOverview,
  getAdminReservations,
  getCourtAvailability,
  getCourts,
  getLiveMatch,
  getLiveMatches,
  getProfile,
  getReservations,
  saveTimer as saveCourtTimer,
  startLiveMatch,
  setUserBlocked,
  updateLiveScore,
  updateAdminUser,
  updateBlockedSlot,
} from "./data";
import { isSupabaseConfigured, supabase } from "./supabase";
import "./styles.css";

const AuthContext = createContext(null);

function localDateISO(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function formatMatchCountdown(match, now = Date.now()) {
  const startedAt = new Date(match.startedAt).getTime();
  const stoppedAt = match.endedAt ? new Date(match.endedAt).getTime() : now;
  const elapsedSeconds = Math.max(0, Math.floor((stoppedAt - startedAt) / 1000));
  const remainingSeconds = Math.max(0, 60 * 60 - elapsedSeconds);
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function useCourtsFeed() {
  const [courts, setCourts] = useState([]);
  const [error, setError] = useState("");
  const [availabilityError, setAvailabilityError] = useState("");
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let active = true;
    const refresh = () => {
      getCourts()
        .then((items) => {
          if (active) {
            setCourts(items);
            setError("");
            setAvailabilityError(items.find((court) => court.availabilityError)?.availabilityError || "");
          }
        })
        .catch((reason) => { if (active) setError(reason.message); })
        .finally(() => { if (active) setLoading(false); });
    };
    refresh();
    const refreshInterval = window.setInterval(refresh, 15000);
    const clockInterval = window.setInterval(() => setNow(Date.now()), 1000);
    const channel = supabase.channel("public-court-live-status")
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "partidos_en_vivo",
      }, refresh)
      .subscribe();

    return () => {
      active = false;
      window.clearInterval(refreshInterval);
      window.clearInterval(clockInterval);
      supabase.removeChannel(channel);
    };
  }, []);

  return { courts, error, availabilityError, loading, now };
}

function useAuth() {
  return useContext(AuthContext);
}

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;

    async function restoreSession() {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;

        if (data.session) {
          const profile = await getProfile(data.session.user.id);
          if (active) setUser(profile);
        }
      } catch (error) {
        if (active) {
          setUser(null);
          setNotice(error.message || "No fue posible restaurar tu sesión.");
          await supabase.auth.signOut();
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    restoreSession();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") setUser(null);
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(""), 3800);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const auth = { user, setUser, notify: setNotice };

  return (
    <AuthContext.Provider value={auth}>
      <BrowserRouter>
        <div className="app-shell">
          <Header />
          {notice && <div className="toast" role="status">{notice}</div>}
          <main>
            {loading ? (
              <div className="page-loading"><span className="spinner" />Cargando Campofinder…</div>
            ) : (
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/catalogo" element={<CourtsPage />} />
                <Route path="/cancha/:courtId" element={<CourtDetailsPage />} />
                <Route path="/reservas" element={<RequireUser><ReservationsPage /></RequireUser>} />
                <Route path="/reserva" element={<RequireUser><BookingPage /></RequireUser>} />
                <Route path="/inicio_u" element={<RequireUser><ReservationsPage /></RequireUser>} />
                <Route path="/login" element={user ? <Navigate to="/catalogo" replace /> : <AuthPage mode="login" />} />
                <Route path="/register" element={user ? <Navigate to="/catalogo" replace /> : <AuthPage mode="register" />} />
                <Route path="/logout" element={user ? <LogoutPage /> : <Navigate to="/login" replace />} />
                <Route path="/controladmin" element={<RequireAdmin><AdminPage /></RequireAdmin>} />
                <Route path="/admin/creator" element={<RequireAdmin><AdminPage initialTab="users" /></RequireAdmin>} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            )}
          </main>
          <Footer />
        </div>
      </BrowserRouter>
    </AuthContext.Provider>
  );
}

function Header() {
  const { user, setUser, notify } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  useEffect(() => setMenuOpen(false), [location.pathname]);

  async function logout() {
    const { error } = await supabase.auth.signOut();
    if (error) {
      notify(error.message);
      return;
    }
    setUser(null);
    notify("Sesión cerrada. ¡Hasta pronto!");
  }

  return (
    <header className="site-header">
      <div className="header-inner">
        <Link className="brand" to="/" aria-label="Campofinder, inicio">
          <img className="brand-logo" src="/imagenes/Campofinderlogo.png" alt="" />
          <span className="brand-name">campo<span>finder</span></span>
        </Link>
        <button className="mobile-menu-button" onClick={() => setMenuOpen(!menuOpen)} aria-label="Abrir menú">
          <span /><span /><span />
        </button>
        <nav className={`main-nav ${menuOpen ? "is-open" : ""}`}>
          <Link to="/catalogo">Explorar canchas</Link>
          {user && <Link to="/reservas">Mis reservas</Link>}
          {user?.role === "administrador" && <Link to="/controladmin">Administración</Link>}
          {user ? (
            <div className="nav-account">
              <span className="avatar">{(user.name || user.email || "U").slice(0, 1).toUpperCase()}</span>
              <span className="nav-name">{user.name || user.email}</span>
              <button className="button button-quiet button-small" onClick={logout}>Salir</button>
            </div>
          ) : (
            <div className="nav-actions">
              <Link className="button button-quiet button-small" to="/login">Iniciar sesión</Link>
              <Link className="button button-dark button-small" to="/register">Crear cuenta <span aria-hidden="true">↗</span></Link>
            </div>
          )}
        </nav>
      </div>
    </header>
  );
}

function LogoutPage() {
  const { setUser, notify } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;

    async function signOut() {
      const { error } = await supabase.auth.signOut();
      if (!active) return;

      if (error) notify(error.message);
      else setUser(null);
      navigate("/login", { replace: true });
    }

    signOut();
    return () => {
      active = false;
    };
  }, [navigate, notify, setUser]);

  return <div className="page-loading"><span className="spinner" />Cerrando sesión…</div>;
}

function Footer() {
  return (
    <footer className="site-footer">
      <Link className="brand brand-footer" to="/">
        <img className="brand-logo" src="/imagenes/Campofinderlogo.png" alt="" />
        <span className="brand-name">campo<span>finder</span></span>
      </Link>
      <p>Más juego. Menos vueltas. © {new Date().getFullYear()} Campofinder</p>
      <Link to="/catalogo">Encuentra tu cancha <span aria-hidden="true">↗</span></Link>
    </footer>
  );
}

function RequireUser({ children }) {
  const { user } = useAuth();
  const location = useLocation();
  return user ? children : <Navigate to="/login" state={{ from: `${location.pathname}${location.search}` }} replace />;
}

function RequireAdmin({ children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return user.role === "administrador" ? children : <Navigate to="/catalogo" replace />;
}

const advertiserSeed = [
  {
    id: "patagonia-sports",
    company: "Patagonia Sports",
    description: "Preparación física, equipamiento y contenido deportivo para comunidades activas.",
    logo: "/imagenes/logo1.png",
    contact: "María López",
    email: "hola@patagonasports.co",
    phone: "+57 310 555 1200",
    whatsapp: "+57 310 555 1200",
    website: "https://patagonasports.co",
    social: "@patagonasports",
    city: "Bogotá",
    status: "activo",
  },
  {
    id: "sinergia-bogota",
    company: "Sinergia Bogotá",
    description: "Marca local enfocada en bienestar, eventos deportivos y networking del barrio.",
    logo: "/imagenes/cancha1.png",
    contact: "Carlos Pulido",
    email: "team@sinergiabo.com",
    phone: "+57 321 998 7710",
    whatsapp: "+57 321 998 7710",
    website: "https://sinergiabo.com",
    social: "@sinergia.bogota",
    city: "Cundinamarca",
    status: "activo",
  },
  {
    id: "blue-6-live",
    company: "Blue 6 Live",
    description: "Segmento premium para fútbol urbano, streaming y experiencias de partido.",
    logo: "/imagenes/blue6.png",
    contact: "Laura Ríos",
    email: "contacto@blue6live.co",
    phone: "+57 314 889 4110",
    whatsapp: "+57 314 889 4110",
    website: "https://blue6live.co",
    social: "@blue6live",
    city: "Chía",
    status: "pausado",
  },
];

const campaignSeed = [
  {
    id: "campania-principal",
    name: "Juega mejor en Bogotá",
    advertiser: "Patagonia Sports",
    description: "Campaña principal para impulsar reservas premium y contenido activo entre comunidades locales.",
    banner: "/imagenes/cancha1.png",
    landingUrl: "https://patagonasports.co",
    type: "Banner principal",
    startDate: "2026-11-01",
    endDate: "2026-12-31",
    budget: 1500000,
    contractedPrice: 800000,
    status: "activa",
    space: "Banner principal de patrocinador",
    priority: 1,
    impressions: 243500,
    clicks: 14700,
  },
  {
    id: "campania-aliados",
    name: "Aliados del fútbol local",
    advertiser: "Sinergia Bogotá",
    description: "Alineación con organizaciones, entrenamientos y actividades del barrio.",
    banner: "/imagenes/cancha2.png",
    landingUrl: "https://sinergiabo.com",
    type: "Aliados comerciales",
    startDate: "2026-11-10",
    endDate: "2026-12-20",
    budget: 1100000,
    contractedPrice: 400000,
    status: "programada",
    space: "Sección de aliados comerciales",
    priority: 2,
    impressions: 98000,
    clicks: 5200,
  },
  {
    id: "campania-catalogo",
    name: "Tu próximo partido empieza hoy",
    advertiser: "Blue 6 Live",
    description: "Promoción liderada por contenido deportivo e invitación a jugar con grupos del sector.",
    banner: "/imagenes/donbalon.png",
    landingUrl: "https://blue6live.co",
    type: "Catálogo",
    startDate: "2026-08-01",
    endDate: "2026-11-20",
    budget: 900000,
    contractedPrice: 300000,
    status: "finalizada",
    space: "Publicidad entre tarjetas del catálogo",
    priority: 3,
    impressions: 176000,
    clicks: 8300,
  },
];

const placementSeed = [
  { id: "principal", label: "Banner principal de patrocinador", activeCount: 1, priority: 1 },
  { id: "destacado", label: "Patrocinador destacado en inicio", activeCount: 2, priority: 2 },
  { id: "catalogo", label: "Publicidad entre tarjetas del catálogo", activeCount: 3, priority: 3 },
  { id: "aliados", label: "Sección de aliados comerciales", activeCount: 2, priority: 4 },
  { id: "footer", label: "Publicidad en la parte inferior de la página", activeCount: 1, priority: 5 },
  { id: "contenido", label: "Patrocinadores de contenidos deportivos", activeCount: 1, priority: 6 },
];

function formatMoney(value) {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function getCtr(impressions = 0, clicks = 0) {
  if (!impressions) return 0;
  return (Number(clicks) / Number(impressions)) * 100;
}

function daysUntil(dateString) {
  if (!dateString) return Infinity;
  const target = new Date(`${dateString}T12:00:00`);
  const now = new Date();
  return Math.ceil((target - now) / (1000 * 60 * 60 * 24));
}

function HomePage() {
  const { courts, error, availabilityError, now } = useCourtsFeed();
  const featured = courts.slice(0, 3);

  return (
    <>
      <HeroCarousel courts={courts} />
      <AdvertisingSpotlight />
      {error && <section className="container"><ErrorPanel message={error} /></section>}
      {availabilityError && <p className="availability-warning container" role="status">{availabilityError}</p>}
      <HomeNearbySection courts={courts} now={now} />
      <BrandPartnersSection />
      <section className="section container">
        <div className="section-heading">
          <div><span className="eyebrow">ESCOGE TU LUGAR</span><h2>Un buen partido<br />empieza <em>por la cancha.</em></h2></div>
          <Link className="text-link" to="/catalogo">Ver todas las canchas <span aria-hidden="true">↗</span></Link>
        </div>
        {error ? <ErrorPanel message={error} /> : featured.length ? (
          <div className="court-grid">
            {featured.map((court, index) => <CourtCard key={court.id} court={court} index={index} now={now} />)}
          </div>
        ) : (
          <div className="empty-state"><span className="empty-icon">⌁</span><h3>Pronto habrá canchas aquí</h3><p>Estamos preparando el catálogo para que encuentres tu próximo partido.</p></div>
        )}
      </section>

    </>
  );
}

function HomeNearbySection({ courts, now }) {
  const featuredCourts = courts
    .slice()
    .sort((left, right) => Number(Boolean(right.liveMatch?.status === "en_vivo")) - Number(Boolean(left.liveMatch?.status === "en_vivo"))
      || right.availableSlots - left.availableSlots)
    .slice(0, 4);

  return (
    <section className="home-nearby-section container">
      <div className="home-nearby-courts">
        <span className="eyebrow">CANCHAS Y PARTIDOS</span>
        <h2>Fútbol cerca<br /><em>de tu zona.</em></h2>
        <p>Consulta las canchas registradas, los turnos de hoy y los partidos que están en juego.</p>
        <div className="nearby-court-list">
          {featuredCourts.map((court) => (
            <Link className="nearby-court-row" to={`/reserva?cancha_id=${court.id}`} key={court.id}>
              <img src={courtImageUrl(court.image)} alt="" />
              <span className="nearby-court-info">
                <span className="nearby-court-name-line"><strong>{court.name}</strong>{court.liveMatch?.status === "en_vivo" && <b>{court.liveMatch.homeScore} – {court.liveMatch.awayScore}</b>}</span>
                <small>{court.availableSlots === null ? "Disponibilidad pendiente de actualizar" : court.availableSlots > 0 ? `${court.availableSlots} horarios disponibles hoy` : "Sin horarios disponibles hoy"}</small>
                {court.liveMatch?.status === "en_vivo" && <small className="nearby-live-teams">{court.liveMatch.homeTeam} vs. {court.liveMatch.awayTeam}</small>}
              </span>
              {court.liveMatch?.status === "en_vivo" ? <span className="nearby-live-clock"><i />{formatMatchCountdown(court.liveMatch, now)}</span> : <span className={`nearby-availability ${court.availableSlots > 0 ? "available" : ""}`}>{court.availableSlots === null ? "Ver horario" : court.availableSlots > 0 ? "Disponible hoy" : "Completa"}</span>}
            </Link>
          ))}
          {!featuredCourts.length && <p className="nearby-list-empty">El mapa ya está listo. Las canchas aparecerán aquí cuando se carguen en Campofinder.</p>}
        </div>
        <Link className="text-link" to="/catalogo">Ver todas las canchas <span aria-hidden="true">↗</span></Link>
      </div>
      <NearbyCourtsMap />
    </section>
  );
}

const defaultHeroImages = [
  { name: "Best FT5", image: "imagenes/best ft5.png" },
  { name: "Blue 6", image: "imagenes/blue6.png" },
  { name: "Cancha 1", image: "imagenes/cancha1.png" },
  { name: "Cancha 2", image: "imagenes/cancha2.png" },
  { name: "Don Balón", image: "imagenes/donbalon.png" },
  { name: "La Bombonera", image: "imagenes/labombonera.png" },
  { name: "La Cúpula", image: "imagenes/lacupula.png" },
  { name: "La Arenosa", image: "imagenes/larenosa.png" },
  { name: "La Mendoza", image: "imagenes/La_mendoza.png" },
  { name: "León de Judá", image: "imagenes/leondejuda.png" },
  { name: "Parque Color", image: "imagenes/parquecolor.png" },
  { name: "Punto 30", image: "imagenes/punto30.png" },
];

function AdvertisingSpotlight() {
  const activeCampaign = campaignSeed
    .filter((campaign) => campaign.status === "activa" || campaign.status === "programada")
    .sort((left, right) => left.priority - right.priority)[0];

  if (!activeCampaign) return null;

  const advertiser = advertiserSeed.find((item) => item.company === activeCampaign.advertiser) || advertiserSeed[0];

  return (
    <section className="promo-spotlight container">
      <div className="promo-spotlight-copy">
        <span className="eyebrow">PATROCINADOR DESTACADO</span>
        <h2>{activeCampaign.name}</h2>
        <p>{activeCampaign.description}</p>
        <div className="promo-meta">
          <span>{advertiser.company}</span>
          <span>{activeCampaign.type}</span>
          <span>{activeCampaign.space}</span>
        </div>
        <a className="button button-dark" href={activeCampaign.landingUrl} target="_blank" rel="noreferrer">Descubrir oferta <span aria-hidden="true">↗</span></a>
      </div>
      <div className="promo-spotlight-visual">
        <img src={activeCampaign.banner} alt={activeCampaign.name} />
        <div className="promo-badge">PUBLICIDAD</div>
      </div>
    </section>
  );
}

function BrandPartnersSection() {
  const partners = advertiserSeed.filter((advertiser) => advertiser.status === "activo");

  return (
    <section className="promo-partners section">
      <div className="container promo-partners-inner">
        <div className="section-heading section-heading-inline">
          <div>
            <span className="eyebrow">ALIANZAS COMERCIALES</span>
            <h2>Marcas que<br /><em>apoyan el fútbol.</em></h2>
          </div>
        </div>
        <div className="promo-brand-grid">
          {partners.map((advertiser) => (
            <div className="promo-brand-card" key={advertiser.id}>
              <img src={advertiser.logo} alt={advertiser.company} />
              <strong>{advertiser.company}</strong>
              <small>{advertiser.city}</small>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function HeroCarousel({ courts }) {
  const courtSlides = courts
    .filter((court) => court.image && !court.image.toLowerCase().includes("logo"))
    .map((court) => ({ name: court.name, image: court.image }));
  const slides = courtSlides.length ? courtSlides : defaultHeroImages;
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    setActiveIndex(0);
  }, [slides.length]);

  useEffect(() => {
    if (slides.length < 2) return undefined;
    const timer = window.setInterval(() => {
      setActiveIndex((index) => (index + 1) % slides.length);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [slides.length]);
  const activeSlide = slides[activeIndex % slides.length];

  return (
      <section className="hero">
        <div className="hero-image" key={activeSlide.image}><img src={courtImageUrl(activeSlide.image)} alt="" /></div>
        <div className="hero-content container">
          <span className="eyebrow eyebrow-light"><span className="eyebrow-dot" /> FÚTBOL · EL PARTIDO EMPIEZA AQUÍ</span>
          <h1>Tu próxima cancha<br />está <em>a un toque.</em></h1>
          <p>Encuentra una cancha de fútbol, arma el equipo y reserva. Así de fácil.</p>
          <div className="hero-actions">
            <Link className="button button-lime button-large" to="/catalogo">Explorar canchas <span aria-hidden="true">↗</span></Link>
            <span className="hero-note">Solo fútbol · Hecho para jugar</span>
          </div>
          <div className="hero-stats">
            <div><strong>{courts.length || slides.length}</strong><span>canchas para jugar</span></div>
            <div className="hero-stat-divider" />
            <div><strong>{activeSlide.name}</strong><span>conoce nuestras canchas</span></div>
          </div>
        </div>
        <div className="hero-carousel-controls" aria-label="Fotos de canchas">
          {slides.map((slide, index) => <button key={`${slide.image}-${index}`} type="button" className={index === activeIndex ? "active" : ""} aria-label={`Mostrar ${slide.name}`} aria-pressed={index === activeIndex} onClick={() => setActiveIndex(index)} />)}
        </div>
        <span className="hero-index">{String(activeIndex + 1).padStart(2, "0")} — {String(slides.length).padStart(2, "0")}</span>
      </section>
  );
}

function CourtsPage() {
  const { courts, error, availabilityError, loading, now } = useCourtsFeed();
  const [query, setQuery] = useState("");
  const filtered = courts.filter((court) => `${court.name} ${court.description || ""}`.toLowerCase().includes(query.toLowerCase()));
  const sponsorCampaign = campaignSeed.find((campaign) => campaign.status === "activa") || campaignSeed[0];

  return (
    <section className="section container catalog-page">
      <div className="catalog-heading">
        <div><span className="eyebrow">ELIGE DÓNDE JUGAR</span><h1>Canchas que<br /><em>arman plan.</em></h1></div>
        <p>Busca un espacio para tu próximo partido.<br />Elige tu cancha y reserva en minutos.</p>
      </div>
      <div className="catalog-toolbar">
        <label className="search-field"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Busca por nombre o descripción" aria-label="Buscar canchas" /></label>
        <span className="result-count">{filtered.length} {filtered.length === 1 ? "cancha" : "canchas"}</span>
      </div>
      {availabilityError && <p className="availability-warning" role="status">{availabilityError}</p>}
      {loading ? <Loading /> : error ? <ErrorPanel message={error} /> : filtered.length ? (
        <div className="court-grid">
          {filtered.flatMap((court, index) => {
            const cards = [<CourtCard key={court.id} court={court} index={index} now={now} />];
            if ((index + 1) % 3 === 0 && sponsorCampaign) {
              cards.push(
                <article className="promo-inline-card" key={`${court.id}-sponsor`}>
                  <span className="eyebrow">PUBLICIDAD · PATROCINADO</span>
                  <h3>{sponsorCampaign.name}</h3>
                  <img src={sponsorCampaign.banner} alt={sponsorCampaign.name} />
                  <p>{sponsorCampaign.description}</p>
                  <a href={sponsorCampaign.landingUrl} target="_blank" rel="noreferrer">Ver oferta <span aria-hidden="true">↗</span></a>
                </article>,
              );
            }
            return cards;
          })}
        </div>
      ) : <div className="empty-state"><span className="empty-icon">⌕</span><h3>No encontramos esa cancha</h3><p>Prueba con otro nombre o vuelve a ver todas.</p><button className="button button-outline" onClick={() => setQuery("")}>Limpiar búsqueda</button></div>}
    </section>
  );
}

function CourtCard({ court, index = 0, now = Date.now() }) {
  const image = courtImageUrl(court.image);
  const initials = (court.name || "CF").split(" ").slice(0, 2).map((part) => part[0]).join("");
  const availableToday = court.availableSlots > 0;
  const liveMatch = court.liveMatch?.status === "en_vivo" ? court.liveMatch : null;
  return (
    <article className="court-card" style={{ "--card-delay": `${index * 70}ms` }}>
      <Link className="court-image-wrap" to={`/reserva?cancha_id=${court.id}`}>
        <img className="court-image" src={image} alt={court.name} loading="lazy" onError={(event) => { event.currentTarget.src = "/imagenes/logo1.png"; }} />
        <span className={`court-status ${court.availableSlots === null ? "status-pending" : availableToday ? "" : "status-muted"}`}><span />{court.availableSlots === null ? "Horario por verificar" : availableToday ? "Disponible hoy" : "Sin turnos hoy"}</span>
        {liveMatch && <span className="court-live-overlay"><span><i />EN VIVO</span><strong>{formatMatchCountdown(liveMatch, now)}</strong><small>{liveMatch.homeTeam} {liveMatch.homeScore} – {liveMatch.awayScore} {liveMatch.awayTeam}</small></span>}
        <span className="court-image-arrow" aria-hidden="true">↗</span>
      </Link>
      <div className="court-info">
        <div className="court-category"><span>{initials}</span> ESPACIO DEPORTIVO</div>
        <div className="court-name-line">
          <Link to={`/reserva?cancha_id=${court.id}`} className="court-name">{court.name}</Link>
          {liveMatch && <strong className="court-name-score" aria-label={`Marcador ${liveMatch.homeScore} a ${liveMatch.awayScore}`}>{liveMatch.homeScore} – {liveMatch.awayScore}</strong>}
        </div>
        {liveMatch && <p className="court-name-teams">{liveMatch.homeTeam} vs. {liveMatch.awayTeam}</p>}
        <p className="court-description">{court.description || `Hoy: ${court.availableSlots === null ? "disponibilidad por verificar" : availableToday ? `${court.availableSlots} horarios disponibles` : "sin turnos disponibles"}. ${court.openingTime}–${court.closingTime}.`}</p>
        <div className="court-card-footer">
          <span className="court-price">{court.price ? `$${Number(court.price).toLocaleString("es-CO")}` : "Consultar precio"}<small>{court.price ? " / hora" : ""}</small></span>
          <Link to={`/reserva?cancha_id=${court.id}`} className="text-link">Reservar <span aria-hidden="true">→</span></Link>
        </div>
      </div>
    </article>
  );
}

function CourtDetailsPage() {
  const { courtId } = useParams();
  const [court, setCourt] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    getCourts()
      .then((items) => setCourt(items.find((item) => String(item.id) === courtId) || null))
      .catch((reason) => setError(reason.message))
      .finally(() => setLoading(false));
  }, [courtId]);
  if (loading) return <Loading />;
  if (!court) return <section className="section container"><ErrorPanel message={error || "No encontramos esta cancha."} /><Link className="button button-dark" to="/catalogo">Ver catálogo</Link></section>;
  return (
    <section className="section container detail-page">
      <Link className="back-link" to="/catalogo">← Volver a las canchas</Link>
      <div className="detail-layout">
        <img src={courtImageUrl(court.image)} alt={court.name} onError={(event) => { event.currentTarget.src = "/imagenes/logo1.png"; }} />
        <div><span className="eyebrow">ESPACIO DEPORTIVO</span><h1>{court.name}</h1><p>{court.description || "Un espacio listo para disfrutar tu próximo partido."}</p><div className="detail-price">{court.price ? `$${Number(court.price).toLocaleString("es-CO")}` : "Consultar precio"}{court.price && <small> / hora</small>}</div><div className="detail-availability"><span />Todos los días · {court.openingTime} a {court.closingTime}</div><Link className="button button-dark button-large" to={`/reserva?cancha_id=${court.id}`}>Reservar cancha <span aria-hidden="true">↗</span></Link></div>
      </div>
      <LiveScoreboard court={court} />
    </section>
  );
}

function LiveScoreboard({ court }) {
  const [match, setMatch] = useState(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let active = true;
    const refresh = () => getLiveMatch(court.id).then((value) => {
      if (active) { setMatch(value); setError(""); }
    }).catch((reason) => { if (active) setError(reason.message); });
    refresh();
    const channel = supabase.channel(`live-match-${court.id}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "partidos_en_vivo",
        filter: `cancha_id=eq.${court.id}`,
      }, refresh)
      .subscribe();
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      active = false;
      window.clearInterval(timer);
      supabase.removeChannel(channel);
    };
  }, [court.id]);

  if (error) return <ErrorPanel message={error} />;
  if (!match) return null;

  return (
    <article className={`live-score-card ${match.status === "en_vivo" ? "is-live" : ""}`}>
      <div className="live-score-heading"><span className="eyebrow">{match.status === "en_vivo" ? "MARCADOR EN DIRECTO" : "ÚLTIMO MARCADOR"}</span><span className="live-state"><i />{match.status === "en_vivo" ? "EN VIVO" : "FINALIZADO"}</span></div>
      <div className="live-score-teams"><span>{match.homeTeam}</span><strong>{match.homeScore} <small>—</small> {match.awayScore}</strong><span>{match.awayTeam}</span></div>
      <p className="live-elapsed">{match.status === "en_vivo" ? "Tiempo restante" : "Tiempo restante al finalizar"} · {formatMatchCountdown(match, now)}</p>
    </article>
  );
}

function AuthPage({ mode }) {
  const isRegister = mode === "register";
  const { setUser, notify } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setError(""); setSuccess("");
    let signedIn = false;
    try {
      if (isRegister) {
        const { data, error: authError } = await supabase.auth.signUp({
          email: form.get("email"),
          password: form.get("password"),
          options: { data: { full_name: form.get("name") } },
        });
        if (authError) throw authError;
        if (data.session) {
          signedIn = true;
          const profile = await getProfile(data.user.id);
          setUser(profile);
          notify(`Qué bueno verte, ${profile.name || profile.email}.`);
          navigate("/inicio_u", { replace: true });
        } else {
          setSuccess("Cuenta creada. Revisa tu correo para confirmar la dirección antes de iniciar sesión.");
        }
      } else {
        const { data, error: authError } =
          await supabase.auth.signInWithPassword({
            email: form.get("email"),
            password: form.get("password"),
          });
        if (authError) throw authError;
        if (!data.session) {
          throw new Error("Supabase no devolvió una sesión válida.");
        }
        signedIn = true;
        const profile = await getProfile(data.user.id);
        setUser(profile);
        notify(`Qué bueno verte, ${profile.name || profile.email}.`);
        navigate(
          profile.role === "administrador"
            ? "/controladmin"
            : location.state?.from || "/inicio_u",
          { replace: true },
        );
      }
    } catch (reason) {
      if (signedIn) {
        await supabase.auth.signOut();
      }
      setError(reason.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="auth-page">
      <div className="auth-visual">
        <img src="/imagenes/cancha1.png" alt="" />
        <div className="auth-visual-shade" />
        <Link className="brand auth-brand" to="/"><img className="brand-logo" src="/imagenes/Campofinderlogo.png" alt="" /><span className="brand-name">campo<span>finder</span></span></Link>
        <div className="auth-quote"><span className="eyebrow eyebrow-light">AQUÍ ARRANCA EL PARTIDO</span><p>“Lo mejor del juego<br />es todo lo que pasa<br /><em>cuando nos encontramos.</em>”</p></div>
        <span className="auth-credit">HECHO PARA JUGAR</span>
      </div>
      <div className="auth-form-side">
        <div className="auth-card">
          <span className="eyebrow">{isRegister ? "ÚNETE AL EQUIPO" : "QUÉ BUENO VERTE"}</span>
          <h1>{isRegister ? <>Crea tu<br /><em>cuenta.</em></> : <>Volvamos<br /><em>al juego.</em></>}</h1>
          <p className="auth-intro">{isRegister ? "Guarda tus canchas favoritas y lleva tus reservas contigo." : "Inicia sesión para ver tus reservas y encontrar dónde jugar."}</p>
          <form onSubmit={handleSubmit} className="auth-form">
            {isRegister && <label>Tu nombre<input name="name" type="text" placeholder="¿Cómo te llamas?" autoComplete="name" required maxLength={100} /></label>}
            <label>Correo electrónico<input name="email" type="email" placeholder="tu@correo.com" autoComplete="email" required /></label>
            <label>Contraseña<input name="password" type="password" placeholder={isRegister ? "Al menos 8 caracteres" : "Tu contraseña"} autoComplete={isRegister ? "new-password" : "current-password"} minLength={isRegister ? 8 : undefined} required /></label>
            {error && <p className="form-message form-error" role="alert">{error}</p>}
            {success && <p className="form-message form-success" role="status">{success}</p>}
            <button className="button button-dark button-full button-large" type="submit" disabled={busy}>{busy ? "Un momento…" : isRegister ? "Crear mi cuenta" : "Iniciar sesión"} <span aria-hidden="true">↗</span></button>
          </form>
          <p className="auth-switch">{isRegister ? "¿Ya tienes cuenta?" : "¿Primera vez por aquí?"} <Link to={isRegister ? "/login" : "/register"}>{isRegister ? "Inicia sesión" : "Crea tu cuenta"}</Link></p>
          <Link className="auth-back" to="/">← Volver al inicio</Link>
        </div>
      </div>
    </section>
  );
}

function BookingPage() {
  const { user, notify } = useAuth();
  const navigate = useNavigate();
  const courtId = new URLSearchParams(useLocation().search).get("cancha_id");
  const [court, setCourt] = useState(null);
  const [availability, setAvailability] = useState({ blocked: [], reserved: [] });
  const [day, setDay] = useState(localDateISO());
  const [time, setTime] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [clock, setClock] = useState(Date.now());
  const today = localDateISO(new Date(clock));
  const currentTime = new Date(clock).getHours() * 60 + new Date(clock).getMinutes();
  const slots = courtSlots(court).filter((slot) => {
    if (day !== today) return true;
    const [hour, minute] = slot.slice(0, 5).split(":").map(Number);
    return hour * 60 + minute > currentTime;
  });

  useEffect(() => {
    if (!courtId) return;
    getCourts().then((items) => setCourt(items.find((item) => String(item.id) === String(courtId)) || null)).catch((reason) => setError(reason.message));
  }, [courtId]);
  useEffect(() => {
    if (!courtId || !day) return;
    let active = true;
    const refresh = () => getCourtAvailability(courtId, day)
      .then((value) => { if (active) setAvailability(value); })
      .catch((reason) => { if (active) setError(reason.message); });
    refresh();
    const interval = window.setInterval(refresh, 15000);
    return () => { active = false; window.clearInterval(interval); };
  }, [courtId, day]);
  useEffect(() => {
    const interval = window.setInterval(() => setClock(Date.now()), 30000);
    return () => window.clearInterval(interval);
  }, []);

  async function reserve(event) {
    event.preventDefault();
    if (!time) return setError("Elige un horario para continuar.");
    setBusy(true); setError("");
    try {
      await createReservation({
        courtId,
        date: day,
        time,
        message,
      });
      notify("¡Cancha reservada! Nos vemos en la cancha.");
      navigate("/reservas");
    } catch (reason) {
      setError(reason.message);
      getCourtAvailability(courtId, day).then(setAvailability).catch((availabilityError) => setError(availabilityError.message));
    } finally {
      setBusy(false);
    }
  }

  if (!courtId) return <section className="section container"><ErrorPanel message="Elige una cancha del catálogo para reservar." /><Link className="button button-dark" to="/catalogo">Ver canchas</Link></section>;
  if (!court && !error) return <Loading />;
  if (!court) return <section className="section container"><ErrorPanel message={error || "No encontramos esa cancha."} /><Link className="button button-dark" to="/catalogo">Ver canchas</Link></section>;

  const occupied = new Set([...availability.blocked, ...availability.reserved]);
  return (
    <section className="section container booking-page">
      <Link className="back-link" to="/catalogo">← Volver al catálogo</Link>
      <div className="booking-layout">
        <div className="booking-summary">
          <img src={courtImageUrl(court.image)} alt={court.name} onError={(event) => { event.currentTarget.src = "/imagenes/logo1.png"; }} />
          <span className="eyebrow">TU PRÓXIMO PARTIDO</span>
          <h1>{court.name}</h1>
          <p>{court.description || "Un espacio listo para recibir a tu equipo."}</p>
          <div className="booking-price">{court.price ? `$${Number(court.price).toLocaleString("es-CO")}` : "Precio por consultar"}<small>{court.price ? " / hora" : ""}</small></div>
          <div className="booking-user"><span className="avatar">{(user.name || user.email).slice(0, 1).toUpperCase()}</span><div><small>RESERVANDO COMO</small><span>{user.name || user.email}</span></div></div>
        </div>
        <form className="booking-form" onSubmit={reserve}>
          <span className="eyebrow">RESERVA TU ESPACIO</span>
          <h2>Elige fecha<br />y <em>horario.</em></h2>
          <label className="date-field">Fecha<input type="date" min={localDateISO()} value={day} onChange={(event) => { setDay(event.target.value); setTime(""); }} required /></label>
          <div className="slot-heading"><span>Horarios disponibles</span><small>{court.openingTime}–{court.closingTime} · 1 hora</small></div>
          <div className="slot-grid">{slots.map((slot) => {
            const unavailable = occupied.has(slot);
            return <button type="button" key={slot} disabled={unavailable} className={`slot-button ${time === slot ? "is-selected" : ""} ${unavailable ? "is-unavailable" : ""}`} onClick={() => { setTime(slot); setError(""); }}>{slot.slice(0, 5)}<small>{unavailable ? "Ocupado" : "Disponible"}</small></button>;
          })}{!slots.length && <p className="muted-copy slot-empty">No quedan horarios disponibles para esta fecha.</p>}</div>
          <label className="date-field">Un mensaje para la cancha <span className="optional">(opcional)</span><textarea rows="3" maxLength="500" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="¿Algún detalle que debamos saber?" /></label>
          {error && <p className="form-message form-error" role="alert">{error}</p>}
          <button type="submit" className="button button-dark button-full button-large" disabled={busy}>{busy ? "Confirmando…" : "Confirmar reserva"} <span aria-hidden="true">↗</span></button>
          <p className="booking-footnote">Al reservar, tu horario quedará guardado en tu cuenta.</p>
        </form>
      </div>
    </section>
  );
}

function NearbyCourtsMap() {
  const [location, setLocation] = useState({ latitude: 4.5810514, longitude: -74.235904 });
  const [usingCurrentLocation, setUsingCurrentLocation] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function findNearbyCourts() {
    if (!navigator.geolocation) {
      setError("Este navegador no permite consultar la ubicación. Puedes buscar canchas directamente en Google Maps.");
      return;
    }

    setBusy(true);
    setError("");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setLocation({ latitude: coords.latitude, longitude: coords.longitude });
        setUsingCurrentLocation(true);
        setBusy(false);
      },
      (reason) => {
        const message = reason.code === 1
          ? "No se concedió permiso para la ubicación. Puedes habilitarlo en el navegador e intentarlo de nuevo."
          : reason.code === 3
            ? "La ubicación tardó demasiado. Inténtalo de nuevo."
            : "No fue posible obtener tu ubicación. Revisa los permisos del navegador e inténtalo de nuevo.";
        setError(message);
        setBusy(false);
      },
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 12_000 },
    );
  }

  const mapUrl = `https://maps.google.com/maps?q=canchas+futbol&ll=${location.latitude},${location.longitude}&z=14&output=embed`;
  const directionsUrl = `https://www.google.com/maps/search/canchas+futbol/@${location.latitude},${location.longitude},14z`;

  return (
    <section className="nearby-map-section">
      <div className="nearby-map-heading">
        <div><span className="eyebrow">JUEGA CERCA DE TI</span><h2>Encuentra fútbol<br /><em>en tu zona.</em></h2><p>El mapa inicia en Soacha, en el sector que compartiste. Si quieres, céntralo en tu ubicación actual para buscar canchas cercanas.</p></div>
        <button type="button" className="button button-dark" onClick={findNearbyCourts} disabled={busy}>{busy ? "Buscando ubicación…" : usingCurrentLocation ? "Actualizar mi ubicación" : "Usar mi ubicación"} <span aria-hidden="true">⌖</span></button>
      </div>
      <p className="nearby-map-privacy">{usingCurrentLocation ? "El mapa está centrado en tu ubicación actual, compartida con permiso del navegador. Google Maps recibe esas coordenadas para mostrar resultados." : "Vista inicial basada en el enlace de Google Maps que compartiste (Soacha). Tu ubicación personal solo se solicita si pulsas «Usar mi ubicación»."}</p>
      {error && <ErrorPanel message={error} />}
      <div className="nearby-map-content">
        <iframe title="Mapa de canchas de fútbol cercanas" src={mapUrl} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
        <a className="text-link" href={directionsUrl} target="_blank" rel="noreferrer">Abrir resultados en Google Maps <span aria-hidden="true">↗</span></a>
      </div>
    </section>
  );
}

function ReservationsPage() {
  const { user, notify } = useAuth();
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function loadReservations() {
    try { setItems(await getReservations(user.id)); }
    catch (reason) { setError(reason.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { loadReservations(); }, [user.id]);

  async function cancel(id) {
    if (!window.confirm("¿Quieres cancelar esta reserva?")) return;
    try {
      await cancelReservation(id);
      setItems((current) => current.filter((item) => item.id !== id));
      notify("Reserva cancelada.");
    } catch (reason) { setError(reason.message); }
  }

  return (
    <section className="section container reservations-page">
      <div className="catalog-heading"><div><span className="eyebrow">TU PLAN DE JUEGO</span><h1>Mis<br /><em>reservas.</em></h1></div><Link className="button button-dark" to="/catalogo">Buscar cancha <span aria-hidden="true">↗</span></Link></div>
      {loading ? <Loading /> : error ? <ErrorPanel message={error} /> : items.length ? (
        <div className="reservation-list">{items.map((item) => <article className="reservation-card" key={item.id}><div className="reservation-date"><span>{new Date(`${item.date}T12:00:00`).toLocaleDateString("es-CO", { day: "2-digit" })}</span><small>{new Date(`${item.date}T12:00:00`).toLocaleDateString("es-CO", { month: "short" }).replace(".", "").toUpperCase()}</small></div><div className="reservation-details"><span className="eyebrow">CANCHA RESERVADA</span><h3>{item.court}</h3><p>{new Date(`${item.date}T12:00:00`).toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long" })} · {item.time}</p>{item.message && <small>{item.message}</small>}</div><span className="reservation-status"><span /> Confirmada</span><button className="button button-quiet button-small" onClick={() => cancel(item.id)}>Cancelar</button></article>)}</div>
      ) : <div className="empty-state"><span className="empty-icon">⌁</span><h3>Tu próximo partido te espera</h3><p>Todavía no tienes reservas. Encuentra una cancha y arma el plan.</p><Link className="button button-dark" to="/catalogo">Explorar canchas <span aria-hidden="true">↗</span></Link></div>}
    </section>
  );
}

function AdminLiveScorePanel({ courts, notify }) {
  const [matches, setMatches] = useState([]);
  const [reservations, setReservations] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reservationId, setReservationId] = useState("");
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  async function loadMatches() {
    try {
      const [liveMatches, upcomingReservations] = await Promise.all([
        getLiveMatches(courts.map((court) => court.id)),
        getAdminReservations(),
      ]);
      setMatches(liveMatches);
      setReservations(upcomingReservations);
      setError("");
    } catch (reason) {
      setError(reason.message);
    }
  }

  useEffect(() => {
    if (!courts.length) return undefined;
    loadMatches();
    const channel = supabase.channel("admin-live-scores")
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "partidos_en_vivo",
      }, loadMatches)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [courts]);

  async function begin(event) {
    event.preventDefault();
    const reservation = availableReservations.find((item) => String(item.id) === reservationId);
    if (!reservation) {
      setError("Selecciona una reserva disponible para iniciar el partido.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await startLiveMatch({
        courtId: reservation.court.id,
        reservationId: reservation.id,
        homeTeam: reservedTeamName(reservation.playerName),
        awayTeam: "Team visitante",
      });
      notify("Partido iniciado. El marcador ya está visible en la ficha de la cancha.");
      await loadMatches();
    } catch (reason) {
      setError(reason.message);
    } finally {
      setBusy(false);
    }
  }

  async function changeScore(match, side, change) {
    setBusy(true);
    setError("");
    try {
      await updateLiveScore(match.courtId, side, change);
      await loadMatches();
    } catch (reason) {
      setError(reason.message);
    } finally {
      setBusy(false);
    }
  }

  async function finish(match) {
    setBusy(true);
    setError("");
    try {
      await finishLiveMatch(match.courtId);
      notify("Partido finalizado.");
      await loadMatches();
    } catch (reason) {
      setError(reason.message);
    } finally {
      setBusy(false);
    }
  }

  const activeMatches = matches.filter((match) => match.status === "en_vivo");
  const usedReservationIds = new Set(matches.map((match) => String(match.reservationId)).filter(Boolean));
  const availableReservations = reservations
    .map((reservation) => ({
      ...reservation,
      court: courts.find((court) => court.name === reservation.courtName),
    }))
    .filter((reservation) => reservation.court && !usedReservationIds.has(String(reservation.id)));
  const selectedReservation = availableReservations.find((item) => String(item.id) === reservationId);
  const selectedCourtHasActiveMatch = selectedReservation
    && activeMatches.some((match) => String(match.courtId) === String(selectedReservation.court.id));

  useEffect(() => {
    if (!availableReservations.some((item) => String(item.id) === reservationId)) {
      setReservationId(String(availableReservations[0]?.id || ""));
    }
  }, [availableReservations, reservationId]);

  return (
    <div className="live-admin">
      <div className="live-admin-intro"><span className="eyebrow">SEGUIMIENTO DEL PARTIDO</span><h2>Marcador y tiempo<br /><em>en directo.</em></h2><p>Inicia el partido desde aquí. El marcador y el cronómetro se actualizan en tiempo real para quienes visiten la ficha de la cancha.</p></div>
      {error && <ErrorPanel message={error} />}
      {!courts.length ? <div className="empty-state"><h3>No tienes canchas asignadas</h3><p>Asigna canchas a tu perfil para iniciar partidos.</p></div> : (
        <>
          {activeMatches.map((match) => {
            const court = courts.find((item) => item.id === match.courtId);
            return <article className="live-admin-match" key={match.courtId}>
              <span className="eyebrow">{court?.name || "Cancha"} · EN VIVO</span>
              <div className="live-score-teams"><span>{match.homeTeam}</span><strong>{match.homeScore} <small>—</small> {match.awayScore}</strong><span>{match.awayTeam}</span></div>
              <p className="live-elapsed">Tiempo restante · {formatMatchCountdown(match, now)}</p>
              <div className="score-controls">
                <div><button type="button" className="button button-outline button-small" disabled={busy} aria-label={`Restar gol a ${match.homeTeam}`} onClick={() => changeScore(match, "local", -1)}>−</button><button type="button" className="button button-dark button-small" disabled={busy} aria-label={`Sumar gol a ${match.homeTeam}`} onClick={() => changeScore(match, "local", 1)}>+</button></div>
                <div><button type="button" className="button button-outline button-small" disabled={busy} aria-label={`Restar gol a ${match.awayTeam}`} onClick={() => changeScore(match, "visitante", -1)}>−</button><button type="button" className="button button-dark button-small" disabled={busy} aria-label={`Sumar gol a ${match.awayTeam}`} onClick={() => changeScore(match, "visitante", 1)}>+</button></div>
                <button type="button" className="button button-danger button-small" disabled={busy} onClick={() => finish(match)}>Finalizar partido</button>
              </div>
            </article>;
          })}
          <form className="live-start-form" onSubmit={begin}>
            <h3>Iniciar desde una reserva</h3>
            <label className="live-booking-select">Reserva<select value={reservationId} onChange={(event) => setReservationId(event.target.value)} required>
              <option value="">Selecciona una reserva</option>
              {availableReservations.map((reservation) => <option value={reservation.id} key={reservation.id}>{reservation.courtName} · {reservation.date} · {reservation.time} · {reservation.playerName}</option>)}
            </select></label>
            {selectedReservation && <div className="live-team-preview"><span>Equipo que reservó</span><strong>{reservedTeamName(selectedReservation.playerName)}</strong><span>Equipo rival</span><strong>Team visitante</strong></div>}
            {!availableReservations.length && <p className="muted-copy live-no-bookings">No hay reservas próximas disponibles para iniciar un partido.</p>}
            <button type="submit" className="button button-dark" disabled={busy || !selectedReservation || selectedCourtHasActiveMatch}>Iniciar cronómetro y marcador <span aria-hidden="true">↗</span></button>
            {selectedCourtHasActiveMatch && <small className="muted-copy live-no-bookings">Ya hay un partido activo en esta cancha.</small>}
          </form>
        </>
      )}
    </div>
  );
}

function reservedTeamName(playerName) {
  return `Team ${playerName}`.slice(0, 60).trim();
}

function AdminAdvertisingPanel() {
  const [advertisers, setAdvertisers] = useState(advertiserSeed);
  const [campaigns, setCampaigns] = useState(campaignSeed);
  const [placements, setPlacements] = useState(placementSeed);

  const summary = {
    activeAds: campaigns.filter((campaign) => campaign.status === "activa").length,
    sponsors: advertisers.filter((advertiser) => advertiser.status === "activo").length,
    campaignsInForce: campaigns.filter((campaign) => ["activa", "programada"].includes(campaign.status)).length,
    impressions: campaigns.reduce((sum, campaign) => sum + Number(campaign.impressions || 0), 0),
    clicks: campaigns.reduce((sum, campaign) => sum + Number(campaign.clicks || 0), 0),
    ctr: getCtr(
      campaigns.reduce((sum, campaign) => sum + Number(campaign.impressions || 0), 0),
      campaigns.reduce((sum, campaign) => sum + Number(campaign.clicks || 0), 0),
    ),
    expiringSoon: campaigns.filter((campaign) => daysUntil(campaign.endDate) <= 14 && campaign.status !== "finalizada").length,
    revenue: campaigns.reduce((sum, campaign) => sum + Number(campaign.contractedPrice || 0), 0),
  };

  function addAdvertiser(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const company = String(form.get("company") || "").trim();
    if (!company) return;
    const nextAdvertiser = {
      id: `advertiser-${company.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      company,
      description: String(form.get("description") || ""),
      logo: String(form.get("logo") || "/imagenes/logo1.png"),
      contact: String(form.get("contact") || "Contacto"),
      email: String(form.get("email") || "contacto@campofinder.co"),
      phone: String(form.get("phone") || ""),
      whatsapp: String(form.get("whatsapp") || ""),
      website: String(form.get("website") || "https://campofinder.co"),
      social: String(form.get("social") || "@campofinder"),
      city: String(form.get("city") || "Bogotá"),
      status: String(form.get("status") || "activo"),
    };
    setAdvertisers((current) => [nextAdvertiser, ...current]);
    event.currentTarget.reset();
  }

  function addCampaign(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const nextCampaign = {
      id: `campaign-${Date.now()}`,
      name: String(form.get("name") || "Campaña nueva"),
      advertiser: String(form.get("advertiser") || advertisers[0]?.company || "Patagonia Sports"),
      description: String(form.get("description") || ""),
      banner: String(form.get("banner") || "/imagenes/cancha1.png"),
      landingUrl: String(form.get("landingUrl") || "https://campofinder.co"),
      type: String(form.get("type") || "Banner principal"),
      startDate: String(form.get("startDate") || "2026-11-01"),
      endDate: String(form.get("endDate") || "2026-11-30"),
      budget: Number(form.get("budget") || 0),
      contractedPrice: Number(form.get("contractedPrice") || 0),
      status: String(form.get("status") || "borrador"),
      space: String(form.get("space") || "Banner principal de patrocinador"),
      priority: Number(form.get("priority") || 1),
      impressions: Number(form.get("impressions") || 0),
      clicks: Number(form.get("clicks") || 0),
    };
    setCampaigns((current) => [nextCampaign, ...current]);
    event.currentTarget.reset();
  }

  function toggleCampaignStatus(campaignId) {
    setCampaigns((current) => current.map((campaign) => {
      if (campaign.id !== campaignId) return campaign;
      const statuses = ["borrador", "programada", "activa", "pausada", "finalizada"];
      const currentIndex = statuses.indexOf(campaign.status);
      const nextStatus = statuses[(currentIndex + 1) % statuses.length];
      return { ...campaign, status: nextStatus };
    }));
  }

  function removeCampaign(campaignId) {
    setCampaigns((current) => current.filter((campaign) => campaign.id !== campaignId));
  }

  return (
    <div className="admin-advertising">
      <div className="advertising-header">
        <div>
          <span className="eyebrow">PUBLICIDAD Y PATROCINADORES</span>
          <h2>Panel general<br /><em>de monetización.</em></h2>
        </div>
      </div>
      <div className="ad-stats-grid">
        <article className="ad-stat">
          <small>Anuncios activos</small>
          <strong>{summary.activeAds}</strong>
        </article>
        <article className="ad-stat">
          <small>Patrocinadores registrados</small>
          <strong>{summary.sponsors}</strong>
        </article>
        <article className="ad-stat">
          <small>Campañas vigentes</small>
          <strong>{summary.campaignsInForce}</strong>
        </article>
        <article className="ad-stat">
          <small>Impresiones totales</small>
          <strong>{summary.impressions.toLocaleString("es-CO")}</strong>
        </article>
        <article className="ad-stat">
          <small>Clics totales</small>
          <strong>{summary.clicks.toLocaleString("es-CO")}</strong>
        </article>
        <article className="ad-stat">
          <small>CTR</small>
          <strong>{summary.ctr.toFixed(2)}%</strong>
        </article>
        <article className="ad-stat">
          <small>Próximas a vencer</small>
          <strong>{summary.expiringSoon}</strong>
        </article>
        <article className="ad-stat">
          <small>Ingresos registrados</small>
          <strong>{formatMoney(summary.revenue)}</strong>
        </article>
      </div>

      <div className="admin-ad-layout">
        <section className="ad-section-card">
          <div className="section-card-header">
            <h3>Gestión de anunciantes</h3>
          </div>
          <form className="ad-form-grid" onSubmit={addAdvertiser}>
            <label>Nombre comercial<input name="company" required /></label>
            <label>Persona de contacto<input name="contact" required /></label>
            <label>Correo electrónico<input name="email" type="email" required /></label>
            <label>Teléfono<input name="phone" /></label>
            <label>WhatsApp<input name="whatsapp" /></label>
            <label>Página web<input name="website" type="url" /></label>
            <label>Redes sociales<input name="social" /></label>
            <label>Ciudad o zona<input name="city" /></label>
            <label>Logo<input name="logo" defaultValue="/imagenes/logo1.png" /></label>
            <label>Estado<select name="status" defaultValue="activo"><option value="activo">Activo</option><option value="pausado">Pausado</option></select></label>
            <label className="field-span-full">Descripción<textarea name="description" rows="3" /></label>
            <button className="button button-dark" type="submit">Registrar anunciante</button>
          </form>
          <div className="ad-list">
            {advertisers.map((advertiser) => (
              <div className="ad-row" key={advertiser.id}>
                <div>
                  <strong>{advertiser.company}</strong>
                  <small>{advertiser.city} · {advertiser.contact}</small>
                </div>
                <span className={`status-pill ${advertiser.status === "activo" ? "status-live" : "status-paused"}`}>{advertiser.status}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="ad-section-card">
          <div className="section-card-header">
            <h3>Gestión de campañas</h3>
          </div>
          <form className="ad-form-grid" onSubmit={addCampaign}>
            <label>Nombre<input name="name" required /></label>
            <label>Anunciante<select name="advertiser" defaultValue={advertisers[0]?.company || "Patagonia Sports"}>
              {advertisers.map((advertiser) => <option key={advertiser.id} value={advertiser.company}>{advertiser.company}</option>)}
            </select></label>
            <label>Tipo de publicidad<select name="type" defaultValue="Banner principal"><option value="Banner principal">Banner principal</option><option value="Patrocinador destacado">Patrocinador destacado</option><option value="Catálogo">Catálogo</option><option value="Aliados comerciales">Aliados comerciales</option></select></label>
            <label>Espacio<select name="space" defaultValue="Banner principal de patrocinador"><option value="Banner principal de patrocinador">Banner principal de patrocinador</option><option value="Patrocinador destacado en inicio">Patrocinador destacado en inicio</option><option value="Publicidad entre tarjetas del catálogo">Publicidad entre tarjetas del catálogo</option><option value="Sección de aliados comerciales">Sección de aliados comerciales</option></select></label>
            <label>Fecha inicio<input name="startDate" type="date" required /></label>
            <label>Fecha fin<input name="endDate" type="date" required /></label>
            <label>Presupuesto<input name="budget" type="number" min="0" defaultValue="1000000" /></label>
            <label>Precio contratado<input name="contractedPrice" type="number" min="0" defaultValue="400000" /></label>
            <label>Estado<select name="status" defaultValue="programada"><option value="borrador">Borrador</option><option value="programada">Programada</option><option value="activa">Activa</option><option value="pausada">Pausada</option><option value="finalizada">Finalizada</option></select></label>
            <label>Prioridad<input name="priority" type="number" min="1" defaultValue="1" /></label>
            <label>Impresiones<input name="impressions" type="number" min="0" defaultValue="0" /></label>
            <label>Clics<input name="clicks" type="number" min="0" defaultValue="0" /></label>
            <label>URL de destino<input name="landingUrl" type="url" defaultValue="https://campofinder.co" /></label>
            <label>Banner<input name="banner" defaultValue="/imagenes/cancha1.png" /></label>
            <label className="field-span-full">Descripción<textarea name="description" rows="3" /></label>
            <button className="button button-dark" type="submit">Crear campaña</button>
          </form>
          <div className="ad-list">
            {campaigns.map((campaign) => (
              <div className="campaign-card" key={campaign.id}>
                <div className="campaign-card-top">
                  <div>
                    <strong>{campaign.name}</strong>
                    <small>{campaign.advertiser} · {campaign.space}</small>
                  </div>
                  <span className={`status-pill ${campaign.status === "activa" ? "status-live" : campaign.status === "finalizada" ? "status-paused" : "status-neutral"}`}>{campaign.status}</span>
                </div>
                <div className="campaign-metrics">
                  <span>{campaign.impressions.toLocaleString("es-CO")} imp.</span>
                  <span>{campaign.clicks.toLocaleString("es-CO")} clics</span>
                  <span>{getCtr(campaign.impressions, campaign.clicks).toFixed(2)}% CTR</span>
                </div>
                <div className="campaign-actions">
                  <button className="button button-outline button-small" type="button" onClick={() => toggleCampaignStatus(campaign.id)}>Actualizar estado</button>
                  <button className="button button-danger button-small" type="button" onClick={() => removeCampaign(campaign.id)}>Eliminar</button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="ad-section-card">
          <div className="section-card-header">
            <h3>Gestión de espacios publicitarios</h3>
          </div>
          <div className="placement-list">
            {placements.map((placement) => (
              <div className="placement-row" key={placement.id}>
                <div>
                  <strong>{placement.label}</strong>
                  <small>{placement.activeCount} campañas activas · prioridad {placement.priority}</small>
                </div>
                <span className="status-pill status-neutral">Activo</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function AdminPage({ initialTab = "courts" }) {
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState(initialTab);
  const [busy, setBusy] = useState(false);
  const { user, notify } = useAuth();
  const [slot, setSlot] = useState({ courtId: "", date: localDateISO(), time: "16:00 - 17:00" });
  const [addUserOpen, setAddUserOpen] = useState(false);
  const [editingUserId, setEditingUserId] = useState("");

  async function load() {
    try { setOverview(await getAdminOverview(user.id)); }
    catch (reason) { setError(reason.message); }
  }
  useEffect(() => { load(); }, [user.id]);
  useEffect(() => { if (overview && !slot.courtId && overview.courts.length) setSlot((current) => ({ ...current, courtId: String(overview.courts[0].id) })); }, [overview, slot.courtId]);

  async function saveTimer(event, courtId) {
    event.preventDefault();
    const minutes = new FormData(event.currentTarget).get("minutes");
    setBusy(true); setError("");
    try {
      await saveCourtTimer(courtId, minutes);
      notify("Timer actualizado.");
      await load();
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }

  async function updateSlot(event, action) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await updateBlockedSlot({ ...slot, action });
      notify(action === "block" ? "Horario bloqueado." : "Horario desbloqueado.");
      await load();
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }

  async function toggleUser(user) {
    setBusy(true);
    try {
      await setUserBlocked(user.id, !user.blocked);
      notify(user.blocked ? "Cuenta desbloqueada." : "Cuenta bloqueada.");
      await load();
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }

  async function createUser(event) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true); setError("");
    try {
      await createAdminUser({
        name: form.get("name"),
        email: form.get("email"),
        password: form.get("password"),
        role: form.get("role"),
      });
      formElement.reset();
      setAddUserOpen(false);
      notify("Usuario creado.");
      await load();
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }

  async function editUser(event, userId) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setError("");
    try {
      await updateAdminUser({
        userId,
        name: form.get("name"),
        email: form.get("email"),
        role: form.get("role"),
      });
      setEditingUserId("");
      notify("Datos del usuario actualizados.");
      await load();
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }

  async function changePassword(event, userId) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const password = new FormData(formElement).get("password");
    setBusy(true); setError("");
    try {
      await changeAdminUserPassword(userId, password);
      formElement.reset();
      notify("Contraseña actualizada.");
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }

  async function deleteUser(user) {
    if (!window.confirm(`¿Eliminar la cuenta de ${user.name || user.email}? Esta acción no se puede deshacer.`)) return;
    setBusy(true); setError("");
    try {
      await deleteAdminUser(user.id);
      notify("Cuenta eliminada.");
      await load();
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }

  if (!overview && !error) return <Loading />;
  return (
    <section className="section container admin-page">
      <div className="catalog-heading"><div><span className="eyebrow">TU ESPACIO DE GESTIÓN</span><h1>Panel de<br /><em>control.</em></h1></div><span className="admin-badge"><span /> ADMINISTRADOR</span></div>
      {error && <ErrorPanel message={error} />}
      <div className="admin-tabs"><button className={tab === "courts" ? "active" : ""} onClick={() => setTab("courts")}>Canchas <span>{overview?.courts.length || 0}</span></button><button className={tab === "availability" ? "active" : ""} onClick={() => setTab("availability")}>Horarios bloqueados <span>{overview?.blockedSlots.length || 0}</span></button><button className={tab === "live" ? "active" : ""} onClick={() => setTab("live")}>Marcador en vivo</button><button className={tab === "users" ? "active" : ""} onClick={() => setTab("users")}>Usuarios <span>{overview?.users.length || 0}</span></button><button className={tab === "advertising" ? "active" : ""} onClick={() => setTab("advertising")}>PUBLICIDAD Y PATROCINADORES</button></div>
      {tab === "courts" && (
        <div className="admin-court-list">
          {overview?.courts.map((court) => (
            <article className="admin-court-card" key={court.id}>
              <img src={courtImageUrl(court.image)} alt="" onError={(event) => { event.currentTarget.src = "/imagenes/logo1.png"; }} />
              <div className="admin-court-main">
                <span className="eyebrow">CANCHA #{court.id}</span>
                <h3>{court.name}</h3>
                <p>{court.description || "Sin descripción"}</p>
                <form className="timer-form" onSubmit={(event) => saveTimer(event, court.id)}>
                  <label>Timer <input name="minutes" type="number" min="0" defaultValue={court.timerMinutes} required /> min</label>
                  <button className="button button-dark button-small" disabled={busy}>Guardar</button>
                </form>
              </div>
            </article>
          ))}
          {!overview?.courts.length && <div className="empty-state"><h3>Aún no tienes canchas asignadas</h3><p>Asigna una cancha a tu cuenta en Supabase para gestionarla aquí.</p></div>}
        </div>
      )}
      {tab === "availability" && (
        <div className="admin-panel">
          <div><span className="eyebrow">DISPONIBILIDAD</span><h2>Administra los<br /><em>horarios.</em></h2><p>Bloquea los horarios que no estarán disponibles para reservar.</p></div>
          <form className="admin-slot-form" onSubmit={(event) => updateSlot(event, "block")}>
            <label>Cancha<select value={slot.courtId} onChange={(event) => { const courtId = event.target.value; setSlot({ ...slot, courtId, time: courtSlots(overview?.courts.find((court) => String(court.id) === courtId))[0] || "" }); }}>{overview?.courts.map((court) => <option value={court.id} key={court.id}>{court.name}</option>)}</select></label>
            <label>Fecha<input type="date" min={localDateISO()} value={slot.date} onChange={(event) => setSlot({ ...slot, date: event.target.value })} required /></label>
            <label>Horario<select value={slot.time} onChange={(event) => setSlot({ ...slot, time: event.target.value })}>{courtSlots(overview?.courts.find((court) => String(court.id) === slot.courtId)).map((time) => <option key={time}>{time}</option>)}</select></label>
            <button className="button button-dark" disabled={busy || !slot.courtId}>Bloquear horario <span aria-hidden="true">↗</span></button>
          </form>
          <div className="blocked-list">
            {overview?.blockedSlots.map((item) => (
              <div className="blocked-row" key={`${item.courtId}-${item.date}-${item.time}`}>
                <div><strong>{overview.courts.find((court) => court.id === item.courtId)?.name || `Cancha ${item.courtId}`}</strong><span>{item.date} · {item.time}</span></div>
                <button className="text-link" disabled={busy} onClick={async () => {
                  setBusy(true);
                  try {
                    await updateBlockedSlot({ ...slot, courtId: item.courtId, date: item.date, time: item.time, action: "unblock" });
                    notify("Horario desbloqueado.");
                    await load();
                  } catch (reason) {
                    setError(reason.message);
                  } finally {
                    setBusy(false);
                  }
                }}>Desbloquear ×</button>
              </div>
            ))}
            {!overview?.blockedSlots.length && <p className="muted-copy">No hay horarios bloqueados próximos.</p>}
          </div>
        </div>
      )}
      {tab === "live" && <AdminLiveScorePanel courts={overview?.courts || []} notify={notify} />}
      {tab === "users" && <div className="user-management">
        <div className="user-management-heading"><div><span className="eyebrow">CUENTAS Y ACCESOS</span><p>Administra perfiles y permisos de la plataforma.</p></div><button className="button button-dark" onClick={() => setAddUserOpen(!addUserOpen)}>{addUserOpen ? "Cerrar" : "Añadir usuario"} <span aria-hidden="true">{addUserOpen ? "×" : "+"}</span></button></div>
        {addUserOpen && <form className="admin-user-form" onSubmit={createUser}><label>Nombre<input name="name" required maxLength="100" /></label><label>Correo<input name="email" type="email" required /></label><label>Contraseña<input name="password" type="password" minLength="8" required /></label><label>Rol<select name="role" defaultValue="usuario"><option value="usuario">Usuario</option><option value="jugador">Jugador</option><option value="administrador">Administrador</option></select></label><button className="button button-dark" disabled={busy}>Crear cuenta</button></form>}
        <div className="user-list">{overview?.users.map((person) => <article className="user-row-wrap" key={person.id}><div className="user-row"><span className="avatar">{(person.name || person.email).slice(0, 1).toUpperCase()}</span><div className="user-row-info"><strong>{person.name || "Sin nombre"}</strong><span>{person.email}</span></div><span className={`role-chip ${person.role === "administrador" ? "role-admin" : ""}`}>{person.role}</span><span className={`user-state ${person.blocked ? "user-state-blocked" : ""}`}>{person.blocked ? "Bloqueado" : "Activo"}</span><button className="button button-outline button-small" disabled={busy} onClick={() => setEditingUserId(editingUserId === person.id ? "" : person.id)}>Editar</button><button className="button button-outline button-small" disabled={busy || person.id === user?.id} onClick={() => toggleUser(person)}>{person.blocked ? "Desbloquear" : "Bloquear"}</button><button className="button button-danger button-small" disabled={busy || person.id === user?.id} onClick={() => deleteUser(person)}>Eliminar</button></div>
          {editingUserId === person.id && <div className="user-edit-panel"><form className="admin-user-form" onSubmit={(event) => editUser(event, person.id)}><label>Nombre<input name="name" defaultValue={person.name} required maxLength="100" /></label><label>Correo<input name="email" type="email" defaultValue={person.email} required /></label><label>Rol<select name="role" defaultValue={person.role}><option value="usuario">Usuario</option><option value="jugador">Jugador</option><option value="administrador">Administrador</option></select></label><button className="button button-dark button-small" disabled={busy}>Guardar cambios</button></form><form className="password-form" onSubmit={(event) => changePassword(event, person.id)}><label>Nueva contraseña<input name="password" type="password" minLength="8" placeholder="Al menos 8 caracteres" required /></label><button className="button button-outline button-small" disabled={busy}>Cambiar contraseña</button></form></div>}
        </article>)}{!overview?.users.length && <div className="empty-state"><h3>No hay usuarios registrados</h3></div>}</div>
      </div>}
      {tab === "advertising" && <AdminAdvertisingPanel />}
    </section>
  );
}

function Loading() {
  return <div className="page-loading"><span className="spinner" />Cargando…</div>;
}

function ErrorPanel({ message }) {
  return <div className="error-panel" role="alert"><span>!</span><p>{message}</p></div>;
}

function NotFound() {
  return <section className="empty-state not-found"><span className="eyebrow">404 — FUERA DE JUEGO</span><h1>No encontramos<br /><em>esa página.</em></h1><p>Pero sí podemos ayudarte a encontrar una cancha.</p><Link className="button button-dark" to="/catalogo">Ver canchas <span aria-hidden="true">↗</span></Link></section>;
}

function SupabaseConfigurationNotice() {
  return (
    <main className="configuration-page">
      <section className="configuration-card" role="alert">
        <span className="eyebrow">CONFIGURACIÓN PENDIENTE</span>
        <h1>Conectemos<br /><em>Campofinder.</em></h1>
        <p>El sitio ya está publicado, pero faltan las variables de conexión a Supabase en Vercel.</p>
        <ol>
          <li>Abre <strong>Project Settings → Environment Variables</strong> en Vercel.</li>
          <li>Agrega <code>VITE_SUPABASE_URL</code> y <code>VITE_SUPABASE_PUBLISHABLE_KEY</code>.</li>
          <li>Guarda los cambios y vuelve a desplegar el proyecto.</li>
        </ol>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {isSupabaseConfigured ? <App /> : <SupabaseConfigurationNotice />}
  </React.StrictMode>,
);
