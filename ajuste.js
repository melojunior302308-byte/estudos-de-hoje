/* Detecta o "ajuste de página" de um manual: diferença entre a página do PDF
   e o número impresso no rodapé/cabeçalho. Só preenche o campo; quem grava é o botão Salvar. */
window.manAutoOff = async function (id) {
  const msg = document.getElementById('meoMsg'), inp = document.getElementById('meo');
  const say = (t) => { if (msg) msg.textContent = t; };
  try {
    say('Procurando os números de página no PDF...');
    const m = MAN.find((x) => x.id == id);
    const pdf = await pdfOpen(m.pdf);
    const n = pdf.numPages, votes = new Map();
    const from = Math.max(1, Math.round(n * 0.12)), to = Math.max(from, Math.round(n * 0.95));
    const step = Math.max(1, Math.floor((to - from) / 45));
    let seen = 0;
    for (let i = from; i <= to; i += step) {
      const pg = await pdf.getPage(i), H = pg.getViewport({ scale: 1 }).height;
      const tc = await pg.getTextContent();
      seen++;
      const found = new Set();
      for (const it of tc.items) {
        const s = String(it.str || '').trim(), y = it.transform[5];
        if (!s || (y > H * 0.09 && y < H * 0.91)) continue;
        const k = s.match(/^(?:p[áa]g(?:ina)?\.?\s*)?(\d{1,3})$/i);
        if (k) found.add(i - +k[1]);
      }
      found.forEach((o) => votes.set(o, (votes.get(o) || 0) + 1));
    }
    let best = null, bc = 0;
    votes.forEach((c, o) => { if (c > bc) { bc = c; best = o; } });
    if (best === null || bc < 3 || bc < seen * 0.3) {
      say('Não consegui detectar sozinho. Preencha à mão: se a página impressa 10 aparece na página 14 do PDF, use 4.');
      return;
    }
    if (inp) inp.value = best;
    say('Ajuste detectado: ' + best + ' (confirmado em ' + bc + ' de ' + seen + ' páginas). Confira e toque em Salvar.');
  } catch (e) {
    say('Não consegui ler o PDF agora. Tente de novo ou preencha à mão.');
  }
};
