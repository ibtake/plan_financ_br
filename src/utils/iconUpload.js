// Leitura e normalizacao dos PNGs enviados para substituir emojis.
//
// SEGURANCA
//   O arquivo vem do disco do usuario. Duas barreiras antes de virar data URL:
//     1. Tipo e tamanho conferidos antes de ler o conteudo
//     2. A imagem e redesenhada num <canvas>, o que descarta metadados EXIF e
//        qualquer payload embutido no arquivo original. O resultado e sempre um
//        PNG limpo gerado pelo proprio navegador.
//   Nada e enviado para servidor: o data URL fica apenas no localStorage.

/** PNG de icone nao precisa passar de 1 MB */
const MAX_FILE_BYTES = 1024 * 1024
const MAX_INPUT_DIMENSION = 4096

/** Lado maximo do icone normalizado, suficiente para telas retina */
const MAX_DIMENSION = 128

// V-10: image/svg+xml removido. file.type e falsificavel e SVG e um vetor
// desnecessario aqui, ja que so guardamos o PNG redesenhado no canvas.
const ALLOWED_TYPES = ['image/png', 'image/webp']

/**
 * Le um arquivo de imagem e devolve um data URL PNG quadrado e redimensionado.
 * @returns {Promise<string>} data URL pronto para uso em <img src>
 */
export function readIconFile(file) {
  return new Promise((resolve, reject) => {
    if (!ALLOWED_TYPES.includes(file.type)) {
      reject(new Error('Formato não aceito. Envie um arquivo PNG ou WEBP.'))
      return
    }
    if (file.size > MAX_FILE_BYTES) {
      reject(new Error('Arquivo muito grande. O limite por ícone é de 1 MB.'))
      return
    }

    const reader = new FileReader()

    reader.onerror = () => reject(new Error('Falha ao ler o arquivo.'))

    reader.onload = () => {
      const image = new Image()

      image.onerror = () => reject(new Error('Não foi possível abrir a imagem. Verifique se o arquivo está íntegro.'))

      image.onload = () => {
        try {
          if (image.width > MAX_INPUT_DIMENSION || image.height > MAX_INPUT_DIMENSION) {
            reject(new Error('Imagem muito grande. O limite e de 4096 px por lado.'))
            return
          }
          const largestSide = Math.max(image.width, image.height) || MAX_DIMENSION
          const scale = Math.min(1, MAX_DIMENSION / largestSide)
          const width = Math.max(1, Math.round(image.width * scale)) || MAX_DIMENSION
          const height = Math.max(1, Math.round(image.height * scale)) || MAX_DIMENSION

          // Canvas quadrado mantem o alinhamento com os emojis, que sao quadrados
          const side = Math.max(width, height)
          const canvas = document.createElement('canvas')
          canvas.width = side
          canvas.height = side

          const ctx = canvas.getContext('2d')
          ctx.imageSmoothingEnabled = true
          ctx.imageSmoothingQuality = 'high'
          // Centraliza preservando a proporcao original
          ctx.drawImage(image, (side - width) / 2, (side - height) / 2, width, height)

          resolve(canvas.toDataURL('image/png'))
        } catch {
          reject(new Error('Não foi possível processar a imagem.'))
        }
      }

      image.src = String(reader.result)
    }

    reader.readAsDataURL(file)
  })
}

/** Estimativa do espaco ocupado pelos overrides, para avisar sobre a cota */
export function estimateStorageBytes(overrides) {
  return Object.values(overrides).reduce((total, dataUrl) => total + dataUrl.length, 0)
}
