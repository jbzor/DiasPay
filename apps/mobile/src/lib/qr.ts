import qrcode from 'qrcode-generator';

/** Marge de silence imposée par la norme, en modules. */
export const QUIET_ZONE = 4;

/** Matrice de modules (true = noir) d’un QR code, correction d’erreur M, sans marge. */
export function qrMatrix(text: string): boolean[][] {
  const qr = qrcode(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}

/** Tracé SVG des modules noirs (un segment par suite horizontale), dans un repère où 1 unité = 1 module, marge comprise. */
export function qrPath(matrix: boolean[][], quiet = QUIET_ZONE): string {
  const parts: string[] = [];
  matrix.forEach((row, r) => {
    let c = 0;
    while (c < row.length) {
      if (!row[c]) { c++; continue; }
      const start = c;
      while (c < row.length && row[c]) c++;
      // Hauteur de 1,02 module : léger recouvrement entre rangées, pour éviter les filets clairs à l’anticrénelage.
      parts.push(`M${start + quiet} ${r + quiet}h${c - start}v1.02h${start - c}z`);
    }
  });
  return parts.join('');
}
