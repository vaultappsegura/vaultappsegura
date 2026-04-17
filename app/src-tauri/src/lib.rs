/**
 * ============================================================================
 * ARCHIVO: lib.rs (Backend principal de Tauri en Rust)
 * ============================================================================
 * PROPOSITO: 
 * Este archivo es el corazon de la aplicacion de escritorio. Conecta la interfaz
 * grafica (React) con el sistema operativo y las redes P2P (Nostr, Tor, IPFS).
 * 
 * ARQUITECTURA PARA JUNIORS:
 * - Tauri utiliza comandos (anotados con `#[tauri::command]`) que actuan como 
 *   una API local. El frontend (React) invoca estos comandos pasandoles datos.
 * - Este archivo inicializa dos "Sidecars" (programas secundarios que corren 
 *   junto a nuestra app): Tor (para ocultar nuestra IP) e IPFS (Kubo, para 
 *   guardar fotos anonimamente).
 * - Nostr: Usamos la libreria `nostr-sdk` para generar llaves criptograficas, 
 *   firmar mensajes y enviarlos a servidores Relay publicos.
 * 
 * EFECTOS SECUNDARIOS GLOBALES:
 * Al iniciar la app, este codigo crea procesos en tu computadora (Tor e IPFS) 
 * consumiendo RAM/CPU en segundo plano y escribiendo configuraciones en tu disco.
 * ============================================================================
 */

use nostr_sdk::prelude::*;
use nostr::nips::nip13;
use nostr::nips::nip25::ReactionTarget;
use std::sync::{Arc, Mutex};
use std::str::FromStr;
use std::path::PathBuf;
use std::fs;
use tauri::Manager;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandChild;

mod crypto;
mod db;

// === CONSTANTES ===

/// Dificultad PoW para publicar (16 bits = ~1-2s de calculo)
const POW_DIFFICULTY: u8 = 16;
/// PoW minimo para mostrar en feed
const MIN_POW_DISPLAY: u8 = 0;
/// Puerto API de Kubo (aislado para no colisionar con IPFS Desktop)
const IPFS_API_PORT: u16 = 51234;
/// Puerto Gateway de Kubo
const IPFS_GATEWAY_PORT: u16 = 48080;
/// Puerto Swarm de Kubo 
const IPFS_SWARM_PORT: u16 = 41234;
/// Tamanio maximo de archivo para subir (10MB)
const MAX_FILE_SIZE: u64 = 50 * 1024 * 1024;

// === ESTADO GLOBAL ===

struct TorState {
    #[cfg(not(target_os = "android"))]
    child: Mutex<Option<CommandChild>>,
    
    // Almacenamos el puerto local SOCKS5 asignado dinámicamente
    socks_port: Mutex<Option<u16>>,
}

struct IpfsState {
    child: Mutex<Option<CommandChild>>,
    ready: Arc<Mutex<bool>>,
    repo_path: Mutex<String>,
}

// === STRUCTS ===

#[derive(serde::Serialize)]
struct Report {
    id: String,
    pubkey: String,
    content: String,
    created_at: u64,
    pow: u8,
    reactions_up: i32,
    reactions_down: i32,
    reply_to: Option<String>,
}

#[derive(serde::Serialize)]
struct DirectMessage {
    id: String,
    sender_pubkey: String,
    recipient_pubkey: String,
    content: String,
    created_at: u64,
}

#[derive(serde::Serialize)]
struct Channel {
    id: String,
    pubkey: String,
    name: String,
    about: String,
    picture: String,
    created_at: u64,
}

// === FUNCIONES AUXILIARES ===

fn default_tor_proxy() -> Option<std::net::SocketAddr> {
    use std::net::TcpStream;
    let candidates = ["127.0.0.1:9050", "127.0.0.1:9150"];
    for addr_str in &candidates {
        if let Ok(addr) = addr_str.parse::<std::net::SocketAddr>() {
            if TcpStream::connect_timeout(&addr, std::time::Duration::from_millis(500)).is_ok() {
                return Some(addr);
            }
        }
    }
    None
}

// Para obtener el puerto dinámico de Arti desde Tauri guardado previamente.
// Como no pasamos el estado a nostr_client() de forma directa ahora, usamos una variable estática para Android,
// o si detect_tor_proxy requiere acceso, lo mejor es hacerlo como un lazy_static o un state.
// Por simplicidad, leeremos de un flag estático o confiaremos en pasar el state.
lazy_static::lazy_static! {
    static ref GLOBAL_ARTI_SOCKS_PORT: Mutex<Option<u16>> = Mutex::new(None);
}

async fn detect_tor_proxy() -> Option<std::net::SocketAddr> {
    #[cfg(target_os = "android")]
    {
        // Tor bootstrapping usually takes 5-15 seconds. Don't fall back immediately.
        for _ in 0..30 {
            if let Some(port) = *GLOBAL_ARTI_SOCKS_PORT.lock().unwrap() {
                let addr = format!("127.0.0.1:{}", port).parse::<std::net::SocketAddr>().unwrap();
                return Some(addr);
            }
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        }
    }
    default_tor_proxy()
}

async fn build_nostr_client(keys: Keys) -> (Client, bool) {
    if let Some(proxy) = detect_tor_proxy().await {
        let conn = nostr_sdk::client::Connection::new().proxy(proxy);
        let opts = nostr_sdk::ClientOptions::new().connection(conn);
        let client = Client::builder().signer(keys).opts(opts).build();
        (client, true)
    } else {
        let client = Client::new(keys);
        (client, false)
    }
}

async fn connect_client(client: &Client, using_tor: bool, relays_setting: &str) {
    let relays_list: Vec<&str> = relays_setting.split(',').filter(|r| !r.trim().is_empty()).collect();
    
    if relays_list.is_empty() {
        // Fallback a defecto si algo sale mal
        client.add_relay("wss://relay.damus.io").await.ok();
        client.add_relay("wss://nos.lol").await.ok();
    } else {
        for url in relays_list {
            client.add_relay(url.trim()).await.ok();
        }
    }

    client.connect().await;
    let wait_secs = if using_tor { 10 } else { 5 };
    client.wait_for_connection(std::time::Duration::from_secs(wait_secs)).await;
}

/// Aplica configuracion segura al config json generado por Kubo
fn apply_secure_ipfs_config(config_path: &PathBuf) -> Result<(), String> {
    let config_str = fs::read_to_string(config_path).map_err(|e| e.to_string())?;
    let mut config: serde_json::Value = serde_json::from_str(&config_str).map_err(|e| e.to_string())?;

    macro_rules! set_json {
        ($obj:expr, $( $key:expr ),+ => $val:expr) => {
            let mut current = &mut $obj;
            let keys = [ $( $key ),+ ];
            for i in 0..keys.len() - 1 {
                if !current[keys[i]].is_object() {
                    current[keys[i]] = serde_json::json!({});
                }
                current = &mut current[keys[i]];
            }
            current[keys[keys.len() - 1]] = $val;
        };
    }

    // Bindings de puertos seguros (local)
    set_json!(config, "Addresses", "Swarm" => serde_json::json!([format!("/ip4/127.0.0.1/tcp/{}", IPFS_SWARM_PORT)]));
    set_json!(config, "Addresses", "API" => serde_json::json!(format!("/ip4/127.0.0.1/tcp/{}", IPFS_API_PORT)));
    set_json!(config, "Addresses", "Gateway" => serde_json::json!(format!("/ip4/127.0.0.1/tcp/{}", IPFS_GATEWAY_PORT)));

    // Filtros de red local (NoAnnounce)
    let no_announce = serde_json::json!([
        "/ip4/10.0.0.0/ipcidr/8", "/ip4/100.64.0.0/ipcidr/10", "/ip4/169.254.0.0/ipcidr/16",
        "/ip4/172.16.0.0/ipcidr/12", "/ip4/192.0.0.0/ipcidr/24", "/ip4/192.168.0.0/ipcidr/16",
        "/ip6/fc00::/ipcidr/7"
    ]);
    set_json!(config, "Addresses", "NoAnnounce" => no_announce);

    // Optimizacion de transporte
    set_json!(config, "Swarm", "Transports", "Network", "QUIC" => serde_json::json!(false));
    set_json!(config, "Swarm", "Transports", "Network", "WebTransport" => serde_json::json!(false));
    set_json!(config, "Swarm", "Transports", "Network", "TCP" => serde_json::json!(true));
    
    set_json!(config, "Swarm", "ConnMgr", "LowWater" => serde_json::json!(20));
    set_json!(config, "Swarm", "ConnMgr", "HighWater" => serde_json::json!(40));

    // Privacidad
    set_json!(config, "Discovery", "MDNS", "Enabled" => serde_json::json!(false));
    set_json!(config, "Routing", "Type" => serde_json::json!("dhtclient"));

    // Limites de almacenamiento (manteniendo Datastore.Spec intacto)
    set_json!(config, "Datastore", "StorageMax" => serde_json::json!("500MB"));
    set_json!(config, "Datastore", "GCPeriod" => serde_json::json!("1h"));

    // CORS para llamadas desde Tauri
    let cors = serde_json::json!(["http://127.0.0.1", "http://localhost:1420", "tauri://localhost"]);
    set_json!(config, "API", "HTTPHeaders", "Access-Control-Allow-Origin" => cors);
    set_json!(config, "Gateway", "HTTPHeaders", "Access-Control-Allow-Origin" => serde_json::json!(["*"]));

    let new_config_str = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(config_path, new_config_str).map_err(|e| e.to_string())?;
    Ok(())
}

/// Prepara el repositorio IPFS: limpia zombies, diagnostica repo corrupto, crea directorios
fn prepare_ipfs_repo(repo_path: &str) {
    let repo = PathBuf::from(repo_path);
    
    // Si la config actual esta rota o le falta el DataStore Spec por el bug anterior, limpiar todo para re-init
    let config_path = repo.join("config");
    if config_path.exists() {
        if let Ok(config_str) = fs::read_to_string(&config_path) {
            if let Ok(config_json) = serde_json::from_str::<serde_json::Value>(&config_str) {
                if config_json["Datastore"]["Spec"].is_null() {
                    println!("[IPFS] Config detectada corrupta (sin Datastore). Recreando repositorio...");
                    fs::remove_dir_all(&repo).ok();
                }
            }
        }
    }
    
    // Limpiar repo.lock si quedo atascado
    let lock_file = repo.join("repo.lock");
    if lock_file.exists() {
        println!("[IPFS] Limpiando repo.lock huerfano");
        fs::remove_file(&lock_file).ok();
    }
    
    // Si el root no existe, lo creamos
    if !repo.exists() {
        fs::create_dir_all(&repo).ok();
        println!("[IPFS] Repositorio base reservado en: {}", repo_path);
    }
}

/// Valida que los bytes de un archivo correspondan a un formato multimedia permitido
fn validate_file_magic_bytes(data: &[u8]) -> Result<&'static str, String> {
    if data.len() < 12 {
        return Err("Archivo demasiado pequeño".to_string());
    }
    // PNG: 89 50 4E 47
    if data[0..4] == [0x89, 0x50, 0x4E, 0x47] {
        return Ok("image/png");
    }
    // JPEG: FF D8 FF
    if data[0..3] == [0xFF, 0xD8, 0xFF] {
        return Ok("image/jpeg");
    }
    // WebP: RIFF....WEBP
    if data[0..4] == [0x52, 0x49, 0x46, 0x46] && data[8..12] == [0x57, 0x45, 0x42, 0x50] {
        return Ok("image/webp");
    }
    // GIF: GIF87a o GIF89a
    if data[0..3] == [0x47, 0x49, 0x46] {
        return Ok("image/gif");
    }
    // PDF: %PDF (25 50 44 46)
    if data[0..4] == [0x25, 0x50, 0x44, 0x46] {
        return Ok("application/pdf");
    }
    // MP4/QuickTime: ....ftyp (66 74 79 70 at offset 4)
    if data.len() >= 8 && data[4..8] == [0x66, 0x74, 0x79, 0x70] {
        return Ok("video/mp4");
    }
    // MP3: ID3 (49 44 33) o Sync Word (FF FB)
    if data[0..3] == [0x49, 0x44, 0x33] || (data[0] == 0xFF && (data[1] & 0xE0) == 0xE0) {
        return Ok("audio/mpeg");
    }
    // OGG: OggS (4F 67 67 53)
    if data[0..4] == [0x4F, 0x67, 0x67, 0x53] {
        return Ok("audio/ogg");
    }
    // WAV: RIFF....WAVE
    if data[0..4] == [0x52, 0x49, 0x46, 0x46] && data.len() >= 12 && data[8..12] == [0x57, 0x41, 0x56, 0x45] {
        return Ok("audio/wav");
    }
    Err("Formato no soportado. Usa Imágenes, PDFs, MP4, MP3, OGG o WAV".to_string())
}

// === COMANDOS TAURI: BASE DE DATOS Y CRIPTOGRAFIA ===

#[tauri::command]
fn check_db_initialized(state: tauri::State<'_, db::DatabaseState>) -> Result<bool, String> {
    let conn_guard = state.connection.lock().unwrap();
    if let Some(conn) = conn_guard.as_ref() {
        // Si hay un salt, significa que ya existe una contrasena maestra
        let result = db::get_master_salt(conn);
        Ok(result.is_ok())
    } else {
        Err("La conexion a base de datos no esta lista".to_string())
    }
}

#[tauri::command]
fn setup_master_password(_password: String, panic_password: Option<String>, state: tauri::State<'_, db::DatabaseState>) -> Result<(), String> {
    let conn_guard = state.connection.lock().unwrap();
    if let Some(conn) = conn_guard.as_ref() {
        db::setup_master_password(conn, panic_password.as_deref())?;
        Ok(())
    } else {
        Err("La conexion a base de datos no esta lista".to_string())
    }
}

#[tauri::command]
fn login_with_password(password: String, state: tauri::State<'_, db::DatabaseState>) -> Result<bool, String> {
    let conn_guard = state.connection.lock().unwrap();
    if let Some(conn) = conn_guard.as_ref() {
        db::is_password_correct(conn, &password)
    } else {
        Err("La conexion a base de datos no esta lista".to_string())
    }
}

#[tauri::command]
fn change_panic_password_cmd(current_master: String, new_panic: String, state: tauri::State<'_, db::DatabaseState>) -> Result<(), String> {
    let conn_guard = state.connection.lock().unwrap();
    if let Some(conn) = conn_guard.as_ref() {
        db::change_panic_password(conn, &current_master, &new_panic)
    } else {
        Err("La conexion a base de datos no esta lista".to_string())
    }
}

#[tauri::command]
fn change_master_password_cmd(current_master: String, new_master: String, state: tauri::State<'_, db::DatabaseState>) -> Result<(), String> {
    let mut conn_guard = state.connection.lock().unwrap();
    if let Some(conn) = conn_guard.as_mut() {
        db::change_master_password(conn, &current_master, &new_master)
    } else {
        Err("La conexion a base de datos no esta lista".to_string())
    }
}

#[tauri::command]
fn get_saved_identities(state: tauri::State<'_, db::DatabaseState>) -> Result<Vec<db::IdentityRecord>, String> {
    let conn_guard = state.connection.lock().unwrap();
    if let Some(conn) = conn_guard.as_ref() {
        db::get_all_identities_public(conn)
    } else {
        Err("La conexion a base de datos no esta lista".to_string())
    }
}

#[tauri::command]
fn get_identity_secret(id: i32, password: String, state: tauri::State<'_, db::DatabaseState>) -> Result<String, String> {
    let conn_guard = state.connection.lock().unwrap();
    if let Some(conn) = conn_guard.as_ref() {
        db::get_decrypted_nsec(conn, id, &password)
    } else {
        Err("La conexion a base de datos no esta lista".to_string())
    }
}

#[tauri::command]
fn save_identity(alias: String, pubkey: String, nsec: String, password: String, state: tauri::State<'_, db::DatabaseState>) -> Result<(), String> {
    let conn_guard = state.connection.lock().unwrap();
    if let Some(conn) = conn_guard.as_ref() {
        // [ADVERTENCIA]: El nsec aqui llega en texto plano desde React en memoria temporal
        // La funcion save_new_identity lo cifrara con AES-GCM antes de grabarlo a disco
        db::save_new_identity(conn, &alias, &pubkey, &nsec, &password)
    } else {
        Err("La conexion a base de datos no esta lista".to_string())
    }
}

#[tauri::command]
fn import_identity(alias: String, nsec: String, password: String, state: tauri::State<'_, db::DatabaseState>) -> Result<(), String> {
    let secret_key = SecretKey::parse(&nsec).map_err(|e| format!("nSec invalido: {}", e))?;
    let keys = Keys::new(secret_key);
    let pubkey_str = keys.public_key().to_bech32().unwrap_or_else(|_| keys.public_key().to_string());

    let conn_guard = state.connection.lock().unwrap();
    if let Some(conn) = conn_guard.as_ref() {
        db::save_new_identity(conn, &alias, &pubkey_str, &nsec, &password)
    } else {
        Err("La conexion a base de datos no esta lista".to_string())
    }
}

#[tauri::command]
fn save_my_report_command(event_id: String, content: String, password: String, state: tauri::State<'_, db::DatabaseState>) -> Result<(), String> {
    let conn_guard = state.connection.lock().unwrap();
    if let Some(conn) = conn_guard.as_ref() {
        db::save_my_report(conn, &event_id, &content, &password)
    } else {
        Err("La conexion a base de datos no esta lista".to_string())
    }
}

#[tauri::command]
fn get_my_reports_command(password: String, state: tauri::State<'_, db::DatabaseState>) -> Result<Vec<db::ReportRecord>, String> {
    let conn_guard = state.connection.lock().unwrap();
    if let Some(conn) = conn_guard.as_ref() {
        db::get_my_reports(conn, &password)
    } else {
        Err("La conexion a base de datos no esta lista".to_string())
    }
}

// === COMANDOS TAURI: CONFIGURACION DE USUARIO ===

#[tauri::command]
fn get_setting(key: String, default_value: String, state: tauri::State<'_, db::DatabaseState>) -> Result<String, String> {
    let conn_guard = state.connection.lock().unwrap();
    if let Some(conn) = conn_guard.as_ref() {
        db::get_setting(conn, &key, &default_value)
    } else {
        Err("BD no lista".to_string())
    }
}

#[tauri::command]
fn save_setting(key: String, value: String, state: tauri::State<'_, db::DatabaseState>) -> Result<(), String> {
    let conn_guard = state.connection.lock().unwrap();
    if let Some(conn) = conn_guard.as_ref() {
        db::save_setting(conn, &key, &value)
    } else {
        Err("BD no lista".to_string())
    }
}

// === CONTACTOS ===
#[tauri::command]
fn save_contact(alias: String, pubkey: String, state: tauri::State<'_, db::DatabaseState>) -> Result<(), String> {
    if let Some(conn) = state.connection.lock().unwrap().as_ref() {
        db::save_contact(conn, &alias, &pubkey)
    } else {
        Err("BD no lista".to_string())
    }
}

#[tauri::command]
fn get_contacts(state: tauri::State<'_, db::DatabaseState>) -> Result<Vec<db::ContactRecord>, String> {
    if let Some(conn) = state.connection.lock().unwrap().as_ref() {
        db::get_all_contacts(conn)
    } else {
        Err("BD no lista".to_string())
    }
}

#[tauri::command]
fn delete_contact(pubkey: String, state: tauri::State<'_, db::DatabaseState>) -> Result<(), String> {
    if let Some(conn) = state.connection.lock().unwrap().as_ref() {
        db::delete_contact(conn, &pubkey)
    } else {
        Err("BD no lista".to_string())
    }
}

#[tauri::command]
fn toggle_follow(pubkey: String, state: tauri::State<'_, db::DatabaseState>) -> Result<bool, String> {
    if let Some(conn) = state.connection.lock().unwrap().as_ref() {
        db::toggle_contact_follow(conn, &pubkey)
    } else {
        Err("BD no lista".to_string())
    }
}

#[tauri::command]
fn toggle_block(pubkey: String, state: tauri::State<'_, db::DatabaseState>) -> Result<bool, String> {
    if let Some(conn) = state.connection.lock().unwrap().as_ref() {
        db::toggle_contact_block(conn, &pubkey)
    } else {
        Err("BD no lista".to_string())
    }
}

#[tauri::command]
fn get_following(state: tauri::State<'_, db::DatabaseState>) -> Result<Vec<String>, String> {
    if let Some(conn) = state.connection.lock().unwrap().as_ref() {
        db::get_following_pubkeys(conn)
    } else {
        Err("BD no lista".to_string())
    }
}

#[tauri::command]
fn get_blocked(state: tauri::State<'_, db::DatabaseState>) -> Result<Vec<String>, String> {
    if let Some(conn) = state.connection.lock().unwrap().as_ref() {
        db::get_blocked_pubkeys(conn)
    } else {
        Err("BD no lista".to_string())
    }
}

// === COMANDOS TAURI: CANALES GUARDADOS ===

#[tauri::command]
fn save_channel(id: String, name: String, about: String, pubkey: String, picture: String, state: tauri::State<'_, db::DatabaseState>) -> Result<(), String> {
    if let Some(conn) = state.connection.lock().unwrap().as_ref() {
        db::save_channel(conn, &id, &name, &about, &pubkey, &picture)
    } else {
        Err("BD no lista".to_string())
    }
}

#[tauri::command]
fn remove_saved_channel(id: String, state: tauri::State<'_, db::DatabaseState>) -> Result<(), String> {
    if let Some(conn) = state.connection.lock().unwrap().as_ref() {
        db::remove_saved_channel(conn, &id)
    } else {
        Err("BD no lista".to_string())
    }
}

#[tauri::command]
fn get_saved_channels(state: tauri::State<'_, db::DatabaseState>) -> Result<Vec<db::SavedChannel>, String> {
    if let Some(conn) = state.connection.lock().unwrap().as_ref() {
        db::get_saved_channels(conn)
    } else {
        Err("BD no lista".to_string())
    }
}

// === COMANDOS TAURI: NOSTR E IPFS ===

#[tauri::command]
fn generate_nostr_keys() -> Result<(String, String), String> {
    let keys = Keys::generate();
    let secret_key = keys.secret_key().to_bech32().map_err(|e| e.to_string())?;
    let public_key = keys.public_key().to_bech32().map_err(|e| e.to_string())?;
    Ok((public_key, secret_key))
}

#[tauri::command]
async fn publish_report(nsec: String, content: String, state: tauri::State<'_, db::DatabaseState>) -> Result<(String, String), String> {
    // 1. Cargar preferencias de usuario desde DB
    let mut relays_str = "wss://relay.damus.io,wss://nos.lol".to_string();
    let mut current_pow = POW_DIFFICULTY;
    
    if let Some(conn) = state.connection.lock().unwrap().as_ref() {
        if let Ok(r) = db::get_setting(conn, "custom_relays", "wss://relay.damus.io,wss://nos.lol") {
            relays_str = r;
        }
        if let Ok(p) = db::get_setting(conn, "default_pow", &POW_DIFFICULTY.to_string()) {
            current_pow = p.parse().unwrap_or(POW_DIFFICULTY);
        }
    }

    // 2. Conectar y publicar
    let secret_key = SecretKey::parse(&nsec).map_err(|e| e.to_string())?;
    let keys = Keys::new(secret_key);
    let (client, using_tor) = build_nostr_client(keys).await;
    connect_client(&client, using_tor, &relays_str).await;
    
    let builder = EventBuilder::text_note(content).pow(current_pow);
    let future = client.send_event_builder(builder);
    let result = tokio::time::timeout(std::time::Duration::from_secs(30), future).await;
    
    let modo = if using_tor { "via Tor" } else { "conexion directa" };
    match result {
        Ok(Ok(output)) => {
            let ok_count = output.success.len();
            let fail_count = output.failed.len();
            let event_id_str = output.id().to_string();
            if ok_count > 0 {
                Ok((format!("Publicado en {} relay(s) ({}) | PoW: {}", ok_count, modo, current_pow), event_id_str))
            } else {
                Err(format!("0 relays aceptaron ({} fallaron). Modo: {}", fail_count, modo))
            }
        },
        Ok(Err(e)) => Err(format!("Fallo publicacion ({}): {}", modo, e)),
        Err(_) => Err(format!("Timeout 30s ({})", modo)),
    }
}

/// Comando para publicar una respuesta (Hilo) a otra denuncia
/// Agrega los tags `e` (Event ID) y `p` (Pubkey del autor original) segun NIP-01
#[tauri::command]
async fn publish_reply(nsec: String, content: String, target_event_id: String, target_pubkey: String, state: tauri::State<'_, db::DatabaseState>) -> Result<(String, String), String> {
    // 1. Cargar preferencias de usuario desde DB
    let mut relays_str = "wss://relay.damus.io,wss://nos.lol".to_string();
    let mut current_pow = POW_DIFFICULTY;
    
    if let Some(conn) = state.connection.lock().unwrap().as_ref() {
        if let Ok(r) = db::get_setting(conn, "custom_relays", "wss://relay.damus.io,wss://nos.lol") {
            relays_str = r;
        }
        if let Ok(p) = db::get_setting(conn, "default_pow", &POW_DIFFICULTY.to_string()) {
            current_pow = p.parse().unwrap_or(POW_DIFFICULTY);
        }
    }

    let secret_key = SecretKey::parse(&nsec).map_err(|e| e.to_string())?;
    let keys = Keys::new(secret_key);
    let (client, using_tor) = build_nostr_client(keys).await;
    connect_client(&client, using_tor, &relays_str).await;
    
    let eid = EventId::from_hex(&target_event_id).map_err(|e| format!("ID invalido: {}", e))?;
    let pk = PublicKey::from_str(&target_pubkey).map_err(|e| format!("Pubkey invalida: {}", e))?;
    
    // NIP-01: Reply tags
    let builder = EventBuilder::text_note(content)
        .tag(Tag::event(eid)) // Tag basico de evento
        .tag(Tag::public_key(pk)) // Tag basico de pubkey
        .pow(current_pow);
        
    let future = client.send_event_builder(builder);
    let result = tokio::time::timeout(std::time::Duration::from_secs(30), future).await;
    
    let modo = if using_tor { "via Tor" } else { "conexion directa" };
    match result {
        Ok(Ok(output)) => {
            let ok_count = output.success.len();
            let event_id_str = output.id().to_string();
            if ok_count > 0 {
                Ok((format!("Respuesta publicada en {} relay(s) ({}) | PoW: {}", ok_count, modo, current_pow), event_id_str))
            } else {
                Err(format!("0 relays aceptaron la respuesta. Modo: {}", modo))
            }
        },
        Ok(Err(e)) => Err(format!("Fallo publicacion de respuesta ({}): {}", modo, e)),
        Err(_) => Err(format!("Timeout 30s ({})", modo)),
    }
}

#[tauri::command]
async fn react_to_event(nsec: String, event_id: String, event_pubkey: String, reaction: String, state: tauri::State<'_, db::DatabaseState>) -> Result<String, String> {
    let mut relays_str = "wss://relay.damus.io,wss://nos.lol".to_string();
    if let Some(conn) = state.connection.lock().unwrap().as_ref() {
        if let Ok(r) = db::get_setting(conn, "custom_relays", "wss://relay.damus.io,wss://nos.lol") {
            relays_str = r;
        }
    }

    let secret_key = SecretKey::parse(&nsec).map_err(|e| e.to_string())?;
    let keys = Keys::new(secret_key);
    let (client, using_tor) = build_nostr_client(keys).await;
    connect_client(&client, using_tor, &relays_str).await;
    
    let eid = EventId::from_hex(&event_id).map_err(|e| format!("ID invalido: {}", e))?;
    let pk = PublicKey::from_str(&event_pubkey).map_err(|e| format!("Pubkey invalida: {}", e))?;
    
    let target = ReactionTarget {
        event_id: eid,
        public_key: pk,
        coordinate: None,
        kind: Some(Kind::TextNote),
        relay_hint: None,
    };
    
    let builder = EventBuilder::reaction(target, &reaction);
    let future = client.send_event_builder(builder);
    let result = tokio::time::timeout(std::time::Duration::from_secs(15), future).await;
    
    match result {
        Ok(Ok(output)) => {
            if output.success.len() > 0 {
                Ok(format!("Reaccion '{}' enviada", reaction))
            } else {
                Err("No se pudo enviar la reaccion".to_string())
            }
        },
        Ok(Err(e)) => Err(format!("Error: {}", e)),
        Err(_) => Err("Timeout al enviar reaccion".to_string()),
    }
}

// === NIP-04 (MENSAJERIA DIRECTA ENCRIPTADA) ===

#[tauri::command]
async fn send_direct_message(nsec: String, target_pubkey: String, plaintext: String, state: tauri::State<'_, db::DatabaseState>) -> Result<(String, String), String> {
    // 1. Cargar preferencias de usuario desde DB
    let mut relays_str = "wss://relay.damus.io,wss://nos.lol".to_string();
    if let Some(conn) = state.connection.lock().unwrap().as_ref() {
        if let Ok(r) = db::get_setting(conn, "custom_relays", "wss://relay.damus.io,wss://nos.lol") {
            relays_str = r;
        }
    }

    let secret_key = SecretKey::parse(&nsec).map_err(|e| e.to_string())?;
    let keys = Keys::new(secret_key);
    let (client, using_tor) = build_nostr_client(keys.clone()).await;
    connect_client(&client, using_tor, &relays_str).await;

    let pk = PublicKey::from_str(&target_pubkey).map_err(|e| format!("Pubkey invalida: {}", e))?;

    // Implementacion NIP-04 Nativa: Nostr SDK hace el secreto ECDH y cifra AES-256-CBC
    let encrypted_content = nostr::nips::nip04::encrypt(keys.secret_key(), &pk, plaintext)
        .map_err(|e| format!("Error encriptando mensaje NIP-04: {}", e))?;
    
    let enc_content_for_db = encrypted_content.clone();
    
    let builder = EventBuilder::new(Kind::EncryptedDirectMessage, encrypted_content)
        .tag(Tag::public_key(pk));

    let future = client.send_event_builder(builder);
    let result = tokio::time::timeout(std::time::Duration::from_secs(15), future).await;

    let modo = if using_tor { "via Tor" } else { "conexion directa" };
    match result {
        Ok(Ok(output)) => {
            let ok_count = output.success.len();
            if ok_count > 0 {
                let event_id_str = output.id().to_string();
                let my_pk_str = keys.public_key().to_bech32().unwrap_or_else(|_| keys.public_key().to_string());
                let target_pk_str = target_pubkey.clone();
                
                // Guardar copia local en SQLite
                if let Some(conn) = state.connection.lock().unwrap().as_ref() {
                    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64;
                    let _ = db::save_dm_event(conn, &event_id_str, &my_pk_str, &target_pk_str, &enc_content_for_db, now);
                }

                Ok((format!("Mensaje encriptado enviado (NIP-04) en {} relays ({})", ok_count, modo), event_id_str))
            } else {
                Err(format!("0 relays aceptaron el mensaje. Modo: {}", modo))
            }
        },
        Ok(Err(e)) => Err(format!("Fallo envio de DM ({}): {}", modo, e)),
        Err(_) => Err(format!("Timeout 30s enviando DM ({})", modo)),
    }
}

#[tauri::command]
async fn fetch_direct_messages(nsec: String, target_pubkey: String, state: tauri::State<'_, db::DatabaseState>) -> Result<Vec<DirectMessage>, String> {
    let mut relays_str = "wss://relay.damus.io,wss://nos.lol".to_string();
    if let Some(conn) = state.connection.lock().unwrap().as_ref() {
        if let Ok(r) = db::get_setting(conn, "custom_relays", "wss://relay.damus.io,wss://nos.lol") {
            relays_str = r;
        }
    }

    let secret_key = SecretKey::parse(&nsec).map_err(|e| e.to_string())?;
    let keys = Keys::new(secret_key); // Mis llaves
    let my_pubkey = keys.public_key();
    let other_pk = PublicKey::from_str(&target_pubkey).map_err(|e| format!("Pubkey invalida: {}", e))?;

    let (client, using_tor) = build_nostr_client(keys.clone()).await;
    connect_client(&client, using_tor, &relays_str).await;

    // Crear filtro unico combinado: Mensajes mios a el, o de el a mi. (Kind 4)
    let filter = Filter::new()
        .kind(Kind::EncryptedDirectMessage)
        .authors(vec![my_pubkey, other_pk])
        .pubkeys(vec![my_pubkey, other_pk]);

    let timeout = if using_tor { 15 } else { 8 };
    let events = client.fetch_events(filter, std::time::Duration::from_secs(timeout)).await
        .map_err(|e| format!("Error leyendo mensajes: {}", e))?;

    let mut dms = Vec::new();

    // 1. Guardar los nuevos en DB local
    if let Some(conn) = state.connection.lock().unwrap().as_ref() {
        for event in events.clone().into_iter() {
            let sender = event.pubkey.to_bech32().unwrap_or_else(|_| event.pubkey.to_string());
            let recipient = if event.pubkey == my_pubkey { 
                target_pubkey.clone() 
            } else { 
                my_pubkey.to_bech32().unwrap_or_else(|_| my_pubkey.to_string()) 
            };
            let _ = db::save_dm_event(conn, &event.id.to_hex(), &sender, &recipient, &event.content, event.created_at.as_secs() as i64);
        }
    }

    // 2. Cargar TODOS los mensajes cifrados (historial completo) de SQLite
    let mut stored_events = Vec::new();
    if let Some(conn) = state.connection.lock().unwrap().as_ref() {
        let my_pk_str = my_pubkey.to_bech32().unwrap_or_else(|_| my_pubkey.to_string());
        if let Ok(evs) = db::get_dm_events(conn, &my_pk_str, &target_pubkey) {
            stored_events = evs;
        }
    }

    // 3. Descifrar la lista consolidada en memoria RAM
    for rev in stored_events.into_iter() {
        // En NIP-04, la peer_pubkey es la del remitente, a menos que nosotros seamos los remitentes,
        // en cuyo caso es la del destinatario.
        let ev_sender_pk = PublicKey::from_str(&rev.sender_pubkey).or_else(|_| PublicKey::from_bech32(&rev.sender_pubkey)).unwrap_or(other_pk);
        
        let peer_pubkey = if ev_sender_pk == my_pubkey {
            other_pk
        } else {
            ev_sender_pk
        };

        match nostr::nips::nip04::decrypt(keys.secret_key(), &peer_pubkey, &rev.content) {
            Ok(decrypted_text) => {
                dms.push(DirectMessage {
                    id: rev.id,
                    sender_pubkey: rev.sender_pubkey,
                    recipient_pubkey: target_pubkey.clone(),
                    content: decrypted_text,
                    created_at: rev.created_at as u64,
                });
            },
            Err(e) => {
                println!("[NIP-04] Error descifrando DM local {}: {}", rev.id, e);
                continue;
            }
        }
    }

    // Ordenar cronologicamente
    dms.sort_by(|a, b| a.created_at.cmp(&b.created_at));

    Ok(dms)
}

// === NIP-28 (GRUPOS Y CANALES PUBLICOS) ===

#[tauri::command]
async fn create_channel(nsec: String, name: String, about: String, picture: String, state: tauri::State<'_, db::DatabaseState>) -> Result<(String, String), String> {
    // 1. Cargar relays preferidos
    let mut relays_str = "wss://relay.damus.io,wss://nos.lol".to_string();
    let mut current_pow = POW_DIFFICULTY;
    if let Some(conn) = state.connection.lock().unwrap().as_ref() {
        if let Ok(r) = db::get_setting(conn, "custom_relays", "wss://relay.damus.io,wss://nos.lol") {
            relays_str = r;
        }
        if let Ok(p) = db::get_setting(conn, "default_pow", &POW_DIFFICULTY.to_string()) {
            current_pow = p.parse().unwrap_or(POW_DIFFICULTY);
        }
    }

    let secret_key = SecretKey::parse(&nsec).map_err(|e| e.to_string())?;
    let keys = Keys::new(secret_key);
    let (client, using_tor) = build_nostr_client(keys).await;
    connect_client(&client, using_tor, &relays_str).await;

    // Crear contenido JSON para el meta-dato del canal segun NIP-28
    let metadata = serde_json::json!({
        "name": name,
        "about": about,
        "picture": picture
    });

    let builder = EventBuilder::new(Kind::ChannelCreation, metadata.to_string())
        .pow(current_pow);

    let future = client.send_event_builder(builder);
    let result = tokio::time::timeout(std::time::Duration::from_secs(15), future).await;

    let modo = if using_tor { "via Tor" } else { "conexion directa" };
    match result {
        Ok(Ok(output)) => {
            let ok_count = output.success.len();
            if ok_count > 0 {
                Ok((format!("Canal creado en {} relays ({})", ok_count, modo), output.id().to_string()))
            } else {
                Err(format!("0 relays aceptaron la creacion del canal. Modo: {}", modo))
            }
        },
        Ok(Err(e)) => Err(format!("Fallo creacion de canal ({}): {}", modo, e)),
        Err(_) => Err(format!("Timeout 15s al crear canal ({})", modo)),
    }
}

#[tauri::command]
async fn fetch_channels(state: tauri::State<'_, db::DatabaseState>) -> Result<Vec<Channel>, String> {
    let mut relays_str = "wss://relay.damus.io,wss://nos.lol".to_string();
    if let Some(conn) = state.connection.lock().unwrap().as_ref() {
        if let Ok(r) = db::get_setting(conn, "custom_relays", "wss://relay.damus.io,wss://nos.lol") {
            relays_str = r;
        }
    }

    let keys = Keys::generate(); // Llaves dummy para leer
    let (client, using_tor) = build_nostr_client(keys).await;
    connect_client(&client, using_tor, &relays_str).await;

    // Buscar Eventos Kind 40 (Create Channel)
    let filter = Filter::new().kind(Kind::ChannelCreation).limit(100);
    let timeout = if using_tor { 12 } else { 8 };
    
    let events = client.fetch_events(filter, std::time::Duration::from_secs(timeout)).await
        .map_err(|e| format!("Error leyendo canales: {}", e))?;

    let mut channels = Vec::new();

    for event in events.into_iter() {
        // [Conexion API local]: Parseamos el JSON del evento para sacar nombre y descripcion.
        // Proposito: Mostrar la lista visual de Salas a los usuarios.
        let parsed: Result<serde_json::Value, _> = serde_json::from_str(&event.content);
        if let Ok(metadata) = parsed {
            channels.push(Channel {
                id: event.id.to_hex(),
                pubkey: event.pubkey.to_bech32().unwrap_or_else(|_| event.pubkey.to_string()),
                name: metadata.get("name").and_then(|v| v.as_str()).unwrap_or("Canal Sin Nombre").to_string(),
                about: metadata.get("about").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                picture: metadata.get("picture").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                created_at: event.created_at.as_secs(),
            });
        }
    }

    // Ordenar los mas nuevos arriba
    channels.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(channels)
}

#[tauri::command]
async fn send_channel_message(nsec: String, channel_id: String, content: String, state: tauri::State<'_, db::DatabaseState>) -> Result<(String, String), String> {
    let mut relays_str = "wss://relay.damus.io,wss://nos.lol".to_string();
    let mut current_pow = POW_DIFFICULTY;
    if let Some(conn) = state.connection.lock().unwrap().as_ref() {
        if let Ok(r) = db::get_setting(conn, "custom_relays", "wss://relay.damus.io,wss://nos.lol") {
            relays_str = r;
        }
        if let Ok(p) = db::get_setting(conn, "default_pow", &POW_DIFFICULTY.to_string()) {
            current_pow = p.parse().unwrap_or(POW_DIFFICULTY);
        }
    }

    let secret_key = SecretKey::parse(&nsec).map_err(|e| e.to_string())?;
    let keys = Keys::new(secret_key);
    let (client, using_tor) = build_nostr_client(keys).await;
    connect_client(&client, using_tor, &relays_str).await;

    let cid = EventId::from_hex(&channel_id).map_err(|e| format!("ID de canal invalido: {}", e))?;

    // NIP-28: Mensaje de Canal (Kind 42) + Tag E apuntando al canal root
    let builder = EventBuilder::new(Kind::ChannelMessage, content)
        .tag(Tag::event(cid)) // Tag 'e' del id del canal
        .pow(current_pow);

    let future = client.send_event_builder(builder);
    let result = tokio::time::timeout(std::time::Duration::from_secs(15), future).await;

    let modo = if using_tor { "via Tor" } else { "conexion directa" };
    match result {
        Ok(Ok(output)) => {
            let ok_count = output.success.len();
            if ok_count > 0 {
                Ok((format!("Mensaje enviado al canal en {} relays ({})", ok_count, modo), output.id().to_string()))
            } else {
                Err(format!("0 relays aceptaron el mensaje. Modo: {}", modo))
            }
        },
        Ok(Err(e)) => Err(format!("Fallo envio al canal ({}): {}", modo, e)),
        Err(_) => Err(format!("Timeout 15s al enviar a canal ({})", modo)),
    }
}

#[tauri::command]
async fn fetch_channel_messages(channel_id: String, state: tauri::State<'_, db::DatabaseState>) -> Result<Vec<Report>, String> {
    let mut relays_str = "wss://relay.damus.io,wss://nos.lol".to_string();
    if let Some(conn) = state.connection.lock().unwrap().as_ref() {
        if let Ok(r) = db::get_setting(conn, "custom_relays", "wss://relay.damus.io,wss://nos.lol") {
             relays_str = r;
        }
    }

    let keys = Keys::generate();
    let (client, using_tor) = build_nostr_client(keys).await;
    connect_client(&client, using_tor, &relays_str).await;

    let cid = EventId::from_hex(&channel_id).map_err(|e| format!("ID de canal invalido: {}", e))?;

    // NIP-28: Buscar Kind 42 que apunten a nuestro canal (con tag e)
    let filter = Filter::new()
        .kind(Kind::ChannelMessage)
        .events(vec![cid])
        .limit(100);
        
    let timeout = if using_tor { 12 } else { 8 };
    let events = client.fetch_events(filter, std::time::Duration::from_secs(timeout)).await
        .map_err(|e| format!("Error leyendo mensajes del canal: {}", e))?;

    let mut reports = Vec::new();
    for event in events.into_iter() {
        let pow = nip13::get_leading_zero_bits(event.id.as_bytes());
        reports.push(Report {
            id: event.id.to_hex(),
            pubkey: event.pubkey.to_bech32().unwrap_or_else(|_| event.pubkey.to_string()),
            content: event.content.clone(),
            created_at: event.created_at.as_secs(),
            pow,
            reactions_up: 0, // Las reacciones en canales se omiten en MVP por simplicidad de UI
            reactions_down: 0,
            reply_to: Some(channel_id.clone()),
        });
    }

    // Ordenamos cronologicamente (los mas viejos primero, estilo chat)
    reports.sort_by(|a, b| a.created_at.cmp(&b.created_at));
    Ok(reports)
}

#[tauri::command]
async fn fetch_global_feed(feed_mode: String, until: Option<u64>, state: tauri::State<'_, db::DatabaseState>) -> Result<Vec<Report>, String> {
    let mut relays_str = "wss://relay.damus.io,wss://nos.lol".to_string();
    let mut following_keys = Vec::new();
    let mut blocked_keys = Vec::new();

    if let Some(conn) = state.connection.lock().unwrap().as_ref() {
        if let Ok(r) = db::get_setting(conn, "custom_relays", "wss://relay.damus.io,wss://nos.lol") {
            relays_str = r;
        }
        if let Ok(f) = db::get_following_pubkeys(conn) {
            following_keys = f;
        }
        if let Ok(b) = db::get_blocked_pubkeys(conn) {
            blocked_keys = b;
        }
    }

    let keys = Keys::generate();
    let (client, using_tor) = build_nostr_client(keys).await;
    connect_client(&client, using_tor, &relays_str).await;
    
    let mut filter = Filter::new().kind(Kind::TextNote).limit(50);
    
    if let Some(u) = until {
        filter = filter.until(Timestamp::from(u));
    }
    
    if feed_mode == "following" {
        if following_keys.is_empty() {
             return Ok(Vec::new()); // No carga nada si no sigue a nadie
        }
        // Convertir String pubkeys a PublicKey (hex/npub/etc)
        let mut pks = Vec::new();
        for k in following_keys {
            if let Ok(pk) = PublicKey::from_str(&k).or_else(|_| PublicKey::from_bech32(&k)) {
                pks.push(pk);
            }
        }
        if !pks.is_empty() {
            filter = filter.authors(pks);
        } else {
            return Ok(Vec::new());
        }
    }
    let timeout = if using_tor { 12 } else { 8 };
    let events = client.fetch_events(filter, std::time::Duration::from_secs(timeout)).await
        .map_err(|e| format!("Fallo lectura de eventos: {}", e))?;
    
    let event_ids: Vec<EventId> = events.iter().map(|e| e.id).collect();
    let mut reactions_map: std::collections::HashMap<String, (i32, i32)> = std::collections::HashMap::new();
    
    if !event_ids.is_empty() {
        let reaction_filter = Filter::new().kind(Kind::Reaction).events(event_ids);
        if let Ok(reaction_events) = client.fetch_events(reaction_filter, std::time::Duration::from_secs(5)).await {
            for reaction in reaction_events.iter() {
                for tag in reaction.tags.iter() {
                    if let Some(TagStandard::Event { event_id, .. }) = tag.as_standardized() {
                        let entry = reactions_map.entry(event_id.to_hex()).or_insert((0, 0));
                        if reaction.content == "-" {
                            entry.1 += 1;
                        } else {
                            entry.0 += 1;
                        }
                    }
                }
            }
        }
    }
    
    let mut reports = Vec::new();
    for event in events.into_iter() {
        let pow = nip13::get_leading_zero_bits(event.id.as_bytes());
        if pow >= MIN_POW_DISPLAY {
            let id_hex = event.id.to_hex();
            let (up, down) = reactions_map.get(&id_hex).copied().unwrap_or((0, 0));
            
            // Buscar tag de respuesta ("e" event)
            let mut reply_to = None;
            for tag in event.tags.iter() {
                if let Some(TagStandard::Event { event_id, .. }) = tag.as_standardized() {
                    reply_to = Some(event_id.to_hex());
                    break;
                }
            }
            let pubkey_str = event.pubkey.to_bech32().unwrap_or_else(|_| event.pubkey.to_string());
            let pubkey_hex = event.pubkey.to_hex();
            
            // Ignorar los bloqueados (checando en crudo npub o hex por si acaso, lo comun es guardarlo como caiga en la UI)
            if blocked_keys.contains(&pubkey_str) || blocked_keys.contains(&pubkey_hex) {
                 continue;
            }

            reports.push(Report {
                id: id_hex,
                pubkey: pubkey_str,
                content: event.content.clone(),
                created_at: event.created_at.as_secs(),
                pow,
                reactions_up: up,
                reactions_down: down,
                reply_to,
            });
        }
    }
    
    reports.sort_by(|a, b| b.pow.cmp(&a.pow).then(b.created_at.cmp(&a.created_at)));
    Ok(reports)
}

#[tauri::command]
async fn search_nostr_events(query: String, state: tauri::State<'_, db::DatabaseState>) -> Result<Vec<Report>, String> {
    let mut relays_str = "wss://relay.damus.io,wss://nos.lol,wss://search.nos.today".to_string();
    if let Some(conn) = state.connection.lock().unwrap().as_ref() {
        if let Ok(r) = db::get_setting(conn, "custom_relays", "wss://relay.damus.io,wss://nos.lol") {
            relays_str = format!("{},wss://search.nos.today", r);
        }
    }

    let keys = Keys::generate();
    let (client, using_tor) = build_nostr_client(keys).await;
    connect_client(&client, using_tor, &relays_str).await;
    
    let filter = Filter::new().kind(Kind::TextNote).search(query).limit(50);
    let timeout = if using_tor { 15 } else { 10 };
    let events = client.fetch_events(filter, std::time::Duration::from_secs(timeout)).await
        .map_err(|e| format!("Fallo búsqueda NIP-50: {}", e))?;
    
    let event_ids: Vec<EventId> = events.iter().map(|e| e.id).collect();
    let mut reactions_map: std::collections::HashMap<String, (i32, i32)> = std::collections::HashMap::new();
    
    if !event_ids.is_empty() {
        let reaction_filter = Filter::new().kind(Kind::Reaction).events(event_ids);
        if let Ok(reaction_events) = client.fetch_events(reaction_filter, std::time::Duration::from_secs(5)).await {
            for reaction in reaction_events.iter() {
                for tag in reaction.tags.iter() {
                    if let Some(TagStandard::Event { event_id, .. }) = tag.as_standardized() {
                        let entry = reactions_map.entry(event_id.to_hex()).or_insert((0, 0));
                        if reaction.content == "-" {
                            entry.1 += 1;
                        } else {
                            entry.0 += 1;
                        }
                    }
                }
            }
        }
    }
    
    let mut reports = Vec::new();
    for event in events.into_iter() {
        let pow = nip13::get_leading_zero_bits(event.id.as_bytes());
        let id_hex = event.id.to_hex();
        let (up, down) = reactions_map.get(&id_hex).copied().unwrap_or((0, 0));
        
        let mut reply_to = None;
        for tag in event.tags.iter() {
            if let Some(TagStandard::Event { event_id, .. }) = tag.as_standardized() {
                reply_to = Some(event_id.to_hex());
                break;
            }
        }
        
        reports.push(Report {
            id: id_hex,
            pubkey: event.pubkey.to_bech32().unwrap_or_else(|_| event.pubkey.to_string()),
            content: event.content.clone(),
            created_at: event.created_at.as_secs(),
            pow,
            reactions_up: up,
            reactions_down: down,
            reply_to,
        });
    }

    // Ordenar resultados priorizando PoW y luego los mas nuevos
    reports.sort_by(|a, b| b.pow.cmp(&a.pow).then(b.created_at.cmp(&a.created_at)));
    Ok(reports)
}

#[tauri::command]
async fn fetch_trending_tags(state: tauri::State<'_, db::DatabaseState>) -> Result<Vec<String>, String> {
    let mut relays_str = "wss://relay.damus.io,wss://nos.lol".to_string();
    if let Some(conn) = state.connection.lock().unwrap().as_ref() {
        if let Ok(r) = db::get_setting(conn, "custom_relays", "wss://relay.damus.io,wss://nos.lol") {
            relays_str = r;
        }
    }

    let keys = Keys::generate();
    let (client, using_tor) = build_nostr_client(keys).await;
    connect_client(&client, using_tor, &relays_str).await;
    
    // Obtener los ~200 ultimos mensajes globales usando filtros basicos
    let filter = Filter::new().kind(Kind::TextNote).limit(200);
    let timeout = if using_tor { 12 } else { 8 };
    
    let events = client.fetch_events(filter, std::time::Duration::from_secs(timeout)).await
        .map_err(|e| format!("Fallo obteniendo trends: {}", e))?;
        
    let mut tag_counts: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    
    for event in events.iter() {
        for tag in event.tags.iter() {
            let tag_vec = tag.clone().to_vec(); // Arrays de tipo ["t", "bitcoin"]
            if tag_vec.len() >= 2 && tag_vec[0] == "t" {
                let t = tag_vec[1].to_lowercase();
                if !t.trim().is_empty() {
                    *tag_counts.entry(t).or_insert(0) += 1;
                }
            }
        }
    }
    
    let mut sorted_tags: Vec<(String, usize)> = tag_counts.into_iter().collect();
    sorted_tags.sort_by(|a, b| b.1.cmp(&a.1));
    
    let top_tags: Vec<String> = sorted_tags.into_iter().take(8).map(|(tag, _)| tag).collect();
    Ok(top_tags)
}

#[tauri::command]
async fn check_tor_status() -> bool {
    detect_tor_proxy().await.is_some()
}

#[tauri::command]
fn check_ipfs_status(state: tauri::State<'_, IpfsState>) -> bool {
    *state.ready.lock().unwrap()
}

async fn fetch_from_ipfs_network(cid: &str) -> Result<Vec<u8>, String> {
    #[cfg(not(target_os = "android"))]
    {
        let url = format!("http://127.0.0.1:{}/api/v0/cat?arg={}", IPFS_API_PORT, cid);
        let client = reqwest::Client::new();
        let response = client.post(&url).send().await.map_err(|e| format!("Error Request: {}", e))?;
        if !response.status().is_success() { return Err(format!("Error IPFS: {}", response.status())); }
        response.bytes().await.map(|b| b.to_vec()).map_err(|e| e.to_string())
    }
    
    #[cfg(target_os = "android")]
    {
        let mut builder = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(20));
            
        if let Some(port) = *GLOBAL_ARTI_SOCKS_PORT.lock().unwrap() {
            let proxy_url = format!("socks5h://127.0.0.1:{}", port);
            if let Ok(proxy) = reqwest::Proxy::all(&proxy_url) {
                builder = builder.proxy(proxy);
            }
        }
        
        let client = builder.build().map_err(|e| format!("Proxy error: {}", e))?;
        
        let gateways = [
            "https://ipfs.io",
            "https://dweb.link",
            "https://cloudflare-ipfs.com",
            "https://gateway.pinata.cloud"
        ];
        
        for gw in gateways {
            let url = format!("{}/ipfs/{}", gw, cid);
            match client.get(&url).send().await {
                Ok(resp) if resp.status().is_success() => {
                    if let Ok(bytes) = resp.bytes().await {
                        return Ok(bytes.to_vec());
                    }
                }
                _ => continue,
            }
        }
        Err("Todos los gateways públicos fallaron o CID inaccesible vía Tor.".to_string())
    }
}

#[allow(unused_variables)]
async fn upload_to_ipfs_network(data: Vec<u8>, mime: &str, file_name: &str) -> Result<String, String> {
    #[cfg(not(target_os = "android"))]
    {
        let client = reqwest::Client::new();
        let part = reqwest::multipart::Part::bytes(data)
            .file_name(file_name.to_string())
            .mime_str(mime)
            .map_err(|e| format!("Error MIME: {}", e))?;
        let form = reqwest::multipart::Form::new().part("file", part);
        
        let url = format!("http://127.0.0.1:{}/api/v0/add?pin=true", IPFS_API_PORT);
        let response = client.post(&url)
            .multipart(form)
            .send()
            .await
            .map_err(|e| format!("Error al enviar a IPFS: {}", e))?;
        
        if !response.status().is_success() {
            return Err(format!("IPFS respondió con status: {}", response.status()));
        }
        
        let body: serde_json::Value = response.json().await
            .map_err(|e| format!("Error al parsear respuesta IPFS: {}", e))?;
        
        let cid = body["Hash"].as_str()
            .ok_or("No se obtuvo CID de IPFS")?
            .to_string();
        
        Ok(cid)
    }
    
    #[cfg(target_os = "android")]
    {
        // Fallback HTTP anonimo para Android: catbox.moe (sin autenticacion, responde URL directa)
        let client = reqwest::Client::new();
        let part = reqwest::multipart::Part::bytes(data)
            .file_name(file_name.to_string())
            .mime_str(mime)
            .map_err(|e| format!("Error MIME: {}", e))?;
        let form = reqwest::multipart::Form::new()
            .text("reqtype", "fileupload")
            .part("fileToUpload", part);
        
        let response = client
            .post("https://catbox.moe/user/api.php")
            .multipart(form)
            .send()
            .await
            .map_err(|e| format!("Error de red: {}", e))?;
        
        let url = response.text().await.map_err(|e| e.to_string())?;
        if url.starts_with("https://") {
            Ok(url.trim().to_string())
        } else {
            Err(format!("Error del servidor: {}", url))
        }
    }
}

/// Sube un archivo a IPFS via la API HTTP local de Kubo
/// Valida tipo (magic bytes) y tamanio antes de subir
#[tauri::command]
async fn upload_to_ipfs(file_data: Vec<u8>, state: tauri::State<'_, IpfsState>) -> Result<String, String> {
    // Verificar que IPFS esta listo
    if !*state.ready.lock().unwrap() {
        return Err("IPFS no esta listo. Espera unos segundos e intentalo de nuevo.".to_string());
    }
    
    let data = file_data;
    
    // Validar tamanio
    if data.len() as u64 > MAX_FILE_SIZE {
        return Err(format!("Archivo demasiado grande ({:.1}MB). Maximo: {}MB", 
            data.len() as f64 / 1024.0 / 1024.0, MAX_FILE_SIZE / 1024 / 1024));
    }
    
    // Validar magic bytes para determinar el tipo y confirmar que no es malicioso
    let detected_mime = validate_file_magic_bytes(&data)?;
    
    // Privacidad: Secuencias de limpieza EXIF/Metadatos independientes por tipo MIME
    let (processed_bytes, final_mime) = match detected_mime {
        "image/png" | "image/jpeg" | "image/webp" | "image/gif" => {
            let img = ::image::load_from_memory(&data).map_err(|e| format!("Imagen invalida o corrupta: {}", e))?;
            let mut cleaned_data = std::io::Cursor::new(Vec::new());
            img.write_to(&mut cleaned_data, ::image::ImageFormat::Jpeg)
                .map_err(|e| format!("Error al recodificar imagen: {}", e))?;
            (cleaned_data.into_inner(), "image/jpeg")
        },
        "application/pdf" => {
            let mut doc = lopdf::Document::load_mem(&data).map_err(|e| format!("PDF Invalido: {}", e))?;
            // Borrar metadatos del Trailer (Autor, Fecha Creacion, Programa)
            doc.trailer.remove(b"Info");
            
            let mut cleaned_data = std::io::Cursor::new(Vec::new());
            doc.save_to(&mut cleaned_data).map_err(|e| format!("Error limpiando PDF: {}", e))?;
            (cleaned_data.into_inner(), "application/pdf")
        },
        "video/mp4" => {
            // Lofty puede corromper los átomos MOOV del MP4. Omitimos saneamiento para evitar dañar el video.
            (data.clone(), "video/mp4")
        },
        "audio/mpeg" | "audio/ogg" | "audio/wav" => {
            use lofty::file::{AudioFile, TaggedFileExt};
            use lofty::probe::Probe;
            
            let mut cursor = std::io::Cursor::new(data.clone());
            let mut tagged_file = Probe::new(&mut cursor)
                .guess_file_type()
                .map_err(|e| format!("Formato A/V desconocido para Lofty: {}", e))?
                .read()
                .map_err(|e| format!("Error extrayendo etiquetas A/V: {}", e))?;
                
            // Limpia todos los tags primarios y secundarios (ID3, EXIF, Mp4Ilst, iTunes, etc)
            tagged_file.clear();
            
            let mut cleaned_data = std::io::Cursor::new(Vec::new());
            tagged_file.save_to(&mut cleaned_data, Default::default()).map_err(|e| format!("Error empaquetando archivo A/V esteril: {}", e))?;
            
            // Si la limpieza falla silenciosamente o corrompe (lofty a veces falla escribiendo MP4 mutados), retrocedemos a los bytes originales pero advertiremos en un nivel superior
            if cleaned_data.get_ref().is_empty() {
                (data.clone(), detected_mime)
            } else {
                (cleaned_data.into_inner(), detected_mime)
            }
        },
        _ => return Err("Formato recien aceptado no rutado.".to_string())
    };
    
    // Validar tamanio de nuevo tras codificar (por si acaso)
    if processed_bytes.len() as u64 > MAX_FILE_SIZE {
        return Err("Imagen demasiado grande tras procesado".to_string());
    }
    
    let cid = upload_to_ipfs_network(processed_bytes, final_mime, "image.jpg").await?;
    
    println!("[IPFS] Archivo subido: {} ({})", cid, final_mime);
    Ok(cid)
}

/// Descarga un archivo multimedia de IPFS, valida magic bytes (imágenes, PDF, video), y retorna base64
/// Esto evita XSS al no cargar CIDs directamente en el webview
#[tauri::command]
async fn fetch_ipfs_media(cid: String, state: tauri::State<'_, IpfsState>) -> Result<String, String> {
    if !*state.ready.lock().unwrap() {
        return Err("IPFS no esta listo".to_string());
    }
    
    let data = fetch_from_ipfs_network(&cid).await?;
    
    // Validar que realmente sea un formato multimedia permitido (anti-XSS)
    let content_type = validate_file_magic_bytes(&data)?;
    
    // Verificar tamanio
    if data.len() as u64 > MAX_FILE_SIZE {
        return Err("Archivo demasiado grande".to_string());
    }
    
    // Convertir a base64 para enviar seguro al frontend
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&data);
    Ok(format!("data:{};base64,{}", content_type, b64))
}

/// Sube un archivo a IPFS cifrado con una llave AES dinámica generada al vuelo.
/// Retorna (CID, llave_base64)
#[tauri::command]
async fn upload_to_ipfs_encrypted(file_path: String, state: tauri::State<'_, IpfsState>) -> Result<(String, String), String> {
    if !*state.ready.lock().unwrap() {
        return Err("IPFS no esta listo. Espera unos segundos e intentalo de nuevo.".to_string());
    }
    
    let data = std::fs::read(&file_path)
        .map_err(|e| format!("Error leyendo archivo local: {}", e))?;
    
    if data.len() as u64 > MAX_FILE_SIZE {
        return Err(format!("Archivo demasiado grande ({:.1}MB)", data.len() as f64 / 1024.0 / 1024.0));
    }
    
    let detected_mime = validate_file_magic_bytes(&data)?;
    
    // Reutilizar lógica de limpieza de EXIF según MIME:
    let (processed_bytes, _final_mime) = match detected_mime {
        "image/png" | "image/jpeg" | "image/webp" | "image/gif" => {
            let img = ::image::load_from_memory(&data).map_err(|e| format!("Imagen invalida o corrupta: {}", e))?;
            let mut cleaned_data = std::io::Cursor::new(Vec::new());
            img.write_to(&mut cleaned_data, ::image::ImageFormat::Jpeg)
                .map_err(|e| format!("Error al recodificar imagen: {}", e))?;
            (cleaned_data.into_inner(), "image/jpeg")
        },
        "application/pdf" => {
            let mut doc = lopdf::Document::load_mem(&data).map_err(|e| format!("PDF Invalido: {}", e))?;
            doc.trailer.remove(b"Info");
            let mut cleaned_data = std::io::Cursor::new(Vec::new());
            doc.save_to(&mut cleaned_data).map_err(|e| format!("Error limpiando PDF: {}", e))?;
            (cleaned_data.into_inner(), "application/pdf")
        },
        "video/mp4" => {
            // Bypass para evitar corrupción del video
            (data.clone(), detected_mime)
        },
        "audio/mpeg" | "audio/ogg" | "audio/wav" => {
            use lofty::file::{AudioFile, TaggedFileExt};
            use lofty::probe::Probe;
            
            let mut cursor = std::io::Cursor::new(data.clone());
            let mut tagged_file = Probe::new(&mut cursor)
                .guess_file_type()
                .map_err(|e| format!("Formato A/V desconocido para Lofty: {}", e))?
                .read()
                .map_err(|e| format!("Error extrayendo etiquetas A/V: {}", e))?;
                
            tagged_file.clear();
            
            let mut cleaned_data = std::io::Cursor::new(Vec::new());
            tagged_file.save_to(&mut cleaned_data, Default::default()).map_err(|e| format!("Error empaquetando archivo A/V esteril: {}", e))?;
            
            if cleaned_data.get_ref().is_empty() {
                (data.clone(), detected_mime)
            } else {
                (cleaned_data.into_inner(), detected_mime)
            }
        },
        _ => return Err("Formato no rutado.".to_string())
    };

    if processed_bytes.len() as u64 > MAX_FILE_SIZE {
        return Err("Imagen demasiado grande tras procesado".to_string());
    }

    // [NUEVO] Generar llave simetrica aleatoria y cifrar:
    let mut aes_key = [0u8; 32];
    rand::RngCore::fill_bytes(&mut rand::rngs::OsRng, &mut aes_key);
    let blob_cifrado = crypto::encrypt_binary_data(&processed_bytes, &aes_key)?;

    use base64::Engine;
    let b64_key = base64::engine::general_purpose::STANDARD.encode(&aes_key);
    
    let cid = upload_to_ipfs_network(blob_cifrado, "application/octet-stream", "encrypted.bin").await?;
    
    println!("[IPFS ENC] Archivo subido cifrado: {}", cid);
    Ok((cid, b64_key))
}

#[tauri::command]
async fn fetch_ipfs_media_decrypted(cid: String, base64_key: String, state: tauri::State<'_, IpfsState>) -> Result<String, String> {
    if !*state.ready.lock().unwrap() {
        return Err("IPFS no esta listo".to_string());
    }
    
    use base64::Engine;
    let decoded_key = base64::engine::general_purpose::STANDARD.decode(&base64_key)
        .map_err(|e| format!("Llave base64 invalida: {}", e))?;
    
    if decoded_key.len() != 32 {
        return Err("La llave simetrica debe ser de 32 bytes".to_string());
    }
    let mut aes_key = [0u8; 32];
    aes_key.copy_from_slice(&decoded_key);

    let encrypted_data = fetch_from_ipfs_network(&cid).await?;
        
    let decrypted_data = crypto::decrypt_binary_data(&encrypted_data, &aes_key)?;
    
    // Validar tipo multimedia descifrado para evitar XSS
    let content_type = validate_file_magic_bytes(&decrypted_data)?;
    
    if decrypted_data.len() as u64 > MAX_FILE_SIZE {
        return Err("Archivo demasiado grande".to_string());
    }
    
    let b64 = base64::engine::general_purpose::STANDARD.encode(&decrypted_data);
    Ok(format!("data:{};base64,{}", content_type, b64))
}

// === SETUP ===

#[tauri::command]
#[allow(unused_variables)]
fn open_link_safe(url: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let safe_url = url.replace("&", "^&");
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &safe_url])
            .spawn()
            .map_err(|e| format!("Error abriendo link win: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        // Detectar si estamos atrapados en WSL
        let is_wsl = std::fs::read_to_string("/proc/version")
            .unwrap_or_default()
            .to_lowercase()
            .contains("microsoft");

        if is_wsl {
            let safe_url = url.replace("&", "^&");
            std::process::Command::new("wslview")
                .arg(&url)
                .spawn()
                .or_else(|_| {
                    std::process::Command::new("cmd.exe")
                        .args(["/C", "start", "", &safe_url])
                        .spawn()
                })
                .map_err(|e| format!("Error puenteando link a Windows desde WSL: {}", e))?;
        } else {
            std::process::Command::new("xdg-open")
                .arg(&url)
                .spawn()
                .map_err(|e| format!("Error abriendo link lin: {}", e))?;
        }
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| format!("Error abriendo link mac: {}", e))?;
    }
    Ok(())
}

#[cfg(target_os = "android")]
async fn launch_arti_socks_proxy(app_data_dir: PathBuf) {
    use arti_client::{TorClient, TorClientConfig};
    use tokio::net::TcpListener;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let state_dir = app_data_dir.join("arti_state");
    let cache_dir = app_data_dir.join("arti_cache");
    std::fs::create_dir_all(&state_dir).ok();
    std::fs::create_dir_all(&cache_dir).ok();
    
    unsafe {
        std::env::set_var("HOME", app_data_dir.to_str().unwrap_or("/"));
        std::env::set_var("XDG_DATA_HOME", cache_dir.to_str().unwrap_or("/"));
        std::env::set_var("XDG_CONFIG_HOME", state_dir.to_str().unwrap_or("/"));
        std::env::set_var("XDG_CACHE_HOME", cache_dir.to_str().unwrap_or("/"));
        std::env::set_var("ARTI_STATE_DIR", &state_dir);
        std::env::set_var("ARTI_CACHE_DIR", &cache_dir);
    }

    let config = TorClientConfig::default();
    println!("[Arti] Iniciando Tor nativo en Android...");
    
    // Explicit type added to help the compiler
    let client_res = TorClient::<tor_rtcompat::PreferredRuntime>::create_bootstrapped(config).await;
    let client = match client_res {
        Ok(c) => {
            println!("[Arti] Bootstrapping exitoso.");
            c
        },
        Err(e) => {
            eprintln!("[Arti] Error en bootstrap: {}", e);
            return;
        }
    };
    let listener = match TcpListener::bind("127.0.0.1:0").await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[Arti] Error vinculando proxy local Tor SOCKS5: {}", e);
            return;
        }
    };
    let port = match listener.local_addr() {
        Ok(a) => a.port(),
        Err(e) => {
            eprintln!("[Arti] Error obteniendo puerto local TCP: {}", e);
            return;
        }
    };
    
    {
        let mut global_port = GLOBAL_ARTI_SOCKS_PORT.lock().unwrap();
        *global_port = Some(port);
    }
    println!("[Arti] Micro-servidor SOCKS5 escuchando en 127.0.0.1:{}", port);

    loop {
        if let Ok((mut socket, _)) = listener.accept().await {
            let client_clone = client.clone();
            tokio::spawn(async move {
                let mut buf = [0u8; 256];
                if socket.read_exact(&mut buf[0..2]).await.is_err() { return; }
                if buf[0] != 0x05 { return; }
                let nmethods = buf[1] as usize;
                if socket.read_exact(&mut buf[0..nmethods]).await.is_err() { return; }
                if socket.write_all(&[0x05, 0x00]).await.is_err() { return; }
                
                if socket.read_exact(&mut buf[0..4]).await.is_err() { return; }
                if buf[1] != 0x01 { return; } 
                
                let addr_string = match buf[3] {
                    0x01 => { 
                        if socket.read_exact(&mut buf[0..4]).await.is_err() { return; }
                        std::net::Ipv4Addr::new(buf[0], buf[1], buf[2], buf[3]).to_string()
                    },
                    0x03 => { 
                        let mut len_buf = [0u8; 1];
                        if socket.read_exact(&mut len_buf).await.is_err() { return; }
                        let len = len_buf[0] as usize;
                        if socket.read_exact(&mut buf[0..len]).await.is_err() { return; }
                        String::from_utf8_lossy(&buf[0..len]).into_owned()
                    },
                    0x04 => { 
                        if socket.read_exact(&mut buf[0..16]).await.is_err() { return; }
                        let mut arr = [0u8; 16];
                        arr.copy_from_slice(&buf[0..16]);
                        std::net::Ipv6Addr::from(arr).to_string()
                    },
                    _ => return,
                };
                
                if socket.read_exact(&mut buf[0..2]).await.is_err() { return; }
                let port = u16::from_be_bytes([buf[0], buf[1]]);
                
                match client_clone.connect((addr_string.as_str(), port)).await {
                    Ok(mut tor_stream) => {
                        if socket.write_all(&[0x05, 0x00, 0x00, 0x01, 0,0,0,0, 0,0]).await.is_err() { return; }
                        // arti_client::DataStream impl's futures::io::AsyncRead/Write
                        // Para conectar con tokio tcp stream, usamos tokio_util compat
                        // Pero para no agregar tokio-util, usamos un wrapper directo o confiamos en io::copy.
                        // arti-client con feature 'tokio' implementa tokio::io::AsyncRead/Write !
                        let _ = tokio::io::copy_bidirectional(&mut socket, &mut tor_stream).await;
                    },
                    Err(e) => {
                        eprintln!("[Arti] Error conectando: {}", e);
                        let _ = socket.write_all(&[0x05, 0x04, 0x00, 0x01, 0,0,0,0, 0,0]).await;
                    }
                }
            });
        }
    }
}
/// Sube un archivo a catbox.moe desde el backend Rust (evita CORS del WebView en Android)
#[tauri::command]
async fn upload_file_to_catbox(file_bytes: Vec<u8>, file_name: String) -> Result<String, String> {
    let (extension, mime_type) = if file_name.contains('.') {
        // Find extension, though we should still guess mime
        let ext = file_name.split('.').last().unwrap_or("bin");
        let m = match ext.to_lowercase().as_str() {
            "jpg" | "jpeg" => "image/jpeg",
            "png" => "image/png",
            "webp" => "image/webp",
            "gif" => "image/gif",
            "mp4" => "video/mp4",
            "pdf" => "application/pdf",
            "doc" | "docx" => "application/msword",
            "csv" => "text/csv",
            "txt" => "text/plain",
            _ => "application/octet-stream",
        };
        ("", m)
    } else {
        if file_bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
            (".jpg", "image/jpeg")
        } else if file_bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
            (".png", "image/png")
        } else if file_bytes.starts_with(&[b'R', b'I', b'F', b'F']) && file_bytes.len() > 11 && &file_bytes[8..12] == b"WEBP" {
            (".webp", "image/webp")
        } else if file_bytes.starts_with(&[b'G', b'I', b'F', b'8']) {
            (".gif", "image/gif")
        } else if file_bytes.starts_with(&[0x00, 0x00, 0x00]) && file_bytes.len() > 8 && &file_bytes[4..8] == b"ftyp" {
            (".mp4", "video/mp4")
        } else if file_bytes.starts_with(&[0x25, 0x50, 0x44, 0x46]) {
            (".pdf", "application/pdf")
        } else {
            (".bin", "application/octet-stream")
        }
    };
    
    let final_file_name = format!("{}{}", file_name, extension);

    // --- ANONIMIZACION EXIF FORZADA (Red Teaming Hotfix) ---
    // Si la foto es JPG/PNG, la recargamos a su forma base de pixeles y la volvemos a generar desde cero.
    // Esto decodifica unicamente la imagen matrix y aniquila todo el bloque APP1 (EXIF, GPS, Timestamps)
    let mut clean_bytes = file_bytes;
    if mime_type == "image/jpeg" || mime_type == "image/png" {
        if let Ok(img) = ::image::load_from_memory(&clean_bytes) {
            let mut buf = std::io::Cursor::new(Vec::<u8>::new());
            let format = if mime_type == "image/png" {
                ::image::ImageFormat::Png
            } else {
                ::image::ImageFormat::Jpeg
            };
            if img.write_to(&mut buf, format).is_ok() {
                clean_bytes = buf.into_inner();
                println!("[Tor Upload] OBLITERACION EXIF exitosa para Payload Kamikaze.");
            }
        }
    } else if mime_type == "application/pdf" {
        // Red Teaming Phase 3: Stripping PDF Metadata (Legacy Info & Modern XMP Streams)
        if let Ok(mut doc) = lopdf::Document::load_mem(&clean_bytes) {
            doc.trailer.remove(b"Info"); // Destroy Legacy Info
            
            // XMP/XML Scrubber: Iterar erradicando cualquier nodo de Tracking escondido por LibreOffice/Adobe
            let object_ids: Vec<_> = doc.objects.keys().copied().collect();
            for id in object_ids {
                if let Ok(obj) = doc.get_object_mut(id) {
                    if let Ok(dict) = obj.as_dict_mut() {
                        dict.remove(b"Metadata");
                        dict.remove(b"Author");
                        dict.remove(b"Creator");
                        dict.remove(b"Producer");
                        dict.remove(b"CreationDate");
                        dict.remove(b"ModDate");
                    }
                }
            }

            let mut buf = std::io::Cursor::new(Vec::new());
            if doc.save_to(&mut buf).is_ok() {
                clean_bytes = buf.into_inner();
                println!("[Tor Upload] OBLITERACION PDF EXHAUSTIVA (XMP) exitosa para Payload Kamikaze.");
            }
        }
    } else if mime_type.contains("msword") || mime_type.contains("officedocument") || final_file_name.to_lowercase().ends_with(".doc") || final_file_name.to_lowercase().ends_with(".docx") {
        // Red Teaming Phase 4 Remediation: Firewall contra Microsoft Office
        return Err("VULNERABILIDAD ZERO-DAY INTERCEPTADA: Vault bloquea proactivamente la subida de formatos Microsoft Office (.doc/.docx) porque sus firmas internas comprimidas no pueden ser descifradas y sanitizadas de forma 100% confiable en Android. Por tu seguridad forense, debes exportar las páginas de tu Word/Excel como un archivo '.pdf' (o tomar múltiples capturas de pantalla '.jpg') e intentarlo de nuevo. Vault nunca permitirá una fuga lateral de tu nombre de archivo o computadora hacia la red Tor.".to_string());
    }

    let part = reqwest::multipart::Part::bytes(clean_bytes)
        .file_name(final_file_name)
        .mime_str(mime_type)
        .map_err(|e| e.to_string())?;

    let form = reqwest::multipart::Form::new()
        .part("file", part);

    let mut builder = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36")
        .timeout(std::time::Duration::from_secs(60)); // Nostr.build via Tor might be slow

    if let Some(proxy_addr) = detect_tor_proxy().await {
        let proxy_url = format!("socks5h://{}", proxy_addr);
        if let Ok(proxy) = reqwest::Proxy::all(&proxy_url) {
            builder = builder.proxy(proxy);
        }
    } else {
        builder = builder.no_proxy();
    }

    let client = builder.build().map_err(|e| e.to_string())?;
    let res = client
        .post("https://tmpfiles.org/api/v1/upload")
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("Error de red: {:?}", e))?;

    let body_text = res.text().await.map_err(|e| e.to_string())?;
    
    // {"status":"success","data":{"url":"https://tmpfiles.org/12345/image.jpg"}}
    let body: serde_json::Value = serde_json::from_str(&body_text)
        .map_err(|_| format!("Error json tmpfiles: {}", body_text))?;

    if let Some(data) = body.get("data") {
        if let Some(url) = data.get("url").and_then(|u| u.as_str()) {
            // Tmpfiles returns the viewer URL. We must convert it to the direct DL url.
            // https://tmpfiles.org/12345/image.jpg -> https://tmpfiles.org/dl/12345/image.jpg
            let direct_url = url.replace("tmpfiles.org/", "tmpfiles.org/dl/")
                                .replace("http://", "https://");
            return Ok(direct_url);
        }
    }

    Err(format!("Error en el servidor: {}", body_text))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .manage(TorState {
            #[cfg(not(target_os = "android"))]
            child: Mutex::new(None),
            socks_port: Mutex::new(None),
        })
        .manage(IpfsState {
            child: Mutex::new(None),
            ready: Arc::new(Mutex::new(false)),
            repo_path: Mutex::new(String::new()),
        })
        .manage(db::DatabaseState::new())
        .plugin(tauri_plugin_fs::init())
        .setup(|app_handle| {
            let config_dir = app_handle.path().app_data_dir().expect("Sin acceso a app_data_dir");
            if !config_dir.exists() {
                let _ = fs::create_dir_all(&config_dir);
            }

            // === PASO 0: Inicializar Base de Datos Local ===
            {
                let db_state = app_handle.state::<db::DatabaseState>();
                match db::initialize_db(&config_dir) {
                    Ok(conn) => {
                        *db_state.connection.lock().unwrap() = Some(conn);
                        println!("[DB] Base de datos SQLite inicializada en {:?}", config_dir);
                    }
                    Err(e) => {
                        eprintln!("[DB_ERROR] Fallo al iniciar SQLite: {}", e);
                    }
                }
            }
            
            #[cfg(target_os = "android")]
            {
                // Fakeamos que IPFS esta listo enseguida para rutear a fallbacks HTTPS en lugar de esperar un daemon nulo
                let ipfs_state = app_handle.state::<IpfsState>();
                *ipfs_state.ready.lock().unwrap() = true;

                let app_dir_clone = config_dir.clone();
                tauri::async_runtime::spawn(async move {
                    launch_arti_socks_proxy(app_dir_clone).await;
                });
            }
            
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            {
                let shell = app_handle.shell();
                
                // === LANZAR TOR SIDECAR ===
                
            match shell.sidecar("tor").map(|cmd| cmd.args(["--SocksPort", "9050"])) {
                Ok(command) => {
                    match command.spawn() {
                        Ok((mut rx, child)) => {
                            let state = app_handle.state::<TorState>();
                            *state.child.lock().unwrap() = Some(child);
                            tauri::async_runtime::spawn(async move {
                                use tauri_plugin_shell::process::CommandEvent;
                                while let Some(event) = rx.recv().await {
                                    match event {
                                        CommandEvent::Stdout(line) => {
                                            println!("[Tor] {}", String::from_utf8_lossy(&line));
                                        }
                                        CommandEvent::Stderr(line) => {
                                            eprintln!("[Tor ERR] {}", String::from_utf8_lossy(&line));
                                        }
                                        CommandEvent::Terminated(p) => {
                                            println!("[Tor] Terminado: {:?}", p);
                                            break;
                                        }
                                        _ => {}
                                    }
                                }
                            });
                            println!("[OK] Tor sidecar lanzado en puerto 9050");
                        }
                        Err(e) => eprintln!("[WARN] No se pudo lanzar Tor: {}", e),
                    }
                }
                Err(e) => eprintln!("[WARN] Tor no encontrado: {}", e),
            }
            
            // === PREPARAR Y LANZAR IPFS KUBO SIDECAR ===
            // Obtener directorio de datos de la app para aislar el repo IPFS
            let app_data = app_handle.path().app_data_dir()
                .unwrap_or_else(|_| PathBuf::from("/tmp/mensajes-ipfs"));
            let ipfs_repo = app_data.join("ipfs_repo");
            let repo_path_str = ipfs_repo.to_string_lossy().to_string();
            
            // Guardar la ruta del repo en el estado
            {
                let ipfs_state = app_handle.state::<IpfsState>();
                *ipfs_state.repo_path.lock().unwrap() = repo_path_str.clone();
            }
            
            // Preparar repo (limpiar zombies, crear directorio)
            prepare_ipfs_repo(&repo_path_str);
            
            // Obtener lo que necesitamos ANTES del async move
            let app_handle_clone = app_handle.handle().clone();
            let need_init = !ipfs_repo.join("config").exists();
            let ipfs_ready_flag = {
                let s = app_handle.state::<IpfsState>();
                Arc::clone(&s.ready)
            };
            
            // UNA sola tarea async que maneja todo en secuencia:
            // 1. Init (si necesario) → 2. Config seguro → 3. Daemon → 4. Health check
            tauri::async_runtime::spawn(async move {
                let shell = app_handle_clone.shell();
                
                // === PASO 1: Init si es necesario ===
                if need_init {
                    println!("[IPFS] Inicializando repositorio...");
                    match shell.sidecar("ipfs") {
                        Ok(cmd) => {
                            let cmd = cmd
                                .env("IPFS_PATH", &repo_path_str)
                                .args(["init", "--profile=lowpower,server"]);
                            match cmd.spawn() {
                                Ok((mut rx, _child)) => {
                                    use tauri_plugin_shell::process::CommandEvent;
                                    while let Some(event) = rx.recv().await {
                                        match event {
                                            CommandEvent::Stdout(line) => {
                                                println!("[IPFS init] {}", String::from_utf8_lossy(&line));
                                            }
                                            CommandEvent::Stderr(line) => {
                                                eprintln!("[IPFS init] {}", String::from_utf8_lossy(&line));
                                            }
                                            CommandEvent::Terminated(_) => {
                                                println!("[IPFS] Init completado");
                                                break;
                                            }
                                            _ => {}
                                        }
                                    }
                                }
                                Err(e) => {
                                    eprintln!("[IPFS] Error en init: {}", e);
                                    return;
                                }
                            }
                        }
                        Err(e) => {
                            eprintln!("[IPFS] Sidecar no encontrado para init: {}", e);
                            return;
                        }
                    }
                }
                
                // === PASO 2: Escribir config seguro ===
                let config_path = PathBuf::from(&repo_path_str).join("config");
                if let Err(e) = apply_secure_ipfs_config(&config_path) {
                    eprintln!("[IPFS] Error escribiendo config seguro: {}", e);
                    return;
                }
                println!("[IPFS] Config seguro aplicado");
                
                // === PASO 3: Lanzar daemon ===
                println!("[IPFS] Lanzando daemon...");
                match shell.sidecar("ipfs") {
                    Ok(cmd) => {
                        let cmd = cmd
                            .env("IPFS_PATH", &repo_path_str)
                            .args(["daemon", "--enable-gc"]);
                        match cmd.spawn() {
                            Ok((mut rx, child)) => {
                                println!("[OK] IPFS daemon lanzado (repo: {})", repo_path_str);
                                {
                                    let ipfs_state = app_handle_clone.state::<IpfsState>();
                                    *ipfs_state.child.lock().unwrap() = Some(child);
                                }
                                
                                // === PASO 4: Health check en paralelo ===
                                let ready_hc = Arc::clone(&ipfs_ready_flag);
                                tokio::spawn(async move {
                                    let client = reqwest::Client::new();
                                    let url = format!("http://127.0.0.1:{}/api/v0/id", IPFS_API_PORT);
                                    for i in 0..30 {
                                        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                                        match client.post(&url).send().await {
                                            Ok(resp) if resp.status().is_success() => {
                                                *ready_hc.lock().unwrap() = true;
                                                println!("[IPFS] Nodo listo! (intento {})", i + 1);
                                                return;
                                            }
                                            Ok(resp) => {
                                                println!("[IPFS] Health check intento {}: status {}", i + 1, resp.status());
                                            }
                                            Err(e) => {
                                                println!("[IPFS] Health check intento {}: {}", i + 1, e);
                                            }
                                        }
                                    }
                                    eprintln!("[IPFS] Timeout: nodo no respondio en 60s");
                                });
                                
                                // Monitor stdout/stderr del daemon
                                use tauri_plugin_shell::process::CommandEvent;
                                while let Some(event) = rx.recv().await {
                                    match event {
                                        CommandEvent::Stdout(line) => {
                                            println!("[IPFS] {}", String::from_utf8_lossy(&line));
                                        }
                                        CommandEvent::Stderr(line) => {
                                            eprintln!("[IPFS ERR] {}", String::from_utf8_lossy(&line));
                                        }
                                        CommandEvent::Terminated(p) => {
                                            println!("[IPFS] Daemon terminado: {:?}", p);
                                            *ipfs_ready_flag.lock().unwrap() = false;
                                            break;
                                        }
                                        _ => {}
                                    }
                                }
                            }
                            Err(e) => eprintln!("[IPFS] Error lanzando daemon: {}", e),
                        }
                    }
                    Err(e) => eprintln!("[IPFS] Sidecar no encontrado: {}", e),
                }
                });
            }

            #[cfg(any(target_os = "android", target_os = "ios"))]
            {
                println!("[INFO] Sistema móvil detectado. Se omite la inyección de sidecars nativos (Tor y Kubo).");
                // NOTA: TorState y IpfsState mantendrán sus procesos hijos (child) como None por defecto.
                // El frontend reaccionará a esto asumiendo carga / fallback.
            }
            
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            check_db_initialized,
            setup_master_password,
            login_with_password,
            change_panic_password_cmd,
            change_master_password_cmd,
            get_saved_identities,
            get_identity_secret,
            save_identity,
            import_identity,
            save_my_report_command,
            get_my_reports_command,
            get_setting,
            save_setting,
            generate_nostr_keys,
            publish_report,
            publish_reply,
            fetch_global_feed,
            search_nostr_events,
            fetch_trending_tags,
            check_tor_status,
            react_to_event,
            check_ipfs_status,
            upload_to_ipfs,
            fetch_ipfs_media,
            send_direct_message,
            fetch_direct_messages,
            create_channel,
            fetch_channels,
            send_channel_message,
            fetch_channel_messages,
            save_contact,
            get_contacts,
            delete_contact,
            toggle_follow,
            toggle_block,
            get_following,
            get_blocked,
            save_channel,
            remove_saved_channel,
            get_saved_channels,
            upload_to_ipfs_encrypted,
            fetch_ipfs_media_decrypted,
            open_link_safe,
            upload_file_to_catbox
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
