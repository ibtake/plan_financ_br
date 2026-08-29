const UINT32_SIZE = 2 ** 32

function randomIndex(length) {
  const limit = Math.floor(UINT32_SIZE / length) * length
  let value
  do value = crypto.getRandomValues(new Uint32Array(1))[0]
  while (value >= limit)
  return value % length
}

export function generateTemporaryPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*?'
  const characters = ['A', 'a', '7', '!']
  while (characters.length < 18) characters.push(alphabet[randomIndex(alphabet.length)])
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const target = randomIndex(index + 1)
    ;[characters[index], characters[target]] = [characters[target], characters[index]]
  }
  return characters.join('')
}
