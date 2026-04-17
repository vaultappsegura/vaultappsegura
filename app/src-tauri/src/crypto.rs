/**
 * ============================================================================
 * ARCHIVO: crypto.rs
 * ============================================================================
 * PROPOSITO:
 * Centralizar toda la logica de criptografia local (Client-Side Encryption)
 * de alto nivel. Esto garantiza que las llaves privadas de Nostr (nsec)
 * no se guarden jamas en texto plano en el disco duro.
 *
 * ARQUITECTURA PARA JUNIORS:
 * - Argon2: Es un algoritmo seguro que toma el password que teclea el usuario
 *   y lo convierte matematicamente en una clave secreta de 32 bytes constante.
 *   Esto previene ataques de fuerza bruta.
 * - AES-GCM 256: Usamos la clave de 32 bytes de Argon2 para cifrar (bloquear)
 *   o descifrar (desbloquear) datos secretos (como el `nsec`).
 * - "Nonce" / "Salt": Numeros aleatorios generados en cada cifrado para 
 *   asegurar que aunque cifres la misma palabra dos veces, el resultado 
 *   final sea distinto e indescifrable, lo que previene deducciones matematicas.
 * ============================================================================
 */

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use argon2::{
    password_hash::{rand_core::OsRng, PasswordHasher, SaltString},
    Argon2,
};
use rand::RngCore;

// Constantes de tamano
const NONCE_LEN: usize = 12; // Standard GCM nonce size

/// Deriva una llave AES de 32 bytes a partir del password ingresado
/// usando Argon2 y un Salt aleatorio/guardado.
pub fn derive_key_from_password(password: &str, salt_str: &str) -> Result<[u8; 32], String> {
    let argon2_instance = Argon2::default();
    
    // Convertimos el string simple a un formato seguro SaltString
    let salt = SaltString::from_b64(salt_str).map_err(|e| format!("Salt error: {}", e))?;
    
    // Hasheamos el password
    let password_hash = argon2_instance
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| format!("Error hash password: {}", e))?;
        
    // Extraemos la semilla cruda como arreglo de 32-bytes para AES
    let hash_output = password_hash.hash.ok_or("Hash output is none")?;
    let mut key = [0u8; 32];
    let bytes = hash_output.as_bytes();
    
    if bytes.len() < 32 {
        return Err("Hash derived too short".into());
    }
    
    key.copy_from_slice(&bytes[..32]);
    Ok(key)
}

/// Genera un String aleatorio Base64 para usarlo como Salt publico en la DB
pub fn generate_random_salt() -> String {
    let salt = SaltString::generate(&mut OsRng);
    salt.as_str().to_string()
}

/// Cifra un texto plano (`data`) con GCM y devuelve los bytes combinados: [Nonce(12)] + [Ciphertext + MAC]
pub fn encrypt_data(data: &str, aes_key: &[u8; 32]) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new(aes_key.into());

    // Generar 12 bytes aleatorios para el Nonce
    let mut nonce_bytes = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    // Cifrar la informacion
    let ciphertext = cipher
        .encrypt(nonce, data.as_bytes())
        .map_err(|e| format!("Error cifrando: {}", e))?;

    // Empaquetar el Nonce junto con los datos (necesitaremos el Nonce para abrirlos despues)
    let mut final_blob = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    final_blob.extend_from_slice(&nonce_bytes);
    final_blob.extend_from_slice(&ciphertext);

    Ok(final_blob)
}

/// Toma el bloque [Nonce]+[Cifrado] y lo intenta descifrar usando la contrasena 
pub fn decrypt_data(encrypted_blob: &[u8], aes_key: &[u8; 32]) -> Result<String, String> {
    if encrypted_blob.len() <= NONCE_LEN {
        return Err("Blob data is too short to contain nonce".into());
    }

    // Separamos el candado (nonce) de los datos en si
    let (nonce_bytes, ciphertext) = encrypted_blob.split_at(NONCE_LEN);
    let nonce = Nonce::from_slice(nonce_bytes);

    let cipher = Aes256Gcm::new(aes_key.into());

    let plaintext_bytes = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| format!("Contraseña incorrecta o datos corruptos: {}", e))?;

    String::from_utf8(plaintext_bytes).map_err(|e| format!("UTF8 Error: {}", e))
}

/// Cifra binario crudo (`data`) con GCM y devuelve [Nonce(12)] + [Ciphertext + MAC]
pub fn encrypt_binary_data(data: &[u8], aes_key: &[u8; 32]) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new(aes_key.into());

    let mut nonce_bytes = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, data)
        .map_err(|e| format!("Error cifrando binarios: {}", e))?;

    let mut final_blob = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    final_blob.extend_from_slice(&nonce_bytes);
    final_blob.extend_from_slice(&ciphertext);

    Ok(final_blob)
}

/// Toma el bloque binario [Nonce]+[Cifrado] y lo intenta descifrar usando la llave
pub fn decrypt_binary_data(encrypted_blob: &[u8], aes_key: &[u8; 32]) -> Result<Vec<u8>, String> {
    if encrypted_blob.len() <= NONCE_LEN {
        return Err("Blob data is too short to contain nonce".into());
    }

    let (nonce_bytes, ciphertext) = encrypted_blob.split_at(NONCE_LEN);
    let nonce = Nonce::from_slice(nonce_bytes);

    let cipher = Aes256Gcm::new(aes_key.into());

    let plaintext_bytes = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| format!("Contraseña incorrecta o datos corruptos al descifrar binario: {}", e))?;

    Ok(plaintext_bytes)
}
