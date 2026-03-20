/**
 * Get the current document direction
 */
export function isRtl() {
  return document.documentElement.dir === 'rtl';
}

/**
 * Return 'left' or 'right' based on direction for "start" alignment
 */
export function startAlign() {
  return isRtl() ? 'right' : 'left';
}

export function endAlign() {
  return isRtl() ? 'left' : 'right';
}
