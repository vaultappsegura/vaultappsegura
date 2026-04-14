/**
 * ============================================================================
 * ARCHIVO: SettingsPanel.tsx
 * ============================================================================
 * PROPOSITO:
 * Panel de configuracion del usuario.
 * Permite ajustar opciones de seguridad, anonimato y UX:
 * - Tema Visual (Claro/Oscuro)
 * - Auto-destruccion de sesion por inactividad
 * - Gestion de Relays (Nostr)
 * - Proof of Work por defecto
 * 
 * Todo se guarda en la SQLite de Rust usando `save_setting`.
 * ============================================================================
 */
import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import QRCode from "react-qr-code";
import { useT } from "../i18n/LanguageContext";
import { LANG_LABELS, type Lang } from "../i18n/locales";
import "./SettingsPanel.css";

interface SettingsPanelProps {
    onClose: () => void;
    currentTheme: 'dark' | 'light';
    onThemeChange: (theme: 'dark' | 'light') => void;
    currentTimeout: number;
    onTimeoutChange: (minutes: number) => void;
}

function CustomSelect({ value, options, onChange }: { value: string | number, options: { value: string | number, label: string }[], onChange: (val: any) => void }) {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const selectedOption = options.find(o => o.value == value);

    return (
        <div className="custom-select-container" ref={containerRef}>
            <div className={`custom-select-button ${isOpen ? 'open' : ''}`} onClick={() => setIsOpen(!isOpen)}>
                {selectedOption?.label || value}
            </div>
            {isOpen && (
                <div className="custom-select-dropdown">
                    {options.map(opt => (
                        <div 
                            key={opt.value} 
                            className={`custom-select-option ${opt.value == value ? 'selected' : ''}`}
                            onClick={() => {
                                onChange(opt.value);
                                setIsOpen(false);
                            }}
                        >
                            {opt.label}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export default function SettingsPanel({ onClose, currentTheme, onThemeChange, currentTimeout, onTimeoutChange }: SettingsPanelProps) {
    const [theme, setTheme] = useState<'dark' | 'light'>(currentTheme);
    const { t, lang, setLang } = useT();
    const [timeoutMinutes, setTimeoutMinutes] = useState(currentTimeout);
    const [defaultPow, setDefaultPow] = useState(0);
    const [relays, setRelays] = useState<string[]>([]);
    const [newRelay, setNewRelay] = useState("");
    const [showRelayInfo, setShowRelayInfo] = useState(false);

    // Estados para Seguridad
    const [currentPassword, setCurrentPassword] = useState("");
    const [newMasterPassword, setNewMasterPassword] = useState("");
    const [confirmMasterPassword, setConfirmMasterPassword] = useState("");
    const [newPanicPassword, setNewPanicPassword] = useState("");

    const [loading, setLoading] = useState(true);
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

    // Estados para Auditoria de Llaves
    interface IdentityRecord { id: number; alias: string; pubkey: string; }
    const [identities, setIdentities] = useState<IdentityRecord[]>([]);
    const [qrModal, setQrModal] = useState<{ open: boolean; id: number; alias: string; nsec: string | null; password: string; loading: boolean; error: string | null } >({ open: false, id: 0, alias: '', nsec: null, password: '', loading: false, error: null });
    const [importForm, setImportForm] = useState({ alias: '', nsec: '', password: '', loading: false });

    function showToast(message: string, type: 'success' | 'error') {
        setToast({ message, type });
        setTimeout(() => setToast(null), 3000);
    }

    // Cargar configuraciones al montar
    useEffect(() => {
        async function loadSettings() {
            setLoading(true);
            try {
                // Cargar PoW
                const powStr: string = await invoke("get_setting", { key: "default_pow", defaultValue: "0" });
                setDefaultPow(Number(powStr));

                // Cargar Relays
                const relaysStr: string = await invoke("get_setting", { key: "custom_relays", defaultValue: "wss://relay.damus.io,wss://nos.lol" });
                setRelays(relaysStr.split(",").filter(r => r.trim() !== ""));

                // Cargar Identidades
                const ids: IdentityRecord[] = await invoke("get_saved_identities");
                setIdentities(ids);

            } catch (err) {
                console.error("Error cargando ajustes", err);
                showToast("No se pudieron cargar los ajustes", "error");
            } finally {
                setLoading(false);
            }
        }
        loadSettings();
    }, []);

    // Guardar Tema Visual
    async function handleThemeChange(t: 'dark' | 'light') {
        setTheme(t);
        onThemeChange(t); // Llama al callback de App.tsx para aplicarlo
        try {
            await invoke("save_setting", { key: "theme", value: t });
        } catch (err) {
            console.error(err);
        }
    }

    // Guardar Auto-destruccion
    async function handleTimeoutChange(m: number) {
        setTimeoutMinutes(m);
        onTimeoutChange(m); // Llama al callback de App.tsx
        try {
            await invoke("save_setting", { key: "auto_logout_minutes", value: m.toString() });
        } catch (err) {
            console.error(err);
        }
    }

    // Guardar Proof of Work
    async function handlePowChange(p: number) {
        setDefaultPow(p);
        try {
            await invoke("save_setting", { key: "default_pow", value: p.toString() });
            showToast("PoW por defecto actualizado", "success");
        } catch (err) {
            showToast("Error al guardar PoW", "error");
        }
    }

    // Gestion de Relays
    async function handleAddRelay() {
        if (!newRelay.trim() || !newRelay.startsWith("wss://")) {
            showToast("El relay debe empezar con wss://", "error");
            return;
        }
        if (relays.includes(newRelay.trim())) {
            showToast("El relay ya existe", "error");
            return;
        }

        const updated = [...relays, newRelay.trim()];
        setRelays(updated);
        setNewRelay("");
        await saveRelays(updated);
    }

    async function handleRemoveRelay(relay: string) {
        if (relays.length <= 1) {
            showToast("Debes tener al menos 1 relay", "error");
            return;
        }
        const updated = relays.filter(r => r !== relay);
        setRelays(updated);
        await saveRelays(updated);
    }

    async function saveRelays(rList: string[]) {
        try {
            await invoke("save_setting", { key: "custom_relays", value: rList.join(",") });
            showToast("Relays actualizados. Reinicia la app para aplicar.", "success");
        } catch (err) {
            showToast("Error al guardar relays", "error");
        }
    }

    // Gestion de Seguridad - Cambio de Contrasena Maestra
    async function handleChangeMasterPassword() {
        if (!currentPassword) {
            showToast("Debes ingresar tu contraseña actual", "error");
            return;
        }
        if (!newMasterPassword || newMasterPassword !== confirmMasterPassword) {
            showToast("Las nuevas contraseñas no coinciden", "error");
            return;
        }

        try {
            // Se invoca el cambio. ATENCION: Aqui esta la trampa de panico.
            await invoke("change_master_password_cmd", {
                currentMaster: currentPassword,
                newMaster: newMasterPassword
            });
            showToast("Contraseña maestra actualizada con éxito", "success");
            setCurrentPassword("");
            setNewMasterPassword("");
            setConfirmMasterPassword("");
        } catch (err: any) {
            if (err === "WIPED" || (err.includes && err.includes("WIPED"))) {
                // TRAMPA DETONADA (Metio la clave de panico en el campo old password)
                // Se borró todo en Rust. Mostramos error falso o simplemente recargamos
                showToast("Error critico del sistema. Reiniciando Bóveda...", "error");
                setTimeout(() => window.location.reload(), 2000);
            } else {
                showToast(`Error: ${err}`, "error");
            }
        }
    }

    // Gestion de Seguridad - Contrasena de Panico
    async function handleSetPanicPassword() {
        if (!currentPassword) {
            showToast("Ingresa tu contraseña actual maestra para autorizar esto", "error");
            return;
        }
        if (!newPanicPassword) {
            showToast("Debes ingresar una contraseña de pánico", "error");
            return;
        }
        try {
            await invoke("change_panic_password_cmd", {
                currentMaster: currentPassword,
                newPanic: newPanicPassword
            });
            showToast("Código de Pánico configurado con éxito", "success");
            setNewPanicPassword("");
            setCurrentPassword(""); // Limpiamos por seguridad
        } catch (err: any) {
            if (err === "WIPED" || (err.includes && err.includes("WIPED"))) {
                window.location.reload();
            } else {
                showToast(`Error: ${err}`, "error");
            }
        }
    }

    // Auditoria: Solicitar nsec descifrado y abrir QR
    async function handleRevealNsec() {
        setQrModal(m => ({ ...m, loading: true, error: null }));
        try {
            const nsec: string = await invoke("get_identity_secret", { id: qrModal.id, password: qrModal.password });
            setQrModal(m => ({ ...m, nsec, loading: false }));
        } catch (err) {
            setQrModal(m => ({ ...m, loading: false, error: String(err) }));
        }
    }

    // Auditoria: Importar identidad externa (nsec manual)
    async function handleImportIdentity() {
        if (!importForm.alias.trim() || !importForm.nsec.trim() || !importForm.password.trim()) {
            showToast("Alias, nsec y contraseña son obligatorios", "error");
            return;
        }
        setImportForm(f => ({ ...f, loading: true }));
        try {
            await invoke("import_identity", { alias: importForm.alias.trim(), nsec: importForm.nsec.trim(), password: importForm.password });
            showToast("Identidad importada con éxito", "success");
            setImportForm({ alias: '', nsec: '', password: '', loading: false });
            const ids: IdentityRecord[] = await invoke("get_saved_identities");
            setIdentities(ids);
        } catch (err) {
            showToast(String(err), "error");
            setImportForm(f => ({ ...f, loading: false }));
        }
    }

    if (loading) return <div className="settings-panel"><div className="loading-state">{t('loadingSettings')}</div></div>;

    return (
        <>
            <div className="settings-panel">
                {toast && (
                    <div className={`toast toast-${toast.type}`}>
                        {toast.message}
                    </div>
                )}

                <div className="settings-header">
                    <h2>{t('settingsTitle')}</h2>
                    <button className="icon-btn close-btn" onClick={onClose} title="Cerrar">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
                    </button>
                </div>

                <div className="settings-content">

                <section className="settings-section">
                    <h3>🌐 {t('languageTitle')}</h3>
                    <p className="setting-desc">{t('languageDesc')}</p>
                    <CustomSelect 
                        value={lang}
                        options={(Object.keys(LANG_LABELS) as Lang[]).map(code => ({ value: code, label: LANG_LABELS[code] }))}
                        onChange={(val) => setLang(val as Lang)}
                    />
                </section>
                <hr className="settings-divider" />

                <section className="settings-section">
                    <h3>{t('appearance')}</h3>
                    <p className="setting-desc">{t('themeDesc')}</p>
                    <div className="radio-group">
                        <label className={theme === 'dark' ? 'active' : ''}>
                            <input type="radio" name="theme" value="dark" checked={theme === 'dark'} onChange={() => handleThemeChange('dark')} />
                            {t('themeDark')}
                        </label>
                        <label className={theme === 'light' ? 'active' : ''}>
                            <input type="radio" name="theme" value="light" checked={theme === 'light'} onChange={() => handleThemeChange('light')} />
                            {t('themeLight')}
                        </label>
                    </div>
                </section>

                <hr className="settings-divider" />

                <section className="settings-section">
                    <h3>Auto-Lock</h3>
                    <p className="setting-desc">{t('lockDesc')}</p>
                    <CustomSelect 
                        value={timeoutMinutes}
                        options={[
                            { value: 0, label: t('all') + ' / OFF' },
                            { value: 1, label: '1 min' },
                            { value: 5, label: '5 min' },
                            { value: 15, label: '15 min' },
                            { value: 30, label: '30 min' },
                        ]}
                        onChange={val => handleTimeoutChange(Number(val))}
                    />
                </section>

                <hr className="settings-divider" />

                <section className="settings-section">
                    <h3>{t('powTitle')}</h3>
                    <p className="setting-desc">{t('powDesc')}</p>
                    <CustomSelect 
                        value={defaultPow}
                        options={[
                            { value: 0, label: 'PoW 0 (Fast)' },
                            { value: 10, label: 'PoW 10' },
                            { value: 16, label: 'PoW 16 ✓' },
                            { value: 20, label: 'PoW 20 (Slow)' },
                        ]}
                        onChange={val => handlePowChange(Number(val))}
                    />
                </section>

                <hr className="settings-divider" />

                {/* === KEY AUDIT === */}
                <section className="settings-section">
                    <h3 style={{ color: 'var(--accent-color, #8b5cf6)' }}>{t('keyAuditTitle')}</h3>
                    <p className="setting-desc">{t('keyAuditDesc')}</p>

                    <div style={{ marginBottom: '1rem' }}>
                        <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem' }}>{t('savedIdentities')}</h4>
                        {identities.length === 0 ? (
                            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t('noIdentities')}</p>
                        ) : (
                            identities.map(id => (
                                <div key={id.id} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', padding: '8px 12px', background: 'var(--bg-color)', borderRadius: '8px', marginBottom: '6px', border: '1px solid var(--border-color)' }}>
                                    <div style={{ flex: 1, overflow: 'hidden' }}>
                                        <div style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>{id.alias}</div>
                                        <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{id.pubkey}</div>
                                    </div>
                                    <button
                                        className="secondary-btn"
                                        style={{ flexShrink: 0, padding: '5px 12px', fontSize: '0.8rem' }}
                                        onClick={() => setQrModal({ open: true, id: id.id, alias: id.alias, nsec: null, password: '', loading: false, error: null })}
                                    >
                                        {t('exportQR')}
                                    </button>
                                </div>
                            ))
                        )}
                    </div>

                    <hr style={{ opacity: 0.3, margin: '1rem 0' }} />

                    <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem' }}>{t('importExternal')}</h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        <input type="text" placeholder={t('importAlias')} value={importForm.alias} onChange={e => setImportForm(f => ({ ...f, alias: e.target.value }))} />
                        <input type="text" placeholder={t('importNsec')} value={importForm.nsec} onChange={e => setImportForm(f => ({ ...f, nsec: e.target.value }))} style={{ fontFamily: 'monospace', fontSize: '0.8rem' }} />
                        <input type="password" placeholder={t('masterPwdPlaceholder')} autoComplete="current-password" value={importForm.password} onChange={e => setImportForm(f => ({ ...f, password: e.target.value }))} />
                        <button className="primary-btn" disabled={importForm.loading} onClick={handleImportIdentity} style={{ alignSelf: 'flex-start' }}>
                            {importForm.loading ? t('encrypting') : t('importAndSave')}
                        </button>
                    </div>
                </section>

                <hr className="settings-divider" />

                <section className="settings-section">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                        <h3 style={{ margin: 0 }}>{t('relaysTitle')}</h3>
                        <button
                            className="icon-btn"
                            onClick={() => setShowRelayInfo(!showRelayInfo)}
                            title="Help"
                            style={{ fontSize: "0.9rem", color: "var(--panel-accent)", padding: "0.3rem 0.6rem", borderRadius: "6px", border: "1px solid var(--panel-accent)" }}
                        >
                            {showRelayInfo ? "▲ Info" : "▼ Info"}
                        </button>
                    </div>
                    <p className="setting-desc">{t('relaysDesc')}</p>

                    {showRelayInfo && (
                        <div className="relay-info-box">
                            <h4>🛡️ Nostr Relays</h4>
                            <p>Relays are public broadcast nodes. Your reports are sent as encrypted copies to multiple relays simultaneously.</p>
                            <ul>
                                <li><strong>Anti-Censorship:</strong> If one relay goes down, others keep working.</li>
                                <li><strong>Format:</strong> Relay URLs start with <code>wss://</code></li>
                                <li><strong>Privacy:</strong> Relay operators cannot identify you — only anonymous ciphertext.</li>
                            </ul>
                        </div>
                    )}

                    <div className="relay-list">
                        {relays.map(r => (
                            <div key={r} className="relay-item">
                                <span>{r}</span>
                                <button className="danger-btn-small" onClick={() => handleRemoveRelay(r)}>{t('removeRelay')}</button>
                            </div>
                        ))}
                    </div>
                    <div className="add-relay-form">
                        <input
                            type="text"
                            placeholder="wss://relay.example.com"
                            value={newRelay}
                            onChange={e => setNewRelay(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') handleAddRelay() }}
                        />
                        <button className="secondary-btn" onClick={handleAddRelay}>{t('addRelay')}</button>
                    </div>
                </section>

                <hr className="settings-divider" />

                <section className="settings-section">
                    <h3 style={{ color: "#ef4444" }}>{t('securityTitle')}</h3>
                    <p className="setting-desc">{t('masterPwdTitle')}</p>

                    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "1rem" }}>
                        <input
                            type="password"
                            placeholder={t('currentPwd')}
                            autoComplete="off"
                            value={currentPassword}
                            onChange={e => setCurrentPassword(e.target.value)}
                        />
                        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                            <input
                                type="password"
                                placeholder={t('newPwd')}
                                autoComplete="new-password"
                                value={newMasterPassword}
                                onChange={e => setNewMasterPassword(e.target.value)}
                                style={{ flex: 1 }}
                            />
                            <input
                                type="password"
                                placeholder={t('newPwd') + ' ✓'}
                                autoComplete="new-password"
                                value={confirmMasterPassword}
                                onChange={e => setConfirmMasterPassword(e.target.value)}
                                style={{ flex: 1 }}
                            />
                        </div>
                        <button className="primary-btn" onClick={handleChangeMasterPassword} style={{ alignSelf: "flex-start", marginTop: "0.5rem" }}>
                            {t('changeMasterPwd')}
                        </button>
                    </div>

                    <div style={{ padding: "1rem", border: "1px dashed #ef4444", borderRadius: "8px", background: "rgba(239, 68, 68, 0.05)" }}>
                        <h4 style={{ margin: "0 0 0.5rem 0", color: "#ef4444" }}>{t('panicTitle')}</h4>
                        <p style={{ margin: "0 0 0.5rem 0", fontSize: "0.85rem" }}>{t('panicDesc')}</p>
                        <div style={{ display: "flex", gap: "0.5rem" }}>
                            <input
                                type="password"
                                placeholder={t('panicPwdPlaceholder')}
                                value={newPanicPassword}
                                autoComplete="new-password"
                                onChange={e => setNewPanicPassword(e.target.value)}
                                style={{ flex: 1 }}
                            />
                            <button className="danger-btn" onClick={handleSetPanicPassword}>
                                {t('savePanic')}
                            </button>
                        </div>
                    </div>
                </section>

            </div>
        </div>
        {/* === MODAL QR: EXPORTAR LLAVE PRIVADA === */}
        {qrModal.open && (
            <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.9)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 9999, padding: '20px' }}>
                <div style={{ background: 'var(--panel-bg)', borderRadius: '16px', padding: '28px', maxWidth: '420px', width: '100%', boxShadow: '0 20px 40px rgba(0,0,0,0.6)', border: '1px solid var(--border-color)' }}>
                    <h3 style={{ marginTop: 0, color: 'var(--accent-color, #8b5cf6)', display: 'flex', alignItems: 'center', gap: '10px' }}>
                        {t('auditTitle')}: <span style={{ color: 'var(--text-color)' }}>{qrModal.alias}</span>
                    </h3>

                    {!qrModal.nsec ? (
                        <>
                            <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '15px' }}>
                                {t('unlockToExportDesc')}
                            </p>
                            {qrModal.error && <div style={{ padding: '8px 12px', background: 'rgba(239,68,68,0.1)', border: '1px solid #ef4444', borderRadius: '8px', marginBottom: '12px', fontSize: '0.85rem', color: '#ef4444' }}>{qrModal.error}</div>}
                            <input
                                type="password"
                                placeholder={t('masterPwdPlaceholder')}
                                autoFocus
                                value={qrModal.password}
                                onChange={e => setQrModal(m => ({ ...m, password: e.target.value }))}
                                onKeyDown={e => { if (e.key === 'Enter') handleRevealNsec(); }}
                                style={{ width: '100%', marginBottom: '12px', boxSizing: 'border-box' }}
                            />
                            <div style={{ display: 'flex', gap: '10px' }}>
                                <button className="primary-btn" style={{ flex: 1 }} disabled={qrModal.loading || !qrModal.password} onClick={handleRevealNsec}>
                                    {qrModal.loading ? t('verifying') : t('unlockToExport')}
                                </button>
                                <button className="secondary-btn" onClick={() => setQrModal(m => ({ ...m, open: false, nsec: null, password: '' }))}>
                                    {t('cancel')}
                                </button>
                            </div>
                        </>
                    ) : (
                        <>
                            <div style={{ background: 'white', padding: '18px', borderRadius: '12px', display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
                                <QRCode value={qrModal.nsec ?? ''} size={220} />
                            </div>

                            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '8px', textAlign: 'center' }}>
                                Amethyst · Damus · Nostr
                            </p>

                            <div style={{ background: 'var(--bg-color)', borderRadius: '6px', padding: '8px 12px', fontFamily: 'monospace', fontSize: '0.7rem', wordBreak: 'break-all', color: 'var(--text-secondary)', border: '1px dashed var(--border-color)', marginBottom: '16px' }}>
                                {qrModal.nsec}
                            </div>

                            <div style={{ padding: '10px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', fontSize: '0.8rem', color: '#ef4444', marginBottom: '16px' }}>
                                ⚠️ {t('nsecWarning')}
                            </div>

                            <button className="danger-btn" style={{ width: '100%' }} onClick={() => setQrModal({ open: false, id: 0, alias: '', nsec: null, password: '', loading: false, error: null })}>
                                {t('closeAndWipe')}
                            </button>
                        </>
                    )}
                </div>
            </div>
        )}
        </>
    );
}
