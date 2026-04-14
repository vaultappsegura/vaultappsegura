#!/bin/bash

# ==============================================================================
# SCRIPT DE INSTALACIÓN - VAULT (RED ANÓNIMA P2P)
# ==============================================================================

# Colores y formatos
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Limpiar pantalla
clear

echo -e "${CYAN}${BOLD}=====================================================${NC}"
echo -e "${CYAN}${BOLD}   Select your language / Selecciona tu idioma       ${NC}"
echo -e "${CYAN}${BOLD}=====================================================${NC}"
echo "1) Español"
echo "2) English"
echo ""
read -p "Option/Opción [1-2]: " lang_option

# ==============================================================================
# TEXTOS EN ESPAÑOL
# ==============================================================================
if [ "$lang_option" == "1" ]; then
    TXT_WELCOME_TITLE="BIENVENIDO A NUESTRA PLATAFORMA"
    TXT_WELCOME_BODY="Esta es una plataforma que defiende la libertad de expresión y se opone firmemente a cualquier forma de censura. Aquí buscamos dar voz a las denuncias anónimas contra políticos, empresarios y cualquier otro actor corrupto; queremos proteger a los periodistas para que puedan exponer su trabajo sin arriesgar su vida.

Gracias por intentar hacer del mundo un lugar mejor a través de algo tan simple, pero tan poderoso, como la verdad. A lo largo de los siglos, se han derramado ríos de sangre por algo que parece tan elemental como la libertad. Al utilizar esta plataforma, honramos a todos aquellos que han luchado por esa idea y a quienes dieron su vida para que hoy podamos ejercerla.

Esta no es una plataforma partidista: aquí cualquiera puede expresar su opinión y será respetada. La única manera real de defender nuestra libertad es ejerciéndola, y este espacio busca precisamente eso: ofrecer un lugar donde todos puedan hacerlo de forma plena y sin miedo."
    
    TXT_WELCOME_FOOTER="TU INSTALACIÓN COMIENZA AHORA. GRACIAS POR SER PARTE DE ESTA LUCHA POR LA VERDAD."

    TXT_SECURITY_TITLE="¿CÓMO FUNCIONA Y POR QUÉ ES SEGURA?"
    TXT_SECURITY_BODY="Para garantizar tu anonimato absoluto, esta plataforma no utiliza servidores centrales que puedan ser hackeados o confiscados. Todo el tráfico de la aplicación se enruta forzosamente a través de la red Tor (la dark web), lo que oculta tu dirección IP y tu ubicación física de principio a fin.

Además, los mensajes se envían a través del protocolo descentralizado Nostr, donde tu identidad no es un correo o un número de teléfono, sino una llave criptográfica que tú mismo controlas. Toda la comunicación directa cuenta con cifrado de extremo a extremo (E2EE) de grado militar.

Cualquier archivo adjunto (imágenes, documentos) pasa por un proceso de \"limpieza\" que extirpa metadatos ocultos (como las coordenadas GPS de tus fotos) antes de ser fragmentado y distribuido en la red global IPFS.

Ni los gobiernos, ni corporaciones, ni siquiera los creadores de esta plataforma pueden censurar tus mensajes o revelar tu identidad."

    TXT_PROMPT="¿Deseas continuar con la instalación de la aplicación? (S/n): "
    TXT_INSTALLING="Descargando e instalando el paquete .deb..."
    TXT_SUCCESS="¡Instalación completada con éxito! Ya puedes abrir la aplicación desde tu menú principal."
    TXT_ABORT="Instalación cancelada."
    TXT_SUDO="Se requerirá tu contraseña de administrador para instalar dependencias."

# ==============================================================================
# TEXTS IN ENGLISH
# ==============================================================================
else
    TXT_WELCOME_TITLE="WELCOME TO OUR PLATFORM"
    TXT_WELCOME_BODY="This is a platform that defends freedom of expression and firmly opposes any form of censorship. Here we seek to give a voice to anonymous complaints against politicians, businessmen, and any other corrupt actor; we want to protect journalists so they can expose their work without risking their lives.

Thank you for trying to make the world a better place through something as simple, but as powerful, as the truth. Throughout the centuries, rivers of blood have been shed for something that seems as elementary as freedom. By using this platform, we honor all those who have fought for that idea and those who gave their lives so that today we can exercise it.

This is not a partisan platform: here anyone can express their opinion and it will be respected. The only real way to defend our freedom is by exercising it, and this space seeks exactly that: to offer a place where everyone can do it fully and without fear."
    
    TXT_WELCOME_FOOTER="YOUR INSTALLATION BEGINS NOW. THANK YOU FOR BEING PART OF THIS FIGHT FOR THE TRUTH."

    TXT_SECURITY_TITLE="HOW DOES IT WORK AND WHY IS IT SECURE?"
    TXT_SECURITY_BODY="To guarantee your absolute anonymity, this platform does not use central servers that can be hacked or confiscated. All application traffic is forcibly routed through the Tor network (the dark web), which hides your IP address and physical location from start to finish.

In addition, messages are sent through the decentralized Nostr protocol, where your identity is not an email or a phone number, but a cryptographic key that you control yourself. All direct communication has military-grade end-to-end encryption (E2EE).

Any attached file (images, documents) goes through a \"cleaning\" process that removes hidden metadata (such as the GPS coordinates of your photos) before being fragmented and distributed in the global IPFS network.

Neither governments, nor corporations, nor even the creators of this platform can censor your messages or reveal your identity."

    TXT_PROMPT="Do you want to continue with the installation? (Y/n): "
    TXT_INSTALLING="Downloading and installing the .deb package..."
    TXT_SUCCESS="Installation completed successfully! You can now open the application from your main menu."
    TXT_ABORT="Installation aborted."
    TXT_SUDO="Your administrator password will be required to install dependencies."
fi

# ==============================================================================
# IMPRESIÓN DE MENSAJES
# ==============================================================================
clear

echo -e "${YELLOW}${BOLD}$TXT_WELCOME_TITLE${NC}"
echo -e "${NC}------------------------------------------------------------${NC}"
echo -e "${NC}$TXT_WELCOME_BODY${NC}"
echo ""
sleep 2

echo -e "${BLUE}${BOLD}$TXT_SECURITY_TITLE${NC}"
echo -e "${NC}------------------------------------------------------------${NC}"
echo -e "${NC}$TXT_SECURITY_BODY${NC}"
echo ""
sleep 2

echo -e "${GREEN}${BOLD}$TXT_WELCOME_FOOTER${NC}"
echo ""

# ==============================================================================
# PROCESO DE INSTALACIÓN
# ==============================================================================
read -p "$TXT_PROMPT" confirm
if [[ "$confirm" =~ ^[Nn]$ ]]; then
    echo -e "${RED}$TXT_ABORT${NC}"
    exit 1
fi

echo -e "${YELLOW}$TXT_SUDO${NC}"
echo -e "${CYAN}$TXT_INSTALLING${NC}"

# 1. Prioridad: Buscar el archivo .deb localmente en la misma carpeta
# Soporta tanto el nombre anterior 'app' como el nuevo 'vault'
LOCAL_DEB_VAULT="./vault_0.1.0_amd64.deb"
LOCAL_DEB_APP="./app_0.1.0_amd64.deb"
TEMP_DEB="/tmp/vault_install.deb"

if [ -f "$LOCAL_DEB_VAULT" ]; then
    echo -e "${GREEN}Detectado archivo local: $LOCAL_DEB_VAULT${NC}"
    cp "$LOCAL_DEB_VAULT" "$TEMP_DEB"
elif [ -f "$LOCAL_DEB_APP" ]; then
    echo -e "${GREEN}Detectado archivo local legacy: $LOCAL_DEB_APP${NC}"
    cp "$LOCAL_DEB_APP" "$TEMP_DEB"
else
    # 2. Alternativa: Descarga remota si no está el archivo junto al script
    # URL remota temporal (debe reemplazarse con el link real de github u onion)
    DEB_URL="https://github.com/Tauri-Anon-P2P/Release/releases/latest/download/vault_0.1.0_amd64.deb"

    if command -v curl &> /dev/null; then
        curl -L -o "$TEMP_DEB" "$DEB_URL" || { echo "Download Failed"; exit 1; }
    elif command -v wget &> /dev/null; then
        wget -O "$TEMP_DEB" "$DEB_URL" || { echo "Download Failed"; exit 1; }
    else
        echo "Error: No se encontró el archivo local ni herramientas de descarga (curl/wget)."
        exit 1
    fi
fi

sudo dpkg -i "$TEMP_DEB"
# Resolver cualquier dependencia gráfica de Linux que falte (WebKit2GTK, etc)
sudo apt-get install -f -y

rm "$TEMP_DEB"

echo -e "${GREEN}${BOLD}✔ $TXT_SUCCESS${NC}"
echo ""

# Preguntar por acceso directo en el escritorio
read -p "¿Deseas crear un acceso directo en tu Escritorio? / Do you want a Desktop shortcut? (S/n): " shortcut_confirm
if [[ ! "$shortcut_confirm" =~ ^[Nn]$ ]]; then
    DESKTOP_DIR=$(xdg-user-dir DESKTOP 2>/dev/null)
    if [ -z "$DESKTOP_DIR" ]; then
        # Fallback if xdg-user-dir is not available
        if [ -d "$HOME/Escritorio" ]; then
            DESKTOP_DIR="$HOME/Escritorio"
        else
            DESKTOP_DIR="$HOME/Desktop"
        fi
    fi
    
    # Try to find the installed .desktop file
    if [ -f "/usr/share/applications/vault.desktop" ]; then
        cp "/usr/share/applications/vault.desktop" "$DESKTOP_DIR/"
        chmod +x "$DESKTOP_DIR/vault.desktop"
        echo -e "${GREEN}Acceso directo creado en: $DESKTOP_DIR${NC}"
    elif [ -f "/usr/share/applications/app.desktop" ]; then
        cp "/usr/share/applications/app.desktop" "$DESKTOP_DIR/vault.desktop"
        chmod +x "$DESKTOP_DIR/vault.desktop"
        echo -e "${GREEN}Acceso directo creado en: $DESKTOP_DIR${NC}"
    else
        echo -e "${YELLOW}No se encontró el archivo .desktop del sistema. Se omitió el acceso directo.${NC}"
    fi
fi
echo ""

# Intentar abrir la aplicación automáticamente
if command -v vault &> /dev/null; then
    echo "Iniciando Vault..."
    vault &
elif command -v app &> /dev/null; then
    echo "Iniciando App..."
    app &
fi

exit 0
