import React from 'react';

// Funcion global para abrir links desde cualquier componente
function openLinkModal(url: string) {
    if ((window as any).__vaultOpenLink) {
        (window as any).__vaultOpenLink(url);
    } else {
        window.dispatchEvent(new CustomEvent('request-link-open', { detail: url }));
    }
}

// Componente para volver clickeables los links HTTP dentro del texto de forma segura
export default function MessageRenderer({ content }: { content: string }) {

    // Regex para detectar links http, https e ipfs nativos
    const urlRegex = /(https?:\/\/[^\s]+|ipfs:\/\/[a-zA-Z0-9]+)/g;

    const parts = content.split(urlRegex);

    return (
        <React.Fragment>
            <span style={{ wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
                {parts.map((part, i) => {
                    if (part.match(urlRegex)) {
                        return (
                            <button
                                key={i}
                                type="button"
                                onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    openLinkModal(part);
                                }}
                                style={{ 
                                    color: 'var(--primary-color, #3b82f6)', 
                                    cursor: 'pointer', 
                                    textDecoration: 'underline',
                                    background: 'none',
                                    border: 'none',
                                    padding: 0,
                                    font: 'inherit',
                                    wordBreak: 'break-all',
                                    WebkitTapHighlightColor: 'rgba(59,130,246,0.3)',
                                    display: 'inline'
                                }}
                                title="Abrir link externo"
                            >
                                {part}
                            </button>
                        );
                    }
                    return part;
                })}
            </span>

        </React.Fragment>
    );
}
