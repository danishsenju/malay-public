/**
 * Grade sticker colours - client-safe (no server imports).
 * One loud accent per band, always ink-legible, per the design tokens:
 * lime for excellence, leaf for good, mustard for warning, maroon for bad.
 */
export function gradeColors(grade: string): { bg: string; text: string } {
  if (grade === 'A+' || grade === 'A') return { bg: '#d2e823', text: '#000000' } // lime-spark
  if (grade === 'B+' || grade === 'B') return { bg: '#ebffc5', text: '#000000' } // leaf-wash
  if (grade === 'C+' || grade === 'C') return { bg: '#d6a337', text: '#000000' } // mustard-pop
  if (grade === 'D' || grade === 'E')  return { bg: '#780016', text: '#ffffff' } // maroon-plate
  return { bg: '#adadad', text: '#000000' }                                      // concrete-tile - no data
}
