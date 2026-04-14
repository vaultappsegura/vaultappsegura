/**
 * ============================================================================
 * ARCHIVO: ReportBoard.tsx
 * ============================================================================
 * PROPOSITO:
 * Este componente de React es la vista principal (el "tablero") donde el usuario
 * puede leer el feed global de denuncias, filtrarlas por PoW (Proof of Work),
 * reaccionar (+/-) y publicar nuevas notas (texto + imagenes).
 * 
 * ARQUITECTURA PARA JUNIORS:
 * - El "State" (useState) maneja temporalmente lo que el usuario esta escribiendo
 *   o la foto que eligio. 
 * - Usamos `invoke("nombre_comando")` proporcionado por Tauri para pedirle a Rust 
 *   que haga el trabajo pesado (encriptar, firmar llaves, hablar con IPFS/Tor).
 * - Componente <IpfsImageViewer />: Se encarga de transformar los enlaces `ipfs://`
 *   en imagenes renderizables descargandolos y convirtiendolos en formato base64.
 * 
 * HILOS DE CONVERSACION (REPLIES):
 * Este archivo implementa el estado `replyingTo` para que el usuario pueda responder
 * a denuncias especificas, creando arboles de conversacion estilo Foro/Twitter.
 * ============================================================================
 */
import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import MessageRenderer from "./MessageRenderer";
import { LockIcon, PaperclipIcon, XIcon, FlameIcon, GhostIcon, CopyIcon } from "./Icons";
import { useT } from "../i18n/LanguageContext";
import "./ReportBoard.css";

interface Report {
    id: string;
    pubkey: string;
    content: string;
    created_at: number;
    pow: number;
    reactions_up: number;
    reactions_down: number;
    reply_to?: string; // ID del evento al que este responde (NIP-01 "e" tag)
}

function IpfsMediaViewer({ cid }: { cid: string }) {
    const { t } = useT();
    const [mediaSrc, setMediaSrc] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let mounted = true;
        invoke("fetch_ipfs_media", { cid })
            .then((dataUri: any) => { if (mounted) setMediaSrc(dataUri); })
            .catch((err) => { if (mounted) setError(String(err)); });
        return () => { mounted = false; };
    }, [cid]);

    if (error) return <div className="ipfs-error">⚠ {error}</div>;
    if (!mediaSrc) return <div className="ipfs-loading">{t('ipfsDownloading') || "Descargando... ⏳"}</div>;

    if (mediaSrc.startsWith("data:video")) return <video src={mediaSrc} controls className="ipfs-image" style={{ maxHeight: '300px', width: '100%' }} />;
    if (mediaSrc.startsWith("data:audio")) return <audio src={mediaSrc} controls style={{ width: '100%', marginTop: '10px' }} />;
    if (mediaSrc.startsWith("data:application/pdf")) return <object data={mediaSrc} type="application/pdf" className="ipfs-image" style={{ height: '350px', width: '100%' }} ><a href={mediaSrc} download>{t('downloadPdf') || "Descargar PDF"}</a></object>;

    return <img src={mediaSrc} className="ipfs-image" alt="Contenido descentralizado" loading="lazy" onClick={() => window.open(mediaSrc)} />;
}

interface ReportBoardProps {
    identity: { public: string; private: string };
    masterPassword: string;
    onWipe: () => void;
    onOpenSettings: () => void;
    onOpenDM: (targetPubkey: string) => void;
}

export default function ReportBoard({ identity, masterPassword, onWipe, onOpenSettings, onOpenDM }: ReportBoardProps) {
    const { t } = useT();
    const [reports, setReports] = useState<Report[]>([]);
    const [loadingFeed, setLoadingFeed] = useState(false);
    const [burnerMode, setBurnerMode] = useState(false); // Estado KAMIKAZE
    const [feedError, setFeedError] = useState<string | null>(null);
    const [content, setContent] = useState("");
    const [publishing, setPublishing] = useState(false);
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
    const [torActive, setTorActive] = useState<boolean | null>(null);
    const [minPow, setMinPow] = useState(0);
    const [reactingId, setReactingId] = useState<string | null>(null);
    const [reactedPosts, setReactedPosts] = useState<Set<string>>(new Set());
    const [selectedImage, setSelectedImage] = useState<{ path: string, name: string } | null>(null);
    const [replyingTo, setReplyingTo] = useState<Report | null>(null); // Post al que estamos respondiendo
    const [feedMode, setFeedMode] = useState<'global' | 'following'>('global'); // <-- NUEVO ESTADO DUAL FEED
    const [loadingMore, setLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    const [isFocused, setIsFocused] = useState(false);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    function showToast(message: string, type: 'success' | 'error') {
        setToast({ message, type });
        setTimeout(() => setToast(null), 4000);
    }

    async function checkTor() {
        try {
            const active: boolean = await invoke("check_tor_status");
            setTorActive(active);
        } catch {
            setTorActive(false);
        }
    }

    async function loadSettings() {
        try {
            const powStr: string = await invoke("get_setting", { key: "default_pow", defaultValue: "0" });
            setMinPow(Number(powStr));
        } catch (e) { }
    }

    async function loadFeed() {
        setLoadingFeed(true);
        setFeedError(null);
        try {
            const feed: Report[] = await invoke("fetch_global_feed", { feedMode, until: null });
            setReports(feed);
            setHasMore(feed.length >= 50);
        } catch (err: any) {
            setFeedError("No se pudo conectar: " + err.toString());
        } finally {
            setLoadingFeed(false);
        }
    }

    async function loadMoreFeed() {
        if (loadingMore || !hasMore || reports.length === 0) return;
        setLoadingMore(true);
        const oldest = Math.min(...reports.map(r => r.created_at));
        try {
            const olderFeed: Report[] = await invoke("fetch_global_feed", { feedMode, until: oldest });
            if (olderFeed.length > 0) {
                const existingIds = new Set(reports.map(r => r.id));
                const newReports = olderFeed.filter(r => !existingIds.has(r.id));
                setReports(prev => [...prev, ...newReports]);
                setHasMore(olderFeed.length >= 50);
            } else {
                setHasMore(false);
            }
        } catch (err: any) {
            showToast("Error load: " + String(err), "error");
        } finally {
            setLoadingMore(false);
        }
    }

    useEffect(() => {
        checkTor();
        loadSettings();
        loadFeed();
        timerRef.current = setInterval(() => { loadFeed(); }, 30000);
        const torTimer = setInterval(() => { checkTor(); }, 5000);
        return () => { 
            if (timerRef.current) clearInterval(timerRef.current); 
            clearInterval(torTimer);
        };
    }, [feedMode]);

    async function handleToggleFollow(pubkey: string, e: React.MouseEvent) {
        e.stopPropagation();
        try {
            const isFollowing: boolean = await invoke("toggle_follow", { pubkey });
            showToast(isFollowing ? t('followToast') : t('unfollowToast'), "success");
            if (feedMode === 'following') loadFeed();
        } catch (err) {
            showToast(String(err), 'error');
        }
    }

    async function handleToggleBlock(pubkey: string, e: React.MouseEvent) {
        e.stopPropagation();
        if (!confirm(t('blockConfirm'))) return;
        try {
            await invoke("toggle_block", { pubkey });
            showToast(t('blockedToast'), "success");
            loadFeed();
        } catch (err) {
            showToast(String(err), 'error');
        }
    }

    async function handleAttachImage() {
        try {
            const selected = await openDialog({
                multiple: false,
                filters: [{
                    name: 'Media',
                    extensions: ['png', 'jpeg', 'jpg', 'webp', 'gif', 'mp4', 'mp3', 'ogg', 'wav', 'pdf']
                }]
            });
            if (typeof selected === 'string') {
                const parts = selected.split(/[\/\\]/);
                setSelectedImage({ path: selected, name: parts[parts.length - 1] || 'Archivo Adjunto' });
            }
        } catch (err) {
            showToast((t('fileSelectError') || "Error: ") + err, 'error');
        }
    }

    async function handlePublish() {
        if (!content.trim() && !selectedImage) return;
        setPublishing(true);
        try {
            let finalContent = content.trim();

            // Si hay imagen o archivo multimedia, esterilizar en Rust y subir
            if (selectedImage) {
                showToast(t('uploadingMetadata') || "Procesando metadata...", 'success');
                const bytes = await readFile(selectedImage.path);
                
                // Subida nativa via Rust (sin CORS, sin WebView)
                const imageBytes = Array.from(bytes);
                const url = await invoke<string>("upload_file_to_catbox", {
                    fileBytes: imageBytes,
                    fileName: selectedImage.name || 'attachment'
                });
                if (url.startsWith('https://')) {
                    finalContent += `\n\n${url.trim()}`;
                } else {
                    throw new Error(url || 'Error del servidor de archivos');
                }
            }

            let publishMsg: string;
            let eventId: string;

            let activeNsec = identity.private;
            let usedBurner = false;

            // Flujo KAMIKAZE (Burner Mode)
            if (burnerMode) {
                showToast(t('kamikazeActivating') || "Activando Kamikaze...", 'success');
                const [, tempNsec] = await invoke<[string, string]>("generate_nostr_keys");
                activeNsec = tempNsec; // Usar la nueva nsec ephemeral (índice 1 de la tupla devuelta por Rust)
                usedBurner = true;
            }

            // Si estamos respondiendo a alguien, llamamos al comando correcto
            if (replyingTo) {
                // [Conexion API local]: Se invoca el sidecar Rust de NIP-01
                // Proposito: Añadir las etiquetas criptograficas 'e' y 'p' de respuesta a este evento
                const [msg, eid] = await invoke<[string, string]>("publish_reply", {
                    nsec: activeNsec,
                    content: finalContent,
                    targetEventId: replyingTo.id,
                    targetPubkey: replyingTo.pubkey
                });
                publishMsg = msg;
                eventId = eid;
            } else {
                const [msg, eid] = await invoke<[string, string]>("publish_report", {
                    nsec: activeNsec,
                    content: finalContent
                });
                publishMsg = msg;
                eventId = eid;
            }

            if (usedBurner) {
                // Ignoramos completamente el guardado local, destruimos temporal en RAM y salimos.
                activeNsec = "";
                setBurnerMode(false);
                publishMsg = t('kamikazeInjected') || "BUM 💥 Mensaje Kamikaze inyectado.";
            } else {
                // Guardar localmente solo si NO es Burner Mode
                try {
                    await invoke("save_my_report_command", {
                        eventId: eventId,
                        content: finalContent,
                        password: masterPassword
                    });
                } catch (saveErr) {
                    console.error("Error guardando reporte localmente:", saveErr);
                }
            }

            showToast(publishMsg, 'success');
            setContent("");
            setSelectedImage(null);
            setReplyingTo(null); // Limpiar modo respuesta
            await new Promise(r => setTimeout(r, 2000));
            await loadFeed();
        } catch (err) {
            showToast(String(err), 'error');
        } finally {
            setPublishing(false);
        }
    }

    async function handleReaction(eventId: string, eventPubkey: string, reaction: string) {
        setReactingId(eventId);
        try {
            const result: string = await invoke("react_to_event", {
                nsec: identity.private,
                eventId: eventId,
                eventPubkey: eventPubkey,
                reaction: reaction
            });
            showToast(result, 'success');
            // Actualizar conteo local optimisticamente
            setReports(prev => prev.map(r => {
                if (r.id === eventId) {
                    return {
                        ...r,
                        reactions_up: reaction === "+" ? r.reactions_up + 1 : r.reactions_up,
                        reactions_down: reaction === "-" ? r.reactions_down + 1 : r.reactions_down,
                    };
                }
                return r;
            }));
        } catch (err) {
            showToast(String(err), 'error');
        } finally {
            setReactingId(null);
            setReactedPosts(prev => new Set(prev).add(eventId));
        }
    }

    const generateAvatar = (pubkey: string) => {
        const color = `#${pubkey.slice(5, 11)}`;
        return (
            <div className="avatar" style={{ backgroundColor: color }}>
                {pubkey.slice(5, 7).toUpperCase()}
            </div>
        );
    };

    const formatDate = (timestamp: number) => {
        return new Date(timestamp * 1000).toLocaleString();
    };

    const getPowLabel = (pow: number) => {
        if (pow >= 20) return { text: 'Alto', cls: 'pow-high' };
        if (pow >= 12) return { text: 'Medio', cls: 'pow-mid' };
        if (pow >= 1) return { text: 'Bajo', cls: 'pow-low' };
        return { text: 'Sin PoW', cls: 'pow-none' };
    };

    const isMyMessage = (pubkey: string) => identity.public === pubkey;

    const filteredReports = reports.filter(r => r.pow >= minPow);

    return (
        <div className="board-container">
            {toast && (
                <div className={`toast toast-${toast.type}`}>
                    {toast.type === 'success' ? '[OK] ' : '[ERROR] '}
                    {toast.message}
                </div>
            )}

            <header className="board-header">
                <div className="identity-info">
                    <span className="status-dot"></span>
                    {t('connectedAs')} 
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <span className="pubkey-short">{identity.public.slice(0, 15)}...</span>
                        <button className="icon-btn" onClick={() => navigator.clipboard.writeText(identity.public)} title={t('copyPubkey') || "Copiar Código de Usuario"} style={{ padding: '2px', opacity: 0.7, cursor: 'pointer', background: 'transparent', border: 'none', color: 'var(--text-secondary)' }}>
                            <CopyIcon size={14} />
                        </button>
                    </div>
                </div>
                <div className={`tor-status ${torActive ? 'tor-on' : 'tor-off'}`}>
                    <span className="icon">
                        {torActive ? (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10" /></svg>
                        ) : (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /></svg>
                        )}
                    </span>
                    <span className="tor-text">
                        {torActive === null ? t('torDetecting') : torActive ? t('torActive') : t('torDirect')}
                    </span>
                </div>
                <div style={{ display: "flex", gap: "10px" }}>
                    <button className="secondary-btn" onClick={onOpenSettings} style={{ padding: "6px 10px", fontSize: "0.85rem" }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                        {t('settings')}
                    </button>
                    <button className="danger-btn-small" onClick={() => {
                        if (window.confirm(t('lockDesc') || "¿Seguro que deseas cerrar la sesión? Esto borrará tus llaves de la memoria RAM y bloqueará la bóveda.")) {
                            onWipe();
                        }
                    }} title={t('moreLock') || "Cierra la sesión actual."} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}><LockIcon size={14} /> {t('lockBtn')}</button>
                </div>
            </header>

            {/* DUAL FEED TABS */}
            <div className="feed-tabs-container">
                <button
                    className={`feed-tab ${feedMode === 'global' ? 'active' : ''}`}
                    onClick={() => {
                        setFeedMode('global');
                        // Lógica futura: loadFeed global
                    }}
                >
                    {t('forYou')}
                </button>
                <button
                    className={`feed-tab ${feedMode === 'following' ? 'active' : ''}`}
                    onClick={() => setFeedMode('following')}
                >
                    {t('following')}
                </button>
            </div>

            <div className="compose-area">
                {replyingTo && (
                    <div className="replying-to-banner">
                        <span className="replying-label">{t('replyingTo')}</span>
                        <span className="replying-snippet">
                            {replyingTo.content.substring(0, 50)}...
                        </span>
                        <button className="cancel-reply-btn" onClick={() => setReplyingTo(null)} title={t('cancel')}>✖</button>
                    </div>
                )}
                <textarea
                    placeholder={t('composePlaceholder')}
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    disabled={publishing}
                    rows={isFocused || content.length > 0 ? 4 : 1}
                    onFocus={() => setIsFocused(true)}
                    onBlur={() => setTimeout(() => setIsFocused(false), 200)}
                />
                {(isFocused || content.length > 0 || selectedImage !== null) && (
                <div className="compose-actions">
                    <div className="compose-tools">
                        <button className="icon-btn attach-btn" onClick={handleAttachImage} onMouseDown={(e) => e.preventDefault()} disabled={publishing} title="Adjuntar Archivos (Imágenes, Videos, Audio, PDF)">
                            <PaperclipIcon size={20} />
                        </button>
                        {selectedImage && (
                            <span className="attachment-info" onClick={() => setSelectedImage(null)} title="Click para quitar la imagen adjunta">
                                <span className="attach-label" style={{display: 'flex', alignItems: 'center', gap: '5px'}}>
                                    <PaperclipIcon size={14} /> {selectedImage.name}
                                </span>
                                <span className="attach-delete-icon"><XIcon size={14} /></span>
                            </span>
                        )}
                    </div>
                    <div className="compose-submit">
                        <div 
                            className={`burner-toggle ${burnerMode ? 'active' : ''}`}
                            onClick={() => setBurnerMode(!burnerMode)} 
                            title="Modo Kamikaze: Postea con identidad desechable y no guarda rastro local."
                            style={{
                                display: 'flex', 
                                alignItems: 'center', 
                                gap: '8px', 
                                padding: '6px 12px',
                                borderRadius: '20px',
                                border: '1px solid',
                                borderColor: burnerMode ? 'var(--danger)' : 'var(--border-color)',
                                backgroundColor: burnerMode ? 'rgba(255, 68, 68, 0.1)' : 'transparent',
                                cursor: 'pointer',
                                transition: 'all 0.2s ease',
                                marginBottom: '10px'
                            }}
                        >
                            {burnerMode ? <FlameIcon size={16} color="var(--danger)" /> : <GhostIcon size={16} color="var(--text-secondary)" />}
                            <span style={{ 
                                fontSize: '0.75rem', 
                                color: burnerMode ? 'var(--danger)' : 'var(--text-secondary)', 
                                fontWeight: burnerMode ? 'bold' : 'normal',
                                textTransform: 'uppercase',
                                letterSpacing: '0.5px'
                            }}>
                                {burnerMode ? (t('kamikazeActive') || "KAMIKAZE ACTIVO") : (t('realId') || "IDENTIDAD REAL")}
                            </span>
                        </div>
                        <span className="pow-info">PoW: 16 bits (anti-spam)</span>
                        <button
                            className="primary-btn"
                            onClick={handlePublish}
                            disabled={publishing || (!content.trim() && !selectedImage)}
                        >
                            {publishing ? "Enviando al enjambre..." : "Publicar Denuncia"}
                        </button>
                    </div>
                </div>
                )}
            </div>

            <div className="feed-header">
                <h2>{feedMode === 'global' ? t('feedGlobal') : t('feedFollowing')} <span className="msg-count">({filteredReports.length} {t('messages') || "mensajes"})</span></h2>
                <div className="feed-controls">
                    <select
                        className="pow-filter"
                        value={minPow}
                        onChange={(e) => setMinPow(Number(e.target.value))}
                    >
                        <option value={0}>{t('all') || "Todos"}</option>
                        <option value={1}>PoW {'>'}0</option>
                        <option value={8}>PoW {'>'} 8</option>
                        <option value={16}>PoW {'>'} 16</option>
                        <option value={20}>PoW {'>'} 20</option>
                    </select>
                    <button className="icon-btn" onClick={loadFeed} disabled={loadingFeed} title="Actualizar Feed">
                        {loadingFeed ? (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="spin"><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>
                        ) : (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
                        )}
                    </button>
                </div>
            </div>

            <div className="feed-area">
                {feedError && (
                    <div className="loading-state" style={{ color: 'var(--error-color)' }}>
                        [ERROR] {feedError}
                    </div>
                )}

                {loadingFeed && reports.length === 0 && !feedError ? (
                    <div className="loading-state">{t('loadingFeed') || "Conectando a Relays via Tor y buscando mensajes..."}</div>
                ) : filteredReports.length === 0 && !feedError ? (
                    <div className="empty-state" style={{ textAlign: "center", padding: "40px", color: "var(--text-secondary)" }}>
                        {feedMode === 'following' ? (t('noFollowing') || "Tus contactos aún no han publicado nada recientemente.") : (t('noMessages') || "No hay mensajes que cumplan el filtro PoW.")}
                    </div>
                ) : (
                    (() => {
                        // Agrupar posts por threading
                        const threads = new Map<string, Report[]>();
                        const rootPosts: Report[] = [];

                        filteredReports.forEach(report => {
                            if (report.reply_to) {
                                // Es una respuesta, al bucket de su target
                                const threadInfo = threads.get(report.reply_to) || [];
                                threadInfo.push(report);
                                threads.set(report.reply_to, threadInfo);
                            } else {
                                // Es un post principal
                                rootPosts.push(report);
                            }
                        });

                        // Para hilos "huerfanos" (respondieron a un post que no cargo o filtro cayo), los mostramos en raiz
                        filteredReports.forEach(report => {
                            if (report.reply_to && !filteredReports.some(r => r.id === report.reply_to)) {
                                rootPosts.push(report);
                            }
                        });

                        // Ordenamos los post raids por fecha, mas recientes primero
                        rootPosts.sort((a, b) => b.created_at - a.created_at);

                        const renderReport = (report: Report, isChild = false) => {
                            const powInfo = getPowLabel(report.pow);
                            const mine = isMyMessage(report.pubkey);
                            const isReacting = reactingId === report.id;
                            const score = report.reactions_up - report.reactions_down;

                            const cidMatch = report.content.match(/ipfs:\/\/([a-zA-Z0-9]+)/);
                            const textContent = cidMatch ? report.content.replace(cidMatch[0], '').trim() : report.content;

                            return (
                                <div key={report.id} className={`report-card ${mine ? 'my-message' : ''} ${isChild ? 'is-reply child-node' : ''}`}>
                                    <div className="report-meta">
                                        {generateAvatar(report.pubkey)}
                                        <div className="author-info">
                                            <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                    <span className="author-pubkey" title={report.pubkey}>
                                                        {mine ? '(Tu) ' : ''}{report.pubkey.slice(0, 15)}...{report.pubkey.slice(-10)}
                                                    </span>
                                                    <button className="icon-btn" onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(report.pubkey); }} title={t('copyPubkey') === 'copyPubkey' ? "Copiar Código de Usuario" : t('copyPubkey')} style={{ padding: '2px', opacity: 0.6, cursor: 'pointer', background: 'transparent', border: 'none', color: 'var(--text-secondary)' }}>
                                                        <CopyIcon size={14} />
                                                    </button>
                                                </div>
                                                
                                                {!mine && (
                                                    <div style={{ display: 'flex', gap: '5px', marginLeft: 'auto' }}>
                                                        <button
                                                            className="icon-btn"
                                                            onClick={(e) => handleToggleFollow(report.pubkey, e)}
                                                            title={t('follow') || "Seguir"}
                                                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', display: 'flex', alignItems: 'center' }}
                                                        >
                                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#eab308' }}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                                                        </button>
                                                        <button
                                                            className="icon-btn"
                                                            onClick={(e) => handleToggleBlock(report.pubkey, e)}
                                                            title={t('block') || "Bloquear"}
                                                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', display: 'flex', alignItems: 'center' }}
                                                        >
                                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#ef4444' }}><circle cx="12" cy="12" r="10"></circle><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line></svg>
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                            <span className="report-time">{formatDate(report.created_at)}</span>
                                        </div>
                                        <span className={`pow-badge ${powInfo.cls}`} title={`Proof of Work: ${report.pow} bits`}>
                                            PoW: {report.pow}
                                        </span>
                                    </div>

                                    {textContent && <div className="report-content"><MessageRenderer content={textContent} /></div>}
                                    {cidMatch && <IpfsMediaViewer cid={cidMatch[1]} />}

                                    <div className="report-actions">
                                        <button
                                            className="reaction-btn reply"
                                            onClick={() => {
                                                setReplyingTo(report);
                                                window.scrollTo({ top: 0, behavior: 'smooth' });
                                            }}
                                            title="Responder a este post"
                                        >
                                            <span className="reaction-icon">
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 10 20 15 15 20" /><path d="M4 4v7a4 4 0 0 0 4 4h12" /></svg>
                                            </span>
                                            <span className="reaction-count">{t('reply') || "Responder"}</span>
                                        </button>

                                        {!mine && (
                                            <button
                                                className="reaction-btn dm-btn"
                                                onClick={() => onOpenDM(report.pubkey)}
                                                title="Enviar Mensaje Privado Encriptado"
                                                style={{ color: 'var(--panel-accent)' }}
                                            >
                                                <span className="reaction-icon">
                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>
                                                </span>
                                                <span className="reaction-count">{t('private') || "Privado"}</span>
                                            </button>
                                        )}

                                        <button
                                            className={`reaction-btn upvote ${report.reactions_up > 0 ? 'has-votes' : ''}`}
                                            onClick={() => handleReaction(report.id, report.pubkey, "+")}
                                            disabled={isReacting || reactedPosts.has(report.id)}
                                            title={reactedPosts.has(report.id) ? t('alreadyReacted') : ""}
                                        >
                                            <span className="reaction-icon">
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" /></svg>
                                            </span>
                                            <span className="reaction-count">{report.reactions_up}</span>
                                        </button>
                                        <button
                                            className={`reaction-btn downvote ${report.reactions_down > 0 ? 'has-votes' : ''}`}
                                            onClick={() => handleReaction(report.id, report.pubkey, "-")}
                                            disabled={isReacting || reactedPosts.has(report.id)}
                                            title={reactedPosts.has(report.id) ? "Ya reaccionaste" : "Rechazar / Dudar"}
                                        >
                                            <span className="reaction-icon">
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17" /></svg>
                                            </span>
                                            <span className="reaction-count">{report.reactions_down}</span>
                                        </button>
                                        <span className={`trust-score ${score > 0 ? 'positive' : score < 0 ? 'negative' : 'neutral'}`}>
                                            {score > 0 ? '+' : ''}{score}
                                        </span>
                                    </div>

                                    {/* Mostrar respuestas directas aca bajo */}
                                    {threads.has(report.id) && (
                                        <div className="thread-replies">
                                            {threads.get(report.id)!.sort((a, b) => a.created_at - b.created_at).map(child => renderReport(child, true))}
                                        </div>
                                    )}

                                </div>
                            );
                        };

                        return (
                            <>
                                {rootPosts.map(p => renderReport(p, false))}
                                {filteredReports.length > 0 && hasMore && (
                                    <div className="load-more-container" style={{ textAlign: "center", padding: "20px 0", marginTop: "10px" }}>
                                        <button 
                                            className="secondary-btn" 
                                            onClick={loadMoreFeed} 
                                            disabled={loadingMore}
                                            style={{ width: "auto", display: "inline-flex", padding: "10px 20px" }}
                                        >
                                            {loadingMore ? (t('loading') || "Cargando...") : (t('loadMore') || "Cargar Mensajes Anteriores...")}
                                        </button>
                                    </div>
                                )}
                            </>
                        );
                    })()
                )}
            </div>
        </div>
    );
}
