import { useState, useEffect, useRef } from "react";
import { invoke } from '@tauri-apps/api/core';
import ReportBoard from "./components/ReportBoard";
import SettingsPanel from "./components/SettingsPanel";
import DirectMessageChat from './components/DirectMessageChat';
import GroupsBoard from './components/GroupsBoard';
import ChannelChat from './components/ChannelChat';
import SearchBoard from './components/SearchBoard';
import DirectoryBoard from './components/DirectoryBoard';
import QRCode from "react-qr-code";
import { ArrowLeftIcon, LockIcon, AlertTriangleIcon, GhostIcon, ShieldIcon, XIcon, GlobeIcon, CopyIcon, ExternalLinkIcon } from "./components/Icons";
import { openUrl as openBrowserLink } from "@tauri-apps/plugin-opener";
import { useT } from "./i18n/LanguageContext";
import "./App.css";

function App() {
  const { t } = useT();
  const [identity, setIdentity] = useState<{ public: string, private: string, alias?: string, id?: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Estados Boveda
  const [dbReady, setDbReady] = useState<boolean | null>(null); // null = cargando, true = inicializada, false = primer uso
  const [password, setPassword] = useState("");
  const [panicPassword, setPanicPassword] = useState("");
  const [aliasInput, setAliasInput] = useState("");
  const [identities, setIdentities] = useState<any[]>([]); // Lista de identidades guardadas
  const [view, setView] = useState<'login' | 'register' | 'board' | 'vault' | 'settings'>('login');

  const [exportNsec, setExportNsec] = useState<string | null>(null);
  const [exportAlias, setExportAlias] = useState<string | null>(null);
  const [importAlias, setImportAlias] = useState("");
  const [importNsec, setImportNsec] = useState("");

  // Ruteo Interno del Main App (Botonera)
  const [currentTab, setCurrentTab] = useState<'home' | 'search' | 'groups' | 'directory' | 'sandbox' | 'more'>('home');
  const [previousTab, setPreviousTab] = useState<'home' | 'search' | 'groups' | 'directory' | 'sandbox'>('home');
  const [sandboxUrl, setSandboxUrl] = useState<string | null>(null);
  const [urlToOpen, setUrlToOpen] = useState<string | null>(null);

  useEffect(() => {
    const handleLinkOpen = (e: any) => setUrlToOpen(e.detail);
    window.addEventListener('request-link-open', handleLinkOpen);
    // Fallback global function for Android WebView compatibility
    (window as any).__vaultOpenLink = (url: string) => setUrlToOpen(url);
    return () => {
      window.removeEventListener('request-link-open', handleLinkOpen);
      delete (window as any).__vaultOpenLink;
    };
  }, []);
  
  // Estado para Modal de Password (Reemplazo de prompt)
  const [pwdModal, setPwdModal] = useState<{
    open: boolean,
    title: string,
    desc: string,
    onConfirm: (p: string) => void,
    loading: boolean,
    error: string | null
  }>({ open: false, title: '', desc: '', onConfirm: () => {}, loading: false, error: null });
  const [modalPwdInput, setModalPwdInput] = useState("");
  
  const [confirmModal, setConfirmModal] = useState<{
    open: boolean,
    title: string,
    desc: string,
    onConfirm: () => void,
    isAlert?: boolean
  }>({ open: false, title: '', desc: '', onConfirm: () => {} });

  function handleTabChange(tab: 'home' | 'search' | 'groups' | 'directory' | 'sandbox' | 'more') {
    if (tab === 'more' && currentTab !== 'more') {
      setPreviousTab(currentTab);
    }

    // Si salimos de groups, limpiamos el canal activo para ver el board de nuevo
    if (currentTab === 'groups' && tab !== 'groups') {
      setActiveChannel(null);
    }

    setCurrentTab(tab);
  }

  // Estados Globales (Settings)
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const [autoLogoutMinutes, setAutoLogoutMinutes] = useState(0);
  const [activeDmPubkey, setActiveDmPubkey] = useState<string | null>(null); // <-- NUEVO ESTADO DM
  const [dmPromptModal, setDmPromptModal] = useState({ open: false, input: '' });

  // NIP-28: Estado para canales publicos
  const [activeChannel, setActiveChannel] = useState<{ id: string, name: string } | null>(null);

  const logoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // =========================================================================
  // HOOK DE INICIO: Revisar DB y Cargar Ajustes
  // =========================================================================
  
  function getSandboxIframeSrc(url: string) {
    if (!url) return '';
    const ext = url.split('.').pop()?.toLowerCase() || '';
    if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) {
      const html = `<html><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0"><body style="margin:0;display:flex;justify-content:center;align-items:center;height:100vh;background:#000;"><img src="${url}" style="max-width:100%;max-height:100%;object-fit:contain;"></body></html>`;
      return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
    }
    if (['mp4', 'webm', 'ogg'].includes(ext)) {
      const html = `<html><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0"><body style="margin:0;display:flex;justify-content:center;align-items:center;height:100vh;background:#000;"><video controls autoplay playsinline style="max-width:100%;max-height:100%;"><source src="${url}"></video></body></html>`;
      return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
    }
    return url;
  }

  useEffect(() => {
    const handleOpenSandbox = (e: any) => {
        setSandboxUrl(e.detail);
        setCurrentTab('sandbox');
    };
    window.addEventListener('open-sandbox', handleOpenSandbox);

    async function initApp() {
      try {
        const isInit: boolean = await invoke("check_db_initialized");
        setDbReady(isInit);
        if (isInit) {
          setView('login');
          // Cargar ajustes globales si la DB esta lista
          try {
            const savedTheme: string = await invoke("get_setting", { key: "theme", defaultValue: "dark" });
            const savedTimeout: string = await invoke("get_setting", { key: "auto_logout_minutes", defaultValue: "0" });

            setTheme(savedTheme as 'light' | 'dark');
            applyTheme(savedTheme as 'light' | 'dark');
            setAutoLogoutMinutes(Number(savedTimeout));
          } catch (e) { console.warn("Ajustes no inicializados aun"); }
        } else {
          setView('register');
        }
      } catch (err) {
        setError((t('sqliteError') || "Error al conectar con SQLite local: ") + err);
      }
    }
    initApp();
    return () => window.removeEventListener('open-sandbox', handleOpenSandbox);
  }, []);

  // =========================================================================
  // LOGICA: TEMA VISUAL
  // =========================================================================
  function applyTheme(newTheme: 'dark' | 'light') {
    setTheme(newTheme);
    if (newTheme === 'light') {
      document.documentElement.classList.add('theme-light');
    } else {
      document.documentElement.classList.remove('theme-light');
    }
  }

  // =========================================================================
  // LOGICA: AUTO-DESTRUCCION (INACTIVIDAD)
  // =========================================================================

  function resetLogoutTimer() {
    if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current);

    // Solo activar si estamos logueados (en board, vault o settings) y el timer es > 0
    if (autoLogoutMinutes > 0 && identity) {
      logoutTimerRef.current = setTimeout(() => {
        console.log("Sesion cerrada por inactividad");
        wipeIdentity();
      }, autoLogoutMinutes * 60 * 1000);
    }
  }

  useEffect(() => {
    // Escuchar eventos de teclado/raton en toda la app para resetear el timer
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];
    const handleActivity = () => resetLogoutTimer();

    events.forEach(e => window.addEventListener(e, handleActivity));
    resetLogoutTimer(); // Start inicial

    return () => {
      events.forEach(e => window.removeEventListener(e, handleActivity));
      if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current);
    };
  }, [autoLogoutMinutes, identity]);

  // =========================================================================
  // FLUJO DE BOVEDA: Bloqueo y Desbloqueo
  // =========================================================================

  async function setupVault() {
    if (password.length < 6) {
      setError(t('pwdLengthError') || "La contraseña maestra debe tener al menos 6 caracteres por seguridad (KDF Argon2).");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const panic = panicPassword.trim() ? panicPassword.trim() : null;
      await invoke("setup_master_password", { password, panicPassword: panic });
      setDbReady(true);
      setView('vault'); // Ir directo a generar la primera identidad
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  async function loginToVault() {
    setLoading(true);
    setError(null);
    try {
      const isValid: boolean = await invoke("login_with_password", { password });
      if (isValid) {
        await loadIdentities();
        setView('vault');
      } else {
        setError(t('invalidPwd') || "Contraseña maestra incorrecta.");
      }
    } catch (err: any) {
      if (String(err) === "WIPED") {
        // Ejecucion Plausible Deniability actuando como si pusiera mala contrasena
        setError(t('invalidPwd') || "Contraseña maestra incorrecta.");
        setDbReady(false); // Forzamos a que vuelva a registrar (vacio)
      } else {
        setError(String(err));
      }
    } finally {
      setLoading(false);
    }
  }

  async function loadIdentities() {
    try {
      const ids: any[] = await invoke("get_saved_identities");
      setIdentities(ids);
    } catch (err) {
      console.error(err);
    }
  }

  // =========================================================================
  // FLUJO DE IDENTIDAD: Generar, Guardar y Usar
  // =========================================================================

  async function generateAndSaveIdentity() {
    if (!aliasInput.trim()) {
      setError(t('aliasRequired') || "Dale un nombre o alias a este fantasma para identificarlo luego.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // 1. Generar llaves limpias en memoria
      const keys: [string, string] = await invoke("generate_nostr_keys");

      // 2. Pedir a Rust que las encripte y guarde en SQLite
      await invoke("save_identity", {
        alias: aliasInput,
        pubkey: keys[0],
        nsec: keys[1],
        password: password // Rust usa esto para cifrar la llave
      });

      setAliasInput("");
      await loadIdentities();
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleExportIdentity(id: number, alias: string) {
    setModalPwdInput("");
    setPwdModal({
      open: true,
      title: t('unlockExport') || "Desbloquear para Exportar",
      desc: (t('unlockExportDesc') || "Introduce tu Contraseña Maestra para descifrar y auditar a \"{alias}\":").replace("{alias}", alias),
      loading: false,
      error: null,
      onConfirm: async (pwd) => {
        setPwdModal(prev => ({ ...prev, loading: true, error: null }));
        try {
          const nsecPlaintext: string = await invoke("get_identity_secret", { id, password: pwd });
          setExportNsec(nsecPlaintext);
          setExportAlias(alias);
          setPwdModal(prev => ({ ...prev, open: false, loading: false }));
        } catch (err) {
          setPwdModal(prev => ({ ...prev, loading: false, error: t('decryptError') || "Contraseña incorrecta o error al descifrar." }));
        }
      }
    });
  }

  async function handleImportIdentity() {
    if (!importAlias.trim() || !importNsec.trim()) {
      setError(t('importFieldsRequired') || "Alias y llave Nsec son obligatorios para importar.");
      return;
    }
    setModalPwdInput("");
    setPwdModal({
      open: true,
      title: t('encryptImport') || "Cifrar e Importar",
      desc: t('encryptImportDesc') || "Introduce tu Contraseña Maestra para cifrar (AES-GCM) y guardar esta identidad externa:",
      loading: false,
      error: null,
      onConfirm: async (pwd) => {
        setPwdModal(prev => ({ ...prev, loading: true, error: null }));
        try {
          await invoke("import_identity", {
            alias: importAlias,
            nsec: importNsec,
            password: pwd
          });
          setImportAlias("");
          setImportNsec("");
          await loadIdentities();
          setPwdModal(prev => ({ ...prev, open: false, loading: false }));
        } catch (err) {
          setPwdModal(prev => ({ ...prev, loading: false, error: String(err) }));
        }
      }
    });
  }

  async function useIdentity(id: number, pubkey: string, alias: string) {
    setLoading(true);
    try {
      // Pedimos amablemente la llave privada a la boveda pasando la contraseña
      const nsecPlaintext: string = await invoke("get_identity_secret", { id, password });
      setIdentity({ public: pubkey, private: nsecPlaintext, alias, id });
      setView('board');
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  function wipeIdentity() {
    // Sobrescribimos con un objeto vacio para matar la referencia en memoria RAM
    setIdentity(null);
    setPassword(""); // Obligamos a pedir la maestra otra vez al bloquear
    setView('login'); // Regresamos al login por seguridad
  }

  // =========================================================================
  // RENDERIZADO
  // =========================================================================

  const globalModals = (
    <>
      {/* Modal Global de Advertencia de Enlaces */}
      {urlToOpen && (
          <div style={{
              position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
              backgroundColor: 'rgba(0,0,0,0.85)', display: 'flex', justifyContent: 'center',
              alignItems: 'center', zIndex: 9999, padding: '20px'
          }}>
              <div className="card" style={{ width: '100%', maxWidth: '450px', backgroundColor: 'var(--panel-bg)', borderRadius: '12px', padding: '25px', boxShadow: '0 10px 25px rgba(0,0,0,0.5)' }} onClick={e => e.stopPropagation()}>
                  <h3 style={{ marginTop: 0, color: 'var(--danger, #ef4444)', display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <ShieldIcon size={24} /> {t('privacyWarning') || "Advertencia de Privacidad"}
                  </h3>
                  
                  <p style={{ fontSize: '0.95rem', color: 'var(--text-color)', marginBottom: '15px' }}>
                      {t('externalLinkWarning') || "Estás intentando abrir un enlace externo:"}
                  </p>
                  
                  <div style={{ backgroundColor: 'rgba(0,0,0,0.2)', padding: '10px', borderRadius: '5px', wordBreak: 'break-all', fontFamily: 'monospace', fontSize: '0.85rem', marginBottom: '15px', border: '1px dashed var(--border-color)' }}>
                      {urlToOpen}
                  </div>

                  <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '25px' }}>
                      {t('torExposureWarning') || "Los metadatos pueden quedar expuestos al sitio, ya que tu navegador predeterminado NO usa de forma nativa la conexión Tor. ¿Cómo deseas proceder?"}
                  </p>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      <button 
                          className="primary-btn" 
                          onClick={(e) => { 
                              e.stopPropagation();
                              const finalSandboxUrl = urlToOpen?.startsWith('ipfs://')
                                  ? urlToOpen.replace('ipfs://', 'http://127.0.0.1:8080/ipfs/')
                                  : urlToOpen;

                              window.dispatchEvent(new CustomEvent('open-sandbox', { detail: finalSandboxUrl }));
                              setUrlToOpen(null); 
                          }}
                          style={{ padding: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                      >
                          <ShieldIcon size={16} /> {t('openSandbox') || "Abrir en Entorno Seguro (Sandbox)"}
                      </button>
                      <button 
                          className="danger-btn" 
                          onClick={async (e) => { 
                              e.stopPropagation(); 
                              try {
                                  await openBrowserLink(urlToOpen);
                              } catch (err) {
                                  console.error("Fallo comando nativo", err);
                              }
                              setUrlToOpen(null); 
                          }}
                          style={{ padding: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                      >
                          <ExternalLinkIcon size={16} /> {t('openSystemBrowser') || "Enviar a Navegador de Sistema"}
                      </button>
                      <button 
                          className="secondary-btn" 
                          onClick={(e) => { e.stopPropagation(); setUrlToOpen(null); }}
                          style={{ padding: '10px', marginTop: '5px' }}
                      >
                          {t('cancel') || "Cancelar"}
                      </button>
                  </div>
              </div>
          </div>
      )}
    </>
  );

  if (view === 'settings') {
    return (
      <main className="container wrapper">
        <SettingsPanel
          onClose={() => setView(identity ? 'board' : 'vault')}
          currentTheme={theme}
          onThemeChange={applyTheme}
          currentTimeout={autoLogoutMinutes}
          onTimeoutChange={setAutoLogoutMinutes}
        />
        {globalModals}
      </main>
    );
  }

  if (view === 'board' && identity) {
    return (
      <main className="container wrapper board-wrapper" style={{ paddingBottom: "80px", display: "flex", flexDirection: "column", minHeight: "100vh" }}>
        {/* VISTAS DE PESTAÑAS */}
        {currentTab === 'home' && (
          <ReportBoard
            identity={identity}
            masterPassword={password}
            onWipe={wipeIdentity}
            onOpenSettings={() => setView('settings')}
            onOpenDM={(targetPk) => setActiveDmPubkey(targetPk)}
          />
        )}

        {currentTab === 'search' && (
          <SearchBoard />
        )}

        {currentTab === 'groups' && (
          <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column' }}>
            {activeChannel ? (
              <ChannelChat
                identity={identity}
                channelId={activeChannel.id}
                channelName={activeChannel.name}
                onBack={() => setActiveChannel(null)}
              />
            ) : (
              <GroupsBoard
                identity={identity}
                onSelectChannel={(id, name) => setActiveChannel({ id, name })}
              />
            )}
          </div>
        )}

        {currentTab === 'directory' && (
          <DirectoryBoard
            onOpenDM={(targetPk) => setActiveDmPubkey(targetPk)}
          />
        )}

        {currentTab === 'sandbox' && sandboxUrl && (
          <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}>
            <div style={{ height: '50px', backgroundColor: 'var(--panel-bg)', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--accent-color)', fontWeight: 'bold' }}>
                    <ShieldIcon size={18} /> {t('secureBrowser')}
                    <span style={{ color: 'var(--text-secondary)', fontWeight: 'normal', fontSize: '0.8rem', marginLeft: '10px', textOverflow: 'ellipsis', whiteSpace:'nowrap', overflow:'hidden', maxWidth: '300px' }}>{sandboxUrl}</span>
                </div>
                <button className="icon-btn" onClick={() => setSandboxUrl(null)} title="Cerrar pestaña" style={{ color: 'var(--danger)' }}><XIcon size={18}/></button>
            </div>
            
            <div style={{ padding: '8px 20px', backgroundColor: 'var(--bg-color)', borderBottom: '1px solid var(--border-color)', fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', gap: '8px', alignItems: 'center' }}>
                <AlertTriangleIcon size={14} style={{ color: 'var(--warning-color, #f59e0b)', minWidth: '14px' }} />
                <span>{t('sandboxWarning')}</span>
            </div>

            <iframe src={getSandboxIframeSrc(sandboxUrl)} style={{ flex: 1, width: '100%', border: 'none', backgroundColor: '#000' }} sandbox="allow-scripts allow-same-origin allow-forms" referrerPolicy="no-referrer" />
          </div>
        )}
        
        {currentTab === 'sandbox' && !sandboxUrl && (
          <div className="card" style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', flexDirection: 'column' }}>
            <GlobeIcon size={64} style={{ color: 'var(--border-color)'}}/>
            <h2 style={{ color: 'var(--text-secondary)', marginTop: '20px'}}>{t('sandboxEmpty')}</h2>
            <p style={{ color: 'var(--text-secondary)'}}>{t('sandboxEmptyDesc')}</p>
          </div>
        )}

        {currentTab === 'more' && (
          <div className="card">
            <h2 style={{ textAlign: 'center', marginBottom: '10px' }}>{t('moreTitle')}</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '20px' }}>
              <button className="secondary-btn" onClick={() => handleTabChange(previousTab)}>{t('moreBack')}</button>
              <button className="secondary-btn" onClick={() => setView('settings')}>{t('moreGlobalSettings')}</button>
              <button className="secondary-btn" onClick={() => {
                  setDmPromptModal({ open: true, input: '' });
              }}>{t('moreDMs')}</button>
              <button className="secondary-btn" onClick={() => setView('vault')} style={{ display: 'flex', alignItems: 'center', gap: '5px', justifyContent: 'center' }}><GhostIcon size={16}/> {t('moreSwitchId')}</button>
              <button className="danger-btn" onClick={() => {
                setConfirmModal({
                  open: true,
                  title: t('lockTitle'),
                  desc: t('lockDesc'),
                  onConfirm: () => wipeIdentity()
                });
              }} style={{ display: 'flex', alignItems: 'center', gap: '5px', justifyContent: 'center' }}><LockIcon size={16}/> {t('moreLock')}</button>
            </div>
          </div>
        )}

        <nav className="bottom-navbar">
          <button className={`nav-item ${currentTab === 'home' ? 'active' : ''}`} onClick={() => handleTabChange('home')}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill={currentTab === 'home' ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
            <span className="nav-label">{t('navHome')}</span>
          </button>

          <button className={`nav-item ${currentTab === 'search' ? 'active' : ''}`} onClick={() => handleTabChange('search')}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            <span className="nav-label">{t('navSearch')}</span>
          </button>

          <button className={`nav-item ${currentTab === 'groups' ? 'active' : ''}`} onClick={() => handleTabChange('groups')}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill={currentTab === 'groups' ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
            <span className="nav-label">{t('navGroups')}</span>
          </button>

          <button className={`nav-item ${currentTab === 'directory' ? 'active' : ''}`} onClick={() => handleTabChange('directory')}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill={currentTab === 'directory' ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
            <span className="nav-label">{t('navDirectory')}</span>
          </button>

          <button className={`nav-item ${currentTab === 'sandbox' ? 'active' : ''}`} onClick={() => handleTabChange('sandbox')}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
            <span className="nav-label">{t('navWeb')}</span>
          </button>

          <button className={`nav-item ${currentTab === 'more' ? 'active' : ''}`} onClick={() => handleTabChange('more')}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill={currentTab === 'more' ? "var(--primary-color)" : "none"} stroke={currentTab === 'more' ? "var(--primary-color)" : "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
            <span className="nav-label">{t('navMore')}</span>
          </button>
        </nav>

        {/* Renderiza el Drawer si hay un chat activo */}
        {activeDmPubkey && (
          <DirectMessageChat
            identity={identity}
            targetPubkey={activeDmPubkey}
            onClose={() => setActiveDmPubkey(null)}
          />
        )}

        {/* MODAL DE CONFIRMACION / ALERTA (Global) */}
        {confirmModal.open && (
          <div className="modal-overlay">
            <div className="modal-content" style={{ maxWidth: "400px" }}>
              <h2 style={{ fontSize: "1.25rem", marginBottom: "0.5rem", color: "var(--accent)" }}>{confirmModal.title}</h2>
              <p style={{ fontSize: "0.9rem", color: "var(--text-secondary)", marginBottom: "1.5rem" }}>{confirmModal.desc}</p>
              
              <div style={{ display: "flex", gap: "10px" }}>
                <button 
                  className="primary-btn" 
                  onClick={() => { confirmModal.onConfirm(); setConfirmModal(p => ({ ...p, open: false })); }}
                >
                  {confirmModal.isAlert ? t('understood') : t('confirm')}
                </button>
                {!confirmModal.isAlert && (
                  <button 
                    className="secondary-btn" 
                    onClick={() => setConfirmModal(p => ({ ...p, open: false }))}
                  >
                    {t('cancel')}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* MODAL DE MENSAJES DIRECTOS (Global) */}
        {dmPromptModal.open && (
          <div className="modal-overlay">
            <div className="modal-content" style={{ maxWidth: "400px" }}>
              <h2 style={{ fontSize: "1.25rem", marginBottom: "0.5rem", color: "var(--accent)" }}>{t('dmPromptTitle') === 'dmPromptTitle' ? "Iniciar Chat Privado" : t('dmPromptTitle')}</h2>
              <div style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)', padding: '12px', borderRadius: '8px', marginBottom: '1.2rem', borderLeft: '3px solid var(--primary-color)' }}>
                <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", margin: 0, lineHeight: 1.4 }}>
                  <strong>{t('dmTooltipTitle') === 'dmTooltipTitle' ? "💡 ¿Qué es el Código de Usuario?" : t('dmTooltipTitle')}</strong><br/>
                  {t('dmTooltipDesc') === 'dmTooltipDesc' ? "Es como el número de teléfono en esta aplicación. Pídele a tu contacto que acceda a su cuenta y comparta su código (generalmente empieza con 'npub'). Luego, pégalo en la caja de abajo." : t('dmTooltipDesc')}
                </p>
              </div>
              
              <input
                type="text"
                placeholder={t('dmPromptPlaceholder') === 'dmPromptPlaceholder' ? "Ejemplo: npub1..." : t('dmPromptPlaceholder')}
                value={dmPromptModal.input}
                onChange={(e) => setDmPromptModal(p => ({ ...p, input: e.target.value }))}
                style={{ width: "100%", padding: "10px", marginBottom: "1.5rem", borderRadius: "6px", border: "1px solid var(--border-color)", backgroundColor: "var(--panel-input-bg)", color: "var(--text-primary)" }}
              />

              <div style={{ display: "flex", gap: "10px" }}>
                <button 
                  className="primary-btn" 
                  disabled={!dmPromptModal.input.trim()}
                  onClick={() => { 
                      setActiveDmPubkey(dmPromptModal.input.trim()); 
                      setDmPromptModal({ open: false, input: '' }); 
                  }}
                >
                  {t('dmPromptStart') === 'dmPromptStart' ? "Iniciar Chat" : t('dmPromptStart')}
                </button>
                <button 
                  className="secondary-btn" 
                  onClick={() => setDmPromptModal({ open: false, input: '' })}
                >
                  {t('cancel')}
                </button>
              </div>
            </div>
          </div>
        )}
        {globalModals}
      </main>
    );
  }

  return (
    <main className="container wrapper">
      <div className="card">
        <div className="header">
          <img src="/logo.png" alt="Vault Logo" style={{ width: '80px', height: '80px', marginBottom: '10px', borderRadius: '12px' }} />
          <h1>{t('vaultTitle')}</h1>
          <p className="subtitle">{t('vaultSubtitle')}</p>
        </div>

        {error && <div className="error-text" style={{ marginBottom: "1rem" }}>{error}</div>}

        {dbReady === null && <p>{t('initSqlite')}</p>}

        {/* --- PANTALLA: REGISTRAR BOVEDA --- */}
        {dbReady === false && view === 'register' && (
          <div className="action-area">
            <p><strong>{t('firstTime')}</strong></p>
            <input
              type="password"
              placeholder={t('masterPwdPlaceholder')}
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="password-input"
            />
            <p style={{ fontSize: "0.85rem", marginTop: "-10px", color: "var(--text-secondary)" }}>
              {t('panicPwdNote')}
            </p>
            <input
              type="password"
              placeholder={t('panicPwdPlaceholder')}
              value={panicPassword}
              onChange={e => setPanicPassword(e.target.value)}
              className="password-input"
            />
            <button className="primary-btn" onClick={setupVault} disabled={loading}>
              {loading ? t('creating') : t('createVault')}
            </button>
          </div>
        )}

        {/* --- PANTALLA: DESBLOQUEAR BOVEDA --- */}
        {dbReady === true && view === 'login' && (
          <div className="action-area">
            <input
              type="password"
              placeholder={t('unlockPlaceholder')}
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="password-input"
              onKeyDown={(e) => { if (e.key === 'Enter') loginToVault() }}
            />
            <button className="primary-btn" onClick={loginToVault} disabled={loading}>
              {loading ? t('deriving') : t('unlockBtn')}
            </button>
          </div>
        )}

        {/* --- PANTALLA: GESTOR DE IDENTIDADES --- */}
        {view === 'vault' && (
          <div className="action-area vault-area">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3>{t('myGhosts')}</h3>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button className="secondary-btn" onClick={() => identity ? setView('board') : wipeIdentity()} style={{ padding: "6px 10px", fontSize: "0.85rem", display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <ArrowLeftIcon size={14} /> {t('back')}
                </button>
                <button className="secondary-btn" onClick={() => setView('settings')} style={{ padding: "6px 10px", fontSize: "0.85rem" }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                  {t('settings')}
                </button>
              </div>
            </div>

            <div className="identity-list">
              {identities.length === 0 ? (
                <p className="empty-state">{t('noIdentities')}</p>
              ) : (
                identities.map(idr => (
                  <div key={idr.id} className="identity-item">
                    <div className="identity-info-left" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <strong>{idr.alias}</strong>
                        <span className="key-snippet">{idr.pubkey.substring(0, 16)}...</span>
                      </div>
                      <button className="icon-btn" onClick={() => navigator.clipboard.writeText(idr.pubkey)} title={t('copyPubkey') || "Copiar Código de Usuario"} style={{ padding: '4px', opacity: 0.7, cursor: 'pointer', background: 'transparent', border: 'none', color: 'var(--text-secondary)' }}>
                        <CopyIcon size={14} />
                      </button>
                    </div>
                    <div style={{ display: "flex", gap: "5px" }}>
                      <button className="secondary-btn" onClick={() => handleExportIdentity(idr.id, idr.alias)} disabled={loading} style={{ padding: "4px 8px", minWidth: "90px", display: 'flex', alignItems: 'center', gap: '4px', justifyContent: 'center' }}>
                        <LockIcon size={14} /> {t('exportQR')}
                      </button>
                      <button className="secondary-btn" onClick={() => useIdentity(idr.id, idr.pubkey, idr.alias)} disabled={loading}>
                        {t('use')}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <hr style={{ margin: "2rem 0", borderColor: "var(--border-color)" }} />

            <h3>{t('createGhost')}</h3>
            <div className="create-identity-form">
              <input
                type="text"
                placeholder={t('ghostAlias')}
                value={aliasInput}
                onChange={e => setAliasInput(e.target.value)}
              />
              <button className="primary-btn" onClick={generateAndSaveIdentity} disabled={loading}>
                {loading ? t('generating') : t('generateBtn')}
              </button>
            </div>

            <hr style={{ margin: "2rem 0", borderColor: "var(--border-color)" }} />

            <h3>{t('importGhost')}</h3>
            <div className="create-identity-form">
              <input
                type="text"
                placeholder={t('importAlias')}
                value={importAlias}
                onChange={e => setImportAlias(e.target.value)}
                style={{ flex: "1 1 calc(50% - 6px)" }}
              />
              <input
                type="password"
                placeholder={t('importNsec')}
                value={importNsec}
                onChange={e => setImportNsec(e.target.value)}
                style={{ flex: "1 1 calc(50% - 6px)" }}
              />
              <button className="primary-btn" onClick={handleImportIdentity} disabled={loading} style={{ flex: "1 1 100%" }}>
                {loading ? t('encrypting') : t('importBtn')}
              </button>
            </div>

            {exportNsec && exportAlias && (
              <div className="modal-overlay">
                <div className="modal-content" style={{ maxWidth: "400px", textAlign: "center", color: 'white' }}>
                  <h3>{t('auditTitle')}</h3>
                  <p style={{ marginBottom: "1rem" }}>Alias: <strong>{exportAlias}</strong></p>
                  <div style={{ background: "white", padding: "16px", borderRadius: "8px", display: "inline-block", marginBottom: "1rem" }}>
                    <QRCode value={exportNsec} size={200} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontSize: "0.85rem", color: "var(--error-color)", marginBottom: "10px" }}>
                    <AlertTriangleIcon size={16} /> <p style={{margin: 0}}>{t('nsecWarning')}</p>
                  </div>
                  <input type="text" readOnly value={exportNsec} style={{ width: "100%", marginBottom: "1rem", textAlign: "center", fontSize: "0.8rem", padding: "8px" }} />
                  <button className="primary-btn" onClick={() => { setExportNsec(null); setExportAlias(null); }}>{t('closeAndWipe')}</button>
                </div>
              </div>
            )}

            {pwdModal.open && (
              <div className="modal-overlay">
                <div className="modal-content" style={{ maxWidth: "400px" }}>
                  <h2 style={{ fontSize: "1.25rem", marginBottom: "0.5rem", color: "var(--accent)" }}>{pwdModal.title}</h2>
                  <p style={{ fontSize: "0.9rem", color: "var(--text-secondary)", marginBottom: "1.5rem" }}>{pwdModal.desc}</p>
                  
                  {pwdModal.error && (
                    <div className="error-text" style={{ marginBottom: "1rem" }}>{pwdModal.error}</div>
                  )}

                  <input
                    type="password"
                    className="password-input"
                    placeholder={t('masterPwdPlaceholder')}
                    autoFocus
                    value={modalPwdInput}
                    onChange={(e) => setModalPwdInput(e.target.value)}
                    onKeyDown={(e) => { if(e.key === 'Enter') pwdModal.onConfirm(modalPwdInput) }}
                    style={{ marginBottom: "1.5rem" }}
                  />

                  <div style={{ display: "flex", gap: "10px" }}>
                    <button 
                      className="primary-btn" 
                      onClick={() => pwdModal.onConfirm(modalPwdInput)}
                      disabled={pwdModal.loading || !modalPwdInput}
                    >
                      {pwdModal.loading ? t('verifying') : t('confirm')}
                    </button>
                    <button 
                      className="secondary-btn" 
                      onClick={() => setPwdModal(p => ({ ...p, open: false }))}
                      disabled={pwdModal.loading}
                    >
                      {t('cancel')}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

        {globalModals}
    </main>
  );
}

export default App;
