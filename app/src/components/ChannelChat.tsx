/**
 * ============================================================================
 * ARCHIVO: components/ChannelChat.tsx
 * ============================================================================
 * PROPOSITO:
 * Muestra los mensajes de un Canal Público (NIP-28) específico y permite enviar nuevos.
 * Funciona como una ventana flotante/vista encima del tablero principal, con auto-refresh.
 * 
 * ARQUITECTURA PARA JUNIORS:
 * - Recibe el ID del Canal como prop.
 * - Llama a `fetch_channel_messages(channel_id)` de Rust.
 * - Enviar mensajes usa `send_channel_message(channel_id, texto)`.
 * - Tiene un botón "Volver" para regresar a `GroupsBoard`.
 * ============================================================================
 */
import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { PaperclipIcon } from "./Icons";
import MessageRenderer from "./MessageRenderer";
import { useT } from "../i18n/LanguageContext";

interface Identity {
    public: string;
    private: string;
}

interface ChannelMessage {
    id: string;
    pubkey: string;
    content: string;
    created_at: number;
    pow: number;
}

interface ChannelChatProps {
    identity: Identity;
    channelId: string;
    channelName: string;
    onBack: () => void;
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

    if (error) return <div className="ipfs-error" style={{ color: 'var(--danger)', fontSize: '0.8rem' }}>⚠ {error}</div>;
    if (!mediaSrc) return <div className="ipfs-loading" style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>{t('ipfsDownloading') || "Descargando de nodos IPFS... ⏳"}</div>;

    if (mediaSrc.startsWith("data:video")) return <video src={mediaSrc} controls style={{ maxWidth: '100%', maxHeight: '300px', borderRadius: '8px', marginTop: '10px' }} />;
    if (mediaSrc.startsWith("data:audio")) return <audio src={mediaSrc} controls style={{ width: '100%', marginTop: '10px' }} />;
    if (mediaSrc.startsWith("data:application/pdf")) return <object data={mediaSrc} type="application/pdf" style={{ width: '100%', height: '350px', borderRadius: '8px', marginTop: '10px' }} ><a href={mediaSrc} download>{t('downloadPdf') || "Descargar PDF"}</a></object>;

    return <img src={mediaSrc} style={{ maxWidth: '100%', maxHeight: '300px', borderRadius: '8px', marginTop: '10px', cursor: 'pointer' }} alt={t('decentralizedContent') || "Contenido descentralizado"} loading="lazy" onClick={() => window.open(mediaSrc)} />;
}

export default function ChannelChat({ identity, channelId, channelName, onBack }: ChannelChatProps) {
    const { t } = useT();
    const [messages, setMessages] = useState<ChannelMessage[]>([]);
    const [newMessage, setNewMessage] = useState("");
    const [selectedImage, setSelectedImage] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const [uploadStatus, setUploadStatus] = useState("");
    const messagesEndRef = useRef<HTMLDivElement>(null);

    async function loadMessages() {
        try {
            // [Conexión API local]: Pedimos a Rust los mensajes de ESTE canal usando su ID
            const data: ChannelMessage[] = await invoke("fetch_channel_messages", { channelId });
            setMessages(data);
        } catch (err) {
            console.error(t('loadChannelMessagesError') || "Error cargando mensajes del canal:", err);
        } finally {
            setLoading(false);
        }
    }

    // Auto-scroll hacia abajo
    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }

    // Cargar al inicio y pulso cada 10 seg
    useEffect(() => {
        loadMessages();
        const interval = setInterval(loadMessages, 10000);
        return () => clearInterval(interval);
    }, [channelId]);

    // Scroll cuando llegan mensajes nuevos
    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    async function handleAttachImage() {
        try {
            const selected = await open({
                multiple: false,
                filters: [{
                    name: 'Media',
                    extensions: ['png', 'jpeg', 'jpg', 'webp', 'gif', 'mp4', 'mp3', 'ogg', 'wav', 'pdf']
                }]
            });
            if (typeof selected === 'string') {
                setSelectedImage(selected);
            }
        } catch (err) {
            alert(`${t('fileSelectError') || "Error seleccionando archivo:"} ${err}`);
        }
    }

    async function handleSendMessage() {
        if (!newMessage.trim() && !selectedImage) return;
        if (sending) return;
        setSending(true);

        try {
            let finalContent = newMessage.trim();

            if (selectedImage) {
                // Subir a IPFS
                setUploadStatus(t('strippingMetadata') || "Extirpando metadatos (GPS/EXIF) del archivo...");
                const cid: string = await invoke("upload_to_ipfs", { filePath: selectedImage });
                finalContent += `\n\nipfs://${cid}`;
            }

            // [Conexión API local]: Publicar nota (Kind 42) asociada al canal (Tag E)
            await invoke("send_channel_message", {
                nsec: identity.private,
                channelId: channelId,
                content: finalContent
            });
            setNewMessage("");
            setSelectedImage(null);
            // Recargamos instantáneo
            await loadMessages();
        } catch (err) {
            alert((t('sendChannelMsgError') || "Error al enviar el mensaje al canal: ") + err);
        } finally {
            setSending(false);
            setUploadStatus("");
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

    return (
        <div className="card" style={{
            padding: 0, display: 'flex', flexDirection: 'column', flex: 1, height: '100%',
            overflow: 'hidden', backgroundColor: 'var(--bg-color)', minHeight: '60vh'
        }}>

            {/* Header del Chat */}
            <div style={{
                display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                padding: '15px 20px', borderBottom: '1px solid var(--border-color)',
                backgroundColor: 'var(--panel-bg)', gap: '15px', flexShrink: 0
            }}>
                <button onClick={onBack} title={t('backToGroups') || "Volver a los grupos"} style={{
                    width: 'auto', background: 'none', border: 'none', color: 'var(--accent-color)',
                    fontSize: '1rem', cursor: 'pointer', padding: '5px', fontWeight: 'bold',
                    display: 'flex', alignItems: 'center', gap: '5px', flexShrink: 0
                }}>
                    <span>⬅ {t('back') || "Volver"}</span>
                </button>
                <div style={{ flex: 1, overflow: 'hidden', textAlign: 'center' }}>
                    <h2 style={{ margin: 0, fontSize: '1.2rem', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
                        💬 {channelName}
                    </h2>
                    <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        <span style={{ fontFamily: 'monospace' }}>{channelId.substring(0, 16)}...</span>
                    </p>
                </div>
                <button className="icon-btn" onClick={loadMessages} disabled={loading} title={t('forceRefresh') || "Forzar Refresco"} style={{ width: 'auto', opacity: loading ? 0.5 : 1, flexShrink: 0 }}>
                    {loading ? '⏳' : '↻'}
                </button>
            </div>

            {/* Zona de Mensajes */}
            <div style={{
                flex: 1, padding: '20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '15px'
            }}>
                {messages.length === 0 && !loading && (
                    <div style={{ textAlign: 'center', color: 'var(--text-secondary)', marginTop: '50px' }}>
                        {t('channelEmptyState') || "No hay mensajes en este canal. ¡Rompe el hielo!"}
                    </div>
                )}

                {messages.map(msg => {
                    const isMe = msg.pubkey === identity.public;
                    const cidMatch = msg.content.match(/ipfs:\/\/([a-zA-Z0-9]+)/);
                    const textContent = cidMatch ? msg.content.replace(cidMatch[0], '').trim() : msg.content;

                    return (
                        <div key={msg.id} style={{
                            alignSelf: isMe ? 'flex-end' : 'flex-start',
                            maxWidth: '75%', minWidth: '250px'
                        }}>
                            <div style={{
                                fontSize: '0.75rem', color: 'var(--text-secondary)',
                                marginBottom: '4px', textAlign: isMe ? 'right' : 'left',
                                display: 'flex', alignItems: 'center', justifyContent: isMe ? 'flex-end' : 'flex-start', gap: '5px'
                            }}>
                                {isMe ? (t('you') || "Tú") : (msg.pubkey.substring(0, 10) + '...')}
                                {!isMe && (
                                    <div style={{ display: 'flex', gap: '2px' }}>
                                        <button
                                            onClick={(e) => handleToggleFollow(msg.pubkey, e)}
                                            title={t('follow')}
                                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0', display: 'flex', alignItems: 'center' }}
                                        >
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#eab308' }}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                                        </button>
                                        <button
                                            onClick={(e) => handleToggleBlock(msg.pubkey, e)}
                                            title={t('block')}
                                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0', display: 'flex', alignItems: 'center' }}
                                        >
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#ef4444' }}><circle cx="12" cy="12" r="10"></circle><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line></svg>
                                        </button>
                                    </div>
                                )}
                                {' • '}
                                {new Date(msg.created_at * 1000).toLocaleTimeString()}
                            </div>
                            <div style={{
                                padding: '12px 16px',
                                borderRadius: '12px',
                                backgroundColor: isMe ? 'var(--accent-color)' : 'var(--panel-bg)',
                                color: isMe ? 'white' : 'var(--text-color)',
                                border: isMe ? 'none' : '1px solid var(--border-color)',
                                wordWrap: 'break-word',
                                whiteSpace: 'pre-wrap',
                                fontFamily: 'Inter, system-ui, sans-serif',
                                lineHeight: '1.4'
                            }}>
                                {textContent && <div><MessageRenderer content={textContent} /></div>}
                                {cidMatch && <IpfsMediaViewer cid={cidMatch[1]} />}
                            </div>
                            <div style={{
                                fontSize: '0.7rem', color: isMe ? 'rgba(255,255,255,0.7)' : 'var(--text-secondary)',
                                marginTop: '4px', textAlign: isMe ? 'right' : 'left'
                            }}>
                                PoW: {msg.pow} bits | ID: {msg.id.substring(0, 5)}
                            </div>
                        </div>
                    );
                })}
                <div ref={messagesEndRef} />
            </div>

            {/* Zona de Escribir (Input) */}
            <div className="composer-wrapper" style={{ padding: '20px', borderTop: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)' }}>
                {uploadStatus && (
                    <div style={{ padding: '10px', marginBottom: '10px', backgroundColor: 'rgba(255, 165, 0, 0.1)', color: 'orange', borderRadius: '8px', fontSize: '0.85rem', textAlign: 'center' }}>
                        ⏳ {uploadStatus}
                    </div>
                )}
                {selectedImage && (
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: '10px', backgroundColor: 'rgba(59, 130, 246, 0.1)',
                        padding: '8px 12px', borderRadius: '8px', border: '1px solid rgba(59, 130, 246, 0.3)'
                    }}>
                        <span style={{ fontSize: '0.85rem', color: 'var(--accent-color)', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            📷 {selectedImage.split('\\').pop()?.split('/').pop()}
                        </span>
                        <button onClick={() => setSelectedImage(null)} style={{
                            background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '0 5px'
                        }} title={t('removeImage') || "Quitar imagen"}>✖</button>
                    </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%' }}>
                    <button
                        onClick={handleAttachImage}
                        disabled={sending}
                        style={{
                            width: 'auto', background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '10px',
                            display: 'flex', alignItems: 'center', justifyContent: 'center'
                        }}
                        title={t('attachFile') || "Adjuntar Archivos (Imágenes, Videos, Audio, PDF)"}
                    >
                        <PaperclipIcon size={24} />
                    </button>
                    <textarea
                        placeholder={t('channelChatPlaceholder') || "Envia un mensaje a este canal público (PoW aplicado)..."}
                        value={newMessage}
                        onChange={(e) => setNewMessage(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                handleSendMessage();
                            }
                        }}
                        style={{
                            flexGrow: 1, padding: '12px', borderRadius: '8px', border: '1px solid var(--border-color)',
                            backgroundColor: 'var(--bg-color)', color: 'var(--text-color)',
                            resize: 'none', height: '50px', outline: 'none', fontFamily: 'Inter, system-ui, sans-serif'
                        }}
                        disabled={sending}
                    />
                    <button
                        onClick={handleSendMessage}
                        disabled={(!newMessage.trim() && !selectedImage) || sending}
                        style={{
                            width: 'auto', padding: '0 25px', height: '50px', borderRadius: '8px', border: 'none',
                            backgroundColor: newMessage.trim() && !sending ? 'var(--accent-color)' : 'var(--border-color)',
                            color: 'white', fontWeight: 'bold', cursor: newMessage.trim() && !sending ? 'pointer' : 'not-allowed',
                            transition: 'background-color 0.2s', flexShrink: 0
                        }}
                    >
                        {sending ? '...' : (t('send') || "Enviar")}
                    </button>
                </div>
            </div>
        </div>
    );
}
