; =============================================================
; VAULT - DECLARACION DE PRINCIPIOS (NSIS Install Hook)
; Muestra la declaracion completa de principios y seguridad.
; =============================================================

!macro NSIS_HOOK_PREINSTALL
  MessageBox MB_YESNO|MB_ICONINFORMATION \
    "VAULT - BIENVENIDO A NUESTRA PLATAFORMA$\r$\n\
$\r$\n\
Esta plataforma defiende la libertad de expresion y se opone a cualquier forma de censura. Buscamos dar voz a las denuncias anonimas contra politicos, empresarios y actores corruptos; queremos proteger a los periodistas para que expongan su trabajo sin arriesgar su vida.$\r$\n\
$\r$\n\
Gracias por intentar hacer del mundo un lugar mejor a través de algo tan simple, pero tan poderoso, como la verdad. A lo largo de los siglos se han derramado rios de sangre por la libertad. Al usar esta plataforma, honramos a todos aquellos que han luchado por esa idea y a quienes dieron su vida para que hoy podamos ejercerla.$\r$\n\
$\r$\n\
Esta no es una plataforma partidista: aqui toda opinion sera respetada. La unica manera real de defender nuestra libertad es ejerciendola, y este espacio busca precisamente eso: ofrecer un lugar donde todos puedan hacerlo de forma plena y sin miedo.$\r$\n\
$\r$\n\
COMO FUNCIONA Y POR QUE ES SEGURA?$\r$\n\
$\r$\n\
- Anonimato Absoluto: Todo el trafico se enruta forzosamente por la red Tor, ocultando tu IP y ubicacion fisica de principio a fin.$\r$\n\
- Identidad Descentralizada: Tu identidad es una llave criptografica que solo tu controlas (Nostr). No se pide correo ni numero de telefono.$\r$\n\
- Limpieza Multimedia: Los archivos adjuntos pasan por un proceso de limpieza de metadatos ocultos (GPS, camara) antes de ser distribuidos.$\r$\n\
- Resistencia a la Censura: Ni los gobiernos, ni corporaciones, ni los creadores de esta herramienta pueden censurar tus mensajes o revelar tu identidad.$\r$\n\
$\r$\n\
Deseas continuar con la instalacion?" \
  IDYES continue_install IDNO abort_install

  abort_install:
    Abort

  continue_install:
!macroend

!macro NSIS_HOOK_POSTINSTALL
!macroend

!macro NSIS_HOOK_PREUNINSTALL
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
!macroend
