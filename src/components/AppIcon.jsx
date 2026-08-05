import { useIcons } from '../contexts/IconContext.jsx'

/**
 * Renderiza um icone da interface.
 *
 * Recebe o emoji original e devolve:
 *   - a imagem PNG, se existir um override cadastrado para aquele emoji
 *   - o proprio emoji, caso contrario
 *
 * Isso permite trocar os icones de forma incremental, tela a tela, sem
 * precisar alterar cada ponto de uso: basta cadastrar o PNG na aba Ícones.
 *
 * O tamanho segue a fonte do elemento pai por padrao (1em), entao o icone
 * ocupa exatamente o mesmo espaco que o emoji ocupava.
 */
export default function AppIcon({ emoji, size, className = '', title, style }) {
  const { getOverride } = useIcons()
  const src = getOverride(emoji)

  const dimension = size ? `${size}px` : '1em'

  if (src) {
    return (
      <img
        src={src}
        alt=""
        aria-hidden={title ? undefined : 'true'}
        title={title}
        className={`app-icon app-icon-img ${className}`.trim()}
        style={{ width: dimension, height: dimension, ...style }}
        draggable="false"
      />
    )
  }

  return (
    <span
      className={`app-icon ${className}`.trim()}
      title={title}
      aria-hidden={title ? undefined : 'true'}
      style={size ? { fontSize: dimension, ...style } : style}
    >
      {emoji}
    </span>
  )
}
