import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from "@tauri-apps/plugin-dialog";
import MessageRenderer from './MessageRenderer';
import { PaperclipIcon, SendIcon } from './Icons';
import { useT } from '../i18n/LanguageContext';
import './DirectMessageChat.css';

function IpfsMediaViewerEncrypted({ cid, encryptionKey }: { cid: string, encryptionKey: string }) {
    const { t } = useT();
    const [mediaSrc, setMediaSrc] = useState<string | null>(null);
    const [mimeType, setMimeType] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let mounted = true;
        invoke("fetch_ipfs_media_decrypted", { cid, base64Key: encryptionKey })
            .then(async (dataUri: any) => { 
                if (!mounted) return;
                try {
                    const mime = dataUri.split(':')[1].split(';')[0];
                    setMimeType(mime);
                    
                    const res = await fetch(dataUri);
                    const blob = await res.blob();
                    const blobUrl = URL.createObjectURL(blob);
                    setMediaSrc(blobUrl);
                } catch (e) {
                    setError(t('dmDecodeError') || "Error decodificando archivo en navegador");
                }
            })
            .catch((err) => { if (mounted) setError(String(err)); });
        return () => { mounted = false; };
    }, [cid, encryptionKey]);

    if (error) return <div className="dm-error" style={{fontSize: '0.8rem', marginTop: '5px'}}>⚠ {error}</div>;
    if (!mediaSrc || !mimeType) return <div className="dm-status" style={{fontSize: '0.8rem', marginTop: '5px'}}>{t('dmDecryptingAttachment') || "Descifrando adjunto IPFS... ⏳"}</div>;

    if (mimeType.startsWith("video/")) return <video src={mediaSrc} controls preload="auto" style={{ maxWidth: '100%', maxHeight: '400px', borderRadius: '8px', marginTop: '5px' }} />;
    if (mimeType.startsWith("audio/")) return <audio src={mediaSrc} controls style={{ width: '100%', marginTop: '5px' }} />;
    if (mimeType === "application/pdf") return <object data={mediaSrc} type="application/pdf" style={{ width: '100%', height: '300px', borderRadius: '8px', marginTop: '5px' }} ><a href={mediaSrc} download>{t('dmGetPdf') || "Obtener PDF (E2EE)"}</a></object>;

    return <img src={mediaSrc} style={{ maxWidth: '100%', maxHeight: '300px', borderRadius: '8px', marginTop: '5px', cursor: 'pointer' }} alt="Adjunto Cifrado" loading="lazy" onClick={() => window.open(mediaSrc)} />;
}

interface DirectMessage {
    id: string;
    sender_pubkey: string;
    recipient_pubkey: string;
    content: string;
    created_at: number;
}

interface DirectMessageChatProps {
    identity: { public: string; private: string };
    targetPubkey: string;
    onClose: () => void;
}

export default function DirectMessageChat({ identity, targetPubkey, onClose }: DirectMessageChatProps) {
    const { t } = useT();
    const [messages, setMessages] = useState<DirectMessage[]>([]);
    const [draft, setDraft] = useState("");
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedImage, setSelectedImage] = useState<string | null>(null);
    const [uploadStatus, setUploadStatus] = useState("");
    const messagesEndRef = useRef<HTMLDivElement>(null);

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

    const loadMessages = async () => {
        try {
            setError(null);
            const dms: DirectMessage[] = await invoke("fetch_direct_messages", {
                nsec: identity.private,
                targetPubkey: targetPubkey
            });
            setMessages(dms);
        } catch (err: any) {
            setError(String(err));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadMessages();
        // Polling cada 15s para buscar nuevos DMs
        const intervalId = setInterval(loadMessages, 15000);
        return () => clearInterval(intervalId);
    }, [targetPubkey]);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const handleSend = async () => {
        if (!draft.trim() && !selectedImage) return;
        if (sending) return;
        setSending(true);
        try {
            let finalContent = draft.trim();
            if (selectedImage) {
                setUploadStatus(t('dmEncryptingFile') || "Cifrando archivo E2EE...");
                const [cid, key]: [string, string] = await invoke("upload_to_ipfs_encrypted", { filePath: selectedImage });
                finalContent += `\n\nipfs://${cid}?key=${key}`;
            }

            await invoke("send_direct_message", {
                nsec: identity.private,
                targetPubkey: targetPubkey,
                plaintext: finalContent
            });
            setDraft("");
            setSelectedImage(null);
            await loadMessages();
        } catch (err: any) {
            setError(String(err));
        } finally {
            setSending(false);
            setUploadStatus("");
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const formatTime = (ts: number) => {
        return new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    return (
        <div className="dm-drawer-overlay">
            <div className="dm-drawer">
                <header className="dm-header">
                    <div className="dm-target-info">
                        <div className="dm-avatar" style={{ backgroundColor: `#${targetPubkey.slice(5, 11)}` }}>
                            {targetPubkey.slice(5, 7).toUpperCase()}
                        </div>
                        <div>
                            <h4>{t('dmTitle') || "Chat Privado (NIP-04)"}</h4>
                            <span className="dm-pubkey">{targetPubkey.slice(0, 15)}...{targetPubkey.slice(-6)}</span>
                        </div>
                    </div>
                    <button className="icon-btn close-btn" onClick={onClose} title={t('close') || "Cerrar Chat"}>✖</button>
                </header>

                <div className="dm-messages-area">
                    {loading && messages.length === 0 ? (
                        <div className="dm-status">{t('dmDecryptingHistory') || "Descifrando historial..."}</div>
                    ) : messages.length === 0 ? (
                        <div className="dm-status empty">{t('dmEmptyState') || "No hay mensajes previos. Manda un hola encriptado."}</div>
                    ) : (
                        messages.map(msg => {
                            const isMine = msg.sender_pubkey === identity.public;
                            const match = msg.content.match(/ipfs:\/\/([a-zA-Z0-9]+)\?key=([a-zA-Z0-9\+/=]+)/);
                            const textContent = match ? msg.content.replace(match[0], '').trim() : msg.content;
                            
                            return (
                                <div key={msg.id} className={`dm-bubble-wrapper ${isMine ? 'mine' : 'theirs'}`}>
                                    <div className="dm-bubble" style={{ wordWrap: 'break-word', whiteSpace: 'pre-wrap' }}>
                                        {textContent && <MessageRenderer content={textContent} />}
                                        {match && <IpfsMediaViewerEncrypted cid={match[1]} encryptionKey={match[2]} />}
                                        <span className="dm-time">{formatTime(msg.created_at)}</span>
                                    </div>
                                </div>
                            );
                        })
                    )}
                    {error && <div className="dm-error">{error}</div>}
                    <div ref={messagesEndRef} />
                </div>

                <div className="dm-input-area" style={{ flexDirection: 'column', gap: '8px', padding: '15px' }}>
                    {uploadStatus && (
                        <div style={{ fontSize: '0.8rem', color: 'orange', textAlign: 'center' }}>⏳ {uploadStatus}</div>
                    )}
                    {selectedImage && (
                        <div style={{ fontSize: '0.8rem', color: 'var(--accent)', display: 'flex', justifyContent: 'space-between', padding: '8px 12px', backgroundColor: 'var(--bg-color)', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
                            <span style={{display: 'flex', alignItems: 'center', gap: '5px'}}>
                                <PaperclipIcon size={14} /> {selectedImage.split('\\').pop()?.split('/').pop()}
                            </span>
                            <button onClick={() => setSelectedImage(null)} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontWeight: 'bold' }}>✖</button>
                        </div>
                    )}
                    <div style={{ display: 'flex', gap: '10px', width: '100%', alignItems: 'center' }}>
                        <button
                            className="icon-btn"
                            onClick={handleAttachImage}
                            disabled={sending}
                            style={{
                                background: 'var(--panel-bg)', border: '1px solid var(--border-color)', borderRadius: '50%', width: '40px', height: '40px', color: 'var(--text-primary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
                            }}
                            title={t('dmAttachFile') || "Adjuntar Archivo Privado E2EE (Imágenes, Videos, Audio, PDF)"}
                        >
                            <PaperclipIcon size={18} color="var(--text-primary)" style={{ flexShrink: 0, minWidth: '18px' }} />
                        </button>
                        <textarea
                            value={draft}
                            onChange={e => setDraft(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder={t('dmChatPlaceholder') || "Mensaje Privado (NIP-04)..."}
                            disabled={sending}
                            rows={1}
                            style={{ flexGrow: 1, maxHeight: '120px', resize: 'none' }}
                        />
                        <button
                            className="dm-send-btn"
                            onClick={handleSend}
                            disabled={sending || (!draft.trim() && !selectedImage)}
                            title={t('send') || "Enviar"}
                            style={{ width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                        >
                            {sending ? '...' : <SendIcon size={18} color="#ffffff" style={{ flexShrink: 0, minWidth: '18px', marginLeft: '-2px' }} />}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
