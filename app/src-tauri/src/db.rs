/**
 * ============================================================================
 * ARCHIVO: db.rs
 * ============================================================================
 * PROPOSITO:
 * Administrar la base de datos local SQLite (boveda.db) donde guardaremos
 * los "Fantasmas" (Identidades) y el historial de posts.
 * 
 * ARQUITECTURA PARA JUNIORS:
 * - rusqlite: Libreria rust que nos permite enviar comandos `SELECT` o `INSERT`
 *   a un archivo local ligero que simula ser un servidor de base de datos.
 * - Archivo `boveda.db`: Se guardara en la "Data Folder" del App OS 
 *   (ej. Roaming en Windows).
 * - IMPORTANTE: Todos los metodos de lectura/escritura usan las sentencias 
 *   SQL PREPARADAS (`?1`, `?2`) para prevenir ataques de inyeccion SQL.
 * 
 * ADVERTENCIA (Efectos sec.):
 * Llama al disco duro OS. Si la carpeta root no existe, la crea.
 * ============================================================================
 */

use rusqlite::{params, Connection, Result as SqlResult};
use std::path::PathBuf;
use crate::crypto::{derive_key_from_password, encrypt_data, decrypt_data, generate_random_salt};

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct IdentityRecord {
    pub id: i32,
    pub alias: String,
    pub pubkey: String,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct ContactRecord {
    pub id: i32,
    pub alias: String,
    pub pubkey: String,
    pub is_following: bool,
    pub is_blocked: bool,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct SavedChannel {
    pub id: String,
    pub name: String,
    pub about: String,
    pub pubkey: String,
    pub picture: String,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct DMEvent {
    pub id: String,
    pub sender_pubkey: String,
    pub recipient_pubkey: String,
    pub content: String,
    pub created_at: i64,
}

/// Estado global inyectable en Tauri para manejar la conexion a BD
pub struct DatabaseState {
    pub connection: std::sync::Mutex<Option<Connection>>,
}

impl DatabaseState {
    pub fn new() -> Self {
        Self {
            connection: std::sync::Mutex::new(None),
        }
    }
}

/// Crea el archivo de base de datos si no existe, o se conecta a el.
/// Diseña las tablas necesarias `identities` y `my_reports`.
pub fn initialize_db(app_data_dir: &PathBuf) -> SqlResult<Connection> {
    let db_path = app_data_dir.join("boveda.db");
    let conn = Connection::open(&db_path)?;

    // La tabla Master Secrets guarda el 'Salt' publico para el Argon2 y el hash de panico
    conn.execute(
        "CREATE TABLE IF NOT EXISTS master_secrets (
            id INTEGER PRIMARY KEY,
            salt TEXT NOT NULL,
            panic_hash TEXT
        )",
        [],
    )?;

    // Migracion: Si la base de datos es antigua y no tenia panic_hash, se lo agregamos
    let _ = conn.execute("ALTER TABLE master_secrets ADD COLUMN panic_hash TEXT", []);

    // Identidades del usuario (Llaves Nostr)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS identities (
            id INTEGER PRIMARY KEY,
            alias TEXT NOT NULL,
            pubkey TEXT NOT NULL UNIQUE,
            encrypted_nsec BLOB NOT NULL
        )",
        [],
    )?;

    // Historial de Denuncias Propias
    conn.execute(
        "CREATE TABLE IF NOT EXISTS my_reports (
            id INTEGER PRIMARY KEY,
            event_id TEXT NOT NULL,
            content_excerpt TEXT NOT NULL,
            encrypted_content BLOB NOT NULL,
            created_at INTEGER NOT NULL
        )",
        [],
    )?;

    // Configuraciones de Usuario
    conn.execute(
        "CREATE TABLE IF NOT EXISTS user_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )",
        [],
    )?;

    // Libreta de Contactos
    conn.execute(
        "CREATE TABLE IF NOT EXISTS contacts (
            id INTEGER PRIMARY KEY,
            alias TEXT NOT NULL,
            pubkey TEXT NOT NULL UNIQUE,
            is_following BOOLEAN NOT NULL DEFAULT 0,
            is_blocked BOOLEAN NOT NULL DEFAULT 0
        )",
        [],
    )?;

    // Migraciones en caso de que la app se actualice sin wipes
    let _ = conn.execute("ALTER TABLE contacts ADD COLUMN is_following BOOLEAN NOT NULL DEFAULT 0", []);
    let _ = conn.execute("ALTER TABLE contacts ADD COLUMN is_blocked BOOLEAN NOT NULL DEFAULT 0", []);

    // Mis Grupos (Canales Guardados)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS saved_channels (
            channel_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            about TEXT NOT NULL,
            pubkey TEXT NOT NULL,
            picture TEXT NOT NULL
        )",
        [],
    )?;

    // Historial Persistente de DMs (Mensajes Directos Cifrados NIP-04)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS dm_history (
            id TEXT PRIMARY KEY,
            sender_pubkey TEXT NOT NULL,
            recipient_pubkey TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at INTEGER NOT NULL
        )",
        [],
    )?;

    Ok(conn)
}

/// Configura por primera vez la boveda (registra el salt de Argon2 y opcionalmente el panic_password)
pub fn setup_master_password(conn: &Connection, panic_password: Option<&str>) -> Result<String, String> {
    // Revisar si ya hay un salt
    let mut stmt = conn.prepare("SELECT salt FROM master_secrets LIMIT 1").map_err(|e| e.to_string())?;
    
    let existing_salt: Option<String> = stmt.query_row([], |row| row.get(0)).ok();
    
    if let Some(salt) = existing_salt {
        Ok(salt) // La boveda ya ha sido configurada
    } else {
        // Configuracion inicial: Crear un salt nuevo y guardarlo 
        let new_salt = generate_random_salt();
        
        let panic_hash_opt = if let Some(pp) = panic_password {
            // Guardamos un hash basico del panic_password usando el mismo Argon2 pero sin ser AES key
            // Usamos derive_key_from_password para obtener bytes y los pasamos a hex
            let key_bytes = derive_key_from_password(pp, &new_salt)?;
            Some(hex::encode(key_bytes))
        } else {
            None
        };

        conn.execute(
            "INSERT INTO master_secrets (salt, panic_hash) VALUES (?1, ?2)",
            params![new_salt, panic_hash_opt],
        ).map_err(|e| e.to_string())?;
        
        Ok(new_salt)
    }
}

/// Devuelve el Salt de configuracion si existe
pub fn get_master_salt(conn: &Connection) -> Result<String, String> {
    let mut stmt = conn.prepare("SELECT salt FROM master_secrets LIMIT 1").map_err(|e| e.to_string())?;
    let salt: String = stmt.query_row([], |row| row.get(0)).map_err(|_| "La boveda no ha sido inicializada.".to_string())?;
    Ok(salt)
}

/// Testea si es el password maestro, o si es el password de panico.
/// Retorna `Ok(true)` si login exito, `Ok(false)` si incorrecto, o devuelve un Error especial si hubo wipe ("WIPED").
pub fn is_password_correct(conn: &Connection, guess_password: &str) -> Result<bool, String> {
    // 1. Verificamos si es un Password de Panico
    let mut stmt_panic = conn.prepare("SELECT salt, panic_hash FROM master_secrets LIMIT 1").map_err(|e| e.to_string())?;
    let row_result = stmt_panic.query_row([], |row| {
        let salt: String = row.get(0)?;
        let hash: Option<String> = row.get(1)?;
        Ok((salt, hash))
    });

    if let Ok((salt, Some(saved_panic_hash))) = row_result {
        // Comprobar si coincide con el de panico
        let guess_hash_bytes = derive_key_from_password(guess_password, &salt)?;
        let guess_hash = hex::encode(guess_hash_bytes);
        if guess_hash == saved_panic_hash {
            // ==========================================
            // ALERTA: PASSWORD DE PANICO ACTIVADO. WIPE.
            // ==========================================
            wipe_all_data(conn)?;
            return Err("WIPED".to_string());
        }
    }

    // 2. Si no fue panico, chequear si es el maestro normal
    let salt = get_master_salt(conn)?;
    let aes_key = derive_key_from_password(guess_password, &salt)?;

    let mut stmt = conn.prepare("SELECT encrypted_nsec FROM identities LIMIT 1").map_err(|e| e.to_string())?;
    let first_identity: Option<Vec<u8>> = stmt.query_row([], |row| row.get(0)).ok();

    match first_identity {
        Some(encrypted_blob) => {
            match decrypt_data(&encrypted_blob, &aes_key) {
                Ok(_) => Ok(true), // Desbloqueado!
                Err(_) => Ok(false), // Password incorrecto
            }
        },
        None => {
            // No hay identidades guardadas. Si llego aqui, la base de datos esta en estado limpio o solo configurada
            Ok(true)
        }
    }
}

/// Borra absolutamente todos los registros (Tablas: identities, my_reports, master_secrets)
/// Se asegura de dejar SQLite lo mas limpio posible sobreescribiendo
pub fn wipe_all_data(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "DELETE FROM identities;
         DELETE FROM my_reports;
         DELETE FROM master_secrets;
         DELETE FROM user_settings;
         DELETE FROM contacts;
         DELETE FROM saved_channels;
         DELETE FROM dm_history;
         VACUUM;"
    ).map_err(|e| e.to_string())?;
    Ok(())
}

/// Recupera todas las identidades listando solamente su "Alias" y su parte publica (Pubkey)
pub fn get_all_identities_public(conn: &Connection) -> Result<Vec<IdentityRecord>, String> {
    let mut stmt = conn.prepare("SELECT id, alias, pubkey FROM identities").map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| {
        Ok(IdentityRecord {
            id: row.get(0)?,
            alias: row.get(1)?,
            pubkey: row.get(2)?,
        })
    }).map_err(|e| e.to_string())?;

    let mut idents = Vec::new();
    for r in rows {
        if let Ok(ident) = r {
            idents.push(ident);
        }
    }
    Ok(idents)
}

/// Extrae la llave secreta en texto plano (PELIGROSO) de una identidad particular. 
/// Esta funcion solo debe usarse en memoria durante el uso de la aplicacion y borrarse rapido.
pub fn get_decrypted_nsec(conn: &Connection, id: i32, master_password: &str) -> Result<String, String> {
    let salt = get_master_salt(conn)?;
    let aes_key = derive_key_from_password(master_password, &salt)?;

    let mut stmt = conn.prepare("SELECT encrypted_nsec FROM identities WHERE id = ?1").map_err(|e| e.to_string())?;
    let encrypted_blob: Vec<u8> = stmt.query_row(params![id], |row| row.get(0)).map_err(|e| e.to_string())?;

    // Desencriptar
    let nsec_plaintext = decrypt_data(&encrypted_blob, &aes_key)?;
    Ok(nsec_plaintext)
}

/// Crea y protege una nueva llave de Nostr guardandola fuertemente cifrada en el disco usando la contrasena 
pub fn save_new_identity(conn: &Connection, alias: &str, pubkey: &str, nsec_plaintext: &str, master_password: &str) -> Result<(), String> {
    let salt = get_master_salt(conn)?;
    let aes_key = derive_key_from_password(master_password, &salt)?;

    let encrypted_blob = encrypt_data(nsec_plaintext, &aes_key)?;

    conn.execute(
        "INSERT Into identities (alias, pubkey, encrypted_nsec) VALUES (?1, ?2, ?3)",
        params![alias, pubkey, encrypted_blob],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

/// Registra una denuncia publicada en el disco local cifrando el contenido.
/// Se guarda un extracto corto en texto plano solo si se desea para no tener que descifrar toda la base para hacer la lista.
pub fn save_my_report(conn: &Connection, event_id: &str, content_plaintext: &str, master_password: &str) -> Result<(), String> {
    let salt = get_master_salt(conn)?;
    let aes_key = derive_key_from_password(master_password, &salt)?;

    let encrypted_blob = encrypt_data(content_plaintext, &aes_key)?;

    // Guardar los primeros 50 caracteres como extracto
    let mut excerpt = String::from_utf8_lossy(content_plaintext.as_bytes()).to_string();
    excerpt.truncate(50);
    if content_plaintext.len() > 50 {
        excerpt.push_str("...");
    }

    let timestamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64;

    conn.execute(
        "INSERT Into my_reports (event_id, content_excerpt, encrypted_content, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![event_id, excerpt, encrypted_blob, timestamp],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct ReportRecord {
    pub id: i32,
    pub event_id: String,
    pub excerpt: String,
    pub decrypted_content: Option<String>,
    pub created_at: i64,
}

/// Recupera todas las denuncias locales y las descifra On-The-Fly en la memoria RAM.
pub fn get_my_reports(conn: &Connection, master_password: &str) -> Result<Vec<ReportRecord>, String> {
    let salt = get_master_salt(conn)?;
    let aes_key = derive_key_from_password(master_password, &salt)?;

    let mut stmt = conn.prepare("SELECT id, event_id, content_excerpt, encrypted_content, created_at FROM my_reports ORDER BY created_at DESC").map_err(|e| e.to_string())?;
    
    let rows = stmt.query_map([], |row| {
        let id: i32 = row.get(0)?;
        let event_id: String = row.get(1)?;
        let excerpt: String = row.get(2)?;
        let encrypted_blob: Vec<u8> = row.get(3)?;
        let created_at: i64 = row.get(4)?;
        Ok((id, event_id, excerpt, encrypted_blob, created_at))
    }).map_err(|e| e.to_string())?;

    let mut reports = Vec::new();
    for r in rows {
        if let Ok((id, event_id, excerpt, encrypted_blob, created_at)) = r {
            let decrypted_content = decrypt_data(&encrypted_blob, &aes_key).ok();
            reports.push(ReportRecord {
                id,
                event_id,
                excerpt,
                decrypted_content,
                created_at,
            });
        }
    }
    
    Ok(reports)
}

// === FUNCIONES DE SEGURIDAD Y CAMBIO DE CONTRASEÑA ===

/// Configura o cambia EXCLUSIVAMENTE la Contraseña de Pánico.
/// Requiere la contraseña maestra actual para validar la accion.
pub fn change_panic_password(conn: &Connection, current_master: &str, new_panic: &str) -> Result<(), String> {
    // 1. Validar que la contraseña maestra sea correcta (y no la de panico)
    if !is_password_correct(conn, current_master)? {
        return Err("Contraseña maestra incorrecta".to_string());
    }

    // 2. Obtener el salt publico actual 
    let salt = get_master_salt(conn)?;

    // 3. Hashear la nueva contraseña de panico usando el mismo Argon2 y salt
    let key_bytes = derive_key_from_password(new_panic, &salt)?;
    let new_panic_hash = hex::encode(key_bytes);

    // 4. Actualizar la base de datos
    conn.execute(
        "UPDATE master_secrets SET panic_hash = ?1",
        params![new_panic_hash],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

/// Cambia la Contraseña Maestra (Re-encriptacion total)
/// Descifra en memoria (RAM) todas las identidades y alertas, crea un nuevo Salt,
/// re-hashea la contraseña de pánico existente (si la hay) con el nuevo Salt,
/// borra la base antigua, y re-inserta todo de forma atómica en SQLite.
pub fn change_master_password(conn: &mut Connection, current_master: &str, new_master: &str) -> Result<(), String> {
    // 1. Validar contraseña maestra actual (esto tambien explotara si mete la de panico)
    if !is_password_correct(conn, current_master)? {
        return Err("Contraseña actual incorrecta".to_string());
    }

    // --- FASE DE LECTURA (En memoria) ---
    // Usamos el password antiguo para descifrar todo y guardarlo en vectores temporales
    let old_salt = get_master_salt(conn)?;
    let old_aes_key = derive_key_from_password(current_master, &old_salt)?;

    let mut temp_identities = Vec::new();
    let mut temp_reports = Vec::new();

    {
        // Leer Identidades en claro
        let mut stmt_id = conn.prepare("SELECT alias, pubkey, encrypted_nsec FROM identities")
            .map_err(|e| format!("Error preparando consulta identidades: {}", e))?;
        let rows_id = stmt_id.query_map([], |row| {
            let alias: String = row.get(0)?;
            let pubkey: String = row.get(1)?;
            let blob: Vec<u8> = row.get(2)?;
            Ok((alias, pubkey, blob))
        }).map_err(|e| format!("Error leyendo identidades SQLite: {}", e))?;

        for r in rows_id {
            if let Ok((alias, pubkey, blob)) = r {
                let nsec_claro = decrypt_data(&blob, &old_aes_key)?;
                temp_identities.push((alias, pubkey, nsec_claro));
            }
        }
    }

    {
        // Leer Reportes en claro
        let mut stmt_rep = conn.prepare("SELECT event_id, encrypted_content, created_at FROM my_reports")
            .map_err(|e| format!("Error preparando consulta reportes: {}", e))?;
        let rows_rep = stmt_rep.query_map([], |row| {
            let event_id: String = row.get(0)?;
            let blob: Vec<u8> = row.get(1)?;
            let created_at: i64 = row.get(2)?;
            Ok((event_id, blob, created_at))
        }).map_err(|e| format!("Error leyendo reportes SQLite: {}", e))?;

        for r in rows_rep {
            if let Ok((event_id, blob, created_at)) = r {
                let content_claro = decrypt_data(&blob, &old_aes_key)?;
                temp_reports.push((event_id, content_claro, created_at));
            }
        }
    }

    // Averiguar si tenia Panic Hash para saber si tratar de preservarlo o solo vaciarlo. 
    // Para simplificar: le pediremos al usuario configurarlo de nuevo si quiere.
    // Limpiamos el panic hash por seguridad en vez de recrearlo.

    // --- FASE DE ESCRITURA ATM (Transaccion SQL) ---
    // Si algo falla a la mitad, SQLite hara rollback.
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    // Borramos todo
    tx.execute_batch("DELETE FROM identities; DELETE FROM my_reports; DELETE FROM master_secrets;")
        .map_err(|e| format!("Transaccion fallida limpiando: {}", e))?;

    // Generamos nuevas llaves
    let new_salt = generate_random_salt();
    let new_aes_key = derive_key_from_password(new_master, &new_salt)?;

    // Guardamos nuevo entorno
    tx.execute(
        "INSERT INTO master_secrets (salt, panic_hash) VALUES (?1, NULL)",
        params![new_salt],
    ).map_err(|e| format!("Transaccion fallida seteando salt: {}", e))?;

    // Reinsertamos Identidades
    for (alias, pubkey, nsec_claro) in &temp_identities {
        let encrypted_nsec = encrypt_data(nsec_claro, &new_aes_key)?;
        tx.execute(
            "INSERT INTO identities (alias, pubkey, encrypted_nsec) VALUES (?1, ?2, ?3)",
            params![alias, pubkey, encrypted_nsec],
        ).map_err(|e| format!("Transaccion fallida recifrando identidades: {}", e))?;
    }

    // Reinsertamos Reportes
    for (event_id, content_claro, created_at) in &temp_reports {
        let encrypted_content = encrypt_data(content_claro, &new_aes_key)?;
        
        let mut excerpt = String::from_utf8_lossy(content_claro.as_bytes()).to_string();
        excerpt.truncate(50);
        if content_claro.len() > 50 { excerpt.push_str("..."); }

        tx.execute(
            "INSERT INTO my_reports (event_id, content_excerpt, encrypted_content, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![event_id, excerpt, encrypted_content, created_at],
        ).map_err(|e| format!("Transaccion fallida recifrando reportes: {}", e))?;
    }

    // Aplicar la transaccion atómica al disco duro (Commmit / Flush a SQLite).
    tx.commit().map_err(|e| format!("Fallo el commit en SQLite: {}", e))?;

    Ok(())
}

/// Guarda o actualiza un ajuste en SQLite
pub fn save_setting(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO user_settings (key, value) VALUES (?1, ?2) 
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

/// Recupera un ajuste específico o un valor por defecto
pub fn get_setting(conn: &Connection, key: &str, default_val: &str) -> Result<String, String> {
    let mut stmt = match conn.prepare("SELECT value FROM user_settings WHERE key = ?1") {
        Ok(stmt) => stmt,
        Err(e) => return Err(e.to_string()),
    };
    
    match stmt.query_row(params![key], |row| row.get(0)) {
        Ok(val) => Ok(val),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(default_val.to_string()),
        Err(e) => Err(e.to_string()),
    }
}

/// Borra un ajuste específico
pub fn delete_setting(conn: &Connection, key: &str) -> Result<(), String> {
    conn.execute(
        "DELETE FROM user_settings WHERE key = ?1",
        params![key],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

// === LIBRETA DE CONTACTOS ===

/// Agrega o actualiza un alias de contacto.
pub fn save_contact(conn: &Connection, alias: &str, pubkey: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO contacts (alias, pubkey) VALUES (?1, ?2) 
         ON CONFLICT(pubkey) DO UPDATE SET alias = excluded.alias",
        params![alias, pubkey],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

/// Recupera toda la libreta de contactos (ordenados por alias)
pub fn get_all_contacts(conn: &Connection) -> Result<Vec<ContactRecord>, String> {
    let mut stmt = conn.prepare("SELECT id, alias, pubkey, is_following, is_blocked FROM contacts ORDER BY alias ASC").map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| {
        Ok(ContactRecord {
            id: row.get(0)?,
            alias: row.get(1)?,
            pubkey: row.get(2)?,
            is_following: row.get(3)?,
            is_blocked: row.get(4)?,
        })
    }).map_err(|e| e.to_string())?;

    let mut contacts = Vec::new();
    for r in rows {
        if let Ok(contact) = r {
            contacts.push(contact);
        }
    }
    Ok(contacts)
}

/// Elimina un contacto especifico
pub fn delete_contact(conn: &Connection, pubkey: &str) -> Result<(), String> {
    conn.execute(
        "DELETE FROM contacts WHERE pubkey = ?1",
        params![pubkey],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

/// Alterna si seguimos a alguien (lo inserta con alias basico si no existia)
pub fn toggle_contact_follow(conn: &Connection, pubkey: &str) -> Result<bool, String> {
    let mut is_following: bool = false;
    let fallback_alias = format!("Desconocido_{}", &pubkey[..8]);
    
    // Primero garantizamos que exista el registro
    conn.execute(
        "INSERT OR IGNORE INTO contacts (alias, pubkey) VALUES (?1, ?2)",
        params![fallback_alias, pubkey],
    ).map_err(|e| e.to_string())?;

    // Leemos el estado actual
    if let Ok(current) = conn.query_row("SELECT is_following FROM contacts WHERE pubkey = ?1", params![pubkey], |row| row.get::<_, bool>(0)) {
        is_following = !current;
        conn.execute("UPDATE contacts SET is_following = ?1 WHERE pubkey = ?2", params![is_following, pubkey]).map_err(|e| e.to_string())?;
    }
    Ok(is_following)
}

/// Alterna si bloqueamos a alguien (lo inserta con alias basico si no existia)
pub fn toggle_contact_block(conn: &Connection, pubkey: &str) -> Result<bool, String> {
    let mut is_blocked: bool = false;
    let fallback_alias = format!("Desconocido_{}", &pubkey[..8]);
    
    conn.execute(
        "INSERT OR IGNORE INTO contacts (alias, pubkey) VALUES (?1, ?2)",
        params![fallback_alias, pubkey],
    ).map_err(|e| e.to_string())?;

    if let Ok(current) = conn.query_row("SELECT is_blocked FROM contacts WHERE pubkey = ?1", params![pubkey], |row| row.get::<_, bool>(0)) {
        is_blocked = !current;
        conn.execute("UPDATE contacts SET is_blocked = ?1 WHERE pubkey = ?2", params![is_blocked, pubkey]).map_err(|e| e.to_string())?;
    }
    Ok(is_blocked)
}

/// Recupera todas las pubkeys que seguimos
pub fn get_following_pubkeys(conn: &Connection) -> Result<Vec<String>, String> {
    let mut stmt = conn.prepare("SELECT pubkey FROM contacts WHERE is_following = 1").map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| row.get(0)).map_err(|e| e.to_string())?;
    let mut keys = Vec::new();
    for r in rows {
        if let Ok(k) = r { keys.push(k); }
    }
    Ok(keys)
}

/// Recupera todas las pubkeys bloqueadas
pub fn get_blocked_pubkeys(conn: &Connection) -> Result<Vec<String>, String> {
    let mut stmt = conn.prepare("SELECT pubkey FROM contacts WHERE is_blocked = 1").map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| row.get(0)).map_err(|e| e.to_string())?;
    let mut keys = Vec::new();
    for r in rows {
        if let Ok(k) = r { keys.push(k); }
    }
    Ok(keys)
}

// === MIS GRUPOS (CANALES GUARDADOS) ===

pub fn save_channel(conn: &Connection, id: &str, name: &str, about: &str, pubkey: &str, picture: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO saved_channels (channel_id, name, about, pubkey, picture) VALUES (?1, ?2, ?3, ?4, ?5) 
         ON CONFLICT(channel_id) DO UPDATE SET name = excluded.name, about = excluded.about, picture = excluded.picture",
        params![id, name, about, pubkey, picture],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn remove_saved_channel(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute(
        "DELETE FROM saved_channels WHERE channel_id = ?1",
        params![id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_saved_channels(conn: &Connection) -> Result<Vec<SavedChannel>, String> {
    let mut stmt = conn.prepare("SELECT channel_id, name, about, pubkey, picture FROM saved_channels ORDER BY name ASC").map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| {
        Ok(SavedChannel {
            id: row.get(0)?,
            name: row.get(1)?,
            about: row.get(2)?,
            pubkey: row.get(3)?,
            picture: row.get(4)?,
        })
    }).map_err(|e| e.to_string())?;

    let mut channels = Vec::new();
    for r in rows {
        if let Ok(ch) = r {
            channels.push(ch);
        }
    }
    Ok(channels)
}

// === HISTORIAL PERSISTENTE DE DMs ===

pub fn save_dm_event(conn: &Connection, id: &str, sender: &str, recipient: &str, content: &str, created_at: i64) -> Result<(), String> {
    conn.execute(
        "INSERT OR IGNORE INTO dm_history (id, sender_pubkey, recipient_pubkey, content, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, sender, recipient, content, created_at],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_dm_events(conn: &Connection, pubkey_a: &str, pubkey_b: &str) -> Result<Vec<DMEvent>, String> {
    let mut stmt = conn.prepare(
        "SELECT id, sender_pubkey, recipient_pubkey, content, created_at 
         FROM dm_history 
         WHERE (sender_pubkey = ?1 AND recipient_pubkey = ?2) 
            OR (sender_pubkey = ?2 AND recipient_pubkey = ?1)
         ORDER BY created_at ASC"
    ).map_err(|e| e.to_string())?;
    
    let rows = stmt.query_map(params![pubkey_a, pubkey_b], |row| {
        Ok(DMEvent {
            id: row.get(0)?,
            sender_pubkey: row.get(1)?,
            recipient_pubkey: row.get(2)?,
            content: row.get(3)?,
            created_at: row.get(4)?,
        })
    }).map_err(|e| e.to_string())?;

    let mut events = Vec::new();
    for r in rows {
        if let Ok(ev) = r {
            events.push(ev);
        }
    }
    Ok(events)
}
