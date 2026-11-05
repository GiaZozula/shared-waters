// Decorative water marks. CSS animates them only while their panel is open.
export function createPanelOrnament() {
  const wave = document.createElement('div')
  wave.className = 'panel-wave'
  wave.setAttribute('aria-hidden', 'true')
  for (let i = 0; i < 3; i++) {
    const mark = document.createElement('span')
    mark.textContent = '♒︎'
    wave.append(mark)
  }
  return wave
}
