import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isAppleDevice, hasAppleServerPasskey, shouldOfferAppleSync } from '../src/lib/passkeySync.js'

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15'
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15'
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15'
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'

test('isAppleDevice reconhece Apple e recusa Windows', () => {
  assert.equal(isAppleDevice(IPHONE), true)
  assert.equal(isAppleDevice(IPAD), true)
  assert.equal(isAppleDevice(MAC), true)
  assert.equal(isAppleDevice(WINDOWS), false)
  assert.equal(isAppleDevice(''), false)
})

test('hasAppleServerPasskey acha Apple Passwords e ignora Windows Hello', () => {
  assert.equal(hasAppleServerPasskey([{ friendly_name: 'Apple Passwords' }]), true)
  assert.equal(hasAppleServerPasskey([{ friendly_name: 'Windows Hello Hardware Authenticator' }]), false)
  assert.equal(hasAppleServerPasskey([]), false)
  assert.equal(hasAppleServerPasskey(null), false)
  assert.equal(hasAppleServerPasskey([{ friendly_name: 'Windows Hello' }, { friendly_name: 'Apple Passwords' }]), true)
})

test('shouldOfferAppleSync so com login novo, sem marca, Apple no aparelho e no servidor', () => {
  const apple = [{ friendly_name: 'Apple Passwords' }]
  assert.equal(shouldOfferAppleSync({ freshLogin: true, hasLocalMark: false, passkeyList: apple, ua: IPAD }), true)
  // ramos falsos
  assert.equal(shouldOfferAppleSync({ freshLogin: false, hasLocalMark: false, passkeyList: apple, ua: IPAD }), false)
  assert.equal(shouldOfferAppleSync({ freshLogin: true, hasLocalMark: true, passkeyList: apple, ua: IPAD }), false)
  assert.equal(shouldOfferAppleSync({ freshLogin: true, hasLocalMark: false, passkeyList: apple, ua: WINDOWS }), false)
  assert.equal(shouldOfferAppleSync({ freshLogin: true, hasLocalMark: false, passkeyList: [], ua: IPAD }), false)
})
