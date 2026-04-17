/**
 * ============================================================================
 * ARCHIVO: components/GroupsBoard.tsx
 * ============================================================================
 * PROPOSITO:
 * Muestra la lista de Canales Públicos (NIP-28) disponibles en la red Nostr.
 * Permite buscar/crear nuevos canales y seleccionar uno para empezar a chatear.
 * 
 * ARQUITECTURA PARA JUNIORS:
 * - Llama a `fetch_channels` en Rust para buscar "Kind 40" (Creación de Canal).
 * - Cuando el usuario hace clic en un canal, llamamos a `onSelectChannel(id)`
 *   para que `App.tsx` abra el `ChannelChat.tsx`.
 * ============================================================================
 */
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { PlusIcon, GlobeIcon, FolderIcon, StarIcon, MessageSquareIcon, XIcon } from "./Icons";
import { useT } from "../i18n/LanguageContext";

export interface Channel {
    id: string;
    pubkey: string;
    name: string;
    about: string;
    picture: string;
    created_at: number;
}

interface GroupsBoardProps {
    identity: { public: string, private: string };
    onSelectChannel: (channelId: string, channelName: string) => void;
}

export default function GroupsBoard({ identity, onSelectChannel }: GroupsBoardProps) {
    const { t } = useT();
    const [channels, setChannels] = useState<Channel[]>([]);
    const [savedChannels, setSavedChannels] = useState<Channel[]>([]);
    const [activeTab, setActiveTab] = useState<'explorar' | 'mis_grupos'>('explorar');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showCreateModal, setShowCreateModal] = useState(false);

    // Estado para ocultar/borrar canales localmente
    const [hiddenChannels, setHiddenChannels] = useState<string[]>(() => {
        try {
            return JSON.parse(localStorage.getItem('hiddenChannels') || '[]');
        } catch { return []; }
    });

    // Estado para Crear Canal
    const [newName, setNewName] = useState("");
    const [newAbout, setNewAbout] = useState("");
    const [creating, setCreating] = useState(false);

    async function loadChannels() {
        setLoading(true);
        setError(null);
        try {
            if (activeTab === 'explorar') {
                const data: Channel[] = await invoke("fetch_channels");
                setChannels(data);
            } else {
                const data: Channel[] = await invoke("get_saved_channels");
                setSavedChannels(data);
            }
        } catch (err) {
            setError(String(err));
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        loadChannels();
    }, [activeTab]);

    const handleHideChannel = (e: React.MouseEvent, channelId: string) => {
        e.stopPropagation(); // Evitar entrar al canal al hacer clic en borrar
        if (window.confirm(t('hideChannelConfirm') || "¿Seguro que deseas ocultar este canal de tu vista? (Acción local)")) {
            const updatedHidden = [...hiddenChannels, channelId];
            setHiddenChannels(updatedHidden);
            localStorage.setItem('hiddenChannels', JSON.stringify(updatedHidden));
        }
    };

    async function handleCreateChannel() {
        if (!newName.trim()) return;
        setCreating(true);
        try {
            // [Conexión API local]: Creamos el evento Kind 40 en la red
            await invoke("create_channel", {
                nsec: identity.private,
                name: newName,
                about: newAbout,
                picture: "" // No implementado imagen de canal por ahora
            });
            setShowCreateModal(false);
            setNewName("");
            setNewAbout("");
            await loadChannels(); // Recargar lista
        } catch (err) {
            alert((t('createChannelError') || "Error al crear canal: ") + err);
        } finally {
            setCreating(false);
        }
    }

    async function handleToggleFollowCreator(pubkey: string, e: React.MouseEvent) {
        e.stopPropagation();
        try {
            const isFollowing: boolean = await invoke("toggle_follow", { pubkey });
            alert(isFollowing ? (t('followCreatorToast') || "⭐ Ahora sigues al creador de este canal") : (t('unfollowCreatorToast') || "Dejaste de seguir a este creador"));
        } catch (err) {
            alert(String(err));
        }
    }

    async function handleSaveChannel(channel: Channel, e: React.MouseEvent) {
        e.stopPropagation();
        try {
            await invoke("save_channel", {
                id: channel.id,
                name: channel.name,
                about: channel.about,
                pubkey: channel.pubkey,
                picture: channel.picture
            });
            alert(t('channelSavedToast') || "✅ Canal guardado en 'Mis Grupos'");
        } catch (err) {
            alert((t('saveError') || "Error al guardar: ") + err);
        }
    }

    async function handleRemoveSavedChannel(channelId: string, e: React.MouseEvent) {
        e.stopPropagation();
        if (!confirm(t('removeChannelConfirm') || "¿Quitar este canal de Mis Grupos?")) return;
        try {
            await invoke("remove_saved_channel", { id: channelId });
            await loadChannels();
        } catch (err) {
            alert((t('removeError') || "Error al quitar: ") + err);
        }
    }

    // Filtramos los canales ocultos por el usuario
    const visibleChannels = channels.filter(c => !hiddenChannels.includes(c.id));
    const renderList = activeTab === 'explorar' ? visibleChannels : savedChannels;

    return (
        <div className="card" style={{ padding: '0', overflow: 'hidden', display: 'flex', flexDirection: 'column', height: '100%' }}>

            <header className="board-header" style={{ padding: '20px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h2 style={{ margin: '0 0 5px 0' }}>{t('publicChannels') || "Canales Públicos"}</h2>
                    <p style={{ margin: '0', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                        {t('publicChannelsDesc') || "Explora salas de chat temáticas descentralizadas (NIP-28)."}
                    </p>
                </div>
                <div>
                    <button className="primary-btn" onClick={() => setShowCreateModal(true)} style={{ padding: '8px 15px', width: 'auto', display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <PlusIcon size={16}/> {t('createChannel') || "Crear Canal"}
                    </button>
                    <button className="icon-btn" onClick={loadChannels} disabled={loading} style={{ marginLeft: '10px', width: 'auto' }} title={t('refresh') || "Actualizar"}>
                        {loading ? '⏳' : '↻'}
                    </button>
                </div>
            </header>

            <div className="board-tabs" style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', backgroundColor: 'var(--panel-bg)' }}>
                <button
                    className={`tab-btn ${activeTab === 'explorar' ? 'active' : ''}`}
                    onClick={() => setActiveTab('explorar')}
                    style={{ flex: 1, padding: '12px', border: 'none', background: 'none', cursor: 'pointer', borderBottom: activeTab === 'explorar' ? '3px solid var(--accent-color)' : '3px solid transparent', color: activeTab === 'explorar' ? 'var(--text-color)' : 'var(--text-secondary)', fontWeight: activeTab === 'explorar' ? 'bold' : 'normal', fontSize: '1rem', transition: 'all 0.2s' }}
                >
                    <div style={{display:'flex', alignItems:'center', gap:'5px', justifyContent:'center'}}><GlobeIcon size={16}/> {t('exploreNostr') || "Explorar red Nostr"}</div>
                </button>
                <button
                    className={`tab-btn ${activeTab === 'mis_grupos' ? 'active' : ''}`}
                    onClick={() => setActiveTab('mis_grupos')}
                    style={{ flex: 1, padding: '12px', border: 'none', background: 'none', cursor: 'pointer', borderBottom: activeTab === 'mis_grupos' ? '3px solid var(--accent-color)' : '3px solid transparent', color: activeTab === 'mis_grupos' ? 'var(--text-color)' : 'var(--text-secondary)', fontWeight: activeTab === 'mis_grupos' ? 'bold' : 'normal', fontSize: '1rem', transition: 'all 0.2s' }}
                >
                    <div style={{display:'flex', alignItems:'center', gap:'5px', justifyContent:'center'}}><FolderIcon size={16}/> {t('myGroups') || "Mis Grupos"}</div>
                </button>
            </div>

            <div className="feed-area" style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
                {error && <div className="error-text">⚠ {t('error') || "Error"}: {error}</div>}

                {loading && renderList.length === 0 && !error ? (
                    <div className="loading-state">
                        {activeTab === 'explorar' ? (t('loadingExplore') || "Buscando Canales en el enjambre Tor/Nostr...") : (t('loadingSaved') || "Cargando tus canales guardados...")}
                    </div>
                ) : renderList.length === 0 && !error ? (
                    <div className="empty-state">
                        {activeTab === 'explorar' ? (t('noExploreChannels') || "No se encontraron canales públicos recientes o todos han sido ocultados.") : (t('noSavedChannels') || "Aún no has guardado ningún canal.")}
                    </div>
                ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '15px' }}>
                        {renderList.map(channel => (
                            <div
                                key={channel.id}
                                className="report-card"
                                style={{ cursor: 'pointer', transition: 'transform 0.1s', margin: 0, position: 'relative' }}
                                onClick={() => onSelectChannel(channel.id, channel.name)}
                                onMouseOver={(e) => e.currentTarget.style.transform = 'scale(1.02)'}
                                onMouseOut={(e) => e.currentTarget.style.transform = 'scale(1)'}
                            >
                                <button
                                    onClick={(e) => activeTab === 'explorar' ? handleHideChannel(e, channel.id) : handleRemoveSavedChannel(channel.id, e)}
                                    title={activeTab === 'explorar' ? (t('hideChannel') || "Ocultar Canal de la vista") : (t('removeFromMyGroups') || "Eliminar de Mis Grupos")}
                                    style={{
                                        position: 'absolute', top: 10, right: 10, width: '30px', height: '30px',
                                        padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        background: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger)',
                                        border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '50%', zIndex: 10
                                    }}
                                >
                                    <XIcon size={14} />
                                </button>
                                {activeTab === 'explorar' && (
                                    <button
                                        onClick={(e) => handleSaveChannel(channel, e)}
                                        title={t('saveToMyGroups') || "Guardar en Mis Grupos"}
                                        style={{
                                            position: 'absolute', top: 10, right: 50, width: '30px', height: '30px',
                                            padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            background: 'rgba(234, 179, 8, 0.1)', color: '#eab308',
                                            border: '1px solid rgba(234, 179, 8, 0.3)', borderRadius: '50%', zIndex: 10
                                        }}
                                    >
                                        <StarIcon size={14} />
                                    </button>
                                )}
                                <h3 style={{ margin: '0 0 10px 0', display: 'flex', alignItems: 'center', gap: '8px', paddingRight: '25px' }}>
                                    <span style={{ color: 'var(--accent-color)', display: 'flex' }}><MessageSquareIcon size={24} /></span>
                                    {channel.name}
                                </h3>
                                <p style={{ margin: '0 0 15px 0', color: 'var(--text-secondary)', fontSize: '0.9rem', minHeight: '40px' }}>
                                    {channel.about || (t('noDescription') || "Sin descripción.")}
                                </p>
                                <div style={{ fontSize: '0.8rem', color: 'var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                        {t('creator') || "Creador: "} {channel.pubkey.substring(0, 10)}...
                                        <button
                                            onClick={(e) => handleToggleFollowCreator(channel.pubkey, e)}
                                            title={t('followCreator') || "Seguir Creador de Canal"}
                                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0', display: 'flex', alignItems: 'center' }}
                                        >
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#eab308' }}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                                        </button>
                                    </div>
                                    <span>ID: {channel.id.substring(0, 6)}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Modal para crear canal */}
            {showCreateModal && (
                <div style={{
                    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: 'rgba(0,0,0,0.8)', display: 'flex', justifyContent: 'center',
                    alignItems: 'center', zIndex: 1000, padding: '20px'
                }}>
                    <div className="card" style={{ width: '100%', maxWidth: '400px', backgroundColor: 'var(--panel-bg)' }}>
                        <h3 style={{ marginTop: 0 }}>{t('createNewChannel') || "Crear Nuevo Canal"}</h3>
                        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '15px' }}>
                            {t('createChannelDesc') || "Los canales son públicos estáticos. No se pueden eliminar después de creados."}
                        </p>

                        <div style={{ marginBottom: '15px' }}>
                            <label style={{ display: 'block', marginBottom: '5px', fontSize: '0.9rem' }}>{t('channelName') || "Nombre del Canal"}</label>
                            <input
                                type="text"
                                placeholder={t('channelNamePlaceholder') || "Ej. Activistas de Monterrey"}
                                value={newName}
                                onChange={e => setNewName(e.target.value)}
                                style={{ width: '100%' }}
                            />
                        </div>

                        <div style={{ marginBottom: '20px' }}>
                            <label style={{ display: 'block', marginBottom: '5px', fontSize: '0.9rem' }}>{t('channelAbout') || "Descripción (Opcional)"}</label>
                            <textarea
                                placeholder={t('channelAboutPlaceholder') || "¿De qué trata este canal?"}
                                value={newAbout}
                                onChange={e => setNewAbout(e.target.value)}
                                style={{ width: '100%', height: '80px', resize: 'none' }}
                            />
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                            <button className="secondary-btn" onClick={() => setShowCreateModal(false)} disabled={creating}>{t('cancel') || "Cancelar"}</button>
                            <button className="primary-btn" onClick={handleCreateChannel} disabled={creating || !newName.trim()}>
                                {creating ? (t('encrypting') || "Cifrando...") : (t('createChannelBtn') || "Crear Canal (PoW)")}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
