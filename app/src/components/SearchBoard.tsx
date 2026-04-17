/**
 * ============================================================================
 * ARCHIVO: components/SearchBoard.tsx
 * ============================================================================
 * PROPOSITO:
 * Componente dedicado a mostrar resultados de busqueda NIP-50.
 *
 * ARQUITECTURA PARA JUNIORS:
 * - Emplea el comando rust `search_nostr_events` con el `query` digitado.
 * - Reutiliza estilos de `ReportBoard.css` para mostrar las tarjetas.
 * ============================================================================
 */
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { SearchIcon, FlameIcon } from "./Icons";
import MessageRenderer from "./MessageRenderer";
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
    reply_to?: string;
}

export default function SearchBoard() {
    const { t } = useT();
    const [query, setQuery] = useState("");
    const [results, setResults] = useState<Report[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [searched, setSearched] = useState(false);

    const [trending, setTrending] = useState<string[]>([]);
    const [loadingTrending, setLoadingTrending] = useState(false);

    useEffect(() => {
        loadTrending();
    }, []);

    async function loadTrending() {
        setLoadingTrending(true);
        try {
            const tags: string[] = await invoke("fetch_trending_tags");
            setTrending(tags);
        } catch (err) {
            console.error("Fallo obteniendo trends", err);
        } finally {
            setLoadingTrending(false);
        }
    }

    async function handleSearch(overrideQuery?: string) {
        const q = overrideQuery || query;
        if (!q.trim()) return;
        setQuery(q);
        setLoading(true);
        setError(null);
        setSearched(true);

        try {
            const data: Report[] = await invoke("search_nostr_events", { query: q.trim() });
            setResults(data);
        } catch (err) {
            setError(String(err));
        } finally {
            setLoading(false);
        }
    }

    async function handleToggleFollow(pubkey: string, e: React.MouseEvent) {
        e.stopPropagation();
        try {
            const isFollowing: boolean = await invoke("toggle_follow", { pubkey });
            alert(isFollowing ? t('followToast') : t('unfollowToast'));
        } catch (err) {
            alert(String(err));
        }
    }

    async function handleToggleBlock(pubkey: string, e: React.MouseEvent) {
        e.stopPropagation();
        if (!confirm(t('blockConfirm'))) return;
        try {
            await invoke("toggle_block", { pubkey });
            alert(t('blockedToast'));
        } catch (err) {
            alert(String(err));
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

    return (
        <div className="board-container" style={{ padding: 0 }}>
            {/* Cabecera del buscador */}
            <header className="board-header">
                <div style={{ width: '100%' }}>
                    <h2 style={{ margin: '0 0 10px 0', fontSize: '1.25rem', color: 'var(--text-color)' }}>{t('searchTitle') || "Buscador Global (NIP-50)"}</h2>
                    <div style={{ display: 'flex', gap: '10px' }}>
                        <input
                            type="text"
                            placeholder={t('searchPlaceholder')}
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSearch();
                            }}
                            style={{
                                flexGrow: 1, padding: '12px 16px', borderRadius: '8px', border: '1px solid var(--border-color)',
                                backgroundColor: 'var(--bg-color)', color: 'var(--text-color)', fontSize: '1rem',
                                outline: 'none', transition: 'border-color 0.2s'
                            }}
                            onFocus={(e) => e.currentTarget.style.borderColor = 'var(--primary-color)'}
                            onBlur={(e) => e.currentTarget.style.borderColor = 'var(--border-color)'}
                            disabled={loading}
                        />
                        <button
                            className="primary-btn"
                            onClick={() => handleSearch()}
                            disabled={loading || !query.trim()}
                            style={{ width: '120px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px' }}
                        >
                            {loading ? '⏳' : <><SearchIcon size={16} /> {t('searchBtn')}</>}
                        </button>
                    </div>
                    <p style={{ margin: '10px 0 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        {t('searchDesc') || "Se conecta a relays de indexación (ej. search.nos.today) via Tor para garantizar resultados anónimos."}
                    </p>
                </div>
            </header>

            {/* Trending Bar */}
            {!searched && !loading && (
                <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--border-color)', backgroundColor: 'var(--panel-bg)'}}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '10px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        <FlameIcon size={14} color="#f97316" /> {t('trending')}
                    </div>
                    {loadingTrending ? (
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{t('loadingTrending')}</div>
                    ) : trending.length > 0 ? (
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                            {trending.map(tag => (
                                <button
                                    key={tag}
                                    className="secondary-btn"
                                    onClick={() => handleSearch(`#${tag}`)}
                                    style={{ 
                                        padding: '4px 10px', 
                                        fontSize: '0.75rem', 
                                        borderRadius: '16px', 
                                        cursor: 'pointer', 
                                        width: 'fit-content',
                                        minWidth: '0',
                                        flex: '0 1 auto',
                                        border: '1px solid var(--border-color)',
                                        backgroundColor: 'rgba(0,0,0,0.1)'
                                    }}
                                >
                                    #{tag}
                                </button>
                            ))}
                        </div>
                    ) : (
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{t('noTrending') || "Sin tendencias suficientes."}</div>
                    )}
                </div>
            )}

            {/* Area de Resultados */}
            <div className="feed-area" style={{ maxHeight: 'calc(100vh - 280px)' }}>
                {error && (
                    <div className="loading-state" style={{ color: 'var(--error-color)' }}>
                        [ERROR] {error}
                    </div>
                )}

                {loading ? (
                    <div className="loading-state">{t('loadingSearch') || "Buscando en red Tor..."}</div>
                ) : searched && results.length === 0 && !error ? (
                    <div className="loading-state">{t('noResults')} "{query}".</div>
                ) : !searched ? (
                    <div className="empty-state" style={{ padding: '40px', textAlign: 'center' }}>
                        <div style={{ marginBottom: '15px', color: 'var(--border-color)', display: 'flex', justifyContent: 'center' }}><SearchIcon size={48} /></div>
                        <h3 style={{ margin: '0 0 10px 0', color: 'var(--text-secondary)' }}>{t('searchEmptyTitle') || "Busca en la Red Nostr"}</h3>
                        <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                            {t('searchEmpty')}
                        </p>
                    </div>
                ) : (
                    <>
                        <div style={{ padding: '0 5px 10px 5px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                            {t('showingResults') || "Mostrando"} {results.length} {t('resultsFor') || "resultados para"} "<strong>{query}</strong>":
                        </div>
                        {results.map(report => {
                            const powInfo = getPowLabel(report.pow);

                            // Remover links a IPFS temporariamente en el buscador simple para mayor velocidad
                            const cidMatch = report.content.match(/ipfs:\/\/([a-zA-Z0-9]+)/);
                            const textContent = cidMatch ? report.content.replace(cidMatch[0], `[${t('attachedImage') || "IMAGEN ADJUNTA"}]`).trim() : report.content;

                            return (
                                <div key={report.id} className="report-card">
                                    <div className="report-meta">
                                        {generateAvatar(report.pubkey)}
                                        <div className="author-info">
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <span className="author-pubkey" title={report.pubkey}>
                                                    {report.pubkey.slice(0, 15)}...{report.pubkey.slice(-10)}
                                                </span>
                                                <div style={{ display: 'flex', gap: '5px' }}>
                                                    <button
                                                        className="icon-btn"
                                                        onClick={(e) => handleToggleFollow(report.pubkey, e)}
                                                        title={t('follow')}
                                                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', display: 'flex', alignItems: 'center' }}
                                                    >
                                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#eab308' }}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                                                    </button>
                                                    <button
                                                        className="icon-btn"
                                                        onClick={(e) => handleToggleBlock(report.pubkey, e)}
                                                        title={t('block')}
                                                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', display: 'flex', alignItems: 'center' }}
                                                    >
                                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#ef4444' }}><circle cx="12" cy="12" r="10"></circle><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line></svg>
                                                    </button>
                                                </div>
                                            </div>
                                            <span className="report-time">{formatDate(report.created_at)}</span>
                                        </div>
                                        <span className={`pow-badge ${powInfo.cls}`} title={`Proof of Work: ${report.pow} bits`}>
                                            PoW: {report.pow}
                                        </span>
                                    </div>
                                    <div className="report-content"><MessageRenderer content={textContent} /></div>
                                </div>
                            );
                        })}
                    </>
                )}
            </div>
        </div>
    );
}
