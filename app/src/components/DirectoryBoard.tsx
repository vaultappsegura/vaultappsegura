/**
 * ============================================================================
 * ARCHIVO: components/DirectoryBoard.tsx
 * ============================================================================
 * PROPOSITO:
 * Libreta de Contactos (Address Book) para la fase 8.
 *
 * ARQUITECTURA PARA JUNIORS:
 * - Sirve para asociar un string (pubkey hex o npub) con un Alias personal.
 * - Incluye un boton rápido para saltar a un DM con la persona.
 * - Utiliza los comandos SQLite `save_contact`, `get_contacts` y `delete_contact`.
 * ============================================================================
 */
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { PlusIcon, MessageSquareIcon, TrashIcon } from "./Icons";
import { useT } from "../i18n/LanguageContext";

// Reutilizamos CSS compartidos si hay, o usamos directos
import "./ReportBoard.css";

interface Contact {
    id: number;
    alias: string;
    pubkey: string;
    is_following: boolean;
    is_blocked: boolean;
}

interface DirectoryBoardProps {
    onOpenDM: (pubkey: string) => void;
}

export default function DirectoryBoard({ onOpenDM }: DirectoryBoardProps) {
    const { t } = useT();
    const [contacts, setContacts] = useState<Contact[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Formulario Theming
    const [newAlias, setNewAlias] = useState("");
    const [newPubkey, setNewPubkey] = useState("");

    // Estado para edicion inline
    const [editingPubkey, setEditingPubkey] = useState<string | null>(null);
    const [editAliasForm, setEditAliasForm] = useState("");

    // Utilidades Npub a Hex basica (si mete npub, habria que parsearlo. Para el MVP aceptamos Hex o npub raw si lib.rs lo soporta, o forzamos Hex).
    // Nota: El backend `PublicKey::from_str` del SDK permite parsear npubs transparentemente a hex.

    const loadContacts = async () => {
        setLoading(true);
        try {
            const data: Contact[] = await invoke("get_contacts");
            setContacts(data);
            setError(null);
        } catch (e: any) {
            setError(String(e));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadContacts();
    }, []);

    const handleSaveContact = async () => {
        if (!newAlias.trim() || !newPubkey.trim()) return;

        try {
            await invoke("save_contact", { alias: newAlias.trim(), pubkey: newPubkey.trim() });
            setNewAlias("");
            setNewPubkey("");
            loadContacts();
        } catch (e: any) {
            alert(`${t('saveContactError') || "Error al guardar contacto:"} ${e}`);
        }
    };

    const handleDeleteContact = async (pubkey: string) => {
        if (!confirm(t('deleteContactConfirm') || "¿Seguro que deseas eliminar este contacto de tu libreta privada?")) return;
        try {
            await invoke("delete_contact", { pubkey });
            loadContacts();
        } catch (e: any) {
            alert(`${t('deleteContactError') || "Error al eliminar contacto:"} ${e}`);
        }
    };

    const handleToggleFollow = async (pubkey: string) => {
        try {
            await invoke("toggle_follow", { pubkey });
            loadContacts();
        } catch (e: any) {
            alert(`${t('toggleFollowError') || "Error alternando seguimiento:"} ${e}`);
        }
    };

    const handleToggleBlock = async (pubkey: string) => {
        try {
            await invoke("toggle_block", { pubkey });
            loadContacts();
        } catch (e: any) {
            alert(`${t('toggleBlockError') || "Error alternando bloqueo:"} ${e}`);
        }
    };

    const handleRenameContact = async (pubkey: string) => {
        if (!editAliasForm.trim()) return;
        try {
            await invoke("save_contact", { alias: editAliasForm.trim(), pubkey });
            setEditingPubkey(null);
            loadContacts();
        } catch (e: any) {
            alert(`${t('renameContactError') || "Error al renombrar contacto:"} ${e}`);
        }
    };

    const generateAvatar = (pubkey: string) => {
        // En caso de meter npub, usamos los ultimos hex chars
        const keyExtracted = pubkey.length > 20 ? pubkey.slice(pubkey.length - 15) : pubkey;
        let pColor = "111111";
        if (/[0-9a-f]/i.test(keyExtracted.substring(0, 6))) {
            pColor = keyExtracted.substring(0, 6);
        }
        return (
            <div className="avatar" style={{ backgroundColor: `#${pColor}` }}>
                {pubkey.startsWith("npub") ? keyExtracted.slice(0, 2).toUpperCase() : pubkey.slice(0, 2).toUpperCase()}
            </div>
        );
    };

    return (
        <div className="card" style={{ padding: '30px' }}>
            <h2 style={{ textAlign: 'center', marginBottom: '20px', color: 'var(--text-color)' }}>{t('directoryTitle') || "Directorio Privado"}</h2>

            <div style={{ backgroundColor: 'var(--bg-color)', padding: '20px', borderRadius: '12px', marginBottom: '20px', border: '1px solid var(--border-color)' }}>
                <h3 style={{ marginTop: 0, fontSize: '1.1rem', color: 'var(--text-color)' }}>{t('addContact') || "Añadir Contacto"}</h3>
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                    <input
                        type="text"
                        placeholder={t('contactAliasPlaceholder') || "Alias (Ej. Contacto Secreto)"}
                        value={newAlias}
                        onChange={(e) => setNewAlias(e.target.value)}
                        style={{ flex: 1, minWidth: '150px', padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--border-color)', backgroundColor: 'var(--card-bg)', color: 'var(--text-color)' }}
                    />
                    <input
                        type="text"
                        placeholder={t('contactPubkeyPlaceholder') || "Nostr Public Key (Hex o npub)"}
                        value={newPubkey}
                        onChange={(e) => setNewPubkey(e.target.value)}
                        style={{ flex: 2, minWidth: '200px', padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--border-color)', backgroundColor: 'var(--card-bg)', color: 'var(--text-color)' }}
                    />
                    <button
                        className="primary-btn"
                        onClick={handleSaveContact}
                        disabled={!newAlias.trim() || !newPubkey.trim()}
                        style={{ padding: '0 20px', fontWeight: 'bold' }}
                    >
                        <PlusIcon size={16} style={{ marginRight: '5px' }} /> {t('saveBtn') || "Guardar"}
                    </button>
                </div>
            </div>

            {error && <div style={{ color: 'var(--error-color)', padding: '10px', textAlign: 'center' }}>{t('error') || "Error"}: {error}</div>}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {loading ? (
                    <div style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '20px' }}>{t('loadingDirectory') || "Cargando libreta de direcciones..."}</div>
                ) : contacts.length === 0 ? (
                    <div style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '30px', fontStyle: 'italic' }}>
                        {t('noContacts') || "No tienes contactos guardados todavía."}
                    </div>
                ) : (
                    contacts.map(contact => (
                        <div key={contact.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '15px', backgroundColor: 'var(--bg-color)', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '15px', overflow: 'hidden' }}>
                                {generateAvatar(contact.pubkey)}
                                <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                                    {editingPubkey === contact.pubkey ? (
                                        <div style={{ display: 'flex', gap: '5px' }}>
                                            <input 
                                                autoFocus
                                                type="text" 
                                                value={editAliasForm} 
                                                onChange={(e) => setEditAliasForm(e.target.value)} 
                                                onKeyDown={(e) => { if (e.key === 'Enter') handleRenameContact(contact.pubkey); else if (e.key === 'Escape') setEditingPubkey(null); }}
                                                style={{ padding: '2px 6px', borderRadius: '4px', border: '1px solid var(--primary-color)', backgroundColor: 'var(--panel-input-bg)', color: 'var(--text-color)', fontSize: '0.9rem', width: '140px' }}
                                            />
                                            <button onClick={() => handleRenameContact(contact.pubkey)} style={{ background: 'none', border: 'none', color: '#22c55e', cursor: 'pointer' }}>✓</button>
                                            <button onClick={() => setEditingPubkey(null)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}>✕</button>
                                        </div>
                                    ) : (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <span style={{ fontWeight: 600, color: 'var(--text-color)', fontSize: '1.05rem', textOverflow: 'ellipsis', whiteSpace: 'nowrap', overflow: 'hidden' }}>
                                                {contact.alias}
                                            </span>
                                            <button className="icon-btn" onClick={() => { setEditingPubkey(contact.pubkey); setEditAliasForm(contact.alias); }} title={t('editAlias') || "Renombrar Contacto"} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', opacity: 0.6, padding: '2px' }}>
                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                                            </button>
                                        </div>
                                    )}
                                    <span style={{ fontFamily: 'monospace', color: 'var(--primary-color)', fontSize: '0.8rem', textOverflow: 'ellipsis', whiteSpace: 'nowrap', overflow: 'hidden' }} title={contact.pubkey}>
                                        {contact.pubkey.length > 30 ? `${contact.pubkey.slice(0, 15)}...${contact.pubkey.slice(-10)}` : contact.pubkey}
                                    </span>
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                                <button
                                    className="icon-btn"
                                    onClick={() => handleToggleFollow(contact.pubkey)}
                                    title={contact.is_following ? (t('unfollow') || "Dejar de seguir") : (t('follow') || "Seguir")}
                                    style={{ background: 'none', border: '1px solid var(--border-color)', borderRadius: '6px', cursor: 'pointer', padding: '6px', display: 'flex', alignItems: 'center', opacity: contact.is_following ? 1 : 0.4 }}
                                >
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill={contact.is_following ? '#eab308' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#eab308' }}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                                </button>
                                <button
                                    className="icon-btn"
                                    onClick={() => handleToggleBlock(contact.pubkey)}
                                    title={contact.is_blocked ? (t('unblock') || "Desbloquear") : (t('block') || "Bloquear")}
                                    style={{ background: 'none', border: '1px solid var(--border-color)', borderRadius: '6px', cursor: 'pointer', padding: '6px', display: 'flex', alignItems: 'center', opacity: contact.is_blocked ? 1 : 0.4 }}
                                >
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill={contact.is_blocked ? '#ef4444' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#ef4444' }}><circle cx="12" cy="12" r="10"></circle><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line></svg>
                                </button>
                                <button
                                    className="primary-btn"
                                    style={{ padding: '6px 12px', fontSize: '0.9rem', backgroundColor: '#3b82f6' }}
                                    onClick={() => onOpenDM(contact.pubkey)}
                                    title={t('openPrivateChat') || "Abrir Chat Privado Cifrado"}
                                >
                                    <MessageSquareIcon size={16} />
                                </button>
                                <button
                                    className="danger-btn"
                                    style={{ padding: '6px 12px', fontSize: '0.9rem' }}
                                    onClick={() => handleDeleteContact(contact.pubkey)}
                                    title={t('removeFromDirectory') || "Eliminar de la Libreta"}
                                >
                                    <TrashIcon size={16} />
                                </button>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
